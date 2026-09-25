import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "./errors";
import { isUuid } from "./format";
import { supabase } from "./supabase";

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
  | { status: "missing" } // not found, deleted, or you're no longer a member
  | { status: "error"; message: string }
  | { status: "ready"; data: GroupData };

// Loads one group and its active members. Row Level Security means this only
// returns something if the signed-in person is a member.
async function fetchGroup(id: string): Promise<GroupState> {
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

// `reload()` fetches again after a change. The current screen stays visible
// while it does, so the page doesn't flicker.
export function useGroup(id: string) {
  const [state, setState] = useState<GroupState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetchGroup(id).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [id, version]);

  const reload = useCallback(() => {
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    setVersion((v) => v + 1);
  }, []);

  return { state, reload };
}
