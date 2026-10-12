// Bill emails: Cloudflare Email Routing sends every email for bills@mail.baantwise.com
// (and bills+<group token>@…, thanks to subaddressing) to this Worker. The Worker doesn't
// read the email itself (the free plan has very little CPU time): it passes it straight
// to the receive-bill-email Edge Function, which does the reading, and turns the email
// away with a short reason when that function says so.
import { SUPABASE_URL } from "../config";

export type EmailEnv = { INBOUND_EMAIL_SECRET?: string };

// The parts of Cloudflare's ForwardableEmailMessage this uses.
export type IncomingEmail = {
  from: string;
  to: string;
  rawSize: number;
  raw: ReadableStream<Uint8Array>;
  setReject: (reason: string) => void;
};

export const MAX_EMAIL_BYTES = 20 * 1024 * 1024;
const BROKEN = "Baantwise could not read this email right now. Please forward it again in a few minutes.";

export async function receiveEmail(
  message: IncomingEmail,
  env: EmailEnv,
  post: typeof fetch = fetch,
): Promise<void> {
  if (message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject("This email is too big for Baantwise.");
    return;
  }
  const secret = (env.INBOUND_EMAIL_SECRET ?? "").trim();
  if (!secret) {
    console.log(JSON.stringify({ fn: "email", outcome: "no_secret" }));
    message.setReject(BROKEN);
    return;
  }
  let res: Response;
  try {
    // Read into memory first so the request has a normal Content-Length.
    const body = await new Response(message.raw).arrayBuffer();
    res = await post(`${SUPABASE_URL}/functions/v1/receive-bill-email`, {
      method: "POST",
      headers: {
        "Content-Type": "message/rfc822",
        "x-inbound-secret": secret,
        "x-envelope-from": message.from,
        "x-envelope-to": message.to,
      },
      body,
    });
  } catch {
    console.log(JSON.stringify({ fn: "email", outcome: "network" }));
    message.setReject(BROKEN);
    return;
  }
  const answer = (await res.json().catch(() => null)) as { action?: string; message?: string } | null;
  console.log(JSON.stringify({ fn: "email", status: res.status, action: answer?.action ?? null }));
  if (res.ok && answer?.action === "accept") return;
  message.setReject(typeof answer?.message === "string" && answer.message ? answer.message.slice(0, 300) : BROKEN);
}
