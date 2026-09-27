import type { MyPart } from "../lib/expenses";
import { formatCents } from "../lib/money";

// "you lent $X", "you owe $X" or "not involved", on the right of an expense row.
export function MyPartLabel({ part }: { part: MyPart }) {
  if (part.kind === "none") return <span className="my-part none">not involved</span>;
  return (
    <span className={`my-part ${part.kind}`}>
      {part.kind === "lent" ? "you lent" : "you owe"}
      <strong>{formatCents(part.cents)}</strong>
    </span>
  );
}
