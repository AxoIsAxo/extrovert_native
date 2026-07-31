mod api;
mod auth;
mod commands;
mod config;
mod crypto;
mod error;
mod models;
mod urlfix;

use std::sync::atomic::{AtomicBool, Ordering};

use api::ApiClient;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // On Linux/Windows, deep links launch a *new* process with the URL as a CLI
    // argument. The single-instance plugin forwards that process's args to the
    // already-running instance (and makes the new process exit). Must be
    // registered before the deep-link plugin.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Hand the forwarded args to the deep-link plugin so the original
            // instance processes the OAuth callback.
            app.deep_link().handle_cli_arguments(args.iter());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ApiClient::new())
        .setup(|app| {
            let handle = app.handle().clone();

            let app_data = handle.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&app_data).ok();
            auth::init(app_data);

            if let Err(e) = handle.deep_link().register("im.extrovert.native") {
                eprintln!("deep-link register error: {e}");
            }

            let handle2 = handle.clone();
            handle.deep_link().on_open_url(move |event| {
                let h = handle2.clone();
                for url in event.urls() {
                    process_deep_link_url(&h, url.as_str());
                }
            });

            // Cold start: when the app itself is launched by a deep link, the
            // plugin parses argv during *plugin* setup and emits
            // `deep-link://new-url` before our `on_open_url` listener above is
            // registered, so the event is lost. The URL is still stored, so
            // drain it explicitly.
            if let Ok(Some(urls)) = handle.deep_link().get_current() {
                for url in urls {
                    process_deep_link_url(&handle, url.as_str());
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_login_start,
            commands::auth_logout,
            commands::auth_current_user,
            commands::timeline_home,
            commands::create_post,
            commands::like_post,
            commands::unlike_post,
            commands::reblog_post,
            commands::user_profile,
            commands::user_statuses,
            commands::follow_user,
            commands::unfollow_user,
            commands::conversations_list,
            commands::conversation_messages,
            commands::conversation_send,
            commands::rooms_list,
            commands::room_detail,
            commands::get_announcement,
            commands::post_comments,
            commands::create_comment,
            commands::get_notifications,
            commands::clear_notifications,
            commands::room_messages,
            commands::room_send_message,
            commands::e2ee_unlock,
            commands::e2ee_status,
            commands::fetch_avatar,
            commands::fetch_media,
            commands::get_call_token,
            commands::get_access_token,
            commands::e2ee_refresh_token,
            commands::e2ee_store_get,
            commands::e2ee_store_set,
            commands::register_push_endpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn parse_callback(raw_url: &str) -> Option<(String, String)> {
    let parsed = url::Url::parse(raw_url).ok()?;
    let query = parsed.query()?;
    let params: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(query.as_bytes()).collect();
    let code = params.get("code")?.to_string();
    let state = params.get("state")?.to_string();
    Some((code, state))
}

fn process_deep_link_url(handle: &tauri::AppHandle, raw_url: &str) {
    eprintln!("deep-link received: {raw_url}");
    let _ = handle.emit::<String>("oauth-debug", format!("got url: {raw_url}"));
    let parsed = match url::Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return,
    };
    if parsed.scheme() != "im.extrovert.native" {
        let _ = handle.emit::<String>("oauth-debug", format!("wrong scheme: {}", parsed.scheme()));
        return;
    }
    let h = handle.clone();
    let url = raw_url.to_string();
    tauri::async_runtime::spawn(async move {
        process_url_inner(&h, &url).await;
    });
}

static CALLBACK_PROCESSED: AtomicBool = AtomicBool::new(false);

/// Allow a new OAuth callback to be processed (called when a fresh login flow
/// starts, so logout → login within the same session isn't swallowed by the
/// one-shot guard).
pub fn reset_callback_processed() {
    CALLBACK_PROCESSED.store(false, Ordering::SeqCst);
}

async fn process_url_inner(handle: &tauri::AppHandle, raw_url: &str) {
    if CALLBACK_PROCESSED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some((code, state)) = parse_callback(raw_url) {
        let _ = handle.emit::<String>("oauth-debug", "starting exchange".into());
        match commands::handle_oauth_callback(&code, &state).await {
            Ok(()) => {
                let _ = handle.emit::<String>("oauth-debug", "exchange ok".into());
                let _ = handle.emit::<()>("oauth-success", ());
            }
            Err(e) => {
                let _ = handle.emit::<String>("oauth-debug", format!("exchange error: {e}"));
                let _ = handle.emit::<String>("oauth-error", e.to_string());
            }
        }
    } else {
        let _ = handle.emit::<String>("oauth-debug", "parse_callback returned None".into());
    }
}
