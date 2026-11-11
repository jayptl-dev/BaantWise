import { AppLayout } from "../components/AppLayout";
import { AuthMessage, SignInButton } from "../components/SignIn";
import { FullPageLoading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { useOneTimeNote } from "../lib/useOneTimeNote";
import YourGroups from "./YourGroups";
import { SiteFooter } from "../components/SiteFooter";
import { BrandMark } from "../components/Brand";
import { hueOf } from "../lib/format";
import { useReveal } from "../lib/useReveal";
import { Arrow, Coin, Loop, Sparkle, Squiggle, Star } from "../components/Doodle";
import { HomeFeatures, HomeFree, HomeQuestions } from "../components/HomeSections";

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

// The example on the landing page: one month's bills, torn into three shares.
// $438.26 split three ways is 146.09 + 146.09 + 146.08, the same leftover-cent rule the app uses.
const SLIP_LINES = [
  { emoji: "🛒", what: "Groceries", amount: "$214.86" },
  { emoji: "💡", what: "Hydro", amount: "$128.40" },
  { emoji: "🌐", what: "Internet", amount: "$95.00" },
];
const SLIP_SHARES = [
  { name: "Priya", amount: "$146.09" },
  { name: "Sam", amount: "$146.09" },
  { name: "Alex", amount: "$146.08" },
];

function Landing() {
  // Just deleted your account in Profile.
  const deleted = useOneTimeNote((state) => (state as { accountDeleted?: boolean } | null)?.accountDeleted) === true;
  // Pen strokes further down the page draw themselves when they scroll into view.
  const page = useReveal<HTMLDivElement>();
  return (
    <div className="home" ref={page}>
      <header className="home-nav">
        <a href="#top" className="brand">
          <BrandMark />
          Baantwise
        </a>
        <nav aria-label="On this page">
          <a href="#features">Features</a>
          <a href="#faq">Questions</a>
        </nav>
        <a href="#signin" className="button nav-signin">
          Sign in
        </a>
      </header>

      <main id="top">
        <div className="home-top">
          <div className="home-intro">
            {deleted && (
              <p className="feedback" role="status">
                Your account was deleted. Thanks for trying Baantwise.
              </p>
            )}
            <h1 className="home-headline">
              <span className="inked">
                Split bills
                <Squiggle draw />
              </span>{" "}
              with roommates, friends and trips.
            </h1>
            <p className="home-free">
              Free, with no ads.
              <Loop draw />
            </p>
          </div>
          <div className="home-action">
            {/* Up top on purpose: first-time visitors worried we'd ask for bank details. */}
            <p className="trust-note sticky-note">
              <strong>Your money stays with you.</strong> Baantwise never asks for bank or card details, and it never
              holds or moves money. It only keeps track of who owes whom.
            </p>
            <section className="account" id="signin" aria-label="Account">
              <p className="beta-note">Sign in with Google to try it. It's free, and no bank details are needed.</p>
              <SignInButton />
              <AuthMessage />
            </section>
          </div>

          {/* A paper receipt on the table, its bottom torn into one share each: the whole idea in one picture. */}
          <figure className="home-table">
            <Star className="table-star" />
            <Coin className="table-coin" />
            <Sparkle className="table-sparkle" />
            <div className="slip" aria-hidden="true">
              <p className="slip-title">Maple Street house</p>
              <p className="slip-sub">November</p>
              <ul className="slip-lines">
                {SLIP_LINES.map((line) => (
                  <li key={line.what}>
                    <span className="slip-what">
                      <span className="slip-emoji">{line.emoji}</span>
                      {line.what}
                    </span>
                    <span className="slip-amount">{line.amount}</span>
                  </li>
                ))}
              </ul>
              <p className="slip-total">
                <span>Total</span>
                <span className="slip-amount">$438.26</span>
              </p>
              <p className="slip-cut">split 3 ways</p>
              <ul className="slip-stubs">
                {SLIP_SHARES.map((share, i) => (
                  <li key={share.name} className={`slip-stub stub-${i}`}>
                    <span className={`avatar avatar-initial hue-${hueOf(share.name)}`}>{share.name[0]}</span>
                    <span className="slip-stub-name">{share.name}</span>
                    <span className="slip-amount">{share.amount}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* A handwritten note pointing at the share that's a cent smaller. */}
            <p className="hand-note table-note" aria-hidden="true">
              <Arrow draw />
              fair to the cent!
            </p>
            <figcaption className="visually-hidden">
              An example: three bills adding up to $438.26, split three ways. Priya and Sam each owe $146.09 and Alex
              owes $146.08.
            </figcaption>
          </figure>
        </div>

        <HomeFeatures />
        <HomeFree />
        <HomeQuestions />
      </main>
      <SiteFooter />
    </div>
  );
}
