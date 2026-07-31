import { useState } from "react";
import { e2eeUnlock } from "./lib/e2ee";

export default function UnlockScreen({
  username,
  onUnlocked,
  onRetry,
}: {
  username: string;
  onUnlocked: () => void;
  onRetry: () => void;
}) {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    if (!password.trim() || unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      await e2eeUnlock(password.trim(), username);
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-6 safe-top safe-bottom">
      <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-3xl">
        🔒
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-on-surface">Unlock encryption</h2>
        <p className="text-on-surface-variant text-sm max-w-xs mx-auto">
          Enter your login password to decrypt your private keys and enable secure chats and rooms.
        </p>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
        placeholder="Password"
        autoFocus
        className="w-full max-w-sm bg-surface-container-low border border-outline-variant rounded-btn px-5 py-4 text-base text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary"
      />
      {error && <div className="text-error text-sm text-center">{error}</div>}
      <button
        onClick={handleUnlock}
        disabled={!password.trim() || unlocking}
        className="w-full max-w-sm px-6 py-4 rounded-btn text-base font-semibold text-on-primary disabled:opacity-50 transition-opacity"
        style={{ background: "var(--primary)" }}
      >
        {unlocking ? "Unlocking…" : "Unlock"}
      </button>
      <button onClick={onRetry} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">
        Retry automatic setup
      </button>
    </div>
  );
}
