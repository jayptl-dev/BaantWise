import { describe, expect, it } from "vitest";
import { shorten } from "./format";
import { cleanDate, likePattern } from "./search";

describe("likePattern: what someone typed → 'description contains this'", () => {
  it("finds the text anywhere, including part of a word", () => {
    expect(likePattern("pizz")).toBe("%pizz%");
    expect(likePattern("Uber Eats")).toBe("%Uber Eats%");
  });

  it("makes \\, % and _ match themselves", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("C:\\bills")).toBe("%C:\\\\bills%");
  });

  it("drops *, which the database would treat as 'anything'", () => {
    expect(likePattern("pizza*")).toBe("%pizza%");
    expect(likePattern("a*b")).toBe("%ab%");
  });

  it("ignores spaces around the text, and returns null when nothing is left", () => {
    expect(likePattern("  taxi ")).toBe("%taxi%");
    expect(likePattern("")).toBeNull();
    expect(likePattern("   ")).toBeNull();
    expect(likePattern("**")).toBeNull();
  });
});

describe("cleanDate", () => {
  it("keeps a date and turns anything else into 'no date'", () => {
    expect(cleanDate("2026-09-05")).toBe("2026-09-05");
    expect(cleanDate("")).toBe("");
    expect(cleanDate(null)).toBe("");
    expect(cleanDate("yesterday")).toBe("");
  });
});

describe("shorten", () => {
  it("leaves short text alone", () => {
    expect(shorten("Groceries", 50)).toBe("Groceries");
    expect(shorten("x".repeat(50), 50)).toBe("x".repeat(50));
  });

  it("keeps the first characters and adds …", () => {
    expect(shorten("x".repeat(51), 50)).toBe(`${"x".repeat(50)}…`);
    expect(shorten("Dinner at the place by the lake", 10)).toBe("Dinner at…");
  });

  it("never cuts an emoji in half", () => {
    expect(shorten("🍕🍕🍕", 2)).toBe("🍕🍕…");
  });
});
