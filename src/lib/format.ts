// Small helpers for showing things in plain words.

export const GROUP_NAME_MAX = 60; // same limit as the database check on groups.name
export const PERSON_NAME_MAX = 80; // same limit as the database check on group_members.display_name

export function peopleCount(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

// First letter of a name, shown when there's no photo.
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Group ids and invite tokens are UUIDs. Checking first means a mistyped link
// gets a plain "doesn't work" message instead of a database error.
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ["you", "Priya", "Sam"] → "you, Priya and Sam"
export function listOfNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Today's date on this device, as the database stores dates: "2026-09-25".
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// "2026-09-25" → "Sep 25, 2026" (the year is left out if `short` and it's this year).
export function formatDay(isoDate: string, short = false): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Built from its parts, so the date doesn't shift with the time zone.
  const date = new Date(year, month - 1, day);
  const sameYear = year === new Date().getFullYear();
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: short && sameYear ? undefined : "numeric",
  });
}
