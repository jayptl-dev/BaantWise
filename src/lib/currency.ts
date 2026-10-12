// Foreign expenses: an amount paid in another currency, turned into Canadian dollars
// at the Bank of Canada's daily rate (or a rate the person types in). The CAD amount
// is what gets split, so balances and charts don't change. All maths here is exact
// (BigInt); amounts are hundredths of their currency, even for yen (¥1,500 = 150000).
import { MAX_CENTS } from "./money";
import { splitByWeights } from "./split";

// The currencies the Bank of Canada publishes a daily rate for.
export const FOREIGN_CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "AUD", "BRL", "CHF", "CNY", "HKD", "IDR", "JPY", "KRW",
  "MXN", "MYR", "NOK", "NZD", "PEN", "PLN", "SEK", "SGD", "THB", "TRY", "TWD", "ZAR",
] as const;
export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];

export function isForeignCurrency(code: unknown): code is ForeignCurrency {
  return FOREIGN_CURRENCIES.includes(code as ForeignCurrency);
}

export const MAX_FOREIGN_CENTS = 10_000_000_000_000; // same limit as the database
export const MAX_RATE_DECIMALS = 10;

// "Japanese Yen" (English names; falls back to the code).
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en-CA"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// How many decimals a currency is normally written with (0 for JPY, KRW, IDR).
export function currencyDecimals(code: string): number {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

// The short symbol shown next to amounts: "US$", "€", "£", "¥"…
export function currencySymbol(code: string): string {
  if (code === "CAD") return "CA$";
  try {
    const part = new Intl.NumberFormat("en-CA", { style: "currency", currency: code, currencyDisplay: "symbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

// 8450 (hundredths) of USD → "US$84.50"; 150000 of JPY → "¥1,500".
export function formatForeign(hundredths: number, code: string): string {
  const decimals = currencyDecimals(code);
  const whole = BigInt(hundredths) / 100n;
  const fraction = String(Math.abs(hundredths % 100)).padStart(2, "0");
  const text = decimals === 0 ? `${whole}` : `${whole}.${fraction}`;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals === 0 ? 0 : 2,
      maximumFractionDigits: decimals === 0 ? 0 : 2,
    }).format(text as `${number}`);
  } catch {
    return `${code} ${text}`;
  }
}

// A rate as exact digits: "1.3672" → { digits: 13672n, scale: 4 } (the rate is digits / 10^scale).
export type Rate = { digits: bigint; scale: number };

// Reads a rate typed or sent as text. Must be above 0, below 10000, up to 10 decimals.
export function readRate(text: string): Rate | null {
  const tidy = text.trim().replace(/,/g, ".");
  const match = /^(\d{1,4})(?:\.(\d{1,10}))?$/.exec(tidy);
  if (!match) return null;
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const digits = BigInt(match[1] + fraction);
  if (digits === 0n) return null;
  return { digits, scale: fraction.length };
}

// The rate as the database stores it and the app shows it: "1.3672", "0.00899".
export function rateText(rate: Rate): string {
  if (rate.scale === 0) return rate.digits.toString();
  const s = rate.digits.toString().padStart(rate.scale + 1, "0");
  return `${s.slice(0, -rate.scale)}.${s.slice(-rate.scale)}`;
}

// The rate the database sends back (a number, e.g. 1.3672 or 0.00899) as text, without
// float noise: at most 10 decimals, trailing zeros removed.
export function rateFromNumber(value: number | string): Rate | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return readRate(n.toFixed(MAX_RATE_DECIMALS).replace(/\.?0+$/, ""));
}

// CAD cents for a foreign amount: original x rate, rounded to the nearest cent, half up
// (the database checks the same thing). US$84.50 at 1.3672 → 11553; ¥1,500 at 0.008990 → 1349.
export function toCadCents(originalHundredths: number, rate: Rate): number {
  const ten = 10n ** BigInt(rate.scale);
  const exact2 = 2n * BigInt(originalHundredths) * rate.digits; // twice the exact amount, in /ten
  return Number((exact2 + ten) / (2n * ten));
}

// Whether a converted amount can be saved (1 cent to CA$1,000,000).
export function cadInRange(cents: number): boolean {
  return cents >= 1 && cents <= MAX_CENTS;
}

// Exact amounts typed in the foreign currency become CAD shares in proportion, with the
// shared leftover-cent rule: US$50.00 + US$34.50 of CA$115.53 → 6836 + 4717.
export function foreignToCadShares(
  cadTotal: number,
  foreignShares: readonly { id: string; hundredths: number }[],
  payerId?: string,
): Map<string, number> {
  return splitByWeights(cadTotal, foreignShares.map((s) => ({ id: s.id, weight: BigInt(s.hundredths) })), payerId);
}

// ---------------------------------------------------------------------------
// Bank of Canada rates, from our own site (the Worker route /api/fx-rates).
// ---------------------------------------------------------------------------

export type BankRate = { rate: string; date: string }; // rate: CAD for 1 unit; date: "2026-09-24"
export type BankRates = { date: string; source: string; rates: Partial<Record<ForeignCurrency, BankRate>> };

const fetched = new Map<string, Promise<BankRates | null>>();

// The rates for a date (the latest published on or before it). Remembered per date
// for this visit. Returns null if they couldn't be fetched.
export function bankRates(date: string): Promise<BankRates | null> {
  let rates = fetched.get(date);
  if (!rates) {
    rates = fetch(`/api/fx-rates?date=${encodeURIComponent(date)}`)
      .then((res) => (res.ok ? (res.json() as Promise<BankRates>) : null))
      .catch(() => null);
    rates.then((r) => {
      if (!r) fetched.delete(date); // try again next time
    });
    fetched.set(date, rates);
  }
  return rates;
}

// For lists: "US$84.50" when an expense was paid in another currency, else null.
export function foreignAmount(expense: {
  original_currency: string | null;
  original_amount_cents: number | null;
}): string | null {
  if (!expense.original_currency || expense.original_amount_cents === null) return null;
  return formatForeign(expense.original_amount_cents, expense.original_currency);
}

// For the details screen: "US$84.50 at 1.3672 (Bank of Canada, Sep 24)" or "… (own rate)".
export function foreignDetails(
  expense: { original_currency: string | null; original_amount_cents: number | null; fx_rate: number | null; fx_rate_date: string | null },
  formatDay: (iso: string) => string,
): string | null {
  const amount = foreignAmount(expense);
  const rate = expense.fx_rate === null ? null : rateFromNumber(expense.fx_rate);
  if (!amount || !rate) return null;
  const source = expense.fx_rate_date ? `Bank of Canada, ${formatDay(expense.fx_rate_date)}` : "own rate";
  return `${amount} at ${rateText(rate)} (${source})`;
}
