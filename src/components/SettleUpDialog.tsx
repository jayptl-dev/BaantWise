import { useId, useState, type FormEvent } from "react";
import type { Visibility } from "../lib/expenses";
import { todayLocal } from "../lib/format";
import { centsToDecimal, formatCents, readMoney } from "../lib/money";
import { payPalUrl } from "../lib/payDetails";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import type { Member } from "../lib/useGroup";
import { LockIcon } from "./LockIcon";
import { Sheet } from "./Sheet";
import { FeedbackLine } from "./Status";

type SettleUpDialogProps = {
  groupId: string;
  groupName: string;
  me: Member;
  from: Member; // who pays
  to: Member; // who gets the money
  owed: number; // the full debt right now, in cents (0 if it was settled meanwhile)
  visibility: Visibility; // "group" for a group debt, "participants" for a private one
  onClose: () => void;
  onSaved: (text: string) => void;
};

// Records a payment. Baantwise never moves money: this only writes down that it happened.
// - "Pay" (I owe): shows how to pay them, then "Mark as paid".
// - "Received" (I'm owed): "Mark as received".
// - Between two guests: anyone can "Record payment".
// The amount starts at the full debt and can be lowered for a part-payment, but never raised above it.
export function SettleUpDialog({
  groupId,
  groupName,
  me,
  from,
  to,
  owed,
  visibility,
  onClose,
  onSaved,
}: SettleUpDialogProps) {
  const { busy, feedback, run } = useDbAction();
  const [amountText, setAmountText] = useState(owed > 0 ? centsToDecimal(owed) : "");
  const [note, setNote] = useState<string | null>(null); // why a key was ignored
  const [problem, setProblem] = useState<string | null>(null); // shown after pressing the button
  const amountId = useId();
  const messageId = useId();

  const mode = from.id === me.id ? "pay" : to.id === me.id ? "received" : "record";
  const cents = readMoney(amountText)?.cents ?? null;
  const valid = cents !== null && cents > 0 && cents <= owed ? cents : null;
  const toName = to.id === me.id ? "you" : to.display_name;
  // A private debt is always between me and one other person.
  const other = from.id === me.id ? to : from;

  const title =
    mode === "pay"
      ? `Pay ${to.display_name}`
      : mode === "received"
        ? `Received from ${from.display_name}`
        : "Record a payment";
  const owesLine =
    mode === "pay"
      ? `You owe ${to.display_name} ${formatCents(owed)}. Lower it to pay part of it.`
      : `${from.display_name} owes ${toName} ${formatCents(owed)}. Lower it if they paid part of it.`;
  const buttonLabel = mode === "pay" ? "Mark as paid" : mode === "received" ? "Mark as received" : "Record payment";

  // The box only takes money, and never more than is owed: a key that would go over
  // is ignored with a short note. Lowering it always works.
  function changeAmount(text: string) {
    const read = readMoney(text);
    if (!read) return;
    setProblem(null);
    if (read.cents !== null && read.cents > owed && read.cents > (cents ?? 0)) {
      setNote(`The full amount is ${formatCents(owed)}, so it can't be more.`);
      return;
    }
    setNote(null);
    setAmountText(read.text);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (cents === null || cents <= 0) return setProblem("Enter an amount more than $0.00.");
    if (cents > owed) return setProblem(`The most it can be is ${formatCents(owed)}, the full amount.`);
    setProblem(null);
    const saved = await run(
      () =>
        supabase.from("settlements").insert({
          group_id: groupId,
          from_member: from.id,
          to_member: to.id,
          amount_cents: cents,
          visibility,
          paid_on: todayLocal(),
        }),
      undefined,
      false,
    );
    if (!saved) return;
    const amount = formatCents(cents);
    if (mode === "pay") onSaved(`Marked as paid: you paid ${to.display_name} ${amount}.`);
    else if (mode === "received") onSaved(`Marked as received: ${from.display_name} paid you ${amount}.`);
    else onSaved(`Recorded: ${from.display_name} paid ${to.display_name} ${amount}.`);
  }

  if (owed <= 0) {
    return (
      <Sheet title={title} onClose={onClose}>
        <p>Nothing is owed here any more. The balances changed while this was open.</p>
        <button type="button" className="button close-button" onClick={onClose}>
          Close
        </button>
      </Sheet>
    );
  }

  const message = problem ?? note;
  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={amountId}>Amount (CA$)</label>
        <p className="hint">{owesLine}</p>
        <span className="money-input">
          <span aria-hidden="true">$</span>
          <input
            id={amountId}
            value={amountText}
            onChange={(event) => changeAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={problem ? true : undefined}
            aria-describedby={message ? messageId : undefined}
          />
        </span>
        {message && (
          <p id={messageId} className={problem ? "field-error" : "field-note"} role={problem ? "alert" : "status"}>
            {message}
          </p>
        )}

        {mode === "pay" && <HowToPay to={to} cents={valid} />}

        <p className="settle-visibility">
          {visibility === "participants" ? (
            <span className="private-note">
              <LockIcon /> Only you and {other.display_name} will see this payment.
            </span>
          ) : (
            `Everyone in ${groupName} will see this payment.`
          )}
        </p>

        <FeedbackLine feedback={feedback} />
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            {buttonLabel}
          </button>
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// The ways to pay someone, from the details on their profile. `cents` is null while
// the amount isn't valid, so nothing wrong gets copied or sent to PayPal.
function HowToPay({ to, cents }: { to: Member; cents: number | null }) {
  const name = to.display_name;
  if (!to.interac_contact && !to.paypal_me) {
    return <p className="pay-note">{name} hasn't added payment details. Pay however you like, then mark it as paid.</p>;
  }
  return (
    <div className="pay-options">
      {to.interac_contact && (
        <div className="pay-option">
          <h3>Interac e-Transfer</h3>
          <CopyRow label="Send to" what="email or phone" text={to.interac_contact} />
          <CopyRow
            label="Amount"
            what="amount"
            text={cents === null ? null : centsToDecimal(cents)}
            shown={cents === null ? "—" : formatCents(cents)}
          />
          <p className="hint">Send it from your bank's app, then tap Mark as paid.</p>
        </div>
      )}
      {to.paypal_me && (
        <div className="pay-option">
          <h3>PayPal</h3>
          {cents === null ? (
            <button type="button" className="button secondary" disabled>
              Pay with PayPal
            </button>
          ) : (
            <a
              className="button secondary"
              href={payPalUrl(to.paypal_me, cents)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Pay with PayPal
            </a>
          )}
          <p className="hint">Opens PayPal in a new tab. Come back and tap Mark as paid afterwards.</p>
        </div>
      )}
    </div>
  );
}

type CopyRowProps = {
  label: string;
  what: string; // read out by screen readers: "Copy amount"
  text: string | null; // what gets copied; null = nothing to copy yet
  shown?: string; // what's shown, if different
};

// A value with a Copy button next to it.
function CopyRow({ label, what, text, shown }: CopyRowProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="copy-row">
      <span className="copy-main">
        <span className="copy-label">{label}</span>
        <span className="copy-value">{shown ?? text}</span>
      </span>
      <button
        type="button"
        className="button secondary copy-button"
        onClick={copy}
        disabled={text === null}
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy"}
        <span className="visually-hidden"> {what}</span>
      </button>
      {failed && <p className="field-error">Couldn't copy automatically. Select it and copy it yourself.</p>}
    </div>
  );
}
