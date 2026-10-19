import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import type { ItemLine } from "../components/ItemSplitSheet";
import { itemsToSave, linesFromSaved, MAX_SAVED_ITEMS } from "./expenseItems";

const line = (key: number, name: string, amountText: string, people: string[] = [], printed: string | null = null): ItemLine => ({
  key,
  name,
  printed,
  amountText,
  people: new Set(people),
});

describe("itemsToSave", () => {
  it("keeps each item's name, printed line, price in cents and who was ticked", () => {
    expect(itemsToSave([line(0, "Milk 2%, 4 L", "6.99", ["a", "b"], "PC MLK 2% 4L")])).toEqual([
      { name: "Milk 2%, 4 L", printed: "PC MLK 2% 4L", amount_cents: 699, member_ids: ["a", "b"] },
    ]);
  });

  it("falls back to the printed line, then a numbered name, for a blank name", () => {
    const saved = itemsToSave([line(0, "  ", "1.00", [], "GRN ONION"), line(1, "", "2.00")]);
    expect(saved.map((s) => s.name)).toEqual(["GRN ONION", "Item 2"]);
  });

  it("counts an unreadable price as $0, like the sheet does", () => {
    expect(itemsToSave([line(0, "Bread", "abc")])[0].amount_cents).toBe(0);
  });

  it("trims names to 60 characters", () => {
    expect(itemsToSave([line(0, "x".repeat(80), "1")])[0].name).toHaveLength(60);
  });

  it("saves at most 60 items", () => {
    const many = Array.from({ length: 70 }, (_, i) => line(i, `Item ${i}`, "1"));
    expect(itemsToSave(many)).toHaveLength(MAX_SAVED_ITEMS);
  });
});

describe("linesFromSaved", () => {
  it("turns saved items back into sheet lines, ticks included", () => {
    const lines = linesFromSaved(
      [{ name: "Milk 2%, 4 L", printed: "PC MLK 2% 4L", amount_cents: 699, member_ids: ["a", "b"] }],
      ["a", "b", "c"],
    );
    expect(lines).toHaveLength(1);
    expect(lines![0]).toMatchObject({ key: 0, name: "Milk 2%, 4 L", printed: "PC MLK 2% 4L", amountText: "6.99" });
    expect([...lines![0].people]).toEqual(["a", "b"]);
  });

  it("drops ticks for people no longer in the group", () => {
    const lines = linesFromSaved([{ name: "Eggs", printed: null, amount_cents: 450, member_ids: ["a", "gone"] }], ["a"]);
    expect([...lines![0].people]).toEqual(["a"]);
  });

  it("round-trips with itemsToSave", () => {
    const original = [line(0, "Bread", "3.01", ["b"]), line(1, "Milk", "6.99", ["a", "b"], "MLK")];
    const back = linesFromSaved(itemsToSave(original), ["a", "b"])!;
    expect(back.map((l) => [l.name, l.printed, l.amountText, [...l.people]])).toEqual([
      ["Bread", null, "3.01", ["b"]],
      ["Milk", "MLK", "6.99", ["a", "b"]],
    ]);
  });

  it("skips malformed entries and gives null when nothing is usable", () => {
    expect(linesFromSaved([{ name: 5 }, null, { name: "x", amount_cents: 1.5 }], ["a"])).toBeNull();
    expect(linesFromSaved("not a list", ["a"])).toBeNull();
    expect(linesFromSaved([], ["a"])).toBeNull();
  });

  it("numbers the keys in order after skipping bad entries", () => {
    const lines = linesFromSaved([null, { name: "A", amount_cents: 1 }, { name: "B", amount_cents: 2 }], []);
    expect(lines!.map((l) => l.key)).toEqual([0, 1]);
  });
});

describe("broken lines and counts", () => {
  it("saves how many are on a line, and each part's count", () => {
    const parts: ItemLine[] = [
      { ...line(0, "Butter", "23.16", ["a"]), quantity: 6, part: { line: 0, count: 4 } },
      { ...line(1, "Butter", "11.58", ["b"]), quantity: 6, part: { line: 0, count: 2 } },
      { ...line(2, "Chicken", "9.10"), quantity: 0.535 },
    ];
    const saved = itemsToSave(parts);
    expect(saved[0]).toMatchObject({ quantity: 6, part: { line: 0, count: 4 } });
    expect(saved[2]).toMatchObject({ quantity: 0.535 });
    expect(saved[2].part).toBeUndefined();
    const back = linesFromSaved(saved, ["a", "b"])!;
    expect(back.map((l) => l.part?.count ?? null)).toEqual([4, 2, null]);
    expect(back.map((l) => l.quantity)).toEqual([6, 6, 0.535]);
    expect([...back[1].people]).toEqual(["b"]);
  });

  it("leaves out a count it doesn't know", () => {
    expect(itemsToSave([line(0, "Bread", "3.00")])[0]).not.toHaveProperty("quantity");
  });

  it("turns a lone saved part back into a plain line", () => {
    const back = linesFromSaved(
      [{ name: "Butter", printed: null, amount_cents: 500, member_ids: [], quantity: 6, part: { line: 0, count: 3 } }],
      [],
    )!;
    expect(back[0].part).toBeUndefined();
  });
});
