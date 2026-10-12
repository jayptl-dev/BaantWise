import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { GOOGLE_CLIENT_ID } from "../config";
import { useAuth } from "../lib/auth";
import { loadGoogleScript, makeNonce, type GoogleId } from "../lib/googleSignIn";
import { SiteFooter } from "./SiteFooter";

export const BETA_NOTE = "Baantwise is brand new and still being tested, so you may spot a few rough edges.";

// How long to wait for Google's button before offering the other way to sign in.
const SLOW_MS = 8000;
// Google's button can't be wider than this.
const GOOGLE_MAX_WIDTH = 400;

// Google's own "Sign in with Google" button. Google's box opens on top of this
// page and the person stays here afterwards (an invite goes straight on to
// "Join group"). If Google's script is blocked or doesn't load, a small link
// offers the older sign-in that visits Google's page and comes back.
export function SignInButton() {
  const { signInWithGoogle, signInWithRedirect } = useAuth();
  const slot = useRef<HTMLDivElement>(null);
  const [google, setGoogle] = useState<GoogleId | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const dark = usePrefersDark();
  const width = useWidth(slot);

  // Load Google's script and set up sign-in with a fresh nonce.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);

    Promise.all([loadGoogleScript(), makeNonce()]).then(
      ([id, nonce]) => {
        window.clearTimeout(timer);
        if (!active) return;
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          // Runs after someone picks their Google account.
          callback: async ({ credential }) => {
            setSigningIn(true);
            await signInWithGoogle(credential, nonce.raw);
            if (active) setSigningIn(false);
          },
          // Only sign in when the button is pressed: no One Tap, no automatic sign-in.
          auto_select: false,
          button_auto_select: false,
          // Google's current advice: let Chrome show its own sign-in box (FedCM).
          // Other browsers get Google's pop-up instead.
          use_fedcm_for_button: true,
        });
        setGoogle(id);
      },
      () => {
        window.clearTimeout(timer);
        if (active) setFailed(true);
      },
    );

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [signInWithGoogle]);

  // Draw (or redraw) the button to match the light or dark look and the space it has.
  useEffect(() => {
    const element = slot.current;
    if (!google || !element || width === 0) return;
    element.replaceChildren();
    google.renderButton(element, {
      type: "standard",
      theme: dark ? "outline_dark" : "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.min(width, GOOGLE_MAX_WIDTH),
    });
  }, [google, dark, width]);

  // Blocked, broken, or still not there after a while. If it turns up late, the
  // button appears after all.
  const showFallback = failed || (slow && !google);

  async function signInAnotherWay() {
    setRedirecting(true);
    const started = await signInWithRedirect();
    if (!started) setRedirecting(false);
  }

  return (
    <>
      <div ref={slot} className="google-button" hidden={showFallback} />
      {signingIn && (
        <p className="auth-message" role="status">
          Signing in…
        </p>
      )}
      {showFallback && (
        <p className="auth-message">
          Google's sign-in button didn't load.{" "}
          <button type="button" className="link-button" onClick={signInAnotherWay} disabled={redirecting}>
            Sign in another way
          </button>
        </p>
      )}
    </>
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
export function SignInPage({ line }: { line: string }) {
  return (
    <main className="landing">
      <h1>Baantwise</h1>
      <p className="tagline">{line}</p>
      <section className="account" aria-label="Sign in">
        <SignInButton />
        <p className="auth-message">{BETA_NOTE}</p>
        <AuthMessage />
      </section>
      <SiteFooter />
    </main>
  );
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

// True while the device is set to dark mode, and updates if that changes.
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DARK_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DARK_QUERY).matches,
  );
}

// An element's width in whole pixels, kept up to date (for example when a phone turns sideways).
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.round(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
