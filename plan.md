# Extrovert Native — Full Implementation Plan

> **Status:** Executing — Phase 1 in progress.
> **Targets:** Android, macOS, Linux (primary). iOS/Windows left addable.
> **Stack:** Rust core + Tauri v2 + React/TS + Vite.
> **Server state:** All fixes from `/Users/lea/extrovert/plan.md` are shipped (commit `90eaef5`).

---

## 0. OAuth App Registration

Register once at `https://extrovert.redforged.eu/settings/developers` (browser, session-cookie required):

| Field | Value |
|---|---|
| **Name** | `Extrovert Native` |
| **Description** | `Official native client for Android, macOS, and Linux` |
| **Website** | `https://extrovert.redforged.eu` |
| **Redirect URIs** | `im.extrovert.native://oauth/callback, http://localhost:1455/callback` |
| **Scopes** | `openid profile read write follow media.write notifications read:direct write:direct` |

The `client_secret` is NOT needed — the server supports public PKCE clients (`api-auth.js:83-100` skips secret validation when omitted). `client_id` is safe to hardcode (identifier, not secret).

---

## 1. Toolchain

**Already OK:** Rust 1.97.1, Node v26.4.0, npm 11.17.0, Tauri v2 CLI (via npm), macOS Command Line Tools (no full Xcode), target `x86_64-apple-darwin` (Intel).

**Missing — Android (independent of Xcode):**
1. JDK 17 (Temurin) — `brew install --cask temurin@17` — set `JAVA_HOME`
2. Android SDK: `cmdline-tools`, `platform-tools`, `build-tools;34.0.0`, `platforms;android-34` — set `ANDROID_HOME`
3. Android NDK r27 — set `NDK_HOME`
4. `rustup target add aarch64-linux-android armv7-linux-android x86_64-linux-android i686-linux-android`
5. `cargo tauri android init` (after scaffold)

**Linux:** Build on Ubuntu CI runner (no cross-build from macOS).

---

## 2. Stack

**Rust core + React/TS frontend (Tauri default).** All business logic in Rust (HTTP, OAuth/PKCE, JWT verify, E2E DM crypto, SSE, storage, rate-limit, pagination, URL-fix). Webview is purely a view layer.

---

## 3. Project Layout

```
extrovert-native/
├── Cargo.toml                     # workspace
├── package.json                   # @tauri-apps/cli, react, vite, @tanstack/react-query, tailwind
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                           # frontend (React + TS + Vite)
│   ├── main.tsx, App.tsx
│   ├── routes/                    # login, timeline, status, profile, notifications, search, settings, dms, conversation
│   ├── components/                # StatusCard, Composer, InfiniteList, Avatar, CommentList, DmComposer...
│   ├── lib/invoke.ts              # typed wrappers around tauri commands
│   └── styles/                    # tokens.css (Extrovert palette), tailwind config
└── src-tauri/
    ├── tauri.conf.json            # strict CSP, deep-link scheme, identifier
    ├── capabilities/default.json
    ├── icons/
    ├── build.rs
    └── src/
        ├── lib.rs                 # Builder, plugin registration, command registration, app state
        ├── error.rs               # thiserror -> serde for frontend
        ├── state.rs               # AppState: reqwest Client, DB pool, config, token store
        ├── config.rs              # hardcoded client_id, API base URL, issuer, scopes
        ├── url.rs                 # defensive URL fix, absolutize media URLs
        ├── models/                # serde structs: Account, Status, Notification, Message, Paginated<T>
        ├── api/
        │   ├── client.rs          # reqwest+rustls; bearer inject; 401-refresh-retry; rate-limit throttle
        │   ├── oauth.rs           # PKCE gen, /authorize URL, /token exchange, JWKS id_token verify
        │   ├── accounts.rs statuses.rs timelines.rs notifications.rs media.rs search.rs follows.rs
        │   ├── conversations.rs   # DM REST API wrappers
        │   └── presence.rs        # /calls/presence
        ├── auth/
        │   ├── pkce.rs            # verifier + S256 challenge + state + nonce
        │   ├── store.rs           # SecretStore trait + per-platform impls (keyring)
        │   ├── session_watch.rs   # refresh at ~20h; force reauth on refresh 400
        │   └── e2ee.rs            # RSA-4096-OAEP + AES-256-GCM DM crypto
        ├── crypto/
        │   ├── kek.rs             # PBKDF2(password, username, 600000 iters) → AES-256 KEK
        │   ├── rsa.rs             # RSA-OAEP-SHA256 keygen/import/export
        │   └── aes.rs             # AES-256-GCM
        ├── realtime/
        │   └── sse.rs             # GET /notifications/stream client
        ├── db/                    # sqlx SQLite: timeline cache, drafts, notif cursor, DM metadata
        ├── commands/              # #[tauri::command] handlers
        └── deep_link.rs          # OAuth callback handler
```

---

## 4. Rust Core Design

### 4.1 OAuth Flow (public PKCE client)
1. Generate PKCE verifier + S256 challenge + random `state` + `nonce`.
2. `tauri-plugin-shell` opens system browser to `/api/v1/oauth/authorize` with `client_id`, `redirect_uri=im.extrovert.native://oauth/callback`, `response_type=code`, `scope=...`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.
3. `tauri-plugin-deep-link` catches callback; verify `state`; POST to `/api/v1/oauth/token` with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri` — **omit `client_secret`**.
4. Verify `id_token` (RS256) against `/.well-known/jwks.json`: `iss`, `aud`, `exp`, `nonce`. Claims: `sub, iss, aud, exp, iat, auth_time, nonce?, preferred_username?(profile), name?(profile), picture?(profile, absolute URL)`. No `email`.

### 4.2 Token Lifecycle
- **Access token:** 24h (`expires_in: 86400`).
- **Refresh token:** 90 days (`refresh_expires_at`, patched in commit `90eaef5`).
- **Refresh rotation:** single-use. Reuse → 400.
- **Design:** proactively refresh at ~20h; on refresh 400, wipe tokens, bounce to login.

### 4.3 URL Fixing
- Prepend `${ISSUER}` to all relative media paths (`/api-uploads/...`, `/uploads/...`).
- Defensively strip duplicate `/uploads/` prefix if it ever appears.
- Media is **public** (`express.static`, no auth) — `<img>` needs no bearer.

### 4.4 Timestamp Discipline
- API body fields (`created_at`, `edited_at`): **millisecond** epochs.
- OAuth token `created_at`: **unix seconds**.
- JWT `iat`/`auth_time`/`exp`: **unix seconds**.
- Distinct `MsEpoch(i64)` / `SecEpoch(i64)` newtypes.

### 4.5 Pagination (per-endpoint)
Cursors are base64url JSON `{ "id": <int> }`.
- `/accounts/:id/statuses`: keyset on `id < cursor.id` — clean.
- `/timelines/home`: O(N) — can duplicate/skip on rank shifts. Frontend dedupes by post id.
- `/notifications`: now paginated (keyset on `n.id`).
- `/conversations/:username` messages: keyset on `m.id` — clean.

### 4.6 Rate Limiting
Per-**token** (server fixed). 120/min. Rust client throttles to ~100/min via token bucket; back off on 429 using `RateLimit-Reset`.

### 4.7 Comments / Context
`/statuses/:id/context` returns `ancestors: []` always (no threading), `descendants` = flat comments with real avatar + `created_at`. No nested replies.

### 4.8 Search
- `type=accounts`: platform-wide, `LIKE %q%` on `username` + `display_name`.
- `type=statuses`: network-bound (self + friends + FOAF).
- Omit `type` → `{ accounts: [...], statuses: [...] }`.

### 4.9 Idempotency
`POST /statuses` honors `Idempotency-Key` (24h TTL). UUID per composer session.

### 4.10 Repost Rules
- `type=repost` requires `repost_of_id`; duplicate → 409.
- `/reblog` refuses your own post (400).
- Engagement counts target the **original** post.

### 4.11 Visibility
`/accounts/:id/statuses` → 404 (not 403) for non-network users. Treat 404 as "not in your network."

---

## 5. E2E DM Crypto (matching web exactly)

### 5.1 Web Scheme (from `/Users/lea/extrovert/public/e2ee.js`)

| Step | Algorithm | Params |
|---|---|---|
| KEK derivation | PBKDF2-SHA256 | password + `username.toLowerCase()` salt, **600000 iterations** → AES-256-GCM key |
| RSA keypair | RSA-OAEP | **4096-bit**, publicExponent `[1,0,1]`, SHA-256 |
| Private key storage | AES-256-GCM | KEK encrypts PKCS8-exported private key; **IV(12) ‖ ciphertext** stored base64 |
| Public key storage | SPKI | base64 (raw SPKI bytes, no PEM wrapper) |
| Message encrypt | AES-256-GCM | random AES key; IV(12) ‖ ciphertext → `body`; AES key RSA-OAEP to recipient → `key_for_recipient`; same AES key RSA-OAEP to sender → `key_for_sender` |
| Message decrypt | RSA-OAEP + AES-GCM | decrypt key with own RSA private → AES key → decrypt `body` (IV = first 12 bytes) |

### 5.2 Native App Key Access (prompt-for-password-once)

The web derives KEK from the user's login password. Native app uses OAuth (no password access).

**Flow:**
1. On first DM use, prompt: "Enter your Extrovert password to unlock encrypted messages."
2. Derive KEK (PBKDF2-SHA256, 600000 iters, same salt) — must match web exactly.
3. `GET /api/v1/conversations/keys/self` (new server endpoint) → `{ public_key, encrypted_private_key }`.
4. Unwrap private key: `AES-GCM-Decrypt(encrypted_private_key, KEK)` → PKCS8 RSA private key.
5. Store unwrapped RSA private key in OS keystore. **Discard password + KEK immediately** (zeroize).
6. Subsequent launches load private key from OS keystore; no prompt.

### 5.3 Rust Crypto
- `aws-lc-rs` for RSA-OAEP-SHA256, AES-256-GCM, PBKDF2.
- `zeroize` for password/KEK/key zeroization.

### 5.4 DM Send
1. Ensure private key loaded (or prompt-for-password flow).
2. Fetch recipient pubkey: `GET /conversations/:username/keys`.
3. Random AES-256-GCM key + 12-byte IV.
4. Encrypt plaintext → `body = base64(IV ‖ ciphertext)`.
5. `RSA-OAEP-Encrypt(aes_key, recipient_pubkey)` → `key_for_recipient`.
6. `RSA-OAEP-Encrypt(aes_key, my_pubkey)` → `key_for_sender`.
7. `POST /conversations/:username/messages`.

### 5.5 DM Decrypt
- Inbound (`from_id != me`): use `key_for_recipient`.
- Outbound (`from_id == me`): use `key_for_sender`.
1. `RSA-OAEP-Decrypt(key, my_private_key)` → AES key.
2. `body_bytes = base64decode(body)`; IV = first 12 bytes.
3. `AES-256-GCM-Decrypt` → plaintext.

---

## 6. Realtime (SSE)

**Server:** `GET /api/v1/notifications/stream` — SSE, Bearer `notifications` scope, 15s heartbeats.

**Native (`realtime/sse.rs`):**
- `reqwest` streaming + `eventsource-stream` crate.
- Connect on foreground; reconnect with backoff.
- Parse `event: notification\ndata: {...}\n\n`; dispatch via Tauri events.
- On 401, refresh + reconnect; on refresh fail, surface "session expired".
- Pause on background (Android).

---

## 7. Tauri Command Surface

**Auth:** `auth_login_start`, `auth_logout`, `auth_current_user`, `auth_unlock_dm_key(password)`

**Timeline + posts:** `timeline_home(cursor?, limit?)`, `status_get(id)`, `status_context(id)`, `status_create(payload, idempotency_key)`, `status_delete(id)`, `status_favourite(id)`, `status_unfavourite(id)`, `status_reblog(id)`

**Accounts + follows:** `account_get(id)`, `account_statuses(id, cursor?, limit?)`, `account_followers(id)`, `account_following(id)`, `account_follow(id)`, `account_unfollow(id)`, `account_relationships(ids)`, `profile_update(...)`, `profile_upload_avatar(file_path)`

**Notifications:** `notifications_list(limit?, cursor?)`, `notifications_unread_count()`, `notifications_clear()`

**Media:** `media_upload(file_path)`

**Search:** `search(q, type?)`

**DMs (E2E):** `dm_conversations()`, `dm_messages(username, cursor?, limit?)`, `dm_send(username, plaintext)`, `dm_edit(message_id, plaintext)`, `dm_delete(message_id)`, `dm_get_public_key(username)`

**Presence:** `presence_online()`, `presence_for(username)`

---

## 8. Frontend

- **Vite + React + TS**, Tailwind, `@tanstack/react-query`, `@tanstack/react-virtual`, `@tanstack/router`.
- **Screens:** Login → Home timeline → Status detail → Composer → Profile → Notifications → Search → Settings → DMs → Conversation.
- **Branding:** Extrovert tokens (`--primary #7ec8e3`, `--surface #121214`, `--on-surface #e0dfe3`).
- **Mobile UX (Phase 4):** bottom nav, pull-to-refresh, virtualized feeds.

---

## 9. Cross-Platform

- **Deep links:** `tauri-plugin-deep-link` → `im.extrovert.native`. Android intent-filter, macOS Info.plist, Linux .desktop.
- **Secure storage:** `keyring` (macOS/Linux), Android Keystore via JNI.
- **Media picking:** `tauri-plugin-dialog` + `tauri-plugin-fs`. Android content URIs → temp file.
- **CSP:** strict — `connect-src 'self' https://extrovert.redforged.eu; img-src 'self' https://extrovert.redforged.eu;`

---

## 10. Required Server Change

Add to `/Users/lea/extrovert/src/routes/api-v1.js`:

```js
router.get('/conversations/keys/self', requireApiAuth('read:direct'), (req, res) => {
  const publicKey = db.getPublicKey(req.apiUser.id);
  const encryptedPrivateKey = db.getEncryptedPrivateKey(req.apiUser.id);
  res.json({ data: { public_key: publicKey, encrypted_private_key: encryptedPrivateKey } });
});
```

---

## 11. Build & Release

- **macOS:** `cargo tauri build` → `.app`/`.dmg`.
- **Android:** `cargo tauri android build` → `.apk`/`.aab`.
- **Linux:** Ubuntu CI → `.AppImage`, `.deb`, `.rpm`.
- **CI:** GitHub Actions matrix on tag push.

---

## 12. Security

- PKCE is the real protection. Omit `client_secret`. `client_id` safe to hardcode.
- Verify `state` (CSRF) + `nonce` (OIDC replay).
- Tokens + RSA private key in OS keystore. Password zeroized after KEK derivation.
- `Idempotency-Key` per composer session.
- DM crypto: constant-time, AES-GCM auth tag, zeroize intermediates.

---

## 13. Dependencies (Rust)

```toml
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"], default-features = false }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio-rustls"] }
jsonwebtoken = "9"
aws-lc-rs = "1"
aes-gcm = "0.10"
rand = "0.8"
base64 = "0.22"
url = "2"
thiserror = "1"
anyhow = "1"
zeroize = { version = "1", features = ["derive"] }
keyring = "3"
governor = "0.6"
eventsource-stream = "0.2"
futures-util = "0.3"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

---

## 14. Phased Delivery

| Phase | Scope | Deliverable |
|---|---|---|
| **1. Foundation** | Scaffold, PKCE OAuth, JWKS verify, token storage, `auth_current_user`, URL-fix, session watchdog, CSP, deep-link | macOS app logs in & shows profile |
| **2. Core social** | Timeline, status detail, like/repost, composer, profile, follow, SQLite cache | Usable daily-driver on macOS |
| **3. Notifications + search + realtime** | Notifications list, unread_count, clear, SSE stream, search tabs | Feature-complete desktop |
| **4. Android** | Toolchain, Android Keystore JNI, content-URI media, mobile UX | Android APK/AAB |
| **5. E2E DMs** | Server: `GET /conversations/keys/self`. Native: password-prompt unlock, KEK, RSA unwrap, DM send/decrypt, conversation UI | Full DM parity with web |
| **6. Linux + CI** | Ubuntu CI, release matrix, signing, presence indicator | Artifacts for all 3 |
| 7 (future) | iOS + Windows | not blocked |

---

## 15. Risks

1. `getEncryptedPrivateKey` must be exported from `db.js` (used by `chats.js:37`).
2. PBKDF2 iteration count (600000) must match web exactly or unwrap fails.
3. SPKI/PKCS8 base64 format interop — web stores base64 of raw SPKI bytes (no PEM wrapper).
4. Android Keystore JNI bridge — most platform-specific piece (Phase 4).
5. Timeline cursor instability — O(N) feed recompute can duplicate/skip. Frontend dedupe mitigates.
6. Android content URIs for media → temp file copy (Phase 4).
