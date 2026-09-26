import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  isAuthImplicitGrantRedirectError,
  isAuthRetryableFetchError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Auth = {
  user: User | null;
  // True until we know whether someone is signed in (avoids flashing the wrong screen).
  checking: boolean;
  // One friendly line after a failed or cancelled sign-in, or a failed sign-out.
  message: string | null;
  // Signs in with the ID token from Google's button (see googleSignIn.ts).
  // Resolves to false if Supabase didn't accept it.
  signInWithGoogle: (token: string, nonce: string) => Promise<boolean>;
  // The fallback when Google's button can't load: leaves for Google's sign-in
  // page and comes back here. Resolves to false only if it couldn't start.
  signInWithRedirect: () => Promise<boolean>;
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

    // Tells us if the visitor just came back from a failed or cancelled redirect sign-in.
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

  // Kept the same between renders, so Google's button isn't set up again each time.
  const signInWithGoogle = useCallback(async (token: string, nonce: string) => {
    setMessage(null);
    const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce });
    // On success, onAuthStateChange above sets the user and the page switches by itself.
    if (error) {
      setMessage(friendlySignInError(error));
      return false;
    }
    return true;
  }, []);

  async function signInWithRedirect() {
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
    <AuthContext.Provider value={{ user, checking, message, signInWithGoogle, signInWithRedirect, signOut }}>
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
  if (isAuthRetryableFetchError(error)) {
    return "Couldn't reach Baantwise. Check your connection and try again.";
  }
  // After a redirect sign-in, Google reports "access_denied" when someone cancels,
  // or isn't on the beta tester list.
  if (isAuthImplicitGrantRedirectError(error) && error.details?.error === "access_denied") {
    return "Sign-in was cancelled, or this Google account isn't in the private beta yet.";
  }
  // Supabase turned the account away.
  if (error.code === "signup_disabled" || error.code === "user_banned") {
    return "This Google account isn't in the private beta yet.";
  }
  return "Sign-in didn't work. Please try again.";
}

// Tidy the address bar after a failed redirect sign-in so a reload doesn't show the error again.
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
