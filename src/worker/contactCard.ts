// "Save to contacts" on the Bills by email page: a contact card (vCard 3.0) for the group's
// bill address, so forwarding a bill from a phone is "Forward → type Baan → Send".
// Served by the Worker at /api/contact-card, because phones only open the
// "check and save this contact" screen for a real download, not for one made in the page.
import { CONTACT_PHOTO_JPEG_BASE64 } from "./contactPhoto";

const TOKEN = /^[a-z0-9-]{3,40}$/;
const SITE = "https://baantwise.com";

// Commas, semicolons and backslashes mean something in a vCard, so they're escaped.
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// Lines longer than 75 bytes are split, each next part starting with a space (RFC 2426).
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // the leading space counts on later lines
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// A group name as typed: one line, no control characters, at most 60 characters.
function cleanName(name: string): string {
  return Array.from(name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 60).join("");
}

export function contactCard(p: { token: string; groupName: string; groupId?: string; photo?: boolean }): string | null {
  if (!TOKEN.test(p.token)) return null;
  const group = cleanName(p.groupName) || "your group";
  const email = `bills+${p.token}@mail.baantwise.com`;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    // Shown as "Baantwise Bills – Crews Crescent"; typing "Baan" finds it.
    `N:${escapeText(`Bills – ${group}`)};Baantwise;;;`,
    `FN:${escapeText(`Baantwise Bills – ${group}`)}`,
    "ORG:Baantwise",
    `EMAIL;TYPE=INTERNET:${email}`,
    `NOTE:${escapeText(`Forward bill emails for ${group} here. Baantwise reads only the biller, the amount and the date.`)}`,
    ...(p.groupId && /^[0-9a-f-]{36}$/i.test(p.groupId) ? [`URL:${SITE}/groups/${p.groupId.toLowerCase()}/bills`] : []),
    ...(p.photo === false ? [] : [`PHOTO;ENCODING=b;TYPE=JPEG:${CONTACT_PHOTO_JPEG_BASE64}`]),
    "END:VCARD",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// GET /api/contact-card?token=…&group=…&id=…  ->  the .vcf file.
export function contactCardResponse(url: URL): Response {
  const card = contactCard({
    token: (url.searchParams.get("token") ?? "").toLowerCase(),
    groupName: url.searchParams.get("group") ?? "",
    groupId: url.searchParams.get("id") ?? undefined,
  });
  if (!card) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(card, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Baantwise Bills.vcf"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
