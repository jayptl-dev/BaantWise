import { describe, expect, it } from "vitest";
import {
  cleanReceipt,
  isItemFeeLine,
  isRealDiscountLine,
  isSummaryLine,
  settleTaxMarks,
  type ScanItem,
} from "../../supabase/functions/scan-receipt/cleanup";

// The scan-receipt Edge Function's cleanup of what Gemini read. Lines are in the style of
// real Canadian receipts (see the PR notes); names and prices are made up.

const TODAY = "2026-10-19";
const line = (printed: string, amount_cents: number, taxed: boolean | null = null, quantity = 1) => ({
  printed,
  name: printed,
  quantity,
  amount_cents,
  taxed,
});
const read = (items: unknown[], totals: Record<string, number | null>) =>
  cleanReceipt({ is_receipt: true, category: "groceries", items, ...totals }, TODAY)!;

describe("tax marks", () => {
  it("Costco Ontario: only the H item is taxed", () => {
    const r = read(
      [line("KIRKLAND MILK", 1049, false), line("KS PAPER TOWEL", 2499, true), line("ROTISSERIE CHICKEN", 799, false)],
      { subtotal_cents: 4347, tax_cents: 325, tip_cents: null, total_cents: 4672 },
    );
    expect(r.items.map((i) => i.taxed)).toEqual([false, true, false]);
    expect(r.warnings).toEqual([]);
  });

  it("items left unmarked become untaxed once some are marked", () => {
    const items: ScanItem[] = [
      { name: "Milk", printed: null, quantity: 1, amount_cents: 568, taxed: null },
      { name: "Paper towels", printed: null, quantity: 1, amount_cents: 797, taxed: true },
    ];
    expect(settleTaxMarks(items, 104)).toBe(true);
    expect(items.map((i) => i.taxed)).toEqual([false, true]);
  });

  it("a restaurant bill with no marks: all null", () => {
    const r = read([line("BURGER", 1999), line("SALAD", 1499)], {
      subtotal_cents: 3498, tax_cents: 455, tip_cents: null, total_cents: 3953,
    });
    expect(r.items.map((i) => i.taxed)).toEqual([null, null]);
  });

  it("misread marks (tax far above 16% of the taxed items) are dropped, with a warning", () => {
    const r = read([line("BURGER", 1999, false), line("POP", 199, true)], {
      subtotal_cents: 2198, tax_cents: 286, tip_cents: null, total_cents: 2484,
    });
    expect(r.items.map((i) => i.taxed)).toEqual([null, null]);
    expect(r.warnings).toContain("tax_marks_unsure");
  });

  it("no tax on the receipt: marks are ignored", () => {
    const r = read([line("BUTTER", 499, true)], { subtotal_cents: 499, tax_cents: 0, tip_cents: null, total_cents: 499 });
    expect(r.items[0].taxed).toBeNull();
  });

  it("Costco instant savings (TPD/) come off the taxed item, which stays taxed", () => {
    const r = read(
      [line("KS PAPER TOWEL", 2499, true), { printed: "TPD/1234567", name: "Instant savings", quantity: 1, amount_cents: -400, taxed: true }],
      { subtotal_cents: 2099, tax_cents: 273, tip_cents: null, total_cents: 2372 },
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ amount_cents: 2099, taxed: true });
  });
});

describe("deposits and eco fees", () => {
  it("recognises deposit and fee lines, but not bag fees, delivery or tax", () => {
    for (const text of ["NS DEPOSIT", "DEPOSIT 1", "+Deposit", "ECO FEE", "+EHC", "Consigne", "ENVIRO FEE", "BC CRF"]) {
      expect(isItemFeeLine(text), text).toBe(true);
    }
    for (const text of ["BAG FEE", "DELIVERY FEE", "Coke 12pk", "SERVICE CHARGE", "TAX", "FEE"]) {
      expect(isItemFeeLine(text), text).toBe(false);
    }
  });

  it("Walmart Nova Scotia: the deposit and the eco fee join the item above; a bag fee stays an item", () => {
    const r = read(
      [
        line("COKE 355ML 12PK", 897, true),
        line("NS DEPOSIT", 10, false),
        line("AA BATTERIES 8PK", 1297, true),
        line("NS ECO FEE", 40, true),
        line("BAG FEE", 25, true),
      ],
      { subtotal_cents: 2269, tax_cents: 317, tip_cents: null, total_cents: 2586 },
    );
    expect(r.items.map((i) => [i.name, i.amount_cents])).toEqual([
      ["COKE 355ML 12PK", 907],
      ["AA BATTERIES 8PK", 1337],
      ["BAG FEE", 25],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("a fee line with no item above it stays its own item, so its cost isn't lost", () => {
    const r = read([line("DEPOSIT", 10), line("MILK", 500)], { subtotal_cents: 510, tax_cents: 0, tip_cents: null, total_cents: 510 });
    expect(r.items.map((i) => i.name)).toEqual(["DEPOSIT", "MILK"]);
    expect(r.warnings).toEqual([]);
  });
});

describe("summary lines", () => {
  it("drops totals, tax, payment and savings lines", () => {
    for (const text of ["SUBTOTAL", "HST 13%", "TOTAL DUE", "YOU SAVED", "MASTERCARD", "CHANGE", "Sous-total"]) {
      expect(isSummaryLine(text), text).toBe(true);
    }
    expect(isSummaryLine("Garlic fries")).toBe(false);
  });
});

describe("likely misreads (from real Canadian receipt formats)", () => {
  // One chicken breast at $16.49, then a line the reader might list by mistake.
  const after = (printed: string, amount_cents: number) =>
    read([line("CHICKEN BREAST", 1649), line(printed, amount_cents)], {
      subtotal_cents: null, tax_cents: 0, tip_cents: null, total_cents: 5000,
    }).items.map((i) => [i.name, i.amount_cents]);

  it("takes real discounts off the item above (English and French)", () => {
    expect(after("YOUR DISCOUNT", -500)).toEqual([["CHICKEN BREAST", 1149]]);
    expect(after("INSTANT SAVINGS", -400)).toEqual([["CHICKEN BREAST", 1249]]);
    expect(after("MEMBER PRICING", -149)).toEqual([["CHICKEN BREAST", 1500]]);
    expect(after("Rabais", -200)).toEqual([["CHICKEN BREAST", 1449]]);
    expect(after("DISCOUNT", -200)).toEqual([["CHICKEN BREAST", 1449]]);
    expect(after("COUPON", -100)).toEqual([["CHICKEN BREAST", 1549]]);
  });

  it("ignores lines that only inform", () => {
    for (const [text, cents] of [
      ["YOU SAVED", -80],
      ["YOUR SAVINGS", -80],
      ["TOTAL DISCOUNT(S)", -900],
      ["POINTS EARNED", 100],
      ["Scene+ Balance", 3450],
      ["PC Optimum Points Redeemed", -1000],
      ["Regular price", 599],
    ] as const) {
      expect(after(text, cents), text).toEqual([["CHICKEN BREAST", 1649]]);
    }
  });

  it("ignores payment, change, tax and tip lines", () => {
    for (const [text, cents] of [
      ["MCARD TEND", 5000],
      ["Remise", 1106],
      ["CHANGE DUE", 282],
      ["ROUNDING", -2],
      ["T.P.S.", 187],
      ["T.V.Q.", 372],
      ["AUTO GRAT 18%", 2400],
      ["Suggested tip 15%", 1125],
    ] as const) {
      expect(after(text, cents), text).toEqual([["CHICKEN BREAST", 1649]]);
    }
  });

  it("tells real discounts from information lines", () => {
    expect(isRealDiscountLine("YOUR DISCOUNT")).toBe(true);
    expect(isRealDiscountLine("Rabais")).toBe(true);
    expect(isRealDiscountLine("TOTAL DISCOUNT(S)")).toBe(false);
    expect(isRealDiscountLine("YOUR SAVINGS")).toBe(false);
  });

  it("keeps ordinary items that share a word with those lines", () => {
    expect(after("PC ORGANIC MILK", 599)).toEqual([["CHICKEN BREAST", 1649], ["PC ORGANIC MILK", 599]]);
    expect(after("Auto air freshener", 499)).toEqual([["CHICKEN BREAST", 1649], ["Auto air freshener", 499]]);
  });
});
