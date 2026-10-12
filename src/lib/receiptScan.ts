// Receipt scanning: the photo goes to our scan-receipt Edge Function, which asks
// Google Gemini to read it and sends back the details. Nothing is stored: not the
// photo (until the person saves the expense and it becomes the receipt photo), not
// the items. See supabase/functions/scan-receipt/index.ts.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { isCategoryKey, type CategoryKey } from "./categories";
import { supabase } from "./supabase";

const FUNCTION = "scan-receipt";
const SCAN_TIMEOUT_MS = 70_000;

export const SCAN_FAILED =
  "Receipt scanning isn't working right now. Try again in a few minutes, or type it in.";

export type ScannedItem = { name: string; quantity: number; amountCents: number };

export type ScannedReceipt = {
  merchant: string | null;
  date: string | null; // "2026-09-25"
  currency: string | null; // "CAD", "USD", ...
  totalCents: number | null;
  items: ScannedItem[];
  category: CategoryKey;
  hasWarnings: boolean; // some numbers on the receipt didn't add up
  scansLeft: number | null;
};

// Whether this person may scan yet. Asked once per visit (it uses no scan).
let availability: Promise<boolean> | null = null;

export function scanningAvailable(): Promise<boolean> {
  availability ??= supabase.functions
    .invoke<{ available?: boolean }>(FUNCTION, { method: "GET" })
    .then(({ data, error }) => !error && data?.available === true)
    .catch(() => false)
    .then((open) => {
      if (!open) availability = null; // ask again next time the screen opens
      return open;
    });
  return availability;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// The function already checks every value; this only makes sure of the shapes.
export function readScan(raw: unknown): ScannedReceipt {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    merchant: text(r.merchant),
    date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    currency: typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
    totalCents: number(r.total_cents),
    items: items.flatMap((item) => {
      const i = (item ?? {}) as Record<string, unknown>;
      const name = text(i.name);
      const amountCents = number(i.amount_cents);
      if (!name || amountCents === null) return [];
      return [{ name, quantity: typeof i.quantity === "number" ? i.quantity : 1, amountCents }];
    }),
    category: isCategoryKey(r.category) ? r.category : "other",
    hasWarnings: Array.isArray(r.warnings) && r.warnings.length > 0,
    scansLeft: number(r.scans_left),
  };
}

// Sends one (already shrunk) photo. Returns the details, or the message to show.
export async function scanReceipt(photo: Blob): Promise<{ receipt: ScannedReceipt } | { problem: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION, {
      method: "POST",
      body: photo,
      headers: { "Content-Type": "image/jpeg" },
      timeout: SCAN_TIMEOUT_MS,
    });
    if (error) {
      // The function says why in plain words ({ error, message }).
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (body && typeof body.message === "string") return { problem: body.message };
      }
      return { problem: SCAN_FAILED };
    }
    return { receipt: readScan(data) };
  } catch {
    return { problem: SCAN_FAILED };
  }
}
