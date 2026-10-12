import { describe, expect, it } from "vitest";
import app from "./balances.ts?raw";
import fn from "../../supabase/functions/send-reminder/balances.ts?raw";

// Edge Functions can't import from src/, so they get a copy. These must stay identical,
// or a reminder email could show a different amount from the group page.
// To update: copy src/lib/balances.ts over supabase/functions/send-reminder/balances.ts.
describe("code shared with Edge Functions", () => {
  it("supabase/functions/send-reminder/balances.ts is an exact copy of src/lib/balances.ts", () => {
    expect(fn).toBe(app);
  });
});
