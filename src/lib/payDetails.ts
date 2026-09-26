// The optional payment details on your profile, so people in your groups can pay
// you back: an Interac e-Transfer email or phone, and a PayPal.Me username.
// Baantwise only shows these. It never moves money.

import { centsToDecimal } from "./money";

export const INTERAC_MAX = 100; // same limit as the database check on profiles.interac_contact
export const PAYPAL_MAX = 20; // same limit as the database check on profiles.paypal_me

// What a box holds after checking: the value to save (null = left empty), or why it's wrong.
export type Checked = { value: string | null; problem?: undefined } | { value?: undefined; problem: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;

// An Interac e-Transfer email or Canadian phone number. Kept as typed (minus spaces
// at the ends), so it looks the way the person wrote it.
export function checkInterac(text: string): Checked {
  const value = text.trim();
  if (value === "") return { value: null };
  if (value.length > INTERAC_MAX) return { problem: `Keep it to ${INTERAC_MAX} characters or fewer.` };
  if (value.includes("@")) {
    return EMAIL.test(value) ? { value } : { problem: "That email doesn't look right. Check it and try again." };
  }
  const digits = value.replace(/\D/g, "");
  const phoneDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (PHONE_CHARACTERS.test(value) && phoneDigits.length === 10) return { value };
  return { problem: "Enter an email, like name@example.com, or a 10-digit phone number." };
}

// A PayPal.Me username: letters and numbers, up to 20. A pasted link like
// "https://paypal.me/JayP/25" or "paypal.com/paypalme/JayP" keeps just "JayP".
export function checkPayPal(text: string): Checked {
  let value = text.trim();
  if (value === "") return { value: null };
  const link = value.match(/paypal(?:\.me|\.com\/paypalme)\/+@?([^/?#\s]*)/i);
  if (link) value = link[1];
  value = value.replace(/^@/, "");
  if (value === "") return { problem: "Add your username after paypal.me/." };
  if (!/^[A-Za-z0-9]+$/.test(value)) return { problem: "Use only letters and numbers, like paypal.me/JayP." };
  if (value.length > PAYPAL_MAX) return { problem: `A PayPal.Me username is at most ${PAYPAL_MAX} characters.` };
  return { value };
}

// The PayPal.Me page for paying `name` an amount in Canadian dollars.
export function payPalUrl(name: string, cents: number): string {
  return `https://paypal.me/${encodeURIComponent(name)}/${centsToDecimal(cents)}CAD`;
}
