import { addedBy, peopleInvolved } from "../lib/expenses";
import { formatDay } from "../lib/format";
import { formatCents } from "../lib/money";
import { paymentInvolvedIds, whoPaidWhom, type Payment } from "../lib/payments";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import type { GroupData, Member } from "../lib/useGroup";
import { LockIcon } from "./LockIcon";
import { Sheet } from "./Sheet";
import { FeedbackLine } from "./Status";
import { useConfirm } from "./useConfirm";

type PaymentDialogProps = {
  data: GroupData;
  me: Member;
  payment: Payment | undefined; // undefined: it was undone while this was open
  onClose: () => void;
  onUndone: (text: string) => void;
};

// One payment: who paid whom, how much, when, and who can see it.
// Whoever recorded it can undo it (it's marked deleted, never erased).
export function PaymentDialog({ data, me, payment, onClose, onUndone }: PaymentDialogProps) {
  const { ask, dialog } = useConfirm();
  const { busy, feedback, run } = useDbAction();

  if (!payment) {
    return (
      <Sheet title="Payment" onClose={onClose}>
        <p role="alert">This payment was undone.</p>
        <button type="button" className="button close-button" onClick={onClose}>
          Close
        </button>
      </Sheet>
    );
  }

  const line = whoPaidWhom(payment, data, me.id);
  const recorder = addedBy(payment, data);
  const iRecordedIt = recorder?.id === me.id;

  async function undo() {
    if (!payment) return;
    const sure = await ask(
      `Undo "${line} ${formatCents(payment.amount_cents)}"? It disappears for everyone, and the balances go back.`,
      "Undo",
    );
    if (!sure) return;
    const undone = await run(
      () => supabase.rpc("delete_settlement", { p_settlement_id: payment.id }),
      undefined,
      false,
    );
    if (undone) onUndone(`Payment undone: ${line} ${formatCents(payment.amount_cents)}.`);
  }

  return (
    <>
      <Sheet title="Payment" onClose={onClose}>
        <p className="expense-amount">{formatCents(payment.amount_cents)}</p>
        <p className="expense-paid">
          {line} on {formatDay(payment.paid_on)}
        </p>
        {payment.visibility === "participants" ? (
          <p className="visibility-badge">
            <LockIcon /> Only {peopleInvolved(paymentInvolvedIds(payment, data), data, me.id)} can see this
          </p>
        ) : (
          <p className="visibility-badge">Everyone in {data.group.name} can see this</p>
        )}

        <div className="expense-footer">
          {/* An account that was deleted leaves no name behind. */}
          <p className="muted">
            Recorded by {iRecordedIt ? "you" : (recorder?.display_name ?? "someone who has left")}. Baantwise only
            records payments; it never moves money.
          </p>
          {iRecordedIt ? (
            <button type="button" className="button secondary danger" onClick={undo} disabled={busy}>
              Undo
            </button>
          ) : (
            <p className="muted">Only {recorder?.display_name ?? "the person who recorded it"} can undo it.</p>
          )}
          <FeedbackLine feedback={feedback} />
        </div>

        <button type="button" className="button secondary close-button" onClick={onClose} disabled={busy}>
          Close
        </button>
      </Sheet>
      {dialog}
    </>
  );
}
