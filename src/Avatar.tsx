import { useEffect, useState } from "react";
import { fetchAvatar } from "./lib/invoke";

export default function Avatar({ src, name, size = "md" }: { src: string | null | undefined; name: string; size?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : size === "md" ? "w-10 h-10 text-sm" : size === "lg" ? "w-16 h-16 text-base" : size;

  useEffect(() => {
    if (!src) { setDataUrl(null); return; }
    setFailed(false);
    fetchAvatar(src).then(setDataUrl).catch(() => setFailed(true));
  }, [src]);

  if (dataUrl && !failed) {
    return <img src={dataUrl} alt="" className={`${sizeClass} rounded-full object-cover shrink-0`} onError={() => setFailed(true)} />;
  }

  return (
    <div className={`${sizeClass} rounded-full bg-surface-container-high flex items-center justify-center font-semibold text-on-surface-variant shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}