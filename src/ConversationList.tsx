import { useEffect, useState } from "react";
import type { Conversation } from "./lib/invoke";
import { conversationsList } from "./lib/invoke";
import Avatar from "./Avatar";

export default function ConversationList({ onSelect }: { onSelect: (username: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    conversationsList()
      .then(setConversations)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-on-surface-variant py-12">Loading…</div>;
  if (error) return <div className="text-error text-sm text-center py-4 px-4">{error}</div>;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="text-center text-on-surface-variant py-12 text-sm px-4">No conversations yet. Follow someone to start messaging.</div>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.username)}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors text-left"
          >
            <Avatar src={c.avatar} name={c.display_name} size="w-12 h-12 text-sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{c.display_name}</span>
                <span className="text-on-surface-variant text-xs">@{c.username}</span>
                {c.unread > 0 && (
                  <span className="ml-auto bg-primary text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">{c.unread}</span>
                )}
              </div>
              {c.last_message && (
                <p className="text-on-surface-variant text-sm truncate mt-0.5">{c.last_message}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
