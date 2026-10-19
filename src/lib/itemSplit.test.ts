import { describe, expect, it } from "vitest";
import { carryForward, checkItems, firstUnticked, itemsSoFar } from "./itemSplit";

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
