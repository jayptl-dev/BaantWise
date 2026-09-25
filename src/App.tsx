import { useEffect, useState } from "react";
import { isAuthImplicitGrantRedirectError, type AuthError, type User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Tells us if the visitor just came back from a failed or cancelled Google sign-in.
    supabase.auth.initialize().then(({ error }) => {
      if (error) {
        if (active) setMessage(friendlySignInError(error));
        removeSignInParamsFromUrl();
      }
    });

    // Fires once with the saved session (if any), then on every sign-in or sign-out.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setChecking(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Come back to whichever site started sign-in (baantwise.com or www.baantwise.com).
      options: { redirectTo: `${window.location.origin}/` },
    });
    // On success the browser is already leaving for Google, so only errors land here.
    if (error) {
      setMessage("Couldn't reach Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) setMessage("Couldn't sign out. Please try again.");
    setBusy(false);
  }

  const name = user ? displayName(user) : "";
  const photo = user ? photoUrl(user) : null;

  return (
    <main className="landing">
      <h1>Baantwise</h1>
      <p className="tagline">Split bills fairly. Coming soon.</p>
      <p className="name-note">
        The name blends the Hindi word <em lang="hi-Latn">baant</em>, meaning
        "to divide or share out", with "-wise".
      </p>

      <section className="account" aria-label="Account">
        {checking ? null : user ? (
          <>
            <div className="signed-in">
              {photo && (
                <img
                  className="avatar"
                  src={photo}
                  alt=""
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                />
              )}
              <p>
                Signed in as <strong>{name}</strong>
              </p>
            </div>
            <button type="button" className="button secondary" onClick={signOut} disabled={busy}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="beta-note">Baantwise is in private beta</p>
            <button type="button" className="button" onClick={signIn} disabled={busy}>
              Sign in with Google
            </button>
          </>
        )}

        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}

function displayName(user: User): string {
  const meta = user.user_metadata;
  return meta.full_name || meta.name || user.email || "your Google account";
}

function photoUrl(user: User): string | null {
  const meta = user.user_metadata;
  return meta.avatar_url || meta.picture || null;
}

function friendlySignInError(error: AuthError): string {
  // Google reports "access_denied" when someone cancels, or isn't on the beta tester list.
  if (isAuthImplicitGrantRedirectError(error) && error.details?.error === "access_denied") {
    return "Sign-in was cancelled, or this Google account isn't in the private beta yet.";
  }
  return "Sign-in didn't work. Please try again.";
}

// Tidy the address bar after a failed sign-in so a reload doesn't show the error again.
function removeSignInParamsFromUrl() {
  const keys = ["error", "error_code", "error_description", "code", "sb_flow_id"];
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  for (const key of keys) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  url.hash = hash.toString();
  window.history.replaceState(window.history.state, "", url.toString());
}
