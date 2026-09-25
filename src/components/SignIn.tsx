import { useState } from "react";
import { useAuth } from "../lib/auth";

export const BETA_NOTE = "Baantwise is in private beta, so only invited testers can sign in right now.";

// Starts Google sign-in. Afterwards Google brings the person back to this same page.
export function SignInButton({ label = "Sign in with Google" }: { label?: string }) {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    const started = await signIn();
    if (!started) setBusy(false);
  }

  return (
    <button type="button" className="button" onClick={handleClick} disabled={busy}>
      {label}
    </button>
  );
}

// The friendly line after a failed or cancelled sign-in.
export function AuthMessage() {
  const { message } = useAuth();
  if (!message) return null;
  return (
    <p className="auth-message" role="status">
      {message}
    </p>
  );
}

// A signed-out page with a short line and the sign-in button (used for invite
// links and for group pages opened while signed out).
export function SignInPage({ line, buttonLabel }: { line: string; buttonLabel?: string }) {
  return (
    <main className="landing">
      <h1>Baantwise</h1>
      <p className="tagline">{line}</p>
      <section className="account" aria-label="Sign in">
        <SignInButton label={buttonLabel} />
        <p className="auth-message">{BETA_NOTE}</p>
        <AuthMessage />
      </section>
    </main>
  );
}
