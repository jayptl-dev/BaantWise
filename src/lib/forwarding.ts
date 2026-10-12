// Email forwarding: each group has a bill address, bills+<token>@mail.baantwise.com.
// A member forwards a bill email to it and Baantwise keeps the biller, amount and date as
// a "bill to review" for them; they add it as an expense (or dismiss it) here.
// See supabase/migrations/…_email_forwarding.sql and supabase/functions/receive-bill-email.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { categoryFor, type CategoryKey } from "./categories";
import { formatForeign, isForeignCurrency } from "./currency";
import type { Expense } from "./expenses";
import { isUuid } from "./format";
import { formatCents } from "./money";
import { supabase } from "./supabase";

export const BILL_DOMAIN = "mail.baantwise.com";

export function forwardAddress(token: string): string {
  return `bills+${token}@${BILL_DOMAIN}`;
}

// "Save to contacts": the Worker serves the group's bill address as a contact card
// (src/worker/contactCard.ts). Phones show it with "Create new contact" to check and save.
export function contactCardLink(token: string, groupName: string, groupId: string): string {
  const params = new URLSearchParams({ token, group: groupName, id: groupId });
  return `/api/contact-card?${params.toString()}`;
}

// What to tell people after they tap "Save to contacts", for their kind of phone.
// iPhone: the contact opens as a preview whose ✓ only closes it; saving is the
// "Create New Contact" button at the bottom. Android: it downloads a contact file.
export function contactSaveHint(userAgent: string, touchPoints = 0): string {
  const iPhone = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (iPhone) return 'On iPhone: scroll down and tap "Create New Contact". The ✓ at the top only closes the preview.';
  if (/Android/.test(userAgent)) return "On Android: open the contact file that downloads, then tap Save or Import.";
  return 'On a phone: iPhone shows a preview, so scroll down and tap "Create New Contact" (the ✓ only closes it). Android downloads a contact file to open.';
}

export type ForwardedBill = {
  id: string;
  biller: string | null;
  amountCents: number | null; // in `currency`
  currency: string;
  billDate: string | null;
  category: CategoryKey;
  receivedAt: string;
};

type BillRow = {
  id: string;
  biller: string | null;
  amount_cents: number | null;
  currency: string;
  bill_date: string | null;
  category: string;
  created_at: string;
};

function toBill(row: BillRow): ForwardedBill {
  return {
    id: row.id,
    biller: row.biller,
    amountCents: row.amount_cents,
    currency: row.currency,
    billDate: row.bill_date,
    category: categoryFor(row.category).key,
    receivedAt: row.created_at,
  };
}

// "$84.75", "US$12.00" or "Amount not found".
export function billAmount(bill: ForwardedBill): string {
  if (bill.amountCents === null) return "Amount not found";
  return isForeignCurrency(bill.currency) ? formatForeign(bill.amountCents, bill.currency) : formatCents(bill.amountCents);
}

const BILL_COLUMNS = "id, biller, amount_cents, currency, bill_date, category, created_at";

// The group's bill address, and my bills to review there (only mine: Row Level Security).
export async function fetchForwarding(groupId: string) {
  if (!isUuid(groupId)) return { error: null, token: null, bills: [] as ForwardedBill[] };
  const [group, bills] = await Promise.all([
    supabase.from("groups").select("forward_token").eq("id", groupId).maybeSingle(),
    supabase
      .from("forwarded_bills")
      .select(BILL_COLUMNS)
      .eq("group_id", groupId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  const error = group.error ?? bills.error;
  if (error) return { error, token: null, bills: [] as ForwardedBill[] };
  return { error: null, token: group.data?.forward_token ?? null, bills: (bills.data ?? []).map(toBill) };
}

export async function fetchForwardedBill(groupId: string, billId: string) {
  if (!isUuid(groupId) || !isUuid(billId)) return { error: null, bill: null };
  const { data, error } = await supabase
    .from("forwarded_bills")
    .select(BILL_COLUMNS)
    .eq("group_id", groupId)
    .eq("id", billId)
    .eq("status", "pending")
    .maybeSingle();
  return { error, bill: data ? toBill(data) : null };
}

// How many bills I have to review in a group (for the notice on the group page).
export async function countForwardedBills(groupId: string) {
  const { count, error } = await supabase
    .from("forwarded_bills")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("status", "pending");
  return error ? 0 : (count ?? 0);
}

// An expense in the group that might already be this bill: the same CA$ amount within a
// week of the bill's date (the newest such expense). Only a hint; the person decides.
export function possibleDuplicate(bill: ForwardedBill, expenses: Expense[]): Expense | null {
  if (bill.amountCents === null) return null;
  const day = bill.billDate ?? bill.receivedAt.slice(0, 10);
  const at = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  const sameAmount = (e: Expense) =>
    bill.currency === "CAD"
      ? e.amount_cents === bill.amountCents
      : e.original_currency === bill.currency && e.original_amount_cents === bill.amountCents;
  return (
    expenses.find(
      (e) => sameAmount(e) && Math.abs(Date.parse(`${e.spent_on}T00:00:00Z`) - at) <= 7 * 86400000,
    ) ?? null
  );
}

export const SETUP_FAILED = "The email couldn't be sent right now. Try again in a few minutes.";

// Emails me the setup steps, from the group's bill address.
export async function sendSetupEmail(groupId: string) {
  try {
    const { error } = await supabase.functions.invoke("forwarding-setup", { method: "POST", body: { group_id: groupId } });
    if (!error) return { ok: true as const };
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body && typeof body.message === "string") return { ok: false as const, message: body.message as string };
    }
    return { ok: false as const, message: SETUP_FAILED };
  } catch {
    return { ok: false as const, message: SETUP_FAILED };
  }
}
