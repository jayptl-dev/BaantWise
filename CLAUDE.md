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

- Now: React + Vite + TypeScript, served as static assets on Cloudflare Workers (Cloudflare Vite plugin, `wrangler.jsonc`, npm).
- Now: Supabase Auth with Google sign-in (`@supabase/supabase-js`, one shared client in `src/lib/supabase.ts`, public URL and publishable key in `src/config.ts`).
- Now: Supabase database. Migrations are copied into `supabase/migrations`; generated types are in `src/lib/database.types.ts` and the client is typed with `createClient<Database>`.
- Now: React Router (`react-router`, routes in `src/App.tsx`): `/`, `/groups/:id`, `/groups/:id/settings`, `/groups/:id/expenses/new`, `/groups/:id/expenses/:expenseId`, `/groups/:id/expenses/:expenseId/edit`, `/groups/:id/search`, `/search`, `/groups/:id/spending`, `/spending`, `/join/:token`, `/profile`. Screens live in `src/pages`, shared UI in `src/components`, data and sign-in helpers in `src/lib` (`auth.tsx` for who is signed in, `errors.ts` for friendly error lines, `money.ts` for cents (`readMoney` is the one place that reads an amount box), `categories.ts` for the expense categories (keys, labels, emoji, the keyword lists and suggestions; charts and receipt scanning reuse it), `expenses.ts` for loading expenses, `payments.ts` for loading payments, `balances.ts` for who owes whom, `payDetails.ts` for Interac and PayPal.Me details, `search.ts` for expense search, `spending.ts` for the spending charts, `receipts.ts` for receipt photos in Storage, `receiptScan.ts` for calling the scan-receipt Edge Function, `split.ts` for the one leftover-cent rule every automatic split uses, `shrinkPhoto.ts` for shrinking photos in the browser before upload).
- Planned later:
  - Supabase (Canada Central region) for the database, Google sign-in, storage, edge functions and scheduled jobs
  - Resend for email
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
- Use the database functions for multi-step actions: `create_group`, `get_invite`, `join_group`, `reset_invite_link`, `set_member_admin`, `remove_member`, `leave_group`, `save_expense` (adds or edits an expense, its category and its split in one go; the split must add up to the total; always send `p_visibility` and `p_category`), `delete_expense` (sets `expenses.deleted_at`; expense rows are never erased, so always filter `deleted_at is null`), `delete_settlement` (undoes a payment by setting `settlements.deleted_at`; only whoever recorded it; always filter `deleted_at is null`) and `set_expense_receipt` (links or, with null, clears `expenses.receipt_path`; only whoever added the expense). Reading data, adding a guest (insert into `group_members` with `group_id` and `display_name`), recording a payment (insert into `settlements`) and saving your profile use normal table queries.
- Database changes are made from the planning session through the Supabase connector, then copied here as new files in `supabase/migrations`. Never edit a migration that has already been applied.
- Receipt photos: private Storage bucket `receipts` (JPEG only, 1 MB limit), one per expense at `<expense id>/<uuid>.jpg`. Upload after `save_expense`, then `set_expense_receipt`; after replacing, removing or deleting, remove the folder's other files. Show them with short-lived signed URLs that are never stored.
- Live updates use Supabase Realtime `postgres_changes` on tables in the `supabase_realtime` publication (now `groups`, `group_members`, `expenses` and `settlements`; `expense_shares` deliberately isn't, so reload the shares on any expense event). The privacy rules filter inserts and updates but not deletes: delete events reach every subscriber with the row's primary key. Never hard-delete private data, such as private expenses, from a table in that publication; mark it deleted instead.
- After a database change, regenerate `src/lib/database.types.ts` (Supabase connector `generate_typescript_types`) so the types match.

## Commands

- `npm install`: install packages
- `npm run dev`: run locally at http://localhost:5173
- `npm run build`: type-check and build into `dist/`
- `npm test`: run the Vitest tests (`src/**/*.test.ts`)
- `npm run deploy`: build and deploy with Wrangler (normally Cloudflare deploys from GitHub instead)
