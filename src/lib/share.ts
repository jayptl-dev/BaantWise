// Helpers for sharing a group's invite link.

// The one message used everywhere an invite is shared.
export function inviteMessage(groupName: string, link: string): string {
  return `Join "${groupName}" on Baantwise: ${link}`;
}

// Phones and tablets (a touch screen with a share menu) use the device's own share menu.
export function canUseShareSheet(): boolean {
  return typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
}

// Text messages only make sense on a phone, not on a tablet or computer.
export function isPhone(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPod/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
}

export function whatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// "sms:?&body=" is the form that works on both iPhone and Android.
export function smsUrl(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

export function emailUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
