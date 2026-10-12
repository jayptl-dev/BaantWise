import { describe, expect, it } from "vitest";
import {
  billAddress,
  cleanBill,
  cleanDate,
  htmlToText,
  isAutomatic,
  isFromBaantwise,
  isGmailConfirmation,
  nameFromSender,
  originalSenderIn,
  readBillByRules,
  readGmailConfirmation,
  sameSecret,
  senderCandidates,
  tokenFromAddress,
  undoSrs,
} from "../../supabase/functions/receive-bill-email/read";
import { BILL_DOMAIN, forwardAddress } from "./forwarding";

// The helpers the receive-bill-email Edge Function uses to read a forwarded bill.
describe("bill addresses", () => {
  it("reads the group token from the address", () => {
    expect(tokenFromAddress("bills+crews-crescent-3f9a1c07d2@mail.baantwise.com")).toBe("crews-crescent-3f9a1c07d2");
    expect(tokenFromAddress("BILLS+Crews-3F9A@Mail.Baantwise.com")).toBe("crews-3f9a");
  });
  it("turns away other addresses", () => {
    expect(tokenFromAddress("bills@mail.baantwise.com")).toBeNull();
    expect(tokenFromAddress("reminders+abc-123@mail.baantwise.com")).toBeNull();
    expect(tokenFromAddress("bills+abc-123@baantwise.com")).toBeNull();
    expect(tokenFromAddress("bills+a b@mail.baantwise.com")).toBeNull();
  });
  it("matches the address the app shows", () => {
    expect(billAddress("x-123")).toBe(forwardAddress("x-123"));
    expect(forwardAddress("x-123").endsWith(`@${BILL_DOMAIN}`)).toBe(true);
  });
});

describe("who forwarded it", () => {
  it("undoes sender rewriting", () => {
    expect(undoSrs("SRS0=Ab12=XY=gmail.com=jay@forwarder.example")).toBe("jay@gmail.com");
    expect(undoSrs("jay@gmail.com")).toBe("jay@gmail.com");
  });
  it("lists the envelope sender first, then the headers, without repeats", () => {
    expect(
      senderCandidates({
        envelopeFrom: "jay+caf_=bills+x=mail.baantwise.com@gmail.com",
        xForwardedFor: "jay@gmail.com bills+x@mail.baantwise.com",
        resentFrom: null,
        from: '"Enbridge Gas" <noreply@enbridge.com>',
      }),
    ).toEqual(["jay+caf_=bills+x=mail.baantwise.com@gmail.com", "jay@gmail.com", "noreply@enbridge.com"]);
  });
});

describe("Gmail forwarding confirmation", () => {
  const subject = "(#123456789) Gmail Forwarding Confirmation - Receive Mail from jay@gmail.com";
  const text =
    "jay@gmail.com has requested to automatically forward mail to your email address.\nConfirmation code: 123456789\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc\nhttps://evil.example/phish";
  it("spots it", () => {
    expect(isGmailConfirmation("Gmail Team <forwarding-noreply@google.com>", subject)).toBe(true);
    expect(isGmailConfirmation("someone@evil.example", subject)).toBe(false);
  });
  it("takes only the code, the requester and Google's own link", () => {
    expect(readGmailConfirmation(subject, text)).toEqual({
      requester: "jay@gmail.com",
      code: "123456789",
      link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc",
    });
    expect(readGmailConfirmation("Forwarding Confirmation", "go to https://evil.example/x").link).toBeNull();
  });
});

describe("reading the bill", () => {
  it("turns HTML into plain lines", () => {
    expect(htmlToText("<style>p{}</style><p>Amount&nbsp;due:</p><td>$1,234.56</td><br>Thanks &amp; bye")).toBe(
      "Amount due:\n$1,234.56\nThanks & bye",
    );
  });
  it("finds the amount due without Gemini", () => {
    const bill = readBillByRules({
      text: "Hi Jay,\nYour bill is ready.\nAmount due: $123.45\nDue date: Nov 3",
      subject: "Your Enbridge bill",
      sender: "Enbridge Gas <noreply@enbridge.com>",
      sentOn: "2026-10-10",
      today: "2026-10-12",
    });
    expect(bill).toEqual({ isBill: true, biller: "Enbridge Gas", amountCents: 12345, currency: "CAD", billDate: "2026-10-10", category: "other" });
  });
  it("says so when there's no amount", () => {
    expect(readBillByRules({ text: "See you Friday!", subject: "Re: dinner", sender: null, sentOn: null, today: "2026-10-12" }).isBill).toBe(false);
  });
  it("finds the bill's own sender in a forward by hand", () => {
    expect(originalSenderIn("FYI\n---------- Forwarded message ---------\nFrom: Bell <ebill@bell.ca>\nDate: Oct 1")).toBe("Bell <ebill@bell.ca>");
    expect(originalSenderIn("no forward here")).toBeNull();
  });
  it("names a biller from its address when there's no name", () => {
    expect(nameFromSender("billing@email.enbridge.com")).toBe("Enbridge");
    expect(nameFromSender('"Toronto Hydro" <x@torontohydro.com>')).toBe("Toronto Hydro");
  });
  it("checks what Gemini sent back", () => {
    expect(
      cleanBill({ is_bill: true, biller: " Bell ", amount_cents: 8475, currency: "cad", bill_date: "2026-10-01", category: "utilities" }, "2026-10-12"),
    ).toEqual({ isBill: true, biller: "Bell", amountCents: 8475, currency: "CAD", billDate: "2026-10-01", category: "utilities" });
    expect(cleanBill({ is_bill: true, amount_cents: 12.5, bill_date: "2030-01-01", category: "nope" }, "2026-10-12")).toEqual({
      isBill: true, biller: null, amountCents: null, currency: "CAD", billDate: null, category: "other",
    });
    expect(cleanBill("nonsense", "2026-10-12")).toBeNull();
  });
  it("only keeps sensible dates", () => {
    expect(cleanDate("2026-02-30", "2026-10-12")).toBeNull();
    expect(cleanDate("2024-01-01", "2026-10-12")).toBeNull();
    expect(cleanDate("2026-10-13", "2026-10-12")).toBe("2026-10-13"); // a day ahead is fine (time zones)
  });
});

describe("shared secret", () => {
  it("compares exactly", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
  });
});

describe("email loops and automatic forwards", () => {
  it("spots Baantwise's own emails coming back", () => {
    expect(isFromBaantwise({ from: "Baantwise · Cabin trip <bills+cabin-1@mail.baantwise.com>", headers: [] })).toBe(true);
    expect(isFromBaantwise({ from: "Jay <jay@gmail.com>", headers: [{ key: "X-Baantwise", value: "notice" }] })).toBe(true);
    expect(isFromBaantwise({ from: "Enbridge <noreply@enbridge.com>", headers: [] })).toBe(false);
  });
  it("knows a rule forward from a person pressing Forward", () => {
    expect(isAutomatic({ envelopeFrom: "jay+caf_=bills+x=mail.baantwise.com@gmail.com", headers: [] })).toBe(true);
    expect(isAutomatic({ envelopeFrom: "jay@gmail.com", headers: [{ key: "X-Forwarded-For", value: "jay@gmail.com x@y.z" }] })).toBe(true);
    expect(isAutomatic({ envelopeFrom: "jay@gmail.com", headers: [{ key: "Auto-Submitted", value: "auto-replied" }] })).toBe(true);
    expect(isAutomatic({ envelopeFrom: "jay@gmail.com", headers: [{ key: "Auto-Submitted", value: "no" }] })).toBe(false);
    expect(isAutomatic({ envelopeFrom: "jay@gmail.com", headers: [] })).toBe(false);
  });
  it("reads Enbridge's payment reminder", () => {
    const text = htmlToText(
      "<table><tr><td>Account Number</td><td>910068283460</td></tr><tr><td>Due Date</td><td>October 1, 2026</td></tr><tr><td>Current Outstanding Balance</td><td>$ 69.31</td></tr></table>",
    );
    const bill = readBillByRules({ text, subject: "Fwd: Enbridge - Your Payment is Due", sender: "Enbridge Gas <noreply@enbridge.com>", sentOn: "2026-09-25", today: "2026-10-12" });
    expect(bill.amountCents).toBe(6931);
    expect(bill.isBill).toBe(true);
  });
});
