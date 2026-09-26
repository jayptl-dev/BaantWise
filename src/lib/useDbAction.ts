import { useState } from "react";
import { friendlyError } from "./errors";

type DbError = { message: string } | null;

// A line of feedback under a button: what went wrong, or what just happened.
export type Feedback = { text: string; isError: boolean } | null;

// Runs one database change at a time and remembers the result as one friendly line.
// `afterSuccess` (usually "reload the data") runs after each change that worked.
export function useDbAction(afterSuccess?: () => void) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(
    change: () => PromiseLike<{ error: DbError }>,
    successText?: string,
    runAfterSuccess = true,
  ): Promise<boolean> {
    setBusy(true);
    setFeedback(null);
    const { error } = await change();
    setBusy(false);
    if (error) {
      setFeedback({ text: friendlyError(error), isError: true });
      return false;
    }
    if (successText) setFeedback({ text: successText, isError: false });
    if (runAfterSuccess) afterSuccess?.();
    return true;
  }

  return { busy, feedback, setFeedback, run };
}

// The database quietly skips rows you aren't allowed to change instead of raising
// an error, so "0 rows changed" is turned into a clear message here.
export async function mustChange(
  query: PromiseLike<{ error: DbError; count: number | null }>,
  notAllowedText: string,
): Promise<{ error: DbError }> {
  const { error, count } = await query;
  if (error) return { error };
  if (count === 0) return { error: { message: notAllowedText } };
  return { error: null };
}
