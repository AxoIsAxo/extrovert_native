mod api;
mod auth;
mod commands;
mod config;
mod error;
mod models;
mod urlfix;

use api::ApiClient;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
                    let _ = h.emit::<String>("oauth-debug", format!("got url: {}", url.as_str()));
                    if url.scheme() != "im.extrovert.native" {
                        let _ = h.emit::<String>("oauth-debug", format!("wrong scheme: {}", url.scheme()));
                        continue;
                    }
                    if let Some((code, state)) = parse_callback(url.as_str()) {
                        let h2 = h.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = h2.emit::<String>("oauth-debug", "starting exchange".into());
                            match commands::handle_oauth_callback(&code, &state).await {
                                Ok(()) => {
                                    let _ = h2.emit::<String>("oauth-debug", "exchange ok".into());
                                    let _ = h2.emit::<()>("oauth-success", ());
                                }
                                Err(e) => {
                                    let _ = h2.emit::<String>("oauth-debug", format!("exchange error: {e}"));
                                    let _ = h2.emit::<String>("oauth-error", e.to_string());
                                }
                            }
                        });
                    } else {
                        let _ = h.emit::<String>("oauth-debug", "parse_callback returned None".into());
                    }
                }
            });

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
            commands::room_messages,
            commands::room_send_message,
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
