import { splitByItems, type SplitItem } from "./split";

// Helpers for "Split by item", one item at a time.

export type StepItem = { amountCents: number; people: ReadonlySet<string> };

// Moving on to the next item: if nobody is ticked on it yet, start it with the same
// people as the item just finished, since the same few people often share item after
// item. An item that already has people keeps them.
export function carryForward<T extends { people: ReadonlySet<string> }>(items: readonly T[], from: number, to: number): T[] {
  const source = items[from];
  const target = items[to];
  if (!source || !target || target.people.size > 0 || source.people.size === 0) return [...items];
  return items.map((item, index) => (index === to ? ({ ...item, people: new Set(source.people) } as T) : item));
}

// What each person has so far from the items that have someone ticked, before tax and
// tip, in whole cents. Uses the same leftover-cent rule as the real split, so the
// amounts always add up to the ticked items' total.
export function itemsSoFar(items: readonly StepItem[], order: readonly string[], payerId?: string): Map<string, number> {
  const ticked = items.filter((item) => item.people.size > 0);
  const total = ticked.reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
  if (ticked.length === 0 || total === 0) return new Map();
  return splitByItems(
    total,
    ticked.map((item) => ({ amountCents: item.amountCents, memberIds: [...item.people] })),
    order,
    payerId,
  );
}

// The first item nobody is ticked on, or -1 when every item has someone.
export function firstUnticked(items: readonly StepItem[]): number {
  return items.findIndex((item) => item.people.size === 0);
}

// What the receipt says, from the scan, to check the items against.
export type ReceiptTotals = { subtotalCents: number | null; taxCents: number | null; tipCents: number | null };

// A couple of cents either way is rounding on the receipt, not a mistake.
const TOLERANCE_CENTS = 2;

export type ItemsCheck = {
  // The items add up to this much more (above 0) or less (below 0) than the receipt's
  // printed subtotal; null when they match, or the subtotal isn't known.
  subtotalGap: number | null;
  // The items add up to more than the expense's Amount, by this much; null otherwise.
  overAmount: number | null;
};

// Checks the items against the receipt and the Amount, so the sheet can say clearly when
// something doesn't add up (a missed or extra line, a wrong price, or a receipt that's
// wrong itself) instead of quietly sharing the difference as "tax, tip and other".
export function checkItems(itemsTotal: number, amountCents: number | null, receipt?: ReceiptTotals | null): ItemsCheck {
  const subtotal = receipt?.subtotalCents ?? null;
  const gap = subtotal === null ? 0 : itemsTotal - subtotal;
  const over = amountCents === null ? 0 : itemsTotal - amountCents;
  return {
    subtotalGap: subtotal !== null && Math.abs(gap) > TOLERANCE_CENTS ? gap : null,
    overAmount: amountCents !== null && over > TOLERANCE_CENTS ? over : null,
  };
}

// ---------- Tax only on taxed items ----------
// Grocery receipts mark which items are taxed (H, A, GP...): in Ontario, basic food has no
// HST but pop, snacks and household things do. When the receipt's tax is known and some
// items are marked taxed, the tax is shared only by the people on taxed items, in
// proportion to them; everything else (tip, fees, rounding) is shared over all the items,
// as before. Without marks (most restaurant bills), it all works exactly as before.

export type TaxedSplitItem = SplitItem & { taxed?: boolean | null };

// Whether the tax goes only to taxed items: the tax is known and above $0, and at least
// one item with someone on it is marked taxed.
export function taxOnMarkedItems(items: readonly TaxedSplitItem[], taxCents: number | null | undefined): boolean {
  return (
    typeof taxCents === "number" &&
    taxCents > 0 &&
    items.some((item) => item.taxed === true && item.amountCents > 0 && item.memberIds.length > 0)
  );
}

// "Split by item" with the tax shared only over taxed items (see above). Same leftover-cent
// rule; the shares always add up to totalCents. Falls back to the plain item split when
// the tax can't go to marked items, or the tax is more than the whole Amount.
export function splitItemsWithTax(
  totalCents: number,
  items: readonly TaxedSplitItem[],
  taxCents: number | null | undefined,
  order: readonly string[],
  payerId?: string,
): Map<string, number> {
  if (!taxOnMarkedItems(items, taxCents) || (taxCents as number) > totalCents) {
    return splitByItems(totalCents, items, order, payerId);
  }
  const tax = taxCents as number;
  const taxShares = splitByItems(tax, items.filter((item) => item.taxed === true), order, payerId);
  const restShares = splitByItems(totalCents - tax, items, order, payerId);
  const shares = new Map<string, number>();
  for (const id of order) {
    const sum = (taxShares.get(id) ?? 0) + (restShares.get(id) ?? 0);
    if (taxShares.has(id) || restShares.has(id)) shares.set(id, sum);
  }
  return shares;
}
