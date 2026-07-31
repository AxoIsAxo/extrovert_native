import { useEffect, useState } from "react";
import type { Status } from "./lib/invoke";
import { likePost, unlikePost, reblogPost, fetchMedia, postComments, createComment } from "./lib/invoke";
import Avatar from "./Avatar";

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
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!s.media_path) { setMediaUrl(null); return; }
    let cancelled = false;
    fetchMedia(s.media_path!)
      .then((url) => { if (!cancelled) setMediaUrl(url); })
      .catch(() => { if (!cancelled) setMediaUrl(null); });
    return () => { cancelled = true; };
  }, [s.media_path]);

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

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<{ id: string; body: string; created_at: number; account: { display_name: string; username: string; avatar: string | null } }[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSending, setCommentSending] = useState(false);

  async function openComments() {
    setCommentsOpen(true);
    if (comments) return;
    try {
      setComments(await postComments(s.id));
    } catch {
      setComments([]);
    }
  }

  async function handleComment() {
    if (!commentBody.trim() || commentSending) return;
    setCommentSending(true);
    try {
      const c = await createComment(s.id, commentBody.trim());
      setComments((prev) => [...(prev || []), c]);
      setCommentBody("");
      setS((prev) => ({ ...prev, comments_count: prev.comments_count + 1 }));
    } catch {}
    setCommentSending(false);
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors">
        <div className="flex gap-3">
          {s.account && (
            <button onClick={() => onNavigateProfile(s.account!.id)} className="shrink-0">
              <Avatar src={s.account.avatar} name={s.account.display_name} />
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
            {mediaUrl && (
              <img src={mediaUrl} alt="" className="mt-2 rounded-lg max-h-80 w-full object-cover" />
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
              <button onClick={openComments} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary transition-colors">
                <span>💬</span>
                {s.comments_count > 0 && <span>{s.comments_count}</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {commentsOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-40" onClick={() => setCommentsOpen(false)}>
          <div
            className="w-full max-w-md bg-surface border-t border-outline-variant rounded-t-2xl flex flex-col safe-bottom"
            style={{ height: "70dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
              <h3 className="font-semibold text-base text-on-surface">Comments</h3>
              <button onClick={() => setCommentsOpen(false)} className="text-on-surface-variant hover:text-on-surface text-lg">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
              {comments === null && <p className="text-on-surface-variant text-sm text-center py-6">Loading…</p>}
              {comments && comments.length === 0 && (
                <p className="text-on-surface-variant text-sm text-center py-6">No comments yet. Be the first!</p>
              )}
              {comments?.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar src={c.account.avatar} name={c.account.display_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-on-surface">{c.account.display_name}</span>
                      <span className="text-on-surface-variant text-xs">@{c.account.username}</span>
                      <span className="text-on-surface-variant text-xs ml-auto shrink-0">{timeAgo(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-on-surface whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-outline-variant shrink-0">
              <input
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleComment())}
                placeholder="Write a comment…"
                maxLength={1000}
                className="flex-1 bg-surface-container-low border border-outline-variant rounded-full px-4 py-2 text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary transition-colors"
              />
              <button
                onClick={handleComment}
                disabled={!commentBody.trim() || commentSending}
                className="px-4 py-2 rounded-full text-sm font-semibold text-on-primary disabled:opacity-50"
                style={{ background: !commentBody.trim() || commentSending ? "var(--primary-dim)" : "var(--primary)" }}
              >
                {commentSending ? "…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
