import { describe, expect, it } from "vitest";
import { carryForward, firstUnticked, itemsSoFar } from "./itemSplit";

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
