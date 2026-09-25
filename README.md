# Baantwise

Baantwise is a free web app for splitting bills fairly between friends, roommates and groups. It is being built for users in Canada, so amounts will show in Canadian dollars (CAD) by default. Baantwise only keeps track of who owes what. It never holds or moves real money.

The name blends the Hindi word "baant" (to divide, to share out) with "-wise".

**Status:** a "coming soon" landing page. There is no database or sign-in yet.

Live site: https://baantwise.com

## What it's built with

- **React:** the library that draws the page
- **Vite:** the tool that runs the app on your computer and bundles it for the web
- **TypeScript:** JavaScript with type checks that catch mistakes early
- **Cloudflare Workers:** hosts the site (free plan)

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

## Secrets

Never put passwords or API keys in this repository. They go in the Cloudflare and Supabase dashboards. Files like `.env` and `.dev.vars` are ignored by Git so they can't be committed by accident.
