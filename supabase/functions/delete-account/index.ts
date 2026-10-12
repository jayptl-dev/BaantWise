// Baantwise Edge Function: delete-account
// "Delete my account" in Profile. Deletes the signed-in person's account for good.
//
// 1. rpc prepare_account_deletion(), as the person (their own sign-in): hands over admin,
//    and deletes groups nobody else could open.
// 2. Deletes their sign-in with the admin key. The database then erases their profile,
//    forwarded bills, recurring expenses and small records, and keeps their name on
//    shared expenses with no account attached (see the migration …_delete_account.sql).
//
// - Callers must be signed in (keep verify_jwt on). Only the caller can be deleted.
// - The body must be { confirm: "DELETE" }, so nothing deletes an account by accident.
// - The admin key is used for one thing only: deleting this one sign-in.
//
// POST { confirm: "DELETE" }  ->  200 { deleted: true }  |  { error, message }

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_ORIGINS = ['https://baantwise.com', 'https://www.baantwise.com'];
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Please sign in again.',
  bad_request: 'Something went wrong. Please try again.',
  service_down: "Your account couldn't be deleted right now. Try again in a few minutes.",
};

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: 'delete-account', ...fields })); // never names or addresses
}

function originAllowed(origin: string | null): boolean {
  return origin !== null && (SITE_ORIGINS.includes(origin) || DEV_ORIGIN.test(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!originAllowed(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function reply(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function fail(error: string, status: number, cors: Record<string, string>): Response {
  return reply(status, { error, message: MESSAGES[error] }, cors);
}

function keyFrom(listName: string, oldName: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(listName) ?? '{}');
    if (keys && typeof keys === 'object') {
      const key = typeof keys.default === 'string' ? keys.default
        : Object.values(keys).find((value) => typeof value === 'string');
      if (typeof key === 'string' && key) return key;
    }
  } catch { /* use the older name */ }
  return Deno.env.get(oldName) ?? '';
}

const publicApiKey = () => keyFrom('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const adminApiKey = () => keyFrom('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');

async function handle(req: Request): Promise<Response> {
  const started = Date.now();
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);
  if (origin !== null && !originAllowed(origin)) return fail('bad_request', 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('bad_request', 405, cors);

  try {
    const token = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return fail('not_signed_in', 401, cors);
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const db = createClient(url, publicApiKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: authError } = await db.auth.getClaims(token);
    const claims = verified?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    if (authError || claims?.role !== 'authenticated' || !UUID.test(userId)) return fail('not_signed_in', 401, cors);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.confirm !== 'DELETE') return fail('bad_request', 400, cors);

    const { error: prepError } = await db.rpc('prepare_account_deletion');
    if (prepError) {
      log({ outcome: 'prepare_failed', code: prepError.code ?? null });
      return fail('service_down', 503, cors);
    }

    const admin = createClient(url, adminApiKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      log({ outcome: 'delete_failed', status: deleteError.status ?? null });
      return fail('service_down', 503, cors);
    }
    log({ outcome: 'ok', ms: Date.now() - started });
    return reply(200, { deleted: true }, cors);
  } catch (err) {
    log({ outcome: 'crash', error: (err as Error)?.name ?? 'unknown', ms: Date.now() - started });
    return fail('service_down', 503, cors);
  }
}

Deno.serve(handle);
