import { describe, expect, it } from "vitest";
import { possibleDuplicate, type ForwardedBill } from "../lib/forwarding";
import type { Expense } from "../lib/expenses";
import { receiveEmail, type IncomingEmail } from "./email";

function message(rawSize = 10) {
  const out = { rejected: null as string | null };
  const msg: IncomingEmail = {
    from: "jay@gmail.com",
    to: "bills+crews-abc123@mail.baantwise.com",
    rawSize,
    raw: new Response("From: jay@gmail.com\r\n\r\nhi").body!,
    setReject: (reason) => {
      out.rejected = reason;
    },
  };
  return { msg, out };
}

describe("Worker: bill emails", () => {
  it("passes the email on with the secret and envelope, and keeps it when accepted", async () => {
    const { msg, out } = message();
    let seen: { url: string; headers: Headers; body: string } | null = null;
    const post = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: new TextDecoder().decode(init.body as ArrayBuffer) };
      return Response.json({ action: "accept" });
    }) as unknown as typeof fetch;
    await receiveEmail(msg, { INBOUND_EMAIL_SECRET: "s3cret" }, post);
    expect(out.rejected).toBeNull();
    expect(seen!.url).toMatch(/\/functions\/v1\/receive-bill-email$/);
    expect(seen!.headers.get("x-inbound-secret")).toBe("s3cret");
    expect(seen!.headers.get("x-envelope-to")).toBe("bills+crews-abc123@mail.baantwise.com");
    expect(seen!.body).toContain("From: jay@gmail.com");
  });

  it("turns the email away with the function's reason", async () => {
    const { msg, out } = message();
    const post = (async () => Response.json({ action: "reject", message: "Not in this group" })) as unknown as typeof fetch;
    await receiveEmail(msg, { INBOUND_EMAIL_SECRET: "s" }, post);
    expect(out.rejected).toBe("Not in this group");
  });

  it("turns it away when something is broken or missing", async () => {
    const broken = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const a = message();
    await receiveEmail(a.msg, { INBOUND_EMAIL_SECRET: "s" }, broken);
    expect(a.out.rejected).toMatch(/forward it again/);
    const b = message();
    await receiveEmail(b.msg, {}, broken);
    expect(b.out.rejected).toMatch(/forward it again/);
    const c = message(30 * 1024 * 1024);
    await receiveEmail(c.msg, { INBOUND_EMAIL_SECRET: "s" }, broken);
    expect(c.out.rejected).toMatch(/too big/);
  });
});

describe("possibleDuplicate", () => {
  const bill: ForwardedBill = {
    id: "b", biller: "Enbridge", amountCents: 12345, currency: "CAD", billDate: "2026-10-05", category: "utilities",
    receivedAt: "2026-10-12T10:00:00Z",
  };
  const expense = (id: string, cents: number, day: string) =>
    ({ id, description: id, amount_cents: cents, spent_on: day, original_currency: null, original_amount_cents: null }) as Expense;
  it("finds the same amount within a week", () => {
    expect(possibleDuplicate(bill, [expense("far", 12345, "2026-09-01"), expense("near", 12345, "2026-10-08")])?.id).toBe("near");
  });
  it("ignores other amounts and bills without one", () => {
    expect(possibleDuplicate(bill, [expense("other", 12346, "2026-10-05")])).toBeNull();
    expect(possibleDuplicate({ ...bill, amountCents: null }, [expense("x", 12345, "2026-10-05")])).toBeNull();
  });
});
