import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryFor, isCategoryKey, suggestCategory } from "./categories";

describe("CATEGORIES", () => {
  it("has the 10 keys the database accepts, in picker order, with Other last", () => {
    expect(CATEGORIES.map((c) => c.key)).toEqual([
      "food",
      "groceries",
      "transport",
      "housing",
      "utilities",
      "entertainment",
      "travel",
      "shopping",
      "health",
      "other",
    ]);
  });

  it("gives every category an emoji and a label", () => {
    for (const c of CATEGORIES) {
      expect(c.emoji).not.toBe("");
      expect(c.label).not.toBe("");
    }
  });
});

describe("categoryFor", () => {
  it("finds a category by its key", () => {
    expect(categoryFor("food")).toEqual({ key: "food", emoji: "🍔", label: "Food" });
    expect(categoryFor("health").label).toBe("Health");
  });

  it("falls back to Other for a missing or unknown key", () => {
    expect(categoryFor(null).key).toBe("other");
    expect(categoryFor(undefined).key).toBe("other");
    expect(categoryFor("pets").key).toBe("other");
    expect(categoryFor("Food").key).toBe("other");
  });
});

describe("isCategoryKey", () => {
  it("only accepts the 10 keys", () => {
    expect(isCategoryKey("transport")).toBe(true);
    expect(isCategoryKey("other")).toBe(true);
    expect(isCategoryKey("Transport")).toBe(false);
    expect(isCategoryKey("")).toBe(false);
    expect(isCategoryKey(null)).toBe(false);
  });
});

describe("suggestCategory: a guess from the description", () => {
  it("knows the transport, groceries and food words", () => {
    for (const word of ["uber", "taxi", "lyft", "gas", "parking"]) expect(suggestCategory(word)).toBe("transport");
    for (const word of ["grocery", "groceries"]) expect(suggestCategory(word)).toBe("groceries");
    for (const word of ["coffee", "restaurant", "pizza", "lunch", "dinner"]) {
      expect(suggestCategory(word)).toBe("food");
    }
  });

  it("ignores capital letters", () => {
    expect(suggestCategory("Lunch at Monza")).toBe("food");
    expect(suggestCategory("UBER home")).toBe("transport");
    expect(suggestCategory("Weekly Groceries")).toBe("groceries");
  });

  it("only matches whole words", () => {
    expect(suggestCategory("Gasoline")).toBeNull();
    expect(suggestCategory("Pizzeria")).toBeNull();
    expect(suggestCategory("Lunchbox")).toBeNull();
    expect(suggestCategory("Megastore")).toBeNull();
  });

  it("treats punctuation and numbers as the edges of words", () => {
    expect(suggestCategory("pizza!")).toBe("food");
    expect(suggestCategory("Costco-groceries")).toBe("groceries");
    expect(suggestCategory("Uber's fee")).toBe("transport");
    expect(suggestCategory("(parking)")).toBe("transport");
    expect(suggestCategory("2 coffees")).toBeNull();
  });

  it("uses the first matching word", () => {
    expect(suggestCategory("Uber to dinner")).toBe("transport");
    expect(suggestCategory("Dinner, then a taxi")).toBe("food");
  });

  it("returns null when nothing matches", () => {
    expect(suggestCategory("")).toBeNull();
    expect(suggestCategory("   ")).toBeNull();
    expect(suggestCategory("Movie tickets")).toBeNull();
    expect(suggestCategory("constructor")).toBeNull();
    expect(suggestCategory("toString")).toBeNull();
  });
});
