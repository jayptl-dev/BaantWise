import { categoryFor, type CategoryKey } from "../lib/categories";

// A category's emoji, like 🍔. Screen readers say its name ("Food") instead.
export function CategoryEmoji({ category }: { category: CategoryKey }) {
  const { emoji, label } = categoryFor(category);
  return (
    <span role="img" aria-label={label}>
      {emoji}
    </span>
  );
}
