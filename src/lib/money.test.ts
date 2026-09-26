import { describe, expect, it } from "vitest";
import { centsToDecimal, formatCents, readMoney, splitEqually } from "./money";

describe("readMoney: one amount (the total box)", () => {
  it("turns amounts into whole cents", () => {
    expect(readMoney("12")?.cents).toBe(1200);
    expect(readMoney("12.5")?.cents).toBe(1250);
    expect(readMoney("12.50")?.cents).toBe(1250);
    expect(readMoney(".75")?.cents).toBe(75);
    expect(readMoney("0.07")?.cents).toBe(7);
    expect(readMoney("1000000")?.cents).toBe(100_000_000);
  });

  it("treats a comma as the decimal point", () => {
    expect(readMoney("12,50")).toEqual({ text: "12.50", cents: 1250, isSum: false });
  });

  it("tidies away spaces and dollar signs", () => {
    expect(readMoney(" $12.50 ")).toEqual({ text: "12.50", cents: 1250, isSum: false });
  });

  it("counts unfinished amounts", () => {
    expect(readMoney("3.")?.cents).toBe(300);
    expect(readMoney(".")?.cents).toBe(0);
  });

  it("says an empty box is empty, not $0", () => {
    expect(readMoney("")).toEqual({ text: "", cents: null, isSum: false });
  });

  it("refuses anything that isn't money", () => {
    for (const text of ["+", "3.33+3", "12.345", "1.2.3", "abc", "12a", "-5", "1,234.56", "12345678"]) {
      expect(readMoney(text), text).toBeNull();
    }
  });
});

describe("readMoney: sums (exact amount boxes)", () => {
  it("adds and takes away exactly", () => {
    expect(readMoney("115.22+64.88", true)).toEqual({ text: "115.22+64.88", cents: 18010, isSum: true });
    expect(readMoney("20-4.50", true)?.cents).toBe(1550);
    expect(readMoney("0.10+0.20", true)?.cents).toBe(30); // 0.1 + 0.2 is 0.30000000000000004 with decimals
    expect(readMoney("10+2,5", true)?.cents).toBe(1250);
    expect(readMoney("20−4.50", true)?.cents).toBe(1550); // the "−" some keyboards type
  });

  it("ignores a + or - that's still being typed", () => {
    expect(readMoney("115.22+", true)?.cents).toBe(11522);
    expect(readMoney("115.22+.", true)?.cents).toBe(11522);
  });

  it("can come out below zero, for the form to point out", () => {
    expect(readMoney("5-10", true)?.cents).toBe(-500);
  });

  it("refuses broken sums", () => {
    for (const text of ["+5", "-5", "5++3", "5+-3", ".+3", "3.333+1", "2*3", "10/2"]) {
      expect(readMoney(text, true), text).toBeNull();
    }
  });

  it("refuses sums in a box that doesn't allow them", () => {
    expect(readMoney("10+2")).toBeNull();
  });
});

describe("splitEqually", () => {
  it("gives the leftover cent to the payer first ($10.00 three ways)", () => {
    const shares = splitEqually(1000, ["priya", "jay", "sam"], "jay");
    expect(Object.fromEntries(shares)).toEqual({ jay: 334, priya: 333, sam: 333 });
  });

  it("gives leftover cents to the first people listed when the payer isn't in it", () => {
    const shares = splitEqually(1001, ["priya", "sam", "ali"], "jay");
    expect(Object.fromEntries(shares)).toEqual({ priya: 334, sam: 334, ali: 333 });
  });

  it("always adds up to the total", () => {
    const shares = splitEqually(34566, ["a", "b", "c", "d", "e", "f", "g"], "d");
    expect([...shares.values()].reduce((sum, cents) => sum + cents, 0)).toBe(34566);
  });
});

describe("showing money", () => {
  it("writes cents as dollars without rounding", () => {
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(1234)).toBe("12.34");
    expect(centsToDecimal(-5)).toBe("-0.05");
  });

  it("uses the Canadian dollar format", () => {
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(100_000_000)).toBe("$1,000,000.00");
  });
});
