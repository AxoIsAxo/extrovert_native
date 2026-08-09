# AGENTS.md — Extrovert Native

A Tauri v2 app (Rust core + React/TS view layer) for the Extrovert social
network at `https://extrovert.redforged.eu`. **Business logic lives in Rust; the
webview is purely a view layer.** Read this before touching code — it covers the
conventions and the non-obvious gotchas that have bitten before. When you learn
something new that's not here, **add it** (see the section at the bottom).

## Commands

```bash
npm run tauri dev      # full dev: vite (1420) + Rust app + hot reload
npm run dev            # vite only (no native shell — webview features absent)
npm run build          # tsc + vite build -> dist/
cargo build            # in src-tauri/ — Rust-only fast check
npx tsc --noEmit       # frontend type check (no emit)
```

Always type-check after frontend changes (`npx tsc --noEmit`) and `cargo build`
in `src-tauri/` after Rust changes. There's no test harness yet.

## Architecture split

- **Rust (`src-tauri/src/`)** owns: HTTP + auth/OAuth/PKCE, JWT verification,
  E2EE DM crypto, token storage (JSON on disk), URL-fixing, all API calls.
- **Frontend (`src/`)** owns: rendering, navigation/tab state, calling Tauri
  commands via `invoke`, gluing returned data into components. **No business
  logic, no fetch, no crypto in JS.**
- Bridge: Rust `#[tauri::command]` fns in `commands.rs` → registered in
  `lib.rs` `invoke_handler![...]` → thin TS wrappers in `src/lib/invoke.ts` →
  components. **Adding a backend command is a 3-file change: define, register,
  wrap.** Don't forget any of the three or it silently does nothing / fails TS.

## Layout

```
src-tauri/src/
  lib.rs        app entry; plugins; deep-link/single-instance wiring; oauth callback routing
  config.rs     ISSUER/API_BASE/CLIENT_ID/REDIRECT_URI/scopes; build_authorize_url; token/jwks/userinfo URLs
  commands.rs   all #[tauri::command] handlers; URL-fix helpers (fix_avatar/fix_status/...)
  api/
    client.rs   ApiClient: bearer-auth GET/POST/DELETE/PATCH, auto refresh on 401, rate limiter, {data:...} unwrap
    oauth.rs    PKCE flow state (PENDING, in-memory + disk fallback), build_authorize_url, JWKS/id_token verify
  auth/         pkce.rs (PKCE/state/nonce gen), store.rs (tokens.json in app_data dir)
  crypto/e2ee.rs RSA-OAEP + AES-GCM DM encryption; KEK from user password; key wrapping
  models.rs     serde structs mirroring the API (snake_case); string_or_int helper
  urlfix.rs     absolutize relative avatar/media paths against ISSUER
  error.rs      thiserror Error enum; Serialize impl flattens to a string for the webview
src/
  App.tsx       screen state machine (loading/login/app), tabs (home/chats/profile), event listeners
  lib/invoke.ts one TS wrapper per Rust command + interface for each model
  *.tsx         pure view components
  styles/tokens.css  design tokens (see "Styling")
```

## Adding a new backend command

1. `commands.rs` — `#[tauri::command] pub async fn foo(state: State<'_, ApiClient>, ...) -> Result<T>`.
2. `lib.rs` — add to `tauri::generate_handler![...]`.
3. `src/lib/invoke.ts` — `export async function foo(...): Promise<T> { return invoke<T>("foo", {...}); }` plus any new `interface`.
4. Use it from a component. Type-check both sides.

`ApiClient` is in `tauri::State`; get it with `state: State<'_, ApiClient>`. Token
attach + 401-refresh is automatic — just call `state.get/post/...`.

## API client conventions

- `config::api_base()` = `https://extrovert.redforged.eu`. Paths are relative
  (`/api/v1/...`); the client prepends the base.
- Responses are auto-unwrapped: many endpoints return `{"data": ...}` —
  `extract_data` peels that. Paginated responses have top-level `pagination` and
  are passed through whole → deserialize as `Paginated<T>`.
- 401 → transparent refresh via `refresh_token`; on refresh failure tokens are
  cleared and `NotAuthenticated` is returned.
- Rate-limited to 100 req/min via `govern`.

## Auth / OAuth (read before touching)

- Public PKCE client. Flow: `build_authorize_url` → browser → server redirects to
  `im.extrovert.native://oauth/callback?code=&state=` → deep-link plugin →
  `process_deep_link_url` → `handle_oauth_callback` → token exchange → store.
- `PendingFlow` (verifier/state/nonce) is kept in memory AND on disk
  (`pending.json` in app_data) — disk fallback matters for cold starts.
- **Deep links on Linux/Windows launch a NEW process** with the URL as argv.
  `tauri-plugin-single-instance` (registered first) forwards those args to the
  running instance via `handle_cli_arguments`, and the original instance does the
  exchange. Never remove single-instance or the login breaks (we hit exactly that bug).
- **Cold start via deep link**: the plugin emits `deep-link://new-url` during its
  own setup, *before* our `on_open_url` listener is registered — so `setup` also
  drains `deep_link().get_current()`. Keep both paths.
- `CALLBACK_PROCESSED` is a one-shot guard; `reset_callback_processed()` is called
  at the start of each login so logout→login works in one session. Don't reuse it
  for unrelated flags.
- OAuth `created_at` timestamps are **unix seconds**, not ms.

## Images / media (gotcha — read this)

The webview `<img src>` **cannot attach an Authorization header**. Two cases:

- **Avatars** live under `/uploads/` (public) — but routed through Rust
  `fetch_avatar` → base64 `data:` URL anyway (handles auth-gated avatars too).
- **Post media** lives under `/api-uploads/` which **requires the bearer token**
  → cannot be a raw `<img src>`. Must go through `fetch_media` (Rust fetches with
  the token, returns a `data:` URL). See `PostCard.tsx` / `Avatar.tsx` for the
  pattern: `useEffect` keyed on the path → `fetchMedia`/`fetchAvatar` → setState.
- Any new image-bearing field: add/use a Rust fetcher, don't bind the URL
  directly. `fetch_image_data_url` in `commands.rs` is the shared helper.
- URL fixing: `urlfix::absolutize(path, issuer())` turns relative paths into
  full `https://...` URLs. Commands already `fix_avatar`/`fix_status`/etc. on the
  way out — remember to fix new avatar-bearing models.

## Styling

- Tailwind utility classes throughout. **Design tokens are CSS variables** in
  `src/styles/tokens.css` (Material-ish dark theme): `--primary`, `--on-primary`,
  `--surface`, `--on-surface`, `--on-surface-variant`, `--outline-variant`,
  `--error`, `--radius-btn`, etc. Use them via `style={{ background:
  "var(--primary)" }}` or Tailwind classes mapped to them (`bg-surface`,
  `text-on-surface-variant`, `border-outline-variant` — see `tailwind.config.js`).
- No inline color literals; everything goes through tokens so theming stays in
  one place.
- Mobile-phone form factor: window is 480×800, min 360×600. Components scroll,
  bottom nav bar is the pattern (see `App.tsx`).

## Frontend navigation

`App.tsx` is a screen state machine (`loading` | `login` | `app`) + a `tab`
(`home` | `chats` | `profile`) + sub-state (`chatUsername` / `roomId` /
`profileId` / `composing` etc.). New screens: add to the tab union, a state
slot, and a branch in `renderContent`. The **"chats"** tab now merges DMs and
rooms into one `ChatList` (WhatsApp-style); selecting yields a discriminated
`ChatEntry` (`{kind:"dm",c}` or `{kind:"room",r}`) and routes to `ChatView` or
`RoomView`. DMs need E2EE unlock before they load (see `ChatView`).

## E2EE DMs

- **Crypto runs in the webview, not Rust.** `src/vendor/` holds the web app's
  Olm/Megolm implementation (IIFEs setting `window.ExtrovertE2EE`), synced from
  the server repo with `npm run sync:web-crypto` (set `EXTV_WEB_REPO` if the
  server repo isn't at `../extrovert`). **Never hand-edit vendored files** —
  edit the server repo, then re-sync.
- `src/vendor/bridge-config.js` sets `window.ExtrovertE2EEConfig =
  {apiBase, olmWasmUrl, bearerToken}` before the crypto loads. Rust owns OAuth
  + token refresh; `src/lib/e2ee.ts` (`withFreshToken`) injects the current
  bearer token from `get_access_token` before every crypto op and retries once
  via `e2ee_refresh_token` after a 401 (webview fetches can't refresh).
- The server accepts the OAuth bearer on the web E2EE routes (`/chats/keys`,
  `/chats/prekeys`, bundle, room session routes) — the bridge fetches those
  directly with the token. CORS is open for Bearer-bearing requests.
- Unlock flow: after login, `App.tsx` runs `e2eeEnsureReady()`; if false →
  `UnlockScreen` calls `e2eeUnlock(password, username)` (recovers the server
  backup with the login password). New devices with no backup get keys created
  silently. Everything (chats, rooms, previews) is gated on `unlocked` in App.
- Legacy RSA messages (`proto='rsa'`) decrypt through the same bridge
  (`e2eeDecryptLegacyDm`). The old Rust `crypto/e2ee.rs` is no longer used by
  the UI — leave it in place for reference.
- Rooms: `e2eeSyncRoomSessions(roomId, myId, members)` needs the room's member
  list (API `/api/v1/rooms/:id` returns `members`); sends go through Rust as
  `proto=megolm` + ciphertext + group_session_id; incoming megolm messages are
  decrypted in the webview and rendered as plain text.
- `olm.wasm` lives in `public/` (Vite copies it to dist). CSP needs
  `'wasm-unsafe-eval'` in `script-src` — in `tauri.conf.json` and again in the
  Android copy after any `tauri android init`.
- **Android APK asset gotcha**: the mobile build uses the brownfield pattern —
  the CLI does NOT embed `dist/` into the .so (only the desktop build does).
  `tauri android build` alone produces an APK with no `index.html` (blank app).
  After `npm run build`, copy the frontend into the Android assets:
  `cp -R dist/* src-tauri/gen/android/app/src/main/assets/` before
  `tauri android build`. This dir is gitignored (build output).
- **OLM_OPTIONS gotcha**: olm.js assigns `OLM_OPTIONS = opts` (sloppy-mode
  implicit global). Vite bundles it as a strict ES module → ReferenceError.
  bridge-config.js pre-declares `window.OLM_OPTIONS` so the assignment is legal.
  Keep that line if bridge-config changes.
- **e2ee-store race gotcha**: the JS bridge fires several `e2ee_store_set`
  invokes concurrently (`saveSelfSessions()` writes `selfOutbound` +
  `selfInbound` in a `Promise.all`, `saveAccount()` alongside). The Rust
  handler is load-whole-file → insert → save-whole-file, so without
  serialization one writer's insert gets clobbered — the store loses keys
  (e.g. `olm:selfInbound`) and after a restart **every own sent DM shows
  "[unable to decrypt]"**. All store ops go through a process-wide mutex
  (`e2ee_store_lock()` in `commands.rs`); keep it that way if you add store
  commands. The web app never hits this (IndexedDB serializes per store).
- Live DMs arrive over the same signaling WS as calls (`new_dm` messages in
  `webrtc.ts` → `Call.on("new_dm", ...)`), decrypted via the bridge.

## Push / offline calls (no Google, no third-party relay)

- **Own push channel**: `PushService.kt` is a foreground service holding a WS
  to `wss://extrovert.redforged.eu/ws?token=…`; on open it sends
  `{type:'push_register'}` (first message — this is what marks it a push
  channel on the server; `webrtc-signaling.js` keeps push channels out of the
  `clients` map so the user still counts as offline for calls).
- Server (`sendWsPush` in webrtc-signaling.js) delivers `{type:'call', from,
  from_display, cancel_token}` → full-screen ring notification (Answer →
  MainActivity `call_answer` → auto-answer in CallUI; Decline → `CallActionReceiver`
  → POST /push/cancel-pending, app stays closed). Unanswered after the server's
  2-min TTL → `{type:'missed_call'}` notification.
- Android forces always-on processes to show a notification: the service's
  channel `extrovert_service` is IMPORTANCE_MIN ("Extrovert — Connected",
  no sound). The call ring channel is `extrovert_calls` (IMPORTANCE_HIGH,
  full-screen intent).
- **Token handling**: the service reads `tokens.json` (Rust's OAuth store in
  the app data root) and refreshes via `/api/v1/oauth/token` itself on WS
  auth failure (1008/4401) — it must NOT rely on the Rust process (it may be
  dead). Service is START_STICKY + restarted on boot (`BootReceiver`).
- Removing ntfy/UnifiedPush: the connector dep, `ExtrovertPushReceiver`, and
  the webview's push-endpoint registration were deleted; `push.js` on the
  server only dispatches web-push (browsers).
- **Debug gotcha**: `client.newWebSocket(...)` returns the socket — assign it
  to the field or `sendJson` silently no-ops (hit this exact bug).
- The `first message` role split on the server: `push_register` must set the
  connection's `registered` flag or the next message (ping) registers the
  push channel as a signaling client (hit this exact bug).


## Tauri plugins in use

`shell` (open URLs), `deep-link` (OAuth callback), `dialog`, `fs`,
`single-instance` (deep-link delivery). Adding a plugin: add to `Cargo.toml`,
register in `lib.rs` (order matters — single-instance **first**, before
deep-link), and if it has JS API add to `package.json` + `invoke.ts`-style
wrapper where relevant. Config under `tauri.conf.json > plugins`. CSP is strict
in `tauri.conf.json > app.security.csp` — adding new connect/img origins means
updating the CSP `connect-src`/`img-src` there too. **The WebSocket for calls
(`wss://extrovert.redforged.eu/ws`) needs `wss://extrovert.redforged.eu` listed
explicitly in `connect-src` — `https://` does NOT cover `wss://`, they're
separate CSP schemes. Without it the signaling socket is silently blocked and
calls never reach the recipient (caller just sees "Calling…" forever). The same
CSP is copied into `src-tauri/gen/android/app/src/main/assets/tauri.conf.json`
on `tauri android init`; re-apply the `wss://` entry there after re-init.**

## Android build notes

- `tauri android init` generates `src-tauri/gen/android/` (Gradle project).
  **That directory is regenerated** — manual edits there (e.g. Android theme
  tweaks) are lost if you re-run `init`. The known manual tweak: edge-to-edge is
  on by default, which on Android makes the bottom nav slide under the gesture
  bar and the header under the status bar (because Android's WebView doesn't
  expose `env(safe-area-inset-*)` reliably). Fix is in
  `app/src/main/res/values/themes.xml` (and `values-night/themes.xml`):
  set `android:windowDrawsSystemBarBackgrounds=false` and
  `android:statusBarColor`/`android:navigationBarColor` to `@color/surface_dark`.
  Re-apply after re-init.
  **What actually works on Android 16+ (edge-to-edge forced):** let the system
  bars be transparent (`@android:color/transparent`), use `height: 100dvh`
  instead of `min-h-screen`/`100vh` on the root container (because `100vh`
  includes the space under the system bars on edge-to-edge, pushing the bottom
  nav off-screen), and apply an explicit `paddingBottom` (e.g. 32px) on the
  bottom nav bar to clear the gesture bar area. `env(safe-area-inset-bottom)`
  doesn't reliably work in Android WebView.
- Env vars needed to build: `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`, plus
  `source ~/.cargo/env` (rustup) so the Android Rust targets are found.
- Debug-signed APK (`apksigner` with `~/.android/debug.keystore`, store/key pass
  `android`, alias `androiddebugkey`) installs on a real device with
  `adb install -r <apk>`. Release builds are unsigned by default.
- **CI**: `.forgejo/workflows/build-apk.yml` builds a debug APK on every push to
  `main`/`master` (and via `workflow_dispatch`). Runner is `ubuntu-22.04`; the
  workflow installs JDK 17, Android SDK 36 + build-tools 36.0.0 + NDK
  `27.0.12077973` itself (under `/opt/android-sdk`), adds the four Android Rust
  targets, then runs `npx tauri android build --apk --debug`. APK is uploaded as
  an artifact named `extrovert-android-debug-apk`. If you bump `compileSdk` in
  `app/build.gradle.kts` or the NDK version Tauri pins, update the pinned values
  in the workflow too. To produce a signed release APK, add a keystore via
  Codeberg **Repository Secrets** and switch the build step to `--release` with
  the `KEYSTORE_*` env vars wired into `tauri.build.gradle.kts` / signing config.
- **Kotlin heap**: the Tauri-generated `gradle.properties` defaults to
  `org.gradle.jvmargs=-Xmx2048m`, which the Codeberg medium runner's ~1 GiB
  container OOM-kills instantly.  Use `sed` to replace that line (don't `cat >>`,
  which creates duplicate keys and the JVM may use the first value).  We set
  `-Xmx448m` with `-XX:MaxMetaspaceSize=192m` and `-XX:-UseContainerSupport`
  (the runner goes OOM at `-Xmx512m` with unlimited metaspace but survives at
  `-Xmx384m`).  **The tiny caps are Codeberg-specific — do NOT apply them on
  GitHub Actions (16 GB runners): AGP 8.11 dies with
  `OutOfMemoryError: Metaspace` ("Could not generate a decorated class for
  PackageApplication") under `-XX:MaxMetaspaceSize=192m`, so
  `.github/workflows/build-apk.yml` keeps the committed default and has no heap
  step.**  `kotlin.compiler.execution.strategy=in-process` is the safest
  default for Android Kotlin; `daemon` doesn't reliably split into a separate
  process for Tauri-generated projects.  Keep the `kotlin.daemon.jvmargs` line
  but it may be ignored.

## Identifier / scheme notes

- App `identifier` = `im.extrovert.mobile` (yes, "mobile" — historical, don't
  rename without care, it's the basis for app_data paths and D-Bus service name).
- Deep-link scheme = `im.extrovert.native` (registered both in
  `tauri.conf.json > plugins.deep-link.desktop.schemes` and dynamically via
  `register()` so dev binaries work).
- On Linux, `register()` writes `~/.local/share/applications/extrovert-native-handler.desktop`
  pointing at `target/debug/extrovert-native` (that's how the browser launches
  the app on OAuth callback). A stale binary path there after rebuilds can cause
  weird behavior — delete it and re-register via `dev` if deep links misbehave.

## Error handling

Rust `error::Error` (`thiserror`) implements `Serialize` → flattens to its string
message, so a failed `invoke` rejects with a plain string in JS (use
`String(e)` or `.message`). Variants: `Network`, `NotAuthenticated`, `Oauth`,
`Jwt`, `E2ee`, `Api{status,detail}`, `Json`, `Other`. Don't introduce ad-hoc
string errors in commands — wrap with `Error::Other` if nothing fits.

---

## Keeping this file useful

This document exists so nobody has to re-read the whole tree to be productive.
If you:

- add a command/plugin/screen/model quirk,
- spend time debugging something non-obvious (an ordering dependency, a
  webview-header limitation, a serialization oddity),
- find a convention that's hinted at but not written down,

**append a short note in the right section above** (or add a new section).
Prefer concrete "do this / don't do that" lines over prose. One sentence is
fine; the goal is to save the next agent (or you) from rediscovering it.
Stale notes are worse than missing ones — if you change behavior, update the
note in the same change. Treat this file like code: keep it true.