import { useEffect, useState } from "react";
import type { Conversation, RoomSummary } from "./lib/invoke";
import { conversationsList, roomsList } from "./lib/invoke";
import Avatar from "./Avatar";
import { e2eeDecryptDm, e2eeDecryptLegacyDm } from "./lib/e2ee";

export type ChatEntry =
  | { kind: "dm"; c: Conversation }
  | { kind: "room"; r: RoomSummary };

export default function ChatList({
  onSelect,
  myId,
  unlocked,
}: {
  onSelect: (e: ChatEntry) => void;
  myId: string;
  unlocked: boolean;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([conversationsList().catch(() => [] as Conversation[]), roomsList().catch(() => [] as RoomSummary[])])
      .then(([convs, rooms]) => {
        const dms: ChatEntry[] = convs
          .slice()
          .sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0))
          .map((c) => ({ kind: "dm", c }));
        const rms: ChatEntry[] = rooms
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => ({ kind: "room", r }));
        setEntries([...dms, ...rms]);
        return convs;
      })
      .then(decryptPreviews)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [unlocked, myId]);

  // Decrypt last-message previews client-side (same logic as the web /chats).
  function decryptPreviews(convs: Conversation[]) {
    if (!unlocked) return;
    convs.forEach((c) => {
      const lm = c.last_message;
      if (!lm) return;
      if (lm.startsWith("/uploads/stickers/")) {
        setPreviews((prev) => ({ ...prev, [c.id]: "Sticker" }));
        return;
      }
      const isOwn = String(c.last_from) === myId;
      const p =
        c.last_proto === "olm"
          ? e2eeDecryptDm(
              { body: lm, sender_ciphertext: c.last_sender_ciphertext || "" },
              isOwn,
              c.id,
              c.sender_curve || ""
            ).catch(() => "…")
          : (isOwn ? c.last_key_for_sender : c.last_key_for_recipient)
              ? e2eeDecryptLegacyDm(lm, (isOwn ? c.last_key_for_sender : c.last_key_for_recipient)!).catch(() => "…")
              : Promise.resolve("…");
      p.then((plain) => setPreviews((prev) => ({ ...prev, [c.id]: plain }))).catch(() => {});
    });
  }

  if (loading) return <div className="text-center text-on-surface-variant py-12">Loading…</div>;
  if (error) return <div className="text-error text-sm text-center py-4 px-4">{error}</div>;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="text-center text-on-surface-variant py-12 text-sm px-4">
            No chats yet. Follow someone to start messaging, or join a room.
          </div>
        )}
        {entries.map((e) =>
          e.kind === "dm" ? (
            <button
              key={`dm-${e.c.id}`}
              onClick={() => onSelect(e)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors text-left"
            >
              <Avatar src={e.c.avatar} name={e.c.display_name} size="w-12 h-12 text-sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{e.c.display_name}</span>
                  <span className="text-on-surface-variant text-xs truncate">@{e.c.username}</span>
                  {e.c.unread > 0 && (
                    <span className="ml-auto bg-primary text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">{e.c.unread}</span>
                  )}
                </div>
                {previews[e.c.id] && (
                  <p className="text-on-surface-variant text-sm truncate mt-0.5">{previews[e.c.id]}</p>
                )}
              </div>
            </button>
          ) : (
            <button
              key={`room-${e.r.id}`}
              onClick={() => onSelect(e)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors text-left"
            >
              <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-sm font-bold text-on-surface-variant shrink-0">
                {e.r.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{e.r.name}</span>
                  <span className="text-[10px] text-on-surface-variant font-medium">👥 {e.r.member_count}</span>
                  {e.r.is_public && <span className="text-[10px] text-primary font-medium">public</span>}
                </div>
                {e.r.description ? (
                  <p className="text-on-surface-variant text-sm truncate mt-0.5">{e.r.description}</p>
                ) : (
                  <p className="text-on-surface-variant/70 text-xs truncate mt-0.5 italic">Room</p>
                )}
              </div>
            </button>
          )
        )}
      </div>
    </div>
  );
}
