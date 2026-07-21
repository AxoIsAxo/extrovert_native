import { useEffect, useRef, useState } from "react";
import type { DirectMessage, Paginated } from "./lib/invoke";
import { conversationMessages, conversationSend, e2eeUnlock, e2eeStatus } from "./lib/invoke";
import { Call } from "./lib/webrtc";

export default function ChatView({ username, onBack }: { username: string; onBack: () => void }) {
  const [data, setData] = useState<Paginated<DirectMessage>>({ data: [], pagination: { next: null } });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [e2eeReady, setE2eeReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    e2eeStatus().then((ready) => {
      if (ready) {
        setE2eeReady(true);
        loadMessages();
      } else {
        setE2eeReady(false);
        setLoading(false);
      }
    });

    const onDone = () => setIsCalling(false);
    Call.on("call_connected", onDone);
    Call.on("call_ended", onDone);
    Call.on("call_declined", onDone);
    Call.on("call_unanswered", onDone);
    return () => {
      Call.off("call_connected", onDone);
      Call.off("call_ended", onDone);
      Call.off("call_declined", onDone);
      Call.off("call_unanswered", onDone);
    };
  }, [username]);

  function loadMessages() {
    setLoading(true);
    conversationMessages(username)
      .then((res) => setData(res))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [data.data]);

  async function handleUnlock() {
    if (!password.trim() || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await e2eeUnlock(password.trim());
      setE2eeReady(true);
      loadMessages();
    } catch (e) {
      setUnlockError(String(e));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const msg = await conversationSend(username, body.trim());
      setBody("");
      setData((prev) => ({ ...prev, data: [...prev.data, msg] }));
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    if (!data.pagination?.next) return;
    try {
      const older = await conversationMessages(username, data.pagination.next);
      setData((prev) => ({ data: [...older.data, ...prev.data], pagination: older.pagination }));
    } catch {}
  }

  if (e2eeReady === false) {
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant">
          <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface transition-colors text-sm">← Back</button>
          <span className="font-semibold text-sm">@{username}</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-surface-container-high flex items-center justify-center text-lg">🔒</div>
            <h3 className="font-semibold text-on-surface">Unlock End-to-End Encryption</h3>
            <p className="text-sm text-on-surface-variant">Enter your password to decrypt your private key and enable secure messaging.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Password"
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary"
            />
            {unlockError && <div className="text-error text-sm">{unlockError}</div>}
            <button
              onClick={handleUnlock}
              disabled={!password.trim() || unlocking}
              className="w-full px-6 py-2.5 rounded-btn text-sm font-semibold text-on-primary disabled:opacity-50 transition-opacity"
              style={{ background: "var(--primary)" }}
            >
              {unlocking ? "Unlocking…" : "Unlock"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant">
        <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface transition-colors text-sm">← Back</button>
        <span className="font-semibold text-sm flex-1">@{username}</span>
        <button
          onClick={() => { setIsCalling(true); Call.startCall(username); }}
          disabled={isCalling}
          className="px-2 py-1 rounded-full text-xs font-medium text-on-primary disabled:opacity-50 transition-opacity"
          style={{ background: "var(--primary)" }}
        >
          {isCalling ? "..." : "Call"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && <div className="text-center text-on-surface-variant py-8 text-sm">Loading…</div>}
        {error && <div className="text-error text-sm text-center py-2">{error}</div>}

        {data.pagination?.next && (
          <button onClick={loadOlder} className="w-full text-xs text-primary text-center py-2 hover:opacity-80">Load older</button>
        )}

        {data.data.map((m) => (
          <div key={m.id} className={`flex ${m.from_id === "me" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                m.from_id === "me"
                  ? "bg-primary text-on-primary rounded-br-sm"
                  : "bg-surface-container-high text-on-surface rounded-bl-sm"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`text-[10px] mt-1 ${m.from_id === "me" ? "text-on-primary/60" : "text-on-surface-variant"}`}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-outline-variant">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder="Message…"
          maxLength={5000}
          className="flex-1 bg-surface-container-low border border-outline-variant rounded-full px-4 py-2 text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="px-4 py-2 rounded-full text-sm font-semibold text-on-primary disabled:opacity-50"
          style={{ background: !body.trim() || sending ? "var(--primary-dim)" : "var(--primary)" }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
