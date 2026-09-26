import { useCallback, useEffect, useRef, useState } from "react";
import type { Tables } from "./database.types";
import { friendlyError } from "./errors";
import { fetchExpenses, type Expense, type ExpensesToLoad } from "./expenses";
import { isUuid } from "./format";
import { fetchPayments, type Payment } from "./payments";
import { supabase } from "./supabase";
import { useRefreshOnReturn } from "./useRefreshOnReturn";

export type Member = {
  id: string;
  user_id: string | null; // null = guest
  display_name: string;
  is_admin: boolean;
  avatar_url: string | null;
  // Optional payment details from their profile (never for guests or people who left).
  interac_contact: string | null;
  paypal_me: string | null;
};

export type GroupData = {
  group: { id: string; name: string; invite_token: string };
  members: Member[]; // active members only, oldest first
  formerMembers: Member[]; // people who left or were removed: their names stay on old expenses
  expenses: Expense[]; // newest first; only loaded when asked for (see useGroup)
  payments: Payment[]; // newest first; only loaded with the whole expense list ("all")
};

export type GroupState =
  | { status: "loading" }
  | { status: "missing" } // couldn't open it: not found, deleted, or you're not a member
  | { status: "gone" } // it was open, then it was deleted or you left or were removed
  | { status: "error"; message: string }
  | { status: "ready"; data: GroupData };

type Profile = { avatar_url: string | null; interac_contact: string | null; paypal_me: string | null };

// Loads one group, its members and (if asked) its expenses, plus its payments with
// the whole list ("all"). Row Level Security means this only returns something if
// the signed-in person is a member.
async function fetchGroup(id: string, userId: string, expenses?: ExpensesToLoad): Promise<GroupState> {
  if (!isUuid(id)) return { status: "missing" };

  const [groupResult, membersResult, expensesResult, paymentsResult] = await Promise.all([
    supabase.from("groups").select("id, name, invite_token").eq("id", id).maybeSingle(),
    supabase
      .from("group_members")
      .select("id, user_id, display_name, is_admin, removed_at")
      .eq("group_id", id)
      .order("created_at"),
    expenses ? fetchExpenses(id, expenses) : { error: null, expenses: [] },
    expenses === "all" ? fetchPayments(id) : { error: null, payments: [] },
  ]);
  if (groupResult.error) return { status: "error", message: friendlyError(groupResult.error) };
  if (!groupResult.data) return { status: "missing" };
  if (membersResult.error) return { status: "error", message: friendlyError(membersResult.error) };
  const active = membersResult.data.filter((m) => m.removed_at === null);
  if (!active.some((m) => m.user_id === userId)) return { status: "missing" };
  if (expensesResult.error) return { status: "error", message: friendlyError(expensesResult.error) };
  if (paymentsResult.error) return { status: "error", message: friendlyError(paymentsResult.error) };

  // Google photos and payment details live in profiles. They're optional: if this
  // fails, initials are shown and nobody has payment details.
  const profiles = new Map<string, Profile>();
  const userIds = active.flatMap((m) => (m.user_id ? [m.user_id] : []));
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, avatar_url, interac_contact, paypal_me")
      .in("id", userIds);
    for (const { id: profileId, ...profile } of data ?? []) profiles.set(profileId, profile);
  }

  const toMember = (m: (typeof membersResult.data)[number]): Member => {
    const profile = m.user_id ? profiles.get(m.user_id) : undefined;
    return {
      id: m.id,
      user_id: m.user_id,
      display_name: m.display_name,
      is_admin: m.is_admin,
      avatar_url: profile?.avatar_url ?? null,
      interac_contact: profile?.interac_contact ?? null,
      paypal_me: profile?.paypal_me ?? null,
    };
  };
  return {
    status: "ready",
    data: {
      group: groupResult.data,
      members: active.map(toMember),
      formerMembers: membersResult.data.filter((m) => m.removed_at !== null).map(toMember),
      expenses: expensesResult.expenses,
      payments: paymentsResult.payments,
    },
  };
}

// Decides what to show after a (re)load.
function settle(previous: GroupState, next: GroupState): GroupState {
  const wasOpen = previous.status === "ready" || previous.status === "gone";
  // It was on screen and now can't be loaded: deleted, or you left or were removed.
  if (next.status === "missing" && wasOpen) return { status: "gone" };
  // A background refresh failed (for example, no internet): keep showing what we have.
  if (next.status === "error" && previous.status === "ready") return previous;
  return next;
}

let channelCount = 0; // gives each live-updates channel its own name

// Loads a group and keeps it up to date:
// - `reload()` fetches again after a change you made,
// - live updates (Supabase Realtime) reload when someone else changes the group,
// - and it catches up when the app comes back into view or back online.
// The current screen stays visible during a reload, so the page doesn't flicker.
// `expenses` also loads and watches the group's expenses and payments ("all"), or one
// expense ({ id }).
export function useGroup(id: string, userId: string, expenses?: ExpensesToLoad) {
  const [state, setState] = useState<GroupState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  // Only the expense id matters, so a new { id } object on each render doesn't reload.
  const expensesKey = expenses === undefined ? "" : expenses === "all" ? "all" : expenses.id;

  // The members, expenses and payments on screen, to tell which delete events are about this group.
  const memberIds = useRef(new Set<string>());
  const expenseIds = useRef(new Set<string>());
  const paymentIds = useRef(new Set<string>());
  useEffect(() => {
    const data = state.status === "ready" ? state.data : null;
    memberIds.current = new Set(data ? [...data.members, ...data.formerMembers].map((m) => m.id) : []);
    expenseIds.current = new Set(data ? data.expenses.map((e) => e.id) : []);
    paymentIds.current = new Set(data ? data.payments.map((p) => p.id) : []);
  }, [state]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const which: ExpensesToLoad | undefined =
      expensesKey === "" ? undefined : expensesKey === "all" ? "all" : { id: expensesKey };
    fetchGroup(id, userId, which).then((next) => {
      if (active) setState((previous) => settle(previous, next));
    });
    return () => {
      active = false;
    };
  }, [id, userId, expensesKey, version]);

  const reload = useCallback(() => {
    setState((current) =>
      current.status === "ready" || current.status === "gone" ? current : { status: "loading" },
    );
    setVersion((v) => v + 1);
  }, []);

  // Live updates. Only started once we know who is signed in, so the privacy
  // rules can check what this person is allowed to receive.
  useEffect(() => {
    if (!userId || !isUuid(id)) return;

    // Wait half a second, so a burst of changes causes one reload instead of many.
    let timer: number | undefined;
    function reloadSoon() {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 500);
    }

    const channel = supabase
      .channel(`group-${id}-${++channelCount}`)
      .on<Tables<"group_members">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${id}` },
        (change) => {
          // Delete events can't be filtered, so only react to members that are on screen.
          if (change.eventType === "DELETE" && !memberIds.current.has(change.old.id ?? "")) return;
          reloadSoon();
        },
      )
      .on<Tables<"groups">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter: `id=eq.${id}` },
        (change) => {
          if (change.eventType === "DELETE" && change.old.id !== id) return;
          reloadSoon();
        },
      )
      // A deleted group can't be filtered either, so listen to every group delete
      // (only the deleted group's id is sent) and ignore the ones about other groups.
      .on<Tables<"groups">>(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "groups" },
        (change) => {
          if (change.old.id === id) reloadSoon();
        },
      );

    // Expenses: the whole group's, or just the one on screen. Deleting an expense
    // only marks it deleted (an update), so adds, edits and deletes all arrive here.
    // The split (expense_shares) isn't sent live on purpose, but saving an expense
    // always updates the expense itself, so this reload picks up the new split too.
    if (expensesKey === "all" || isUuid(expensesKey)) {
      const filter = expensesKey === "all" ? `group_id=eq.${id}` : `id=eq.${expensesKey}`;
      channel.on<Tables<"expenses">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter },
        (change) => {
          // Real deletes only happen when a whole group is deleted, and can't be filtered.
          if (change.eventType === "DELETE" && !expenseIds.current.has(change.old.id ?? "")) return;
          reloadSoon();
        },
      );
    }

    // Payments, with the whole list. Undoing a payment only marks it deleted (an
    // update), so new payments and undos both arrive here, and the reload works
    // the balances out again.
    if (expensesKey === "all") {
      channel.on<Tables<"settlements">>(
        "postgres_changes",
        { event: "*", schema: "public", table: "settlements", filter: `group_id=eq.${id}` },
        (change) => {
          // Real deletes only happen when a whole group is deleted, and can't be filtered.
          if (change.eventType === "DELETE" && !paymentIds.current.has(change.old.id ?? "")) return;
          reloadSoon();
        },
      );
    }

    channel.subscribe();

    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id, userId, expensesKey, reload]);

  useRefreshOnReturn(reload);

  return { state, reload };
}
