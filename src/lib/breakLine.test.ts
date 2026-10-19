import { describe, expect, it } from "vitest";
import type { ItemLine } from "../components/ItemSplitSheet";
import {
  addPart,
  breakLine,
  canAddPart,
  canBreak,
  canGrow,
  canShrink,
  isBreakableCount,
  joinBack,
  moveOne,
  partCents,
  partLabel,
  partsOf,
  removeLine,
  setLineName,
  setLinePrice,
  tidyParts,
} from "./breakLine";
import { readMoney } from "./money";

const line = (key: number, name: string, amountText: string, quantity: number | null = null, people: string[] = []): ItemLine => ({
  key,
  name,
  printed: null,
  amountText,
  people: new Set(people),
  quantity,
});

const cents = (l: ItemLine) => readMoney(l.amountText)?.cents ?? 0;
const counts = (lines: ItemLine[]) => lines.map((l) => l.part?.count ?? null);
const total = (lines: ItemLine[]) => lines.reduce((s, l) => s + cents(l), 0);

// Milk, then 6 butters for $34.74, then bread.
const receipt = () => [line(0, "Milk", "6.99", 1), line(1, "Butter", "34.74", 6, ["a"]), line(2, "Bread", "3.50", 1)];

describe("which lines can be broken", () => {
  it("needs a whole count of 2 or more", () => {
    expect(isBreakableCount(6)).toBe(true);
    expect(isBreakableCount(2)).toBe(true);
    expect(isBreakableCount(1)).toBe(false);
    expect(isBreakableCount(0.535)).toBe(false);
    expect(isBreakableCount(null)).toBe(false);
    expect(isBreakableCount(100)).toBe(false);
  });
  it("needs a price above $0 and not already broken", () => {
    expect(canBreak(line(0, "Butter", "34.74"))).toBe(true);
    expect(canBreak(line(0, "Instant savings", "-3.00"))).toBe(false);
    expect(canBreak(line(0, "Free", "0.00"))).toBe(false);
    expect(canBreak(line(0, "Roma tomatoes", "2.07", 0.95))).toBe(false);
    expect(canBreak(line(0, "Bananas", "2.47", 1.42))).toBe(false);
    expect(canBreak(line(0, "Avocados, bag of 5", "4.99", 1))).toBe(true);
    expect(canBreak(breakLine(receipt(), 1, 6)[1])).toBe(false);
  });
});

describe("partCents", () => {
  it("always adds back up to the line's price", () => {
    expect(partCents(3474, [3, 3])).toEqual([1737, 1737]);
    expect(partCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(partCents(3474, [4, 2])).toEqual([2316, 1158]);
  });
});

describe("breakLine", () => {
  it("makes two parts in place, bigger half first, both with the same people", () => {
    const lines = breakLine(receipt(), 1, 6);
    expect(lines.map((l) => l.name)).toEqual(["Milk", "Butter", "Butter", "Bread"]);
    expect(counts(lines)).toEqual([null, 3, 3, null]);
    expect(lines[1].part!.line).toBe(lines[2].part!.line);
    expect([...lines[2].people]).toEqual(["a"]);
    expect(lines[2].people).not.toBe(lines[1].people);
    expect(total(lines)).toBe(total(receipt()));
    expect(new Set(lines.map((l) => l.key)).size).toBe(4);
  });
  it("splits an odd count bigger-first", () => {
    const lines = breakLine([line(0, "Eggs", "10.00", 5)], 0, 5);
    expect(counts(lines)).toEqual([3, 2]);
    expect(lines.map(cents)).toEqual([600, 400]);
  });
  it("uses a typed count when the scanner missed it", () => {
    const lines = breakLine([line(0, "Butter", "34.74", 1)], 0, 6);
    expect(counts(lines)).toEqual([3, 3]);
    expect(lines[0].quantity).toBe(6);
  });
  it("does nothing for a count that can't be broken", () => {
    expect(breakLine(receipt(), 1, 1)).toEqual(receipt());
  });
});

describe("moving one between parts", () => {
  it("+ takes from the next part and the prices follow", () => {
    const broken = breakLine(receipt(), 1, 6);
    const lines = moveOne(broken, broken[1].key, 1);
    expect(counts(lines)).toEqual([null, 4, 2, null]);
    expect(cents(lines[1]) + cents(lines[2])).toBe(3474);
    expect(cents(lines[1])).toBe(2316);
  });
  it("− gives to the next part, or the one before for the last part", () => {
    const broken = breakLine(receipt(), 1, 6);
    expect(counts(moveOne(broken, broken[1].key, -1))).toEqual([null, 2, 4, null]);
    expect(counts(moveOne(broken, broken[2].key, -1))).toEqual([null, 4, 2, null]);
  });
  it("never leaves a part with 0", () => {
    let lines = breakLine([line(0, "Pop", "4.00", 2)], 0, 2);
    expect(canShrink(lines, lines[0].key)).toBe(false);
    expect(canGrow(lines, lines[0].key)).toBe(false);
    lines = moveOne(lines, lines[0].key, 1);
    expect(counts(lines)).toEqual([1, 1]);
  });
});

describe("addPart", () => {
  it("takes 1 from the biggest part and puts a new empty part after the line's parts", () => {
    const broken = breakLine(receipt(), 1, 6);
    const { lines, added } = addPart(broken, broken[1].key);
    expect(lines.map((l) => l.name)).toEqual(["Milk", "Butter", "Butter", "Butter", "Bread"]);
    expect(counts(lines)).toEqual([null, 2, 3, 1, null]);
    expect(lines[3].key).toBe(added);
    expect(lines[3].people.size).toBe(0);
    expect(total(lines)).toBe(total(receipt()));
    expect(partLabel(lines[3])).toBe("1 of 6");
  });
  it("stops when every part has 1", () => {
    const lines = breakLine([line(0, "Pop", "4.00", 2)], 0, 2);
    expect(canAddPart(lines, lines[0].key)).toBe(false);
    expect(addPart(lines, lines[0].key).added).toBeNull();
  });
});

describe("joinBack", () => {
  it("puts the line back together with everyone who was ticked", () => {
    let lines = breakLine(receipt(), 1, 6);
    lines = lines.map((l, i) => (i === 2 ? { ...l, people: new Set(["b"]) } : l));
    lines = addPart(lines, lines[1].key).lines;
    const joined = joinBack(lines, lines[3].key);
    expect(joined.map((l) => l.name)).toEqual(["Milk", "Butter", "Bread"]);
    expect(cents(joined[1])).toBe(3474);
    expect(joined[1].quantity).toBe(6);
    expect(joined[1].part).toBeUndefined();
    expect([...joined[1].people].sort()).toEqual(["a", "b"]);
  });
});

describe("fixing a broken line", () => {
  it("a new price is shared out by count again", () => {
    let lines = breakLine(receipt(), 1, 6);
    lines = moveOne(lines, lines[1].key, 1);
    lines = setLinePrice(lines, lines[2].key, 3000);
    expect(lines.slice(1, 3).map(cents)).toEqual([2000, 1000]);
  });
  it("renaming one part renames them all, and removing one removes the whole line", () => {
    let lines = breakLine(receipt(), 1, 6);
    lines = setLineName(lines, lines[2].key, "Salted butter");
    expect(lines.map((l) => l.name)).toEqual(["Milk", "Salted butter", "Salted butter", "Bread"]);
    expect(removeLine(lines, lines[1].key).map((l) => l.name)).toEqual(["Milk", "Bread"]);
    expect(partsOf(lines, lines[0].key)).toEqual([]);
  });
});

describe("tidyParts", () => {
  it("keeps good parts and sets the line's count to their sum", () => {
    const lines = breakLine(receipt(), 1, 6).map((l) => (l.part ? { ...l, quantity: 99 } : l));
    expect(tidyParts(lines).map((l) => l.quantity)).toEqual([1, 6, 6, 1]);
  });
  it("turns broken-up or lonely parts back into plain lines", () => {
    const lonely = [{ ...line(0, "Butter", "5.00"), part: { line: 0, count: 3 } }];
    expect(tidyParts(lonely)[0].part).toBeUndefined();
    const apart = [
      { ...line(0, "Butter", "5.00"), part: { line: 0, count: 1 } },
      line(1, "Milk", "2.00"),
      { ...line(2, "Butter", "5.00"), part: { line: 0, count: 1 } },
    ];
    expect(tidyParts(apart).every((l) => !l.part)).toBe(true);
    const zero = [
      { ...line(0, "Butter", "5.00"), part: { line: 0, count: 0 } },
      { ...line(1, "Butter", "5.00"), part: { line: 0, count: 2 } },
    ];
    expect(tidyParts(zero).every((l) => !l.part)).toBe(true);
  });
});
