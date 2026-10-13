import { AppLayout } from "../components/AppLayout";
import { AuthMessage, SignInButton } from "../components/SignIn";
import { FullPageLoading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { useOneTimeNote } from "../lib/useOneTimeNote";
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
  const deleted = useOneTimeNote((state) => (state as { accountDeleted?: boolean } | null)?.accountDeleted) === true;
  return (
    <main className="landing">
      {deleted && (
        <p className="feedback" role="status">
          Your account was deleted. Thanks for trying Baantwise.
        </p>
      )}
      <h1>Baantwise</h1>
      <p className="tagline">Split bills with roommates, friends and trips. Free, with no ads.</p>
      {/* Up top on purpose: first-time visitors worried we'd ask for bank details. */}
      <p className="trust-note">
        <strong>Your money stays with you.</strong> Baantwise never asks for bank or card details, and it never holds
        or moves money. It only keeps track of who owes whom.
      </p>

      {/* What a group's balance looks like, so people see the idea before signing in. */}
      <figure className="landing-sample">
        <div aria-hidden="true">
          <p className="overall lent">
            <span className="overall-label">Your house</span>
            <span className="overall-value">You're owed $54.86</span>
          </p>
          <ul className="balance-list">
            <li className="balance-row">
              <span className="balance-text">
                Sam owes you <strong>$70.93</strong>
              </span>
              <span className="sample-chip">Remind</span>
            </li>
            <li className="balance-row">
              <span className="balance-text">
                You owe Priya <strong>$16.07</strong>
              </span>
              <span className="sample-chip">Pay</span>
            </li>
          </ul>
        </div>
        <figcaption className="visually-hidden">
          An example: Baantwise shows each person what they're owed and who to pay.
        </figcaption>
      </figure>

      <ul className="landing-features">
        <li>Add shared expenses and see who owes whom, with the fewest payments to settle up.</li>
        <li>Split equally, by exact amounts, by percent or by shares, or item by item from a scanned receipt.</li>
        <li>Forward a bill email, like your hydro or internet bill, and Baantwise fills in the amount.</li>
        <li>Rent and other recurring bills add themselves. Friendly payment reminders by email.</li>
        <li>Keep some expenses private between just the people in them.</li>
      </ul>
      <p className="name-note">
        The name blends the Hindi word <em lang="hi-Latn">baant</em>, meaning
        "to divide or share out", with "-wise".
      </p>

      <section className="account" aria-label="Account">
        <p className="beta-note">Sign in with Google to try it. It's free, and no bank details are needed.</p>
        <SignInButton />
        <AuthMessage />
      </section>
      <SiteFooter />
    </main>
  );
}
