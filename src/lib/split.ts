// Turning a total into whole-cent shares, fairly. Used by every split that isn't
// typed in by hand: Equally, Split by item, By percent, By shares and currency
// conversion. All maths is exact (BigInt), never decimal numbers.
//
// The rule for leftover cents (the same everywhere):
// 1. Work out each person's exact part and round it down to a whole cent.
// 2. Hand the cents that are left over out one at a time, to whoever lost the
//    biggest fraction of a cent in step 1.
// 3. A tie goes to the payer if they're one of the tied people, then to whoever is
//    listed first, then the next-listed.

export type Weighted = { id: string; weight: bigint };

// Splits `totalCents` in proportion to the weights, in the order given (member order).
// People with weight 0 get 0. If every weight is 0, nobody gets anything (empty map).
export function splitByWeights(totalCents: number, people: readonly Weighted[], payerId?: string): Map<string, number> {
  const shares = new Map<string, number>();
  const sum = people.reduce((s, p) => s + (p.weight > 0n ? p.weight : 0n), 0n);
  if (sum === 0n) return shares;
  const total = BigInt(totalCents);

  const parts = people.map((p, index) => {
    const weight = p.weight > 0n ? p.weight : 0n;
    const exact = total * weight; // the exact share is exact / sum
    return { id: p.id, index, down: exact / sum, dropped: exact % sum };
  });

  let leftover = total - parts.reduce((s, p) => s + p.down, 0n);
  const order = [...parts].sort((a, b) => {
    if (a.dropped !== b.dropped) return a.dropped > b.dropped ? -1 : 1;
    const aPayer = a.id === payerId ? 0 : 1;
    const bPayer = b.id === payerId ? 0 : 1;
    return aPayer - bPayer || a.index - b.index;
  });
  for (const part of order) {
    if (leftover <= 0n) break;
    part.down += 1n;
    leftover -= 1n;
  }
  for (const part of parts) shares.set(part.id, Number(part.down));
  return shares;
}

// The same total split equally between `ids`, with the same leftover rule.
// $10.00 three ways paid by Jay: Jay 334, the others 333 each.
export function splitEvenly(totalCents: number, ids: readonly string[], payerId?: string): Map<string, number> {
  return splitByWeights(totalCents, ids.map((id) => ({ id, weight: 1n })), payerId);
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export type SplitItem = { amountCents: number; memberIds: readonly string[] };

// "Split by item": each person pays for the items they're on (an item shared by n
// people counts amount/n for each), and the rest of the total (tax, tip, fees,
// rounding) is shared in proportion. `order` is the member list order.
// Items with nobody on them are ignored. If every item is $0, the total is split
// equally between the people who have items.
export function splitByItems(
  totalCents: number,
  items: readonly SplitItem[],
  order: readonly string[],
  payerId?: string,
): Map<string, number> {
  const used = items.filter((item) => item.memberIds.length > 0);
  const onItems = new Set(used.flatMap((item) => item.memberIds));
  const people = order.filter((id) => onItems.has(id));

  // Every item's amount/n becomes a whole number when everything is scaled by the
  // lowest common multiple of the n's.
  const scale = used.reduce((l, item) => {
    const n = BigInt(new Set(item.memberIds).size);
    return (l * n) / gcd(l, n);
  }, 1n);

  const weights = new Map<string, bigint>(people.map((id) => [id, 0n]));
  for (const item of used) {
    const unique = [...new Set(item.memberIds)];
    const each = (BigInt(Math.max(0, item.amountCents)) * scale) / BigInt(unique.length);
    for (const id of unique) weights.set(id, (weights.get(id) ?? 0n) + each);
  }

  const allZero = [...weights.values()].every((w) => w === 0n);
  if (allZero) return splitEvenly(totalCents, people, payerId);
  return splitByWeights(totalCents, people.map((id) => ({ id, weight: weights.get(id) ?? 0n })), payerId);
}
