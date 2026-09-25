import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { displayNameOf, photoOf, useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";
import { FullPageLoading } from "./Status";
import { SignInPage } from "./SignIn";

// The frame around every signed-in screen: a small header, then the page.
export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <AppHeader />
      <main>{children}</main>
    </div>
  );
}

function AppHeader() {
  const { user, message, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    const signedOut = await signOut();
    setBusy(false);
    if (signedOut) navigate("/");
  }

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          Baantwise
        </Link>
        {user && (
          <div className="header-account">
            <Avatar name={displayNameOf(user)} url={photoOf(user)} size={32} />
            <button type="button" className="text-button" onClick={handleSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {message && (
        <p className="feedback error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}

// Shows the page only to someone who is signed in. Anyone else gets a sign-in
// button that brings them back to this same page.
export function SignedInPage({ children }: { children: ReactNode }) {
  const { user, checking } = useAuth();
  if (checking) return <FullPageLoading />;
  if (!user) return <SignInPage line="Sign in to see this group." />;
  return <AppLayout>{children}</AppLayout>;
}
