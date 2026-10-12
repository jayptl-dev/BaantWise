import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ExpenseForm } from "../components/ExpenseForm";
import { GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { fetchRule, type RecurringRule } from "../lib/recurring";
import { useGroup, type GroupData } from "../lib/useGroup";

// "/groups/:id/recurring/new" and "/groups/:id/recurring/:ruleId/edit".
export default function RecurringEdit() {
  const { id = "", ruleId } = useParams();
  return <RecurringEditScreen key={`${id}/${ruleId ?? "new"}`} id={id} ruleId={ruleId} />;
}

function RecurringEditScreen({ id, ruleId }: { id: string; ruleId?: string }) {
  const { user } = useAuth();
  const { state, reload } = useGroup(id, user?.id ?? "");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <RuleForm data={state.data} ruleId={ruleId} />;
}

type RuleState = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | { status: "ready"; rule?: RecurringRule };

function RuleForm({ data, ruleId }: { data: GroupData; ruleId?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const listLink = `/groups/${data.group.id}/recurring`;
  const [state, setState] = useState<RuleState>(ruleId ? { status: "loading" } : { status: "ready" });

  useEffect(() => {
    if (!ruleId) return;
    let active = true;
    fetchRule(data.group.id, ruleId).then(({ error, rule }) => {
      if (!active) return;
      if (error) setState({ status: "error", message: friendlyError(error) });
      else if (!rule || rule.createdBy !== user?.id) setState({ status: "missing" });
      else setState({ status: "ready", rule });
    });
    return () => {
      active = false;
    };
  }, [data.group.id, ruleId, user?.id]);

  // The group only loads if you're an active member, so this always finds you.
  const me = data.members.find((m) => m.user_id === user?.id)!;

  return (
    <>
      <Link to={listLink} className="back-link">
        ← Back to recurring expenses
      </Link>
      <h1 className="page-title">{ruleId ? "Edit recurring expense" : "New recurring expense"}</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <LoadError message={state.message} onRetry={() => navigate(0)} />}
      {state.status === "missing" && (
        <p className="state">
          We couldn't open this recurring expense. It may have been deleted, or only the person who set it up can change it.
        </p>
      )}
      {state.status === "ready" && (
        <ExpenseForm
          data={data}
          me={me}
          recurring={{
            rule: state.rule,
            onSaved: () => navigate(listLink, { replace: true }),
          }}
          onDone={() => navigate(listLink, { replace: true })}
        />
      )}
    </>
  );
}
