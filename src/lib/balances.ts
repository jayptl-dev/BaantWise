// Who owes whom, worked out in whole cents from what the signed-in person can see.
//
// There are two kinds of balance, and they are never mixed:
// - The group scope: only items everyone in the group can see (visibility "group").
//   Everyone sees the same items, so everyone gets the same list of transfers.
// - Private pairs: only private items ("participants"), and only between me and one
//   other person. Each pair is kept on its own and never combined with another.
// "Overall" adds my part of the group scope to all my private pairs.

import type { Visibility } from "./expenses";

// Just what the maths needs, so tests can use small objects. A row with deleted_at
// set (an undone payment or a deleted expense) is left out.
export type BalanceExpense = {
  amount_cents: number;
  paid_by: string; // member id
  visibility: Visibility;
  shares: { member_id: string; share_cents: number }[];
  deleted_at?: string | null;
};

export type BalancePayment = {
  from_member: string; // who paid
  to_member: string; // who got the money
  amount_cents: number;
  visibility: Visibility;
  deleted_at?: string | null;
};

// "from" pays "to" this many cents.
export type Transfer = { from: string; to: string; cents: number };

// A private balance between me and one other person.
// Positive: they owe me. Negative: I owe them.
export type PrivatePair = { with: string; cents: number };

export type Balances = {
  transfers: Transfer[]; // the group scope, simplified: the same list for everyone
  pairs: PrivatePair[]; // my non-zero private pairs
  overall: number; // positive: I'm owed; negative: I owe
};

function isLive(row: { deleted_at?: string | null }): boolean {
  return !row.deleted_at;
}

function add(nets: Map<string, number>, memberId: string, cents: number) {
  nets.set(memberId, (nets.get(memberId) ?? 0) + cents);
}

// The group scope: each member's net in cents. Positive means the group owes them.
// Net = what they paid for expenses, minus their own shares, plus payments they
// sent, minus payments they received. All the nets add up to zero.
export function groupNets(expenses: BalanceExpense[], payments: BalancePayment[]): Map<string, number> {
  const nets = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.visibility !== "group" || !isLive(expense)) continue;
    add(nets, expense.paid_by, expense.amount_cents);
    for (const share of expense.shares) add(nets, share.member_id, -share.share_cents);
  }
  for (const payment of payments) {
    if (payment.visibility !== "group" || !isLive(payment)) continue;
    add(nets, payment.from_member, payment.amount_cents);
    add(nets, payment.to_member, -payment.amount_cents);
  }
  return nets;
}

// Turns nets into as few transfers as possible: the person who owes the most pays
// the person who is owed the most, as much as they can, and repeat.
// Ties go by member id, so every device gets exactly the same list.
export function simplifyDebts(nets: Map<string, number>): Transfer[] {
  const owes = new Map<string, number>(); // debtor → cents they still owe
  const owed = new Map<string, number>(); // creditor → cents they're still owed
  for (const [id, cents] of nets) {
    if (cents < 0) owes.set(id, -cents);
    if (cents > 0) owed.set(id, cents);
  }

  const transfers: Transfer[] = [];
  while (owes.size > 0 && owed.size > 0) {
    const from = largest(owes);
    const to = largest(owed);
    const cents = Math.min(owes.get(from)!, owed.get(to)!);
    transfers.push({ from, to, cents });
    settle(owes, from, cents);
    settle(owed, to, cents);
  }
  return transfers;
}

// The id with the biggest amount; the smaller id wins a tie.
function largest(amounts: Map<string, number>): string {
  let best = "";
  let bestCents = -1;
  for (const [id, cents] of amounts) {
    if (cents > bestCents || (cents === bestCents && id < best)) {
      best = id;
      bestCents = cents;
    }
  }
  return best;
}

function settle(amounts: Map<string, number>, id: string, cents: number) {
  const left = amounts.get(id)! - cents;
  if (left === 0) amounts.delete(id);
  else amounts.set(id, left);
}

// My private balances, one per person. Only private items count, and only between
// me and one other person:
// - a private expense I paid: each other person owes me their share,
// - a private expense someone else paid with a share for me: I owe them my share,
// - a private payment between me and someone.
// A private item between other people (for example one I added but am not in)
// doesn't count. Pairs that come to zero are left out.
export function privatePairs(expenses: BalanceExpense[], payments: BalancePayment[], me: string): PrivatePair[] {
  const pairs = new Map<string, number>(); // other member id → cents they owe me
  for (const expense of expenses) {
    if (expense.visibility !== "participants" || !isLive(expense)) continue;
    if (expense.paid_by === me) {
      for (const share of expense.shares) {
        if (share.member_id !== me) add(pairs, share.member_id, share.share_cents);
      }
    } else {
      const mine = expense.shares.find((share) => share.member_id === me);
      if (mine) add(pairs, expense.paid_by, -mine.share_cents);
    }
  }
  for (const payment of payments) {
    if (payment.visibility !== "participants" || !isLive(payment)) continue;
    // Paying someone back makes what I owe them smaller (so the pair goes up).
    if (payment.from_member === me && payment.to_member !== me) add(pairs, payment.to_member, payment.amount_cents);
    if (payment.to_member === me && payment.from_member !== me) add(pairs, payment.from_member, -payment.amount_cents);
  }
  return [...pairs].filter(([, cents]) => cents !== 0).map(([id, cents]) => ({ with: id, cents }));
}

// Everything at once, for the group page.
export function computeBalances(expenses: BalanceExpense[], payments: BalancePayment[], me: string): Balances {
  const nets = groupNets(expenses, payments);
  const pairs = privatePairs(expenses, payments, me);
  const overall = (nets.get(me) ?? 0) + pairs.reduce((sum, pair) => sum + pair.cents, 0);
  return { transfers: simplifyDebts(nets), pairs, overall };
}
