import { describe, expect, it } from "vitest";
import type { CategoryKey } from "./categories";
import type { Expense } from "./expenses";
import {
  barSize,
  categoryTotals,
  emptyPeriodLine,
  groupSpendingRows,
  monthlyTotals,
  percentOf,
  periodRange,
  type SpendingRow,
} from "./spending";

const TODAY = "2026-09-26";

function row(category: CategoryKey, amountCents: number, spentOn: string, id = `${category}-${spentOn}`): SpendingRow {
  return { id, groupId: "g", groupName: "", description: id, category, amountCents, spentOn };
}

describe("periodRange", () => {
  it("gives the dates of each period", () => {
    expect(periodRange("this_month", TODAY)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodRange("last_month", TODAY)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(periodRange("this_year", TODAY)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(periodRange("all_time", TODAY)).toEqual({ start: null, end: null });
  });

  it("handles January (last month is December last year) and February", () => {
    expect(periodRange("last_month", "2026-01-15")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(periodRange("this_month", "2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodRange("last_month", "2026-03-31")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("categoryTotals", () => {
  const rows = [
    row("food", 1500, "2026-09-02", "a"),
    row("food", 500, "2026-09-20", "b"),
    row("housing", 120000, "2026-08-01", "rent"),
    row("transport", 2000, "2026-09-30", "c"),
    row("other", 0, "2026-09-10", "zero"),
  ];

  it("leaves out a housing row from August this month, but counts it for all time", () => {
    expect(categoryTotals(rows, "this_month", TODAY)).toEqual([
      { category: "food", totalCents: 2000 },
      { category: "transport", totalCents: 2000 },
    ]);
    expect(categoryTotals(rows, "all_time", TODAY)[0]).toEqual({ category: "housing", totalCents: 120000 });
  });

  it("drops $0 categories and keeps ties in the usual category order", () => {
    const totals = categoryTotals(rows, "this_month", TODAY);
    expect(totals.map((t) => t.category)).toEqual(["food", "transport"]);
  });

  it("gives nothing for an empty period", () => {
    expect(categoryTotals(rows, "last_month", "2026-12-05")).toEqual([]);
  });
});

describe("monthlyTotals", () => {
  it("gives 12 months, oldest first, this month included, $0 months kept", () => {
    const months = monthlyTotals([row("food", 700, "2026-09-01"), row("food", 300, "2025-10-31")], 12, TODAY);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: "2025-10", totalCents: 300 });
    expect(months[11]).toEqual({ month: "2026-09", totalCents: 700 });
    expect(months[5]).toEqual({ month: "2026-03", totalCents: 0 });
  });

  it("ignores anything older than the window", () => {
    const months = monthlyTotals([row("food", 999, "2025-09-30")], 12, TODAY);
    expect(months.every((m) => m.totalCents === 0)).toBe(true);
  });
});

describe("labels and sizes", () => {
  it("rounds percentages without showing 0% or 100% for a part", () => {
    expect(percentOf(1, 1000)).toBe("1%");
    expect(percentOf(999, 1000)).toBe("99%");
    expect(percentOf(500, 1000)).toBe("50%");
    expect(percentOf(1000, 1000)).toBe("100%");
    expect(percentOf(0, 1000)).toBe("0%");
  });

  it("sizes bars against the biggest, with a sliver for tiny amounts", () => {
    expect(barSize(500, 1000)).toBe(50);
    expect(barSize(1, 100000)).toBe(2);
    expect(barSize(0, 1000)).toBe(0);
  });

  it("says the right thing for an empty period", () => {
    expect(emptyPeriodLine("this_month", false)).toBe("No group expenses yet this month.");
    expect(emptyPeriodLine("all_time", false)).toBe("No group expenses yet.");
    expect(emptyPeriodLine("last_month", true)).toBe("You didn't have any spending last month.");
  });
});

describe("groupSpendingRows", () => {
  it("only counts expenses the whole group can see", () => {
    const base: Omit<Expense, "id" | "visibility"> = {
      description: "x",
      amount_cents: 1000,
      paid_by: "m1",
      spent_on: TODAY,
      category: "food",
      created_by: null,
      created_at: "",
      receipt_path: null,
      shares: [],
    };
    const rows = groupSpendingRows("g", [
      { ...base, id: "shared", visibility: "group" },
      { ...base, id: "private", visibility: "participants" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["shared"]);
  });
});
