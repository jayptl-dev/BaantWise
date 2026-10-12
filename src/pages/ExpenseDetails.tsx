import { Link, useLocation, useParams } from "react-router";
import { LockIcon } from "../components/LockIcon";
import { SavedReceipt } from "../components/ReceiptPhoto";
import {
  ExpenseDeleted,
  ExpenseMissing,
  FeedbackLine,
  GroupGone,
  GroupMissing,
  LoadError,
  Loading,
} from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { categoryFor } from "../lib/categories";
import { addedBy, involvedIds, peopleById, peopleInvolved, type Expense } from "../lib/expenses";
import { formatDay } from "../lib/format";
import { formatCents } from "../lib/money";
import { clearReceiptFolder } from "../lib/receipts";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import { useExpense } from "../lib/useExpense";
import { useGoBack } from "../lib/useGoBack";
import type { GroupData, Member } from "../lib/useGroup";
import { foreignDetails } from "../lib/currency";

// "/groups/:id/expenses/:expenseId"
export default function ExpenseDetails() {
  const { id = "", expenseId = "" } = useParams();
  return <ExpenseScreen key={`${id}/${expenseId}`} groupId={id} expenseId={expenseId} />;
}

function ExpenseScreen({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const { user } = useAuth();
  const { state, reload } = useExpense(groupId, expenseId, user?.id ?? "");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  const { group } = state.data;
  if (state.status === "expense-missing") return <ExpenseMissing groupId={group.id} groupName={group.name} />;
  if (state.status === "expense-deleted") return <ExpenseDeleted groupId={group.id} groupName={group.name} />;
  return <Details data={state.data} expense={state.expense} me={state.me} />;
}

function Details({ data, expense, me }: { data: GroupData; expense: Expense; me: Member }) {
  const { group } = data;
  const { ask, dialog } = useConfirm();
  const { busy, feedback, run } = useDbAction();
  const goBack = useGoBack();
  const groupLink = `/groups/${group.id}`;
  // Set by the add or edit screen when the expense saved but its photo didn't.
  const receiptNotice = (useLocation().state as { receiptNotice?: string } | null)?.receiptNotice;

  const people = peopleById(data);
  const nameOf = (memberId: string) =>
    memberId === me.id ? "You" : (people.get(memberId)?.display_name ?? "Someone");
  const adder = addedBy(expense, data);
  const iAddedIt = adder?.id === me.id;
  const category = categoryFor(expense.category);

  // Shares in the order people joined the group.
  const order = [...data.members, ...data.formerMembers].map((m) => m.id);
  const shares = [...expense.shares].sort((a, b) => order.indexOf(a.member_id) - order.indexOf(b.member_id));

  async function deleteExpense() {
    const sure = await ask(`Delete "${expense.description}"? It disappears for everyone.`, "Delete");
    if (!sure) return;
    const deleted = await run(() => supabase.rpc("delete_expense", { p_expense_id: expense.id }), undefined, false);
    if (!deleted) return;
    // Tidy up its receipt photos. Quiet: if this fails the files stay private to you.
    void clearReceiptFolder(expense.id);
    goBack(groupLink);
  }

  return (
    <>
      <Link to={groupLink} className="back-link">
        ← Back to {group.name}
      </Link>
      <h1 className="page-title">{expense.description}</h1>
      <p className="expense-amount">{formatCents(expense.amount_cents)}</p>
      {foreignDetails(expense, (d) => formatDay(d, true)) && (
        <p className="expense-foreign">{foreignDetails(expense, (d) => formatDay(d, true))}</p>
      )}
      <p className="expense-paid">
        {nameOf(expense.paid_by)} paid on {formatDay(expense.spent_on)}
      </p>

      <div className="expense-badges">
        <p className="category-badge">
          <span aria-hidden="true">{category.emoji}</span> {category.label}
        </p>
        {expense.visibility === "participants" ? (
          <p className="visibility-badge">
            <LockIcon /> Only {peopleInvolved(involvedIds(expense, data), data, me.id)} can see this
          </p>
        ) : (
          <p className="visibility-badge">Everyone in {group.name} can see this</p>
        )}
      </div>

      <section className="section" aria-labelledby="split-heading">
        <h2 id="split-heading">Split</h2>
        <ul className="share-list">
          {shares.map((share) => (
            <li key={share.member_id}>
              <span className="share-name">{nameOf(share.member_id)}</span>
              <span>{formatCents(share.share_cents)}</span>
            </li>
          ))}
        </ul>
      </section>

      {expense.receipt_path && (
        <section className="section" aria-labelledby="receipt-heading">
          <h2 id="receipt-heading">Receipt</h2>
          <SavedReceipt path={expense.receipt_path} />
        </section>
      )}
      <FeedbackLine feedback={receiptNotice ? { text: receiptNotice, isError: true } : null} />

      <footer className="expense-footer">
        {/* An account that was deleted leaves no name behind. */}
        <p className="muted">Added by {iAddedIt ? "you" : (adder?.display_name ?? "someone who has left")}.</p>
        {iAddedIt ? (
          <div className="button-row">
            <Link to={`${groupLink}/expenses/${expense.id}/edit`} className="button secondary">
              Edit
            </Link>
            <button type="button" className="button secondary danger" onClick={deleteExpense} disabled={busy}>
              Delete
            </button>
          </div>
        ) : (
          <p className="muted">Only {adder?.display_name ?? "the person who added it"} can edit or delete it.</p>
        )}
        <FeedbackLine feedback={feedback} />
      </footer>

      {dialog}
    </>
  );
}
