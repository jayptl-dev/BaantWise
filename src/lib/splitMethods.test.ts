import { describe, expect, it } from "vitest";
import {
  centsByPercent,
  centsByShares,
  defaultSplitNeedsUpdate,
  evenPercents,
  readDefaultSplit,
  readPercent,
  readShares,
  readSnapshot,
  percentsFromAmounts,
  sharesFromAmounts,
  splitForSave,
  usableDefault,
} from "./splitMethods";
import { splitEvenly } from "./split";

const ORDER = ["jay", "priya", "sam"];
const list = (m: Map<string, number>, ids = ORDER) => ids.map((id) => m.get(id));

describe("the plan's rounding examples", () => {
  it("$10.00 equally or by shares 1/1/1, paid by Jay: 334/333/333", () => {
    expect(list(splitEvenly(1000, ORDER, "jay"))).toEqual([334, 333, 333]);
    const byShares = centsByShares(1000, ORDER.map((id) => ({ id, shares: 1 })), "jay");
    expect(list(byShares)).toEqual([334, 333, 333]);
  });

  it("$100.00 by percent 33.33/33.33/33.34: 3333/3333/3334", () => {
    const shares = centsByPercent(10000, [
      { id: "jay", hundredths: 3333 },
      { id: "priya", hundredths: 3333 },
      { id: "sam", hundredths: 3334 },
    ], "jay");
    expect(list(shares)).toEqual([3333, 3333, 3334]);
  });

  it("$10.01 by percent 60/25/15: 601/250/150", () => {
    const shares = centsByPercent(1001, [
      { id: "jay", hundredths: 6000 },
      { id: "priya", hundredths: 2500 },
      { id: "sam", hundredths: 1500 },
    ], "jay");
    expect(list(shares)).toEqual([601, 250, 150]);
  });

  it("$50.00 by shares Jay 2, Mom 1, paid by Jay: 3333/1667", () => {
    const shares = centsByShares(5000, [{ id: "jay", shares: 2 }, { id: "mom", shares: 1 }], "jay");
    expect(list(shares, ["jay", "mom"])).toEqual([3333, 1667]);
  });

  it("$10.01 by shares 1/1/1, paid by Jay: 334/334/333", () => {
    expect(list(centsByShares(1001, ORDER.map((id) => ({ id, shares: 1 })), "jay"))).toEqual([334, 334, 333]);
  });

  it("$0.01 by percent 50/50, paid by Jay: Jay 1, Priya 0", () => {
    const shares = centsByPercent(1, [{ id: "jay", hundredths: 5000 }, { id: "priya", hundredths: 5000 }], "jay");
    expect(list(shares, ["jay", "priya"])).toEqual([1, 0]);
  });
});

describe("reading boxes", () => {
  it("reads percents with up to 2 decimals, never above 100", () => {
    expect(readPercent("33.33")).toBe(3333);
    expect(readPercent("100")).toBe(10000);
    expect(readPercent("0")).toBe(0);
    expect(readPercent("100.01")).toBeNull();
    expect(readPercent("12.345")).toBeNull();
    expect(readPercent("")).toBeNull();
  });

  it("reads shares as whole numbers from 1 to 1000", () => {
    expect(readShares("2")).toBe(2);
    expect(readShares("1000")).toBe(1000);
    expect(readShares("0")).toBeNull();
    expect(readShares("1001")).toBeNull();
    expect(readShares("1.5")).toBeNull();
  });

  it("starts percent boxes at an even split adding up to 100", () => {
    expect(list(evenPercents(ORDER))).toEqual([3334, 3333, 3333]);
  });
});

describe("saving and reopening", () => {
  it("saves percents as percents and reads them back as hundredths", () => {
    const saved = splitForSave("percent", [{ member_id: "jay", value: 3333 }, { member_id: "priya", value: 6667 }]);
    expect(saved).toEqual({ method: "percent", members: [{ member_id: "jay", value: 33.33 }, { member_id: "priya", value: 66.67 }] });
    const members = (saved as { members: unknown }).members;
    expect(readSnapshot("percent", members)).toEqual([{ member_id: "jay", value: 3333 }, { member_id: "priya", value: 6667 }]);
  });

  it("sends just the method for equally and exact", () => {
    expect(splitForSave("equally")).toEqual({ method: "equally" });
    expect(splitForSave("exact")).toEqual({ method: "exact" });
  });
});

describe("group default split", () => {
  const split = readDefaultSplit({
    method: "shares",
    members: [{ member_id: "jay", value: 2 }, { member_id: "priya", value: 1 }],
  })!;

  it("reads a stored default and ignores junk", () => {
    expect(split.members).toHaveLength(2);
    expect(readDefaultSplit(null)).toBeNull();
    expect(readDefaultSplit({ method: "magic", members: [] })).toBeNull();
  });

  it("needs updating when someone joins or leaves", () => {
    expect(defaultSplitNeedsUpdate(split, ["jay", "priya"])).toBe(false);
    expect(defaultSplitNeedsUpdate(split, ["jay", "priya", "sam"])).toBe(true);
    expect(defaultSplitNeedsUpdate(split, ["jay"])).toBe(true);
  });

  it("still works for the people it covers, but a broken percent split isn't used", () => {
    expect(usableDefault(split, ["jay", "sam"])?.members).toEqual([{ member_id: "jay", value: 2 }]);
    const percent = readDefaultSplit({ method: "percent", members: [{ member_id: "jay", value: 50 }, { member_id: "priya", value: 50 }] });
    expect(usableDefault(percent, ["jay"])).toBeNull();
    expect(usableDefault(percent, ["jay", "priya"])?.members).toHaveLength(2);
  });
});

describe("switching split screens keeps the amounts", () => {
  it("turns amounts into percents that add up to 100", () => {
    const p = percentsFromAmounts([{ id: "a", cents: 2881 }, { id: "b", cents: 2640 }, { id: "c", cents: 1620 }]);
    expect([...p.values()].reduce((s, v) => s + v, 0)).toBe(10000);
    expect(p.get("a")).toBe(4034);
  });

  it("finds the smallest whole shares when they match exactly", () => {
    const r = sharesFromAmounts([{ id: "a", cents: 5000 }, { id: "b", cents: 2500 }, { id: "c", cents: 2500 }], 10000, "a");
    expect(r.exact).toBe(true);
    expect([r.shares.get("a"), r.shares.get("b"), r.shares.get("c")]).toEqual([2, 1, 1]);
  });

  it("says when shares can only come close", () => {
    const parts = [{ id: "a", cents: 2881 }, { id: "b", cents: 2640 }, { id: "c", cents: 1620 }];
    const r = sharesFromAmounts(parts, 7141, "a");
    const back = centsByShares(7141, parts.map((p) => ({ id: p.id, shares: r.shares.get(p.id)! })), "a");
    const off = parts.reduce((s, p) => s + Math.abs(back.get(p.id)! - p.cents), 0);
    expect(off).toBeLessThanOrEqual(3);
    expect([...r.shares.values()].every((v) => v >= 1 && v <= 1000)).toBe(true);
  });
});
