import { Link, useNavigate, useParams } from "react-router";
import { DefaultSplitSection } from "../components/DefaultSplitSection";
import { NameForm } from "../components/NameForm";
import { FeedbackLine, GroupGone, GroupMissing, LoadError, Loading } from "../components/Status";
import { useConfirm } from "../components/useConfirm";
import { useAuth } from "../lib/auth";
import { GROUP_NAME_MAX } from "../lib/format";
import { supabase } from "../lib/supabase";
import { mustChange, useDbAction } from "../lib/useDbAction";
import { useGroup, type GroupData } from "../lib/useGroup";

// "/groups/:id/settings"
export default function GroupSettings() {
  const { id = "" } = useParams();
  return <SettingsScreen key={id} id={id} />;
}

function SettingsScreen({ id }: { id: string }) {
  const { user } = useAuth();
  const { state, reload } = useGroup(id, user?.id ?? "");
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") return <GroupMissing />;
  if (state.status === "gone") return <GroupGone />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  return <SettingsDetails data={state.data} reload={reload} />;
}

function SettingsDetails({ data, reload }: { data: GroupData; reload: () => void }) {
  const { group, members } = data;
  const { user } = useAuth();
  const navigate = useNavigate();
  const { ask, dialog } = useConfirm();
  const { busy, feedback, run } = useDbAction(reload);

  // Hiding admin buttons is only for convenience: the database checks every change.
  const iAmAdmin = members.some((m) => m.user_id === user?.id && m.is_admin);
  const adminNames = members
    .filter((m) => m.is_admin)
    .map((m) => m.display_name)
    .join(", ");

  async function renameGroup(name: string) {
    await run(
      () =>
        mustChange(
          supabase.from("groups").update({ name }, { count: "exact" }).eq("id", group.id),
          "Only a group admin can do this",
        ),
      "Group name saved.",
    );
  }

  async function resetLink() {
    const sure = await ask(
      "Reset the invite link? The old link will stop working, so anyone who hasn't joined yet will need the new one.",
      "Reset link",
      false,
    );
    if (!sure) return;
    await run(
      () => supabase.rpc("reset_invite_link", { p_group_id: group.id }),
      "Done. The old link no longer works. Share the new one from the group page.",
    );
  }

  async function leaveGroup() {
    const sure = await ask(
      `Leave "${group.name}"? You'll lose access straight away. You can come back later with an invite link.`,
      "Leave group",
    );
    if (!sure) return;
    const left = await run(() => supabase.rpc("leave_group", { p_group_id: group.id }), undefined, false);
    if (left) navigate("/", { replace: true, state: { notice: `You left "${group.name}".` } });
  }

  async function deleteGroup() {
    const sure = await ask(
      `Delete "${group.name}" for everyone? Everything in it will be gone. This can't be undone.`,
      "Delete group",
    );
    if (!sure) return;
    const deleted = await run(
      () =>
        mustChange(
          supabase.from("groups").delete({ count: "exact" }).eq("id", group.id),
          "Only a group admin can do this",
        ),
      undefined,
      false,
    );
    if (deleted) navigate("/", { replace: true, state: { notice: `"${group.name}" was deleted.` } });
  }

  return (
    <>
      <Link to={`/groups/${group.id}`} className="back-link">
        ← Back to {group.name}
      </Link>
      <h1 className="page-title">Group settings</h1>
      <p>Admins: {adminNames || "none"}</p>
      {!iAmAdmin && <p className="muted">Only admins can rename the group or change the invite link.</p>}
      <FeedbackLine feedback={feedback} />

      {iAmAdmin && (
        <>
          <section className="section">
            <NameForm
              key={group.name}
              label="Group name"
              initial={group.name}
              max={GROUP_NAME_MAX}
              submitLabel="Save name"
              emptyMessage="Give the group a name."
              busy={busy}
              onSubmit={renameGroup}
            />
          </section>

          <DefaultSplitSection key={JSON.stringify(group.default_split)} data={data} busy={busy} run={run} />

          {!group.is_sample && (
            <section className="section" aria-labelledby="invite-heading">
              <h2 id="invite-heading">Invite link</h2>
              <p className="muted">
                Make a new link if the old one was shared with the wrong people. The old link stops working.
              </p>
              <button type="button" className="button secondary" onClick={resetLink} disabled={busy}>
                Reset invite link
              </button>
            </section>
          )}
        </>
      )}

      <section className="section" aria-labelledby="leave-heading">
        <h2 id="leave-heading">{iAmAdmin ? "Leave or delete" : "Leave"}</h2>
        <div className="button-row">
          {/* A sample has nobody else in it, so it's deleted rather than left. */}
          {!group.is_sample && (
            <button type="button" className="button secondary danger" onClick={leaveGroup} disabled={busy}>
              Leave group
            </button>
          )}
          {iAmAdmin && (
            <button type="button" className="button danger" onClick={deleteGroup} disabled={busy}>
              Delete group
            </button>
          )}
        </div>
      </section>

      {dialog}
    </>
  );
}
