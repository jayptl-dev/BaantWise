// The Cloudflare Worker for baantwise.com. On the web it only runs for /api/* (see
// "run_worker_first" in wrangler.jsonc); every other address is the React app,
// served straight from the built files. It also receives bill emails (./email.ts).
import { receiveEmail, type EmailEnv, type IncomingEmail } from "./email";
import { fxRates } from "./fxRates";

type Env = EmailEnv & { ASSETS: { fetch: (request: Request) => Promise<Response> } };
type Context = { waitUntil: (promise: Promise<unknown>) => void };

// Cloudflare's shared cache for this site (not part of the browser's Cache types).
function edgeCache(): Cache | null {
  const store = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/fx-rates" && request.method === "GET") {
      const cache = edgeCache();
      const key = new Request(url.toString(), { method: "GET" });
      const hit = await cache?.match(key);
      if (hit) return hit;
      const response = await fxRates(url, fetch, new Date());
      if (response.ok && cache) ctx.waitUntil(cache.put(key, response.clone()));
      return response;
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return env.ASSETS.fetch(request);
  },

  // Cloudflare Email Routing: bills@mail.baantwise.com -> "Send to a Worker" -> here.
  async email(message: IncomingEmail, env: Env): Promise<void> {
    await receiveEmail(message, env);
  },
};
