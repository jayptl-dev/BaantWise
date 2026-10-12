import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ExpenseForm, type ExpenseTemplate } from "../components/ExpenseForm";
import { GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { billAmount, fetchForwardedBill } from "../lib/forwarding";
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
  // ?forwarded=…: a bill someone forwarded by email (see ForwardedBills), the same way.
  const [params] = useSearchParams();
  const recurringBillId = params.get("bill");
  const forwardedId = recurringBillId ? null : params.get("forwarded");
  const billId = recurringBillId ?? forwardedId;
  const [bill, setBill] = useState<
    { status: "none" | "loading" | "gone" } | { status: "error"; message: string } | { status: "ready"; template: ExpenseTemplate }
  >(billId ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!billId) return;
    let active = true;
    if (forwardedId) {
      fetchForwardedBill(id, forwardedId).then(({ error, bill: found }) => {
        if (!active) return;
        if (error) setBill({ status: "error", message: friendlyError(error) });
        else if (!found) setBill({ status: "gone" });
        else
          setBill({
            status: "ready",
            template: {
              description: found.biller ?? "",
              category: found.category,
              paidBy: "",
              visibility: "group",
              spentOn: found.billDate ?? found.receivedAt.slice(0, 10),
              amountCents: found.amountCents,
              currency: found.currency,
              notes: [
                found.amountCents === null
                  ? "From the bill you forwarded. We couldn't find the amount, so please enter it."
                  : `From the bill you forwarded (${billAmount(found)}). Check the details and the split, then save.`,
              ],
            },
          });
      });
      return () => {
        active = false;
      };
    }
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
  }, [id, billId, forwardedId]);

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
        <p>{forwardedId ? "This bill was already added or dismissed." : "This bill was already filled in or skipped."}</p>
        <Link to={forwardedId ? `${groupLink}/bills` : `${groupLink}/recurring`} className="button secondary">
          {forwardedId ? "Back to bills by email" : "Back to recurring expenses"}
        </Link>
      </div>
    );
  }
  // A forwarded bill is paid by me unless I change it.
  const template = bill.status === "ready" ? { ...bill.template, paidBy: bill.template.paidBy || me.id } : undefined;
  return (
    <>
      <Link to={groupLink} className="back-link">
        ← Back to {data.group.name}
      </Link>
      <h1 className="page-title">
        {forwardedId ? "Add forwarded bill" : bill.status === "ready" ? `Enter ${bill.template.description}` : "Add expense"}
      </h1>
      <ExpenseForm
        data={data}
        me={me}
        template={template}
        onDone={async (saved) => {
          // A filled-in bill: mark it done (quietly; the expense is saved either way).
          if (saved && recurringBillId) {
            await supabase.rpc("complete_recurring_bill", { p_bill_id: recurringBillId, p_expense_id: saved.expenseId });
          }
          if (saved && forwardedId) {
            await supabase.rpc("resolve_forwarded_bill", { p_bill_id: forwardedId, p_expense_id: saved.expenseId });
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
