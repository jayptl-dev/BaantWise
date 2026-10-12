import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ExpenseForm, type ExpenseTemplate } from "../components/ExpenseForm";
import { GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { fetchBill } from "../lib/recurring";
import { supabase } from "../lib/supabase";
import { useGoBack } from "../lib/useGoBack";
import { useGroup } from "../lib/useGroup";

// "/groups/:id/expenses/new"
export default function AddExpense() {
  const { id = "" } = useParams();
  return <AddExpenseScreen key={id} id={id} />;
}

function AddExpenseScreen({ id }: { id: string }) {
  const { user } = useAuth();
  // With the group's expenses, the same ones the group page shows, so the category can be
  // suggested from what the group called things before.
  const { state, reload } = useGroup(id, user?.id ?? "", "all");
  const goBack = useGoBack();
  const navigate = useNavigate();
  // ?bill=…: a bill to fill in from a recurring expense, so the form starts filled in.
  const billId = useSearchParams()[0].get("bill");
  const [bill, setBill] = useState<
    { status: "none" | "loading" | "gone" } | { status: "error"; message: string } | { status: "ready"; template: ExpenseTemplate }
  >(billId ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!billId) return;
    let active = true;
    fetchBill(id, billId).then(({ error, bill: found, rule }) => {
      if (!active) return;
      if (error) setBill({ status: "error", message: friendlyError(error) });
      else if (!found || !rule) setBill({ status: "gone" });
      else
        setBill({
          status: "ready",
          template: {
            description: rule.description,
            category: rule.category,
            paidBy: rule.paidBy,
            visibility: rule.visibility,
            spentOn: found.dueOn,
            amountCents: null,
            split: rule.split,
          },
        });
    });
    return () => {
      active = false;
    };
  }, [id, billId]);

  if (state.status === "loading" || bill.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;

  const { data } = state;
  const groupLink = `/groups/${data.group.id}`;
  // The group only loads if you're an active member, so this always finds you.
  const me = data.members.find((m) => m.user_id === user?.id)!;
  if (bill.status === "error") return <LoadError message={bill.message} onRetry={() => navigate(0)} />;
  if (bill.status === "gone") {
    return (
      <div className="state">
        <p>This bill was already filled in or skipped.</p>
        <Link to={`${groupLink}/recurring`} className="button secondary">
          Back to recurring expenses
        </Link>
      </div>
    );
  }
  return (
    <>
      <Link to={groupLink} className="back-link">
        ← Back to {data.group.name}
      </Link>
      <h1 className="page-title">{bill.status === "ready" ? `Enter ${bill.template.description}` : "Add expense"}</h1>
      <ExpenseForm
        data={data}
        me={me}
        template={bill.status === "ready" ? bill.template : undefined}
        onDone={async (saved) => {
          // A filled-in bill: mark it done (quietly; the expense is saved either way).
          if (saved && billId) {
            await supabase.rpc("complete_recurring_bill", { p_bill_id: billId, p_expense_id: saved.expenseId });
          }
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
