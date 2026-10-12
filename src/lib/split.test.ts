import { describe, expect, it } from "vitest";
import { splitByItems, splitByWeights, splitEvenly } from "./split";

const ORDER = ["jay", "priya", "sam"];
const asCents = (m: Map<string, number>) => ORDER.filter((id) => m.has(id)).map((id) => m.get(id));

describe("splitByItems (Split by item)", () => {
  it("Pizza for Jay, Salad for Priya, Wings for all three, total $50.40", () => {
    const shares = splitByItems(
      5040,
      [
        { amountCents: 2000, memberIds: ["jay"] },
        { amountCents: 1000, memberIds: ["priya"] },
        { amountCents: 1200, memberIds: ["jay", "priya", "sam"] },
      ],
      ORDER,
      "jay",
    );
    expect(asCents(shares)).toEqual([2880, 1680, 480]);
  });

  it("Nachos shared by three, total $11.30: the payer and then the next person get the leftover cents", () => {
    const shares = splitByItems(1130, [{ amountCents: 1000, memberIds: ORDER }], ORDER, "jay");
    expect(asCents(shares)).toEqual([377, 377, 376]);
  });

  it("a USD receipt shared into CA$14.70", () => {
    const shares = splitByItems(
      1470,
      [
        { amountCents: 700, memberIds: ["jay"] },
        { amountCents: 500, memberIds: ["priya"] },
        { amountCents: 100, memberIds: ["sam"] },
      ],
      ORDER,
      "jay",
    );
    expect(asCents(shares)).toEqual([792, 565, 113]);
  });

  it("splits equally between people with items when every item is $0", () => {
    const shares = splitByItems(1000, [{ amountCents: 0, memberIds: ["priya", "sam"] }], ORDER, "jay");
    expect(asCents(shares)).toEqual([500, 500]);
  });

  it("ignores items nobody is on, and always adds up to the total", () => {
    const shares = splitByItems(
      999,
      [
        { amountCents: 333, memberIds: ["jay", "sam"] },
        { amountCents: 500, memberIds: [] },
        { amountCents: 101, memberIds: ["priya", "sam", "jay"] },
      ],
      ORDER,
      "sam",
    );
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(999);
  });
});

describe("splitByWeights", () => {
  it("gives a tie to the payer even if they're listed last", () => {
    expect(asCents(splitEvenly(1000, ORDER, "sam"))).toEqual([333, 333, 334]);
  });

  it("gives the leftover cent to the biggest dropped fraction first", () => {
    // $50.00 by shares 2 and 1, paid by Jay: Jay 3333.33, Priya 1666.67 → Priya gets the cent.
    const shares = splitByWeights(5000, [{ id: "jay", weight: 2n }, { id: "priya", weight: 1n }], "jay");
    expect(asCents(shares)).toEqual([3333, 1667]);
  });

  it("returns nothing when every weight is 0", () => {
    expect(splitByWeights(100, [{ id: "jay", weight: 0n }]).size).toBe(0);
  });
});
