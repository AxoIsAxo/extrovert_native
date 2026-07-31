import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectMessage, Paginated } from "./lib/invoke";
import { conversationMessages, conversationSend, fetchMedia } from "./lib/invoke";
import { Call } from "./lib/webrtc";
import { e2eeDecryptDm, e2eeDecryptLegacyDm, e2eeEncryptDm, e2eeFetchBundle, e2eeSafetyNumber } from "./lib/e2ee";

interface LiveDmEvent {
  type: string;
  message: DirectMessage;
  sender_curve: string | null;
  from_username: string;
  from_display: string;
}

export default function ChatView({ username, otherId, onBack, myId }: { username: string; otherId: string; onBack: () => void; myId: string }) {
  const [data, setData] = useState<Paginated<DirectMessage>>({ data: [], pagination: { next: null } });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [stickers, setStickers] = useState<Record<string, string>>({});
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const otherCurveRef = useRef<string>("");

  // Decrypt one message (olm via the shared bridge, legacy rsa via the same
  // bridge; stickers pass through as media paths).
  const decryptMessage = useCallback(
    async (m: DirectMessage): Promise<string> => {
      if (m.body.startsWith("/uploads/stickers/")) return m.body;
      const proto = m.proto || "rsa";
      if (proto === "olm") {
        const isOwn = String(m.from_id) === myId;
        try {
          if (!otherCurveRef.current) {
            const b = await e2eeFetchBundle(username);
            otherCurveRef.current = b.identity_key || "";
          }
          return await e2eeDecryptDm(
            { body: m.body, sender_ciphertext: m.sender_ciphertext || "" },
            isOwn,
            String(m.from_id === myId ? m.to_id : m.from_id),
            otherCurveRef.current
          );
        } catch (e) {
          console.warn("olm decrypt failed", m.id, e);
          return "[unable to decrypt]";
        }
      }
      const key = String(m.from_id) === myId ? m.key_for_sender : m.key_for_recipient;
      if (m.body && key) {
        try {
          return await e2eeDecryptLegacyDm(m.body, key);
        } catch (e) {
          console.warn("legacy decrypt failed", m.id, e);
        }
      }
      return m.body;
    },
    [myId, username]
  );

  const loadMessages = useCallback(() => {
    setLoading(true);
    conversationMessages(username)
      .then((res) => {
        setData(res);
        Promise.all(res.data.map((m) => decryptMessage(m))).then((plain) => {
          setData((prev) => ({
            ...prev,
            data: prev.data.map((m, i) => ({ ...m, body: plain[i] ?? m.body })),
          }));
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [username, decryptMessage]);

  useEffect(() => {
    otherCurveRef.current = "";
    loadMessages();

    const onDone = () => setIsCalling(false);
    Call.on("call_connected", onDone);
    Call.on("call_ended", onDone);
    Call.on("call_declined", onDone);
    Call.on("call_unanswered", onDone);

    // Live incoming DMs over the signaling socket (same WS as calls).
    const onLiveDm = (ev: LiveDmEvent) => {
      if (ev.from_username !== username) return;
      decryptMessage(ev.message).then((plain) => {
        const msg = { ...ev.message, body: plain };
        setData((prev) => {
          if (prev.data.some((m) => String(m.id) === String(msg.id))) return prev;
          return { ...prev, data: [...prev.data, msg] };
        });
      });
    };
    Call.on("new_dm", onLiveDm as never);

    return () => {
      Call.off("call_connected", onDone);
      Call.off("call_ended", onDone);
      Call.off("call_declined", onDone);
      Call.off("call_unanswered", onDone);
      Call.off("new_dm", onLiveDm as never);
    };
  }, [username, loadMessages, decryptMessage]);

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [data.data]);

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const enc = await e2eeEncryptDm(body.trim(), otherId, username);
      const msg = await conversationSend(username, "", "olm", enc.recipientCipher, enc.senderCipher);
      const plain = await decryptMessage(msg);
      setBody("");
      setData((prev) => ({ ...prev, data: [...prev.data, { ...msg, body: plain }] }));
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
      const plain = await Promise.all(older.data.map((m) => decryptMessage(m)));
      setData((prev) => ({
        data: [...older.data.map((m, i) => ({ ...m, body: plain[i] ?? m.body })), ...prev.data],
        pagination: older.pagination,
      }));
    } catch {}
  }

  function isOwn(m: DirectMessage) {
    return String(m.from_id) === myId;
  }

  // Sticker image: fetch through Rust (bearer token) and render a data URL.
  function StickerImage({ path }: { path: string }) {
    const [src, setSrc] = useState<string | null>(stickers[path] || null);
    useEffect(() => {
      if (src) return;
      fetchMedia(path).then((d) => {
        setSrc(d);
        setStickers((prev) => ({ ...prev, [path]: d }));
      }).catch(() => {});
    }, [path, src]);
    if (!src) return <div className="text-on-surface-variant text-xs italic">Sticker…</div>;
    return <img src={src} alt="sticker" className="max-w-[160px] max-h-[160px] object-contain" />;
  }

  async function showSafetyDialog() {
    if (safetyNumber) { setShowSafety(true); return; }
    setSafetyError(null);
    try {
      const num = await e2eeSafetyNumber(username);
      setSafetyNumber(num);
      setShowSafety(true);
    } catch (e) {
      setSafetyError(String(e));
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant">
        <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface transition-colors text-sm">← Back</button>
        <span className="font-semibold text-sm flex-1">@{username}</span>
        <button
          onClick={showSafetyDialog}
          className="px-2 py-1 rounded-full text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          title="Safety number"
        >
          🔒
        </button>
        <button
          onClick={() => { setIsCalling(true); Call.startCall(username); }}
          disabled={isCalling}
          className="px-2 py-1 rounded-full text-xs font-medium text-on-primary disabled:opacity-50 transition-opacity"
          style={{ background: "var(--primary)" }}
        >
          {isCalling ? "..." : "Call"}
        </button>
      </div>

      {showSafety && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-40" onClick={() => setShowSafety(false)}>
          <div
            className="w-full max-w-md bg-surface border-t border-outline-variant rounded-t-2xl p-6 pb-8 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base text-on-surface">Safety number</h3>
              <button onClick={() => setShowSafety(false)} className="text-on-surface-variant hover:text-on-surface text-lg">✕</button>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">
              Compare this number with @{username} in person or over a trusted channel. If it matches, your messages are truly end-to-end encrypted.
            </p>
            {safetyError ? (
              <p className="text-error text-sm">{safetyError}</p>
            ) : safetyNumber ? (
              <p className="font-mono text-xl tracking-widest text-center text-on-surface bg-surface-container-high rounded-btn px-4 py-4 break-all">
                {safetyNumber.replace(/(.{4})/g, "$1 ").trim()}
              </p>
            ) : (
              <p className="text-on-surface-variant text-sm text-center">Loading…</p>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && <div className="text-center text-on-surface-variant py-8 text-sm">Loading…</div>}
        {error && <div className="text-error text-sm text-center py-2">{error}</div>}

        {data.pagination?.next && (
          <button onClick={loadOlder} className="w-full text-xs text-primary text-center py-2 hover:opacity-80">Load older</button>
        )}

        {data.data.map((m) => (
          <div key={m.id} className={`flex ${isOwn(m) ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                isOwn(m)
                  ? "bg-primary text-on-primary rounded-br-sm"
                  : "bg-surface-container-high text-on-surface rounded-bl-sm"
              }`}
            >
              {m.body.startsWith("/uploads/stickers/") ? (
                <StickerImage path={m.body} />
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              <p className={`text-[10px] mt-1 ${isOwn(m) ? "text-on-primary/60" : "text-on-surface-variant"}`}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.edited_at ? " · edited" : ""}
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
