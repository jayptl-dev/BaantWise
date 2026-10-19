import { describe, expect, it } from "vitest";
import { cleanReceipt } from "../../supabase/functions/scan-receipt/cleanup";
import { checkItems, splitItemsWithTax } from "./itemSplit";
import cases from "./fixtures/hardReceipts.json";

// 50 hard, made-up Canadian test receipts (Loblaws, Walmart, Costco, Shoppers, Sobeys,
// Safeway, Metro, Dollarama, Quebec French receipts, restaurants with auto-gratuity and
// card slips, a US receipt and 3 deliberately broken ones), each with an exact answer key:
// what the scanner should read and how a realistic group would split it.
// The images live outside the repo; these tests check everything after the reading:
//  1. the scanner cleanup keeps a perfect read intact (no item lost, price or tax mark changed),
//  2. "doesn't add up" warnings appear on the broken receipts and only on them,
//  3. Split by item adds up to the total and gives everyone their exact share within a cent.

type Item = { printed: string; name: string; quantity: number; amount_cents: number; taxed: boolean | null };
type Case = {
  file: string;
  receipt_is_broken: boolean;
  expected: {
    merchant: string;
    date: string;
    currency: string;
    items: Item[];
    subtotal_cents: number | null;
    tax_cents: number | null;
    tip_cents: number | null;
    total_cents: number;
  };
  split: { people: string[]; assign: string[][] };
};

// Each person's exact share: the tax over the taxed items (when the receipt marks them and
// the tax fits inside what's left after the items), everything else over all items.
function exactShares(c: Case): Map<string, number> {
  const e = c.expected;
  const tax = e.tax_cents ?? 0;
  const itemsTotal = e.items.reduce((s, it) => s + it.amount_cents, 0);
  const taxToMarked = tax > 0 && e.items.some((it) => it.taxed === true && it.amount_cents > 0) && tax <= e.total_cents - itemsTotal;
  const all = new Map<string, number>();
  const taxed = new Map<string, number>();
  e.items.forEach((it, i) => {
    const people = c.split.assign[i];
    for (const p of people) {
      all.set(p, (all.get(p) ?? 0) + Math.max(0, it.amount_cents) / people.length);
      if (it.taxed === true) taxed.set(p, (taxed.get(p) ?? 0) + Math.max(0, it.amount_cents) / people.length);
    }
  });
  const A = [...all.values()].reduce((a, b) => a + b, 0);
  const T = [...taxed.values()].reduce((a, b) => a + b, 0);
  const rest = taxToMarked ? e.total_cents - tax : e.total_cents;
  const shares = new Map<string, number>();
  for (const [p, w] of all) shares.set(p, (rest * w) / A + (taxToMarked ? (tax * (taxed.get(p) ?? 0)) / T : 0));
  return shares;
}

describe("50 hard Canadian test receipts", () => {
  it("are all there", () => {
    expect((cases as Case[]).length).toBe(50);
  });

  for (const c of cases as Case[]) {
    it(c.file, () => {
      const e = c.expected;
      const cleaned = cleanReceipt({ is_receipt: true, category: "groceries", ...e }, "2026-12-31");
      expect(cleaned).not.toBeNull();
      // $0 lines (a free green tea) are dropped on purpose: no money changes hands.
      const paid = e.items.filter((it) => it.amount_cents !== 0);
      expect(cleaned!.items.map((it) => [it.amount_cents, it.taxed])).toEqual(paid.map((it) => [it.amount_cents, it.taxed]));

      const addUp = cleaned!.warnings.filter((w) => w !== "tax_marks_unsure");
      expect(cleaned!.warnings).not.toContain("tax_marks_unsure");
      const itemsTotal = e.items.reduce((s, it) => s + it.amount_cents, 0);
      const check = checkItems(itemsTotal, e.total_cents, { subtotalCents: e.subtotal_cents, taxCents: e.tax_cents, tipCents: e.tip_cents });
      if (c.receipt_is_broken) {
        expect(addUp.length).toBeGreaterThan(0);
        expect(check.subtotalGap).not.toBeNull();
      } else {
        expect(addUp).toEqual([]);
        expect(check).toEqual({ subtotalGap: null, overAmount: null });
      }

      expect(c.split.assign).toHaveLength(e.items.length);
      const shares = splitItemsWithTax(
        e.total_cents,
        e.items.map((it, i) => ({ amountCents: it.amount_cents, memberIds: c.split.assign[i], taxed: it.taxed })),
        e.tax_cents,
        c.split.people,
        c.split.people[0],
      );
      expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(e.total_cents);
      for (const [person, exact] of exactShares(c)) {
        expect(Math.abs((shares.get(person) ?? 0) - exact), `${person} on ${c.file}`).toBeLessThan(1);
      }
    });
  }
});
