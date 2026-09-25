# Baantwise: project rules

Baantwise is a free bill-splitting web app. The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

## Working with Jay

- The owner, Jay, is learning. Explain changes in plain language and work in small steps.
- Budget is $0. Use free plans only unless Jay approves a cost.

## Secrets

- Never commit secrets or API keys. They go in the Cloudflare and Supabase dashboards.
- Local-only secret files (`.env*`, `.dev.vars`) are listed in `.gitignore` and must stay that way.

## Stack

- Now: React + Vite + TypeScript, served as static assets on Cloudflare Workers (Cloudflare Vite plugin, `wrangler.jsonc`, npm).
- Now: Supabase Auth with Google sign-in (`@supabase/supabase-js`, one shared client in `src/lib/supabase.ts`, public URL and publishable key in `src/config.ts`). No database tables yet.
- Planned later:
  - Supabase (Canada Central region) for the database, Google sign-in, storage, edge functions and scheduled jobs
  - Resend for email
  - Gemini Flash-Lite for reading receipts

## Product rules

- Privacy rules are enforced in the database with Row Level Security, never only in the screens.
- Users are in Canada. Show amounts in CAD by default.
- The app never holds or moves real money.

## Commands

- `npm install`: install packages
- `npm run dev`: run locally at http://localhost:5173
- `npm run build`: type-check and build into `dist/`
- `npm run deploy`: build and deploy with Wrangler (normally Cloudflare deploys from GitHub instead)
