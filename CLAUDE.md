# Baantwise: project rules

Baantwise is a free bill-splitting web app. The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

## Working with Jay

- The owner, Jay, is learning. Explain changes in plain language and work in small steps.
- Budget is $0. Use free plans only unless Jay approves a cost.

## How to report back

End every task with a short message, no more than 8 lines:
- Status: done, or blocked and why
- What changed: 3–5 short bullets in plain words
- What Jay needs to do: for example "Create PR, then Merge", or "Nothing"
- Test on your phone: 2–4 quick checks, only if something visible changed
Put the full explanation in the commit message and the pull request description, not in the chat. Don't paste code, diffs or command output into the chat unless Jay asks.

## Secrets

- Never commit secrets or API keys. They go in the Cloudflare and Supabase dashboards.
- Local-only secret files (`.env*`, `.dev.vars`) are listed in `.gitignore` and must stay that way.

## Stack

- Now: React + Vite + TypeScript, served as static assets on Cloudflare Workers (Cloudflare Vite plugin, `wrangler.jsonc`, npm). A small Worker (`src/worker/index.ts`) runs only for `/api/*`: `/api/fx-rates` (Bank of Canada rates). It also has an `email` handler (`src/worker/email.ts`): Cloudflare Email Routing sends `bills@mail.baantwise.com` (subaddressing on, so `bills+<group token>@…`) to it, and it posts the raw email to the receive-bill-email Edge Function with the shared secret `INBOUND_EMAIL_SECRET` (a Worker secret set in the Cloudflare dashboard).
- Now: Supabase Auth with Google sign-in (`@supabase/supabase-js`, one shared client in `src/lib/supabase.ts`, public URL and publishable key in `src/config.ts`).
- Now: Supabase database. Migrations are copied into `supabase/migrations`; generated types are in `src/lib/database.types.ts` and the client is typed with `createClient<Database>`.
- Now: React Router (`react-router`, routes in `src/App.tsx`): `/`, `/groups/:id`, `/groups/:id/settings`, `/groups/:id/expenses/new`, `/groups/:id/expenses/:expenseId`, `/groups/:id/expenses/:expenseId/edit`, `/groups/:id/search`, `/search`, `/groups/:id/spending`, `/spending`, `/groups/:id/recurring`, `/groups/:id/recurring/new`, `/groups/:id/recurring/:ruleId/edit`, `/groups/:id/bills`, `/join/:token`, `/profile`, `/privacy` (public). Screens live in `src/pages`, shared UI in `src/components`, data and sign-in helpers in `src/lib` (`auth.tsx` for who is signed in, `errors.ts` for friendly error lines, `money.ts` for cents (`readMoney` is the one place that reads an amount box), `categories.ts` for the expense categories (keys, labels, emoji, the keyword lists and suggestions; charts and receipt scanning reuse it), `expenses.ts` for loading expenses, `payments.ts` for loading payments, `balances.ts` for who owes whom, `payDetails.ts` for Interac and PayPal.Me details, `search.ts` for expense search, `spending.ts` for the spending charts, `receipts.ts` for receipt photos in Storage, `receiptScan.ts` for calling the scan-receipt Edge Function, `split.ts` for the one leftover-cent rule every automatic split uses, `splitMethods.ts` for Percent/Shares and the group default split, `currency.ts` and `useForeignAmount.ts` for foreign expenses, `recurring.ts` for recurring expenses and bills to fill in, `reminders.ts` for asking the send-reminder Edge Function to email a reminder, `forwarding.ts` for the group's bill address and forwarded bills to review, `shrinkPhoto.ts` for shrinking photos in the browser before upload).
- Planned later:
  - Supabase (Canada Central region) for the database, Google sign-in, storage, edge functions and scheduled jobs
  - Resend for email (in use for reminders: domain mail.baantwise.com, secret RESEND_API_KEY)
  - Gemini Flash-Lite for reading receipts

## Product rules

- Privacy rules are enforced in the database with Row Level Security, never only in the screens.
- Users are in Canada. Show amounts in CAD by default.
- The app never holds or moves real money.

## Database

- Money is stored as whole cents (bigint). $10 split 3 ways = 334 + 333 + 333. Never use floats for money.
- Every table has Row Level Security. Privacy is enforced in the database; screens must never be the only protection.
- Expense visibility: `'group'` = every member sees it; `'participants'` = only the payer, the people splitting it, and whoever added it. Settlements work the same way (payer, receiver, whoever recorded it).
- Only the person who added an expense or payment can edit or delete it, including who can see it.
- Admins (the creator first; admins can make other members admins) can rename the group, remove members, reset the invite link and delete the group. Admins never see other people's private expenses.
- Balances are computed in the app from what the signed-in person can see, one scope at a time: group-visible items together, private items only between the people in them. Never simplify debts across scopes.
- Use the database functions for multi-step actions: `create_group`, `get_invite`, `join_group`, `reset_invite_link`, `set_member_admin`, `remove_member`, `leave_group`, `save_expense` (adds or edits an expense, its category and its split in one go; the split must add up to the total; always send `p_visibility`, `p_category` and `p_split`; for a foreign expense also `p_original_currency`, `p_original_amount_cents`, `p_fx_rate` and, for a Bank of Canada rate, `p_fx_rate_date` (leaving them out makes it CAD)), `delete_expense` (sets `expenses.deleted_at`; expense rows are never erased, so always filter `deleted_at is null`), `delete_settlement` (undoes a payment by setting `settlements.deleted_at`; only whoever recorded it; always filter `deleted_at is null`) and `set_expense_receipt` (links or, with null, clears `expenses.receipt_path`; only whoever added the expense), `save_recurring` (adds or edits a recurring expense rule), `complete_recurring_bill` and `skip_recurring_bill`, `reset_forward_address` (admins: new bill address) and `resolve_forwarded_bill` (add a forwarded bill as the expense just saved, or dismiss it with null). Recurring expenses are made by `private.run_recurring()` (pg_cron, hourly); its `private.split_cents` must keep matching `src/lib/split.ts`. `src/lib/balances.ts` has no imports because `supabase/functions/send-reminder/balances.ts` must be an exact copy of it (a test checks); after changing it, copy it over and redeploy send-reminder. Reading data, adding a guest (insert into `group_members` with `group_id` and `display_name`), recording a payment (insert into `settlements`) and saving your profile use normal table queries.
- Database changes: Claude can't apply them to the live project itself, so it writes the migration file here in `supabase/migrations` and gives Jay a paste-in copy (wrapped in begin/commit, and recording the migration in `supabase_migrations.schema_migrations`) to run in the Supabase SQL Editor; Claude then checks it worked. Never edit a migration that has already been applied.
- Receipt photos: private Storage bucket `receipts` (JPEG only, 1 MB limit), one per expense at `<expense id>/<uuid>.jpg`. Upload after `save_expense`, then `set_expense_receipt`; after replacing, removing or deleting, remove the folder's other files. Show them with short-lived signed URLs that are never stored.
- Live updates use Supabase Realtime `postgres_changes` on tables in the `supabase_realtime` publication (now `groups`, `group_members`, `expenses` and `settlements`; `expense_shares` deliberately isn't, so reload the shares on any expense event). The privacy rules filter inserts and updates but not deletes: delete events reach every subscriber with the row's primary key. Never hard-delete private data, such as private expenses, from a table in that publication; mark it deleted instead.
- Email forwarding: `groups.forward_token` is the secret part of the group's bill address `bills+<token>@mail.baantwise.com`. receive-bill-email (verify_jwt off, checks `INBOUND_EMAIL_SECRET`) matches the sender to a member by sign-in email (`inbound_match`, admin key only), reads only biller, amount and date (Gemini under the same SCAN_ALLOWED_USER_IDS / SCAN_OPEN_TO_ALL rule as receipts, otherwise `read.ts` rules), and keeps a row in `forwarded_bills` (`inbound_add_bill`). The email itself is never stored or logged. `forwarded_bills` rows are seen only by the person who forwarded them; nothing reaches the group until they save an expense from it. forwarding-setup emails the setup steps from the bill address (verify_jwt on, 5 a day). Baantwise's own emails coming back are dropped (From @mail.baantwise.com or the X-Baantwise header, which every email sent from a bill address carries); automatic forwards that aren't bills get no reply, and `inbound_noise` counts them so someone forwarding all their mail gets one weekly warning and is kept away from the AI reader. `supabase/functions/receive-bill-email/read.ts` has no imports so `src/lib/billEmail.test.ts` can test it.
- Deleting an account: Profile → delete-account Edge Function (verify_jwt on, body {confirm: "DELETE"}) runs `prepare_account_deletion()` as the person (hands over admin to the longest-standing member with an account; deletes groups where nobody else has an account), then deletes the auth user with the admin key. Foreign keys do the rest: profile, forwarded bills, recurring rules and private records cascade; member rows, expenses and payments keep the name with no account (set null). Keep /privacy true to this.
- The privacy policy (`src/pages/Privacy.tsx`, /privacy) describes what the app collects, reads, keeps and shares. When a change affects any of that, update the page and its date.
- After a database change, regenerate `src/lib/database.types.ts` (Supabase connector `generate_typescript_types`) so the types match.

## Looks (themes)

- Colours are tokens in `src/index.css`. Autumn (rust, evergreen, birch) is the default `:root`; other looks override the tokens under `:root[data-palette="<key>"]`, once for light and once inside the dark-mode block. Money keeps its meaning in every look: `--lent` (you're owed) and `--owe` (you owe).
- `src/lib/palette.ts` lists the looks; Profile → Look (`LookSection`) saves the choice in this browser only (`localStorage` key `baantwise-palette`). The small script in `index.html` applies it before the page paints, so a new look must be added there too.
- Planned: seasonal looks, and a "Seasonal" choice that switches by itself.

## Welcome tour

- New people see a short pop-up tour once, on their first signed-in page (not on `/join/…`; it waits until they've joined). The cards are `TOUR_STEPS` in `src/lib/tour.ts`; keep them true to what the app does when features change. Seen-state is in this browser only (`localStorage` key `baantwise-tour-seen`). Profile → "Show the welcome tour again" reopens it (window event `baantwise:show-tour`, handled in `AppLayout`).

## Sample groups

- "Try a sample group" (Your groups) → `SampleGroupDialog` → `create_sample_group(p_persona)`: a private "Maple Street (sample)" group (`groups.is_sample`) with the person as Priya, Sam, Alex or Jordan and the others as guests, plus two months of expenses and payments. One per person (asking again opens it). The database blocks invites (`get_invite`, `join_group`), receipt photos (`can_add_receipt`) and forwarded bills (`inbound_match`) for samples; the app also hides receipt scanning, the receipt photo, Bills by email, the invite buttons, and Leave group (delete it instead). `SAMPLE_PEOPLE` in `src/lib/sampleGroup.ts` must match the SQL (a test checks).

## Install on the phone

- `public/manifest.webmanifest` + icons (`public/icon.svg` is the source; the PNGs are rendered from it) make Baantwise installable: Android Chrome ⋮ → Install app, iPhone Safari Share → Add to Home Screen. No service worker on purpose (Chrome's menu install doesn't need one, and it avoids stale caches). The last welcome-tour card explains it.

## Backups

- Supabase's free plan has no downloadable backups. `.github/workflows/backup.yml` dumps the database nightly with the Supabase CLI (roles, schema, data, migration history), encrypts it with gpg using the `BACKUP_PASSPHRASE` secret and keeps it as a 30-day GitHub Actions artifact. Secrets: `SUPABASE_DB_URL` (Session pooler string), `BACKUP_PASSPHRASE`. Receipt photos aren't included. Setup and restore steps: `docs/BACKUPS.md`. The privacy policy mentions the backups; keep it true.

## Commands

- `npm install`: install packages
- `npm run dev`: run locally at http://localhost:5173
- `npm run build`: type-check and build into `dist/`
- `npm test`: run the Vitest tests (`src/**/*.test.ts`)
- `npm run deploy`: build and deploy with Wrangler (normally Cloudflare deploys from GitHub instead)
