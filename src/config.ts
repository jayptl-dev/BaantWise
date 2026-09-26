// Supabase and Google connection details.
//
// These values are PUBLIC by design: they ship to every visitor's browser
// and are safe to commit. What people can do with them is limited by Supabase
// Auth and, once we add tables, by Row Level Security in the database.
//
// Never put the Supabase secret key or service_role key in this repo.
export const SUPABASE_URL = "https://yvdbqqblbfodeqkwzvem.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nvxtaQgIHizfSqP-haZhjg_Gg87qt6m";

// The Google OAuth client behind the "Sign in with Google" button. Google only
// accepts it on the sites listed as its Authorized JavaScript origins, and
// Supabase's Google provider uses the same client ID to check the sign-in.
export const GOOGLE_CLIENT_ID = "68518338982-nf5i0hcsrf30v13ph109u3oosjbcofn5.apps.googleusercontent.com";
