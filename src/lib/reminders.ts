// Payment reminders: asks the send-reminder Edge Function to email someone who owes
// me, with a copy to me. The function works out the amount itself from what I can see,
// and allows one reminder per person per group every 3 days.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const REMINDER_FAILED = "The reminder couldn't be sent right now. Try again in a few minutes.";

export async function sendReminder(groupId: string, memberId: string, scope: "group" | "private") {
  try {
    const { error } = await supabase.functions.invoke("send-reminder", {
      method: "POST",
      body: { group_id: groupId, member_id: memberId, scope },
    });
    if (!error) return { ok: true as const };
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body && typeof body.message === "string") return { ok: false as const, message: body.message as string };
    }
    return { ok: false as const, message: REMINDER_FAILED };
  } catch {
    return { ok: false as const, message: REMINDER_FAILED };
  }
}
