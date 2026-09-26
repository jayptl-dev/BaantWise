import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

// Goes back to the previous screen, like the phone's back button. If this page
// was opened straight from a link (so there's no previous Baantwise screen),
// it goes to `fallback` instead of leaving the app.
export function useGoBack() {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(
    (fallback: string) => {
      // React Router gives the first page opened in this tab the key "default".
      if (key !== "default") navigate(-1);
      else navigate(fallback, { replace: true });
    },
    [key, navigate],
  );
}
