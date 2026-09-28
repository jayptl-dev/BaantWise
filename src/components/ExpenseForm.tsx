import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { categoryFor, suggestCategory, type CategoryKey } from "../lib/categories";
import { DESCRIPTION_MAX, peopleInvolved, type Expense, type Visibility } from "../lib/expenses";
import { todayLocal } from "../lib/format";
import {
  centsToDecimal,
  formatCents,
  MAX_CENTS,
  readMoney,
  refuseExactChange,
  splitEqually,
} from "../lib/money";
import { attachReceipt, detachReceipt } from "../lib/receipts";
import { PhotoProblem, shrinkPhoto } from "../lib/shrinkPhoto";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import type { GroupData, Member } from "../lib/useGroup";
import { CategoryButton } from "./CategoryPicker";
import { FeedbackLine } from "./Status";
import { LockIcon } from "./LockIcon";
import { ReceiptThumbnail, SavedReceipt } from "./ReceiptPhoto";
import { useConfirm } from "./useConfirm";

type SplitMode = "equal" | "exact";

type FormErrors = {
  description?: string;
  amount?: string;
  paidBy?: string;
  date?: string;
  split?: string; // about the split as a whole
  people: Map<string, string>; // member id → the problem with their exact amount
};

type ExpenseFormProps = {
  data: GroupData;
  me: Member;
  expense?: Expense; // when editing; leave out to add a new one
  // After saving (with a message if the receipt photo part didn't work), or Cancel (nothing).
  onDone: (saved?: { expenseId: string; receiptNotice: string | null }) => void;
};

// Adding or editing an expense. Everything is checked here first so mistakes get
// a friendly message, and the database checks it all again (save_expense).
export function ExpenseForm({ data, me, expense, onDone }: ExpenseFormProps) {
  const { group } = data;
  const { ask, dialog } = useConfirm();
  const { busy, feedback, setFeedback, run } = useDbAction();
  const ids = { description: useId(), amount: useId(), paidBy: useId(), date: useId(), split: useId() };

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
  // The category someone picked (when editing, the saved one). Until they pick one, a new
  // expense follows a suggestion from its description; their own pick always wins.
  const [pickedCategory, setPickedCategory] = useState<CategoryKey | null>(expense?.category ?? null);
  // After the first Save, missing things (like an empty description) are pointed out too.
  const [tried, setTried] = useState(false);
  // Why the last key in a person's box was ignored (see changeExact).
  const [limitNote, setLimitNote] = useState<{ id: string; text: string } | null>(null);

  // The receipt photo: a new one chosen here (already shrunk), or the saved one
  // marked for removal. Uploaded only after the expense itself is saved.
  const [newPhoto, setNewPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removeSaved, setRemoveSaved] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const savedPhoto = removeSaved ? null : (expense?.receipt_path ?? null);
  const working = busy || savingPhoto;

  // The preview only lives in this browser tab; free it when it's replaced or the form closes.
  useEffect(() => {
    if (!newPhoto) return;
    return () => URL.revokeObjectURL(newPhoto.url);
  }, [newPhoto]);

  // Worked out from what's typed so far, on every change. The boxes only ever hold
  // money (see changeAmount), so reading them always works.
  const totalCents = readMoney(amountText)?.cents ?? null; // null = empty
  const amount = totalCents !== null && totalCents > 0 && totalCents <= MAX_CENTS ? totalCents : null;

  const tickedIds = people.filter((p) => ticked.has(p.id)).map((p) => p.id); // in list order
  const equalShares = amount === null ? null : splitEqually(amount, tickedIds, paidBy);

  // Exact amounts. Each box can also add and take away, like "115.22+64.88".
  // An empty box means that person isn't in the split.
  const exactRead = new Map(people.map((p) => [p.id, readMoney(exactText[p.id] ?? "", true)]));
  const exactCents = new Map(people.map((p) => [p.id, exactRead.get(p.id)?.cents ?? null]));
  const exactTotal = [...exactCents.values()].reduce<number>((sum, cents) => sum + (cents ?? 0), 0);

  // The people splitting it, and so who a private expense is shared with.
  const splitIds =
    mode === "equal" ? tickedIds : people.filter((p) => exactCents.get(p.id) !== null).map((p) => p.id);
  // The database's rule: the payer, the people splitting it, and whoever added it (you).
  const involved = new Set([paidBy, ...splitIds, me.id]);
  const onlyMe = involved.size === 1;
  const finalVisibility: Visibility = onlyMe ? "participants" : visibility;

  // The suggestion looks at this group's earlier expenses first (the Add screen loads them).
  const category = pickedCategory ?? suggestCategory(description, data.expenses);

  function nameFor(member: Member): string {
    if (member.id === me.id) return `${member.display_name} (you)`;
    if (!data.members.includes(member)) return `${member.display_name} (left)`;
    return member.display_name;
  }

  function whose(member: Member): string {
    return member.id === me.id ? "Your amount" : `${member.display_name}'s amount`;
  }

  // Amount boxes only take money: a key that would make anything else is ignored.
  function changeAmount(text: string) {
    const read = readMoney(text);
    if (!read) return;
    setLimitNote(null);
    setAmountText(read.text);
  }

  // A person's box never lets the amounts go over the total, not even by a cent: a key
  // that would, or a "+" when nothing is left to add, is ignored with a short note
  // saying why. Lowering an amount always works. (The rule is refuseExactChange.)
  function changeExact(id: string, text: string) {
    const read = readMoney(text, true);
    if (!read) return;
    const refused = refuseExactChange({
      total: amount,
      assigned: exactTotal,
      before: exactCents.get(id) ?? 0,
      after: read.cents ?? 0,
      addsPlus: countPlus(read.text) > countPlus(exactText[id] ?? ""),
    });
    if (refused) {
      setLimitNote({ id, text: refused });
      return;
    }
    setLimitNote(null);
    setExactText((current) => ({ ...current, [id]: read.text }));
  }

  // When you leave a box with a sum in it, show the answer instead ("10+2.5" → "12.50").
  function finishSum(id: string) {
    const cents = exactRead.get(id)?.isSum ? exactCents.get(id) : null;
    if (cents !== null && cents !== undefined && cents >= 0) {
      setExactText((current) => ({ ...current, [id]: centsToDecimal(cents) }));
    }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same photo again still works
    if (!file) return;
    setPhotoProblem(null);
    setPreparingPhoto(true);
    try {
      const blob = await shrinkPhoto(file);
      setNewPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      setPhotoProblem(
        error instanceof PhotoProblem
          ? error.message
          : "We couldn't open that photo. Try taking it again, or choose a JPG or PNG.",
      );
    } finally {
      setPreparingPhoto(false);
    }
  }

  function removePhoto() {
    setPhotoProblem(null);
    if (newPhoto) setNewPhoto(null);
    else setRemoveSaved(true);
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
    setLimitNote(null);
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

  // Every problem with the form, each shown under the box it's about. They're worked
  // out again on every change, so they update as you type and clear once fixed.
  // Wrong values show straight away; missing ones only after the first Save.
  function findErrors(includeMissing: boolean): FormErrors {
    const errors: FormErrors = { people: new Map() };

    const length = Array.from(description.trim()).length;
    if (length > DESCRIPTION_MAX) errors.description = `Keep it to ${DESCRIPTION_MAX} characters or fewer.`;
    else if (length === 0 && includeMissing) errors.description = "Say what the expense was for.";

    if (totalCents !== null && totalCents > MAX_CENTS) {
      errors.amount = `The most one expense can be is ${formatCents(MAX_CENTS)}.`;
    } else if (totalCents === null && includeMissing) {
      errors.amount = "Enter the amount, like 12.50.";
    } else if (totalCents === 0 && includeMissing) {
      errors.amount = "The amount must be more than $0.00.";
    }

    if (includeMissing && !people.some((p) => p.id === paidBy)) errors.paidBy = "Choose who paid.";
    if (includeMissing && !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) errors.date = "Choose the date.";

    if (mode === "equal") {
      if (includeMissing && tickedIds.length === 0) errors.split = "Tick at least one person to split with.";
      return errors;
    }
    for (const p of people) {
      const cents = exactCents.get(p.id) ?? null;
      if (cents !== null && cents < 0) errors.people.set(p.id, `${whose(p)} can't be less than $0.00.`);
      if (cents !== null && cents > MAX_CENTS) {
        errors.people.set(p.id, `${whose(p)} can't be more than ${formatCents(MAX_CENTS)}.`);
      }
    }
    if (includeMissing && splitIds.length === 0) {
      errors.split = "Enter at least one person's amount.";
    } else if (includeMissing && amount !== null && exactTotal !== amount) {
      errors.split = `The amounts must add up to ${formatCents(amount)}.`;
    }
    return errors;
  }

  const errors = findErrors(tried);

  // The box to jump to for the first problem, top to bottom.
  function firstProblemId(found: FormErrors): string | null {
    if (found.description) return ids.description;
    if (found.amount) return ids.amount;
    if (found.paidBy) return ids.paidBy;
    if (found.date) return ids.date;
    const person = people.find((p) => found.people.has(p.id));
    if (person) return `${ids.split}-${person.id}`;
    if (found.split && people.length > 0) return `${ids.split}-${people[0].id}`;
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problemId = firstProblemId(findErrors(true));
    if (problemId || amount === null) {
      setTried(true);
      if (problemId) document.getElementById(problemId)?.focus();
      return;
    }
    // Making a private expense visible to the whole group can't be taken back quietly.
    if (expense?.visibility === "participants" && finalVisibility === "group") {
      const sure = await ask(`Everyone in ${group.name} will see this expense. Continue?`, "Continue", false);
      if (!sure) return;
    }
    const shares = splitIds.map((id) => ({
      member_id: id,
      share_cents: (mode === "equal" ? equalShares?.get(id) : exactCents.get(id)) ?? 0,
    }));
    let expenseId = expense?.id ?? "";
    const saved = await run(
      async () => {
        const result = await supabase.rpc("save_expense", {
          p_group_id: group.id,
          p_description: description.trim(),
          p_amount_cents: amount,
          p_paid_by: paidBy,
          p_shares: shares,
          p_visibility: finalVisibility,
          p_spent_on: spentOn,
          p_expense_id: expense?.id,
          p_category: category,
        });
        if (result.data) expenseId = result.data;
        return result;
      },
      undefined,
      false,
    );
    if (!saved || !expenseId) return;

    // The expense is saved whatever happens next; a photo problem only adds a message.
    let receiptNotice: string | null = null;
    if (newPhoto || (removeSaved && expense?.receipt_path)) {
      setSavingPhoto(true);
      receiptNotice = newPhoto ? await attachReceipt(expenseId, newPhoto.blob) : await detachReceipt(expenseId);
      setSavingPhoto(false);
    }
    onDone({ expenseId, receiptNotice });
  }

  const onlyNames = peopleInvolved(involved, data, me.id);
  // Ids that link each box to the problem shown under it, for screen readers.
  const errorId = (key: string) => `${ids.split}-problem-${key}`;

  return (
    <>
      <form className="expense-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.description}>What for?</label>
          <div className="description-row">
            <input
              id={ids.description}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={DESCRIPTION_MAX}
              placeholder="For example: Groceries"
              autoComplete="off"
              enterKeyHint="next"
              {...problemProps(errorId("description"), errors.description)}
            />
            <CategoryButton value={category} onPick={setPickedCategory} />
          </div>
          <FieldError id={errorId("description")} text={errors.description} />
          <p className="hint" aria-live="polite">
            Category: {categoryFor(category).label}
          </p>
        </div>

        <div className="field">
          <label htmlFor={ids.amount}>Amount (CA$)</label>
          <span className="money-input">
            <span aria-hidden="true">$</span>
            <input
              id={ids.amount}
              value={amountText}
              onChange={(event) => changeAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              enterKeyHint="next"
              {...problemProps(errorId("amount"), errors.amount)}
            />
          </span>
          <FieldError id={errorId("amount")} text={errors.amount} />
        </div>

        <div className="field">
          <label htmlFor={ids.paidBy}>Paid by</label>
          <select
            id={ids.paidBy}
            value={paidBy}
            onChange={(event) => setPaidBy(event.target.value)}
            {...problemProps(errorId("paid-by"), errors.paidBy)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {nameFor(p)}
              </option>
            ))}
          </select>
          <FieldError id={errorId("paid-by")} text={errors.paidBy} />
        </div>

        <div className="field">
          <label htmlFor={ids.date}>Date</label>
          <input
            id={ids.date}
            type="date"
            value={spentOn}
            onChange={(event) => setSpentOn(event.target.value)}
            {...problemProps(errorId("date"), errors.date)}
          />
          <FieldError id={errorId("date")} text={errors.date} />
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

          {mode === "exact" && (
            <p className="hint">
              Leave a box empty if that person isn't in it. A box can add and take away, like 10+2.50.
            </p>
          )}
          <ul className="split-list">
            {people.map((p) => {
              const boxId = `${ids.split}-${p.id}`;
              if (mode === "equal") {
                return (
                  <li key={p.id}>
                    <label className="choice">
                      <input
                        id={boxId}
                        type="checkbox"
                        checked={ticked.has(p.id)}
                        onChange={() => toggle(p.id)}
                        {...problemProps(errorId("split"), errors.split)}
                      />
                      <span>{nameFor(p)}</span>
                    </label>
                    <span className="split-amount">
                      {equalShares?.has(p.id) ? formatCents(equalShares.get(p.id)!) : ""}
                    </span>
                  </li>
                );
              }
              const cents = exactCents.get(p.id) ?? null;
              const problem = errors.people.get(p.id);
              const note = !problem && limitNote?.id === p.id ? limitNote.text : undefined;
              return (
                <li key={p.id}>
                  <label htmlFor={boxId}>{nameFor(p)}</label>
                  {exactRead.get(p.id)?.isSum && cents !== null && (
                    <span className="split-sum">= {formatCents(cents)}</span>
                  )}
                  <span className="money-input small">
                    <span aria-hidden="true">$</span>
                    <input
                      id={boxId}
                      value={exactText[p.id] ?? ""}
                      onChange={(event) => changeExact(p.id, event.target.value)}
                      onBlur={() => finishSum(p.id)}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem || note ? errorId(p.id) : undefined}
                    />
                  </span>
                  <FieldError id={errorId(p.id)} text={problem} live />
                  {note && (
                    <p id={errorId(p.id)} className="field-note" role="status">
                      {note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {mode === "exact" && amount !== null && (
            <p className={exactTotal === amount ? "split-status done" : "split-status"} aria-live="polite">
              {exactTotal < amount && `${formatCents(amount - exactTotal)} left to assign`}
              {/* Only happens if the total is made smaller after the amounts are filled in. */}
              {exactTotal > amount &&
                `${formatCents(exactTotal - amount)} over the total. Lower an amount to fix it.`}
              {exactTotal === amount && `Adds up to ${formatCents(amount)}`}
            </p>
          )}
          <FieldError id={errorId("split")} text={errors.split} />
        </fieldset>

        <fieldset className="receipt-field">
          <legend>Receipt photo</legend>
          {newPhoto ? <ReceiptThumbnail src={newPhoto.url} /> : savedPhoto && <SavedReceipt path={savedPhoto} />}
          {removeSaved && !newPhoto && <p className="hint">The photo will be removed when you save.</p>}
          {preparingPhoto && (
            <p className="hint" role="status">
              Getting the photo ready…
            </p>
          )}
          {/* No "capture", so phones offer both the camera and the gallery. */}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={choosePhoto}
          />
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => photoInput.current?.click()}
              disabled={preparingPhoto || working}
              aria-describedby={photoProblem ? errorId("photo") : undefined}
            >
              {newPhoto || savedPhoto ? "Replace photo" : "Add receipt photo"}
            </button>
            {(newPhoto || savedPhoto) && (
              <button
                type="button"
                className="button secondary danger"
                onClick={removePhoto}
                disabled={preparingPhoto || working}
              >
                Remove photo
              </button>
            )}
          </div>
          {!newPhoto && !savedPhoto && !photoProblem && !preparingPhoto && (
            <p className="hint">Take a photo or choose one. Only people who can see this expense can see it.</p>
          )}
          <FieldError id={errorId("photo")} text={photoProblem ?? undefined} live />
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
          <button type="submit" className="button" disabled={working || preparingPhoto}>
            {savingPhoto ? "Saving the photo…" : expense ? "Save changes" : "Add expense"}
          </button>
          <button type="button" className="button secondary" onClick={() => onDone()} disabled={working}>
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
  for (const [id, cents] of shares) exact[id] = centsToDecimal(cents);
  return { mode: (isEqual ? "equal" : "exact") as SplitMode, ticked: new Set(inSplit), exact };
}

function countPlus(text: string): number {
  return text.split("+").length - 1;
}

// Marks a box as having a problem and links it to the message under it.
function problemProps(errorId: string, problem: string | undefined) {
  return problem ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

// A problem shown right under the box it's about. `live` reads it out as soon as it
// appears (for problems that show up while typing).
function FieldError({ id, text, live }: { id: string; text?: string; live?: boolean }) {
  if (!text) return null;
  return (
    <p id={id} className="field-error" role={live ? "alert" : undefined}>
      {text}
    </p>
  );
}
