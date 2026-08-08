use base64::engine::general_purpose;
use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, State};

use crate::api::{build_authorize_url, take_pending, verify_id_token, ApiClient};
use crate::auth;
use crate::config;
use crate::crypto::e2ee;
use crate::error::Result;
use crate::models::*;
use crate::urlfix;

fn fix_avatar(v: &mut Option<String>) {
    if let Some(ref av) = v.clone() {
        *v = Some(urlfix::absolutize(av, config::issuer()).unwrap_or(av.clone()));
    }
}

fn fix_account(a: &mut Account) {
    fix_avatar(&mut a.avatar);
}

fn fix_conversation(c: &mut Conversation) {
    fix_avatar(&mut c.avatar);
}

fn fix_room_message(m: &mut RoomMessage) {
    fix_avatar(&mut m.avatar);
}

fn fix_status(s: &mut Status) {
    if let Some(ref a) = s.media_path.clone() {
        s.media_path = Some(urlfix::absolutize(a, config::issuer()).unwrap_or(a.clone()));
    }
    if let Some(ref mut account) = s.account {
        fix_account(account);
    }
}

#[tauri::command]
pub async fn auth_login_start() -> Result<String> {
    crate::reset_callback_processed();
    Ok(build_authorize_url())
}

#[tauri::command]
pub async fn auth_logout() -> Result<()> {
    auth::clear_tokens().map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn register_push_endpoint(
    state: State<'_, ApiClient>,
    endpoint: String,
) -> Result<()> {
    let _: serde_json::Value = state
        .post("/api/v1/push/subscribe", &serde_json::json!({
            "platform": "unifiedpush",
            "endpoint": endpoint,
        }))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_call_token() -> Result<String> {
    auth::get_access_token()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?
        .ok_or(crate::error::Error::NotAuthenticated)
}

// Current access token for the shared JS crypto bridge (window.ExtrovertE2EE).
// Called by src/lib/e2ee.ts before crypto operations; Rust keeps the refresh
// logic, the webview just consumes the token.
#[tauri::command]
pub async fn get_access_token() -> Result<String> {
    auth::get_access_token()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?
        .ok_or(crate::error::Error::NotAuthenticated)
}

// Force a token refresh via the refresh token, then return the new access
// token. The E2EE bridge calls this after a 401 from the webview-side fetches.
#[tauri::command]
pub async fn e2ee_refresh_token(state: State<'_, ApiClient>) -> Result<String> {
    state.refresh_if_needed().await?;
    auth::get_access_token()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?
        .ok_or(crate::error::Error::NotAuthenticated)
}

// ---- File-backed storage for the JS crypto bridge ----
// Android WebView IndexedDB is not reliably persisted, so the Olm account +
// session pickles (encrypted with the device key Kd) live in a JSON file in
// the app data dir. Written atomically (tmp + rename). All values are small
// base64 strings; a few hundred KB worst case.
//
// IMPORTANT: the JS bridge fires several `e2ee_store_set` calls concurrently
// (saveSelfSessions() writes selfOutbound + selfInbound in a Promise.all, and
// saveAccount() runs alongside). Each handler is load-whole-file -> insert ->
// save-whole-file, so without serialization one writer's insert is clobbered
// by another writer's full-file save — the store silently loses keys (e.g.
// `olm:selfInbound`), and after a restart the self-inbound session is gone,
// making every own sent DM show "[unable to decrypt]". All store operations
// therefore go through a single process-wide mutex. (The web app never hits
// this because IndexedDB serializes transactions per object store.)
fn e2ee_store_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn e2ee_store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| crate::error::Error::Other(e.to_string()))?;
    fs::create_dir_all(&dir).map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(dir.join("e2ee-store.json"))
}

fn e2ee_store_load(app: &tauri::AppHandle) -> Result<HashMap<String, String>> {
    let path = e2ee_store_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| crate::error::Error::Other(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| crate::error::Error::Other(e.to_string()))
}

// Unique tmp name per writer: with a fixed "e2ee-store.tmp" two concurrent
// writers can rename each other's in-flight file out from under the other.
// Callers hold e2ee_store_lock(), so this is belt-and-braces, but it makes
// the write path safe even if a future caller forgets the lock.
static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn e2ee_store_save(app: &tauri::AppHandle, map: &HashMap<String, String>) -> Result<()> {
    let path = e2ee_store_path(app)?;
    let n = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_file_name(format!("e2ee-store.{}.{}.tmp", std::process::id(), n));
    let text = serde_json::to_string(map).map_err(|e| crate::error::Error::Other(e.to_string()))?;
    fs::write(&tmp, text).map_err(|e| crate::error::Error::Other(e.to_string()))?;
    fs::rename(&tmp, &path).map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn e2ee_store_get(app: tauri::AppHandle, key: String) -> Result<Option<String>> {
    let _guard = e2ee_store_lock().lock().unwrap_or_else(|p| p.into_inner());
    let map = e2ee_store_load(&app)?;
    Ok(map.get(&key).cloned())
}

#[tauri::command]
pub async fn e2ee_store_set(app: tauri::AppHandle, key: String, value: String) -> Result<()> {
    let _guard = e2ee_store_lock().lock().unwrap_or_else(|p| p.into_inner());
    let mut map = e2ee_store_load(&app)?;
    map.insert(key, value);
    e2ee_store_save(&app, &map)
}

#[tauri::command]
pub async fn auth_current_user(state: State<'_, ApiClient>) -> Result<Option<Account>> {
    let access_token = auth::get_access_token()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    match access_token {
        None => Ok(None),
        Some(_) => {
            let mut account: Account = state.get("/api/v1/accounts/verify_credentials").await?;
            fix_account(&mut account);
            Ok(Some(account))
        }
    }
}

#[tauri::command]
pub async fn timeline_home(
    state: State<'_, ApiClient>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Paginated<Status>> {
    let mut paginated: Paginated<Status> = state
        .get_with_query(
            "/api/v1/timelines/home",
            &[
                ("cursor", cursor),
                ("limit", limit.map(|l| l.to_string())),
            ],
        )
        .await?;

    for status in &mut paginated.data {
        fix_status(status);
    }

    Ok(paginated)
}

#[tauri::command]
pub async fn create_post(
    state: State<'_, ApiClient>,
    body: String,
) -> Result<Status> {
    let mut status: Status = state
        .post("/api/v1/statuses", &serde_json::json!({
            "type": "text",
            "body": body,
        }))
        .await?;
    fix_status(&mut status);
    Ok(status)
}

#[tauri::command]
pub async fn like_post(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Status> {
    let mut status: Status = state
        .post(&format!("/api/v1/statuses/{}/favourite", id), &serde_json::json!({}))
        .await?;
    fix_status(&mut status);
    Ok(status)
}

#[tauri::command]
pub async fn unlike_post(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Status> {
    let mut status: Status = state
        .post(&format!("/api/v1/statuses/{}/unfavourite", id), &serde_json::json!({}))
        .await?;
    fix_status(&mut status);
    Ok(status)
}

#[tauri::command]
pub async fn reblog_post(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Status> {
    let mut status: Status = state
        .post(&format!("/api/v1/statuses/{}/reblog", id), &serde_json::json!({}))
        .await?;
    fix_status(&mut status);
    Ok(status)
}

#[tauri::command]
pub async fn user_profile(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Account> {
    let mut account: Account = state
        .get(&format!("/api/v1/accounts/{}", id))
        .await?;
    fix_account(&mut account);
    Ok(account)
}

#[tauri::command]
pub async fn user_statuses(
    state: State<'_, ApiClient>,
    id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Paginated<Status>> {
    let mut paginated: Paginated<Status> = state
        .get_with_query(
            &format!("/api/v1/accounts/{}/statuses", id),
            &[
                ("cursor", cursor),
                ("limit", limit.map(|l| l.to_string())),
            ],
        )
        .await?;

    for status in &mut paginated.data {
        fix_status(status);
    }

    Ok(paginated)
}

#[tauri::command]
pub async fn follow_user(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Account> {
    let mut account: Account = state
        .post(&format!("/api/v1/accounts/{}/follow", id), &serde_json::json!({}))
        .await?;
    fix_account(&mut account);
    Ok(account)
}

#[tauri::command]
pub async fn unfollow_user(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<Account> {
    let mut account: Account = state
        .post(&format!("/api/v1/accounts/{}/unfollow", id), &serde_json::json!({}))
        .await?;
    fix_account(&mut account);
    Ok(account)
}

#[tauri::command]
pub async fn conversations_list(
    state: State<'_, ApiClient>,
) -> Result<Vec<Conversation>> {
    let mut conversations: Vec<Conversation> = state
        .get("/api/v1/conversations")
        .await?;
    for c in &mut conversations {
        fix_conversation(c);
    }
    Ok(conversations)
}

#[tauri::command]
pub async fn conversation_messages(
    state: State<'_, ApiClient>,
    username: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Paginated<DirectMessage>> {
    let mut paginated: Paginated<DirectMessage> = state
        .get_with_query(
            &format!("/api/v1/conversations/{}", username),
            &[
                ("cursor", cursor),
                ("limit", limit.map(|l| l.to_string())),
            ],
        )
        .await?;

    if let Some(priv_key) = e2ee::get_private_key() {
        let user_id = e2ee::get_user_id();
        for msg in &mut paginated.data {
            let key = if msg.from_id == user_id.as_deref().unwrap_or("") {
                msg.key_for_sender.as_deref()
            } else {
                msg.key_for_recipient.as_deref()
            };
            if let Some(k) = key {
                if let Ok(plain) = e2ee::decrypt_message(&msg.body, k, &priv_key) {
                    msg.body = plain;
                }
            }
        }
    }

    Ok(paginated)
}

#[tauri::command]
pub async fn conversation_send(
    state: State<'_, ApiClient>,
    username: String,
    body: String,
    proto: Option<String>,
    ciphertext: Option<String>,
    sender_ciphertext: Option<String>,
) -> Result<DirectMessage> {
    let is_sticker = body.starts_with("/uploads/stickers/");

    // Olm messages are encrypted by the shared JS bridge (window.ExtrovertE2EE
    // in the webview); Rust only forwards the ciphertexts.
    if proto.as_deref() == Some("olm") {
        let ct = ciphertext.ok_or_else(|| crate::error::Error::E2ee("missing ciphertext".into()))?;
        let sct = sender_ciphertext.ok_or_else(|| crate::error::Error::E2ee("missing sender_ciphertext".into()))?;
        return state
            .post(
                &format!("/api/v1/conversations/{}/messages", username),
                &serde_json::json!({
                    "proto": "olm",
                    "body": ct,
                    "sender_ciphertext": sct,
                }),
            )
            .await;
    }

    if !is_sticker {
        let priv_key = e2ee::get_private_key()
            .ok_or_else(|| crate::error::Error::E2ee("E2EE not unlocked. Enter your password first.".into()))?;
        let own_pub = e2ee::get_public_key()
            .ok_or_else(|| crate::error::Error::E2ee("E2EE not unlocked.".into()))?;

        let key_resp: RecipientKeyResponse = state
            .get(&format!("/api/v1/conversations/{}/keys", username))
            .await?;
        let recipient_pem = key_resp
            .public_key
            .ok_or_else(|| crate::error::Error::E2ee(format!("{username} has no public key yet")))?;

        let (enc_body, key_for_sender, key_for_recipient) =
            e2ee::encrypt_message(&body, &recipient_pem, &own_pub)?;

        let mut msg: DirectMessage = state
            .post(
                &format!("/api/v1/conversations/{}/messages", username),
                &serde_json::json!({
                    "body": enc_body,
                    "key_for_sender": key_for_sender,
                    "key_for_recipient": key_for_recipient,
                }),
            )
            .await?;

        let user_id = e2ee::get_user_id();
        let my_key = if msg.from_id == user_id.as_deref().unwrap_or("") {
            msg.key_for_sender.as_deref()
        } else {
            msg.key_for_recipient.as_deref()
        };
        if let Some(k) = my_key {
            if let Ok(plain) = e2ee::decrypt_message(&msg.body, k, &priv_key) {
                msg.body = plain;
            }
        }

        Ok(msg)
    } else {
        state
            .post(
                &format!("/api/v1/conversations/{}/messages", username),
                &serde_json::json!({ "body": body }),
            )
            .await
    }
}

#[tauri::command]
pub async fn e2ee_unlock(
    state: State<'_, ApiClient>,
    password: String,
) -> Result<()> {
    let account: Account = state.get("/api/v1/accounts/verify_credentials").await?;
    let user_id = account.id.clone();
    let username = account.username.clone();

    let kek = e2ee::derive_kek(&password, &username);

    let my_keys: MyKeysResponse = state.get("/api/v1/conversations/keys").await?;

    let (private_key, public_key_pem, public_key) = if let Some(enc_priv) = &my_keys.encrypted_private_key {
        let priv_key = e2ee::unwrap_private_key(enc_priv, &kek)?;
        let pub_pem = my_keys.public_key.unwrap_or_default();
        let pub_key = e2ee::public_key_from_pem_b64(&pub_pem)?;
        (priv_key, pub_pem, pub_key)
    } else {
        let (priv_key, pub_pem) = e2ee::generate_key_pair()?;
        let enc_priv = e2ee::wrap_private_key(&priv_key, &kek)?;
        let pub_key = e2ee::public_key_from_pem_b64(&pub_pem)?;

        state
            .post::<serde_json::Value, _>(
                "/api/v1/conversations/keys",
                &serde_json::json!({
                    "public_key": pub_pem,
                    "encrypted_private_key": enc_priv,
                }),
            )
            .await?;

        (priv_key, pub_pem, pub_key)
    };

    e2ee::set_state(crate::crypto::e2ee::E2eeContext {
        user_id,
        kek,
        private_key,
        public_key,
        public_key_pem,
    });

    Ok(())
}

#[tauri::command]
pub async fn e2ee_status() -> Result<bool> {
    Ok(e2ee::is_ready())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Comment {
    pub id: String,
    pub body: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
    pub account: Account,
}

#[tauri::command]
pub async fn post_comments(
    state: State<'_, ApiClient>,
    status_id: String,
) -> Result<Vec<Comment>> {
    let ctx: serde_json::Value = state.get(&format!("/api/v1/statuses/{}/context", status_id)).await?;
    let descendants = ctx.get("descendants").cloned().unwrap_or(serde_json::Value::Array(vec![]));
    Ok(serde_json::from_value(descendants).unwrap_or_default())
}

#[tauri::command]
pub async fn create_comment(
    state: State<'_, ApiClient>,
    status_id: String,
    body: String,
) -> Result<Comment> {
    state
        .post(&format!("/api/v1/statuses/{}/comment", status_id), &serde_json::json!({ "body": body }))
        .await
}

#[tauri::command]
pub async fn get_notifications(
    state: State<'_, ApiClient>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Paginated<Notification>> {
    state
        .get_with_query("/api/v1/notifications", &[("cursor", cursor), ("limit", limit.map(|l| l.to_string()))])
        .await
}

#[tauri::command]
pub async fn clear_notifications(state: State<'_, ApiClient>) -> Result<serde_json::Value> {
    state.post("/api/v1/notifications/clear", &serde_json::json!({})).await
}

#[tauri::command]
pub async fn rooms_list(
    state: State<'_, ApiClient>,
) -> Result<Vec<RoomSummary>> {
    state.get("/api/v1/rooms").await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Announcement {
    pub body: String,
    pub author_display_name: Option<String>,
    pub author_username: Option<String>,
    pub updated_at: Option<i64>,
}

#[tauri::command]
pub async fn get_announcement(state: State<'_, ApiClient>) -> Result<Option<Announcement>> {
    state.get("/api/v1/announcement").await
}

#[tauri::command]
pub async fn room_detail(
    state: State<'_, ApiClient>,
    id: String,
) -> Result<RoomDetail> {
    state.get(&format!("/api/v1/rooms/{}", id)).await
}

#[tauri::command]
pub async fn room_messages(
    state: State<'_, ApiClient>,
    room_id: String,
    channel_id: String,
    cursor: Option<String>,
) -> Result<MessagesResponse> {
    let mut resp: MessagesResponse = state
        .get_with_query(
            &format!("/api/v1/rooms/{}/channels/{}/messages", room_id, channel_id),
            &[("cursor", cursor)],
        )
        .await?;
    for m in &mut resp.messages {
        fix_room_message(m);
    }
    Ok(resp)
}

#[tauri::command]
pub async fn room_send_message(
    state: State<'_, ApiClient>,
    room_id: String,
    channel_id: String,
    body: String,
    proto: Option<String>,
    ciphertext: Option<String>,
    group_session_id: Option<String>,
) -> Result<serde_json::Value> {
    // Megolm messages are encrypted by the shared JS bridge; Rust forwards them.
    if proto.as_deref() == Some("megolm") {
        let ct = ciphertext.ok_or_else(|| crate::error::Error::E2ee("missing ciphertext".into()))?;
        let gsid = group_session_id.ok_or_else(|| crate::error::Error::E2ee("missing group_session_id".into()))?;
        return state
            .post(
                &format!("/api/v1/rooms/{}/channels/{}/messages", room_id, channel_id),
                &serde_json::json!({
                    "proto": "megolm",
                    "body": "",
                    "ciphertext": ct,
                    "group_session_id": gsid,
                }),
            )
            .await;
    }
    state
        .post(
            &format!("/api/v1/rooms/{}/channels/{}/messages", room_id, channel_id),
            &serde_json::json!({ "body": body }),
        )
        .await
}

/// Fetch image bytes from the server with the user's bearer token attached
/// (post media under `/api-uploads/` is auth-gated; the webview's `<img src>`
/// can't send an Authorization header, so we fetch via Rust and hand the
/// webview a `data:` URL instead, mirroring `fetch_avatar`).
async fn fetch_image_data_url(path: &str) -> Result<String> {
    let url = urlfix::absolutize(path, config::issuer())
        .ok_or_else(|| crate::error::Error::Other("empty image path".into()))?;

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("ExtrovertNative/0.1")
        .build()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;

    let mut req = client.get(&url);
    if let Ok(Some(token)) = auth::get_access_token().map_err(crate::error::Error::Other) {
        req = req.bearer_auth(token);
    }

    let resp = req.send().await.map_err(|e| crate::error::Error::Other(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(crate::error::Error::Api {
            status: status.as_u16(),
            detail: format!("fetch image {url}: {detail}"),
        });
    }

    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("image/jpeg").trim().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    let bytes = resp.bytes().await.map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes)))
}

#[tauri::command]
pub async fn fetch_avatar(path: String) -> Result<String> {
    fetch_image_data_url(&path).await
}

#[tauri::command]
pub async fn fetch_media(path: String) -> Result<String> {
    fetch_image_data_url(&path).await
}

pub async fn handle_oauth_callback(code: &str, state: &str) -> Result<()> {
    let pending = take_pending().ok_or_else(|| {
        crate::error::Error::Oauth("no pending OAuth flow".into())
    })?;

    if state != pending.state {
        return Err(crate::error::Error::Oauth("state mismatch".into()));
    }

    let token_resp = crate::api::exchange_code(code, &pending.verifier).await?;

    if let Some(ref id_token) = token_resp.id_token {
        verify_id_token(id_token, &pending.nonce, config::CLIENT_ID).await?;
    }

    auth::store_access_token(&token_resp.access_token)
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    auth::store_refresh_token(&token_resp.refresh_token)
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;

    Ok(())
}
