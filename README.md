# Baantwise

Baantwise is a free web app for splitting bills fairly between friends, roommates and groups. It is being built for users in Canada, so amounts will show in Canadian dollars (CAD) by default. Baantwise only keeps track of who owes what. It never holds or moves real money.

The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

**Status:** private beta. The home page has "Sign in with Google", but there's no database yet.

Live site: https://baantwise.com

## What it's built with

- **React:** the library that draws the page
- **Vite:** the tool that runs the app on your computer and bundles it for the web
- **TypeScript:** JavaScript with type checks that catch mistakes early
- **Cloudflare Workers:** hosts the site (free plan)
- **Supabase Auth:** handles "Sign in with Google" (free plan)

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

1. Someone clicks **Sign in with Google**. The app asks Supabase to start a Google sign-in and says where to come back to afterwards: the same site they started on (`baantwise.com` or `www.baantwise.com`).
2. Supabase sends them to Google. Google shows its sign-in screen, then sends them back to Supabase.
3. Supabase sends them back to Baantwise with a one-time code. The app swaps that code for a session and shows "Signed in as …" with their Google name and photo.
4. The session is saved in the browser, so it survives a page reload. **Sign out** removes it.
5. If sign-in fails or is cancelled, the home page shows a short message instead.

The code lives in `src/config.ts` (Supabase address and publishable key), `src/lib/supabase.ts` (the shared Supabase client) and `src/App.tsx` (the buttons and messages).

The settings live in dashboards, not in this repo:

- **Supabase → Authentication:** Google provider turned on. Site URL is `https://baantwise.com`. Allowed redirect URLs are `https://baantwise.com/**` and `https://www.baantwise.com/**`.
- **Google Cloud → Google Auth Platform:** the OAuth client's "Authorized redirect URIs" must include `https://yvdbqqblbfodeqkwzvem.supabase.co/auth/v1/callback`. While the app is in "Testing" mode, only Google accounts listed as test users can sign in.

The Supabase **publishable** key in `src/config.ts` is meant to be public. The **secret** / `service_role` key must never go in this repo.

Sign-in from `http://localhost:5173` won't come back to your computer unless `http://localhost:5173/**` is added to Supabase's allowed redirect URLs. Without it, Supabase sends you to baantwise.com instead.

## Secrets

Never put passwords or API keys in this repository. They go in the Cloudflare and Supabase dashboards. Files like `.env` and `.dev.vars` are ignored by Git so they can't be committed by accident.
