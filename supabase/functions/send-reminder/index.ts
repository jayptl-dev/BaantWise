// Baantwise Edge Function: send-reminder
// Emails a payment reminder to someone who owes the signed-in person money, and a copy
// to the sender, through Resend. Baantwise never moves money.
//
// - Callers must be signed in (keep verify_jwt on).
// - The amount is worked out here, from what the SENDER can see (their own sign-in, so
//   Row Level Security applies), with the app's own maths (./balances.ts, an exact
//   copy of src/lib/balances.ts). Nobody can make the email say a made-up amount.
// - One reminder per person per group every 3 days, 20 a day per sender
//   (rpc claim_reminder, as the sender).
// - The admin key is used for one thing only: looking up the two email addresses.
//
// Secrets: RESEND_API_KEY (Resend, "Sending access" for mail.baantwise.com).
//          REMINDER_FROM (optional), default "Baantwise <reminders@mail.baantwise.com>".
//
// POST { group_id, member_id, scope: "group" | "private" }
//   200 { sent: true, cents, next_at }
//   other: { error, message }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { groupNets, privatePairs, simplifyDebts } from './balances.ts';

const SITE = 'https://baantwise.com';
const SITE_ORIGINS = ['https://baantwise.com', 'https://www.baantwise.com'];
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_FROM = 'Baantwise <reminders@mail.baantwise.com>';

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Please sign in again.',
  bad_request: 'Something went wrong. Please try again.',
  not_found: "We couldn't find that person in this group.",
  nothing_owed: "They don't owe you anything right now, so there's nothing to remind them about.",
  no_account: "They're a guest without an account, so they can't get emails.",
  too_soon: "You already reminded them recently. You can send another one 3 days after the last.",
  daily_limit: "You've sent a lot of reminders today. Try again tomorrow.",
  not_set_up: 'Email reminders are coming soon.',
  service_down: "The reminder couldn't be sent right now. Try again in a few minutes.",
};

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: 'send-reminder', ...fields })); // never names, emails or amounts
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

function fail(error: string, status: number, cors: Record<string, string>, message?: string): Response {
  return reply(status, { error, message: message ?? MESSAGES[error] }, cors);
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

function adminApiKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys && typeof keys === 'object') {
      const key = typeof keys.default === 'string' ? keys.default
        : Object.values(keys).find((value) => typeof value === 'string');
      if (typeof key === 'string' && key) return key;
    }
  } catch { /* use the older name below */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

// Names are typed by users: make them safe to put in an email.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function oneLine(text: string, max: number): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function cad(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

type Profile = { interac_contact: string | null; paypal_me: string | null };

function emailFor(p: {
  toName: string; fromName: string; groupName: string; groupId: string; cents: number;
  isPrivate: boolean; pay: Profile | null;
}) {
  const amount = cad(p.cents);
  const link = `${SITE}/groups/${p.groupId}`;
  const ways: string[] = [];
  if (p.pay?.interac_contact) ways.push(`Interac e-Transfer to ${p.pay.interac_contact}`);
  if (p.pay?.paypal_me) ways.push(`PayPal: https://paypal.me/${encodeURIComponent(p.pay.paypal_me)}/${(p.cents / 100).toFixed(2)}CAD`);
  const scope = p.isPrivate ? ` (just between you two, in ${p.groupName})` : ` in ${p.groupName}`;
  const text = [
    `Hi ${p.toName},`,
    '',
    `${p.fromName} sent you a friendly reminder: you owe ${p.fromName} ${amount}${scope}.`,
    '',
    ways.length ? `${p.fromName} can be paid by:\n- ${ways.join('\n- ')}` : `Pay ${p.fromName} back the way you usually do.`,
    '',
    `When you've paid, record it in Baantwise so the balance updates: ${link}`,
    '',
    'Baantwise only keeps track of who owes what. It never holds or moves money.',
  ].join('\n');
  const e = escapeHtml;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1c2624;max-width:32rem">
<p>Hi ${e(p.toName)},</p>
<p><strong>${e(p.fromName)}</strong> sent you a friendly reminder: you owe ${e(p.fromName)} <strong>${e(amount)}</strong>${e(scope)}.</p>
${ways.length ? `<p>${e(p.fromName)} can be paid by:</p><ul>${ways.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : `<p>Pay ${e(p.fromName)} back the way you usually do.</p>`}
<p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0f766e;color:#ffffff;text-decoration:none">Open ${e(p.groupName)} in Baantwise</a></p>
<p style="color:#55625f;font-size:14px">When you've paid, record it in Baantwise so the balance updates. Baantwise only keeps track of who owes what. It never holds or moves money.</p>
</div>`;
  return { subject: `Reminder from ${p.fromName}: ${amount} for ${p.groupName}`, text, html };
}

function copyFor(p: { fromName: string; toName: string; groupName: string; groupId: string; cents: number }) {
  const amount = cad(p.cents);
  const link = `${SITE}/groups/${p.groupId}`;
  const text = `Hi ${p.fromName},\n\nWe emailed ${p.toName} a reminder that they owe you ${amount} in ${p.groupName}.\nYou can send another one in 3 days if you need to.\n\n${link}`;
  const e = escapeHtml;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1c2624;max-width:32rem">
<p>Hi ${e(p.fromName)},</p>
<p>We emailed <strong>${e(p.toName)}</strong> a reminder that they owe you <strong>${e(amount)}</strong> in ${e(p.groupName)}.</p>
<p style="color:#55625f;font-size:14px">You can send another one in 3 days if you need to.</p>
<p><a href="${link}">Open ${e(p.groupName)}</a></p>
</div>`;
  return { subject: `Reminder sent to ${p.toName}`, text, html };
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

    // 1. Who is sending?
    const token = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return fail('not_signed_in', 401, cors);
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const db = createClient(url, publicApiKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: authError } = await db.auth.getClaims(token);
    const claims = verified?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub.toLowerCase() : '';
    if (authError || claims?.role !== 'authenticated' || !UUID.test(userId)) return fail('not_signed_in', 401, cors);

    // 2. What are they asking for?
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const groupId = typeof body?.group_id === 'string' ? body.group_id : '';
    const memberId = typeof body?.member_id === 'string' ? body.member_id : '';
    const scope = body?.scope === 'private' ? 'private' : body?.scope === 'group' ? 'group' : null;
    if (!UUID.test(groupId) || !UUID.test(memberId) || !scope) return fail('bad_request', 400, cors);

    // 3. Everything the sender can see in the group (Row Level Security decides).
    const [group, members, expenses, payments] = await Promise.all([
      db.from('groups').select('id, name').eq('id', groupId).maybeSingle(),
      db.from('group_members').select('id, user_id, display_name, removed_at').eq('group_id', groupId),
      db.from('expenses').select('amount_cents, paid_by, visibility, deleted_at, expense_shares(member_id, share_cents)')
        .eq('group_id', groupId).is('deleted_at', null),
      db.from('settlements').select('from_member, to_member, amount_cents, visibility, deleted_at')
        .eq('group_id', groupId).is('deleted_at', null),
    ]);
    if (group.error || members.error || expenses.error || payments.error) {
      log({ outcome: 'load_failed', ms: Date.now() - started });
      return fail('service_down', 503, cors);
    }
    if (!group.data) return fail('not_found', 404, cors);
    const me = (members.data ?? []).find((m) => m.user_id === userId && m.removed_at === null);
    const them = (members.data ?? []).find((m) => m.id === memberId && m.removed_at === null);
    if (!me || !them || them.id === me.id) return fail('not_found', 404, cors);
    if (!them.user_id) return fail('no_account', 422, cors);

    // 4. How much they owe me, the same way the group page works it out.
    const rows = (expenses.data ?? []).map((e) => ({
      amount_cents: e.amount_cents, paid_by: e.paid_by,
      visibility: e.visibility === 'participants' ? 'participants' as const : 'group' as const,
      deleted_at: e.deleted_at, shares: e.expense_shares ?? [],
    }));
    const pays = (payments.data ?? []).map((p) => ({
      ...p, visibility: p.visibility === 'participants' ? 'participants' as const : 'group' as const,
    }));
    const cents = scope === 'group'
      ? simplifyDebts(groupNets(rows, pays)).find((t) => t.from === them.id && t.to === me.id)?.cents ?? 0
      : privatePairs(rows, pays, me.id).find((p) => p.with === them.id && p.cents > 0)?.cents ?? 0;
    if (cents <= 0) return fail('nothing_owed', 409, cors);

    // 5. Not too often.
    const { data: claimed, error: claimError } = await db.rpc('claim_reminder', {
      p_group_id: groupId, p_to_member: them.id,
    }).single();
    const claim = claimed as { allowed: boolean; reason: string | null; next_at: string } | null;
    if (claimError || !claim) {
      log({ outcome: 'claim_failed', code: claimError?.code ?? null });
      return fail(claimError?.code === '22023' ? 'no_account' : 'service_down', claimError?.code === '22023' ? 422 : 503, cors);
    }
    if (!claim.allowed) return fail(claim.reason === 'daily_limit' ? 'daily_limit' : 'too_soon', 429, cors);

    // 6. The two email addresses (the only use of the admin key).
    const admin = createClient(url, adminApiKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const [toUser, fromUser] = await Promise.all([
      admin.auth.admin.getUserById(them.user_id),
      admin.auth.admin.getUserById(userId),
    ]);
    const toEmail = toUser.data?.user?.email;
    const fromEmail = fromUser.data?.user?.email;
    if (!toEmail) return fail('no_account', 422, cors);

    const { data: pay } = await db.from('profiles').select('interac_contact, paypal_me').eq('id', userId).maybeSingle();
    const names = {
      toName: oneLine(them.display_name, 80) || 'there',
      fromName: oneLine(me.display_name, 80) || 'Someone in your group',
      groupName: oneLine(group.data.name, 60),
    };
    const from = (Deno.env.get('REMINDER_FROM') ?? '').trim() || DEFAULT_FROM;
    const main = emailFor({ ...names, groupId, cents, isPrivate: scope === 'private', pay: pay as Profile | null });
    const emails = [{ from, to: [toEmail], subject: main.subject, html: main.html, text: main.text }];
    if (fromEmail) {
      const copy = copyFor({ ...names, groupId, cents });
      emails.push({ from, to: [fromEmail], subject: copy.subject, html: copy.html, text: copy.text });
    }

    // 7. Send.
    const sent = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emails),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!sent || !sent.ok) {
      const detail = sent ? String((await sent.json().catch(() => ({})))?.message ?? '').slice(0, 200) : 'network';
      log({ outcome: 'resend_failed', status: sent?.status ?? null, detail, ms: Date.now() - started });
      return fail('service_down', 503, cors);
    }
    log({ outcome: 'ok', copies: emails.length, ms: Date.now() - started });
    return reply(200, { sent: true, cents, next_at: claim.next_at }, cors);
  } catch (err) {
    log({ outcome: 'crash', error: (err as Error)?.name ?? 'unknown', ms: Date.now() - started });
    return fail('service_down', 503, cors);
  }
}

Deno.serve(handle);
