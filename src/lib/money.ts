// Money is always whole cents (an integer): $12.34 is 1234.
// Amounts are turned into cents with string maths, never with decimal (floating
// point) numbers, so there are no rounding surprises.

export const MAX_CENTS = 100_000_000; // $1,000,000.00, same limit as the database

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

// What someone typed → cents. Accepts "12", "12.5", "12.50", ".50", "$12.50",
// and a comma as the decimal mark ("12,50") for French keyboards.
// Returns null if it isn't an amount (letters, three decimals, and so on).
export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[\s$]/g, "");
  const match = /^(\d*)(?:[.,](\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  if (whole === "" && fraction === "") return null; // nothing typed, or just "."
  if (whole.length > 7) return MAX_CENTS + 1; // clearly too big; the caller shows the limit
  return Number((whole || "0") + fraction.padEnd(2, "0"));
}

// Split a total equally, in whole cents. Leftover cents go out one each,
// starting with the payer if they're in the split, then in list order.
// $10.00 three ways paid by Jay: Jay 334, the others 333 each.
export function splitEqually(totalCents: number, memberIds: string[], payerId: string): Map<string, number> {
  const shares = new Map<string, number>();
  const count = memberIds.length;
  if (count === 0) return shares;
  const leftover = totalCents % count;
  const base = (totalCents - leftover) / count;
  const order = memberIds.includes(payerId)
    ? [payerId, ...memberIds.filter((id) => id !== payerId)]
    : memberIds;
  order.forEach((id, index) => shares.set(id, base + (index < leftover ? 1 : 0)));
  return shares;
}
