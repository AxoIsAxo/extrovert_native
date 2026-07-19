import { useEffect, useState } from "react";
import type { Account, Status, Paginated } from "./lib/invoke";
import { userProfile, userStatuses, followUser, unfollowUser } from "./lib/invoke";
import PostCard from "./PostCard";
import Avatar from "./Avatar";

export default function Profile({ id, onBack, onNavigateProfile }: { id: string; onBack: () => void; onNavigateProfile: (id: string) => void }) {
  const [profile, setProfile] = useState<Account | null>(null);
  const [posts, setPosts] = useState<Paginated<Status>>({ data: [], pagination: { next: null } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      userProfile(id),
      userStatuses(id),
    ])
      .then(([prof, stat]) => {
        setProfile(prof);
        setPosts(stat);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  async function toggleFollow() {
    if (!profile) return;
    try {
      const updated = profile.is_following ? await unfollowUser(id) : await followUser(id);
      setProfile(updated);
    } catch {}
  }

  if (loading) return <div className="text-center text-on-surface-variant py-12">Loading…</div>;
  if (error) return <div className="text-error text-sm text-center py-4">{error}</div>;
  if (!profile) return null;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-outline-variant">
          <button onClick={onBack} className="text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-2 block">
            ← Back
          </button>
          <div className="flex items-center gap-4">
            <Avatar src={profile.avatar} name={profile.display_name} size="w-16 h-16 text-xl" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{profile.display_name}</h2>
              <p className="text-on-surface-variant text-sm">@{profile.username}</p>
            </div>
            {!profile.is_self && (
              <button
                onClick={toggleFollow}
                className="px-4 py-1.5 rounded-btn text-sm font-semibold transition-colors"
                style={{
                  background: profile.is_following ? "var(--surface-container-high)" : "var(--primary)",
                  color: profile.is_following ? "var(--on-surface)" : "var(--on-primary)",
                }}
              >
                {profile.is_following ? "Following" : "Follow"}
              </button>
            )}
          </div>
          {profile.bio && <p className="mt-3 text-sm text-on-surface">{profile.bio}</p>}
          <div className="flex gap-4 mt-3 text-sm text-on-surface-variant">
            <span><strong className="text-on-surface">{profile.statuses_count}</strong> posts</span>
            <span><strong className="text-on-surface">{profile.followers_count}</strong> followers</span>
            <span><strong className="text-on-surface">{profile.following_count}</strong> following</span>
          </div>
        </div>

        {posts.data.length === 0 && (
          <div className="text-center text-on-surface-variant py-12 text-sm">No posts yet.</div>
        )}
        {posts.data.map((status) => (
          <PostCard key={status.id} status={status} onNavigateProfile={onNavigateProfile} />
        ))}
        {posts.pagination?.next && (
          <button
            onClick={async () => {
              try {
                const more = await userStatuses(id, posts.pagination?.next ?? undefined);
                setPosts((prev) => ({ data: [...prev.data, ...more.data], pagination: more.pagination }));
              } catch {}
            }}
            className="w-full py-4 text-sm font-medium text-primary hover:opacity-80"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
