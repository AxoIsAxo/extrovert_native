import { useState } from "react";
import type { Status } from "./lib/invoke";
import { likePost, unlikePost, reblogPost } from "./lib/invoke";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ts).toLocaleDateString();
}

export default function PostCard({
  status,
  onNavigateProfile,
}: {
  status: Status;
  onNavigateProfile: (id: string) => void;
}) {
  const [s, setS] = useState(status);

  async function toggleLike() {
    try {
      const updated = s.liked ? await unlikePost(s.id) : await likePost(s.id);
      setS(updated);
    } catch {}
  }

  async function handleReblog() {
    try {
      const updated = await reblogPost(s.id);
      setS(updated);
    } catch {}
  }

  return (
    <div className="px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors">
      <div className="flex gap-3">
        {s.account && (
          <button onClick={() => onNavigateProfile(s.account!.id)} className="shrink-0">
            {s.account.avatar ? (
              <img src={s.account.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-sm font-semibold text-on-surface-variant">
                {s.account.display_name.charAt(0).toUpperCase()}
              </div>
            )}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {s.account && (
              <button
                onClick={() => onNavigateProfile(s.account!.id)}
                className="font-semibold text-sm text-on-surface truncate hover:underline"
              >
                {s.account.display_name}
              </button>
            )}
            {s.account && (
              <span className="text-on-surface-variant text-sm truncate">@{s.account.username}</span>
            )}
            <span className="text-on-surface-variant text-sm ml-auto shrink-0">{timeAgo(s.created_at)}</span>
          </div>
          {s.type === "repost" && (
            <div className="text-xs text-primary font-medium mb-1">Reposted</div>
          )}
          <p className="text-sm text-on-surface whitespace-pre-wrap break-words">{s.body}</p>
          {s.media_path && (
            <img src={s.media_path} alt="" className="mt-2 rounded-lg max-h-80 w-full object-cover" />
          )}
          <div className="flex gap-6 mt-2">
            <button onClick={toggleLike} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-red-500 transition-colors">
              <span>{s.liked ? "♥" : "♡"}</span>
              {s.likes_count > 0 && <span>{s.likes_count}</span>}
            </button>
            <button onClick={handleReblog} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-green-500 transition-colors">
              <span>{s.shared ? "♺" : "♻"}</span>
              {s.shares_count > 0 && <span>{s.shares_count}</span>}
            </button>
            <span className="flex items-center gap-1 text-sm text-on-surface-variant">
              <span>💬</span>
              {s.comments_count > 0 && <span>{s.comments_count}</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
