// Spending charts: where the money goes, by category and by month.
// The maths here is pure (no database) so it can be tested; amounts are whole cents.
// Both the group "Spending" screen and the personal "My spending" screen use it.
import { categoryFor, type CategoryKey } from "./categories";
import { supabase } from "./supabase";
import type { Expense } from "./expenses";

export type Period = "this_month" | "last_month" | "this_year" | "all_time";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

export function isPeriod(value: unknown): value is Period {
  return PERIODS.some((p) => p.key === value);
}

// One amount to chart. For a group it's the whole expense; for "My spending" it's my share.
export type SpendingRow = {
  id: string; // the expense id
  groupId: string;
  groupName: string;
  description: string;
  category: CategoryKey;
  amountCents: number;
  spentOn: string; // "2026-09-25", no time zone
};

export type DateRange = { start: string | null; end: string | null };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// The last day of a month (month is 1–12). Day 0 of the next month is the last day of this one.
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// The first and last day of a period, for `today` ("2026-09-26"). All time has no limits.
export function periodRange(period: Period, today: string): DateRange {
  const [year, month] = today.split("-").map(Number);
  switch (period) {
    case "this_month":
      return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay(year, month))}` };
    case "last_month": {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
    }
    case "this_year":
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    case "all_time":
      return { start: null, end: null };
  }
}

// Dates are "YYYY-MM-DD", so comparing them as text compares them as dates.
export function inRange(spentOn: string, range: DateRange): boolean {
  return (range.start === null || spentOn >= range.start) && (range.end === null || spentOn <= range.end);
}

export function rowsInPeriod<T extends Pick<SpendingRow, "spentOn">>(rows: readonly T[], period: Period, today: string): T[] {
  const range = periodRange(period, today);
  return rows.filter((row) => inRange(row.spentOn, range));
}

export type CategoryTotal = { category: CategoryKey; totalCents: number };

// Total per category in the period, biggest first. Categories at $0 are left out.
// Ties keep the categories' usual order, so the list never jumps around.
export function categoryTotals(rows: readonly SpendingRow[], period: Period, today: string): CategoryTotal[] {
  const totals = new Map<CategoryKey, number>();
  for (const row of rowsInPeriod(rows, period, today)) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountCents);
  }
  const order = (key: CategoryKey) => categoryOrder.indexOf(key);
  return [...totals]
    .filter(([, total]) => total > 0)
    .map(([category, totalCents]) => ({ category, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents || order(a.category) - order(b.category));
}

const categoryOrder: CategoryKey[] = [
  "food", "groceries", "transport", "housing", "utilities",
  "entertainment", "travel", "shopping", "health", "other",
];

export type MonthTotal = { month: string; totalCents: number }; // month: "2026-09"

// The last `monthsBack` months (this month included), oldest first. Months at $0 stay in.
export function monthlyTotals(rows: readonly SpendingRow[], monthsBack: number, today: string): MonthTotal[] {
  const [year, month] = today.split("-").map(Number);
  const months: MonthTotal[] = [];
  for (let back = monthsBack - 1; back >= 0; back--) {
    const index = year * 12 + (month - 1) - back; // months counted from year 0
    months.push({ month: `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`, totalCents: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const row of rows) {
    const entry = byMonth.get(row.spentOn.slice(0, 7));
    if (entry) entry.totalCents += row.amountCents;
  }
  return months;
}

// A whole percentage for a bar's label. Rounded, but never "0%" for something above $0
// and never "100%" unless it really is everything.
export function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  if (part >= whole) return "100%";
  const rounded = Math.round((part * 100) / whole);
  return `${Math.min(99, Math.max(1, rounded))}%`;
}

// A bar's width or height as a share of the biggest one shown, 0–100.
export function barSize(value: number, biggest: number): number {
  if (biggest <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value * 100) / biggest)); // a tiny amount still shows a sliver
}

// "2026-09" → "Sep" (or "Sep 2025" when `withYear`).
export function monthLabel(month: string, withYear = false): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString("en-CA", {
    month: "short",
    year: withYear ? "numeric" : undefined,
  });
}

// What to say when a period has nothing in it.
export function emptyPeriodLine(period: Period, mine: boolean): string {
  if (period === "last_month") return mine ? "You didn't have any spending last month." : "No group expenses last month.";
  const when = { this_month: " this month", this_year: " this year", all_time: "" }[period];
  return mine ? `You don't have any spending yet${when}.` : `No group expenses yet${when}.`;
}

// ---------------------------------------------------------------------------
// Loading the numbers. One query per screen; every period is worked out from it.
// ---------------------------------------------------------------------------

// A group's shared spending: only expenses everyone in the group can see, so every
// member sees the same chart. Private expenses never count here. Uses the expenses
// the group page already loads (and keeps live), so there's no extra query.
export function groupSpendingRows(groupId: string, expenses: readonly Expense[]): SpendingRow[] {
  return expenses
    .filter((e) => e.visibility === "group")
    .map((e) => ({
      id: e.id,
      groupId,
      groupName: "",
      description: e.description,
      category: e.category,
      amountCents: e.amount_cents,
      spentOn: e.spent_on,
    }));
}

// My own spending: my share of every expense I can see, in every group I'm in now,
// private ones included. Only my member ids are asked for, so nobody else's share appears.
export async function fetchMySpending(userId: string) {
  const { data: memberships, error: memberError } = await supabase
    .from("group_members")
    .select("id")
    .eq("user_id", userId)
    .is("removed_at", null);
  if (memberError) return { error: memberError, inAnyGroup: false, rows: [] as SpendingRow[] };
  const memberIds = memberships.map((m) => m.id);
  if (memberIds.length === 0) return { error: null, inAnyGroup: false, rows: [] as SpendingRow[] };

  const { data, error } = await supabase
    .from("expense_shares")
    .select("share_cents, expenses!inner(id, group_id, description, category, spent_on, created_at, deleted_at, groups(name))")
    .in("member_id", memberIds)
    .is("expenses.deleted_at", null)
    .gt("share_cents", 0);
  if (error) return { error, inAnyGroup: true, rows: [] as SpendingRow[] };

  const rows: SpendingRow[] = data
    .map((share) => ({
      id: share.expenses.id,
      groupId: share.expenses.group_id,
      groupName: share.expenses.groups?.name ?? "",
      description: share.expenses.description,
      category: categoryFor(share.expenses.category).key,
      amountCents: share.share_cents,
      spentOn: share.expenses.spent_on,
      createdAt: share.expenses.created_at,
    }))
    .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAt.localeCompare(a.createdAt))
    .map(({ createdAt: _createdAt, ...row }) => row);
  return { error: null, inAnyGroup: true, rows };
}
