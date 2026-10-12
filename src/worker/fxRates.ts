// GET /api/fx-rates?date=YYYY-MM-DD on baantwise.com (run by the Cloudflare Worker).
// Gives the Bank of Canada daily rates (Canadian dollars for 1 unit of each currency),
// using the latest rate published on or before the date: rates come out on business
// days only, so a Saturday gets Friday's. No secrets, no personal data.
//
// Answers: 200 { date, source, rates: { USD: { rate: "1.3672", date: "2026-09-24" }, … } }
//          400 bad date · 404 before the Bank's daily series starts · 502 Bank unreachable
import { FOREIGN_CURRENCIES } from "../lib/currency";

const FIRST_DATE = "2017-01-03"; // the first day of the Bank's FX_RATES_DAILY series
const LOOK_BACK_DAYS = 14; // enough to cover long weekends and holidays
const SETTLED_SECONDS = 30 * 24 * 60 * 60; // a date with a published rate on it never changes
const RECENT_SECONDS = 30 * 60; // today's (or a recent) answer can still get a newer rate

type Observation = Record<string, { v?: string } | string | undefined> & { d?: string };

function json(status: number, body: unknown, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
  });
}

// "2026-10-11" in Toronto, for `now`.
export function torontoToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function minusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

// The latest observation on or before `date` for each currency.
export function pickRates(observations: Observation[], date: string) {
  const rates: Record<string, { rate: string; date: string }> = {};
  const sorted = observations
    .filter((o) => typeof o.d === "string" && o.d <= date)
    .sort((a, b) => String(b.d).localeCompare(String(a.d))); // newest first
  for (const code of FOREIGN_CURRENCIES) {
    for (const o of sorted) {
      const cell = o[`FX${code}CAD`];
      const value = typeof cell === "object" && cell ? cell.v : undefined;
      if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0) {
        rates[code] = { rate: value.trim(), date: String(o.d) };
        break;
      }
    }
  }
  return rates;
}

export async function fxRates(url: URL, fetcher: typeof fetch, now: Date): Promise<Response> {
  const asked = url.searchParams.get("date") ?? "";
  if (!isRealDate(asked)) return json(400, { error: "Use ?date=YYYY-MM-DD" }, 60);
  const today = torontoToday(now);
  const date = asked > today ? today : asked; // the future gets today's rates
  if (date < FIRST_DATE) return json(404, { error: `Bank of Canada daily rates start on ${FIRST_DATE}` }, SETTLED_SECONDS);

  const bank =
    "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json" +
    `?start_date=${minusDays(date, LOOK_BACK_DAYS)}&end_date=${date}`;
  let observations: Observation[];
  try {
    const res = await fetcher(bank, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Bank answered ${res.status}`);
    const body = (await res.json()) as { observations?: Observation[] };
    observations = Array.isArray(body.observations) ? body.observations : [];
  } catch {
    return json(502, { error: "The Bank of Canada can't be reached right now" }, 60);
  }

  const rates = pickRates(observations, date);
  // Settled once the date itself has a published rate and it's in the past; otherwise
  // a newer rate may still come out today.
  // A week back, no late rate can still appear for it either.
  const settled = date < today && (observations.some((o) => o.d === date) || date <= minusDays(today, 7));
  return json(200, { date, source: "Bank of Canada", rates }, settled ? SETTLED_SECONDS : RECENT_SECONDS);
}
