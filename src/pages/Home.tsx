import { useLocation } from "react-router";
import { AppLayout } from "../components/AppLayout";
import { AuthMessage, SignInButton } from "../components/SignIn";
import { FullPageLoading } from "../components/Status";
import { useAuth } from "../lib/auth";
import YourGroups from "./YourGroups";
import { SiteFooter } from "../components/SiteFooter";

// "/": the landing page when signed out, "Your groups" when signed in.
export default function Home() {
  const { user, checking } = useAuth();
  if (checking) return <FullPageLoading />;
  if (!user) return <Landing />;
  return (
    <AppLayout>
      <YourGroups />
    </AppLayout>
  );
}

function Landing() {
  // Just deleted your account in Profile.
  const deleted = (useLocation().state as { accountDeleted?: boolean } | null)?.accountDeleted === true;
  return (
    <main className="landing">
      {deleted && (
        <p className="feedback" role="status">
          Your account was deleted. Thanks for trying Baantwise.
        </p>
      )}
      <h1>Baantwise</h1>
      <p className="tagline">Split bills fairly. Coming soon.</p>
      <p className="name-note">
        The name blends the Hindi word <em lang="hi-Latn">baant</em>, meaning
        "to divide or share out", with "-wise".
      </p>

      <section className="account" aria-label="Account">
        <p className="beta-note">Baantwise is in private beta</p>
        <SignInButton />
        <AuthMessage />
      </section>
      <SiteFooter />
    </main>
  );
}
