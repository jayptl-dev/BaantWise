import { useEffect, useState } from "react";

// `value`, but only once it has stopped changing for `delay` milliseconds.
// Used so a search runs when someone pauses typing, not on every key.
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
