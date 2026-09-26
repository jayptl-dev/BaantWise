type ErrorLike = { message?: string } | null | undefined;

// Turns a failed Supabase call into one friendly line.
// Baantwise's database functions already explain themselves in plain English
// (for example "Only a group admin can do this"), so those are shown as they are.
// Low-level database errors are swapped for plain words.
export function friendlyError(error: ErrorLike): string {
  const message = error?.message?.trim() ?? "";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "Couldn't reach Baantwise. Check your connection and try again.";
  }
  if (/row-level security|permission denied/i.test(message)) {
    return "You don't have permission to do that.";
  }
  if (/\bjwt\b/i.test(message)) {
    return "Your sign-in has expired. Please sign out and sign in again.";
  }
  if (/invalid input syntax/i.test(message)) {
    return "That link isn't valid.";
  }
  if (/violates|constraint/i.test(message)) {
    return "That didn't work. Please check what you typed and try again.";
  }
  return message || "Something went wrong. Please try again.";
}
