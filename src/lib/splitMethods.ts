// The four ways to split an expense, and the group's default split.
// "By percent" and "By shares" are turned into exact cents here (with the shared
// leftover-cent rule in split.ts), then saved through save_expense like any split.
// The database also remembers which way was used (split_method) and, for percent
// and shares, the numbers typed (split_snapshot), so Edit reopens the same way.
import type { Json } from "./database.types";
import { readMoney } from "./money";
import { splitByWeights } from "./split";

export type SplitMethod = "equally" | "exact" | "percent" | "shares";

export const SPLIT_METHODS: { key: SplitMethod; label: string }[] = [
  { key: "equally", label: "Equally" },
  { key: "exact", label: "Exact" },
  { key: "percent", label: "Percent" },
  { key: "shares", label: "Shares" },
];

export const MAX_SHARES = 1000;
export const HUNDRED_PERCENT = 10_000; // percentages are kept in hundredths: 33.33% is 3333

// One person's typed number: hundredths of a percent, or a whole number of shares.
export type MemberValue = { member_id: string; value: number };

// A percent box, as hundredths (33.33 → 3333), or null if it's empty or not a percent.
// Reuses the money reader, which already reads "up to 2 decimals" exactly.
export function readPercent(text: string): number | null {
  const read = readMoney(text);
  if (!read || read.cents === null || read.cents > HUNDRED_PERCENT) return null;
  return read.cents;
}

// A shares box: a whole number from 1 to 1000, or null.
export function readShares(text: string): number | null {
  const tidy = text.trim();
  if (!/^\d{1,4}$/.test(tidy)) return null;
  const n = Number(tidy);
  return n >= 1 && n <= MAX_SHARES ? n : null;
}

// hundredths → the number shown and saved: 3333 → 33.33, 5000 → 50.
export function percentNumber(hundredths: number): number {
  return hundredths / 100; // two decimals at most, so this is exact enough to print and save
}

// What a person's box starts with when switching to percent: everyone ticked gets an
// equal part, and the last ones make it add up to exactly 100 (3 people: 33.34, 33.33, 33.33).
export function evenPercents(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const base = Math.floor(HUNDRED_PERCENT / ids.length);
  let extra = HUNDRED_PERCENT - base * ids.length;
  for (const id of ids) {
    out.set(id, base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra--;
  }
  return out;
}

// Cents for each person from their percent (in hundredths). Must add up to 100%.
export function centsByPercent(
  totalCents: number,
  entries: readonly { id: string; hundredths: number }[],
  payerId?: string,
): Map<string, number> {
  return splitByWeights(
    totalCents,
    entries.map((e) => ({ id: e.id, weight: BigInt(e.hundredths) })),
    payerId,
  );
}

// Cents for each person from their number of shares.
export function centsByShares(
  totalCents: number,
  entries: readonly { id: string; shares: number }[],
  payerId?: string,
): Map<string, number> {
  return splitByWeights(totalCents, entries.map((e) => ({ id: e.id, weight: BigInt(e.shares) })), payerId);
}

// What save_expense's p_split gets. Percent values are saved as percents (33.33).
export function splitForSave(method: SplitMethod, values: readonly MemberValue[] = []): Json {
  if (method === "percent") {
    return { method, members: values.map((v) => ({ member_id: v.member_id, value: percentNumber(v.value) })) };
  }
  if (method === "shares") return { method, members: values.map((v) => ({ ...v })) };
  return { method };
}

// A saved split_snapshot (or a group's default_split members) read back: percent values
// become hundredths again. Anything unexpected is skipped.
export function readSnapshot(method: "percent" | "shares", snapshot: unknown): MemberValue[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.member_id !== "string" || typeof e.value !== "number") return [];
    const value = method === "percent" ? Math.round(e.value * 100) : e.value;
    return [{ member_id: e.member_id, value }];
  });
}

export type DefaultSplit = { method: "percent" | "shares"; members: MemberValue[] }; // percent in hundredths

// A group's default_split column, or null for "split equally among everyone".
export function readDefaultSplit(raw: unknown): DefaultSplit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.method !== "percent" && r.method !== "shares") return null;
  const members = readSnapshot(r.method, r.members);
  return members.length > 0 ? { method: r.method, members } : null;
}

// The default_split value to save (percents as percents again).
export function defaultSplitForSave(split: DefaultSplit): Json {
  return splitForSave(split.method, split.members);
}

// A default split still matches the group when it covers exactly the active members.
// If someone joined, left or was removed since, it "needs updating" (it still works
// for the people it does cover).
export function defaultSplitNeedsUpdate(split: DefaultSplit, activeMemberIds: readonly string[]): boolean {
  const inSplit = new Set(split.members.map((m) => m.member_id));
  const active = new Set(activeMemberIds);
  return inSplit.size !== active.size || [...inSplit].some((id) => !active.has(id));
}

// The parts of a default split that can still be used for a new expense: only people
// who are active now. A percent split that no longer adds up to 100% can't be used.
export function usableDefault(split: DefaultSplit | null, activeMemberIds: readonly string[]): DefaultSplit | null {
  if (!split) return null;
  const active = new Set(activeMemberIds);
  const members = split.members.filter((m) => active.has(m.member_id));
  if (members.length === 0) return null;
  if (split.method === "percent" && members.reduce((s, m) => s + m.value, 0) !== HUNDRED_PERCENT) return null;
  return { method: split.method, members };
}

// ---------------------------------------------------------------------------
// Switching split screens keeps the split: the amounts each person has now are
// turned into the new screen's numbers.
// ---------------------------------------------------------------------------

export type PersonCents = { id: string; cents: number };

// Percents (in hundredths) that match the amounts, adding up to exactly 100%.
// The amounts they give back can differ by a cent from the original because percents
// only have 2 decimals.
export function percentsFromAmounts(parts: readonly PersonCents[], payerId?: string): Map<string, number> {
  return splitByWeights(HUNDRED_PERCENT, parts.map((p) => ({ id: p.id, weight: BigInt(Math.max(0, p.cents)) })), payerId);
}

// Whole-number shares (1–1000) that give back the amounts, with the smallest numbers
// that do (50/25/25 → 2/1/1). Shares can't match every split exactly (28.81 / 26.40 /
// 16.20 would need huge numbers), so then it's the closest match, and `exact` is false.
export function sharesFromAmounts(
  parts: readonly PersonCents[],
  totalCents: number,
  payerId?: string,
): { shares: Map<string, number>; exact: boolean } {
  const live = parts.filter((p) => p.cents > 0);
  const biggest = Math.max(0, ...live.map((p) => p.cents));
  let best: { shares: Map<string, number>; error: number } | null = null;
  if (biggest === 0) return { shares: new Map(live.map((p) => [p.id, 1])), exact: false };
  for (let top = 1; top <= MAX_SHARES; top++) {
    const shares = new Map(live.map((p) => [p.id, Math.max(1, Math.round((p.cents * top) / biggest))]));
    const back = centsByShares(totalCents, live.map((p) => ({ id: p.id, shares: shares.get(p.id)! })), payerId);
    const error = live.reduce((sum, p) => sum + Math.abs((back.get(p.id) ?? 0) - p.cents), 0);
    if (!best || error < best.error) best = { shares, error };
    if (error === 0) break;
  }
  return { shares: best!.shares, exact: best!.error === 0 };
}
