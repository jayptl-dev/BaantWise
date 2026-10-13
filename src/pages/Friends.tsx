import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { FeedbackLine, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import {
  addFriendByUsername,
  addFriendFromMember,
  friendSuggestions,
  loadFriends,
  myFriendLink,
  normalizeUsername,
  USERNAME_HINT,
  type Friend,
  type Suggestion,
} from "../lib/friends";
import { formatCents } from "../lib/money";
import { canUseShareSheet } from "../lib/share";
import type { Feedback } from "../lib/useDbAction";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; friends: Friend[]; suggestions: Suggestion[] };

// "/friends": people you split with one-on-one, and ways to add more.
export default function Friends() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const usernameId = useId();
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [linkNote, setLinkNote] = useState<Feedback>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const friends = await loadFriends(user.id);
      if (!friends.ok) {
        if (active)
          setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: friends.message }));
        return;
      }
      const ids = new Set(friends.value.flatMap((f) => (f.userId ? [f.userId] : [])));
      const suggestions = await friendSuggestions(user.id, ids);
      if (active) {
        setState({ status: "ready", friends: friends.value, suggestions: suggestions.ok ? suggestions.value : [] });
      }
    })();
    return () => {
      active = false;
    };
  }, [user, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useRefreshOnReturn(refresh);

  async function added(result: { ok: true; value: string } | { ok: false; message: string }) {
    setBusy(false);
    if (!result.ok) {
      setFeedback({ text: result.message, isError: true });
      return;
    }
    navigate(`/groups/${result.value}`);
  }

  async function addByUsername(event: FormEvent) {
    event.preventDefault();
    const name = normalizeUsername(username);
    if (!name) {
      setFeedback({ text: `That isn't a username. ${USERNAME_HINT}`, isError: true });
      return;
    }
    setBusy(true);
    setFeedback(null);
    await added(await addFriendByUsername(name));
  }

  async function addFromGroup(s: Suggestion) {
    setBusy(true);
    setFeedback(null);
    await added(await addFriendFromMember(s.memberId));
  }

  async function shareMyLink() {
    setLinkNote(null);
    const link = await myFriendLink();
    if (!link.ok) {
      setLinkNote({ text: link.message, isError: true });
      return;
    }
    const message = `Add me as a friend on Baantwise, so we can split costs: ${link.value}`;
    if (canUseShareSheet()) {
      try {
        await navigator.share({ text: message });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link.value);
      setLinkNote({ text: "Link copied. Paste it in a message to your friend.", isError: false });
    } catch {
      setLinkNote({ text: `Here's your friend link: ${link.value}`, isError: false });
    }
  }

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") {
    return <LoadError message={state.message} onRetry={() => setVersion((v) => v + 1)} />;
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Your groups
      </Link>
      <h1 className="page-title">Friends</h1>
      <p className="muted friends-intro">Split costs with one person, outside any group.</p>

      {state.friends.length === 0 ? (
        <div className="empty">
          <h2>No friends yet</h2>
          <p className="muted">Add someone below. Then add expenses between just the two of you.</p>
        </div>
      ) : (
        <ul className="group-list">
          {state.friends.map((f) => (
            <li key={f.groupId}>
              <Link to={`/groups/${f.groupId}`} className="group-link">
                <span className="group-name">
                  {f.name}
                  {f.left && <span className="badge sample-badge">Removed you</span>}
                </span>
                <FriendBalance cents={f.overall} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="section" aria-labelledby="add-friend-heading">
        <h2 id="add-friend-heading">Add a friend</h2>
        <FeedbackLine feedback={feedback} />

        <form className="field" onSubmit={addByUsername} noValidate>
          <label htmlFor={usernameId}>By username</label>
          <div className="description-row">
            <span className="prefixed-input">
              <span aria-hidden="true">@</span>
              <input
                id={usernameId}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="their.username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={21}
              />
            </span>
            <button type="submit" className="button friend-add" disabled={busy || username.trim() === ""}>
              Add
            </button>
          </div>
          <p className="hint">They can set one in their profile.</p>
        </form>

        {state.suggestions.length > 0 && (
          <div className="field">
            <h3 className="friends-subheading">From your groups</h3>
            <ul className="group-list">
              {state.suggestions.map((s) => (
                <li key={s.userId} className="balance-row">
                  <span className="balance-text">
                    <strong>{s.name}</strong> <span className="muted">· {s.groupName}</span>
                  </span>
                  <button
                    type="button"
                    className="button secondary balance-button"
                    onClick={() => addFromGroup(s)}
                    disabled={busy}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <h3 className="friends-subheading">Not on Baantwise yet?</h3>
          <p className="hint">Send your friend link. Whoever opens it becomes your friend. Each link works once.</p>
          <button type="button" className="button secondary friend-link-button" onClick={shareMyLink}>
            Share my friend link
          </button>
          <FeedbackLine feedback={linkNote} />
        </div>
      </section>
    </>
  );
}

function FriendBalance({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="muted">…</span>;
  if (cents === 0) return <span className="muted">Settled up</span>;
  return cents > 0 ? (
    <span className="my-part lent">
      owes you <strong>{formatCents(cents)}</strong>
    </span>
  ) : (
    <span className="my-part owe">
      you owe <strong>{formatCents(-cents)}</strong>
    </span>
  );
}
