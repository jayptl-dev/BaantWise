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
