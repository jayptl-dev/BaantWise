// Recurring expenses: rules like "Rent, every month on the 1st". The database makes
// the expenses when they're due (private.run_recurring, every hour); a rule whose
// amount changes each time makes a "bill to fill in" for the person who set it up.
// See supabase/migrations/…_recurring_expenses.sql.
import { categoryFor, type CategoryKey } from "./categories";
import type { Json } from "./database.types";
import type { Visibility } from "./expenses";
import { formatDay, isUuid } from "./format";
import { formatCents } from "./money";
import { readSnapshot, type MemberValue, type SplitMethod } from "./splitMethods";
import { supabase } from "./supabase";

export type Frequency = "weekly" | "biweekly" | "monthly" | "yearly";

export const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: "weekly", label: "Every week" },
  { key: "biweekly", label: "Every 2 weeks" },
  { key: "monthly", label: "Every month" },
  { key: "yearly", label: "Every year" },
];

// How a rule splits: `members` null = everyone in the group at that moment (equally).
// Values are hundredths for percent (like the form), shares, or cents for exact.
export type RecurringSplit = { method: SplitMethod; members: MemberValue[] | null };

export type RecurringRule = {
  id: string;
  groupId: string;
  createdBy: string; // account id
  description: string;
  category: CategoryKey;
  paidBy: string; // member id
  visibility: Visibility;
  frequency: Frequency;
  startOn: string;
  endOn: string | null;
  amountKind: "fixed" | "variable";
  amountCents: number | null;
  split: RecurringSplit;
  paused: boolean;
  nextOn: string | null; // null = ended
};

export type RecurringBill = { id: string; recurringId: string; dueOn: string };

function isFrequency(v: string): v is Frequency {
  return FREQUENCIES.some((f) => f.key === v);
}

// The split column as the form uses it (percent values as hundredths).
export function readRecurringSplit(raw: Json): RecurringSplit {
  const r = (raw ?? {}) as Record<string, unknown>;
  const method = (["equally", "exact", "percent", "shares"] as const).find((m) => m === r.method) ?? "equally";
  if (r.members === null || r.members === undefined) return { method, members: null };
  const members =
    method === "percent" || method === "shares"
      ? readSnapshot(method, r.members)
      : readSnapshot("shares", r.members); // equally (value 1) and exact (cents) read as they are
  return { method, members };
}

// The split as save_recurring takes it (percent values as percents again).
export function recurringSplitForSave(split: RecurringSplit): Json {
  return {
    method: split.method,
    members:
      split.members === null
        ? null
        : split.members.map((m) => ({ member_id: m.member_id, value: split.method === "percent" ? m.value / 100 : m.value })),
  };
}

type RuleRow = {
  id: string;
  group_id: string;
  created_by: string;
  description: string;
  category: string;
  paid_by: string;
  visibility: string;
  frequency: string;
  start_on: string;
  end_on: string | null;
  amount_kind: string;
  amount_cents: number | null;
  split: Json;
  paused: boolean;
  next_on: string | null;
};

function toRule(row: RuleRow): RecurringRule {
  return {
    id: row.id,
    groupId: row.group_id,
    createdBy: row.created_by,
    description: row.description,
    category: categoryFor(row.category).key,
    paidBy: row.paid_by,
    visibility: row.visibility === "participants" ? "participants" : "group",
    frequency: isFrequency(row.frequency) ? row.frequency : "monthly",
    startOn: row.start_on,
    endOn: row.end_on,
    amountKind: row.amount_kind === "variable" ? "variable" : "fixed",
    amountCents: row.amount_cents,
    split: readRecurringSplit(row.split),
    paused: row.paused,
    nextOn: row.next_on,
  };
}

const RULE_COLUMNS =
  "id, group_id, created_by, description, category, paid_by, visibility, frequency, start_on, end_on, amount_kind, amount_cents, split, paused, next_on";

// The rules in a group that I can see (Row Level Security decides), soonest first.
// Also my own bills to fill in there.
export async function fetchRecurring(groupId: string) {
  if (!isUuid(groupId)) return { error: null, rules: [] as RecurringRule[], bills: [] as RecurringBill[] };
  const [rules, bills] = await Promise.all([
    supabase.from("recurring_expenses").select(RULE_COLUMNS).eq("group_id", groupId).order("next_on", { ascending: true, nullsFirst: false }),
    supabase.from("recurring_bills").select("id, recurring_id, due_on").eq("group_id", groupId).is("closed_at", null).order("due_on"),
  ]);
  const error = rules.error ?? bills.error;
  if (error) return { error, rules: [] as RecurringRule[], bills: [] as RecurringBill[] };
  return {
    error: null,
    rules: (rules.data ?? []).map(toRule),
    bills: (bills.data ?? []).map((b) => ({ id: b.id, recurringId: b.recurring_id, dueOn: b.due_on })),
  };
}

export async function fetchRule(groupId: string, id: string) {
  if (!isUuid(groupId) || !isUuid(id)) return { error: null, rule: null };
  const { data, error } = await supabase.from("recurring_expenses").select(RULE_COLUMNS).eq("group_id", groupId).eq("id", id).maybeSingle();
  return { error, rule: data ? toRule(data) : null };
}

// A bill to fill in, with its rule (for "Enter this month's amount").
export async function fetchBill(groupId: string, billId: string) {
  if (!isUuid(groupId) || !isUuid(billId)) return { error: null, bill: null, rule: null };
  const { data, error } = await supabase
    .from("recurring_bills")
    .select("id, recurring_id, due_on, closed_at")
    .eq("group_id", groupId)
    .eq("id", billId)
    .maybeSingle();
  if (error || !data || data.closed_at) return { error, bill: null, rule: null };
  const { rule, error: ruleError } = await fetchRule(groupId, data.recurring_id);
  return { error: ruleError, bill: { id: data.id, recurringId: data.recurring_id, dueOn: data.due_on }, rule };
}

// "Every month · next Nov 1" / "Every week · paused" / "Ended".
export function scheduleLine(rule: RecurringRule): string {
  const how = FREQUENCIES.find((f) => f.key === rule.frequency)?.label ?? "";
  if (rule.paused) return `${how} · paused`;
  if (!rule.nextOn) return `${how} · ended`;
  return `${how} · next ${formatDay(rule.nextOn, true)}`;
}

// "$2,400.00" or "Amount changes each time".
export function amountLine(rule: RecurringRule): string {
  return rule.amountKind === "fixed" && rule.amountCents !== null ? formatCents(rule.amountCents) : "Amount changes each time";
}
