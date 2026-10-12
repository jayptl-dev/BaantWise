import { useEffect, useState } from "react";
import {
  bankRates,
  isForeignCurrency,
  rateFromNumber,
  rateText,
  readRate,
  type ForeignCurrency,
  type Rate,
} from "./currency";
import type { Expense } from "./expenses";

export type RateState =
  | { kind: "none" } // a CAD expense
  | { kind: "loading" }
  | { kind: "error" } // couldn't get the Bank of Canada rate
  | { kind: "bank"; rate: Rate; date: string } // the Bank's rate published on `date`
  | { kind: "own"; rate: Rate | null }; // typed in (null while the box isn't a valid rate yet)

// The currency an expense was paid in and its exchange rate, for the Add/Edit form.
// The rate comes from the Bank of Canada for the expense's date and is fetched again
// when the currency or the date changes. Editing keeps the saved rate until one of
// those two changes. "Change rate" lets the person type their own.
export function useForeignAmount(expense: Expense | undefined, spentOn: string) {
  const saved = expense && isForeignCurrency(expense.original_currency) ? expense : null;
  const savedRate = saved?.fx_rate != null ? rateFromNumber(saved.fx_rate) : null;

  const [currency, setCurrency] = useState<"CAD" | ForeignCurrency>(
    saved ? (saved.original_currency as ForeignCurrency) : "CAD",
  );
  const [ownRateText, setOwnRateText] = useState<string | null>(
    saved && savedRate && saved.fx_rate_date === null ? rateText(savedRate) : null,
  );
  const [bank, setBank] = useState<RateState>(() =>
    saved && savedRate && saved.fx_rate_date
      ? { kind: "bank", rate: savedRate, date: saved.fx_rate_date }
      : { kind: "none" },
  );
  // The currency and date the shown Bank rate belongs to.
  const [bankFor, setBankFor] = useState<string>(saved ? `${saved.original_currency}|${saved.spent_on}` : "");

  const isForeign = currency !== "CAD";
  const key = `${currency}|${spentOn}`;

  useEffect(() => {
    if (!isForeign || ownRateText !== null || key === bankFor) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return;
    let active = true;
    setBank({ kind: "loading" });
    bankRates(spentOn).then((rates) => {
      if (!active) return;
      const found = rates?.rates[currency as ForeignCurrency];
      const rate = found ? readRate(found.rate) : null;
      setBank(found && rate ? { kind: "bank", rate, date: found.date } : { kind: "error" });
      setBankFor(key);
    });
    return () => {
      active = false;
    };
  }, [isForeign, ownRateText, key, bankFor, spentOn, currency]);

  let state: RateState;
  if (!isForeign) state = { kind: "none" };
  else if (ownRateText !== null) state = { kind: "own", rate: readRate(ownRateText) };
  else if (key !== bankFor) state = { kind: "loading" };
  else state = bank;

  const rate = state.kind === "bank" || state.kind === "own" ? state.rate : null;

  return {
    currency,
    setCurrency,
    isForeign,
    state,
    rate,
    ownRateText,
    // "Change rate": start typing your own, from the rate shown now.
    startOwnRate: () => setOwnRateText(rate ? rateText(rate) : ""),
    setOwnRateText,
    // "Use Bank of Canada rate"
    switchToBankRate: () => {
      setOwnRateText(null);
      setBankFor(""); // fetch it again for the current currency and date
    },
    // Fetch the Bank rate again after an error.
    retry: () => setBankFor(""),
  };
}
