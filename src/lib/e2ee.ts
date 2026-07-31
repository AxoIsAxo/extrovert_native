// Bridge to the web app's battle-tested Olm/Megolm crypto (window.ExtrovertE2EE),
// vendored into this app and configured with the user's OAuth bearer token.
// The webview owns crypto state (IndexedDB); Rust keeps OAuth/token refresh and
// all API calls. Business logic stays in Rust; this is purely the crypto hop.

import { invoke } from "@tauri-apps/api/core";
import { getAccessToken } from "./invoke";

export interface E2eeBundle {
  identity_key: string | null;
  ed25519_key: string | null;
  one_time_key: { id: string; public_key: string } | null;
  fallback_key: string | null;
}

interface E2eeMsg {
  body: string;
  sender_ciphertext?: string;
}

declare global {
  interface Window {
    ExtrovertE2EEConfig?: {
      apiBase: string;
      olmWasmUrl: string;
      bearerToken: string;
    };
    ExtrovertE2EE?: {
      ensureReady(opts: { onNeedsPassword?: () => void }): Promise<boolean>;
      initOlm(): Promise<void>;
      unlock(password: string, username: string): Promise<string>;
      encryptDm(
        plaintext: string,
        otherId: string,
        otherIdStr: string,
        otherUsername: string
      ): Promise<{ recipientCipher: string; senderCipher: string }>;
      decryptDm(msg: E2eeMsg, isOwn: boolean, otherIdStr: string, theirCurve25519: string): Promise<string>;
      decryptLegacyDm(bodyB64: string, keyB64: string): Promise<string>;
      replenishPrekeys(): Promise<void>;
      fetchRecipientBundle(username: string): Promise<E2eeBundle>;
      syncRoomSessions(roomId: string, myId: number, members: { id: number | string }[]): Promise<void>;
      encryptRoomMessage(roomId: string, plaintext: string): Promise<{ ciphertext: string; group_session_id: string }>;
      decryptRoomMessage(roomId: string, senderId: string, ciphertext: string, groupSessionId: string): Promise<string>;
      ready(): boolean;
      myEd25519(): string | null;
    };
  }
}

function api(): NonNullable<Window["ExtrovertE2EE"]> {
  if (!window.ExtrovertE2EE) throw new Error("E2EE bridge not loaded");
  return window.ExtrovertE2EE;
}

function cfg(): NonNullable<Window["ExtrovertE2EEConfig"]> {
  if (!window.ExtrovertE2EEConfig) throw new Error("E2EE bridge config missing");
  return window.ExtrovertE2EEConfig;
}

// File-backed crypto storage (Rust fs) — Android WebView IndexedDB isn't
// reliably persisted, so without this the app would re-prompt for the
// password on every start.
function wireFileStorage(): void {
  if ((window as unknown as { ExtrovertE2EEStorage?: unknown }).ExtrovertE2EEStorage) return;
  (window as unknown as { ExtrovertE2EEStorage: unknown }).ExtrovertE2EEStorage = {
    get: (key: string) => invoke<string | null>("e2ee_store_get", { key }),
    set: (key: string, value: string) => invoke<void>("e2ee_store_set", { key, value }),
  };
}
wireFileStorage();

async function setBearer(): Promise<void> {
  cfg().bearerToken = await getAccessToken();
}

function isAuthError(e: unknown): boolean {
  const s = String(e);
  return /unauthorized|401/i.test(s);
}

// Runs a bridge op with a fresh bearer token, retrying once after a forced
// refresh if the server rejected the token (webview fetches can't refresh).
async function withFreshToken<T>(op: () => Promise<T>): Promise<T> {
  await setBearer();
  try {
    return await op();
  } catch (e) {
    if (!isAuthError(e)) throw e;
    const token = await invoke<string>("e2ee_refresh_token");
    cfg().bearerToken = token;
    return op();
  }
}

/** True if the webview's Olm account is usable without a password. */
export function isUnlocked(): boolean {
  try {
    return api().ready();
  } catch {
    return false;
  }
}

/**
 * Silent key setup after login. Resolves true when the app can do crypto
 * immediately (existing device key). Resolves false when the account backup
 * needs the login password → show the unlock screen and call e2eeUnlock().
 * Must init Olm first — the web app always does initOlm().then(ensureReady);
 * without it, Olm.Account isn't constructed yet and ensureReady throws, which
 * used to force the password screen on every restart.
 */
export async function e2eeEnsureReady(): Promise<boolean> {
  return withFreshToken(async () => {
    await api().initOlm();
    return api().ensureReady({ onNeedsPassword: () => {} });
  });
}

export async function e2eeUnlock(password: string, username: string): Promise<void> {
  await withFreshToken(() => api().unlock(password, username).then(() => undefined));
}

export async function e2eeEncryptDm(
  plaintext: string,
  otherId: string,
  otherUsername: string
): Promise<{ recipientCipher: string; senderCipher: string }> {
  return withFreshToken(() => api().encryptDm(plaintext, otherId, otherId, otherUsername));
}

export async function e2eeDecryptDm(
  msg: E2eeMsg,
  isOwn: boolean,
  otherIdStr: string,
  theirCurve25519: string
): Promise<string> {
  return withFreshToken(() => api().decryptDm(msg, isOwn, otherIdStr, theirCurve25519));
}

export async function e2eeDecryptLegacyDm(bodyB64: string, keyB64: string): Promise<string> {
  return withFreshToken(() => api().decryptLegacyDm(bodyB64, keyB64));
}

/** Fetch a recipient's Olm bundle (also claims a one-time prekey). */
export async function e2eeFetchBundle(username: string): Promise<E2eeBundle> {
  return withFreshToken(() => api().fetchRecipientBundle(username));
}

export async function e2eeSyncRoomSessions(roomId: string, myId: number, members: { id: number | string }[]): Promise<void> {
  await withFreshToken(async () => {
    await api().initOlm();
    await api().syncRoomSessions(roomId, myId, members).then(() => undefined);
  });
}

export async function e2eeEncryptRoomMessage(
  roomId: string,
  plaintext: string
): Promise<{ ciphertext: string; group_session_id: string }> {
  return withFreshToken(() => api().encryptRoomMessage(roomId, plaintext));
}

export async function e2eeDecryptRoomMessage(
  roomId: string,
  senderId: string,
  ciphertext: string,
  groupSessionId: string
): Promise<string> {
  return withFreshToken(() => api().decryptRoomMessage(roomId, senderId, ciphertext, groupSessionId));
}

/** 12-digit safety number for a DM partner (same derivation as the web app). */
export async function e2eeSafetyNumber(username: string): Promise<string | null> {
  const bundle = await e2eeFetchBundle(username);
  const my = api().myEd25519();
  const their = bundle.ed25519_key;
  if (!my || !their) return null;
  const sorted = [my, their].sort().join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted));
  let digits = "";
  new Uint8Array(digest).forEach((b) => { digits += String(b % 10); });
  return digits.slice(0, 12);
}
