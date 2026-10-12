import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { CategoryEmoji } from "../components/CategoryEmoji";
import { LockIcon } from "../components/LockIcon";
import { FeedbackLine, GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { formatDay } from "../lib/format";
import { amountLine, fetchRecurring, scheduleLine, type RecurringBill, type RecurringRule } from "../lib/recurring";
import { supabase } from "../lib/supabase";
import { mustChange, useDbAction } from "../lib/useDbAction";
import { useGroup, type GroupData } from "../lib/useGroup";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

// "/groups/:id/recurring": the group's recurring expenses, and my bills to fill in.
export default function Recurring() {
  const { id = "" } = useParams();
  return <RecurringScreen key={id} id={id} />;
}

function RecurringScreen({ id }: { id: string }) {
  const { user } = useAuth();
  const { state, reload } = useGroup(id, user?.id ?? "");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <RecurringList data={state.data} />;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rules: RecurringRule[]; bills: RecurringBill[] };

function RecurringList({ data }: { data: GroupData }) {
  const { group } = data;
  const { user } = useAuth();
  const { ask, dialog } = useConfirm();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const { busy, feedback, run } = useDbAction(reload);
  useRefreshOnReturn(reload);

  useEffect(() => {
    let active = true;
    fetchRecurring(group.id).then(({ error, rules, bills }) => {
      if (!active) return;
      setState((previous) =>
        error
          ? previous.status === "ready"
            ? previous
            : { status: "error", message: friendlyError(error) }
          : { status: "ready", rules, bills },
      );
    });
    return () => {
      active = false;
    };
  }, [group.id, version]);

  const nameOf = (memberId: string) =>
    [...data.members, ...data.formerMembers].find((m) => m.id === memberId)?.display_name ?? "Someone";

  async function setPaused(rule: RecurringRule, paused: boolean) {
    await run(
      () =>
        mustChange(
          supabase.from("recurring_expenses").update({ paused }, { count: "exact" }).eq("id", rule.id),
          "Only the person who set it up can change it",
        ),
      paused ? `"${rule.description}" is paused.` : `"${rule.description}" is back on. Nothing is added for the paused time.`,
    );
  }

  async function remove(rule: RecurringRule) {
    const sure = await ask(
      `Stop "${rule.description}" for good? Expenses it already added stay as they are.`,
      "Delete",
    );
    if (!sure) return;
    await run(
      () =>
        mustChange(
          supabase.from("recurring_expenses").delete({ count: "exact" }).eq("id", rule.id),
          "Only the person who set it up can delete it",
        ),
      `"${rule.description}" was deleted.`,
    );
  }

  async function skip(bill: RecurringBill, rule: RecurringRule | undefined) {
    const sure = await ask(`Skip ${rule?.description ?? "this bill"} for ${formatDay(bill.dueOn, true)}?`, "Skip", false);
    if (!sure) return;
    await run(() => supabase.rpc("skip_recurring_bill", { p_bill_id: bill.id }), "Skipped.");
  }

  return (
    <>
      <Link to={`/groups/${group.id}`} className="back-link">
        ← Back to {group.name}
      </Link>
      <h1 className="page-title">Recurring expenses</h1>
      <p className="muted">
        Rent, internet, a phone plan: set it up once and it's added for you on schedule, as if you'd added it yourself.
      </p>
      <div className="section-actions">
        <Link to={`/groups/${group.id}/recurring/new`} className="button">
          New recurring expense
        </Link>
      </div>
      <FeedbackLine feedback={feedback} />

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
      {state.status === "ready" && (
        <>
          {state.bills.length > 0 && (
            <section className="section" aria-labelledby="bills-heading">
              <h2 id="bills-heading">Bills to fill in</h2>
              <ul className="expense-list">
                {state.bills.map((bill) => {
                  const rule = state.rules.find((r) => r.id === bill.recurringId);
                  return (
                    <li key={bill.id} className="bill-row">
                      <span className="expense-main">
                        <span className="expense-title">
                          {rule && <CategoryEmoji category={rule.category} />} {rule?.description ?? "Recurring bill"}
                        </span>
                        <span className="expense-sub">Due {formatDay(bill.dueOn, true)}</span>
                      </span>
                      <span className="button-row">
                        <Link to={`/groups/${group.id}/expenses/new?bill=${bill.id}`} className="button">
                          Enter amount
                        </Link>
                        <button type="button" className="button secondary" onClick={() => skip(bill, rule)} disabled={busy}>
                          Skip
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="section" aria-labelledby="rules-heading">
            <h2 id="rules-heading">Set up in {group.name}</h2>
            {state.rules.length === 0 ? (
              <p className="muted">Nothing yet. Tap "New recurring expense" to add rent or a bill that repeats.</p>
            ) : (
              <ul className="expense-list">
                {state.rules.map((rule) => {
                  const mine = rule.createdBy === user?.id;
                  return (
                    <li key={rule.id} className="rule-row">
                      <span className="expense-main">
                        <span className="expense-title">
                          {rule.visibility === "participants" && (
                            <>
                              <LockIcon />
                              <span className="visually-hidden">Private: </span>{" "}
                            </>
                          )}
                          <CategoryEmoji category={rule.category} /> {rule.description}
                        </span>
                        <span className="expense-sub">
                          {amountLine(rule)} · {nameOf(rule.paidBy)} pays · {scheduleLine(rule)}
                        </span>
                      </span>
                      {mine && (
                        <span className="button-row">
                          <Link to={`/groups/${group.id}/recurring/${rule.id}/edit`} className="button secondary">
                            Edit
                          </Link>
                          {rule.nextOn && (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => setPaused(rule, !rule.paused)}
                              disabled={busy}
                            >
                              {rule.paused ? "Resume" : "Pause"}
                            </button>
                          )}
                          <button type="button" className="button secondary danger" onClick={() => remove(rule)} disabled={busy}>
                            Delete
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
      {dialog}
    </>
  );
}
