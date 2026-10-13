// Sample groups: a private, ready-made "Maple Street (sample)" house someone can play with
// before using Baantwise for real. The database makes it (create_sample_group in
// supabase/migrations/20261013003000_sample_groups.sql) and blocks invites, receipt
// photos and forwarded bills there; the app hides those, and receipt scanning, too.

import { friendlyError } from "./errors";
import { supabase } from "./supabase";

export const SAMPLE_PEOPLE = [
  { name: "Priya", emoji: "🏠", about: "Pays the rent and most of the bills, so the others owe her." },
  { name: "Sam", emoji: "🛒", about: "Buys most of the groceries for the house." },
  { name: "Alex", emoji: "🍕", about: "Orders the pizza, and has a private Uber split with Priya." },
  { name: "Jordan", emoji: "📶", about: "Pays the internet and keeps things pretty even." },
] as const;

export type SamplePerson = (typeof SAMPLE_PEOPLE)[number]["name"];

// Makes this person's sample group as `who` (or opens the one they already have).
export async function createSampleGroup(
  who: SamplePerson,
): Promise<{ ok: true; groupId: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("create_sample_group", { p_persona: who });
  if (error || !data) return { ok: false, message: friendlyError(error) };
  return { ok: true, groupId: data };
}
