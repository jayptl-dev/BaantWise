import { describe, expect, it, vi } from "vitest";
import { fxRates, pickRates, torontoToday } from "./fxRates";

const NOW = new Date("2026-10-12T15:00:00Z"); // Monday Oct 12, 2026 in Toronto

function bank(observations: unknown[], ok = true) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({ observations }), { status: ok ? 200 : 500 }));
}

const WEEK = [
  { d: "2026-10-08", FXUSDCAD: { v: "1.3650" }, FXJPYCAD: { v: "0.00921" } },
  { d: "2026-10-09", FXUSDCAD: { v: "1.3672" }, FXJPYCAD: { v: "" } },
];

describe("fx-rates", () => {
  it("gives a Saturday Friday's rates", async () => {
    const fetcher = bank(WEEK);
    const res = await fxRates(new URL("https://baantwise.com/api/fx-rates?date=2026-10-10"), fetcher, NOW);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe("2026-10-10");
    expect(body.rates.USD).toEqual({ rate: "1.3672", date: "2026-10-09" });
    // An empty value is skipped: JPY falls back to the day before.
    expect(body.rates.JPY).toEqual({ rate: "0.00921", date: "2026-10-08" });
    expect(String(fetcher.mock.calls[0][0])).toContain("start_date=2026-09-26&end_date=2026-10-10");
  });

  it("turns future dates into today (Toronto time)", async () => {
    const res = await fxRates(new URL("https://x/api/fx-rates?date=2030-01-01"), bank(WEEK), NOW);
    expect((await res.json()).date).toBe("2026-10-12");
    expect(res.headers.get("Cache-Control")).toContain("max-age=1800");
  });

  it("caches a settled past date for 30 days", async () => {
    const res = await fxRates(new URL("https://x/api/fx-rates?date=2026-10-09"), bank(WEEK), NOW);
    expect(res.headers.get("Cache-Control")).toContain(`max-age=${30 * 24 * 60 * 60}`);
  });

  it("refuses bad and too-early dates, and says when the Bank is down", async () => {
    expect((await fxRates(new URL("https://x/api/fx-rates?date=2026-02-30"), bank([]), NOW)).status).toBe(400);
    expect((await fxRates(new URL("https://x/api/fx-rates?date=2016-12-30"), bank([]), NOW)).status).toBe(404);
    expect((await fxRates(new URL("https://x/api/fx-rates?date=2026-10-09"), bank([], false), NOW)).status).toBe(502);
  });

  it("never uses a rate after the date", () => {
    expect(pickRates(WEEK, "2026-10-08").USD).toEqual({ rate: "1.3650", date: "2026-10-08" });
  });

  it("knows Toronto's date", () => {
    expect(torontoToday(new Date("2026-10-12T03:00:00Z"))).toBe("2026-10-11");
  });
});
