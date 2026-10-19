import { describe, expect, it } from "vitest";
import { carryForward, checkItems, firstUnticked, itemsSoFar, splitItemsWithTax, taxOnMarkedItems } from "./itemSplit";

const item = (amountCents: number, people: string[] = []) => ({ amountCents, people: new Set(people) });

describe("carryForward", () => {
  it("copies the ticks onto an empty next item", () => {
    const next = carryForward([item(500, ["a", "b"]), item(300)], 0, 1);
    expect([...next[1].people]).toEqual(["a", "b"]);
  });

  it("leaves an item that already has people alone", () => {
    const next = carryForward([item(500, ["a", "b"]), item(300, ["c"])], 0, 1);
    expect([...next[1].people]).toEqual(["c"]);
  });

  it("doesn't share the same Set between items", () => {
    const next = carryForward([item(500, ["a"]), item(300)], 0, 1);
    expect(next[1].people).not.toBe(next[0].people);
  });

  it("does nothing when the finished item has nobody", () => {
    const next = carryForward([item(500), item(300)], 0, 1);
    expect(next[1].people.size).toBe(0);
  });
});

describe("itemsSoFar", () => {
  it("splits each ticked item between its people, in whole cents", () => {
    const so = itemsSoFar([item(1000, ["a", "b"]), item(100, ["a", "b", "c"]), item(999)], ["a", "b", "c"]);
    const total = [...so.values()].reduce((s, c) => s + c, 0);
    expect(total).toBe(1100);
    expect(so.get("c")).toBe(33);
  });

  it("is empty before anything is ticked", () => {
    expect(itemsSoFar([item(500)], ["a"]).size).toBe(0);
  });
});

describe("firstUnticked", () => {
  it("finds the first item with nobody", () => {
    expect(firstUnticked([item(1, ["a"]), item(2), item(3)])).toBe(1);
    expect(firstUnticked([item(1, ["a"])])).toBe(-1);
  });
});

describe("checkItems (numbers from real test receipts)", () => {
  const r = (subtotalCents: number | null, taxCents: number | null = null, tipCents: number | null = null) => ({
    subtotalCents,
    taxCents,
    tipCents,
  });

  it("is quiet when the items match the subtotal (Tim Hortons, Mac's, pub night)", () => {
    expect(checkItems(1006, 1137, r(1006, 131))).toEqual({ subtotalGap: null, overAmount: null });
    expect(checkItems(1446, 1634, r(1446, 188))).toEqual({ subtotalGap: null, overAmount: null });
    expect(checkItems(9225, 12085, r(9225, 1199, 1661))).toEqual({ subtotalGap: null, overAmount: null });
  });

  it("flags items that add up to more than the subtotal (Boston Pizza: $102.96 vs $82.96)", () => {
    expect(checkItems(10296, 10618, r(8296, 1078, 1244)).subtotalGap).toBe(2000);
  });

  it("flags items that add up to less than the subtotal (Trattoria $4.00, Whole Foods $5.01)", () => {
    expect(checkItems(26950, 35829, r(27350, 3556, 4923)).subtotalGap).toBe(-400);
    expect(checkItems(13275, 14189, r(13776, 413)).subtotalGap).toBe(-501);
  });

  it("allows a couple of cents of rounding", () => {
    expect(checkItems(1004, 1137, r(1006)).subtotalGap).toBeNull();
    expect(checkItems(1003, 1137, r(1006)).subtotalGap).toBe(-3);
  });

  it("flags items that add up to more than the Amount", () => {
    expect(checkItems(10000, 9000, null).overAmount).toBe(1000);
    expect(checkItems(9000, 9000, null).overAmount).toBeNull();
    expect(checkItems(9000, null, null).overAmount).toBeNull();
  });

  it("skips the subtotal check without a scan", () => {
    expect(checkItems(10296, 10618, null).subtotalGap).toBeNull();
    expect(checkItems(10296, 10618, r(null, 1078)).subtotalGap).toBeNull();
  });
});

describe("tax only on taxed items (Costco and Walmart test receipts)", () => {
  const order = ["a", "b", "c"];
  const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);

  it("Costco: only the paper towels (A) are taxed, so only their buyer pays the $3.25 HST", () => {
    const items = [
      { amountCents: 1049, memberIds: ["b"], taxed: false }, // milk
      { amountCents: 2499, memberIds: ["a"], taxed: true }, // paper towels (A)
      { amountCents: 799, memberIds: ["b"], taxed: false }, // chicken
      { amountCents: 2199, memberIds: ["b"], taxed: false }, // olive oil
      { amountCents: 1149, memberIds: ["b"], taxed: false }, // Kraft Dinner
    ];
    const shares = splitItemsWithTax(8020, items, 325, order, "a");
    expect(shares.get("a")).toBe(2499 + 325);
    expect(shares.get("b")).toBe(1049 + 799 + 2199 + 1149);
    expect(sum(shares)).toBe(8020);
  });

  it("Walmart: paper towels (GP) taxed and shared by two; a tip-free remainder still adds up", () => {
    const items = [
      { amountCents: 568, memberIds: ["a"], taxed: false },
      { amountCents: 897, memberIds: ["b"], taxed: false },
      { amountCents: 247, memberIds: ["c"], taxed: false },
      { amountCents: 797, memberIds: ["a", "b"], taxed: true },
      { amountCents: 1198, memberIds: ["c"], taxed: false },
    ];
    const shares = splitItemsWithTax(3811, items, 104, order, "a");
    expect(sum(shares)).toBe(3811);
    expect(shares.get("c")).toBe(247 + 1198); // bought nothing taxed: pays no tax
    expect((shares.get("a") ?? 0) + (shares.get("b") ?? 0)).toBe(568 + 897 + 797 + 104);
  });

  it("tax and a tip: tax to taxed items, the tip over everything", () => {
    const items = [
      { amountCents: 1000, memberIds: ["a"], taxed: true },
      { amountCents: 1000, memberIds: ["b"], taxed: false },
    ];
    const shares = splitItemsWithTax(2330, items, 130, order); // $1.30 tax + $2.00 tip
    expect(shares.get("a")).toBe(1000 + 130 + 100);
    expect(shares.get("b")).toBe(1000 + 100);
  });

  it("falls back to sharing over everything without marks, or when the tax is bigger than the Amount", () => {
    const plain = [
      { amountCents: 1000, memberIds: ["a"], taxed: null },
      { amountCents: 1000, memberIds: ["b"], taxed: null },
    ];
    expect(taxOnMarkedItems(plain, 260)).toBe(false);
    expect(splitItemsWithTax(2260, plain, 260, order).get("a")).toBe(1130);
    const marked = [{ amountCents: 100, memberIds: ["a"], taxed: true }];
    expect(sum(splitItemsWithTax(50, marked, 99, order))).toBe(50);
    expect(taxOnMarkedItems(marked, 0)).toBe(false);
  });
});
