// "Delete my account" (Profile): asks the delete-account Edge Function to delete the
// signed-in person's account, then signs out on this device.
// See supabase/functions/delete-account and the migration …_delete_account.sql.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const DELETE_FAILED = "Your account couldn't be deleted right now. Try again in a few minutes.";

// The word people type to confirm, so nobody deletes their account by accident.
export const DELETE_WORD = "DELETE";

export function confirmsDeletion(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_WORD;
}

export async function deleteMyAccount() {
  try {
    const { error } = await supabase.functions.invoke("delete-account", { method: "POST", body: { confirm: DELETE_WORD } });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (body && typeof body.message === "string") return { ok: false as const, message: body.message as string };
      }
      return { ok: false as const, message: DELETE_FAILED };
    }
    // The sign-in no longer exists on the server: just forget it on this device.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: DELETE_FAILED };
  }
}
