// Friends: splitting with one person outside any group. A friendship is a private
// two-person group (groups.is_direct), so the group page, expenses, payments,
// balances and settle up all work the same. See
// supabase/migrations/20261013010000_friends.sql for how friends are added.

import { computeBalances } from "./balances";
import { friendlyError } from "./errors";
import { fetchExpenses } from "./expenses";
import { fetchPayments } from "./payments";
import { supabase } from "./supabase";

export const USERNAME_HINT = "3 to 20 lowercase letters, numbers, dots or underscores.";

// "@Shreya.K " → "shreya.k". Returns null when it can't be a username.
export function normalizeUsername(text: string): string | null {
  const name = text.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9_.]{2,19}$/.test(name) ? name : null;
}

export type Friend = {
  groupId: string;
  name: string;
  userId: string | null; // null if they deleted their account
  left: boolean; // they removed you
  overall: number | null; // cents, + they owe you, − you owe them; null if it couldn't load
};

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

// My friends, A–Z, each with what's owed between us.
export async function loadFriends(myUserId: string): Promise<Result<Friend[]>> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, group_members(id, user_id, display_name, removed_at, created_at)")
    .eq("is_direct", true);
  if (error) return { ok: false, message: friendlyError(error) };

  const pairs = data.flatMap((g) => {
    const mine = g.group_members.find((m) => m.user_id === myUserId && m.removed_at === null);
    const other = g.group_members.find((m) => m.id !== mine?.id);
    // A friend link nobody has opened yet has only me in it.
    return mine && other ? [{ groupId: g.id, mine, other }] : [];
  });

  const friends = await Promise.all(
    pairs.map(async ({ groupId, mine, other }): Promise<Friend> => {
      const [expenses, payments] = await Promise.all([fetchExpenses(groupId, "all"), fetchPayments(groupId)]);
      const overall =
        expenses.error || payments.error
          ? null
          : computeBalances(expenses.expenses, payments.payments, mine.id).overall;
      return { groupId, name: other.display_name, userId: other.user_id, left: other.removed_at !== null, overall };
    }),
  );
  friends.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, value: friends };
}

export type Suggestion = { memberId: string; userId: string; name: string; groupName: string };

// People with accounts in my (real) groups who aren't my friends yet.
export async function friendSuggestions(myUserId: string, friendUserIds: Set<string>): Promise<Result<Suggestion[]>> {
  const { data, error } = await supabase
    .from("group_members")
    .select("id, user_id, display_name, groups!inner(name, is_direct, is_sample)")
    .not("user_id", "is", null)
    .is("removed_at", null)
    .eq("groups.is_direct", false)
    .eq("groups.is_sample", false);
  if (error) return { ok: false, message: friendlyError(error) };
  const seen = new Map<string, Suggestion>();
  for (const m of data) {
    if (!m.user_id || m.user_id === myUserId || friendUserIds.has(m.user_id) || seen.has(m.user_id)) continue;
    seen.set(m.user_id, { memberId: m.id, userId: m.user_id, name: m.display_name, groupName: m.groups.name });
  }
  return { ok: true, value: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

// The groups (not friendships or samples) we're both in.
export async function sharedGroups(otherUserId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("groups")
    .select("id, name, group_members!inner(user_id, removed_at)")
    .eq("is_direct", false)
    .eq("is_sample", false)
    .eq("group_members.user_id", otherUserId)
    .is("group_members.removed_at", null);
  return (data ?? []).map((g) => ({ id: g.id, name: g.name }));
}

async function friendship(
  call: PromiseLike<{ data: string | null; error: { message: string } | null }>,
): Promise<Result<string>> {
  const { data, error } = await call;
  if (error || !data) return { ok: false, message: friendlyError(error) };
  return { ok: true, value: data };
}

export const addFriendByUsername = (username: string) =>
  friendship(supabase.rpc("add_friend_by_username", { p_username: username }));

export const addFriendFromMember = (memberId: string) =>
  friendship(supabase.rpc("add_friend_from_member", { p_member_id: memberId }));

// My personal friend link (whoever opens it becomes my friend).
export async function myFriendLink(): Promise<Result<string>> {
  const result = await friendship(supabase.rpc("my_friend_link"));
  return result.ok ? { ok: true, value: `${window.location.origin}/join/${result.value}` } : result;
}
