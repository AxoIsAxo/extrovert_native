import { useEffect, useState } from "react";
import type { RoomSummary } from "./lib/invoke";
import { roomsList } from "./lib/invoke";

export default function RoomList({ onSelect }: { onSelect: (id: string) => void }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    roomsList()
      .then(setRooms)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-on-surface-variant py-12">Loading…</div>;
  if (error) return <div className="text-error text-sm text-center py-4 px-4">{error}</div>;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <div className="text-center text-on-surface-variant py-12 text-sm px-4">No rooms yet.</div>
        )}
        {rooms.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-outline-variant hover:bg-surface-container-low transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-sm font-bold text-on-surface-variant shrink-0">
              {r.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{r.name}</span>
                {r.is_public && <span className="text-[10px] text-primary font-medium">public</span>}
              </div>
              <p className="text-on-surface-variant text-sm truncate mt-0.5">{r.description}</p>
              <span className="text-on-surface-variant text-xs">{r.member_count} members</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
