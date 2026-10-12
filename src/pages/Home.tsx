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
      <p className="tagline">Split bills with roommates, friends and trips. Free, with no ads.</p>
      <ul className="landing-features">
        <li>Add shared expenses and see who owes whom, with the fewest payments to settle up.</li>
        <li>Split equally, by exact amounts, by percent or by shares, or item by item from a scanned receipt.</li>
        <li>Forward a bill email, like your hydro or internet bill, and Baantwise fills in the amount.</li>
        <li>Rent and other recurring bills add themselves. Friendly payment reminders by email.</li>
        <li>Keep some expenses private between just the people in them.</li>
        <li>Baantwise only keeps track: it never holds or moves your money.</li>
      </ul>
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
