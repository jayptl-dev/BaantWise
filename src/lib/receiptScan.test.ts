import { describe, expect, it } from "vitest";
import { readScan } from "./receiptScan";

describe("readScan items", () => {
  it("keeps the plain name and the printed line", () => {
    const r = readScan({ items: [{ name: "Milk 2%, 4 L", printed: "PC MLK 2% 4L", quantity: 1, amount_cents: 649 }] });
    expect(r.items[0]).toEqual({ name: "Milk 2%, 4 L", printed: "PC MLK 2% 4L", quantity: 1, amountCents: 649 });
  });

  it("drops the printed line when it reads the same", () => {
    const r = readScan({ items: [{ name: "Bananas", printed: "BANANAS", quantity: 1, amount_cents: 212 }] });
    expect(r.items[0].printed).toBeNull();
  });

  it("still works with an older reply that has no printed line", () => {
    const r = readScan({ items: [{ name: "Bread", quantity: 1, amount_cents: 349 }] });
    expect(r.items[0].printed).toBeNull();
  });
});
