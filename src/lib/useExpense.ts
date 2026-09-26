import { useState } from "react";
import type { Expense } from "./expenses";
import { useGroup, type GroupData, type GroupState, type Member } from "./useGroup";

export type ExpenseState =
  | Exclude<GroupState, { status: "ready" }>
  | { status: "expense-missing"; data: GroupData } // couldn't open it: not found, deleted, or private
  | { status: "expense-deleted"; data: GroupData } // it was on screen, then it was deleted
  | { status: "ready"; data: GroupData; expense: Expense; me: Member };

// Loads one expense with its group, and keeps both up to date (see useGroup).
export function useExpense(groupId: string, expenseId: string, userId: string) {
  const { state, reload } = useGroup(groupId, userId, { id: expenseId });
  const expense = state.status === "ready" ? state.data.expenses[0] : undefined;

  // Remember whether it was ever on screen, to tell "was deleted" from "couldn't open".
  const [wasShown, setWasShown] = useState(false);
  if (expense && !wasShown) setWasShown(true);

  let result: ExpenseState;
  if (state.status !== "ready") {
    result = state;
  } else if (!expense) {
    result = { status: wasShown ? "expense-deleted" : "expense-missing", data: state.data };
  } else {
    // The group only loads if you're an active member, so this always finds you.
    const me = state.data.members.find((m) => m.user_id === userId)!;
    result = { status: "ready", data: state.data, expense, me };
  }
  return { state: result, reload };
}
