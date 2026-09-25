import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isAuthImplicitGrantRedirectError, type AuthError, type User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Auth = {
  user: User | null;
  // True until we know whether someone is signed in (avoids flashing the wrong screen).
  checking: boolean;
  // One friendly line after a failed or cancelled sign-in, or a failed sign-out.
  message: string | null;
  // Resolves to false only if Google sign-in couldn't start.
  signIn: () => Promise<boolean>;
  signOut: () => Promise<boolean>;
};

const AuthContext = createContext<Auth | null>(null);

// Keeps track of who is signed in and shares it with every screen.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
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
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Come back to this exact page afterwards, so an invite link still works after signing in.
      options: { redirectTo: window.location.href },
    });
    // On success the browser is already leaving for Google, so only errors land here.
    if (error) {
      setMessage("Couldn't reach Google sign-in. Please try again.");
      return false;
    }
    return true;
  }

  async function signOut() {
    setMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage("Couldn't sign out. Please try again.");
      return false;
    }
    return true;
  }

  return (
    <AuthContext.Provider value={{ user, checking, message, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}

export function displayNameOf(user: User): string {
  const meta = user.user_metadata;
  return meta.full_name || meta.name || user.email || "You";
}

export function photoOf(user: User): string | null {
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
