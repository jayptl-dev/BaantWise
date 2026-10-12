// Plain helpers for receive-bill-email: no imports, so the app's tests can check them
// (src/lib/billEmail.test.ts). Nothing here keeps or logs any email text.

export const BILL_DOMAIN = 'mail.baantwise.com';
export const BILL_USER = 'bills';
export const MAX_CENTS = 100000000; // same upper limit as expenses.amount_cents
export const CATEGORY_KEYS = [
  'food', 'groceries', 'transport', 'housing', 'utilities',
  'entertainment', 'travel', 'shopping', 'health', 'other',
];

const TOKEN = /^[a-z0-9-]{3,40}$/;
const EMAIL = /^[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[^@\s<>"(),;:]+$/;

// "bills+crews-crescent-3f9a1c07d2@mail.baantwise.com" -> "crews-crescent-3f9a1c07d2".
export function tokenFromAddress(address: string): string | null {
  const m = address.trim().toLowerCase().match(/^([^@+]+)\+([^@]+)@(.+)$/);
  if (!m || m[1] !== BILL_USER || m[3] !== BILL_DOMAIN || !TOKEN.test(m[2])) return null;
  return m[2];
}

export function billAddress(token: string): string {
  return `${BILL_USER}+${token}@${BILL_DOMAIN}`;
}

// Every address written in a header like `"Jay" <jay@gmail.com>, sam@x.com`.
export function addressesIn(header: string | null | undefined): string[] {
  if (!header) return [];
  const found = header.match(/[^\s<>"(),;:]+@[^\s<>"(),;:]+/g) ?? [];
  return found.map((a) => a.toLowerCase()).filter((a) => EMAIL.test(a));
}

// Forwarding services rewrite the envelope sender (SRS): "SRS0=hash=tt=gmail.com=jay@fwd.example"
// is jay@gmail.com. Gmail's own "jay+caf_=...@gmail.com" is undone by the database
// (it ignores +tags), so it needs nothing here.
export function undoSrs(address: string): string {
  const a = address.trim().toLowerCase();
  const m = a.match(/^srs[01][=+-].*?=([^=@]+)=([^=@]+)@[^@]+$/);
  return m && EMAIL.test(`${m[2]}@${m[1]}`) ? `${m[2]}@${m[1]}` : a;
}

// Who might have forwarded this, best guess first: the envelope sender (what Gmail and
// Outlook rules use), then the forwarding headers, then From (a forward by hand).
export function senderCandidates(p: {
  envelopeFrom: string | null;
  xForwardedFor: string | null;
  resentFrom: string | null;
  from: string | null;
}): string[] {
  const list = [
    ...(p.envelopeFrom ? [undoSrs(p.envelopeFrom)] : []),
    ...addressesIn(p.xForwardedFor).slice(0, 1),
    ...addressesIn(p.resentFrom),
    ...addressesIn(p.from),
  ].filter((a) => EMAIL.test(a));
  return [...new Set(list)].slice(0, 6);
}

// Gmail asks the new forwarding address to confirm before a Gmail rule can forward to it.
export function isGmailConfirmation(from: string | null, subject: string | null): boolean {
  return addressesIn(from).includes('forwarding-noreply@google.com') && /forwarding confirmation/i.test(subject ?? '');
}

// Only the code and Google's own confirmation link are taken from it, so even a fake
// "confirmation" can't make Baantwise email anyone a strange link.
export function readGmailConfirmation(subject: string, text: string): { requester: string | null; code: string | null; link: string | null } {
  const code = subject.match(/#(\d{6,12})/)?.[1] ?? text.match(/confirmation code:\s*(\d{6,12})/i)?.[1] ?? null;
  const fromSubject = addressesIn(subject.split(/receive mail from/i)[1] ?? '')[0] ?? null;
  const fromText = addressesIn(text.match(/\(([^)]+@[^)]+)\) has requested/i)?.[1] ?? '')[0] ?? null;
  const rawLink = text.match(/https:\/\/(mail-settings\.google\.com|mail\.google\.com)\/mail\/[^\s<>"')\]]+/)?.[0] ?? null;
  const link = rawLink && rawLink.length <= 600 ? rawLink : null;
  return { requester: fromSubject ?? fromText, code, link };
}

// Emails Baantwise itself sent (notices, setup emails) must never be read as bills or
// answered: a mail rule that forwards everything would bounce them back and forth.
export function isFromBaantwise(p: { from: string | null; headers: Array<{ key: string; value: string }> }): boolean {
  if (p.headers.some((h) => h.key.toLowerCase() === 'x-baantwise')) return true;
  return addressesIn(p.from).some((a) => a.endsWith(`@${BILL_DOMAIN}`) || a.endsWith('@baantwise.com'));
}

// Forwarded by a rule (Gmail/Outlook auto-forward) or sent by a robot, rather than by a
// person pressing Forward. Those never get a "we didn't find a bill" email back.
export function isAutomatic(p: { envelopeFrom: string | null; headers: Array<{ key: string; value: string }> }): boolean {
  const get = (name: string) => p.headers.find((h) => h.key.toLowerCase() === name)?.value?.trim().toLowerCase() ?? null;
  if (/\+caf_=/i.test(p.envelopeFrom ?? '')) return true; // Gmail's automatic forwarding
  if (/^srs[01][=+-]/i.test(p.envelopeFrom ?? '')) return true; // rewritten by a forwarding service
  if (get('x-forwarded-for') || get('x-forwarded-to')) return true;
  const auto = get('auto-submitted');
  if (auto && auto !== 'no') return true;
  if (get('list-id') || get('list-unsubscribe') || /bulk|list|junk/.test(get('precedence') ?? '')) return true;
  return false;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Bill emails are mostly HTML: keep only the words, one line per block.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (all, name: string) => {
      const n = name.toLowerCase();
      if (n in ENTITIES) return ENTITIES[n];
      const code = n.startsWith('#x') ? parseInt(n.slice(2), 16) : n.startsWith('#') ? parseInt(n.slice(1), 10) : NaN;
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : all;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

function isUnsafeChar(code: number): boolean {
  return code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const chars = Array.from(value).filter((c) => !isUnsafeChar(c.codePointAt(0) ?? 0)).join('');
  const text = Array.from(chars.replace(/\s+/g, ' ').trim()).slice(0, maxLength).join('').trim();
  return text || null;
}

// A date as YYYY-MM-DD, not in the future and not more than a year old.
export function cleanDate(value: unknown, today: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const t = new Date(`${today}T00:00:00Z`).getTime();
  if (d.getTime() > t + 86400000 || d.getTime() < t - 366 * 86400000) return null;
  return value;
}

export function cleanCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null;
}

export function cleanCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CENTS) return null;
  return value;
}

export type Bill = {
  isBill: boolean;
  biller: string | null;
  amountCents: number | null;
  currency: string;
  billDate: string | null;
  category: string;
};

// What Gemini sent back, checked again here: anything odd becomes "not read".
export function cleanBill(raw: unknown, today: string): Bill | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const amountCents = cleanCents(r.amount_cents);
  return {
    isBill: r.is_bill === true,
    biller: cleanText(r.biller, 80),
    amountCents,
    currency: cleanCurrency(r.currency) ?? 'CAD',
    billDate: cleanDate(r.bill_date, today),
    category: typeof r.category === 'string' && CATEGORY_KEYS.includes(r.category) ? r.category : 'other',
  };
}

// "Jay Patel <jay@gmail.com>" -> "Jay Patel"; "billing@enbridge.com" -> "Enbridge".
export function nameFromSender(header: string | null): string | null {
  if (!header) return null;
  const name = cleanText(header.replace(/<[^>]*>/g, '').replace(/["']/g, ''), 80);
  if (name && !name.includes('@')) return name;
  const domain = addressesIn(header)[0]?.split('@')[1] ?? '';
  const parts = domain.split('.').filter((p) => !['mail', 'email', 'e', 'em', 'billing', 'news', 'info', 'notify', 'notifications', 'www'].includes(p));
  const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return main ? main.charAt(0).toUpperCase() + main.slice(1) : null;
}

// In a bill forwarded by hand, the bill's own sender is written in the text:
// "---------- Forwarded message ---------\nFrom: Enbridge Gas <noreply@enbridge.com>".
export function originalSenderIn(text: string): string | null {
  const block = text.split(/-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,}/i)[1];
  const line = block?.match(/^\s*From:\s*(.+)$/im)?.[1] ?? null;
  return line ? line.slice(0, 200) : null;
}

const AMOUNT_WORDS = /(amount due|total due|balance due|total amount due|amount payable|current outstanding balance|outstanding balance|current balance|balance owing|new balance|total balance|payment due|amount owing|please pay|total charges|total|amount)\b[^$\d]{0,40}(?:CA?\$|C\$|\$|CAD\s*)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2}))/i;

function toCentsText(text: string): number | null {
  const cents = Math.round(Number(text.replace(/,/g, '')) * 100);
  return cleanCents(cents);
}

// Without Gemini: a simple reading that finds "Amount due: $123.45" and the like, also when
// the label and the amount are on separate lines (table cells in a plain-text email).
export function readBillByRules(p: { text: string; subject: string; sender: string | null; sentOn: string | null; today: string }): Bill {
  const haystack = `${p.subject}\n${p.text}`;
  const m = haystack.match(AMOUNT_WORDS);
  const amountCents = m ? toCentsText(m[2]) : null;
  return {
    isBill: amountCents !== null,
    biller: nameFromSender(p.sender),
    amountCents,
    currency: 'CAD',
    billDate: cleanDate(p.sentOn, p.today),
    category: 'other',
  };
}

// The date an email was sent, as YYYY-MM-DD in Toronto (most users are in Canada).
export function torontoDay(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Constant-time string compare for the shared secret.
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
