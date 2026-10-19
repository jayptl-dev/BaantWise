// Baantwise scan-receipt: checks and cleans what Gemini read from a receipt.
// No imports on purpose, so the app's tests (src/lib/scanCleanup.test.ts) can test it
// directly. Deployed together with index.ts.

export const CATEGORY_KEYS: string[] = [
  'food', 'groceries', 'transport', 'housing', 'utilities',
  'entertainment', 'travel', 'shopping', 'health', 'other',
];
export const MAX_ITEMS = 60;
export const MAX_CENTS = 100000000; // same upper limit as expenses.amount_cents
const TOLERANCE_CENTS = 2; // receipts round cash totals to 5 cents
// The highest sales tax in Canada is 15% (HST in the Atlantic provinces; Quebec's GST + QST
// is 14.975%). Tax above this share of the taxed items means the tax marks were misread.
const MAX_TAX_RATE = 0.16;

// name: a plain name people recognise ("Milk 2%, 4 L"). printed: the line as it is on
// the receipt ("PC MLK 2% 4L"), or null when it reads the same as name.
// taxed: true/false when the receipt marks taxed items one by one (H, A, GP...), so the
// app can share the tax only over the taxed items; null when it doesn't (most
// restaurant bills, where everything is taxed).
export type ScanItem = { name: string; printed: string | null; quantity: number; amount_cents: number; taxed: boolean | null };
export type ScanResult = {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  total_cents: number | null;
  items: ScanItem[];
  category: string;
  warnings: string[];
  // How much the items add up to more (+) or less (-) than the receipt says, when they
  // don't match. null when they match or there is nothing to compare with.
  items_gap_cents: number | null;
  // Minus lines (voids, an item's own discount): taken off an item, or left out because
  // no item fitted. Counts only; used for the logs.
  minus_lines: { applied: number; unplaced: number };
};

// Words that only appear on summary lines (totals, taxes, tips, payments, fees).
// A line made only of these words (plus numbers and symbols) is not something bought.
// Fees and discounts dropped here are still inside the total, so they end up shared
// in proportion, like tax.
const SUMMARY_WORDS = new Set([
  'sub', 'subtotal', 'total', 'totals', 'grand', 'amount', 'due', 'balance', 'owing',
  'tax', 'taxes', 'sales', 'hst', 'gst', 'pst', 'qst', 'tps', 'tvq', 'vat',
  'tip', 'tips', 'gratuity', 'service', 'charge', 'delivery', 'fee', 'fees',
  'change', 'cash', 'visa', 'mastercard', 'master', 'card', 'amex', 'debit', 'credit',
  'interac', 'payment', 'paid', 'tender', 'tendered', 'rounding', 'discount', 'discounts',
  'coupon', 'coupons', 'savings', 'you', 'your', 'saved', 'sous', 'pourboire', 'monnaie', 'comptant',
  'rabais', 'frais', 'de', 'livraison', 'remise', 'economies', 'économies',
  // loyalty points and payment lines
  'points', 'point', 'pts', 'earned', 'bonus', 'redeemed', 'redemption', 'scene', 'optimum', 'pc',
  'rewards', 'moi', 'mcard', 'tend', 'approved', 'auth', 'regular', 'price', 'reg', 'was',
  // tips that are tips, not items: an automatic gratuity, suggested amounts
  'auto', 'grat', 'suggested', 'guide', 'guidelines',
  // the letters of T.P.S., T.V.Q. and DISCOUNT(S), read one by one
  't', 'p', 's', 'v', 'q',
]);

// A minus line that is a real discount on the item above (YOUR DISCOUNT, Rabais, COUPON),
// as opposed to an information line (YOU SAVED, YOUR SAVINGS, TOTAL DISCOUNT(S)).
const REAL_DISCOUNT_WORDS = new Set(['discount', 'discounts', 'coupon', 'coupons', 'rabais', 'your', 'de', 's']);
const REAL_DISCOUNT_CORE = new Set(['discount', 'discounts', 'coupon', 'coupons', 'rabais']);

export function isRealDiscountLine(name: string): boolean {
  const words = name.toLowerCase().match(/\p{L}+/gu);
  return !!words && words.some((word) => REAL_DISCOUNT_CORE.has(word)) && words.every((word) => REAL_DISCOUNT_WORDS.has(word));
}

// Words of a deposit or environmental fee line (with province codes, as in "NS DEPOSIT").
// Such a line belongs to the item above it.
const ITEM_FEE_WORDS = new Set([
  'deposit', 'deposits', 'dep', 'consigne', 'consignes', 'eco', 'fee', 'fees', 'ehc', 'ehf', 'crf',
  'enviro', 'environmental', 'environment', 'recycling', 'handling', 'charge', 'container', 'levy',
  'frais', 'ecofrais', 'ns', 'nb', 'nl', 'pe', 'pei', 'on', 'bc', 'ab', 'sk', 'mb', 'qc',
]);
const ITEM_FEE_CORE = /deposit|consigne|\beco\b|ecofrais|\behc\b|\behf\b|\bcrf\b|enviro|recycling/i;

export function isItemFeeLine(name: string): boolean {
  const words = name.toLowerCase().match(/\p{L}+/gu);
  return !!words && ITEM_FEE_CORE.test(name) && words.every((word) => ITEM_FEE_WORDS.has(word));
}

export function isSummaryLine(name: string): boolean {
  const words = name.toLowerCase().match(/\p{L}+/gu);
  return !!words && words.every((word) => SUMMARY_WORDS.has(word));
}

// Receipt text is untrusted data: keep plain printable text on one line, limit its length.
// Characters that never belong in a name: control codes, invisible spacing and
// direction marks, and < > (so text can never look like HTML).
function isUnsafeChar(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff ||
    code === 0x3c || code === 0x3e;
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const oneLine = Array.from(value.normalize('NFKC'), (ch) => (isUnsafeChar(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const text = Array.from(oneLine).slice(0, maxLength).join('').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : null;
}

// Money must already be whole cents (the schema asks for integers): 1299 or "1299".
export function toCents(value: unknown, min: number): number | null {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && /^\s*-?\d+(\.0+)?\s*$/.test(value) ? Number(value)
    : NaN;
  if (!Number.isInteger(n)) return null;
  return n >= min && n <= MAX_CENTS ? n : null;
}

export function toQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value)
    : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 9999) return 1;
  return Math.round(n * 1000) / 1000;
}

// For matching a void to the item it cancels: lower case, no "void" word, letters and
// digits only.
function matchKey(text: string | null): string {
  return (text ?? '').toLowerCase().replace(/\bvoid(ed)?\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// A minus line that Gemini didn't fold into its item (a void, or one item's own discount,
// like Costco's "/1359722 2.00-" under the KFI sauce). Changes the items already read:
//   1. A void: an earlier item with the same name and the same price is removed.
//   2. Otherwise it belongs to the item right above it: taken off that item's price, or
//      the item is removed when the minus line cancels it exactly.
// Returns false when no item fits (it would leave an item at $0 or less). That amount is
// still inside the receipt total, so it ends up shared in proportion, like tax.
export function applyMinusLine(items: ScanItem[], cents: number, name: string, printed: string | null): boolean {
  const wanted = [matchKey(name), matchKey(printed)].filter((key) => key !== '');
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.amount_cents === cents && (wanted.includes(matchKey(item.name)) || wanted.includes(matchKey(item.printed)))) {
      items.splice(i, 1);
      return true;
    }
  }
  const last = items[items.length - 1];
  if (!last) return false;
  if (last.amount_cents === cents) {
    items.pop();
    return true;
  }
  if (last.amount_cents - cents >= 1) {
    last.amount_cents -= cents;
    return true;
  }
  return false;
}

// Makes the items' tax marks all-or-nothing and believable, in place:
// - no tax, or no item marked taxed: every item gets null (tax is shared over everything);
// - some items marked taxed: the unmarked ones are not taxed (false);
// - the tax is more than 16% of the taxed items: the marks were misread, so every item
//   gets null and this returns false (the app shares tax over everything, as before).
export function settleTaxMarks(items: ScanItem[], taxCents: number | null): boolean {
  const taxedSum = items.reduce((sum, item) => sum + (item.taxed === true ? item.amount_cents : 0), 0);
  if (!taxCents || taxedSum <= 0) {
    for (const item of items) item.taxed = null;
    return true;
  }
  if (taxCents > taxedSum * MAX_TAX_RATE + TOLERANCE_CENTS) {
    for (const item of items) item.taxed = null;
    return false;
  }
  for (const item of items) item.taxed = item.taxed === true;
  return true;
}

// Folds each deposit or eco fee into the item above it, so the fee goes to the people on
// that item, but only when both are taxed the same way: an untaxed deposit under taxed
// pop stays its own (untaxed) line right after it, or the tax would be shared wrongly.
// Runs after settleTaxMarks, so "unmarked" has already become untaxed (false) on a
// receipt with tax marks. A fee left on its own keeps a plain line in the list.
export function foldFeeLines(items: ScanItem[], feeLines: ReadonlySet<ScanItem>): void {
  for (let i = items.length - 1; i >= 1; i--) {
    const fee = items[i];
    if (!feeLines.has(fee)) continue;
    let owner = i - 1;
    while (owner > 0 && feeLines.has(items[owner]) && items[owner].taxed !== fee.taxed) owner--;
    if (items[owner].taxed !== fee.taxed) continue;
    items[owner].amount_cents += fee.amount_cents;
    items.splice(i, 1);
  }
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
}

// A real calendar date, from 2000-01-01 up to one day after "today" (YYYY-MM-DD, UTC),
// because the phone's date can be a day ahead of the server's.
export function cleanDate(value: unknown, today: string): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  if (y < 2000) return null;
  const time = Date.UTC(y, m - 1, d);
  const check = new Date(time);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  const latest = Date.parse(today + 'T00:00:00Z') + 86400000;
  return time <= latest ? text : null;
}

export function cleanCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// Turns Gemini's JSON into safe, checked values. Returns null when there is nothing
// useful (not a receipt, or neither a total nor any items could be read).
export function cleanReceipt(raw: unknown, today: string): ScanResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.is_receipt === false) return null;

  const items: ScanItem[] = [];
  const feeLines = new Set<ScanItem>(); // deposits and eco fees, folded in after the tax marks
  const minusLines = { applied: 0, unplaced: 0 };
  const rawItems = Array.isArray(r.items) ? r.items : [];
  for (const entry of rawItems.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const printedText = cleanText(e.printed, 60);
    const name = cleanText(e.name, 60) ?? printedText;
    const amount = toCents(e.amount_cents, -MAX_CENTS);
    if (!name || amount === null || amount === 0) continue; // $0 lines are not something bought
    // A deposit or eco fee the reader listed on its own belongs to the item above: kept
    // for now and folded into it after the tax marks are settled (see below).
    const feeLine = amount > 0 && items.length > 0 &&
      (isItemFeeLine(name) || (printedText !== null && isItemFeeLine(printedText)));
    const realDiscount = amount < 0 && (isRealDiscountLine(name) || (printedText !== null && isRealDiscountLine(printedText)));
    if (!realDiscount && (isSummaryLine(name) || (printedText && isSummaryLine(printedText)))) continue;
    const printed = printedText && printedText.toLowerCase() !== name.toLowerCase() ? printedText : null;
    if (amount < 0) {
      if (applyMinusLine(items, -amount, name, printed)) minusLines.applied += 1;
      else minusLines.unplaced += 1;
      continue;
    }
    if (items.length >= MAX_ITEMS && !feeLine) continue; // keep reading: a later minus line may still apply
    const item: ScanItem = {
      name, printed, quantity: toQuantity(e.quantity), amount_cents: amount,
      taxed: typeof e.taxed === 'boolean' ? e.taxed : null,
    };
    items.push(item);
    if (feeLine) feeLines.add(item);
  }

  const subtotal = toCents(r.subtotal_cents, 0);
  const tax = toCents(r.tax_cents, 0);
  const tip = toCents(r.tip_cents, 0);
  let total = toCents(r.total_cents, 1);
  const itemsSum = items.reduce((sum, item) => sum + item.amount_cents, 0);
  const extras = (tax ?? 0) + (tip ?? 0);
  const warnings: string[] = [];
  let itemsGap: number | null = null;

  if (total === null) {
    const base = subtotal ?? (items.length > 0 ? itemsSum : null);
    if (base !== null && base + extras >= 1 && base + extras <= MAX_CENTS) {
      total = base + extras;
      warnings.push('total_guessed');
    }
  }
  if (total === null && items.length === 0) return null;

  if (total !== null && subtotal !== null && Math.abs(subtotal + extras - total) > TOLERANCE_CENTS) {
    warnings.push('totals_dont_match');
  }
  const expectedItems = subtotal ?? (total !== null ? total - extras : null);
  if (items.length > 0 && expectedItems !== null && Math.abs(itemsSum - expectedItems) > TOLERANCE_CENTS) {
    warnings.push('items_dont_match');
    itemsGap = itemsSum - expectedItems;
  }

  if (!settleTaxMarks(items, tax)) warnings.push('tax_marks_unsure');
  foldFeeLines(items, feeLines);

  const category = typeof r.category === 'string' ? r.category.trim().toLowerCase() : '';
  return {
    merchant: cleanText(r.merchant, 60),
    date: cleanDate(r.date, today),
    currency: cleanCurrency(r.currency),
    subtotal_cents: subtotal,
    tax_cents: tax,
    tip_cents: tip,
    total_cents: total,
    items,
    category: CATEGORY_KEYS.includes(category) ? category : 'other',
    warnings,
    items_gap_cents: itemsGap,
    minus_lines: minusLines,
  };
}
