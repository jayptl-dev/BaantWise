// The fixed list of expense categories, in the order the picker shows them.
// The database only accepts these keys (a check on expenses.category), so the two
// must stay in step. Charts and receipt scanning use this same list.
export const CATEGORIES = [
  { key: "food", emoji: "🍔", label: "Food" },
  { key: "groceries", emoji: "🛒", label: "Groceries" },
  { key: "transport", emoji: "🚕", label: "Transport" },
  { key: "housing", emoji: "🏠", label: "Housing" },
  { key: "utilities", emoji: "💡", label: "Utilities" },
  { key: "entertainment", emoji: "🎬", label: "Entertainment" },
  { key: "travel", emoji: "✈️", label: "Travel" },
  { key: "shopping", emoji: "🛍️", label: "Shopping" },
  { key: "health", emoji: "🏥", label: "Health" },
  { key: "other", emoji: "📌", label: "Other" },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryKey = Category["key"];

// What a new expense gets when nobody picks one (the database's default too).
export const DEFAULT_CATEGORY: CategoryKey = "other";

export function isCategoryKey(value: unknown): value is CategoryKey {
  return CATEGORIES.some((c) => c.key === value);
}

// The category for a key from the database, or Other if it's missing or unknown.
export function categoryFor(key: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.key === key) ?? categoryFor(DEFAULT_CATEGORY);
}

// Simple words in a description that suggest a category.
const SUGGESTIONS = new Map<string, CategoryKey>([
  ["uber", "transport"],
  ["taxi", "transport"],
  ["lyft", "transport"],
  ["gas", "transport"],
  ["parking", "transport"],
  ["grocery", "groceries"],
  ["groceries", "groceries"],
  ["coffee", "food"],
  ["restaurant", "food"],
  ["pizza", "food"],
  ["lunch", "food"],
  ["dinner", "food"],
]);

// A category guessed from what an expense was for, or null for no guess. Only whole
// words count, ignoring capital letters ("Gas" yes, "gasoline" no). If several words
// match, the first one in the description wins ("Uber to dinner" → Transport).
export function suggestCategory(description: string): CategoryKey | null {
  for (const word of description.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const found = SUGGESTIONS.get(word);
    if (found) return found;
  }
  return null;
}
