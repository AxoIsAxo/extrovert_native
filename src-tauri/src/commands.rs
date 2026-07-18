use tauri::State;

use crate::api::{build_authorize_url, verify_id_token, PENDING, ApiClient};
use crate::auth;
use crate::config;
use crate::crypto::e2ee;
use crate::error::Result;
use crate::models::*;
use crate::urlfix;

fn fix_account(a: &mut Account) {
    if let Some(ref av) = a.avatar.clone() {
        a.avatar = Some(urlfix::absolutize(av, config::issuer()).unwrap_or(av.clone()));
    }
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
    Ok(build_authorize_url())
}

#[tauri::command]
pub async fn auth_logout() -> Result<()> {
    auth::clear_tokens().map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(())
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
    let conversations: Vec<Conversation> = state
        .get("/api/v1/conversations")
        .await?;
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
) -> Result<DirectMessage> {
    let is_sticker = body.starts_with("/uploads/stickers/");

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

#[tauri::command]
pub async fn rooms_list(
    state: State<'_, ApiClient>,
) -> Result<Vec<RoomSummary>> {
    state.get("/api/v1/rooms").await
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
    state
        .get_with_query(
            &format!("/api/v1/rooms/{}/channels/{}/messages", room_id, channel_id),
            &[("cursor", cursor)],
        )
        .await
}

#[tauri::command]
pub async fn room_send_message(
    state: State<'_, ApiClient>,
    room_id: String,
    channel_id: String,
    body: String,
) -> Result<serde_json::Value> {
    state
        .post(
            &format!("/api/v1/rooms/{}/channels/{}/messages", room_id, channel_id),
            &serde_json::json!({ "body": body }),
        )
        .await
}

pub async fn handle_oauth_callback(code: &str, state: &str) -> Result<()> {
    let pending = PENDING.lock().unwrap().take();
    let pending = pending.ok_or_else(|| {
        crate::error::Error::Oauth("no pending OAuth flow".into())
    })?;

    if state != pending.state {
        return Err(crate::error::Error::Oauth("state mismatch".into()));
    }

    let token_resp = crate::api::exchange_code(code, &pending.verifier).await?;

    if let Some(ref id_token) = token_resp.id_token {
        verify_id_token(id_token, &pending.nonce, config::CLIENT_ID)?;
    }

    auth::store_access_token(&token_resp.access_token)
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    auth::store_refresh_token(&token_resp.refresh_token)
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;

    Ok(())
}
