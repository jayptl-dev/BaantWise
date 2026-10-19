import type { ItemLine } from "../components/ItemSplitSheet";
import { centsToDecimal, readMoney } from "./money";
import { splitByWeights } from "./split";

// "Break this line", for Split by item: one receipt line that holds several of the same
// thing (6 butters, $34.74) becomes parts, each with its own people (4 butters for one
// set of people, 2 for another). Each part is its own step in the sheet, so ticking,
// running totals and saving work exactly like any other item.
//
// The parts of one line share `part.line` (a small number that's the same for all of
// them) and sit next to each other in the list. `part.count` is how many of the line's
// things that part has; the counts always add up to the line's `quantity`. A part's price
// is its share of the whole line's price by count, using the same leftover-cent rule as
// every other split, so the parts always add back up to exactly the line's price.

export const MAX_COUNT = 99;

const cents = (line: ItemLine) => readMoney(line.amountText)?.cents ?? 0;

// A whole count of 2 or more (weights like 0.535 kg can't be broken into counts).
export function isBreakableCount(quantity: number | null | undefined): quantity is number {
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 2 && quantity <= MAX_COUNT;
}

// Whether "Break this line" can be offered for a line: not already broken, a price above
// $0 (a discount line has nothing to share out), and not sold by weight (0.95 kg of
// tomatoes can't be counted out into parts).
export function canBreak(line: ItemLine): boolean {
  const weighed = typeof line.quantity === "number" && !Number.isInteger(line.quantity);
  return !line.part && !weighed && cents(line) > 0;
}

// The line's price shared out by count, whole cents, first part first on a tie.
export function partCents(totalCents: number, counts: readonly number[]): number[] {
  const shares = splitByWeights(
    totalCents,
    counts.map((count, index) => ({ id: String(index), weight: BigInt(Math.max(0, count)) })),
  );
  return counts.map((_, index) => shares.get(String(index)) ?? 0);
}

function nextKey(lines: readonly ItemLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.key), -1) + 1;
}

function nextLineId(lines: readonly ItemLine[]): number {
  return lines.reduce((max, line) => (line.part ? Math.max(max, line.part.line) : max), -1) + 1;
}

// The parts of the line that `key` belongs to, in list order ([] if it isn't broken).
export function partsOf(lines: readonly ItemLine[], key: number): ItemLine[] {
  const line = lines.find((l) => l.key === key);
  if (!line?.part) return [];
  const id = line.part.line;
  return lines.filter((l) => l.part?.line === id);
}

// Puts fresh prices on the parts of line `id` from their counts and the line's total.
function reprice(lines: readonly ItemLine[], id: number, totalCents: number): ItemLine[] {
  const parts = lines.filter((l) => l.part?.line === id);
  const prices = partCents(totalCents, parts.map((p) => p.part!.count));
  const quantity = parts.reduce((sum, p) => sum + p.part!.count, 0);
  const priceOf = new Map(parts.map((p, index) => [p.key, prices[index]]));
  return lines.map((l) =>
    priceOf.has(l.key) ? { ...l, quantity, amountText: centsToDecimal(priceOf.get(l.key)!) } : l,
  );
}

function lineTotal(parts: readonly ItemLine[]): number {
  return parts.reduce((sum, p) => sum + cents(p), 0);
}

// Breaks the line into two parts, the bigger half first (6 → 3 + 3, 5 → 3 + 2). Both
// parts start with the people already ticked on the line. `quantity` is how many are on
// it (the scanner's count, or what the person typed).
export function breakLine(lines: readonly ItemLine[], key: number, quantity: number): ItemLine[] {
  const at = lines.findIndex((l) => l.key === key);
  const line = lines[at];
  if (!line || !canBreak(line) || !isBreakableCount(quantity)) return [...lines];
  const id = nextLineId(lines);
  const first = Math.ceil(quantity / 2);
  const total = cents(line);
  const [a, b] = partCents(total, [first, quantity - first]);
  const k = nextKey(lines);
  const partA: ItemLine = { ...line, quantity, amountText: centsToDecimal(a), part: { line: id, count: first } };
  const partB: ItemLine = {
    ...line,
    key: k,
    quantity,
    amountText: centsToDecimal(b),
    people: new Set(line.people),
    part: { line: id, count: quantity - first },
  };
  return [...lines.slice(0, at), partA, partB, ...lines.slice(at + 1)];
}

// Whether + can be pressed on this part: some other part has more than 1 to give.
export function canGrow(lines: readonly ItemLine[], key: number): boolean {
  return partsOf(lines, key).some((p) => p.key !== key && p.part!.count > 1);
}

// Whether − can be pressed on this part: it has more than 1.
export function canShrink(lines: readonly ItemLine[], key: number): boolean {
  const line = lines.find((l) => l.key === key);
  return !!line?.part && line.part.count > 1;
}

// Moves one thing between this part and another part of the same line, keeping the
// line's count and price the same. + takes one from the nearest part after it that has
// more than 1 (then the nearest before it); − gives one to the next part (or, for the
// last part, the one before it).
export function moveOne(lines: readonly ItemLine[], key: number, direction: 1 | -1): ItemLine[] {
  const parts = partsOf(lines, key);
  const at = parts.findIndex((p) => p.key === key);
  if (at === -1) return [...lines];
  let other: ItemLine | undefined;
  if (direction === 1) {
    if (!canGrow(lines, key)) return [...lines];
    other =
      parts.slice(at + 1).find((p) => p.part!.count > 1) ??
      [...parts.slice(0, at)].reverse().find((p) => p.part!.count > 1);
  } else {
    if (!canShrink(lines, key)) return [...lines];
    other = parts[at + 1] ?? parts[at - 1];
  }
  if (!other) return [...lines];
  const total = lineTotal(parts);
  const otherKey = other.key;
  const moved = lines.map((l) => {
    if (l.key === key) return { ...l, part: { ...l.part!, count: l.part!.count + direction } };
    if (l.key === otherKey) return { ...l, part: { ...l.part!, count: l.part!.count - direction } };
    return l;
  });
  return reprice(moved, parts[0].part!.line, total);
}

// Whether "Add a part" can be pressed: some part has more than 1 to give.
export function canAddPart(lines: readonly ItemLine[], key: number): boolean {
  return partsOf(lines, key).some((p) => p.part!.count > 1);
}

// Adds a part with 1 thing in it, taken from the biggest part (the first one on a tie),
// placed after the line's last part, with nobody ticked. Returns the new lines and the
// new part's key (null if nothing changed).
export function addPart(lines: readonly ItemLine[], key: number): { lines: ItemLine[]; added: number | null } {
  const parts = partsOf(lines, key);
  if (!canAddPart(lines, key)) return { lines: [...lines], added: null };
  const biggest = parts.reduce((best, p) => (p.part!.count > best.part!.count ? p : best), parts[0]);
  const last = parts[parts.length - 1];
  const total = lineTotal(parts);
  const id = parts[0].part!.line;
  const k = nextKey(lines);
  const fresh: ItemLine = { ...last, key: k, people: new Set(), part: { line: id, count: 1 } };
  const taken = lines.map((l) => (l.key === biggest.key ? { ...l, part: { ...l.part!, count: l.part!.count - 1 } } : l));
  const lastAt = taken.findIndex((l) => l.key === last.key);
  const withNew = [...taken.slice(0, lastAt + 1), fresh, ...taken.slice(lastAt + 1)];
  return { lines: reprice(withNew, id, total), added: k };
}

// Joins the parts back into one line with the whole price and count, keeping everyone
// who was ticked on any part. The joined line keeps the first part's key.
export function joinBack(lines: readonly ItemLine[], key: number): ItemLine[] {
  const parts = partsOf(lines, key);
  if (parts.length === 0) return [...lines];
  const first = parts[0];
  const keys = new Set(parts.map((p) => p.key));
  const people = new Set(parts.flatMap((p) => [...p.people]));
  const quantity = parts.reduce((sum, p) => sum + p.part!.count, 0);
  const joined: ItemLine = {
    key: first.key,
    name: first.name,
    printed: first.printed,
    amountText: centsToDecimal(lineTotal(parts)),
    people,
    quantity,
  };
  return lines.flatMap((l) => (l.key === first.key ? [joined] : keys.has(l.key) ? [] : [l]));
}

// Fixing the whole line's price from one of its parts: the new price is shared out by
// count again. For a line that isn't broken this just sets its price.
export function setLinePrice(lines: readonly ItemLine[], key: number, totalCents: number): ItemLine[] {
  const line = lines.find((l) => l.key === key);
  if (!line) return [...lines];
  if (!line.part) return lines.map((l) => (l.key === key ? { ...l, amountText: centsToDecimal(totalCents) } : l));
  return reprice(lines, line.part.line, totalCents);
}

// Renaming one part renames the whole line, so the parts stay recognisable as one line.
export function setLineName(lines: readonly ItemLine[], key: number, name: string): ItemLine[] {
  const line = lines.find((l) => l.key === key);
  if (!line) return [...lines];
  const id = line.part?.line;
  return lines.map((l) => (l.key === key || (id !== undefined && l.part?.line === id) ? { ...l, name } : l));
}

// Removing one part removes the whole receipt line (all its parts).
export function removeLine(lines: readonly ItemLine[], key: number): ItemLine[] {
  const line = lines.find((l) => l.key === key);
  if (!line) return [...lines];
  const id = line.part?.line;
  return lines.filter((l) => !(l.key === key || (id !== undefined && l.part?.line === id)));
}

// How a part is labelled: "3 of 6".
export function partLabel(line: ItemLine): string | null {
  return line.part && line.quantity ? `${line.part.count} of ${line.quantity}` : null;
}

// Makes saved or edited parts consistent: each line's parts must sit together, have
// whole counts of at least 1 and at least two parts; anything else loses its part
// marking and becomes a plain line. Each line's count is set to the sum of its parts.
export function tidyParts(lines: readonly ItemLine[]): ItemLine[] {
  const groups = new Map<number, number[]>(); // line id -> list indexes
  lines.forEach((l, index) => {
    if (l.part) groups.set(l.part.line, [...(groups.get(l.part.line) ?? []), index]);
  });
  const bad = new Set<number>();
  for (const [id, indexes] of groups) {
    const together = indexes.every((index, i) => i === 0 || index === indexes[i - 1] + 1);
    const countsOk = indexes.every((index) => {
      const count = lines[index].part!.count;
      return Number.isInteger(count) && count >= 1 && count <= MAX_COUNT;
    });
    const sum = indexes.reduce((s, index) => s + lines[index].part!.count, 0);
    if (indexes.length < 2 || !together || !countsOk || sum > MAX_COUNT) bad.add(id);
  }
  return lines.map((l) => {
    if (!l.part) return l;
    if (bad.has(l.part.line)) {
      const { part: _part, ...plain } = l;
      return { ...plain, quantity: null };
    }
    const sum = groups.get(l.part.line)!.reduce((s, index) => s + lines[index].part!.count, 0);
    return { ...l, quantity: sum };
  });
}
