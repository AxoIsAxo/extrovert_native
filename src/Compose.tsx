import { useState } from "react";
import { createPost } from "./lib/invoke";
import type { Status } from "./lib/invoke";

export default function Compose({ onCreated, onCancel }: { onCreated: (s: Status) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const status = await createPost(body.trim());
      setBody("");
      onCreated(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
        <button onClick={onCancel} className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <span className="font-semibold text-sm">New Post</span>
        <button
          onClick={handleSubmit}
          disabled={!body.trim() || sending}
          className="px-4 py-1.5 rounded-btn text-sm font-semibold text-on-primary disabled:opacity-50 transition-opacity"
          style={{ background: !body.trim() || sending ? "var(--primary-dim)" : "var(--primary)" }}
        >
          {sending ? "Posting…" : "Post"}
        </button>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's on your mind?"
          maxLength={5000}
          className="w-full h-32 resize-none bg-surface-container-low border border-outline-variant rounded-lg p-3 text-sm text-on-surface placeholder-on-surface-variant focus:outline-none focus:border-primary transition-colors"
        />
        <div className="text-right text-xs text-on-surface-variant mt-1">{body.length}/5000</div>
        {error && <div className="text-error text-sm mt-2">{error}</div>}
      </div>
    </div>
  );
}
