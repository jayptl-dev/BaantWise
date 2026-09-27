import { Link, useNavigate, useParams } from "react-router";
import { ExpenseForm } from "../components/ExpenseForm";
import { GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { useGoBack } from "../lib/useGoBack";
import { useGroup } from "../lib/useGroup";

// "/groups/:id/expenses/new"
export default function AddExpense() {
  const { id = "" } = useParams();
  return <AddExpenseScreen key={id} id={id} />;
}

function AddExpenseScreen({ id }: { id: string }) {
  const { user } = useAuth();
  const { state, reload } = useGroup(id, user?.id ?? "");
  const goBack = useGoBack();
  const navigate = useNavigate();
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;

  const { data } = state;
  const groupLink = `/groups/${data.group.id}`;
  // The group only loads if you're an active member, so this always finds you.
  const me = data.members.find((m) => m.user_id === user?.id)!;
  return (
    <>
      <Link to={groupLink} className="back-link">
        ← Back to {data.group.name}
      </Link>
      <h1 className="page-title">Add expense</h1>
      <ExpenseForm
        data={data}
        me={me}
        onDone={(saved) => {
          // The expense saved but its photo didn't: open the expense and say so there.
          if (saved?.receiptNotice) {
            navigate(`${groupLink}/expenses/${saved.expenseId}`, {
              replace: true,
              state: { receiptNotice: saved.receiptNotice },
            });
          } else {
            goBack(groupLink);
          }
        }}
      />
    </>
  );
}
