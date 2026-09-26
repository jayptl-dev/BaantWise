import { addedBy, peopleById, type Expense, type Visibility } from "./expenses";
import { supabase } from "./supabase";
import type { GroupData } from "./useGroup";

// A recorded payment ("Sam paid Jay $30.00"), stored in the settlements table.
// Baantwise only records these. It never moves money.
export type Payment = {
  id: string;
  from_member: string; // member id of who paid
  to_member: string; // member id of who got the money
  amount_cents: number;
  paid_on: string; // "2026-09-26"
  visibility: Visibility; // "group" = everyone in the group, "participants" = the two of them and whoever recorded it
  created_by: string | null; // the account (not member) that recorded it
  created_at: string;
};

// Undone payments are only marked deleted (deleted_at), so they're always filtered out.
// Row Level Security only returns the ones this person is allowed to see.
export async function fetchPayments(groupId: string) {
  const { data, error } = await supabase
    .from("settlements")
    .select("id, from_member, to_member, amount_cents, paid_on, visibility, created_by, created_at")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return { error, payments: [] };

  const payments: Payment[] = data.map(({ visibility, ...payment }) => ({
    ...payment,
    visibility: visibility === "participants" ? "participants" : "group",
  }));
  return { error: null, payments };
}

// "Sam paid Jay", "You paid Sam" or "Sam paid you".
export function whoPaidWhom(payment: Payment, data: GroupData, myMemberId: string): string {
  const people = peopleById(data);
  const from =
    payment.from_member === myMemberId ? "You" : (people.get(payment.from_member)?.display_name ?? "Someone");
  const to = payment.to_member === myMemberId ? "you" : (people.get(payment.to_member)?.display_name ?? "someone");
  return `${from} paid ${to}`;
}

// Who can see a private payment: who paid, who got it, and whoever recorded it.
// The database uses exactly this rule; this is only for showing it.
export function paymentInvolvedIds(payment: Payment, data: GroupData): string[] {
  const ids = [payment.from_member, payment.to_member];
  const recorder = addedBy(payment, data);
  if (recorder) ids.push(recorder.id);
  return ids;
}

// One entry in the group's list: an expense or a payment.
export type Activity = { kind: "expense"; expense: Expense } | { kind: "payment"; payment: Payment };

// Expenses and payments together, newest first: by date, then by when they were added.
export function newestFirst(expenses: Expense[], payments: Payment[]): Activity[] {
  const entries = [
    ...expenses.map((expense) => ({
      activity: { kind: "expense", expense } as Activity,
      date: expense.spent_on,
      added: Date.parse(expense.created_at),
    })),
    ...payments.map((payment) => ({
      activity: { kind: "payment", payment } as Activity,
      date: payment.paid_on,
      added: Date.parse(payment.created_at),
    })),
  ];
  entries.sort((a, b) => (a.date === b.date ? b.added - a.added : a.date < b.date ? 1 : -1));
  return entries.map((entry) => entry.activity);
}
