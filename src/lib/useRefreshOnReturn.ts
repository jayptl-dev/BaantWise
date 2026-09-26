import { useEffect } from "react";

// Calls `refresh` when the app comes back into view (for example after a phone
// was asleep) or when the internet connection comes back, to catch up on changes.
export function useRefreshOnReturn(refresh: () => void) {
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);
}
