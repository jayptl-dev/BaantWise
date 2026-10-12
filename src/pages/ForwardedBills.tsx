import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { CategoryEmoji } from "../components/CategoryEmoji";
import { FeedbackLine, GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { formatDay } from "../lib/format";
import {
  billAmount,
  contactCardLink,
  fetchForwarding,
  forwardAddress,
  possibleDuplicate,
  sendSetupEmail,
  type ForwardedBill,
} from "../lib/forwarding";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import { useGroup, type GroupData } from "../lib/useGroup";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

// "/groups/:id/bills": the group's bill address, and my forwarded bills to review.
export default function ForwardedBills() {
  const { id = "" } = useParams();
  return <BillsScreen key={id} id={id} />;
}

function BillsScreen({ id }: { id: string }) {
  const { user } = useAuth();
  // With the group's expenses, to point out a bill that may already be added.
  const { state, reload } = useGroup(id, user?.id ?? "", "all");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <BillsList data={state.data} />;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; token: string | null; bills: ForwardedBill[] };

function BillsList({ data }: { data: GroupData }) {
  const { group, members } = data;
  const { user } = useAuth();
  const { ask, dialog } = useConfirm();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const { busy, feedback, setFeedback, run } = useDbAction(reload);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  useRefreshOnReturn(reload);
  const iAmAdmin = members.some((m) => m.user_id === user?.id && m.is_admin);

  useEffect(() => {
    let active = true;
    fetchForwarding(group.id).then(({ error, token, bills }) => {
      if (!active) return;
      setState((previous) =>
        error
          ? previous.status === "ready"
            ? previous
            : { status: "error", message: friendlyError(error) }
          : { status: "ready", token, bills },
      );
    });
    return () => {
      active = false;
    };
  }, [group.id, version]);

  const address = state.status === "ready" && state.token ? forwardAddress(state.token) : null;

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setFeedback(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedback({ text: `Couldn't copy automatically. The address is ${address}`, isError: true });
    }
  }

  async function emailSteps() {
    setSending(true);
    setFeedback(null);
    const result = await sendSetupEmail(group.id);
    setSending(false);
    setFeedback(
      result.ok
        ? { text: `Sent to ${user?.email ?? "your email"}. It comes from the bill address, so check your inbox.`, isError: false }
        : { text: result.message, isError: true },
    );
  }

  async function newAddress() {
    const sure = await ask(
      "Get a new bill address? The old one stops working right away, so update any Gmail or Outlook rules that forward to it.",
      "Get new address",
      false,
    );
    if (!sure) return;
    await run(() => supabase.rpc("reset_forward_address", { p_group_id: group.id }), "The group has a new bill address.");
  }

  // The generated types say p_expense_id is a uuid, but null means "dismiss".
  async function dismiss(bill: ForwardedBill) {
    const sure = await ask(`Dismiss ${bill.biller ?? "this bill"}? Nothing is added to the group.`, "Dismiss", false);
    if (!sure) return;
    await run(() => supabase.rpc("resolve_forwarded_bill", { p_bill_id: bill.id, p_expense_id: null as unknown as string }), "Dismissed.");
  }

  return (
    <>
      <Link to={`/groups/${group.id}`} className="back-link">
        ← Back to {group.name}
      </Link>
      <h1 className="page-title">Bills by email</h1>
      <p className="muted">
        Forward a bill email to your group's address. Baantwise reads only the biller, the amount and the date, and keeps
        them here for you to check. Nothing is added to the group until you press Save.
      </p>
      <FeedbackLine feedback={feedback} />

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <LoadError message={state.message} onRetry={reload} />}
      {state.status === "ready" && (
        <>
          <section className="section" aria-labelledby="address-heading">
            <h2 id="address-heading">Your group's bill address</h2>
            {address ? (
              <div className="copy-row">
                <span className="copy-main">
                  <span className="copy-label">Forward bills to</span>
                  <span className="copy-value">{address}</span>
                </span>
                <button type="button" className="button secondary copy-button" onClick={copy} aria-live="polite">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <p className="muted">This group doesn't have a bill address yet.</p>
            )}
            <p className="muted">
              Forward from the email you sign in with ({user?.email ?? "your account's email"}). Emails from other
              addresses are turned away.
            </p>
            {state.token && (
              <>
                <p className="save-contact-tip">
                  📇 Save it as a contact. Then forwarding a bill from your phone is just: <strong>Forward</strong> → type{" "}
                  <strong>"Baan"</strong> → <strong>Send</strong>.
                </p>
                <a className="button" href={contactCardLink(state.token, group.name, group.id)}>
                  Save to contacts
                </a>
              </>
            )}
            <div className="button-row">
              <button type="button" className="button secondary" onClick={emailSteps} disabled={sending || !address}>
                {sending ? "Sending…" : "Email me the setup steps"}
              </button>
              {iAmAdmin && (
                <button type="button" className="button secondary" onClick={newAddress} disabled={busy}>
                  Get a new address
                </button>
              )}
            </div>
          </section>

          <section className="section" aria-labelledby="review-heading">
            <h2 id="review-heading">Bills to review</h2>
            {state.bills.length === 0 ? (
              <p className="muted">No bills to review. Forward a bill email to the address above to try it.</p>
            ) : (
              <ul className="expense-list">
                {state.bills.map((bill) => {
                  const duplicate = possibleDuplicate(bill, data.expenses);
                  return (
                    <li key={bill.id} className="bill-row">
                      <span className="expense-main">
                        <span className="expense-title">
                          <CategoryEmoji category={bill.category} /> {bill.biller ?? "Bill"}
                        </span>
                        <span className="expense-sub">
                          {billAmount(bill)}
                          {bill.billDate ? ` · ${formatDay(bill.billDate, true)}` : ""}
                        </span>
                        {duplicate && (
                          <span className="expense-sub bill-duplicate">
                            Already added? "{duplicate.description}" on {formatDay(duplicate.spent_on, true)} has the same amount.
                          </span>
                        )}
                      </span>
                      <span className="button-row">
                        <Link to={`/groups/${group.id}/expenses/new?forwarded=${bill.id}`} className="button">
                          Add expense
                        </Link>
                        <button type="button" className="button secondary" onClick={() => dismiss(bill)} disabled={busy}>
                          Dismiss
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
      {dialog}
    </>
  );
}
