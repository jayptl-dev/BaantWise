import { useMemo, useState } from "react";
import { computeBalances, type Balances } from "../lib/balances";
import { peopleById, type Visibility } from "../lib/expenses";
import { formatCents } from "../lib/money";
import type { Feedback } from "../lib/useDbAction";
import type { GroupData, Member } from "../lib/useGroup";
import { LockIcon } from "./LockIcon";
import { SettleUpDialog } from "./SettleUpDialog";
import { FeedbackLine } from "./Status";

// A debt someone chose to settle: who pays whom, and in which scope.
type SettleTarget = { from: string; to: string; visibility: Visibility };

type BalancesSectionProps = {
  data: GroupData;
  me: Member;
  feedback: Feedback;
  onSaved: (text: string) => void; // after a payment was recorded
};

// "Balances": my overall number, the group's simplified debts, and one box per
// private balance between me and someone else. Worked out again on every reload,
// so live updates change it straight away.
export function BalancesSection({ data, me, feedback, onSaved }: BalancesSectionProps) {
  const balances = useMemo(() => computeBalances(data.expenses, data.payments, me.id), [data, me.id]);
  const [settling, setSettling] = useState<SettleTarget | null>(null);
  const people = peopleById(data);
  const nameOf = (id: string) => people.get(id)?.display_name ?? "Someone";

  // Who owes whom, in words: "You owe Jay", "Sam owes you", "Sam owes Priya".
  function owesLine(from: string, to: string): string {
    if (from === me.id) return `You owe ${nameOf(to)}`;
    if (to === me.id) return `${nameOf(from)} owes you`;
    return `${nameOf(from)} owes ${nameOf(to)}`;
  }

  // The button for a debt: "Pay" if I owe, "Received" if I'm owed, and "Record payment"
  // between two guests (who can't sign in to do it themselves). Nothing otherwise:
  // the people in it record it themselves.
  function actionFor(from: string, to: string, visibility: Visibility) {
    let label: string | null = null;
    if (from === me.id) label = "Pay";
    else if (to === me.id) label = "Received";
    else if (people.get(from)?.user_id === null && people.get(to)?.user_id === null) label = "Record payment";
    if (!label) return null;
    return (
      <button
        type="button"
        className="button secondary balance-button"
        onClick={() => setSettling({ from, to, visibility })}
      >
        {label}
        {label === "Record payment" && (
          <span className="visually-hidden">
            {" "}
            from {nameOf(from)} to {nameOf(to)}
          </span>
        )}
      </button>
    );
  }

  const settlingFrom = settling && people.get(settling.from);
  const settlingTo = settling && people.get(settling.to);

  return (
    <section className="section" aria-labelledby="balances-heading">
      <h2 id="balances-heading">Balances</h2>
      <Overall cents={balances.overall} />
      <FeedbackLine feedback={feedback} />

      <h3 className="balance-heading">In the group</h3>
      {balances.transfers.length === 0 ? (
        <p className="muted">Everyone in the group is settled up.</p>
      ) : (
        <ul className="balance-list">
          {balances.transfers.map((t) => (
            <li key={`${t.from}-${t.to}`} className="balance-row">
              <span className="balance-text">
                {owesLine(t.from, t.to)} <strong>{formatCents(t.cents)}</strong>
              </span>
              {actionFor(t.from, t.to, "group")}
            </li>
          ))}
        </ul>
      )}

      {balances.pairs.map((pair) => {
        // Positive: they owe me. Negative: I owe them.
        const [from, to] = pair.cents > 0 ? [pair.with, me.id] : [me.id, pair.with];
        return (
          <div key={pair.with} className="private-balance">
            <h3 className="balance-heading private-note">
              <LockIcon /> Just between you and {nameOf(pair.with)}
            </h3>
            <ul className="balance-list">
              <li className="balance-row">
                <span className="balance-text">
                  {owesLine(from, to)} <strong>{formatCents(Math.abs(pair.cents))}</strong>
                </span>
                {actionFor(from, to, "participants")}
              </li>
            </ul>
          </div>
        );
      })}

      {settling && settlingFrom && settlingTo && (
        <SettleUpDialog
          groupId={data.group.id}
          groupName={data.group.name}
          me={me}
          from={settlingFrom}
          to={settlingTo}
          owed={owedNow(balances, settling, me.id)}
          visibility={settling.visibility}
          onClose={() => setSettling(null)}
          onSaved={(text) => {
            setSettling(null);
            onSaved(text);
          }}
        />
      )}
    </section>
  );
}

// "You're owed $X", "You owe $X" or "You're all settled up": the group and all my
// private balances together.
function Overall({ cents }: { cents: number }) {
  const kind = cents > 0 ? "lent" : cents < 0 ? "owe" : "none";
  return (
    <p className={`overall ${kind}`}>
      <span className="overall-label">Overall</span>
      <span className="overall-value">
        {cents > 0 && `You're owed ${formatCents(cents)}`}
        {cents < 0 && `You owe ${formatCents(-cents)}`}
        {cents === 0 && "You're all settled up"}
      </span>
    </p>
  );
}

// How much of a debt is still owed right now. It can change while the pay box is
// open (a live update), and is 0 if it was settled meanwhile.
function owedNow(balances: Balances, target: SettleTarget, me: string): number {
  if (target.visibility === "group") {
    return balances.transfers.find((t) => t.from === target.from && t.to === target.to)?.cents ?? 0;
  }
  const other = target.from === me ? target.to : target.from;
  const pair = balances.pairs.find((p) => p.with === other);
  if (!pair) return 0;
  // Positive: they owe me, so the payment must come from them.
  if (pair.cents > 0) return target.from === other ? pair.cents : 0;
  return target.from === me ? -pair.cents : 0;
}
