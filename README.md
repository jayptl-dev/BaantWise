# Baantwise

Baantwise is a free web app for splitting bills fairly between friends, roommates and groups. It is being built for users in Canada, so amounts will show in Canadian dollars (CAD) by default. Baantwise only keeps track of who owes what. It never holds or moves real money.

The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

**Status:** private beta. You can sign in with Google, make groups, invite people and add expenses. Balances and settling up come next.

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

## How it deploys

Cloudflare Workers is connected to this GitHub repository. When a change lands on the `main` branch, Cloudflare:

1. downloads the code
2. runs `npm run build` to create the `dist` folder
3. runs `npx wrangler deploy` to publish it to baantwise.com

The settings for this live in `wrangler.jsonc`. The Worker is named `baantwise`. Its `not_found_handling` is set to `single-page-application`, so any address on the site (like `/groups/123`) loads the app and React decides what to show.

## How sign-in works

1. Someone clicks **Sign in with Google**. The app asks Supabase to start a Google sign-in and says where to come back to afterwards: the same page they started on (so an invite link still works after signing in).
2. Supabase sends them to Google. Google shows its sign-in screen, then sends them back to Supabase.
3. Supabase sends them back to Baantwise with a one-time code. The app swaps that code for a session and shows "Signed in as …" with their Google name and photo.
4. The session is saved in the browser, so it survives a page reload. **Sign out** removes it.
5. If sign-in fails or is cancelled, the home page shows a short message instead.

The code lives in `src/config.ts` (Supabase address and publishable key), `src/lib/supabase.ts` (the shared Supabase client), `src/lib/auth.tsx` (who is signed in, sign-in and sign-out) and `src/components/SignIn.tsx` (the sign-in button and messages).

The settings live in dashboards, not in this repo:

- **Supabase → Authentication:** Google provider turned on. Site URL is `https://baantwise.com`. Allowed redirect URLs are `https://baantwise.com/**` and `https://www.baantwise.com/**`.
- **Google Cloud → Google Auth Platform:** the OAuth client's "Authorized redirect URIs" must include `https://yvdbqqblbfodeqkwzvem.supabase.co/auth/v1/callback`. While the app is in "Testing" mode, only Google accounts listed as test users can sign in.

The Supabase **publishable** key in `src/config.ts` is meant to be public. The **secret** / `service_role` key must never go in this repo.

Sign-in from `http://localhost:5173` won't come back to your computer unless `http://localhost:5173/**` is added to Supabase's allowed redirect URLs. Without it, Supabase sends you to baantwise.com instead.

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
| `/groups/<id>` | The group's expenses, newest first, with an **Add expense** button. |
| `/groups/<id>/expenses/new` | Add an expense. |
| `/groups/<id>/expenses/<expense id>` | One expense: amount, who paid, the date, each person's share and who can see it. |
| `/groups/<id>/expenses/<expense id>/edit` | Change an expense (only the person who added it). |

- **The list** shows what each expense was for, who paid and how much, and on the right what it means for you: "you lent $X" (you paid; X is the amount minus your own share), "you owe $X" (your share), or "not involved".
- **Adding:** what it was for (1 to 120 characters), the amount in CA$, who paid (anyone in the group, guests included; you by default), the date (today by default) and how to split it. **Equally** splits between the people you tick and shows each share as you type. Cents that don't divide evenly go one each, starting with the payer: $10.00 three ways paid by Jay is Jay $3.34, the others $3.33. **Exact amounts** takes one amount per person and shows "$X left to assign" until they add up exactly.
- **Who can see it:** "Everyone in <group>", or "Only <names>": the payer, the people splitting it and whoever added it. Nobody else sees a private expense, not even admins. An expense that only involves you is always "Only you". Changing a private expense to "Everyone" asks first.
- **Editing and deleting:** only the person who added an expense can change or delete it. Everyone else sees who that is.
- **Deleting** marks the expense as deleted instead of erasing it, and the app hides it for everyone. Supabase Realtime applies the privacy rules to new and changed rows but not to erased ones, so erasing a private expense would tell every connected person about it. A row marked deleted keeps its privacy rules.
- **Live updates:** an open group page updates by itself when an expense is added, changed or deleted. An open expense (or its edit page) updates too, and says "This expense was deleted" if it is.
- **Money** is whole cents everywhere. What you type is turned into cents with string maths (never decimal numbers), so "12.50" becomes `1250` exactly. Amounts are shown in Canadian dollars, like $12.50.

The code is in `src/pages/AddExpense.tsx`, `EditExpense.tsx` and `ExpenseDetails.tsx`, the form in `src/components/ExpenseForm.tsx`, and the helpers in `src/lib/expenses.ts` and `src/lib/money.ts`.

## Database

The data lives in a Supabase (Postgres) database. It has six tables:

- **profiles:** one row per person who signs in, with their name and Google photo. Email addresses are not stored here, so group members can't see each other's email.
- **groups:** a group such as "Cabin trip", with its currency (CAD by default) and its secret invite link.
- **group_members:** who is in each group. A member is either someone with an account, or a guest who is just a name. People who leave or are removed lose access, but their name stays on old expenses.
- **expenses:** what was bought, who paid, how much, when, and who can see it.
- **expense_shares:** each person's part of an expense. The parts must add up exactly to the total.
- **settlements:** records like "Priya paid Jay $20". Baantwise only records these. It never moves real money.

Money is stored in whole cents, so $12.34 is saved as `1234`. This avoids rounding mistakes.

**The privacy rules live in the database itself** (Postgres "Row Level Security"). On every request, the database checks who is asking and returns only what they're allowed to see. For example, you only see groups you're in, and a private expense is visible only to the people involved in it. The app's screens are never the only protection.

The SQL that created all this is saved in `supabase/migrations`, one file per change, in the order it was applied. Those files are a record of what's already in the database, so they're never edited afterwards: each new change gets a new file. `src/lib/database.types.ts` describes the tables to TypeScript, so a misspelled table or column name shows up as an error when you build.

## Secrets

Never put passwords or API keys in this repository. They go in the Cloudflare and Supabase dashboards. Files like `.env` and `.dev.vars` are ignored by Git so they can't be committed by accident.
