import { useId, useMemo, useState, type FormEvent } from "react";
import { DESCRIPTION_MAX, peopleInvolved, type Expense, type Visibility } from "../lib/expenses";
import { todayLocal } from "../lib/format";
import { centsToDecimal, formatCents, MAX_CENTS, parseCents, splitEqually } from "../lib/money";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import type { GroupData, Member } from "../lib/useGroup";
import { FeedbackLine } from "./Status";
import { LockIcon } from "./LockIcon";
import { useConfirm } from "./useConfirm";

type SplitMode = "equal" | "exact";

type ExpenseFormProps = {
  data: GroupData;
  me: Member;
  expense?: Expense; // when editing; leave out to add a new one
  onDone: () => void; // after saving, or Cancel
};

// Adding or editing an expense. Everything is checked here first so mistakes get
// a friendly message, and the database checks it all again (save_expense).
export function ExpenseForm({ data, me, expense, onDone }: ExpenseFormProps) {
  const { group } = data;
  const { ask, dialog } = useConfirm();
  const { busy, feedback, setFeedback, run } = useDbAction();
  const ids = { description: useId(), amount: useId(), paidBy: useId(), date: useId() };

  // Who can be picked: everyone in the group now, plus (when editing) anyone already
  // on this expense who has since left, so they aren't dropped by accident.
  const people = useMemo(() => {
    const onExpense = new Set(expense ? [expense.paid_by, ...expense.shares.map((s) => s.member_id)] : []);
    return [...data.members, ...data.formerMembers.filter((m) => onExpense.has(m.id))];
  }, [data, expense]);

  const [start] = useState(() => startingSplit(expense, people));
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountText, setAmountText] = useState(expense ? centsToDecimal(expense.amount_cents) : "");
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? me.id);
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? todayLocal());
  const [mode, setMode] = useState<SplitMode>(start.mode);
  const [ticked, setTicked] = useState<Set<string>>(start.ticked);
  const [exactText, setExactText] = useState<Record<string, string>>(start.exact);
  const [visibility, setVisibility] = useState<Visibility>(expense?.visibility ?? "group");

  // Worked out from what's typed so far, on every change.
  const typedAmount = parseCents(amountText);
  const amount = typedAmount !== null && typedAmount > 0 && typedAmount <= MAX_CENTS ? typedAmount : null;

  const tickedIds = people.filter((p) => ticked.has(p.id)).map((p) => p.id); // in list order
  const equalShares = amount === null ? null : splitEqually(amount, tickedIds, paidBy);

  // Exact amounts: blank counts as $0.00; null means it isn't an amount.
  const exactCents = new Map(
    people.map((p) => {
      const text = exactText[p.id] ?? "";
      return [p.id, text.trim() === "" ? 0 : parseCents(text)];
    }),
  );
  const exactTotal = [...exactCents.values()].reduce<number>((sum, cents) => sum + (cents ?? 0), 0);

  // The people splitting it, and so who a private expense is shared with.
  const splitIds =
    mode === "equal" ? tickedIds : people.filter((p) => (exactCents.get(p.id) ?? 0) > 0).map((p) => p.id);
  // The database's rule: the payer, the people splitting it, and whoever added it (you).
  const involved = new Set([paidBy, ...splitIds, me.id]);
  const onlyMe = involved.size === 1;
  const finalVisibility: Visibility = onlyMe ? "participants" : visibility;

  function nameFor(member: Member): string {
    if (member.id === me.id) return `${member.display_name} (you)`;
    if (!data.members.includes(member)) return `${member.display_name} (left)`;
    return member.display_name;
  }

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchMode(next: SplitMode) {
    if (next === mode) return;
    setFeedback(null);
    // Carry the split over, so switching doesn't start from scratch.
    if (next === "exact" && equalShares) {
      const filledIn = people.map((p) => {
        const cents = equalShares.get(p.id);
        return [p.id, cents === undefined ? "" : centsToDecimal(cents)];
      });
      setExactText(Object.fromEntries(filledIn));
    }
    if (next === "equal" && splitIds.length > 0) setTicked(new Set(splitIds));
    setMode(next);
  }

  // The first problem with the form, in plain words, or null if it's ready to save.
  function problem(): string | null {
    const length = Array.from(description.trim()).length;
    if (length === 0) return "Say what the expense was for.";
    if (length > DESCRIPTION_MAX) return `Keep the description to ${DESCRIPTION_MAX} characters or fewer.`;
    if (typedAmount === null) return "Enter the amount, like 12.50.";
    if (typedAmount === 0) return "The amount must be more than $0.00.";
    if (amount === null) return `The most one expense can be is ${formatCents(MAX_CENTS)}.`;
    if (!people.some((p) => p.id === paidBy)) return "Choose who paid.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return "Choose the date.";
    if (mode === "equal") {
      if (tickedIds.length === 0) return "Tick at least one person to split with.";
      return null;
    }
    const badAmount = people.find((p) => exactCents.get(p.id) === null);
    if (badAmount) return `Check the amount for ${badAmount.display_name}, like 12.50.`;
    if (splitIds.length === 0) return "Enter at least one person's amount.";
    const total = formatCents(amount);
    if (exactTotal < amount) {
      return `${formatCents(amount - exactTotal)} left to assign. The amounts must add up to ${total}.`;
    }
    if (exactTotal > amount) return `The amounts are ${formatCents(exactTotal - amount)} over the total of ${total}.`;
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const issue = problem();
    if (issue) {
      setFeedback({ text: issue, isError: true });
      return;
    }
    if (amount === null) return; // already covered by problem(); this tells TypeScript
    // Making a private expense visible to the whole group can't be taken back quietly.
    if (expense?.visibility === "participants" && finalVisibility === "group") {
      const sure = await ask(`Everyone in ${group.name} will see this expense. Continue?`, "Continue", false);
      if (!sure) return;
    }
    const shares = splitIds.map((id) => ({
      member_id: id,
      share_cents: (mode === "equal" ? equalShares?.get(id) : exactCents.get(id)) ?? 0,
    }));
    const saved = await run(
      () =>
        supabase.rpc("save_expense", {
          p_group_id: group.id,
          p_description: description.trim(),
          p_amount_cents: amount,
          p_paid_by: paidBy,
          p_shares: shares,
          p_visibility: finalVisibility,
          p_spent_on: spentOn,
          p_expense_id: expense?.id,
        }),
      undefined,
      false,
    );
    if (saved) onDone();
  }

  const onlyNames = peopleInvolved(involved, data, me.id);

  return (
    <>
      <form className="expense-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.description}>What for?</label>
          <input
            id={ids.description}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={DESCRIPTION_MAX}
            placeholder="For example: Groceries"
            autoComplete="off"
            enterKeyHint="next"
          />
        </div>

        <div className="field">
          <label htmlFor={ids.amount}>Amount (CA$)</label>
          <span className="money-input">
            <span aria-hidden="true">$</span>
            <input
              id={ids.amount}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              enterKeyHint="next"
            />
          </span>
        </div>

        <div className="field">
          <label htmlFor={ids.paidBy}>Paid by</label>
          <select id={ids.paidBy} value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {nameFor(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={ids.date}>Date</label>
          <input id={ids.date} type="date" value={spentOn} onChange={(event) => setSpentOn(event.target.value)} />
        </div>

        <fieldset>
          <legend>Split</legend>
          <div className="segmented">
            {(["equal", "exact"] as const).map((option) => (
              <label key={option} className="segment">
                <input
                  type="radio"
                  name="split-mode"
                  checked={mode === option}
                  onChange={() => switchMode(option)}
                />
                <span>{option === "equal" ? "Equally" : "Exact amounts"}</span>
              </label>
            ))}
          </div>

          <ul className="split-list">
            {people.map((p) =>
              mode === "equal" ? (
                <li key={p.id}>
                  <label className="choice">
                    <input type="checkbox" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>{nameFor(p)}</span>
                  </label>
                  <span className="split-amount">
                    {equalShares?.has(p.id) ? formatCents(equalShares.get(p.id)!) : ""}
                  </span>
                </li>
              ) : (
                <li key={p.id}>
                  <label htmlFor={`${ids.amount}-${p.id}`}>{nameFor(p)}</label>
                  <span className="money-input small">
                    <span aria-hidden="true">$</span>
                    <input
                      id={`${ids.amount}-${p.id}`}
                      value={exactText[p.id] ?? ""}
                      onChange={(event) => setExactText({ ...exactText, [p.id]: event.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      aria-invalid={exactCents.get(p.id) === null ? true : undefined}
                    />
                  </span>
                </li>
              ),
            )}
          </ul>

          {mode === "exact" && amount !== null && (
            <p className={exactTotal === amount ? "split-status done" : "split-status"} aria-live="polite">
              {exactTotal < amount && `${formatCents(amount - exactTotal)} left to assign`}
              {exactTotal > amount && `${formatCents(exactTotal - amount)} over the total`}
              {exactTotal === amount && `Adds up to ${formatCents(amount)}`}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>Who can see this?</legend>
          {onlyMe ? (
            <p className="private-note">
              <LockIcon /> Only you
            </p>
          ) : (
            <>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === "group"}
                  onChange={() => setVisibility("group")}
                />
                <span>Everyone in {group.name}</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === "participants"}
                  onChange={() => setVisibility("participants")}
                />
                <span className="private-note">
                  <LockIcon /> Only {onlyNames}
                </span>
              </label>
            </>
          )}
        </fieldset>

        <FeedbackLine feedback={feedback} />
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            {expense ? "Save changes" : "Add expense"}
          </button>
          <button type="button" className="button secondary" onClick={onDone} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
      {dialog}
    </>
  );
}

// How the split starts: a new expense is split equally between everyone.
// An existing one opens as "Equally" if its shares are exactly an equal split,
// otherwise as "Exact amounts" with each person's share filled in.
function startingSplit(expense: Expense | undefined, people: Member[]) {
  if (!expense) {
    return { mode: "equal" as SplitMode, ticked: new Set(people.map((p) => p.id)), exact: {} };
  }
  const shares = new Map(expense.shares.map((s) => [s.member_id, s.share_cents]));
  const inSplit = people.filter((p) => shares.has(p.id)).map((p) => p.id);
  const equal = splitEqually(expense.amount_cents, inSplit, expense.paid_by);
  const isEqual = inSplit.length === shares.size && inSplit.every((id) => equal.get(id) === shares.get(id));
  const exact: Record<string, string> = {};
  for (const [id, cents] of shares) exact[id] = cents > 0 ? centsToDecimal(cents) : "";
  return { mode: (isEqual ? "equal" : "exact") as SplitMode, ticked: new Set(inSplit), exact };
}
