import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Receipt photos live in the private Storage bucket "receipts", one folder per
// expense: "<expense id>/<random id>.jpg". The expense's receipt_path says which
// file is its photo. The database decides who can see or change them: a photo
// follows its expense's own privacy rule, and only whoever added the expense can
// add, replace or remove it (see supabase/migrations/…_receipt_photos.sql).

const BUCKET = "receipts";
const SIGNED_URL_SECONDS = 600; // a viewing link lasts 10 minutes

export const RECEIPT_SAVE_FAILED =
  "Your expense was saved, but the receipt photo didn't upload. You can try adding it again from the expense.";
export const RECEIPT_DAILY_LIMIT = "You can add up to 50 receipt photos a day.";
export const RECEIPT_REMOVE_FAILED =
  "Your expense was saved, but the receipt photo couldn't be removed. You can try again from the expense.";

type StorageError = { message?: string; status?: number; statusCode?: string };

// Storage said no (403): here that means the 50-a-day limit, since the screens
// only offer photos on expenses you added.
function isRefused(error: StorageError): boolean {
  return error.status === 403 || error.statusCode === "403" || /row-level security/i.test(error.message ?? "");
}

// Uploads a new photo for an expense and makes it the expense's photo, then
// removes any older ones in its folder. Returns null if it worked, or the
// message to show if it didn't (the expense itself is already saved).
export async function attachReceipt(expenseId: string, photo: Blob): Promise<string | null> {
  const path = `${expenseId}/${crypto.randomUUID()}.jpg`;
  const upload = await supabase.storage.from(BUCKET).upload(path, photo, { contentType: "image/jpeg" });
  if (upload.error) {
    return isRefused(upload.error) ? `${RECEIPT_SAVE_FAILED} ${RECEIPT_DAILY_LIMIT}` : RECEIPT_SAVE_FAILED;
  }
  const link = await supabase.rpc("set_expense_receipt", { p_expense_id: expenseId, p_path: path });
  if (link.error) {
    // Tidy up the new file; the expense keeps the photo it had.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return RECEIPT_SAVE_FAILED;
  }
  await clearReceiptFolder(expenseId, path);
  return null;
}

// Takes the photo off an expense and removes its files. Returns null if it
// worked, or the message to show.
export async function detachReceipt(expenseId: string): Promise<string | null> {
  // The generated types say p_path is text, but the function takes null to mean "no photo".
  const unlink = await supabase.rpc("set_expense_receipt", {
    p_expense_id: expenseId,
    p_path: null as unknown as string,
  });
  if (unlink.error) return RECEIPT_REMOVE_FAILED;
  await clearReceiptFolder(expenseId);
  return null;
}

// Removes every file in an expense's folder except `keep`. Also works after the
// expense is deleted. Quietly does nothing if it fails: the files stay private
// to whoever added the expense.
export async function clearReceiptFolder(expenseId: string, keep?: string): Promise<void> {
  try {
    const bucket = supabase.storage.from(BUCKET);
    const { data, error } = await bucket.list(expenseId, { limit: 100 });
    if (error || !data) return;
    const paths = data.map((file) => `${expenseId}/${file.name}`).filter((path) => path !== keep);
    if (paths.length > 0) await bucket.remove(paths);
  } catch {
    // Nothing to show: this is only tidying up.
  }
}

export type ReceiptLink = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

// A short-lived link for viewing an expense's photo, fetched when the screen
// opens and again whenever the photo changes. It's only kept on screen, never
// saved. `refresh` gets a new one (for example after it expired).
export function useReceiptLink(path: string | null) {
  const [link, setLink] = useState<{ path: string; link: ReceiptLink } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data, error }) => {
        if (!active) return;
        setLink({ path, link: error || !data ? { status: "error" } : { status: "ready", url: data.signedUrl } });
      });
    return () => {
      active = false;
    };
  }, [path, attempt]);

  const current: ReceiptLink | null = !path
    ? null
    : link?.path === path
      ? link.link
      : { status: "loading" };
  return { link: current, refresh: () => setAttempt((n) => n + 1) };
}
