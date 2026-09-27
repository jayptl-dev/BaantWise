import { Link, useNavigate, useParams } from "react-router";
import { ExpenseForm } from "../components/ExpenseForm";
import {
  ExpenseDeleted,
  ExpenseMissing,
  GroupGone,
  GroupMissing,
  LoadError,
  Loading,
} from "../components/Status";
import { useAuth } from "../lib/auth";
import { addedBy } from "../lib/expenses";
import { useExpense } from "../lib/useExpense";
import { useGoBack } from "../lib/useGoBack";

// "/groups/:id/expenses/:expenseId/edit"
export default function EditExpense() {
  const { id = "", expenseId = "" } = useParams();
  return <EditExpenseScreen key={`${id}/${expenseId}`} groupId={id} expenseId={expenseId} />;
}

function EditExpenseScreen({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const { user } = useAuth();
  const { state, reload } = useExpense(groupId, expenseId, user?.id ?? "");
  const goBack = useGoBack();
  const navigate = useNavigate();
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  const { group } = state.data;
  if (state.status === "expense-missing") return <ExpenseMissing groupId={group.id} groupName={group.name} />;
  if (state.status === "expense-deleted") return <ExpenseDeleted groupId={group.id} groupName={group.name} />;

  const { data, expense, me } = state;
  const detailsLink = `/groups/${group.id}/expenses/${expense.id}`;

  // Only the person who added it can edit it. The database checks this too.
  if (expense.created_by !== user?.id) {
    const adder = addedBy(expense, data);
    return (
      <div className="state">
        <p>Only {adder?.display_name ?? "the person who added it"} can edit this expense.</p>
        <Link to={detailsLink} className="button secondary">
          Back to the expense
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link to={detailsLink} className="back-link">
        ← Back to {expense.description}
      </Link>
      <h1 className="page-title">Edit expense</h1>
      <ExpenseForm
        data={data}
        me={me}
        expense={expense}
        onDone={(saved) => {
          // The changes saved but the photo part didn't: say so on the expense.
          if (saved?.receiptNotice) {
            navigate(detailsLink, { replace: true, state: { receiptNotice: saved.receiptNotice } });
          } else {
            goBack(detailsLink);
          }
        }}
      />
    </>
  );
}
