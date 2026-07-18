import type { Status, Paginated } from "./lib/invoke";
import { timelineHome } from "./lib/invoke";
import { useEffect, useRef, useState } from "react";
import PostCard from "./PostCard";

export default function Timeline({ onNavigateProfile, onCompose }: { onNavigateProfile: (id: string) => void; onCompose: () => void }) {
  const [data, setData] = useState<Paginated<Status>>({ data: [], pagination: { next: null } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingMore = useRef(false);

  async function load(dir: "init" | "next") {
    try {
      if (dir === "init") setLoading(true);
      else loadingMore.current = true;

      const cursor = dir === "next" ? data.pagination?.next : undefined;
      const res = await timelineHome(cursor ?? undefined);

      if (dir === "next") {
        setData((prev) => ({ data: [...prev.data, ...res.data], pagination: res.pagination }));
      } else {
        setData(res);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      loadingMore.current = false;
    }
  }

  useEffect(() => { load("init"); }, []);

  const hasMore = !!data.pagination?.next;

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      <div className="flex-1 overflow-y-auto">
        {loading && data.data.length === 0 && (
          <div className="text-center text-on-surface-variant py-12">Loading…</div>
        )}
        {error && (
          <div className="text-error text-sm text-center py-4 px-4">{error}</div>
        )}
        {!loading && data.data.length === 0 && !error && (
          <div className="text-center text-on-surface-variant py-12">No posts yet. Follow some people!</div>
        )}
        {data.data.map((status) => (
          <PostCard key={status.id} status={status} onNavigateProfile={onNavigateProfile} />
        ))}
        {hasMore && !loadingMore.current && (
          <button
            onClick={() => load("next")}
            className="w-full py-4 text-sm font-medium text-primary hover:opacity-80 transition-opacity"
          >
            Load more
          </button>
        )}
        {loadingMore.current && (
          <div className="text-center text-on-surface-variant py-4 text-sm">Loading more…</div>
        )}
      </div>
      <button
        onClick={onCompose}
        className="absolute bottom-4 right-4 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-on-primary shadow-lg hover:opacity-90 transition-opacity"
        style={{ background: "var(--primary)" }}
      >
        +
      </button>
    </div>
  );
}
