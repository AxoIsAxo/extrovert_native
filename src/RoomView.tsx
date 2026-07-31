import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomDetail, RoomMessage, RoomChannel } from "./lib/invoke";
import { roomDetail, roomMessages, roomSendMessage } from "./lib/invoke";
import Avatar from "./Avatar";
import { e2eeSyncRoomSessions, e2eeEncryptRoomMessage, e2eeDecryptRoomMessage } from "./lib/e2ee";

export default function RoomView({
  id,
  onBack,
  myId,
  unlocked,
}: {
  id: string;
  onBack: () => void;
  myId: string;
  unlocked: boolean;
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [activeChannel, setActiveChannel] = useState<RoomChannel | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [e2eeReady, setE2eeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const decryptMessage = useCallback(
    async (m: RoomMessage): Promise<string> => {
      if (m.proto === "megolm" && m.ciphertext && m.group_session_id) {
        try {
          return await e2eeDecryptRoomMessage(id, m.user_id, m.ciphertext, m.group_session_id);
        } catch (e) {
          console.warn("megolm decrypt failed", m.id, e);
          return "[unable to decrypt]";
        }
      }
      return m.body;
    },
    [id]  // stable prop — never depend on `room` state here or the load effect loops
  );

  const applyPlaintext = useCallback((list: RoomMessage[]) => {
    setMessages(list);
    Promise.all(list.map((m) => decryptMessage(m))).then((plain) => {
      setMessages(list.map((m, i) => ({ ...m, body: plain[i] ?? m.body })));
    });
  }, [decryptMessage]);

  const loadedRoomId = useRef<string | null>(null);

  useEffect(() => {
    if (loadedRoomId.current === id) return;
    loadedRoomId.current = id;
    setLoading(true);
    roomDetail(id)
      .then(async (r) => {
        setRoom(r);
        const first = (r.channels.filter((ch) => ch.type !== "voice")[0] || r.channels[0]) || null;
        setActiveChannel(first);
        if (!first) return;
        if (unlocked) {
          try {
            await e2eeSyncRoomSessions(r.id, Number(myId), (r.members || []).map((m) => ({ id: m.id })));
            setE2eeReady(true);
          } catch (e) {
            setError(String(e));
          }
        }
        roomMessages(r.id, first.id).then((res) => {
          applyPlaintext(res.messages);
          setNextCursor(res.next);
        }).catch((e) => setError(String(e)));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id, unlocked, myId, applyPlaintext]);

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [messages]);

  async function switchChannel(ch: RoomChannel) {
    setActiveChannel(ch);
    try {
      const res = await roomMessages(room!.id, ch.id);
      applyPlaintext(res.messages);
      setNextCursor(res.next);
    } catch {}
  }

  async function handleSend() {
    if (!body.trim() || sending || !activeChannel || !e2eeReady) return;
    setSending(true);
    try {
      const enc = await e2eeEncryptRoomMessage(room!.id, body.trim());
      await roomSendMessage(room!.id, activeChannel.id, "", "megolm", enc.ciphertext, enc.group_session_id);
      setBody("");
      const res = await roomMessages(room!.id, activeChannel.id);
      applyPlaintext(res.messages);
      setNextCursor(res.next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    if (!nextCursor || !activeChannel) return;
    try {
      const res = await roomMessages(room!.id, activeChannel.id, nextCursor);
      setMessages((prev) => [...prev, ...res.messages]);
      setNextCursor(res.next);
    } catch {}
  }

  if (loading) return <div className="text-center text-on-surface-variant py-12">Loading…</div>;
  if (error) return <div className="text-error text-sm text-center py-4 px-4">{error}</div>;
  if (!room) return null;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant">
        <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface transition-colors text-sm">← Chats</button>
        <span className="font-semibold text-sm truncate">{room.name}</span>
        {!e2eeReady && <span className="ml-auto text-[10px] text-on-surface-variant italic">encryption off</span>}
      </div>

      {room.channels.length > 1 && (
        <div className="flex gap-1 px-4 py-2 border-b border-outline-variant overflow-x-auto">
          {room.channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => switchChannel(ch)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeChannel?.id === ch.id
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {ch.type === "voice" ? "🔊" : "#"} {ch.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {nextCursor && (
          <button onClick={loadOlder} className="w-full text-xs text-primary text-center py-2 hover:opacity-80">Load older</button>
        )}
        {messages.length === 0 && (
          <div className="text-center text-on-surface-variant py-8 text-sm">No messages yet.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2">
            <div className="shrink-0 mt-0.5">
              <Avatar src={m.avatar} name={m.display_name} size="sm" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{m.display_name}</span>
                <span className="text-on-surface-variant text-xs">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.edited_at ? " (edited)" : ""}
                </span>
              </div>
              <p className="text-sm text-on-surface whitespace-pre-wrap break-words mt-0.5">{m.body}</p>
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
          placeholder={e2eeReady ? `Message #${activeChannel?.name || "channel"}` : "Unlock encryption in settings…"}
          maxLength={5000}
          disabled={!e2eeReady}
          className="flex-1 bg-surface-container-low border border-outline-variant rounded-full px-4 py-2 text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!body.trim() || sending || !e2eeReady}
          className="px-4 py-2 rounded-full text-sm font-semibold text-on-primary disabled:opacity-50"
          style={{ background: !body.trim() || sending || !e2eeReady ? "var(--primary-dim)" : "var(--primary)" }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
