import { describe, expect, it } from "vitest";
import { currencyDecimals, foreignToCadShares, formatForeign, rateFromNumber, rateText, readRate, toCadCents } from "./currency";

describe("currency maths", () => {
  it("US$84.50 at 1.3672 is CA$115.53", () => {
    expect(toCadCents(8450, readRate("1.3672")!)).toBe(11553);
  });

  it("¥1,500 at 0.008990 is CA$13.49 (half a cent rounds up)", () => {
    expect(toCadCents(150000, readRate("0.008990")!)).toBe(1349);
  });

  it("splits exact foreign amounts into CAD shares in proportion", () => {
    const shares = foreignToCadShares(11553, [{ id: "a", hundredths: 5000 }, { id: "b", hundredths: 3450 }], "a");
    expect([shares.get("a"), shares.get("b")]).toEqual([6836, 4717]);
  });

  it("reads and prints rates exactly", () => {
    expect(readRate("0")).toBeNull();
    expect(readRate("10000")).toBeNull();
    expect(readRate("1.12345678901")).toBeNull();
    expect(rateText(readRate("1.3670")!)).toBe("1.367");
    expect(rateText(rateFromNumber(0.00899)!)).toBe("0.00899");
    expect(rateText(rateFromNumber(1.3672)!)).toBe("1.3672");
  });

  it("knows which currencies have no decimals", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("USD")).toBe(2);
    expect(formatForeign(150000, "JPY")).toContain("1,500");
    expect(formatForeign(8450, "USD")).toBe("US$84.50");
  });
});
