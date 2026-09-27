import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { LockIcon } from "../components/LockIcon";
import { MyPartLabel } from "../components/MyPartLabel";
import { GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { myPart } from "../lib/expenses";
import { formatDay, shorten } from "../lib/format";
import { formatCents } from "../lib/money";
import {
  cleanDate,
  fetchMemberships,
  likePattern,
  searchExpenses,
  type Membership,
  type SearchFilters,
  type SearchResult,
} from "../lib/search";
import { useDebounced } from "../lib/useDebounced";

const SHOWN_DESCRIPTION = 50; // characters of the description shown in a row; the details screen has it all
const TYPING_PAUSE = 300; // milliseconds after the last key before searching

// "/search": search the expenses in all my groups.
// "/groups/:id/search": search one group's expenses.
export default function SearchExpenses() {
  const { id } = useParams();
  // `key` makes everything start fresh if the address switches to another group.
  return <SearchScreen key={id ?? ""} groupId={id} />;
}

type MembershipsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; memberships: Membership[] };

// First: which groups I'm in, and who I am in each (for "you lent / you owe").
function SearchScreen({ groupId }: { groupId?: string }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [state, setState] = useState<MembershipsState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchMemberships(userId, groupId).then(({ error, memberships }) => {
      if (!active) return;
      setState(error ? { status: "error", message: friendlyError(error) } : { status: "ready", memberships });
    });
    return () => {
      active = false;
    };
  }, [userId, groupId, version]);

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
  // One group's search, but I'm not in that group (or it doesn't exist).
  if (groupId !== undefined && state.memberships.length === 0) return <GroupMissing />;
  return <Search memberships={state.memberships} oneGroup={groupId !== undefined ? state.memberships[0] : null} />;
}

type ResultsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; results: SearchResult[]; hasMore: boolean; filters: SearchFilters };

function Search({ memberships, oneGroup }: { memberships: Membership[]; oneGroup: Membership | null }) {
  const ids = useId();
  // The search is kept in the address (?q=…), so coming back from an expense shows it again.
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(() => params.get("q") ?? "");
  const [groupChoice, setGroupChoice] = useState(() => {
    const chosen = params.get("group");
    return memberships.some((m) => m.groupId === chosen) ? (chosen ?? "") : "";
  });
  const [from, setFrom] = useState(() => cleanDate(params.get("from")));
  const [to, setTo] = useState(() => cleanDate(params.get("to")));
  const [onlyMine, setOnlyMine] = useState(() => params.get("mine") === "1");
  // Open the keyboard straight away, unless this is a search we came back to.
  const [focusOnOpen] = useState(() => !params.get("q"));
  const typed = useDebounced(text, TYPING_PAUSE);

  const [state, setState] = useState<ResultsState>({ status: "loading" });
  const [retries, setRetries] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const myMemberIds = useMemo(() => memberships.map((m) => m.memberId), [memberships]);
  const memberIdByGroup = useMemo(() => new Map(memberships.map((m) => [m.groupId, m.memberId])), [memberships]);
  const filters: SearchFilters = useMemo(
    () => ({ text: typed, groupId: oneGroup?.groupId ?? (groupChoice || null), from, to, onlyMine }),
    [typed, oneGroup, groupChoice, from, to, onlyMine],
  );

  // Search again whenever the filters change (the text only once typing pauses).
  useEffect(() => {
    let active = true;
    searchExpenses(filters, myMemberIds, 0).then(({ error, results, hasMore }) => {
      if (!active) return; // a newer search has started
      setState(error ? { status: "error", message: friendlyError(error) } : { status: "ready", results, hasMore, filters });
      setMoreError(null);
    });
    return () => {
      active = false;
    };
  }, [filters, myMemberIds, retries]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (typed.trim()) next.set("q", typed.trim());
    if (!oneGroup && groupChoice) next.set("group", groupChoice);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (onlyMine) next.set("mine", "1");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [typed, oneGroup, groupChoice, from, to, onlyMine, params, setParams]);

  async function showMore() {
    if (state.status !== "ready") return;
    const shown = state;
    setMoreBusy(true);
    setMoreError(null);
    const page = await searchExpenses(shown.filters, myMemberIds, shown.results.length);
    setMoreBusy(false);
    if (page.error) {
      setMoreError(friendlyError(page.error));
      return;
    }
    setState((current) => {
      // The filters changed while this page was loading: it belongs to an old search.
      if (current.status !== "ready" || current.filters !== shown.filters) return current;
      // Skip anything already shown (an expense added meanwhile can shift the pages by one).
      const seen = new Set(current.results.map((r) => r.id));
      return {
        ...current,
        results: [...current.results, ...page.results.filter((r) => !seen.has(r.id))],
        hasMore: page.hasMore,
      };
    });
  }

  // Pressing Enter (or Search on a phone keyboard) just closes the keyboard.
  function submit(event: FormEvent) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  const backLink = oneGroup ? `/groups/${oneGroup.groupId}` : "/";
  const searching = state.status === "ready" && state.filters !== filters;

  return (
    <>
      <Link to={backLink} className="back-link">
        ← Back to {oneGroup ? oneGroup.groupName : "your groups"}
      </Link>
      <h1 className="page-title">Search expenses</h1>

      <form className="search-form" role="search" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-text`}>
            {oneGroup ? `Search ${oneGroup.groupName}` : "Search all your groups"}
          </label>
          <input
            id={`${ids}-text`}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="For example: pizza"
            enterKeyHint="search"
            autoComplete="off"
            autoFocus={focusOnOpen}
          />
        </div>

        {!oneGroup && (
          <div className="field">
            <label htmlFor={`${ids}-group`}>Group</label>
            <select id={`${ids}-group`} value={groupChoice} onChange={(event) => setGroupChoice(event.target.value)}>
              <option value="">All groups</option>
              {memberships.map((m) => (
                <option key={m.groupId} value={m.groupId}>
                  {m.groupName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="date-range">
          <div className="field">
            <label htmlFor={`${ids}-from`}>From</label>
            <input
              id={`${ids}-from`}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-to`}>To</label>
            <input
              id={`${ids}-to`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {(from || to) && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear dates
          </button>
        )}

        <label className="choice">
          <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
          Only ones I'm in
        </label>
      </form>

      <section className="section" aria-label="Results" aria-busy={searching || state.status === "loading"}>
        {state.status === "loading" && <Loading />}
        {state.status === "error" && (
          <LoadError
            message={state.message}
            onRetry={() => {
              setState({ status: "loading" });
              setRetries((r) => r + 1);
            }}
          />
        )}
        {state.status === "ready" && (
          <>
            <p className="visually-hidden" role="status">
              {searching ? "Searching…" : resultCount(state.results.length, state.hasMore)}
            </p>
            {state.results.length === 0 ? (
              <p className="muted">{emptyLine(state.filters, !oneGroup)}</p>
            ) : (
              <ul className={searching ? "expense-list stale" : "expense-list"}>
                {state.results.map((result) => (
                  <ResultRow
                    key={result.id}
                    result={result}
                    myMemberId={memberIdByGroup.get(result.group_id) ?? ""}
                    showGroup={!oneGroup}
                  />
                ))}
              </ul>
            )}
            {state.hasMore && (
              <div className="section-actions">
                <button type="button" className="button secondary" onClick={showMore} disabled={moreBusy}>
                  {moreBusy ? "Loading…" : "Show more"}
                </button>
                {moreError && (
                  <p className="feedback error" role="alert">
                    {moreError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

// One match: date, group (when searching all groups), what for, amount, my part, and a lock if private.
function ResultRow({ result, myMemberId, showGroup }: { result: SearchResult; myMemberId: string; showGroup: boolean }) {
  const details = [formatDay(result.spent_on, true), showGroup ? result.groupName : null, formatCents(result.amount_cents)];
  return (
    <li>
      <Link to={`/groups/${result.group_id}/expenses/${result.id}`} className="expense-link">
        <span className="expense-main">
          <span className="expense-title">
            {result.visibility === "participants" && (
              <>
                <LockIcon />
                <span className="visually-hidden">Private: </span>{" "}
              </>
            )}
            {shorten(result.description, SHOWN_DESCRIPTION)}
          </span>
          <span className="expense-sub">{details.filter(Boolean).join(" · ")}</span>
        </span>
        <MyPartLabel part={myPart(result, myMemberId)} />
      </Link>
    </li>
  );
}

// What to say when nothing came back.
function emptyLine(filters: SearchFilters, allGroups: boolean): string {
  if (likePattern(filters.text)) return `No results for '${filters.text.trim()}'`;
  const filtered = (allGroups && filters.groupId) || filters.from || filters.to || filters.onlyMine;
  return filtered ? "No expenses match these filters" : "No expenses yet";
}

// Read out by screen readers after each search.
function resultCount(count: number, hasMore: boolean): string {
  if (count === 0) return "No results";
  if (hasMore) return `Showing the newest ${count} results`;
  return count === 1 ? "1 result" : `${count} results`;
}
