import { categoryFor, type CategoryKey } from "./categories";
import type { Json } from "./database.types";
import { isUuid, listOfNames } from "./format";
import { supabase } from "./supabase";
import type { GroupData, Member } from "./useGroup";

export const DESCRIPTION_MAX = 120; // same limit as the database check on expenses.description

export type Visibility = "group" | "participants";

export type SplitMethodKey = "equally" | "exact" | "percent" | "shares";

export type Share = { member_id: string; share_cents: number };

export type Expense = {
  id: string;
  description: string;
  amount_cents: number;
  paid_by: string; // member id
  spent_on: string; // "2026-09-25"
  visibility: Visibility; // "group" = everyone in the group, "participants" = only the people in it
  category: CategoryKey; // see categories.ts; older expenses are "other"
  created_by: string | null; // the account (not member) that added it
  created_at: string;
  receipt_path: string | null; // the receipt photo in Storage, or null for none (see receipts.ts)
  split_method: SplitMethodKey; // which split screen made it, so Edit reopens the same way
  split_snapshot: Json | null; // for percent/shares: the numbers that were typed (see splitMethods.ts)
  shares: Share[];
};

// Which expenses to load with a group: the whole list, or one expense.
export type ExpensesToLoad = "all" | { id: string };

// Deleted expenses are only marked deleted (deleted_at), so they're always filtered out.
// Row Level Security only returns the ones this person is allowed to see.
export async function fetchExpenses(groupId: string, which: ExpensesToLoad) {
  // A mistyped link: nothing to find.
  if (which !== "all" && !isUuid(which.id)) return { error: null, expenses: [] };

  let query = supabase
    .from("expenses")
    .select(
      "id, description, amount_cents, paid_by, spent_on, visibility, category, created_by, created_at, receipt_path, split_method, split_snapshot, expense_shares(member_id, share_cents)",
    )
    .eq("group_id", groupId)
    .is("deleted_at", null);
  if (which !== "all") query = query.eq("id", which.id);

  // Newest first: by date, then by when it was added.
  const { data, error } = await query
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return { error, expenses: [] };

  const expenses: Expense[] = data.map(({ expense_shares, visibility, category, split_method, ...expense }) => ({
    ...expense,
    split_method: isSplitMethod(split_method) ? split_method : "exact",
    visibility: visibility === "participants" ? "participants" : "group",
    category: categoryFor(category).key,
    shares: expense_shares,
  }));
  return { error: null, expenses };
}

function isSplitMethod(value: string): value is SplitMethodKey {
  return value === "equally" || value === "exact" || value === "percent" || value === "shares";
}

// Everyone who has been in the group (including people who left), by member id.
export function peopleById(data: GroupData): Map<string, Member> {
  return new Map([...data.members, ...data.formerMembers].map((m) => [m.id, m]));
}

// The member who added an expense or recorded a payment (it stores their account,
// not their member id).
export function addedBy(item: { created_by: string | null }, data: GroupData): Member | undefined {
  if (!item.created_by) return undefined;
  return [...data.members, ...data.formerMembers].find((m) => m.user_id === item.created_by);
}

// Who can see a private expense: the payer, the people splitting it, and whoever added it.
// The database uses exactly this rule; this is only for showing it.
export function peopleInvolved(ids: Iterable<string>, data: GroupData, myMemberId: string): string {
  const wanted = new Set(ids);
  const everyone = [...data.members, ...data.formerMembers];
  const names = everyone
    .filter((m) => wanted.has(m.id))
    // "you" first, then in the order people joined.
    .sort((a, b) => Number(b.id === myMemberId) - Number(a.id === myMemberId))
    .map((m) => (m.id === myMemberId ? "you" : m.display_name));
  return listOfNames(names);
}

export function involvedIds(expense: Expense, data: GroupData): string[] {
  const ids = [expense.paid_by, ...expense.shares.map((s) => s.member_id)];
  const adder = addedBy(expense, data);
  if (adder) ids.push(adder.id);
  return ids;
}

// What an expense means for me: I lent (I paid, minus my own share), I owe (my share),
// or I'm not in it.
export type MyPart = { kind: "lent" | "owe"; cents: number } | { kind: "none" };

export function myPart(
  expense: Pick<Expense, "paid_by" | "amount_cents" | "shares">,
  myMemberId: string,
): MyPart {
  const myShare = expense.shares.find((s) => s.member_id === myMemberId);
  if (expense.paid_by === myMemberId) {
    return { kind: "lent", cents: expense.amount_cents - (myShare?.share_cents ?? 0) };
  }
  if (myShare) return { kind: "owe", cents: myShare.share_cents };
  return { kind: "none" };
}
