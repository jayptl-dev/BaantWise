import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { displayNameOf, photoOf, useAuth } from "../lib/auth";
import { hasSeenTour, markTourSeen, SHOW_TOUR_EVENT } from "../lib/tour";
import { WelcomeTour } from "./WelcomeTour";
import { Avatar } from "./Avatar";
import { SiteFooter } from "./SiteFooter";
import { FullPageLoading } from "./Status";
import { SignInPage } from "./SignIn";

// The frame around every signed-in screen: a small header, then the page.
// Someone new sees the welcome tour once, on their first signed-in page.
export function AppLayout({ children }: { children: ReactNode }) {
  const [tourWanted, setTourWanted] = useState(() => !hasSeenTour());
  // Joining a group comes first; the tour waits for the next page.
  const joining = useLocation().pathname.startsWith("/join/");

  useEffect(() => {
    const show = () => setTourWanted(true);
    window.addEventListener(SHOW_TOUR_EVENT, show);
    return () => window.removeEventListener(SHOW_TOUR_EVENT, show);
  }, []);

  function closeTour() {
    markTourSeen();
    setTourWanted(false);
  }

  return (
    <div className="app">
      <AppHeader />
      <main>{children}</main>
      <SiteFooter />
      {tourWanted && !joining && <WelcomeTour onClose={closeTour} />}
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
            <Link to="/profile" className="avatar-link" aria-label="Your profile" title="Your profile">
              <Avatar name={displayNameOf(user)} url={photoOf(user)} size={32} />
            </Link>
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
// button (with `line` above it) that brings them back to this same page.
export function SignedInPage({
  children,
  line = "Sign in to see this group.",
}: {
  children: ReactNode;
  line?: string;
}) {
  const { user, checking } = useAuth();
  if (checking) return <FullPageLoading />;
  if (!user) return <SignInPage line={line} />;
  return <AppLayout>{children}</AppLayout>;
}
