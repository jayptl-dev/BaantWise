import { Link, useParams } from "react-router";
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
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;

  const { data } = state;
  // The group only loads if you're an active member, so this always finds you.
  const me = data.members.find((m) => m.user_id === user?.id)!;
  return (
    <>
      <Link to={`/groups/${data.group.id}`} className="back-link">
        ← Back to {data.group.name}
      </Link>
      <h1 className="page-title">Add expense</h1>
      <ExpenseForm data={data} me={me} onDone={() => goBack(`/groups/${data.group.id}`)} />
    </>
  );
}
