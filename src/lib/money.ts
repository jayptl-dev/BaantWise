// Money is always whole cents (an integer): $12.34 is 1234.
// Amounts are turned into cents with string maths, never with decimal (floating
// point) numbers, so there are no rounding surprises.

export const MAX_CENTS = 100_000_000; // $1,000,000.00, same limit as the database

import { splitEvenly } from "./split";

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

// 1234 → "12.34", -5 → "-0.05". Exact, because it's built from the digits.
export function centsToDecimal(cents: number): `${number}` {
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}` as `${number}`;
}

// 1234 → "$12.34". The formatter is given the exact decimal text, not a divided number.
export function formatCents(cents: number): string {
  return CAD.format(centsToDecimal(cents));
}

export type MoneyInput = {
  text: string; // tidied up: "," becomes ".", spaces and "$" are removed
  cents: number | null; // null = the box is empty
  isSum: boolean; // "10+2.50" rather than a single amount
};

// One number while it's being typed: up to 7 digits, then an optional decimal
// point with up to 2 decimals. "", "." and "3." are allowed (not finished yet).
const NUMBER = String.raw`\d{0,7}(?:\.\d{0,2})?`;
// A number that is followed by + or -, so it needs at least one digit.
const FINISHED_NUMBER = String.raw`(?:\d{1,7}(?:\.\d{0,2})?|\.\d{1,2})`;
const ONE_AMOUNT = new RegExp(`^${NUMBER}$`);
const SUM = new RegExp(`^(?:${FINISHED_NUMBER}[+-])*${NUMBER}$`);

// The one place that reads an amount box. With `allowSums`, + and - may go
// between amounts ("115.22+64.88", "20-4.50").
// Returns null if the text isn't money, so the key that made it can be ignored.
// Unfinished input still counts: "3." is 3.00, "12+" is 12.00, "." is 0.00.
// A sum can come out below zero ("5-10"); the caller decides what to say about it.
export function readMoney(text: string, allowSums = false): MoneyInput | null {
  const tidy = text
    .replace(/[\s$]/g, "")
    .replace(/,/g, ".") // French keyboards type a comma as the decimal point
    .replace(/[−–]/g, "-"); // the "−" and "–" some keyboards type
  if (!(allowSums ? SUM : ONE_AMOUNT).test(tidy)) return null;
  if (tidy === "") return { text: tidy, cents: null, isSum: false };

  let cents = 0;
  for (const [, sign, number] of tidy.matchAll(/([+-]?)([^+-]*)/g)) {
    if (sign === "" && number === "") continue; // the empty match at the very end
    const [whole, fraction = ""] = number.split(".");
    // "12" + "50" → "1250": joining the digit strings is the string maths.
    const value = Number((whole || "0") + fraction.padEnd(2, "0"));
    cents += sign === "-" ? -value : value;
  }
  return { text: tidy, cents, isSum: /[+-]/.test(tidy) };
}

export type ExactChange = {
  total: number | null; // the expense total, or null if it hasn't been entered yet
  assigned: number; // all the exact amounts together, before this change
  before: number; // this person's amount before the change (0 if empty)
  after: number; // this person's amount after the change (0 if empty)
  addsPlus: boolean; // the change types a new "+"
};

// The rule for "Exact amounts": the amounts may never go over the total, not even
// by a cent. A change that would push them over is refused, and so is a "+" when
// there's nothing left to add. Lowering an amount is always allowed.
// Returns null if the change is fine, or a short note saying why it was refused.
export function refuseExactChange(change: ExactChange): string | null {
  const limit = change.total ?? 0; // no total yet: nothing fits
  const assignedAfter = change.assigned - change.before + change.after;
  const goesOver = assignedAfter > change.assigned && assignedAfter > limit;
  const nothingToAdd = change.addsPlus && assignedAfter >= limit;
  if (!goesOver && !nothingToAdd) return null;

  if (change.total === null) return "Enter the total amount first.";
  const left = limit - change.assigned;
  return left > 0
    ? `Only ${formatCents(left)} is left to assign.`
    : "Nothing is left to assign, so amounts can only go down.";
}

// Split a total equally, in whole cents. Leftover cents go out one each,
// starting with the payer if they're in the split, then in list order.
// $10.00 three ways paid by Jay: Jay 334, the others 333 each.
// (The shared leftover-cent rule lives in split.ts.)
export function splitEqually(totalCents: number, memberIds: string[], payerId: string): Map<string, number> {
  return splitEvenly(totalCents, memberIds, payerId);
}
