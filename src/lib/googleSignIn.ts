// Google's own "Sign in with Google" button (Google Identity Services).
//
// Google's script draws the button. When someone picks their account, Google
// hands this page an ID token (a signed note saying who they are), and
// auth.tsx passes it to Supabase. The sign-in happens right here on
// baantwise.com, so Google's box names our site.

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

// The small part of Google's script that Baantwise uses.
export type GoogleId = {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    nonce: string;
    auto_select: boolean;
    use_fedcm_for_button: boolean;
    button_auto_select: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline" | "outline_dark";
      size: "large";
      text: "signin_with";
      shape: "rectangular";
      logo_alignment: "left";
      width: number;
    },
  ): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

let loading: Promise<GoogleId> | null = null;

// Adds Google's script to the page the first time a sign-in button needs it,
// so signed-in screens never load it. Fails if the script is blocked (for
// example by an ad blocker) or can't be reached.
export function loadGoogleScript(): Promise<GoogleId> {
  if (!loading) {
    loading = new Promise<GoogleId>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        const id = window.google?.accounts?.id;
        if (id) resolve(id);
        else fail();
      };
      script.onerror = fail;
      document.head.append(script);

      function fail() {
        // Forget this try, so the next sign-in screen can try again.
        script.remove();
        loading = null;
        reject(new Error("Google's sign-in script didn't load"));
      }
    });
  }
  return loading;
}

// A nonce is a random one-time value that ties Google's ID token to this page.
// Google gets the SHA-256 hash and copies it into the token; Supabase gets the
// raw value, hashes it and checks the two match. A token copied from somewhere
// else can't be used here, because nobody else has the raw value.
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = toHex(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw) };
}

// SHA-256 as 64 lowercase hex characters, the form Supabase compares against.
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
