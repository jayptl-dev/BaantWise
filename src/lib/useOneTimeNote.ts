import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

// A short note passed along with navigate(..., { state }), like "Your account was
// deleted". Browsers keep that state when the page is refreshed, so the note is
// read once and then cleared: it shows now, and is gone after a refresh.
export function useOneTimeNote<T>(read: (state: unknown) => T | undefined): T | undefined {
  const location = useLocation();
  const navigate = useNavigate();
  const [note] = useState(() => read(location.state));

  useEffect(() => {
    if (location.state != null) {
      navigate(location.pathname + location.search + location.hash, { replace: true, state: null });
    }
    // Only on arrival: later state changes belong to whoever made them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return note;
}
