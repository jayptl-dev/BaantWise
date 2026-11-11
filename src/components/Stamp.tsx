import { useEffect, useState } from "react";

const STAMP_EVENT = "baantwise:stamp";

// Thump a rubber stamp ("Paid") onto the screen for a moment. Call it right after
// something is saved; the words that confirm it for screen readers are shown separately.
export function stamp(text: string) {
  window.dispatchEvent(new CustomEvent(STAMP_EVENT, { detail: text }));
}

// Shows the stamp. One of these lives in AppLayout.
export function StampHost() {
  const [mark, setMark] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    const show = (event: Event) => setMark({ text: (event as CustomEvent<string>).detail, key: Date.now() });
    window.addEventListener(STAMP_EVENT, show);
    return () => window.removeEventListener(STAMP_EVENT, show);
  }, []);
  if (!mark) return null;
  return (
    <div className="stamp-layer" aria-hidden="true">
      <span key={mark.key} className="stamp" onAnimationEnd={() => setMark(null)}>
        {mark.text}
      </span>
    </div>
  );
}
