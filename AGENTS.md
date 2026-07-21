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

- Private key wrapped with a KEK derived from the **user's login password** via
  PBKDF2 (native app has no password — the user enters it to unlock, see
  `e2ee_unlock`). State cached in `E2eeContext` (in-memory) after unlock.
- Send: fetch recipient's public key, hybrid-encrypt (RSA-OAEP for the AES key),
  store `key_for_sender` and `key_for_recipient` per message.
- Receive: pick the matching key half based on `msg.from_id == user_id`. Don't
  render encrypted ciphertext as a message body — decrypt first, fall back to
  ciphertext only if decryption fails.

## Tauri plugins in use

`shell` (open URLs), `deep-link` (OAuth callback), `dialog`, `fs`,
`single-instance` (deep-link delivery). Adding a plugin: add to `Cargo.toml`,
register in `lib.rs` (order matters — single-instance **first**, before
deep-link), and if it has JS API add to `package.json` + `invoke.ts`-style
wrapper where relevant. Config under `tauri.conf.json > plugins`. CSP is strict
in `tauri.conf.json > app.security.csp` — adding new connect/img origins means
updating the CSP `connect-src`/`img-src` there too.

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
  `org.gradle.jvmargs=-Xmx2048m`, which the Codeberg medium runner's container
  OOM-kills instantly.  Use `sed` to replace that line (don't `cat >>`, which
  creates duplicate keys and the JVM may use the first value).  We set
  `-Xmx512m` (no metaspace/codecache limits — buildSrc compilation needs
  >128 MiB metaspace) and use `kotlin.compiler.execution.strategy=daemon` so
  the Kotlin compiler gets its own JVM (`kotlin.daemon.jvmargs=-Xmx256m` with
  tight metaspace/codecache limits).  `GRADLE_OPTS` / `KOTLIN_DAEMON_JVM_OPTIONS`
  env are removed — they set `-Dorg.gradle.jvmargs=...` as JVM system properties,
  which don't affect daemon heap.  Keep in sync if re-added.

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