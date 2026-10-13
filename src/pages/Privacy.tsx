import { Link } from "react-router";
import { SiteFooter } from "../components/SiteFooter";

// "/privacy": the privacy policy. Public (no sign-in), because Google's sign-in review and
// people deciding whether to join need to read it first. Keep it true to what the app
// does: when a feature changes what's collected, read, kept or shared, update this page
// and the date below.
export const PRIVACY_UPDATED = "October 12, 2026";
export const PRIVACY_EMAIL = "privacy@baantwise.com";

export default function Privacy() {
  return (
    <div className="app legal-page">
      <header className="app-header">
        <Link to="/" className="brand">
          Baantwise
        </Link>
      </header>
      <main className="legal">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated {PRIVACY_UPDATED}</p>

        <p>
          Baantwise is a free app for sharing expenses with the people you live, travel or eat with. It's an independent
          project based in Ontario, Canada. This page explains, in plain words, what Baantwise collects, why, who can see
          it, and what you can do about it. If anything is unclear, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>

        <section aria-labelledby="short">
          <h2 id="short">The short version</h2>
          <ul>
            <li>Baantwise keeps track of who owes what. It never holds, moves or asks for your money or bank details.</li>
            <li>No ads, no selling or renting your data, and no advertising or analytics trackers.</li>
            <li>Your data is stored in Canada (Montreal).</li>
            <li>
              When you forward a bill email, Baantwise keeps only the biller's name, the amount and the date. The email
              itself is not kept.
            </li>
            <li>You can delete your account yourself, at any time, in your Profile.</li>
          </ul>
        </section>

        <section aria-labelledby="collect">
          <h2 id="collect">What Baantwise collects</h2>
          <h3>Your account</h3>
          <p>
            You sign in with Google. Baantwise gets your name, email address and profile picture from Google, and nothing
            else from your Google account (not your contacts, files or emails). You can change the name others see in
            Baantwise.
          </p>
          <h3>What you add</h3>
          <ul>
            <li>Groups, and the names of the people in them. You and other members can add guests by name only.</li>
            <li>
              Expenses and payments: what they were for, the amount, the date, the category, the currency, who paid and how
              they're split.
            </li>
            <li>Receipt photos, if you add one to an expense.</li>
            <li>
              Recurring expenses, like rent, so Baantwise can add them on schedule.
            </li>
            <li>
              Payment details you choose to share with your groups, like an Interac e-Transfer email or phone number, or a
              PayPal.Me name. These are optional. Baantwise only shows them; it never sends money.
            </li>
          </ul>
          <h3>Bills you forward by email</h3>
          <p>
            Each group has its own private bill address. When a member forwards an email to it, Baantwise checks that it
            came from the email address that member signs in with, then reads the email to find three things: the
            biller's name, the amount and the date (and a category, like "utilities"). Only those are kept, as a "bill to
            review" that only the person who forwarded it can see. The email itself, its text and its attachments are not
            stored. Nothing is added to the group until that person checks the bill and presses Save. Emails from
            anyone who isn't in the group are turned away.
          </p>
          <p>
            If your email app forwards emails that aren't bills, Baantwise ignores them and doesn't keep them. It only
            notes when one arrived (not what it said), so it can warn you if your email seems to be forwarding everything.
          </p>
          <h3>A few small records</h3>
          <p>
            To keep things fair and stop spam, Baantwise keeps short records like "a reminder was sent to this person on
            this day" (kept 30 days) and how many receipts you've scanned this month. These never include the content of
            an email or receipt. Our services also keep short technical logs (for example, "a request worked" or "a request
            failed"); Baantwise is written so that these logs never contain your names, email addresses, amounts or email
            text.
          </p>
        </section>

        <section aria-labelledby="see">
          <h2 id="see">Who can see what</h2>
          <ul>
            <li>Everyone in a group sees the group's expenses, payments and members.</li>
            <li>
              A private expense (one you mark "only the people in it") is seen only by the person who paid, the people
              splitting it, and whoever added it. Not even group admins can see other people's private expenses.
            </li>
            <li>A receipt photo is seen only by the people who can see its expense.</li>
            <li>Bills you forward by email are seen only by you until you save them as an expense.</li>
            <li>
              When you send a payment reminder, the person who owes you gets an email with your name, the group's name and
              the amount, and your payment details if you've added them.
            </li>
          </ul>
          <p>These rules are enforced by the database itself, not just by what the screens show.</p>
        </section>

        <section aria-labelledby="services">
          <h2 id="services">Services Baantwise uses</h2>
          <p>Baantwise relies on a few companies to run. Each only gets what it needs for its job:</p>
          <ul>
            <li>
              <strong>Supabase</strong> stores the database, your sign-in and receipt photos, in Canada (Montreal), and runs
              Baantwise's server code.
            </li>
            <li>
              <strong>Cloudflare</strong> serves the website and receives emails sent to bill addresses, passing them
              straight to Baantwise without keeping them.
            </li>
            <li>
              <strong>Google</strong> handles "Sign in with Google". Google's Gemini AI also reads receipt photos you scan
              and bill emails you forward, to find the amounts. Baantwise uses Google's paid Gemini service, under which
              Google doesn't use this content to improve its products, and asks Google not to store the requests.
            </li>
            <li>
              <strong>Resend</strong> sends Baantwise's emails, like payment reminders and bill address setup emails, so it
              handles the recipient's address and the email's content.
            </li>
            <li>
              <strong>GitHub</strong> keeps Baantwise's nightly database backups, locked with a passphrase so only
              Baantwise can open them.
            </li>
            <li>
              The <strong>Bank of Canada</strong> provides exchange rates. No personal information is sent to it.
            </li>
          </ul>
          <p>
            Some of these companies process data outside Canada, for example in the United States, where it may be
            subject to local laws. Baantwise never sells or rents your information, and doesn't share it for advertising.
          </p>
        </section>

        <section aria-labelledby="keep">
          <h2 id="keep">How long it's kept</h2>
          <ul>
            <li>Your account and group data are kept while your account exists.</li>
            <li>
              Deleted expenses and payments are hidden from everyone but kept in the database, so a group's history stays
              correct.
            </li>
            <li>Forwarded bills you've added or dismissed are erased after 90 days.</li>
            <li>Reminder and email-forwarding records are erased after 30 and 8 days.</li>
            <li>
              A username, if you choose one, is kept until you remove it in your Profile. Anyone who knows it can add you
              as a friend.
            </li>
            <li>
              A locked backup of the database is made every night and kept for 30 days, so it can be restored if something
              goes wrong. Something you delete, including your account, can stay in these backups until they expire.
            </li>
          </ul>
        </section>

        <section aria-labelledby="delete">
          <h2 id="delete">Deleting your account</h2>
          <p>
            Go to <Link to="/profile">Profile</Link> and choose <strong>Delete my account</strong>. This erases your
            sign-in, your email address, your profile picture, your payment details and your forwarded bills. Shared
            expenses stay in your groups under your name, as if you were a guest, so everyone else's balances stay right.
            If you'd rather your name not appear, rename yourself first. You can also email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we'll do it for you.
          </p>
        </section>

        <section aria-labelledby="rights">
          <h2 id="rights">Your choices and rights</h2>
          <p>
            You can see and correct most of your information in the app. You can also ask for a copy of your information,
            ask us to correct or delete it, or ask a question, by emailing{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We'll answer within 30 days. If you're not happy with
            our answer, you can contact the{" "}
            <a href="https://www.priv.gc.ca/" rel="noreferrer">
              Office of the Privacy Commissioner of Canada
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="kids">
          <h2 id="kids">Children</h2>
          <p>Baantwise isn't meant for children under 13, and doesn't knowingly collect their information.</p>
        </section>

        <section aria-labelledby="changes">
          <h2 id="changes">Changes to this policy</h2>
          <p>
            If Baantwise changes what it collects or how it's used, this page will be updated and the date at the top
            will change. For big changes, you'll also see a notice in the app.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
