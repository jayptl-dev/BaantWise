import type { ItemLine } from "../components/ItemSplitSheet";
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

// How one item is stored.
export type SavedItem = { name: string; printed: string | null; amount_cents: number; member_ids: string[] };

function clip(text: string): string {
  return Array.from(text.trim()).slice(0, NAME_MAX).join("").trim();
}

// The sheet's lines as they're stored. A blank name falls back to the printed line, then
// to "Item 3"; amounts that can't be read count as $0, like they do on the sheet.
export function itemsToSave(lines: readonly ItemLine[]): SavedItem[] {
  return lines.slice(0, MAX_SAVED_ITEMS).map((line, index) => {
    const printed = line.printed ? clip(line.printed) || null : null;
    return {
      name: clip(line.name) || printed || `Item ${index + 1}`,
      printed,
      amount_cents: readMoney(line.amountText)?.cents ?? 0,
      member_ids: [...line.people],
    };
  });
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
    lines.push({
      key: lines.length,
      name: item.name,
      printed: typeof item.printed === "string" && item.printed !== "" ? item.printed : null,
      amountText: centsToDecimal(item.amount_cents as number),
      people: new Set(people),
    });
  }
  return lines.length > 0 ? lines : null;
}

// The saved items of an expense as sheet lines: null when it has none. "failed" when
// they couldn't be loaded, so the form knows not to overwrite them.
export async function loadExpenseItems(expenseId: string, memberIds: readonly string[]): Promise<ItemLine[] | null | "failed"> {
  const { data, error } = await supabase.from("expense_items").select("items").eq("expense_id", expenseId).maybeSingle();
  if (error) return "failed";
  return data ? linesFromSaved(data.items, memberIds) : null;
}

// Saves (or, for an empty list, removes) an expense's items. Returns null if it worked,
// or the message to show (the expense itself is already saved).
export async function saveExpenseItems(expenseId: string, lines: readonly ItemLine[]): Promise<string | null> {
  const { error } = await supabase.rpc("set_expense_items", { p_expense_id: expenseId, p_items: itemsToSave(lines) });
  return error ? ITEMS_SAVE_FAILED : null;
}
