# Baantwise

Baantwise is a free web app for splitting bills fairly between friends, roommates and groups. It is being built for users in Canada, so amounts will show in Canadian dollars (CAD) by default. Baantwise only keeps track of who owes what. It never holds or moves real money.

The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

**Status:** private beta. You can sign in with Google, make groups, invite people, add expenses, see who owes whom and record payments.

Live site: https://baantwise.com

## What it's built with

- **React:** the library that draws the page
- **Vite:** the tool that runs the app on your computer and bundles it for the web
- **TypeScript:** JavaScript with type checks that catch mistakes early
- **React Router:** shows the right screen for each web address (like `/groups/…`)
- **Cloudflare Workers:** hosts the site (free plan)
- **Supabase:** handles "Sign in with Google" and stores the data (free plan)

## Run it on your computer

You need [Node.js](https://nodejs.org/) (which includes npm) and [Git](https://git-scm.com/).

1. Download the code:

   ```bash
   git clone https://github.com/jayptl-dev/BaantWise.git
   cd BaantWise
   ```

2. Install the packages the app needs (only the first time, or after `package.json` changes):

   ```bash
   npm install
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser. The page updates as soon as you save a file. Press `Ctrl + C` in the terminal to stop it.

To check that the production build works, run `npm run build`. It creates a `dist` folder with the finished site.

To run the automated tests, run `npm test`. They use [Vitest](https://vitest.dev/) and live next to the code they check, in files ending in `.test.ts` (for example `src/lib/money.test.ts` checks how typed amounts become cents).

## How it deploys

Cloudflare Workers is connected to this GitHub repository. When a change lands on the `main` branch, Cloudflare:

1. downloads the code
2. runs `npm run build` to create the `dist` folder
3. runs `npx wrangler deploy` to publish it to baantwise.com

The settings for this live in `wrangler.jsonc`. The Worker is named `baantwise`; its code (`src/worker/index.ts`) only handles `/api/*`. Its `not_found_handling` is set to `single-page-application`, so any address on the site (like `/groups/123`) loads the app and React decides what to show.

## How sign-in works

1. On a signed-out screen (the landing page, an invite link, or a group page opened while signed out), the app loads Google's sign-in script (Google Identity Services) and draws Google's own **Sign in with Google** button. Signed-in screens never load it. The button matches the light or dark look of the device.
2. The app makes a random one-time value called a nonce. Google gets its SHA-256 hash, the app keeps the raw value.
3. Someone presses the button. Google's box opens on top of the page and says it's for **baantwise.com**. In Chrome this is the browser's own sign-in box (FedCM, which Google recommends); other browsers show Google's pop-up. There's no One Tap and no automatic sign-in: nothing happens until the button is pressed.
4. Google hands the page an ID token (a signed note saying who the person is, with the nonce hash inside). The app sends the token and the raw nonce to Supabase (`signInWithIdToken`). Supabase checks the token came from Google for our client ID and that the nonce matches, then starts a session.
5. The person stays on the same page. An invite link goes straight on to **Join group**.
6. The session is saved in the browser, so it survives a page reload. **Sign out** removes it.
7. If sign-in fails, a short friendly line explains why.

**Fallback:** if Google's script is blocked (for example by an ad blocker) or hasn't loaded after 8 seconds, a small **Sign in another way** link appears. It uses the older redirect sign-in: Supabase sends the person to Google's sign-in page and back to the same page with a one-time code. That page names our Supabase address instead of baantwise.com, which is why it's only the fallback.

The code lives in `src/config.ts` (Supabase address, publishable key and Google client ID), `src/lib/supabase.ts` (the shared Supabase client), `src/lib/googleSignIn.ts` (loads Google's script, makes the nonce), `src/lib/auth.tsx` (who is signed in, sign-in and sign-out) and `src/components/SignIn.tsx` (the button, the fallback link and messages).

The settings live in dashboards, not in this repo:

- **Google Cloud → Google Auth Platform → Clients:** the OAuth client's **Authorized JavaScript origins** must include `https://baantwise.com` and `https://www.baantwise.com` (for the button). Its **Authorized redirect URIs** must include `https://yvdbqqblbfodeqkwzvem.supabase.co/auth/v1/callback` (for the fallback). While the app is in "Testing" mode, only Google accounts listed as test users can sign in.
- **Supabase → Authentication → Google:** turned on, with the same client ID. Leave "Skip nonce check" off. Site URL is `https://baantwise.com`. Allowed redirect URLs are `https://baantwise.com/**` and `https://www.baantwise.com/**`.

The Supabase **publishable** key and the Google client ID in `src/config.ts` are meant to be public. The **secret** / `service_role` key must never go in this repo.

**Trying sign-in on your computer:** Google's button only works on `http://localhost:5173` if both `http://localhost` and `http://localhost:5173` are added to the client's Authorized JavaScript origins. (`npm run dev` already sends the `Referrer-Policy` header Google asks for on localhost.) The fallback only comes back to your computer if `http://localhost:5173/**` is in Supabase's allowed redirect URLs; without it, Supabase sends you to baantwise.com instead.

## Groups and invites

| Address | What it shows |
| --- | --- |
| `/` | Signed out: the landing page. Signed in: **Your groups**, newest first, with a **New group** button. |
| `/groups/<id>` | One group: its people (with "You", "Admin" and "Guest" badges), invite buttons, **Add a guest**, and its expenses (see below). |
| `/groups/<id>/settings` | Rename the group, reset the invite link or delete the group (admins), and **Leave group** (everyone). |
| `/join/<token>` | An invite link. After signing in, it shows the group's name and size and a **Join group** button. |

- **Making a group:** the person who makes it becomes its first admin.
- **Inviting:** on a phone or tablet, **Share invite link** opens the device's own share menu. On a computer (or if the share menu fails) it opens a small pop-up with WhatsApp, Messages (phones only), Email and **Copy link**, plus the link itself. The message is always: Join "<group name>" on Baantwise: <link>. Anyone with the link can join after signing in with Google. While Baantwise is in private beta, they also need to be on the Google test user list.
- **Live updates:** an open group page or settings page updates by itself when someone joins, leaves or is removed, becomes or stops being an admin, is renamed, or the group is renamed or deleted. This uses Supabase Realtime, and the privacy rules decide who gets each update. Every screen also catches up when you come back to the app or your internet comes back. If a group you have open is deleted, or you're no longer in it, the page says "This group isn't available any more".
- **Guests** are just a name, for someone who won't sign in. Anyone in the group can add a guest or rename one.
- **Renaming people:** you can rename yourself and guests. Admins can rename anyone.
- **Admins** can make other members admins, remove people, rename the group, reset the invite link and delete the group. A group always keeps at least one admin, so the last admin has to hand over admin (or delete the group) before leaving.
- **Removing someone** takes away their access straight away and resets the invite link, so an old link can't be used to come back. Their name stays on anything they were part of.

The screens hide buttons people aren't allowed to use, but that's only for convenience. The real rules live in the database (see below), so they hold even if someone skips the screens.

The screens are in `src/pages`, shared pieces in `src/components`, and data helpers in `src/lib`.

## Expenses

| Address | What it shows |
| --- | --- |
| `/groups/<id>` | The group's expenses and payments, newest first, with an **Add expense** button. |
| `/groups/<id>/expenses/new` | Add an expense. |
| `/groups/<id>/expenses/<expense id>` | One expense: amount, who paid, the date, each person's share and who can see it. |
| `/groups/<id>/expenses/<expense id>/edit` | Change an expense (only the person who added it). |

- **The list** shows what each expense was for, who paid and how much, and on the right what it means for you: "you lent $X" (you paid; X is the amount minus your own share), "you owe $X" (your share), or "not involved".
- **Adding:** what it was for (1 to 120 characters), the amount in CA$, who paid (anyone in the group, guests included; you by default), the date (today by default) and how to split it. **Equally** splits between the people you tick and shows each share as you type. Cents that don't divide evenly go one each, starting with the payer: $10.00 three ways paid by Jay is Jay $3.34, the others $3.33. **Exact amounts** takes one amount per person and shows "$X left to assign" until they add up exactly. Leave a box empty if that person isn't in the split. The amounts can never go over the total, not even by a cent: a key that would push them over is ignored, and so is a `+` when nothing is left to assign. Lowering an amount always works. A short grey note under the box says why a key was ignored (for example "Only $2.00 is left to assign"), and the boxes wait until the total is entered. The only way to end up over is to make the total smaller afterwards; the form then says so, and you lower an amount to fix it. A box can also add and take away, like `115.22+64.88` or `20-4.50`: the answer shows next to it, and replaces the sum when you leave the box.
- **Amount boxes only take money:** digits and one decimal point with at most 2 decimals (a comma counts as the decimal point, for French keyboards). Any other key is ignored. An unfinished amount like `3.` counts as $3.00.
- **Problems show under the box they're about** and update as you type. A wrong value (like a sum below $0.00) shows straight away; missing things (like an empty description) show after you press Save, which also jumps to the first problem.
- **Who can see it:** "Everyone in <group>", or "Only <names>": the payer, the people splitting it and whoever added it. Nobody else sees a private expense, not even admins. An expense that only involves you is always "Only you". Changing a private expense to "Everyone" asks first.
- **Editing and deleting:** only the person who added an expense can change or delete it. Everyone else sees who that is.
- **Deleting** marks the expense as deleted instead of erasing it, and the app hides it for everyone. Supabase Realtime applies the privacy rules to new and changed rows but not to erased ones, so erasing a private expense would tell every connected person about it. A row marked deleted keeps its privacy rules.
- **Live updates:** an open group page updates by itself when an expense is added, changed or deleted. An open expense (or its edit page) updates too, and says "This expense was deleted" if it is.
- **Money** is whole cents everywhere. What you type is turned into cents with string maths (never decimal numbers), so "12.50" becomes `1250` exactly. Amounts are shown in Canadian dollars, like $12.50.

The code is in `src/pages/AddExpense.tsx`, `EditExpense.tsx` and `ExpenseDetails.tsx`, the form in `src/components/ExpenseForm.tsx`, and the helpers in `src/lib/expenses.ts` and `src/lib/money.ts`.

## Categories

Every expense has one category from a fixed list: 🍔 Food, 🛒 Groceries, 🚕 Transport, 🏠 Housing, 💡 Utilities, 🎬 Entertainment, ✈️ Travel, 🛍️ Shopping, 🏥 Health and 📌 Other. Other is the default, and every expense added before categories existed is Other.

- **Picking one:** on the Add and Edit expense screens, the square button at the end of the **What for?** box shows the category's emoji, and a small line under the box says "Category: <name>". Tap the button to open the picker: it comes up from the bottom of the screen on a phone, and as a small box under the button on a wider screen. The current category is highlighted. Tap one to pick it; tap outside or press Escape to close without changing anything. Edit starts on the saved category.
- **A suggestion while you type:** on a new expense, until you pick a category yourself, the button follows the description as you type:
  1. **This group's history first:** if the group already has an expense with the same description, it uses the category of the most recent one (unless that one is Other). So once "Costco run" is saved as Shopping, the next "costco run" is Shopping too.
  2. **Otherwise keywords:** words and short phrases like "rent" (Housing), "water heater" (Utilities), "Uber Eats" (Food) or "épicerie" (Groceries). The longest match wins, so "Uber home" is Transport but "Uber Eats" is Food, and "gas" is Transport but "gas bill" is Utilities. For matches of the same length, the first one in the description wins. "Pizzas" finds "pizza" too.
  3. **Otherwise Other.**

  Descriptions are compared ignoring capitals, accents, apostrophes and punctuation, so "Tim Horton's" matches "tim hortons". Your own pick always wins, and editing an expense never changes its category by itself. Words that could mean two things (like "metro", "ticket", "phone" or "bill" on their own) are left out on purpose.
- **Adding keywords:** they're plain lists in `CATEGORY_KEYWORDS` in `src/lib/categories.ts`, one list per category, including Canadian store names and French words. Add a word to the right list; the tests check that no word is in two categories.
- **Where you see it:** each expense in a group's list starts with its emoji ("🍔 Lunch at Monza"), and an expense's page shows the emoji and name ("🍔 Food").
- **What's next:** spending charts and receipt scanning will use these categories.
- **The rules live in the database:** `expenses.category` only accepts the ten keys (`food`, `groceries`, `transport`, `housing`, `utilities`, `entertainment`, `travel`, `shopping`, `health`, `other`). `save_expense` takes it as `p_category`.

The list (keys, names and emoji), the keywords and the suggestion rules are in `src/lib/categories.ts`, with tests in `src/lib/categories.test.ts`. Charts and receipt scanning will reuse that file. The button and picker are in `src/components/CategoryPicker.tsx`. The Add expense screen loads the group's expenses (the same ones the group page shows) so it can suggest from them.

## Receipt photos

Each expense can have one receipt photo. It follows the expense's own privacy: if you can see the expense, you can see its photo, and nobody else can.

- **Adding:** on the Add or Edit expense screen, under the split, **Add receipt photo** opens the phone's camera or gallery. Only whoever added the expense gets this, and after that, **Replace photo** and **Remove photo**. Anything that isn't a picture (like a PDF) is refused with a plain message.
- **Shrunk on the phone first** (`src/lib/shrinkPhoto.ts`, which receipt scanning will reuse): the photo is drawn onto a canvas, turned upright if the camera saved it sideways, with its longest side at most 2000px. It's saved as a JPEG at quality 0.8, then 0.7, 0.6 and 0.5 until it's 500 KB or less; if it's still over 900 KB, it's done again at 1600px. Nothing over 1 MB is ever uploaded. Re-drawing it also removes the photo's hidden EXIF data, including where it was taken.
- **Saving:** the expense is saved first. Then the photo goes to the private Storage bucket `receipts` as `<expense id>/<random id>.jpg`, and `set_expense_receipt` links it to the expense (`expenses.receipt_path`). If the photo part fails, the expense stays saved and its page says "Your expense was saved, but the receipt photo didn't upload." You can add up to 50 receipt photos a day. Replacing a photo uploads the new one, then removes the old files. Removing one unlinks it, then removes its files. Deleting an expense removes its photos too.
- **Seeing it:** the expense list and search results show a small receipt icon next to expenses with a photo. The expense's page shows a thumbnail; tap it for full screen, and tap again (or **Close**) to go back. The photo is opened with a link that works for 10 minutes and is never saved.
- **Live updates:** when a photo is added, replaced or removed, open pages update by themselves.
- **The rules live in the database** (Storage policies): other people can only open the one photo an expense points to. Replaced or unlinked files are only visible to whoever added the expense. Uploads need a live expense you added.

The code is in `src/lib/shrinkPhoto.ts` (with tests in `shrinkPhoto.test.ts`), `src/lib/receipts.ts` (upload, link, remove, viewing links) and `src/components/ReceiptPhoto.tsx` (icon, thumbnail, full-screen view).

## Receipt scanning

On **Add expense**, **Scan receipt** reads a photo of a receipt and fills in what it can: what for (the shop), the date, the category and the amount. Everything stays editable, and the photo becomes the expense's receipt photo once it's saved. If the receipt is in another currency, the amount is left empty for you to type in CAD.

**Split by item** (shown when the scan found items) lets you tick who had each item. Tax, tip and anything else not on an item is shared in proportion. "Use this split" fills in **Exact amounts**. The items are never saved.

How it works:
- The photo is shrunk in the browser (`shrinkPhoto.ts`, the same as receipt photos), then sent to our Supabase Edge Function `scan-receipt` (`supabase/functions/scan-receipt/index.ts`), which asks Google Gemini to read it. The function checks and cleans every value and stores nothing: not the photo, not the text.
- Each person gets 100 scans a month (Toronto time), counted by the database function `claim_receipt_scan` (only the count is kept).
- The leftover-cent rule for every automatic split lives in `src/lib/split.ts` (tested in `split.test.ts`); Equally uses it too.

Secrets (Supabase → Edge Functions → Secrets, never in this repo):
- `GEMINI_API_KEY`: from Google AI Studio. Without it, everyone sees "Receipt scanning is coming soon".
- `SCAN_ALLOWED_USER_IDS`: the user ids allowed to scan while Gemini is on the free tier (comma-separated).
- `SCAN_OPEN_TO_ALL`: set to `true` only after Gemini billing is on, to let everyone scan.
- `GEMINI_MODEL` (optional): defaults to `gemini-3.1-flash-lite`.

## Split by percent, by shares, and a default split

The Add/Edit expense screen has four ways to split: **Equally**, **Exact** (type each person's amount), **Percent** (must add up to exactly 100%) and **Shares** (whole numbers from 1 to 1000; someone with 2 shares pays twice as much as someone with 1).

- Percent and shares are turned into whole cents in the app with the same leftover-cent rule as everything else (`src/lib/split.ts`), then saved through `save_expense` as usual.
- The expense remembers how it was split (`split_method`) and, for percent and shares, the numbers that were typed (`split_snapshot`), so **Edit** reopens the same way. The app sends `p_split` on every save.
- **Default split** (Group settings, admins only): pre-fills new expenses By percent or By shares. If someone joins or leaves afterwards, both Group settings and Add expense say "Default split needs updating"; it keeps working for the people it covers. The database checks the shape and only lets admins change it.

The maths and the reading of boxes live in `src/lib/splitMethods.ts` (tested in `splitMethods.test.ts`).

## Other currencies

An expense paid in another currency ("Dinner US$84.50") is turned into Canadian dollars at the Bank of Canada's daily rate, and the CAD amount is what's split. Balances, charts and settling up stay in CAD.

- On Add/Edit expense, the currency menu next to **Amount** lists 24 currencies (the ones the Bank of Canada publishes). Under the amount it shows "= CA$115.53 at 1.3672 (Bank of Canada, Oct 9)". **Change rate** lets you type the rate your card or a booth gave you ("own rate").
- The rate is the latest one published on or before the expense's date (rates come out on business days, so a Saturday gets Friday's).
- **Exact** amounts on a foreign expense are typed in that currency, then turned into CAD shares in proportion.
- The expense keeps what was really paid (`original_currency`, `original_amount_cents`, `fx_rate`, `fx_rate_date`), and the database checks that the CAD amount is the original times the rate, rounded to the nearest cent. Editing it back to CA$ clears those.
- A scanned receipt in one of the 24 currencies picks that currency and fills in its amount.

Rates come from our own site: `GET /api/fx-rates?date=YYYY-MM-DD` (the Worker in `src/worker/`, tested in `fxRates.test.ts`). Only `/api/*` runs the Worker (`run_worker_first` in `wrangler.jsonc`); every other address is the React app. Answers are cached by Cloudflare for 30 days once a date is settled, or 30 minutes for recent dates. The maths is in `src/lib/currency.ts`.

## Balances and settling up

Baantwise never moves money. It only works out who owes whom and writes down payments people say they made.

| Address | What it shows |
| --- | --- |
| `/groups/<id>` | **Balances** at the top: Overall, In the group, and one box per private balance. |
| `/profile` | Your name and optional payment details. Open it by tapping your photo in the header. |

- **Two kinds of balance, never mixed.** *In the group* uses only items everyone can see, so everyone gets the same list. Each person's net is what they paid, minus their own shares, plus payments they sent, minus payments they received. That's turned into as few payments as possible: whoever owes the most pays whoever is owed the most, then repeat. *Just between you and <name>* (with a lock) uses only private items between you and that one person: private expenses where one of you paid and the other has a share, and private payments between you two. Private items never change the group list, and different people's private balances are never combined.
- **Overall** adds your part of the group list to all your private balances: "You're owed $X", "You owe $X" or "You're all settled up".
- **Pay** (you owe) opens a box with the amount (the full debt, which you can lower to pay part of it, but never raise). If they added an Interac e-Transfer email or phone, it shows that and the amount, each with a **Copy** button. If they added a PayPal.Me username, **Pay with PayPal** opens `paypal.me/<name>/<amount>CAD` in a new tab. **Mark as paid** records the payment. **Received** (you're owed) records a payment to you the same way. A debt between two guests gets **Record payment**, for anyone to use. A payment for a private balance is private too.
- **Payments show in the list** by date ("Sam paid Jay $30.00", with a lock if private). Tap one for details. Whoever recorded it can **Undo** it: it's marked deleted (never erased) and the balances go back.
- **Your profile:** your name (saving also changes it in all your groups), an Interac e-Transfer email or 10-digit phone, and a PayPal.Me username (letters and numbers, up to 20; a pasted paypal.me link is trimmed to just the name). Only people in your groups can see these, and both are optional.
- **Live updates:** an open group page updates its balances by itself when anyone adds, changes or deletes an expense, or records or undoes a payment.
- **All in whole cents.** The maths is in `src/lib/balances.ts`, with tests in `src/lib/balances.test.ts`. The screens are `src/components/BalancesSection.tsx`, `SettleUpDialog.tsx` (the pay box) and `PaymentDialog.tsx`, plus `src/pages/Profile.tsx`.

## Spending

Two screens show where money goes, by category and by month. There's no chart library: each bar is a plain list item with its amount written next to it, so screen readers and big text sizes work.

- **Spending** (the bar-chart button on a group page, `/groups/:id/spending`): the group's shared spending. Only expenses the whole group can see count, so everyone sees the same numbers. Private expenses never show here.
- **My spending** (the bar-chart button on Your groups, `/spending`): your own share of every expense in all your groups, private ones included. Only you see it.

Both have a switch (This month, Last month, This year, All time) for the category bars, and a fixed "Last 12 months" chart. Tapping a category lists its expenses for that period; on My spending each row shows your share and the group. Deleted expenses never count.

The maths is in `src/lib/spending.ts` (tested in `spending.test.ts`) and the bars in `src/components/SpendingCharts.tsx`. The group screen reuses the expenses the group page already loads (with live updates), so it needs no extra query.

## Expense search

| Address | What it shows |
| --- | --- |
| `/search` | Search the expenses in all your groups. Open it with the magnifying glass next to **Your groups**. |
| `/groups/<id>/search` | Search one group's expenses. Open it with the magnifying glass on the group page. |

- **Type part of a word** and matching expenses show up (the search looks inside what each expense was for, ignoring capital letters). It waits until you stop typing for 0.3 seconds, so it doesn't search on every key. `%`, `_` and `\` match themselves; `*` is ignored.
- **Filters:** **Group** (all-groups search only, "All groups" by default), a **From** and **To** date (leave either empty for no limit) and **Only ones I'm in** (off by default: keeps only expenses you paid or have a share above $0 in).
- **Each result** shows the date, the group (all-groups search only), what it was for (the first 50 characters; tap for the rest), the amount, what it means for you ("you lent $X", "you owe $X" or "not involved", like the group page), and a lock if it's private. Tap a result to open the expense.
- **Newest first**, 50 at a time, with a **Show more** button.
- **Nothing found:** "No results for '<text>'". A group with no expenses says "No expenses yet".
- **Privacy:** the search asks the database directly, so the privacy rules decide what comes back: only groups you're still in, and a private expense only for the people in it. Deleted expenses never show.
- The search stays in the address, so going back from an expense shows the same results.

The screen is `src/pages/SearchExpenses.tsx`, and the query is in `src/lib/search.ts`, with tests in `src/lib/search.test.ts`.

## Database

The data lives in a Supabase (Postgres) database. It has six tables:

- **profiles:** one row per person who signs in, with their name, Google photo and optional payment details (Interac e-Transfer email or phone, PayPal.Me username). Only people who share a group with you can see your profile. Sign-in email addresses are not stored here, so group members can't see each other's sign-in email.
- **groups:** a group such as "Cabin trip", with its currency (CAD by default) and its secret invite link.
- **group_members:** who is in each group. A member is either someone with an account, or a guest who is just a name. People who leave or are removed lose access, but their name stays on old expenses.
- **expenses:** what was bought, who paid, how much, when, its category, and who can see it.
- **expense_shares:** each person's part of an expense. The parts must add up exactly to the total.
- **settlements:** records like "Priya paid Jay $20". Baantwise only records these. It never moves real money. Undoing one marks it deleted instead of erasing it, like expenses.

Money is stored in whole cents, so $12.34 is saved as `1234`. This avoids rounding mistakes.

**The privacy rules live in the database itself** (Postgres "Row Level Security"). On every request, the database checks who is asking and returns only what they're allowed to see. For example, you only see groups you're in, and a private expense is visible only to the people involved in it. The app's screens are never the only protection.

The SQL that created all this is saved in `supabase/migrations`, one file per change, in the order it was applied. Those files are a record of what's already in the database, so they're never edited afterwards: each new change gets a new file. `src/lib/database.types.ts` describes the tables to TypeScript, so a misspelled table or column name shows up as an error when you build.

## Secrets

Never put passwords or API keys in this repository. They go in the Cloudflare and Supabase dashboards. Files like `.env` and `.dev.vars` are ignored by Git so they can't be committed by accident.
