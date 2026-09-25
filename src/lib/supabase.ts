import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

// The one Supabase client the whole app shares.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // PKCE: Google sends back a one-time code that the browser swaps for a
    // session, so sign-in tokens never appear in the address bar.
    flowType: "pkce",
    // Keep the session in this browser so it survives a page reload.
    persistSession: true,
    autoRefreshToken: true,
    // Finish sign-in automatically when Google sends the visitor back here.
    detectSessionInUrl: true,
  },
});
