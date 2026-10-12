// Baantwise Edge Function: forwarding-setup
// Emails the signed-in member the setup steps for their group's bill address, sent FROM
// that address (bills+<token>@mail.baantwise.com), so it's already in their inbox and
// contacts. The steps end with a test: forward one old bill now and watch it show up.
//
// - Callers must be signed in (keep verify_jwt on). The email goes only to the address
//   they sign in with (from their JWT), never to an address someone types.
// - At most 5 a day per person (rpc claim_forwarding_setup, as that person).
// - No admin key is used.
//
// Secrets: RESEND_API_KEY (Resend, "Sending access" for mail.baantwise.com).
//
// POST { group_id }
//   200 { sent: true, address }
//   other: { error, message }

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://baantwise.com';
const SITE_ORIGINS = ['https://baantwise.com', 'https://www.baantwise.com'];
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Please sign in again.',
  bad_request: 'Something went wrong. Please try again.',
  not_found: "We couldn't find that group.",
  no_email: "Your account doesn't have an email address we can send to.",
  daily_limit: "We've sent you the setup email a few times today. Check your inbox (and spam), or try again tomorrow.",
  not_set_up: 'Bill emails are coming soon.',
  service_down: "The email couldn't be sent right now. Try again in a few minutes.",
};

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: 'forwarding-setup', ...fields })); // never names or addresses
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

function publicApiKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    if (keys && typeof keys === 'object') {
      const key = typeof keys.default === 'string' ? keys.default
        : Object.values(keys).find((value) => typeof value === 'string');
      if (typeof key === 'string' && key) return key;
    }
  } catch { /* use the older names below */ }
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function oneLine(text: string, max: number): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function setupEmail(p: { groupName: string; groupId: string; address: string }) {
  const link = `${SITE}/groups/${p.groupId}/bills`;
  const text = [
    `This email comes from your ${p.groupName} bill address:`,
    '',
    `    ${p.address}`,
    '',
    'Forward a bill email (like Enbridge, Bell or your hydro company) to this address, and Baantwise reads the biller, the amount and the date. Nothing is added to the group until you check it and press Save.',
    '',
    'Step 1. Save the address. Add this sender to your contacts, so it\'s easy to pick when you forward.',
    '',
    'Step 2. Test it now with an old bill. Find a bill email you already got, forward it to this address, then open Baantwise:',
    link,
    'Within a minute it shows up under "Bills to review". If it does, everything works.',
    '',
    'Step 3 (optional). Make it automatic.',
    '- Gmail (on a computer): Settings > See all settings > "Forwarding and POP/IMAP" > "Add a forwarding address" > paste the address. Gmail sends a confirmation code to it; Baantwise emails that code to you. Enter it in Gmail. Then make a filter: search for the biller (for example from:enbridge.com), "Create filter", tick "Forward it to" and pick this address.',
    '- Outlook: Settings > Mail > Rules > "Add new rule": when the sender is the biller, "Forward to" this address.',
    '',
    'Important: forward from the email address you use to sign in to Baantwise. Emails from other addresses are turned away.',
  ].join('\n');
  const e = escapeHtml;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1c2624;max-width:34rem">
<p>This email comes from your <strong>${e(p.groupName)}</strong> bill address:</p>
<p style="font-size:17px;padding:10px 12px;background:#f0f5f4;border-radius:8px;word-break:break-all"><strong>${e(p.address)}</strong></p>
<p>Forward a bill email (like Enbridge, Bell or your hydro company) to this address, and Baantwise reads the biller, the amount and the date. Nothing is added to the group until you check it and press Save.</p>
<h3 style="margin-bottom:4px">Step 1. Save the address</h3>
<p style="margin-top:0">Add this sender to your contacts, so it's easy to pick when you forward.</p>
<h3 style="margin-bottom:4px">Step 2. Test it now with an old bill</h3>
<p style="margin-top:0">Find a bill email you already got and forward it to this address. Within a minute it shows up under <strong>Bills to review</strong>. If it does, everything works.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0f766e;color:#ffffff;text-decoration:none">Open Bills to review</a></p>
<h3 style="margin-bottom:4px">Step 3 (optional). Make it automatic</h3>
<ul style="margin-top:0">
<li><strong>Gmail</strong> (on a computer): Settings &gt; See all settings &gt; Forwarding and POP/IMAP &gt; Add a forwarding address &gt; paste the address. Gmail sends a confirmation code to it, and Baantwise emails that code to you. Enter it in Gmail. Then make a filter: search for the biller (for example <code>from:enbridge.com</code>), choose Create filter, tick <em>Forward it to</em> and pick this address.</li>
<li><strong>Outlook</strong>: Settings &gt; Mail &gt; Rules &gt; Add new rule: when the sender is the biller, Forward to this address.</li>
</ul>
<p style="color:#55625f;font-size:14px">Important: forward from the email address you use to sign in to Baantwise. Emails from other addresses are turned away.</p>
</div>`;
  return { subject: `Your bill address for ${p.groupName}`, text, html };
}

async function handle(req: Request): Promise<Response> {
  const started = Date.now();
  const origin = req.headers.get('Origin');
  const cors = corsHeaders(origin);
  if (origin !== null && !originAllowed(origin)) return fail('bad_request', 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('bad_request', 405, cors);

  try {
    const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    if (!resendKey) return fail('not_set_up', 503, cors);

    const token = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return fail('not_signed_in', 401, cors);
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', publicApiKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: authError } = await db.auth.getClaims(token);
    const claims = verified?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : '';
    if (authError || claims?.role !== 'authenticated' || !UUID.test(userId)) return fail('not_signed_in', 401, cors);
    const to = typeof claims?.email === 'string' ? claims.email.trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail('no_email', 422, cors);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const groupId = typeof body?.group_id === 'string' ? body.group_id : '';
    if (!UUID.test(groupId)) return fail('bad_request', 400, cors);

    const { data: claimed, error: claimError } = await db.rpc('claim_forwarding_setup', { p_group_id: groupId }).single();
    const claim = claimed as { allowed: boolean; group_name: string; forward_token: string } | null;
    if (claimError || !claim) {
      log({ outcome: 'claim_failed', code: claimError?.code ?? null });
      return fail(claimError?.code === '42501' ? 'not_found' : 'service_down', claimError?.code === '42501' ? 404 : 503, cors);
    }
    if (!claim.allowed) return fail('daily_limit', 429, cors);

    const address = `bills+${claim.forward_token}@mail.baantwise.com`;
    const groupName = oneLine(claim.group_name, 60);
    const mail = setupEmail({ groupName, groupId, address });
    const fromName = `Baantwise · ${groupName}`.replace(/["<>\\]/g, '').slice(0, 70);
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${address}>`, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!sent || !sent.ok) {
      const detail = sent ? String((await sent.json().catch(() => ({})))?.message ?? '').slice(0, 200) : 'network';
      log({ outcome: 'resend_failed', status: sent?.status ?? null, detail, ms: Date.now() - started });
      return fail('service_down', 503, cors);
    }
    log({ outcome: 'ok', ms: Date.now() - started });
    return reply(200, { sent: true, address }, cors);
  } catch (err) {
    log({ outcome: 'crash', error: (err as Error)?.name ?? 'unknown', ms: Date.now() - started });
    return fail('service_down', 503, cors);
  }
}

Deno.serve(handle);
