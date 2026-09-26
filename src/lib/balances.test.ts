import { describe, expect, it } from "vitest";
import {
  computeBalances,
  groupNets,
  privatePairs,
  simplifyDebts,
  type BalanceExpense,
  type BalancePayment,
} from "./balances";

// Short helpers: an expense paid by `paidBy` with shares like { jay: 334, sam: 333 }.
function expense(
  paidBy: string,
  shares: Record<string, number>,
  visibility: "group" | "participants" = "group",
  deleted_at: string | null = null,
): BalanceExpense {
  const list = Object.entries(shares).map(([member_id, share_cents]) => ({ member_id, share_cents }));
  const amount_cents = list.reduce((sum, share) => sum + share.share_cents, 0);
  return { amount_cents, paid_by: paidBy, visibility, shares: list, deleted_at };
}

function payment(
  from: string,
  to: string,
  cents: number,
  visibility: "group" | "participants" = "group",
  deleted_at: string | null = null,
): BalancePayment {
  return { from_member: from, to_member: to, amount_cents: cents, visibility, deleted_at };
}

function sumOf(nets: Map<string, number>): number {
  return [...nets.values()].reduce((sum, cents) => sum + cents, 0);
}

describe("groupNets: the group scope", () => {
  it("is paid minus own shares", () => {
    // $10.00 three ways, paid by Jay: 334 + 333 + 333.
    const nets = groupNets([expense("jay", { jay: 334, sam: 333, priya: 333 })], []);
    expect(nets.get("jay")).toBe(666);
    expect(nets.get("sam")).toBe(-333);
    expect(nets.get("priya")).toBe(-333);
    expect(sumOf(nets)).toBe(0);
  });

  it("adds payments sent and takes away payments received", () => {
    const nets = groupNets([expense("jay", { jay: 334, sam: 333, priya: 333 })], [payment("sam", "jay", 333)]);
    expect(nets.get("jay")).toBe(333);
    expect(nets.get("sam")).toBe(0);
    expect(nets.get("priya")).toBe(-333);
  });

  it("leaves out private items and deleted rows", () => {
    const nets = groupNets(
      [
        expense("jay", { jay: 500, sam: 500 }),
        expense("sam", { jay: 2000, sam: 2000 }, "participants"),
        expense("priya", { priya: 100, sam: 100 }, "group", "2026-09-26T10:00:00Z"),
      ],
      [payment("sam", "jay", 200, "participants"), payment("sam", "jay", 500, "group", "2026-09-26T11:00:00Z")],
    );
    expect(Object.fromEntries(nets)).toEqual({ jay: 500, sam: -500 });
  });

  it("always adds up to zero", () => {
    const nets = groupNets(
      [expense("a", { a: 1234, b: 999, c: 1 }), expense("b", { a: 50, c: 5000 }), expense("c", { b: 7 })],
      [payment("c", "a", 300), payment("b", "c", 42)],
    );
    expect(sumOf(nets)).toBe(0);
  });
});

describe("simplifyDebts", () => {
  it("has the biggest debtor pay the biggest creditor, then repeats", () => {
    const transfers = simplifyDebts(
      new Map([
        ["jay", 5000],
        ["priya", 1000],
        ["sam", -4000],
        ["alex", -2000],
      ]),
    );
    expect(transfers).toEqual([
      { from: "sam", to: "jay", cents: 4000 },
      { from: "alex", to: "jay", cents: 1000 },
      { from: "alex", to: "priya", cents: 1000 },
    ]);
  });

  it("uses fewer transfers than paying everyone back one by one", () => {
    // Jay paid for Sam, Sam paid for Priya, Priya paid for Jay: it all cancels out.
    const nets = groupNets(
      [expense("jay", { sam: 1000 }), expense("sam", { priya: 1000 }), expense("priya", { jay: 1000 })],
      [],
    );
    expect(simplifyDebts(nets)).toEqual([]);

    // A chain: Sam owes Jay $10, Priya owes Sam $10 → Priya pays Jay directly.
    const chain = groupNets([expense("jay", { sam: 1000 }), expense("sam", { priya: 1000 })], []);
    expect(simplifyDebts(chain)).toEqual([{ from: "priya", to: "jay", cents: 1000 }]);
  });

  it("gives the same list whatever order the nets come in", () => {
    const entries: [string, number][] = [
      ["b", 300],
      ["a", 300],
      ["d", -300],
      ["c", -300],
    ];
    const forwards = simplifyDebts(new Map(entries));
    const backwards = simplifyDebts(new Map([...entries].reverse()));
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual([
      { from: "c", to: "a", cents: 300 },
      { from: "d", to: "b", cents: 300 },
    ]);
  });

  it("moves every cent and leaves nobody out", () => {
    const nets = new Map([
      ["a", 1001],
      ["b", 1],
      ["c", -334],
      ["d", -333],
      ["e", -335],
    ]);
    const transfers = simplifyDebts(nets);
    const after = new Map(nets);
    for (const t of transfers) {
      after.set(t.from, after.get(t.from)! + t.cents);
      after.set(t.to, after.get(t.to)! - t.cents);
      expect(Number.isInteger(t.cents) && t.cents > 0).toBe(true);
    }
    expect([...after.values()].every((cents) => cents === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(nets.size - 1);
  });

  it("is empty when everyone is settled", () => {
    expect(
      simplifyDebts(
        new Map([
          ["a", 0],
          ["b", 0],
        ]),
      ),
    ).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });
});

describe("privatePairs: only between me and one other person", () => {
  it("counts a private expense I paid: each other person owes me their share", () => {
    const pairs = privatePairs([expense("me", { me: 400, sam: 300, priya: 300 }, "participants")], [], "me");
    expect(pairs).toEqual([
      { with: "sam", cents: 300 },
      { with: "priya", cents: 300 },
    ]);
  });

  it("counts only my share when someone else paid, never other people's", () => {
    const pairs = privatePairs([expense("sam", { me: 250, sam: 250, priya: 500 }, "participants")], [], "me");
    expect(pairs).toEqual([{ with: "sam", cents: -250 }]);
  });

  it("ignores private items between other people, even ones I added", () => {
    const pairs = privatePairs(
      [expense("sam", { priya: 900 }, "participants")],
      [payment("priya", "sam", 900, "participants")],
      "me",
    );
    expect(pairs).toEqual([]);
  });

  it("ignores group items", () => {
    const pairs = privatePairs([expense("me", { me: 500, sam: 500 })], [payment("sam", "me", 100)], "me");
    expect(pairs).toEqual([]);
  });

  it("keeps each pair separate", () => {
    const pairs = privatePairs(
      [expense("me", { sam: 1000 }, "participants"), expense("priya", { me: 1000 }, "participants")],
      [],
      "me",
    );
    // Sam owes me $10 and I owe Priya $10: they are not netted into "all settled".
    expect(pairs).toEqual([
      { with: "sam", cents: 1000 },
      { with: "priya", cents: -1000 },
    ]);
  });

  it("takes private payments between the two of us into account, including part-payments", () => {
    const expenses = [expense("me", { me: 2000, sam: 3000 }, "participants")];
    expect(privatePairs(expenses, [payment("sam", "me", 1000, "participants")], "me")).toEqual([
      { with: "sam", cents: 2000 },
    ]);
    // Paid in full: the pair disappears.
    expect(
      privatePairs(
        expenses,
        [payment("sam", "me", 1000, "participants"), payment("sam", "me", 2000, "participants")],
        "me",
      ),
    ).toEqual([]);
  });

  it("works the same the other way round (I owe, then I pay)", () => {
    const pairs = privatePairs(
      [expense("sam", { me: 1500 }, "participants")],
      [payment("me", "sam", 500, "participants")],
      "me",
    );
    expect(pairs).toEqual([{ with: "sam", cents: -1000 }]);
  });

  it("leaves out deleted expenses and undone payments", () => {
    const pairs = privatePairs(
      [
        expense("me", { sam: 1000 }, "participants"),
        expense("me", { sam: 5000 }, "participants", "2026-09-26T10:00:00Z"),
      ],
      [payment("sam", "me", 1000, "participants", "2026-09-26T11:00:00Z")],
      "me",
    );
    expect(pairs).toEqual([{ with: "sam", cents: 1000 }]);
  });

  it("looks the same from the other person's side, with the sign flipped", () => {
    const expenses = [expense("jay", { jay: 700, sam: 1300 }, "participants")];
    const payments = [payment("sam", "jay", 300, "participants")];
    expect(privatePairs(expenses, payments, "jay")).toEqual([{ with: "sam", cents: 1000 }]);
    expect(privatePairs(expenses, payments, "sam")).toEqual([{ with: "jay", cents: -1000 }]);
  });
});

describe("computeBalances", () => {
  it("adds my group net and my private pairs into one overall number", () => {
    const expenses = [
      expense("jay", { jay: 334, sam: 333, priya: 333 }), // group: Jay is owed 666
      expense("sam", { jay: 200, sam: 200 }, "participants"), // private: Jay owes Sam 200
      expense("jay", { priya: 50 }, "participants"), // private: Priya owes Jay 50
    ];
    const balances = computeBalances(expenses, [payment("priya", "jay", 333)], "jay");
    expect(balances.transfers).toEqual([{ from: "sam", to: "jay", cents: 333 }]);
    expect(balances.pairs).toEqual([
      { with: "sam", cents: -200 },
      { with: "priya", cents: 50 },
    ]);
    expect(balances.overall).toBe(333 - 200 + 50);
  });

  it("never lets private items change the group list", () => {
    const group = [expense("jay", { jay: 500, sam: 500 })];
    const withPrivate = [...group, expense("sam", { jay: 5000 }, "participants")];
    expect(computeBalances(withPrivate, [], "jay").transfers).toEqual(computeBalances(group, [], "jay").transfers);
  });

  it("gives the same group list to everyone, even though they see different private items", () => {
    const group = [expense("jay", { jay: 1000, sam: 1000, priya: 1000 }), expense("priya", { sam: 450 })];
    const jaySees = [...group, expense("jay", { sam: 800 }, "participants")];
    const priyaSees = [...group];
    expect(computeBalances(jaySees, [], "jay").transfers).toEqual(computeBalances(priyaSees, [], "priya").transfers);
  });

  it("is all settled up when nothing is owed", () => {
    const balances = computeBalances([expense("jay", { jay: 1000 })], [], "jay");
    expect(balances).toEqual({ transfers: [], pairs: [], overall: 0 });
  });
});
