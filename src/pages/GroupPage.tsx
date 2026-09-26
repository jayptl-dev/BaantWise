import { useState } from "react";
import { Link, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { LockIcon } from "../components/LockIcon";
import { NameForm } from "../components/NameForm";
import { ShareDialog } from "../components/ShareDialog";
import { FeedbackLine, GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { involvedIds, myPart, peopleById, peopleInvolved, type Expense } from "../lib/expenses";
import { formatDay, PERSON_NAME_MAX } from "../lib/format";
import { formatCents } from "../lib/money";
import { canUseShareSheet, inviteMessage } from "../lib/share";
import { supabase } from "../lib/supabase";
import { mustChange, useDbAction } from "../lib/useDbAction";
import { useGroup, type GroupData, type Member } from "../lib/useGroup";

// "/groups/:id": one group, its people and its expenses.
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

  // Showing or hiding buttons is only for convenience: the database checks every change.
  const iAmAdmin = members.some((m) => m.user_id === user?.id && m.is_admin);
  const myMemberId = members.find((m) => m.user_id === user?.id)?.id ?? "";
  const inviteLink = `${window.location.origin}/join/${group.invite_token}`;

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
        supabase
          .from("group_members")
          .update({ display_name: name }, { count: "exact" })
          .eq("id", member.id),
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
      makeAdmin
        ? `${member.display_name} is now an admin.`
        : `${member.display_name} is no longer an admin.`,
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
      <div className="group-header">
        <h1 className="page-title">{group.name}</h1>
        <Link
          to={`/groups/${group.id}/settings`}
          className="icon-button"
          aria-label="Group settings"
          title="Group settings"
        >
          <SettingsIcon />
        </Link>
      </div>

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
          <div className="button-row">
            <button type="button" className="button" onClick={shareLink}>
              Share invite link
            </button>
            <button type="button" className="button secondary" onClick={copyLink} aria-live="polite">
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>

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

      <section className="section" aria-labelledby="expenses-heading">
        <h2 id="expenses-heading">Expenses</h2>
        <div className="section-actions">
          <Link to={`/groups/${group.id}/expenses/new`} className="button">
            Add expense
          </Link>
        </div>
        {data.expenses.length === 0 ? (
          <p className="muted">No expenses yet</p>
        ) : (
          <ul className="expense-list">
            {data.expenses.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} data={data} myMemberId={myMemberId} />
            ))}
          </ul>
        )}
      </section>

      {dialog}
      {sharePopupOpen && (
        <ShareDialog groupName={group.name} link={inviteLink} onClose={() => setSharePopupOpen(false)} />
      )}
    </>
  );
}

// One expense: what for, who paid, and what it means for me. Tap for details.
function ExpenseRow({ expense, data, myMemberId }: { expense: Expense; data: GroupData; myMemberId: string }) {
  const payer =
    expense.paid_by === myMemberId ? "You" : (peopleById(data).get(expense.paid_by)?.display_name ?? "Someone");
  const part = myPart(expense, myMemberId);

  return (
    <li>
      <Link to={`/groups/${data.group.id}/expenses/${expense.id}`} className="expense-link">
        <span className="expense-main">
          <span className="expense-title">{expense.description}</span>
          <span className="expense-sub">
            {payer} paid {formatCents(expense.amount_cents)} · {formatDay(expense.spent_on, true)}
          </span>
          {expense.visibility === "participants" && (
            <span className="private-note">
              <LockIcon /> Only {peopleInvolved(involvedIds(expense, data), data, myMemberId)}
            </span>
          )}
        </span>
        {part.kind === "none" ? (
          <span className="my-part none">not involved</span>
        ) : (
          <span className={`my-part ${part.kind}`}>
            {part.kind === "lent" ? "you lent" : "you owe"}
            <strong>{formatCents(part.cents)}</strong>
          </span>
        )}
      </Link>
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
