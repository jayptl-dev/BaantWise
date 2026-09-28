import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_KEYWORDS,
  categoryFor,
  isCategoryKey,
  normalizeText,
  suggestCategory,
  type CategoryKey,
  type PastExpense,
} from "./categories";

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

describe("normalizeText", () => {
  it("lowercases, removes accents and apostrophes, and turns everything else into single spaces", () => {
    expect(normalizeText("Tim Horton's")).toBe("tim hortons");
    expect(normalizeText("Tim Horton’s Café!!")).toBe("tim hortons cafe");
    expect(normalizeText("Épicerie")).toBe("epicerie");
    expect(normalizeText("  Save-On-Foods  (Kelowna) ")).toBe("save on foods kelowna");
    expect(normalizeText("Wi-Fi, 407 ETR")).toBe("wi fi 407 etr");
    expect(normalizeText("!!!")).toBe("");
  });
});

describe("CATEGORY_KEYWORDS", () => {
  const all = CATEGORIES.flatMap((c) => CATEGORY_KEYWORDS[c.key].map((word) => ({ word, key: c.key })));

  it("has keywords for every category except Other", () => {
    for (const c of CATEGORIES) {
      if (c.key === "other") expect(CATEGORY_KEYWORDS.other).toEqual([]);
      else expect(CATEGORY_KEYWORDS[c.key].length).toBeGreaterThan(10);
    }
  });

  it("never puts the same word in two categories, or twice in one", () => {
    const seen = new Map<string, CategoryKey>();
    for (const { word, key } of all) {
      const normal = normalizeText(word);
      expect(seen.has(normal), `"${word}" is in ${seen.get(normal)} and ${key}`).toBe(false);
      seen.set(normal, key);
    }
  });

  it("only has keywords of 1 to 3 words (longer ones would never match)", () => {
    for (const { word } of all) {
      const words = normalizeText(word).split(" ").filter(Boolean).length;
      expect(words, `"${word}"`).toBeGreaterThanOrEqual(1);
      expect(words, `"${word}"`).toBeLessThanOrEqual(3);
    }
  });

  it("leaves out words that could mean two categories", () => {
    const words = new Set(all.map(({ word }) => normalizeText(word)));
    for (const unclear of ["metro", "subway", "ticket", "phone", "insurance", "bill", "water"]) {
      expect(words.has(unclear), unclear).toBe(false);
    }
  });
});

describe("suggestCategory: keywords", () => {
  const cases: [string, CategoryKey][] = [
    ["water heater", "utilities"],
    ["Rent", "housing"],
    ["food", "food"],
    ["Uber home", "transport"],
    ["Uber Eats", "food"],
    ["Tim Horton's", "food"],
    ["No Frills run", "groceries"],
    ["hydro bill", "utilities"],
    ["gas", "transport"],
    ["Gas bill", "utilities"],
    ["Épicerie", "groceries"],
    ["Flight to Calgary", "travel"],
    ["Pizzas", "food"],
    ["Netflix", "entertainment"],
    ["dentist", "health"],
    ["random thing", "other"],
  ];
  it.each(cases)("%s → %s", (description, expected) => {
    expect(suggestCategory(description)).toBe(expected);
  });

  it("prefers the longest match: 3 words, then 2, then 1", () => {
    expect(suggestCategory("Shoppers Drug Mart")).toBe("health");
    expect(suggestCategory("Skip the dishes order")).toBe("food");
    expect(suggestCategory("Costco gas")).toBe("transport");
    expect(suggestCategory("Costco")).toBe("groceries");
    expect(suggestCategory("Canadian Tire")).toBe("shopping");
  });

  it("uses the first match in the description when they're the same length", () => {
    expect(suggestCategory("Uber to dinner")).toBe("transport");
    expect(suggestCategory("Dinner, then a taxi")).toBe("food");
  });

  it("also tries a word without its trailing s", () => {
    expect(suggestCategory("Movers")).toBe("housing");
    expect(suggestCategory("Snacks")).toBe("food");
    expect(suggestCategory("Flights")).toBe("travel");
    expect(suggestCategory("Ice creams")).toBe("food");
  });

  it("only matches whole words", () => {
    expect(suggestCategory("Lunchbox")).toBe("other");
    expect(suggestCategory("Megastore")).toBe("other");
    expect(suggestCategory("Barn door")).toBe("other");
  });

  it("gives Other for empty or unknown text", () => {
    expect(suggestCategory("")).toBe("other");
    expect(suggestCategory("   ")).toBe("other");
    expect(suggestCategory("!!!")).toBe("other");
    expect(suggestCategory("constructor")).toBe("other");
    expect(suggestCategory("toString")).toBe("other");
  });
});

describe("suggestCategory: this group's earlier expenses", () => {
  // Newest first, like the group page.
  const past: PastExpense[] = [
    { description: "Costco run", category: "shopping" },
    { description: "Pizza night", category: "other" },
    { description: "Rent", category: "groceries" },
    { description: "costco RUN!", category: "health" },
  ];

  it("uses the category of the most recent expense with the same description", () => {
    expect(suggestCategory("costco run", past)).toBe("shopping");
    expect(suggestCategory("  Costco   run ", past)).toBe("shopping");
    expect(suggestCategory("Rent", past)).toBe("groceries");
  });

  it("falls back to the keywords when the most recent one is Other", () => {
    expect(suggestCategory("pizza night", past)).toBe("food");
  });

  it("only uses the whole description, not part of it", () => {
    expect(suggestCategory("Costco", past)).toBe("groceries");
    expect(suggestCategory("Costco run again", past)).toBe("groceries");
  });

  it("works with no history", () => {
    expect(suggestCategory("costco run", [])).toBe("groceries");
  });
});
