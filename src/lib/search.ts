import type { Share, Visibility } from "./expenses";
import { isUuid } from "./format";
import { supabase } from "./supabase";

export const SEARCH_PAGE_SIZE = 50;

// One group I'm in, and who I am in it.
export type Membership = { groupId: string; groupName: string; memberId: string };

export type SearchFilters = {
  text: string;
  groupId: string | null; // null = all my groups
  from: string; // "2026-09-01", or "" for no start date
  to: string; // "" for no end date
  onlyMine: boolean; // only expenses I paid or have a share above $0 in
};

export type SearchResult = {
  id: string;
  group_id: string;
  groupName: string;
  description: string;
  amount_cents: number;
  paid_by: string; // member id
  spent_on: string;
  visibility: Visibility;
  receipt_path: string | null; // the receipt photo, if it has one
  shares: Share[]; // only my own share (if I have one), which is all "my part" needs
};

// What someone typed → a pattern for "description contains this" (ilike).
// \, % and _ have special meanings in a pattern, so each gets a backslash in front
// and matches itself. The database's search (PostgREST) also treats * as "anything",
// and it can't be escaped, so it's dropped. Returns null if nothing is left to search for.
export function likePattern(text: string): string | null {
  const cleaned = text.replace(/\*/g, "").trim();
  if (cleaned === "") return null;
  return `%${cleaned.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;
}

// "2026-09-05" or "" (anything else, like a hand-edited address, counts as "").
export function cleanDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

// The groups I'm in now (or just `onlyGroupId`), newest group first, with my member id in each.
// Row Level Security only returns groups I'm still in.
export async function fetchMemberships(userId: string, onlyGroupId?: string) {
  if (onlyGroupId !== undefined && !isUuid(onlyGroupId)) return { error: null, memberships: [] };

  let query = supabase
    .from("group_members")
    .select("id, group_id, groups(name, created_at)")
    .eq("user_id", userId)
    .is("removed_at", null);
  if (onlyGroupId !== undefined) query = query.eq("group_id", onlyGroupId);

  const { data, error } = await query;
  if (error) return { error, memberships: [] };
  const memberships: Membership[] = data
    .flatMap((row) => (row.groups ? [{ ...row, groups: row.groups }] : []))
    .sort((a, b) => b.groups.created_at.localeCompare(a.groups.created_at))
    .map((row) => ({ groupId: row.group_id, groupName: row.groups.name, memberId: row.id }));
  return { error: null, memberships };
}

// One page of matching expenses, newest first, starting at `offset`.
// Row Level Security decides which expenses come back: a private expense only
// reaches the people in it. Deleted expenses are always left out.
export async function searchExpenses(filters: SearchFilters, myMemberIds: string[], offset: number) {
  // Not in any group: nothing to search.
  if (myMemberIds.length === 0) return { error: null, results: [], hasMore: false };
  const mine = `(${myMemberIds.join(",")})`; // member ids are UUIDs, so this list is safe as it is

  let query = supabase
    .from("expenses")
    .select(
      // `my_share`: my own share, for "you lent / you owe". `in_it`: my share if it's above $0,
      // for "Only ones I'm in". Both are the same table, filtered to my rows below.
      "id, group_id, description, amount_cents, paid_by, spent_on, visibility, receipt_path, groups(name), my_share:expense_shares(member_id, share_cents), in_it:expense_shares(member_id)",
    )
    .is("deleted_at", null)
    .filter("my_share.member_id", "in", mine)
    .filter("in_it.member_id", "in", mine)
    .filter("in_it.share_cents", "gt", 0);

  const pattern = likePattern(filters.text);
  if (pattern) query = query.ilike("description", pattern);
  if (filters.groupId) query = query.eq("group_id", filters.groupId);
  if (filters.from) query = query.gte("spent_on", filters.from);
  if (filters.to) query = query.lte("spent_on", filters.to);
  // I paid it, or I have a share above $0 in it.
  if (filters.onlyMine) query = query.or(`paid_by.in.${mine},in_it.not.is.null`);

  // Newest first. The id breaks ties, so "Show more" never repeats or skips a row.
  // One row more than a page is asked for, to know whether there's more to show.
  const { data, error } = await query
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + SEARCH_PAGE_SIZE);
  if (error) return { error, results: [], hasMore: false };

  const results: SearchResult[] = data.slice(0, SEARCH_PAGE_SIZE).map((row) => ({
    id: row.id,
    group_id: row.group_id,
    groupName: row.groups?.name ?? "",
    description: row.description,
    amount_cents: row.amount_cents,
    paid_by: row.paid_by,
    spent_on: row.spent_on,
    visibility: row.visibility === "participants" ? "participants" : "group",
    receipt_path: row.receipt_path,
    shares: row.my_share,
  }));
  return { error: null, results, hasMore: data.length > SEARCH_PAGE_SIZE };
}
