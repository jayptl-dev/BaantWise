import { splitByItems } from "./split";

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
