import { describe, expect, it } from "vitest";
import { contactCardLink, contactSaveHint, forwardAddress } from "../lib/forwarding";
import { contactCard, contactCardResponse, foldLine } from "./contactCard";

const unfold = (card: string) => card.replace(/\r\n /g, "");

describe("contact card for a group's bill address", () => {
  it("has the name, the address and the picture", () => {
    const card = contactCard({ token: "crews-crescent-1987fe3049", groupName: "Crews Crescent", groupId: "0b6f1c2e-1111-4222-8333-444455556666" })!;
    const flat = unfold(card);
    expect(flat).toMatch(/^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
    expect(flat).toContain("FN:Baantwise Bills – Crews Crescent\r\n");
    expect(flat).toContain("N:Bills – Crews Crescent;Baantwise;;;\r\n");
    expect(flat).toContain(`EMAIL;TYPE=INTERNET:${forwardAddress("crews-crescent-1987fe3049")}\r\n`);
    expect(flat).toContain("URL:https://baantwise.com/groups/0b6f1c2e-1111-4222-8333-444455556666/bills\r\n");
    expect(flat).toMatch(/PHOTO;ENCODING=b;TYPE=JPEG:\/9j\//); // a JPEG
    expect(flat.endsWith("END:VCARD\r\n")).toBe(true);
  });
  it("keeps every line within 75 bytes", () => {
    const card = contactCard({ token: "abc-123", groupName: "Ünïcödé group with a long name, and; commas" })!;
    for (const line of card.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(card)).toContain("FN:Baantwise Bills – Ünïcödé group with a long name\\, and\\; commas");
  });
  it("folds without breaking a character", () => {
    expect(foldLine("é".repeat(50)).split("\r\n ").join("")).toBe("é".repeat(50));
  });
  it("refuses a bad address", () => {
    expect(contactCard({ token: "bad token!", groupName: "x" })).toBeNull();
    expect(contactCardResponse(new URL("https://baantwise.com/api/contact-card?token=../x")).status).toBe(404);
  });
  it("is served as a vCard from the link the app makes", () => {
    const link = contactCardLink("abc-123", "Crews & Co", "0b6f1c2e-1111-4222-8333-444455556666");
    const res = contactCardResponse(new URL(link, "https://baantwise.com"));
    expect(res.headers.get("Content-Type")).toBe("text/vcard; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("contactSaveHint", () => {
  it("tells iPhone people to tap Create New Contact", () => {
    expect(contactSaveHint("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toMatch(/Create New Contact/);
    expect(contactSaveHint("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toMatch(/^On iPhone/); // iPad
  });
  it("tells Android people to open the file", () => {
    expect(contactSaveHint("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toMatch(/^On Android/);
  });
  it("covers both on a computer", () => {
    expect(contactSaveHint("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toMatch(/iPhone.*Android/);
  });
});
