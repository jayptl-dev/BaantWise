import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { SpendingCharts } from "../components/SpendingCharts";
import { LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { fetchMySpending, type SpendingRow } from "../lib/spending";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; inAnyGroup: boolean; rows: SpendingRow[] };

// "/spending": my own share of everything, across all my groups (private expenses included).
export default function MySpending() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchMySpending(userId).then(({ error, inAnyGroup, rows }) => {
      if (!active) return;
      setState((previous) =>
        error
          ? previous.status === "ready" // a background refresh failed: keep what's shown
            ? previous
            : { status: "error", message: friendlyError(error) }
          : { status: "ready", inAnyGroup, rows },
      );
    });
    return () => {
      active = false;
    };
  }, [userId, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useRefreshOnReturn(refresh);

  return (
    <>
      <Link to="/" className="back-link">
        ← Back to your groups
      </Link>
      <h1 className="page-title">My spending</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && (
        <LoadError
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            refresh();
          }}
        />
      )}
      {state.status === "ready" &&
        (state.inAnyGroup ? (
          <>
            <p className="muted">Your own share of every expense, in all your groups. Only you can see this.</p>
            <SpendingCharts rows={state.rows} mine />
          </>
        ) : (
          <p className="muted">Join or create a group to see your spending here.</p>
        ))}
    </>
  );
}
