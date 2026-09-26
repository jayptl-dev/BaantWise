import { useCallback, useEffect, useRef, useState } from "react";
import type { Tables } from "./database.types";
import { friendlyError } from "./errors";
import { isUuid } from "./format";
import { supabase } from "./supabase";
import { useRefreshOnReturn } from "./useRefreshOnReturn";

export type Member = {
  id: string;
  user_id: string | null; // null = guest
  display_name: string;
  is_admin: boolean;
  avatar_url: string | null;
};

export type GroupData = {
  group: { id: string; name: string; invite_token: string };
  members: Member[]; // active members only, oldest first
};

export type GroupState =
  | { status: "loading" }
  | { status: "missing" } // couldn't open it: not found, deleted, or you're not a member
  | { status: "gone" } // it was open, then it was deleted or you left or were removed
  | { status: "error"; message: string }
  | { status: "ready"; data: GroupData };

// Loads one group and its active members. Row Level Security means this only
// returns something if the signed-in person is a member.
async function fetchGroup(id: string, userId: string): Promise<GroupState> {
  if (!isUuid(id)) return { status: "missing" };

  const [groupResult, membersResult] = await Promise.all([
    supabase.from("groups").select("id, name, invite_token").eq("id", id).maybeSingle(),
    supabase
      .from("group_members")
      .select("id, user_id, display_name, is_admin")
      .eq("group_id", id)
      .is("removed_at", null)
      .order("created_at"),
  ]);
  if (groupResult.error) return { status: "error", message: friendlyError(groupResult.error) };
  if (!groupResult.data) return { status: "missing" };
  if (membersResult.error) return { status: "error", message: friendlyError(membersResult.error) };
  if (!membersResult.data.some((m) => m.user_id === userId)) return { status: "missing" };

  // Google photos live in profiles. They're optional: if this fails, initials are shown.
  const photos = new Map<string, string | null>();
  const userIds = membersResult.data.flatMap((m) => (m.user_id ? [m.user_id] : []));
  if (userIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, avatar_url").in("id", userIds);
    for (const profile of data ?? []) photos.set(profile.id, profile.avatar_url);
  }

  const members = membersResult.data.map((m) => ({
    ...m,
    avatar_url: m.user_id ? (photos.get(m.user_id) ?? null) : null,
  }));
  return { status: "ready", data: { group: groupResult.data, members } };
}

// Decides what to show after a (re)load.
function settle(previous: GroupState, next: GroupState): GroupState {
  const wasOpen = previous.status === "ready" || previous.status === "gone";
  // It was on screen and now can't be loaded: deleted, or you left or were removed.
  if (next.status === "missing" && wasOpen) return { status: "gone" };
  // A background refresh failed (for example, no internet): keep showing what we have.
  if (next.status === "error" && previous.status === "ready") return previous;
  return next;
}

let channelCount = 0; // gives each live-updates channel its own name

// Loads a group and keeps it up to date:
// - `reload()` fetches again after a change you made,
// - live updates (Supabase Realtime) reload when someone else changes the group,
// - and it catches up when the app comes back into view or back online.
// The current screen stays visible during a reload, so the page doesn't flicker.
export function useGroup(id: string, userId: string) {
  const [state, setState] = useState<GroupState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  // The members on screen, to tell which delete events are about this group.
  const memberIds = useRef(new Set<string>());
  useEffect(() => {
    memberIds.current = new Set(state.status === "ready" ? state.data.members.map((m) => m.id) : []);
  }, [state]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchGroup(id, userId).then((next) => {
      if (active) setState((previous) => settle(previous, next));
    });
    return () => {
      active = false;
    };
  }, [id, userId, version]);

  const reload = useCallback(() => {
    setState((current) =>
      current.status === "ready" || current.status === "gone" ? current : { status: "loading" },
    );
    setVersion((v) => v + 1);
  }, []);

  // Live updates. Only started once we know who is signed in, so the privacy
  // rules can check what this person is allowed to receive.
  useEffect(() => {
    if (!userId || !isUuid(id)) return;

    // Wait half a second, so a burst of changes causes one reload instead of many.
    let timer: number | undefined;
    function reloadSoon() {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 500);
    }

    const channel = supabase
      .channel(`group-${id}-${++channelCount}`)
      .on<Tables<"group_members">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${id}` },
        (change) => {
          // Delete events can't be filtered, so only react to members that are on screen.
          if (change.eventType === "DELETE" && !memberIds.current.has(change.old.id ?? "")) return;
          reloadSoon();
        },
      )
      .on<Tables<"groups">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter: `id=eq.${id}` },
        (change) => {
          if (change.eventType === "DELETE" && change.old.id !== id) return;
          reloadSoon();
        },
      )
      // A deleted group can't be filtered either, so listen to every group delete
      // (only the deleted group's id is sent) and ignore the ones about other groups.
      .on<Tables<"groups">>(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "groups" },
        (change) => {
          if (change.old.id === id) reloadSoon();
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id, userId, reload]);

  useRefreshOnReturn(reload);

  return { state, reload };
}
