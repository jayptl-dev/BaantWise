import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AppLayout } from "../components/AppLayout";
import { SignInPage } from "../components/SignIn";
import { FeedbackLine, FullPageLoading, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import type { Database } from "../lib/database.types";
import { friendlyError } from "../lib/errors";
import { isUuid, peopleCount } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Feedback } from "../lib/useDbAction";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

type Invite = Database["public"]["Functions"]["get_invite"]["Returns"][number];

type InviteState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "own-link" } // your own friend link, opened by you
  | { status: "error"; message: string }
  | { status: "ready"; invite: Invite };

// "/join/:token": where an invite link lands.
export default function InvitePage() {
  const { token = "" } = useParams();
  const { user, checking } = useAuth();

  if (checking) return <FullPageLoading />;
  if (!user) {
    // After signing in, this same page shows the invite and "Join group".
    return <SignInPage line="You've been invited on Baantwise. Sign in to continue." />;
  }
  return (
    <AppLayout>
      <InviteDetails key={token} token={token} />
    </AppLayout>
  );
}

function InviteDetails({ token }: { token: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!isUuid(token)) {
        setState({ status: "invalid" });
        return;
      }
      const { data, error } = await supabase.rpc("get_invite", { p_token: token });
      if (!active) return;
      if (error) {
        // If a background refresh fails, keep showing the invite.
        setState((previous) =>
          previous.status === "ready" ? previous : { status: "error", message: friendlyError(error) },
        );
        return;
      }
      const invite = data?.[0];
      if (!invite) {
        setState({ status: "invalid" });
      } else if (invite.is_direct && invite.already_member && invite.member_count === 1) {
        setState({ status: "own-link" });
      } else if (invite.already_member) {
        navigate(`/groups/${invite.group_id}`, { replace: true });
      } else {
        setState({ status: "ready", invite });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [token, version, navigate]);

  // Catch up when the app comes back into view or back online (the link may have been reset).
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useRefreshOnReturn(refresh);

  async function join() {
    setBusy(true);
    setFeedback(null);
    const { data: groupId, error } = await supabase.rpc("join_group", { p_token: token });
    if (error || !groupId) {
      setBusy(false);
      setFeedback({ text: friendlyError(error), isError: true });
      return;
    }
    navigate(`/groups/${groupId}`, { replace: true });
  }

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") {
    return (
      <LoadError
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setVersion((v) => v + 1);
        }}
      />
    );
  }
  if (state.status === "own-link") {
    return (
      <div className="state">
        <p>This is your own friend link. Send it to a friend: whoever opens it becomes your friend.</p>
        <Link to="/friends" className="button secondary">
          Go to Friends
        </Link>
      </div>
    );
  }
  if (state.status === "invalid") {
    return (
      <div className="state">
        <p>This invite link doesn't work any more. Ask someone in the group for a new one.</p>
        <Link to="/" className="button secondary">
          Go to your groups
        </Link>
      </div>
    );
  }

  const { invite } = state;
  return (
    <>
      {invite.is_direct ? (
        <>
          <h1 className="page-title">{invite.group_name} wants to add you as a friend</h1>
          <p className="muted">Then you can split costs with each other, outside any group.</p>
          <button type="button" className="button" onClick={join} disabled={busy}>
            {busy ? "Adding…" : `Add ${invite.group_name} as a friend`}
          </button>
        </>
      ) : (
        <>
          <h1 className="page-title">
            You're invited to {invite.group_name} <span className="muted">· {peopleCount(invite.member_count)}</span>
          </h1>
          <button type="button" className="button" onClick={join} disabled={busy}>
            {busy ? "Joining…" : "Join group"}
          </button>
        </>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );
}
