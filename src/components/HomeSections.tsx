import type { ReactNode } from "react";
import { Link } from "react-router";
import { hueOf } from "../lib/format";
import { DoubleLine, Scribble, Sparkle, Squiggle, Star } from "./Doodle";
import { LockIcon } from "./LockIcon";

// The rest of the landing page under the receipt: what Baantwise does (Google's sign-in
// review needs this on the home page), that it's free, and common questions.
// The little phone screens are drawn with the app's own styles and made-up people, so
// they follow the look and dark mode by themselves. Keep them, and every line here,
// true to what the app does.

type Point = { emoji: string; title: string; text: string };

function Feature({
  title,
  lead,
  points,
  tint,
  children,
}: {
  title: string;
  lead: string;
  points: Point[];
  tint: string;
  children: ReactNode;
}) {
  return (
    <section className="feature reveal">
      <div className="feature-text">
        <h2>{title}</h2>
        <Squiggle className="feature-rule" draw />
        <p className="feature-lead">{lead}</p>
        <ul className="feature-points">
          {points.map((point) => (
            <li key={point.title}>
              <span className="feature-emoji" aria-hidden="true">
                {point.emoji}
              </span>
              <span>
                <strong>{point.title}</strong> {point.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* A picture of the app: decoration only, the words beside it say the same. */}
      <div className={`feature-stage ${tint}`} aria-hidden="true">
        <Scribble seed={title.length} />
        <div className="phone">{children}</div>
      </div>
    </section>
  );
}

// A person's coloured initial, as in the app.
function Face({ name }: { name: string }) {
  return <span className={`avatar avatar-initial hue-${hueOf(name)}`}>{name[0]}</span>;
}

function ExpenseRow({
  emoji,
  title,
  sub,
  note,
  kind,
  amount,
}: {
  emoji: string;
  title: string;
  sub: string;
  note?: ReactNode;
  kind: "lent" | "owe";
  amount: string;
}) {
  return (
    <li>
      <span className="expense-link">
        <span className="expense-icon">{emoji}</span>
        <span className="expense-main">
          <span className="expense-title">{title}</span>
          <span className="expense-sub">{sub}</span>
          {note}
        </span>
        <span className={`my-part ${kind}`}>
          {kind === "lent" ? "you lent" : "you owe"}
          <strong>{amount}</strong>
        </span>
      </span>
    </li>
  );
}

export function HomeFeatures() {
  return (
    <div id="features" className="features">
      <Feature
        title="See who owes whom"
        lead="Add what you paid for. Baantwise keeps the running total for everyone, so nobody needs a spreadsheet or a long memory."
        tint="stage-green"
        points={[
          { emoji: "⚖️", title: "The fewest payments.", text: "Baantwise works out the shortest way for everyone to settle up." },
          {
            emoji: "💸",
            title: "Pay the way you already do.",
            text: "Copy someone's Interac e-Transfer details or open their PayPal.Me, then mark it as paid.",
          },
          { emoji: "🔔", title: "Friendly reminders.", text: "Send a reminder email with one tap." },
        ]}
      >
        <p className="phone-title">Maple Street house</p>
        <p className="overall lent">
          <span className="overall-label">Overall</span>
          <span className="overall-value">
            You're owed{" "}
            <strong className="overall-amount">
              $54.86
              <DoubleLine />
            </strong>
          </span>
        </p>
        <ul className="balance-list">
          <li className="balance-row">
            <Face name="Sam" />
            <span className="balance-text">
              Sam owes you <strong>$70.93</strong>
            </span>
            <span className="button secondary balance-button">Remind</span>
          </li>
          <li className="balance-row">
            <Face name="Priya" />
            <span className="balance-text">
              You owe Priya <strong>$16.07</strong>
            </span>
            <span className="button secondary balance-button">Pay</span>
          </li>
        </ul>
      </Feature>

      <Feature
        title="Scan a receipt, split it item by item"
        lead="Split equally, by exact amounts, by percent or by shares. Or take a photo of the receipt and share out each item."
        tint="stage-gold"
        points={[
          { emoji: "🧾", title: "Take a photo.", text: "Baantwise reads the items and prices, and gives them plain names." },
          { emoji: "✅", title: "Tick who had what.", text: "One item at a time, with each person's total adding up as you go." },
          { emoji: "🧮", title: "Tax where it belongs.", text: "Tax is shared only across the taxed items, and the tip across everything." },
        ]}
      >
        <p className="phone-title">Split by item</p>
        <p className="phone-step">Item 3 of 9</p>
        <div className="phone-item">
          <span>
            <strong>Milk 2%, 4 L</strong>
            <span className="phone-printed">PC MLK 2% 4L</span>
          </span>
          <strong className="phone-price">$6.49</strong>
        </div>
        <ul className="phone-people">
          {[
            { name: "Priya", on: true, total: "$21.40" },
            { name: "Sam", on: true, total: "$17.85" },
            { name: "Alex", on: false, total: "$9.12" },
          ].map((person) => (
            <li key={person.name}>
              <span className={person.on ? "phone-tick on" : "phone-tick"} />
              <Face name={person.name} />
              <span className="phone-person">{person.name}</span>
              <span className="phone-total">{person.total}</span>
            </li>
          ))}
        </ul>
        <span className="button">Next item</span>
      </Feature>

      <Feature
        title="Bills that look after themselves"
        lead="The same bills come round every month. Set them up once."
        tint="stage-rust"
        points={[
          { emoji: "🔁", title: "Recurring bills.", text: "Rent and other regular bills add themselves on the day you choose." },
          {
            emoji: "📧",
            title: "Forward a bill email.",
            text: "Send your hydro or internet bill to your group's private address. Baantwise fills in the biller, amount and date for you to check.",
          },
          { emoji: "💱", title: "Other currencies.", text: "Paid in US dollars on a trip? Baantwise converts it with the Bank of Canada rate." },
        ]}
      >
        <p className="phone-title">Expenses</p>
        <ul className="expense-list">
          <ExpenseRow emoji="🏠" title="Rent 🔁" sub="Jordan paid $2,400" kind="owe" amount="$600.00" />
          <ExpenseRow emoji="💡" title="Hydro One" sub="Forwarded bill" kind="lent" amount="$96.30" />
          <ExpenseRow emoji="🌐" title="Internet 🔁" sub="You paid $95" kind="lent" amount="$71.25" />
        </ul>
      </Feature>

      <Feature
        title="Private when it needs to be"
        lead="Not everything is the whole group's business. A surprise gift should stay a surprise."
        tint="stage-plum"
        points={[
          {
            emoji: "🔒",
            title: "You choose who sees it.",
            text: "Each expense is for everyone in the group, or only for the people in it.",
          },
          { emoji: "🎁", title: "No hints.", text: "Everyone else sees nothing at all, not even that something is hidden." },
          {
            emoji: "👥",
            title: "Guests and friends.",
            text: "Add guests who never sign in, or split with one friend outside any group.",
          },
        ]}
      >
        <p className="phone-title">Maple Street house</p>
        <ul className="expense-list">
          <ExpenseRow
            emoji="🎁"
            title="Sam's gift"
            sub="You paid $60"
            note={
              <span className="private-note">
                <LockIcon /> Only you and Alex
              </span>
            }
            kind="lent"
            amount="$30.00"
          />
        </ul>
        <p className="phone-heading private-note">
          <LockIcon /> Just between you and Alex
        </p>
        <ul className="balance-list">
          <li className="balance-row">
            <Face name="Alex" />
            <span className="balance-text">
              Alex owes you <strong>$30.00</strong>
            </span>
          </li>
        </ul>
      </Feature>
    </div>
  );
}

// The coloured band: it's free, and the code is open.
export function HomeFree() {
  return (
    <section className="home-band reveal" aria-labelledby="home-free-heading">
      <Star className="band-star" draw />
      <Sparkle className="band-sparkle" draw />
      <h2 id="home-free-heading">Free for everyone. No ads.</h2>
      <p>
        There's no paid plan and nothing to buy. Baantwise is open source, so anyone can see exactly how it works.
      </p>
      <div className="home-band-actions">
        <a href="#signin" className="button">
          Sign in with Google
        </a>
        <a href="https://github.com/jayptl-dev/BaantWise" className="band-link">
          See the code on GitHub
        </a>
      </div>
    </section>
  );
}

export function HomeQuestions() {
  return (
    <section id="faq" className="home-faq reveal" aria-labelledby="home-faq-heading">
      <h2 id="home-faq-heading">Questions people ask</h2>
      <Squiggle className="feature-rule" draw />
      <details>
        <summary>Is Baantwise really free?</summary>
        <p>Yes. There are no ads and no paid plan.</p>
      </details>
      <details>
        <summary>Do I need to give bank or card details?</summary>
        <p>
          No. Baantwise never asks for them, and it never holds or moves money. You pay each other the way you already
          do, such as Interac e-Transfer, and then mark it as paid.
        </p>
      </details>
      <details>
        <summary>Does everyone in my group need an account?</summary>
        <p>
          No. You can add someone as a guest, which is just their name. People who want to add expenses themselves sign
          in with Google.
        </p>
      </details>
      <details>
        <summary>Is there an app for my phone?</summary>
        <p>
          Baantwise works in your phone's browser, and you can put it on your home screen like an app. On Android, open
          Chrome's menu and choose Install app. On iPhone, open it in Safari, tap Share, then Add to Home Screen.
        </p>
      </details>
      <details>
        <summary>Who can see what I add?</summary>
        <p>
          Only the people in that group. Expenses you mark as private are seen only by the people in them. The{" "}
          <Link to="/privacy">privacy policy</Link> has the details.
        </p>
      </details>
      <details>
        <summary>What does the name mean?</summary>
        <p>
          It blends the Hindi word <em lang="hi-Latn">baant</em>{" "}
          <span className="name-hindi" lang="hi">
            बाँट
          </span>
          , meaning "to divide or share out", with "-wise".
        </p>
      </details>
    </section>
  );
}
