import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { NameForm } from "../components/NameForm";
import { SampleGroupDialog } from "../components/SampleGroupDialog";
import { ChartIcon } from "../components/ChartIcon";
import { FriendsIcon } from "../components/FriendsIcon";
import { SearchIcon } from "../components/SearchIcon";
import { FeedbackLine, LoadError, Loading } from "../components/Status";
import { friendlyError } from "../lib/errors";
import { GROUP_NAME_MAX, peopleCount } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Feedback } from "../lib/useDbAction";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

type GroupSummary = { id: string; name: string; people: number; sample: boolean };

type ListState =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; groups: GroupSummary[] };

// The groups you're in (Row Level Security only returns those), newest first.
async function fetchGroups(): Promise<ListState> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, is_sample, group_members(removed_at)")
    .eq("is_direct", false)
    .order("created_at", { ascending: false });
  if (error) return { status: "error", message: friendlyError(error) };
  return {
    status: "ready",
    groups: data.map((group) => ({
      id: group.id,
      name: group.name,
      // Active members only (guests included): people who left or were removed don't count.
      people: group.group_members.filter((m) => m.removed_at === null).length,
      sample: group.is_sample,
    })),
  };
}

export default function YourGroups() {
  const navigate = useNavigate();
  // A short note passed along after leaving or deleting a group.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [samplePicker, setSamplePicker] = useState(false);

  useEffect(() => {
    let active = true;
    fetchGroups().then((next) => {
      if (!active) return;
      // If a background refresh fails (for example, no internet), keep showing the list.
      setState((previous) => (next.status === "error" && previous.status === "ready" ? previous : next));
    });
    return () => {
      active = false;
    };
  }, [version]);

  // Catch up when the app comes back into view or back online.
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useRefreshOnReturn(refresh);

  function retry() {
    setState({ status: "loading" });
    setVersion((v) => v + 1);
  }

  async function createGroup(name: string) {
    setBusy(true);
    setFeedback(null);
    const { data: groupId, error } = await supabase.rpc("create_group", { p_name: name });
    if (error || !groupId) {
      setBusy(false);
      setFeedback({ text: friendlyError(error), isError: true });
      return;
    }
    navigate(`/groups/${groupId}`);
  }

  const newGroup = creating ? (
    <NameForm
      label="Group name"
      hint="For example: Cabin trip, or Apartment 4B."
      max={GROUP_NAME_MAX}
      submitLabel="Create group"
      emptyMessage="Give the group a name."
      busy={busy}
      autoFocus
      onSubmit={createGroup}
      onCancel={() => {
        setCreating(false);
        setFeedback(null);
      }}
    />
  ) : (
    <button type="button" className="button" onClick={() => setCreating(true)}>
      New group
    </button>
  );

  return (
    <>
      <div className="group-header">
        <h1 className="page-title">Your groups</h1>
        <div className="header-actions">
          <Link to="/friends" className="icon-button" aria-label="Friends" title="Friends">
            <FriendsIcon />
          </Link>
          <Link to="/spending" className="icon-button" aria-label="My spending" title="My spending">
            <ChartIcon />
          </Link>
          <Link to="/search" className="icon-button" aria-label="Search expenses" title="Search expenses">
            <SearchIcon />
          </Link>
        </div>
      </div>
      {notice && (
        <p className="feedback" role="status">
          {notice}
        </p>
      )}

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <LoadError message={state.message} onRetry={retry} />}

      {state.status === "ready" && state.groups.length === 0 && (
        <div className="empty">
          <h2>Start your first group</h2>
          <p className="muted">Make a group for a trip, a shared home, or anything else you split costs for.</p>
          {newGroup}
          <FeedbackLine feedback={feedback} />
        </div>
      )}

      {state.status === "ready" && state.groups.length > 0 && (
        <>
          <div className="section-actions">
            {newGroup}
            <FeedbackLine feedback={feedback} />
          </div>
          <ul className="group-list">
            {state.groups.map((group) => (
              <li key={group.id}>
                <Link to={`/groups/${group.id}`} className="group-link">
                  <span className="group-name">
                    {group.name}
                    {group.sample && <span className="badge sample-badge">Sample</span>}
                  </span>
                  <span className="muted">{peopleCount(group.people)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {state.status === "ready" && !state.groups.some((g) => g.sample) && (
        <section className="sample-offer" aria-labelledby="sample-offer-heading">
          <h2 id="sample-offer-heading">Just looking around?</h2>
          <p className="muted">
            Open a sample house with two months of shared bills and see how Baantwise works. Only you can see it.
          </p>
          <button type="button" className="button secondary" onClick={() => setSamplePicker(true)}>
            Try a sample group
          </button>
        </section>
      )}
      {samplePicker && <SampleGroupDialog onClose={() => setSamplePicker(false)} />}
    </>
  );
}
