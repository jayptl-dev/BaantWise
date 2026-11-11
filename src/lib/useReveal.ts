import { useEffect, useRef } from "react";

// Marks each `.reveal` element inside the returned ref's element with `seen` the
// first time it scrolls into view, so its pen strokes can draw themselves then
// (see ".reveal" in index.css). If the browser can't watch for that, everything
// is marked straight away, so nothing stays undrawn.
export function useReveal<T extends HTMLElement>() {
  const root = useRef<T>(null);
  useEffect(() => {
    const targets = Array.from(root.current?.querySelectorAll<HTMLElement>(".reveal") ?? []);
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((target) => target.classList.add("seen"));
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("seen");
          watcher.unobserve(entry.target);
        }
      },
      { threshold: 0.3 },
    );
    targets.forEach((target) => watcher.observe(target));
    return () => watcher.disconnect();
  }, []);
  return root;
}
