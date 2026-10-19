import type { ItemLine } from "../components/ItemSplitSheet";
import { tidyParts } from "./breakLine";
import { centsToDecimal, readMoney } from "./money";
import { supabase } from "./supabase";

// A scanned receipt's items are kept with their expense, so "Split by item" opens again
// as it was left when the expense is edited. They follow the expense's own privacy, and
// only whoever added the expense can change them (supabase/migrations/…_expense_items.sql).
// Prices are in the expense's own currency, like its Amount box.

export const MAX_SAVED_ITEMS = 60;
const NAME_MAX = 60;

export const ITEMS_SAVE_FAILED =
  "Your expense was saved, but its receipt items weren't, so Split by item won't be there when you edit it.";

// How one item is stored. quantity: how many are on the receipt line, when known.
// part: set on each part of a line that was broken into parts ("Break this line"); the
// parts of one line share `line` and sit next to each other, `count` is how many that
// part has (lib/breakLine.ts).
export type SavedItem = {
  name: string;
  printed: string | null;
  amount_cents: number;
  member_ids: string[];
  quantity?: number;
  part?: { line: number; count: number };
  taxed?: boolean;
};

const MAX_QUANTITY = 9999;

function clip(text: string): string {
  return Array.from(text.trim()).slice(0, NAME_MAX).join("").trim();
}

// The sheet's lines as they're stored. A blank name falls back to the printed line, then
// to "Item 3"; amounts that can't be read count as $0, like they do on the sheet.
export function itemsToSave(lines: readonly ItemLine[]): SavedItem[] {
  return lines.slice(0, MAX_SAVED_ITEMS).map((line, index) => {
    const printed = line.printed ? clip(line.printed) || null : null;
    const saved: SavedItem = {
      name: clip(line.name) || printed || `Item ${index + 1}`,
      printed,
      amount_cents: readMoney(line.amountText)?.cents ?? 0,
      member_ids: [...line.people],
    };
    if (isQuantity(line.quantity)) saved.quantity = line.quantity;
    if (line.part) saved.part = { line: line.part.line, count: line.part.count };
    if (typeof line.taxed === "boolean") saved.taxed = line.taxed;
    return saved;
  });
}

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_QUANTITY;
}

function readPart(value: unknown): { line: number; count: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const part = value as Record<string, unknown>;
  if (!Number.isInteger(part.line) || !Number.isInteger(part.count)) return undefined;
  return { line: part.line as number, count: part.count as number };
}

// Stored items back as the sheet's lines. Anything malformed is skipped, and ticks for
// people who aren't in the group any more are dropped (the sheet only shows current
// members). null when there's nothing usable.
export function linesFromSaved(raw: unknown, memberIds: readonly string[]): ItemLine[] | null {
  if (!Array.isArray(raw)) return null;
  const allowed = new Set(memberIds);
  const lines: ItemLine[] = [];
  for (const entry of raw.slice(0, MAX_SAVED_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== "string" || !Number.isInteger(item.amount_cents)) continue;
    const people = Array.isArray(item.member_ids)
      ? item.member_ids.filter((id): id is string => typeof id === "string" && allowed.has(id))
      : [];
    const line: ItemLine = {
      key: lines.length,
      name: item.name,
      printed: typeof item.printed === "string" && item.printed !== "" ? item.printed : null,
      amountText: centsToDecimal(item.amount_cents as number),
      people: new Set(people),
      quantity: isQuantity(item.quantity) ? item.quantity : null,
      taxed: typeof item.taxed === "boolean" ? item.taxed : null,
    };
    const part = readPart(item.part);
    if (part) line.part = part;
    lines.push(line);
  }
  // Parts that don't fit together any more become plain lines.
  return lines.length > 0 ? tidyParts(lines) : null;
}

// The saved items of an expense as sheet lines, with the receipt's tax when it was saved:
// null when it has none. "failed" when they couldn't be loaded, so the form knows not to
// overwrite them.
export async function loadExpenseItems(
  expenseId: string,
  memberIds: readonly string[],
): Promise<{ lines: ItemLine[]; taxCents: number | null } | null | "failed"> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("items, tax_cents")
    .eq("expense_id", expenseId)
    .maybeSingle();
  if (error) return "failed";
  const lines = data ? linesFromSaved(data.items, memberIds) : null;
  if (!lines) return null;
  return { lines, taxCents: Number.isInteger(data?.tax_cents) ? (data!.tax_cents as number) : null };
}

// Saves (or, for an empty list, removes) an expense's items. Returns null if it worked,
// or the message to show (the expense itself is already saved).
export async function saveExpenseItems(
  expenseId: string,
  lines: readonly ItemLine[],
  taxCents: number | null = null,
): Promise<string | null> {
  const { error } = await supabase.rpc("set_expense_items", {
    p_expense_id: expenseId,
    p_items: itemsToSave(lines),
    // Left out when unknown: the database then keeps no tax for these items.
    ...(taxCents !== null ? { p_tax_cents: taxCents } : {}),
  });
  return error ? ITEMS_SAVE_FAILED : null;
}
