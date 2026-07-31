import { useCallback, useEffect, useState } from "react";
import type { Notification } from "./lib/invoke";
import { getNotifications, clearNotifications } from "./lib/invoke";
import Avatar from "./Avatar";

const TYPE_LABEL: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "followed you",
  message: "sent you a message",
  mention: "mentioned you",
  repost: "reposted your post",
  missed_call: "missed your call",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return new Date(ts).toLocaleDateString();
}

export default function NotificationsScreen({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getNotifications();
      setItems(res.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleClear() {
    try {
      await clearNotifications();
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {}
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant">
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors text-sm">← Back</button>
        <span className="font-semibold text-sm flex-1">Notifications</span>
        <button onClick={handleClear} className="text-xs text-primary hover:opacity-80">Mark all read</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center text-on-surface-variant py-12 text-sm">Loading…</div>}
        {error && <div className="text-error text-sm text-center py-4 px-4">{error}</div>}
        {!loading && items.length === 0 && (
          <div className="text-center text-on-surface-variant py-12 text-sm px-4">No notifications yet.</div>
        )}
        {items.map((n) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 border-b border-outline-variant ${n.read ? "" : "bg-surface-container-low"}`}>
            <Avatar src={n.account.avatar} name={n.account.display_name} size="w-10 h-10 text-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-on-surface whitespace-pre-wrap break-words">
                <span className="font-semibold">{n.account.display_name}</span>{" "}
                <span className="text-on-surface-variant">{TYPE_LABEL[n.type] || n.type}</span>
              </p>
              <p className="text-on-surface-variant text-xs mt-0.5">@{n.account.username} · {timeAgo(n.created_at)}</p>
            </div>
            {!n.read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--primary)" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
