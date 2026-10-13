import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { BalancesSection } from "../components/BalancesSection";
import { CategoryEmoji } from "../components/CategoryEmoji";
import { LockIcon } from "../components/LockIcon";
import { MyPartLabel } from "../components/MyPartLabel";
import { NameForm } from "../components/NameForm";
import { PaymentDialog } from "../components/PaymentDialog";
import { ReceiptIcon } from "../components/ReceiptPhoto";
import { BillsNotice } from "../components/BillsNotice";
import { ForwardedBillsNotice } from "../components/ForwardedBillsNotice";
import { ChartIcon } from "../components/ChartIcon";
import { foreignAmount } from "../lib/currency";
import { SearchIcon } from "../components/SearchIcon";
import { ShareDialog } from "../components/ShareDialog";
import { FeedbackLine, GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { sharedGroups } from "../lib/friends";
import { involvedIds, myPart, peopleById, peopleInvolved, type Expense } from "../lib/expenses";
import { formatDay, PERSON_NAME_MAX } from "../lib/format";
import { formatCents } from "../lib/money";
import { newestFirst, paymentInvolvedIds, whoPaidWhom, type Payment } from "../lib/payments";
import { canUseShareSheet, inviteMessage } from "../lib/share";
import { supabase } from "../lib/supabase";
import { mustChange, useDbAction, type Feedback } from "../lib/useDbAction";
import { useGroup, type GroupData, type Member } from "../lib/useGroup";

// "/groups/:id": one group, its balances, its people, and its expenses and payments.
export default function GroupPage() {
  const { id = "" } = useParams();
  // `key` makes everything start fresh if the address switches to another group.
  return <GroupScreen key={id} id={id} />;
}

function GroupScreen({ id }: { id: string }) {
  const { user } = useAuth();
  const { state, reload } = useGroup(id, user?.id ?? "", "all");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <GroupDetails data={state.data} reload={reload} />;
}

function GroupDetails({ data, reload }: { data: GroupData; reload: () => void }) {
  const { group, members } = data;
  const { user } = useAuth();
  const { ask, dialog } = useConfirm();
  const { busy, feedback, setFeedback, run } = useDbAction(reload);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addingGuest, setAddingGuest] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharePopupOpen, setSharePopupOpen] = useState(false);
  const [openPaymentId, setOpenPaymentId] = useState<string | null>(null);
  const [balanceFeedback, setBalanceFeedback] = useState<Feedback>(null);

  // Showing or hiding buttons is only for convenience: the database checks every change.
  const iAmAdmin = members.some((m) => m.user_id === user?.id && m.is_admin);
  // The group only loads if you're an active member, so this always finds you.
  const me = members.find((m) => m.user_id === user?.id)!;
  const myMemberId = me.id;
  const inviteLink = `${window.location.origin}/join/${group.invite_token}`;
  const activity = useMemo(() => newestFirst(data.expenses, data.payments), [data]);

  // After recording or undoing a payment: say so above the balances and load them again.
  function paymentChanged(text: string) {
    setOpenPaymentId(null);
    setBalanceFeedback({ text, isError: false });
    reload();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setFeedback(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedback({ text: `Couldn't copy automatically. Here's the link: ${inviteLink}`, isError: true });
    }
  }

  async function shareLink() {
    setFeedback(null);
    // Phones and tablets: the device's own share menu.
    if (canUseShareSheet()) {
      try {
        await navigator.share({ text: inviteMessage(group.name, inviteLink) });
        return;
      } catch (error) {
        // Closing the share menu without picking an app isn't a problem.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    // Computers, or the share menu failed: our own share pop-up.
    setSharePopupOpen(true);
  }

  async function addGuest(name: string) {
    const added = await run(
      () => supabase.from("group_members").insert({ group_id: group.id, display_name: name }),
      `${name} was added as a guest.`,
    );
    if (added) setAddingGuest(false);
  }

  async function rename(member: Member, name: string) {
    const renamed = await run(() =>
      mustChange(
        supabase.from("group_members").update({ display_name: name }, { count: "exact" }).eq("id", member.id),
        "You can't rename this person.",
      ),
    );
    if (renamed) setEditingId(null);
  }

  async function toggleAdmin(member: Member) {
    setMenuFor(null);
    const makeAdmin = !member.is_admin;
    await run(
      () => supabase.rpc("set_member_admin", { p_member_id: member.id, p_make_admin: makeAdmin }),
      makeAdmin ? `${member.display_name} is now an admin.` : `${member.display_name} is no longer an admin.`,
    );
  }

  async function removeMember(member: Member) {
    setMenuFor(null);
    const sure = await ask(`Remove ${member.display_name}? They'll lose access straight away.`, "Remove");
    if (!sure) return;
    // Removing someone with an account also resets the invite link; reloading picks up the new one.
    await run(
      () => supabase.rpc("remove_member", { p_member_id: member.id }),
      member.user_id
        ? `${member.display_name} was removed. The invite link was reset, so share the new one if you need it.`
        : `${member.display_name} was removed.`,
    );
  }

  return (
    <>
      {/* The installed app has no browser back button, so every page has its own way back. */}
      {group.is_direct ? (
        <Link to="/friends" className="back-link">
          ← Friends
        </Link>
      ) : (
        <Link to="/" className="back-link">
          ← Your groups
        </Link>
      )}
      <div className="group-header">
        <h1 className="page-title">{group.name}</h1>
        <div className="header-actions">
          <Link
            to={`/groups/${group.id}/search`}
            className="icon-button"
            aria-label={`Search ${group.name}`}
            title="Search this group"
          >
            <SearchIcon />
          </Link>
          <Link
            to={`/groups/${group.id}/spending`}
            className="icon-button"
            aria-label={`Spending in ${group.name}`}
            title="Spending charts"
          >
            <ChartIcon />
          </Link>
          <Link
            to={`/groups/${group.id}/settings`}
            className="icon-button"
            aria-label="Group settings"
            title="Group settings"
          >
            <SettingsIcon />
          </Link>
        </div>
      </div>

      {group.is_sample && (
        <p className="sample-note" role="note">
          <strong>This is a sample group.</strong> Nothing here is real, so try anything: add expenses, record payments,
          change splits. Receipt scanning, bills by email and invites are off here. Delete it anytime in group settings.
        </p>
      )}

      <BalancesSection data={data} me={me} feedback={balanceFeedback} onSaved={paymentChanged} />

      <section className="section" aria-labelledby="expenses-heading">
        <h2 id="expenses-heading">Expenses and payments</h2>
        <div className="section-actions">
          <Link to={`/groups/${group.id}/expenses/new`} className="button">
            Add expense
          </Link>
          {group.is_sample ? (
            <Link to={`/groups/${group.id}/recurring`} className="button secondary">
              🔁 Recurring
            </Link>
          ) : (
            <div className="button-pair">
              <Link to={`/groups/${group.id}/recurring`} className="button secondary">
                🔁 Recurring
              </Link>
              <Link to={`/groups/${group.id}/bills`} className="button secondary">
                📧 Bills by email
              </Link>
            </div>
          )}
        </div>
        <BillsNotice groupId={group.id} />
        <ForwardedBillsNotice groupId={group.id} />
        {activity.length === 0 ? (
          <p className="muted">No expenses yet</p>
        ) : (
          <ul className="expense-list">
            {activity.map((entry) =>
              entry.kind === "expense" ? (
                <ExpenseRow key={entry.expense.id} expense={entry.expense} data={data} myMemberId={myMemberId} />
              ) : (
                <PaymentRow
                  key={entry.payment.id}
                  payment={entry.payment}
                  data={data}
                  myMemberId={myMemberId}
                  onOpen={() => setOpenPaymentId(entry.payment.id)}
                />
              ),
            )}
          </ul>
        )}
      </section>

      {group.is_direct ? (
        <SharedGroups otherUserId={members.find((m) => m.user_id !== user?.id)?.user_id ?? null} />
      ) : (
        <>
          <section className="section" aria-labelledby="people-heading">
            <h2 id="people-heading">People</h2>
            <ul className="member-list">
              {members.map((member) => {
                const isMe = member.user_id === user?.id;
                return (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isMe={isMe}
                    canRename={isMe || member.user_id === null || iAmAdmin}
                    canManage={iAmAdmin && !isMe}
                    editing={editingId === member.id}
                    menuOpen={menuFor === member.id}
                    busy={busy}
                    onStartRename={() => {
                      setEditingId(member.id);
                      setMenuFor(null);
                      setFeedback(null);
                    }}
                    onCancelRename={() => setEditingId(null)}
                    onRename={(name) => rename(member, name)}
                    onToggleMenu={() => {
                      setMenuFor(menuFor === member.id ? null : member.id);
                      setFeedback(null);
                    }}
                    onToggleAdmin={() => toggleAdmin(member)}
                    onRemove={() => removeMember(member)}
                  />
                );
              })}
            </ul>
            <FeedbackLine feedback={feedback} />

            <div className="section-actions">
              {!group.is_sample && (
                <div className="button-pair">
                  <button type="button" className="button" onClick={shareLink}>
                    Share invite link
                  </button>
                  <button type="button" className="button secondary" onClick={copyLink} aria-live="polite">
                    {copied ? "Link copied" : "Copy link"}
                  </button>
                </div>
              )}

              {addingGuest ? (
                <NameForm
                  label="Guest's name"
                  hint="A guest is just a name, for someone who won't sign in."
                  max={PERSON_NAME_MAX}
                  submitLabel="Add guest"
                  emptyMessage="Type the guest's name."
                  busy={busy}
                  autoFocus
                  onSubmit={addGuest}
                  onCancel={() => setAddingGuest(false)}
                />
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setAddingGuest(true);
                    setFeedback(null);
                  }}
                >
                  Add a guest
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {dialog}
      {sharePopupOpen && (
        <ShareDialog groupName={group.name} link={inviteLink} onClose={() => setSharePopupOpen(false)} />
      )}
      {openPaymentId && (
        <PaymentDialog
          data={data}
          me={me}
          payment={data.payments.find((p) => p.id === openPaymentId)}
          onClose={() => setOpenPaymentId(null)}
          onUndone={paymentChanged}
        />
      )}
    </>
  );
}

// One expense: its category, what for, who paid, and what it means for me. Tap for details.
function ExpenseRow({ expense, data, myMemberId }: { expense: Expense; data: GroupData; myMemberId: string }) {
  const payer =
    expense.paid_by === myMemberId ? "You" : (peopleById(data).get(expense.paid_by)?.display_name ?? "Someone");
  const part = myPart(expense, myMemberId);

  return (
    <li>
      <Link to={`/groups/${data.group.id}/expenses/${expense.id}`} className="expense-link">
        <span className="expense-icon">
          <CategoryEmoji category={expense.category} />
        </span>
        <span className="expense-main">
          <span className="expense-title">
            {expense.description}
            {expense.receipt_path && <ReceiptIcon />}
            {expense.recurring_id && (
              <span className="repeat-mark" title="Added by a recurring expense">
                <span aria-hidden="true"> 🔁</span>
                <span className="visually-hidden"> (recurring)</span>
              </span>
            )}
          </span>
          <span className="expense-sub">
            {payer} paid {formatCents(expense.amount_cents)}
            {foreignAmount(expense) && <> ({foreignAmount(expense)})</>} · {formatDay(expense.spent_on, true)}
          </span>
          {expense.visibility === "participants" && (
            <span className="private-note">
              <LockIcon /> Only {peopleInvolved(involvedIds(expense, data), data, myMemberId)}
            </span>
          )}
        </span>
        <MyPartLabel part={part} />
      </Link>
    </li>
  );
}

// One payment: "Sam paid Jay $30.00", with a lock if it's private. Tap for details.
function PaymentRow({
  payment,
  data,
  myMemberId,
  onOpen,
}: {
  payment: Payment;
  data: GroupData;
  myMemberId: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" className="expense-link" onClick={onOpen}>
        <span className="expense-icon payment" aria-hidden="true">
          ⇄
        </span>
        <span className="expense-main">
          <span className="expense-title">
            {whoPaidWhom(payment, data, myMemberId)} {formatCents(payment.amount_cents)}
          </span>
          <span className="expense-sub">Payment · {formatDay(payment.paid_on, true)}</span>
          {payment.visibility === "participants" && (
            <span className="private-note">
              <LockIcon /> Only {peopleInvolved(paymentInvolvedIds(payment, data), data, myMemberId)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

type MemberRowProps = {
  member: Member;
  isMe: boolean;
  canRename: boolean;
  canManage: boolean; // admin actions for someone else
  editing: boolean;
  menuOpen: boolean;
  busy: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => void;
  onToggleMenu: () => void;
  onToggleAdmin: () => void;
  onRemove: () => void;
};

function MemberRow(props: MemberRowProps) {
  const { member, isMe, canRename, canManage, editing, menuOpen, busy } = props;
  const isGuest = member.user_id === null;

  return (
    <li className="member">
      <Avatar name={member.display_name} url={member.avatar_url} />
      <div className="member-main">
        {editing ? (
          <NameForm
            label={`New name for ${member.display_name}`}
            initial={member.display_name}
            max={PERSON_NAME_MAX}
            submitLabel="Save"
            emptyMessage="Type a name."
            busy={busy}
            autoFocus
            onSubmit={props.onRename}
            onCancel={props.onCancelRename}
          />
        ) : (
          <>
            {canRename ? (
              <button
                type="button"
                className="member-name rename"
                onClick={props.onStartRename}
                disabled={busy}
                aria-label={`Rename ${member.display_name}`}
              >
                {member.display_name}
              </button>
            ) : (
              <span className="member-name">{member.display_name}</span>
            )}
            <span className="badges">
              {isMe && <span className="badge">You</span>}
              {member.is_admin && <span className="badge">Admin</span>}
              {isGuest && <span className="badge">Guest</span>}
            </span>
          </>
        )}
      </div>

      {canManage && !editing && (
        <button
          type="button"
          className="icon-button"
          onClick={props.onToggleMenu}
          disabled={busy}
          aria-expanded={menuOpen}
          aria-label={`More options for ${member.display_name}`}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      )}

      {canManage && menuOpen && !editing && (
        <div className="member-menu">
          {!isGuest && (
            <button type="button" className="button secondary" onClick={props.onToggleAdmin} disabled={busy}>
              {member.is_admin ? "Remove admin" : "Make admin"}
            </button>
          )}
          <button type="button" className="button secondary danger" onClick={props.onRemove} disabled={busy}>
            Remove from group
          </button>
        </div>
      )}
    </li>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1l2.1-2.1M17 7l2.1-2.1" />
    </svg>
  );
}

// On a friend's page: the groups you're both in, so their group balances are a tap away.
function SharedGroups({ otherUserId }: { otherUserId: string | null }) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!otherUserId) return;
    let active = true;
    sharedGroups(otherUserId).then((list) => active && setGroups(list));
    return () => {
      active = false;
    };
  }, [otherUserId]);
  if (groups.length === 0) return null;
  return (
    <section className="section" aria-labelledby="shared-groups-heading">
      <h2 id="shared-groups-heading">Groups you're both in</h2>
      <p className="muted shared-note">Money in these groups is settled inside each group.</p>
      <ul className="group-list">
        {groups.map((g) => (
          <li key={g.id}>
            <Link to={`/groups/${g.id}`} className="group-link">
              <span className="group-name">{g.name}</span>
              <span className="muted">Open</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
