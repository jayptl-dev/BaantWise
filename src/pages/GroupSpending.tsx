import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { SpendingCharts } from "../components/SpendingCharts";
import { GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { groupSpendingRows } from "../lib/spending";
import { useGroup, type GroupData } from "../lib/useGroup";

// "/groups/:id/spending": where the group's shared money goes.
// Only expenses the whole group can see count, so everyone sees the same numbers.
export default function GroupSpending() {
  const { id = "" } = useParams();
  return <SpendingScreen key={id} id={id} />;
}

function SpendingScreen({ id }: { id: string }) {
  const { user } = useAuth();
  // The same loading (and live updates) as the group page.
  const { state, reload } = useGroup(id, user?.id ?? "", "all");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <Spending data={state.data} />;
}

function Spending({ data }: { data: GroupData }) {
  const rows = useMemo(() => groupSpendingRows(data.group.id, data.expenses), [data]);
  return (
    <>
      <Link to={`/groups/${data.group.id}`} className="back-link">
        ← Back to {data.group.name}
      </Link>
      <h1 className="page-title">Spending</h1>
      <p className="muted">
        Shared expenses in {data.group.name}. Private expenses aren't counted here; they show in your own My spending.
      </p>
      <SpendingCharts rows={rows} mine={false} />
    </>
  );
}
