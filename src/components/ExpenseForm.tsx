import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { categoryFor, suggestCategory, type CategoryKey } from "../lib/categories";
import { DESCRIPTION_MAX, peopleInvolved, type Expense, type Visibility } from "../lib/expenses";
import { formatDay, todayLocal } from "../lib/format";
import {
  centsToDecimal,
  formatCents,
  MAX_CENTS,
  readMoney,
  refuseExactChange,
  splitEqually,
} from "../lib/money";
import { attachReceipt, detachReceipt } from "../lib/receipts";
import {
  centsByPercent,
  centsByShares,
  defaultSplitNeedsUpdate,
  percentsFromAmounts,
  sharesFromAmounts,
  evenPercents,
  HUNDRED_PERCENT,
  percentNumber,
  readDefaultSplit,
  readPercent,
  readShares,
  readSnapshot,
  SPLIT_METHODS,
  splitForSave,
  usableDefault,
  type SplitMethod,
} from "../lib/splitMethods";
import { PhotoProblem, shrinkPhoto } from "../lib/shrinkPhoto";
import { supabase } from "../lib/supabase";
import { useDbAction } from "../lib/useDbAction";
import type { GroupData, Member } from "../lib/useGroup";
import type { ScannedReceipt } from "../lib/receiptScan";
import {
  cadInRange,
  currencyDecimals,
  currencyName,
  currencySymbol,
  FOREIGN_CURRENCIES,
  MAX_FOREIGN_CENTS,
  foreignToCadShares,
  formatForeign,
  isForeignCurrency,
  rateText,
  toCadCents,
} from "../lib/currency";
import { useForeignAmount } from "../lib/useForeignAmount";
import {
  FREQUENCIES,
  recurringSplitForSave,
  type Frequency,
  type RecurringRule,
  type RecurringSplit,
} from "../lib/recurring";
import { CategoryButton } from "./CategoryPicker";
import { ItemSplitSheet, linesFromScan, type ItemLine } from "./ItemSplitSheet";
import { ScanReceipt } from "./ScanReceipt";
import { FeedbackLine } from "./Status";
import { LockIcon } from "./LockIcon";
import { ReceiptThumbnail, SavedReceipt } from "./ReceiptPhoto";
import { useConfirm } from "./useConfirm";

type SplitMode = SplitMethod; // "equally" | "exact" | "percent" | "shares"

type FormErrors = {
  description?: string;
  amount?: string;
  paidBy?: string;
  date?: string;
  split?: string; // about the split as a whole
  people: Map<string, string>; // member id → the problem with their exact amount
};

// What a new expense starts with, instead of a blank form (a bill to fill in, made by a
// recurring expense).
export type ExpenseTemplate = {
  description: string;
  category: CategoryKey;
  paidBy: string;
  visibility: Visibility;
  spentOn: string;
  amountCents: number | null;
  split: RecurringSplit;
};

type ExpenseFormProps = {
  data: GroupData;
  me: Member;
  expense?: Expense; // when editing; leave out to add a new one
  template?: ExpenseTemplate; // a new expense that starts filled in
  // Set up or change a recurring expense instead of adding one expense. The same form,
  // with "How often" in place of the date and no receipt photo.
  recurring?: { rule?: RecurringRule; onSaved: (ruleId: string) => void };
  // After saving (with a message if the receipt photo part didn't work), or Cancel (nothing).
  onDone: (saved?: { expenseId: string; receiptNotice: string | null }) => void;
};

// Adding or editing an expense. Everything is checked here first so mistakes get
// a friendly message, and the database checks it all again (save_expense).
export function ExpenseForm({ data, me, expense, template: givenTemplate, recurring, onDone }: ExpenseFormProps) {
  const rule = recurring?.rule;
  // Editing a rule starts from it, like a template.
  const template: ExpenseTemplate | undefined = rule
    ? {
        description: rule.description,
        category: rule.category,
        paidBy: rule.paidBy,
        visibility: rule.visibility,
        spentOn: rule.startOn,
        amountCents: rule.amountCents,
        split: rule.split,
      }
    : givenTemplate;
  const { group } = data;
  const { ask, dialog } = useConfirm();
  const { busy, feedback, setFeedback, run } = useDbAction();
  const ids = { description: useId(), amount: useId(), paidBy: useId(), date: useId(), split: useId() };

  // Who can be picked: everyone in the group now, plus (when editing) anyone already
  // on this expense who has since left, so they aren't dropped by accident.
  const people = useMemo(() => {
    const onExpense = new Set(expense ? [expense.paid_by, ...expense.shares.map((s) => s.member_id)] : []);
    return [...data.members, ...data.formerMembers.filter((m) => onExpense.has(m.id))];
  }, [data, expense]);

  const [start] = useState(() =>
    template ? splitFromTemplate(template.split, people) : { ...startingSplit(expense, people, data), wholeGroup: !expense },
  );
  // Recurring: everyone in the group, including people who join later (equal split only).
  const [wholeGroup, setWholeGroup] = useState(start.wholeGroup);
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "monthly");
  const [endOn, setEndOn] = useState(rule?.endOn ?? "");
  const [amountKind, setAmountKind] = useState<"fixed" | "variable">(rule?.amountKind ?? "fixed");
  const variable = recurring !== undefined && amountKind === "variable";
  const [defaultOutdated] = useState(() => {
    const saved = expense ? null : readDefaultSplit(group.default_split);
    return saved !== null && defaultSplitNeedsUpdate(saved, data.members.map((m) => m.id));
  });
  const [description, setDescription] = useState(expense?.description ?? template?.description ?? "");
  // What's typed in the Amount box, in the expense's own currency (CA$, or US$ etc.).
  const [amountText, setAmountText] = useState(() => {
    if (!expense) return template?.amountCents ? centsToDecimal(template.amountCents) : "";
    if (isForeignCurrency(expense.original_currency) && expense.original_amount_cents !== null) {
      return entryText(expense.original_amount_cents, expense.original_currency);
    }
    return centsToDecimal(expense.amount_cents);
  });
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? template?.paidBy ?? me.id);
  // For a recurring expense this is the start date.
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? template?.spentOn ?? todayLocal());
  // Paid in another currency: which one, and its rate to CAD (Bank of Canada or typed in).
  const fx = useForeignAmount(expense, spentOn);
  const canConvert = group.currency === "CAD" && !recurring; // groups are all CAD for now; recurring ones are CAD
  const [mode, setMode] = useState<SplitMode>(start.mode);
  const [ticked, setTicked] = useState<Set<string>>(start.ticked);
  const [exactText, setExactText] = useState<Record<string, string>>(start.exact);
  // "By %" and "By shares": the number typed for each ticked person.
  const [percentText, setPercentText] = useState<Record<string, string>>(start.percent);
  const [sharesText, setSharesText] = useState<Record<string, string>>(start.shares);
  const [visibility, setVisibility] = useState<Visibility>(expense?.visibility ?? template?.visibility ?? "group");
  // The category someone picked (when editing, the saved one). Until they pick one, a new
  // expense follows a suggestion from its description; their own pick always wins.
  const [pickedCategory, setPickedCategory] = useState<CategoryKey | null>(
    expense?.category ?? (template && template.category !== "other" ? template.category : null),
  );
  // After the first Save, missing things (like an empty description) are pointed out too.
  const [tried, setTried] = useState(false);
  // Why the last key in a person's box was ignored (see changeExact).
  const [limitNote, setLimitNote] = useState<{ id: string; text: string } | null>(null);
  // After switching split screens: when the numbers could only come close to the old split.
  const [carryNote, setCarryNote] = useState<string | null>(null);

  // The receipt photo: a new one chosen here (already shrunk), or the saved one
  // marked for removal. Uploaded only after the expense itself is saved.
  const [newPhoto, setNewPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removeSaved, setRemoveSaved] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const savedPhoto = removeSaved ? null : (expense?.receipt_path ?? null);

  // What the last receipt scan said, and its items for "Split by item" (never saved).
  const [scanNotes, setScanNotes] = useState<string[]>([]);
  const [itemLines, setItemLines] = useState<ItemLine[] | null>(null);
  const [itemSheetOpen, setItemSheetOpen] = useState(false);
  const working = busy || savingPhoto;

  // The preview only lives in this browser tab; free it when it's replaced or the form closes.
  useEffect(() => {
    if (!newPhoto) return;
    return () => URL.revokeObjectURL(newPhoto.url);
  }, [newPhoto]);

  // Worked out from what's typed so far, on every change. The boxes only ever hold
  // money (see changeAmount), so reading them always works.
  // `entry` is in the expense's own currency; `amount` is always CAD cents, which is
  // what gets split and saved. For a CAD expense they're the same.
  const entryCents = readEntry(amountText, fx.currency); // null = empty
  const entry = entryCents !== null && entryCents > 0 ? entryCents : null;
  const totalCents = fx.isForeign ? (entry !== null && fx.rate ? toCadCents(entry, fx.rate) : null) : entryCents;
  const amount = totalCents !== null && totalCents > 0 && totalCents <= MAX_CENTS ? totalCents : null;
  // Exact amounts are typed in the expense's own currency and must add up to `entry`.
  const exactTarget = fx.isForeign ? entry : amount;
  const fmtEntry = (cents: number) => (fx.isForeign ? formatForeign(cents, fx.currency) : formatCents(cents));

  const tickedIds = people.filter((p) => ticked.has(p.id)).map((p) => p.id); // in list order
  // Each person's part of `total` in the modes that work it out (Equally, Percent, Shares).
  function computeShares(total: number | null, how: SplitMode = mode): Map<string, number> | null {
    if (total === null) return null;
    if (how === "equally") return splitEqually(total, tickedIds, paidBy);
    if (how === "percent") {
      return percentsOk ? centsByPercent(total, tickedIds.map((id) => ({ id, hundredths: percents.get(id)! })), paidBy) : null;
    }
    if (how === "shares") {
      return sharesOk ? centsByShares(total, tickedIds.map((id) => ({ id, shares: shareCounts.get(id)! })), paidBy) : null;
    }
    return null;
  }

  // "By %": hundredths of a percent per ticked person (null = empty or not a percent).
  const percents = new Map(tickedIds.map((id) => [id, readPercent(percentText[id] ?? "")]));
  const percentTotal = [...percents.values()].reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const percentsOk = tickedIds.length > 0 && [...percents.values()].every((v) => v !== null) && percentTotal === HUNDRED_PERCENT;

  // "By shares": a whole number from 1 to 1000 per ticked person.
  const shareCounts = new Map(tickedIds.map((id) => [id, readShares(sharesText[id] ?? "")]));
  const sharesOk = tickedIds.length > 0 && [...shareCounts.values()].every((v) => v !== null);

  // The CAD cents each person ends up with, for the modes that work it out.
  const workedOut = computeShares(amount);

  // Exact amounts. Each box can also add and take away, like "115.22+64.88".
  // An empty box means that person isn't in the split.
  const exactRead = new Map(people.map((p) => [p.id, readMoney(exactText[p.id] ?? "", true)]));
  const exactCents = new Map(people.map((p) => [p.id, exactRead.get(p.id)?.cents ?? null]));
  const exactTotal = [...exactCents.values()].reduce<number>((sum, cents) => sum + (cents ?? 0), 0);

  // The people splitting it, and so who a private expense is shared with.
  const splitIds =
    mode === "exact" ? people.filter((p) => exactCents.get(p.id) !== null).map((p) => p.id) : tickedIds;
  // The database's rule: the payer, the people splitting it, and whoever added it (you).
  const involved = new Set([paidBy, ...splitIds, me.id]);
  const onlyMe = involved.size === 1;
  const finalVisibility: Visibility = onlyMe ? "participants" : visibility;

  // The suggestion looks at this group's earlier expenses first (the Add screen loads them).
  const category = pickedCategory ?? suggestCategory(description, data.expenses);

  function nameFor(member: Member): string {
    if (member.id === me.id) return `${member.display_name} (you)`;
    if (!data.members.includes(member)) return `${member.display_name} (left)`;
    return member.display_name;
  }

  function whose(member: Member): string {
    return member.id === me.id ? "Your amount" : `${member.display_name}'s amount`;
  }

  // Amount boxes only take money: a key that would make anything else is ignored.
  function changeAmount(text: string) {
    if (currencyDecimals(fx.currency) === 0) {
      const digits = text.replace(/[\s,]/g, "");
      if (!/^\d{0,11}$/.test(digits)) return; // yen, won, rupiah: whole numbers only
      setLimitNote(null);
      setAmountText(digits);
      return;
    }
    const read = readMoney(text);
    if (!read) return;
    setLimitNote(null);
    setAmountText(read.text);
  }

  // Picking another currency starts the amount (and exact amounts) over in it.
  function chooseCurrency(code: string) {
    if (code !== "CAD" && !isForeignCurrency(code)) return;
    if (code === fx.currency) return;
    fx.setCurrency(code);
    fx.setOwnRateText(null);
    if (currencyDecimals(code) === 0) setAmountText((t) => t.split(".")[0]);
    setExactText({});
  }

  // A person's box never lets the amounts go over the total, not even by a cent: a key
  // that would, or a "+" when nothing is left to add, is ignored with a short note
  // saying why. Lowering an amount always works. (The rule is refuseExactChange.)
  function changeExact(id: string, text: string) {
    const read = readMoney(text, true);
    if (!read) return;
    const refused = refuseExactChange({
      total: exactTarget,
      assigned: exactTotal,
      before: exactCents.get(id) ?? 0,
      after: read.cents ?? 0,
      addsPlus: countPlus(read.text) > countPlus(exactText[id] ?? ""),
      format: fmtEntry,
    });
    if (refused) {
      setLimitNote({ id, text: refused });
      return;
    }
    setLimitNote(null);
    setExactText((current) => ({ ...current, [id]: read.text }));
  }

  // When you leave a box with a sum in it, show the answer instead ("10+2.5" → "12.50").
  function finishSum(id: string) {
    const cents = exactRead.get(id)?.isSum ? exactCents.get(id) : null;
    if (cents !== null && cents !== undefined && cents >= 0) {
      setExactText((current) => ({ ...current, [id]: centsToDecimal(cents) }));
    }
  }

  // A percent or shares box: only digits (and, for percents, up to 2 decimals) get in.
  function changeValue(id: string, text: string) {
    const tidy = text.replace(/\s/g, "").replace(/,/g, ".");
    const fits = mode === "percent" ? /^\d{0,3}(\.\d{0,2})?$/.test(tidy) : /^\d{0,4}$/.test(tidy);
    if (!fits) return;
    setCarryNote(null);
    if (mode === "percent") setPercentText((current) => ({ ...current, [id]: tidy }));
    else setSharesText((current) => ({ ...current, [id]: tidy }));
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same photo again still works
    if (!file) return;
    setPhotoProblem(null);
    setPreparingPhoto(true);
    try {
      const blob = await shrinkPhoto(file);
      setNewPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      setPhotoProblem(
        error instanceof PhotoProblem
          ? error.message
          : "We couldn't open that photo. Try taking it again, or choose a JPG or PNG.",
      );
    } finally {
      setPreparingPhoto(false);
    }
  }

  // A scanned receipt fills in what it could read; everything stays editable. Its photo
  // becomes the receipt photo once the expense is saved.
  function applyScan(receipt: ScannedReceipt, photo: Blob) {
    setFeedback(null);
    setPhotoProblem(null);
    setRemoveSaved(false);
    setNewPhoto({ blob: photo, url: URL.createObjectURL(photo) });
    if (receipt.merchant) setDescription(Array.from(receipt.merchant).slice(0, DESCRIPTION_MAX).join(""));
    if (receipt.date) setSpentOn(receipt.date);
    if (receipt.category !== "other") setPickedCategory(receipt.category);
    const notes: string[] = [];
    const foreign = receipt.currency !== null && receipt.currency !== group.currency;
    if (foreign && canConvert && isForeignCurrency(receipt.currency) && receipt.totalCents !== null) {
      chooseCurrency(receipt.currency);
      setAmountText(entryText(receipt.totalCents, receipt.currency));
      notes.push(`This receipt is in ${receipt.currency}. It's turned into CA$ at the Bank of Canada rate.`);
    } else if (foreign) {
      setAmountText("");
      notes.push(`This receipt is in ${receipt.currency}. Enter the amount in ${group.currency}.`);
    } else if (receipt.totalCents !== null && receipt.totalCents <= MAX_CENTS) {
      setAmountText(centsToDecimal(receipt.totalCents));
    }
    notes.push("Check the details. Scans can make mistakes.");
    if (receipt.hasWarnings) notes.push("Some numbers on this receipt don't add up. Please check them.");
    setScanNotes(notes);
    setItemLines(receipt.items.length > 0 ? linesFromScan(receipt.items) : null);
  }

  // "Use this split" from Split by item: switch to Exact amounts, filled in.
  function applyItemSplit(shares: Map<string, number>) {
    setLimitNote(null);
    setExactText(Object.fromEntries(people.map((p) => [p.id, shares.has(p.id) ? centsToDecimal(shares.get(p.id)!) : ""])));
    setMode("exact");
    setItemSheetOpen(false);
  }

  function removePhoto() {
    setPhotoProblem(null);
    if (newPhoto) setNewPhoto(null);
    else setRemoveSaved(true);
  }

  function toggle(id: string) {
    if (mode === "shares" && !sharesText[id]) setSharesText((current) => ({ ...current, [id]: "1" }));
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Switching split screens keeps the split: each person's amount right now (in the
  // expense's own currency) becomes the new screen's numbers. Only when the current
  // split is complete; otherwise the new screen starts from its usual defaults.
  function currentParts(): { id: string; cents: number }[] | null {
    if (exactTarget === null) return null;
    const map = mode === "exact" ? (exactTotal === exactTarget ? exactCents : null) : computeShares(exactTarget);
    if (!map) return null;
    const parts = people
      .map((p) => ({ id: p.id, cents: map.get(p.id) ?? 0 }))
      .filter((p) => p.cents > 0);
    return parts.length > 0 ? parts : null;
  }

  function switchMode(next: SplitMode) {
    if (next === mode) return;
    setFeedback(null);
    setLimitNote(null);
    setCarryNote(null);
    const parts = currentParts();
    const partIds = parts?.map((p) => p.id);
    const nextTicked = partIds ?? (splitIds.length > 0 ? splitIds : tickedIds);
    if (next !== "exact") setTicked(new Set(nextTicked));

    if (next === "exact" && parts) {
      const byId = new Map(parts.map((p) => [p.id, p.cents]));
      setExactText(Object.fromEntries(people.map((p) => [p.id, byId.has(p.id) ? centsToDecimal(byId.get(p.id)!) : ""])));
    }
    if (next === "percent") {
      const hundredths = parts ? percentsFromAmounts(parts, paidBy) : evenPercents(nextTicked);
      setPercentText(Object.fromEntries(nextTicked.map((id) => [id, String(percentNumber(hundredths.get(id) ?? 0))])));
      if (parts && mode !== "equally") {
        setCarryNote("Percents have 2 decimals, so an amount may move by a cent.");
      }
    }
    if (next === "shares") {
      if (parts && exactTarget !== null) {
        const { shares, exact } = sharesFromAmounts(parts, exactTarget, paidBy);
        setSharesText(Object.fromEntries(nextTicked.map((id) => [id, String(shares.get(id) ?? 1)])));
        if (!exact) {
          setCarryNote(
            "Shares are whole numbers, so they can't match these amounts exactly. These are the closest; check the amounts, or use Exact to keep them as they were.",
          );
        }
      } else {
        setSharesText((current) => ({ ...Object.fromEntries(nextTicked.map((id) => [id, "1"])), ...current }));
      }
    }
    setMode(next);
  }

  // Every problem with the form, each shown under the box it's about. They're worked
  // out again on every change, so they update as you type and clear once fixed.
  // Wrong values show straight away; missing ones only after the first Save.
  function findErrors(includeMissing: boolean): FormErrors {
    const errors: FormErrors = { people: new Map() };

    const length = Array.from(description.trim()).length;
    if (length > DESCRIPTION_MAX) errors.description = `Keep it to ${DESCRIPTION_MAX} characters or fewer.`;
    else if (length === 0 && includeMissing) errors.description = "Say what the expense was for.";

    if (variable) {
      // The amount is asked for each time.
    } else if (fx.isForeign) {
      if (entryCents === null && includeMissing) {
        errors.amount = `Enter the amount in ${currencySymbol(fx.currency)}.`;
      } else if (entryCents === 0 && includeMissing) {
        errors.amount = "The amount must be more than 0.";
      } else if (entry !== null && !fx.rate && includeMissing) {
        errors.amount = fx.state.kind === "own" ? "Type the rate, like 1.3672." : "Wait for the rate, or type your own.";
      } else if (totalCents !== null && !cadInRange(totalCents)) {
        errors.amount = `In Canadian dollars this must be between $0.01 and ${formatCents(MAX_CENTS)}.`;
      }
    } else if (totalCents !== null && totalCents > MAX_CENTS) {
      errors.amount = `The most one expense can be is ${formatCents(MAX_CENTS)}.`;
    } else if (totalCents === null && includeMissing) {
      errors.amount = "Enter the amount, like 12.50.";
    } else if (totalCents === 0 && includeMissing) {
      errors.amount = "The amount must be more than $0.00.";
    }

    if (includeMissing && !people.some((p) => p.id === paidBy)) errors.paidBy = "Choose who paid.";
    if (includeMissing && !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      errors.date = recurring ? "Choose when it starts." : "Choose the date.";
    }
    if (recurring && endOn && endOn < spentOn) errors.date = "The end date can't be before the start.";

    if (mode !== "exact") {
      if (includeMissing && tickedIds.length === 0) {
        errors.split = "Tick at least one person to split with.";
        return errors;
      }
    }
    if (mode === "percent") {
      for (const id of tickedIds) {
        const typed = percentText[id] ?? "";
        if (percents.get(id) === null && (typed !== "" || includeMissing)) {
          errors.people.set(id, "Enter a percent from 0 to 100, like 33.33.");
        }
      }
      if (includeMissing && errors.people.size === 0 && percentTotal !== HUNDRED_PERCENT) {
        errors.split = "The percentages must add up to exactly 100%.";
      }
      return errors;
    }
    if (mode === "shares") {
      for (const id of tickedIds) {
        const typed = sharesText[id] ?? "";
        if (shareCounts.get(id) === null && (typed !== "" || includeMissing)) {
          errors.people.set(id, "Enter a whole number of shares from 1 to 1000.");
        }
      }
      return errors;
    }
    if (mode === "equally") return errors;
    for (const p of people) {
      const cents = exactCents.get(p.id) ?? null;
      if (cents !== null && cents < 0) errors.people.set(p.id, `${whose(p)} can't be less than $0.00.`);
      if (cents !== null && cents > MAX_CENTS) {
        errors.people.set(p.id, `${whose(p)} can't be more than ${formatCents(MAX_CENTS)}.`);
      }
    }
    if (includeMissing && splitIds.length === 0) {
      errors.split = "Enter at least one person's amount.";
    } else if (includeMissing && exactTarget !== null && exactTotal !== exactTarget) {
      errors.split = `The amounts must add up to ${fmtEntry(exactTarget)}.`;
    }
    return errors;
  }

  const errors = findErrors(tried);

  // The box to jump to for the first problem, top to bottom.
  function firstProblemId(found: FormErrors): string | null {
    if (found.description) return ids.description;
    if (found.amount) return ids.amount;
    if (found.paidBy) return ids.paidBy;
    if (found.date) return ids.date;
    const person = people.find((p) => found.people.has(p.id));
    if (person) return `${ids.split}-${person.id}`;
    if (found.split && people.length > 0) return `${ids.split}-${people[0].id}`;
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problemId = firstProblemId(findErrors(true));
    if (problemId || (!variable && amount === null) || (fx.isForeign && (!fx.rate || entry === null))) {
      setTried(true);
      if (problemId) document.getElementById(problemId)?.focus();
      return;
    }
    // Making a private expense visible to the whole group can't be taken back quietly.
    if (expense?.visibility === "participants" && finalVisibility === "group") {
      const sure = await ask(`Everyone in ${group.name} will see this expense. Continue?`, "Continue", false);
      if (!sure) return;
    }
    if (recurring) {
      await saveRecurring();
      return;
    }
    if (amount === null) return;
    // Exact amounts in another currency become CAD shares in proportion.
    const exactCad =
      mode === "exact" && fx.isForeign
        ? foreignToCadShares(amount, splitIds.map((id) => ({ id, hundredths: exactCents.get(id) ?? 0 })), paidBy)
        : null;
    const shares = splitIds.map((id) => ({
      member_id: id,
      share_cents: (mode === "exact" ? (exactCad ? exactCad.get(id) : exactCents.get(id)) : workedOut?.get(id)) ?? 0,
    }));
    const typedValues =
      mode === "percent"
        ? tickedIds.map((id) => ({ member_id: id, value: percents.get(id)! }))
        : mode === "shares"
          ? tickedIds.map((id) => ({ member_id: id, value: shareCounts.get(id)! }))
          : [];
    let expenseId = expense?.id ?? "";
    const saved = await run(
      async () => {
        const result = await supabase.rpc("save_expense", {
          p_group_id: group.id,
          p_description: description.trim(),
          p_amount_cents: amount,
          p_paid_by: paidBy,
          p_shares: shares,
          p_visibility: finalVisibility,
          p_spent_on: spentOn,
          p_expense_id: expense?.id,
          p_category: category,
          // Always sent: on an edit, leaving it out would reset it to "exact".
          p_split: splitForSave(mode, typedValues),
          // Always sent too: leaving them out makes it a plain CAD expense.
          ...(fx.isForeign && fx.rate && entry !== null
            ? {
                p_original_currency: fx.currency,
                p_original_amount_cents: entry,
                p_fx_rate: Number(rateText(fx.rate)),
                ...(fx.state.kind === "bank" ? { p_fx_rate_date: fx.state.date } : {}),
              }
            : {}),
        });
        if (result.data) expenseId = result.data;
        return result;
      },
      undefined,
      false,
    );
    if (!saved || !expenseId) return;

    // The expense is saved whatever happens next; a photo problem only adds a message.
    let receiptNotice: string | null = null;
    if (newPhoto || (removeSaved && expense?.receipt_path)) {
      setSavingPhoto(true);
      receiptNotice = newPhoto ? await attachReceipt(expenseId, newPhoto.blob) : await detachReceipt(expenseId);
      setSavingPhoto(false);
    }
    onDone({ expenseId, receiptNotice });
  }

  // Saves the recurring expense rule (save_recurring); the database makes the expenses.
  async function saveRecurring() {
    if (!recurring) return;
    const members =
      mode === "equally"
        ? wholeGroup
          ? null
          : tickedIds.map((id) => ({ member_id: id, value: 1 }))
        : mode === "percent"
          ? tickedIds.map((id) => ({ member_id: id, value: percents.get(id)! }))
          : mode === "shares"
            ? tickedIds.map((id) => ({ member_id: id, value: shareCounts.get(id)! }))
            : splitIds.map((id) => ({ member_id: id, value: exactCents.get(id) ?? 0 }));
    let ruleId = rule?.id ?? "";
    const ok = await run(
      async () => {
        const result = await supabase.rpc("save_recurring", {
          p_group_id: group.id,
          p_description: description.trim(),
          p_category: category,
          p_paid_by: paidBy,
          p_visibility: finalVisibility,
          p_frequency: frequency,
          p_start_on: spentOn,
          // The generated types say text, but the function takes null for "no end".
          p_end_on: (endOn || null) as string,
          p_amount_kind: variable ? "variable" : "fixed",
          p_amount_cents: (variable ? null : amount) as number,
          p_split: recurringSplitForSave({ method: mode, members }),
          p_id: rule?.id,
        });
        if (result.data) ruleId = result.data;
        return result;
      },
      undefined,
      false,
    );
    if (ok && ruleId) recurring.onSaved(ruleId);
  }

  const onlyNames = peopleInvolved(involved, data, me.id);
  // Ids that link each box to the problem shown under it, for screen readers.
  const errorId = (key: string) => `${ids.split}-problem-${key}`;

  return (
    <>
      <form className="expense-form" onSubmit={handleSubmit} noValidate>
        {!expense && !recurring && <ScanReceipt disabled={working} onScanned={applyScan} />}
        {scanNotes.length > 0 && (
          <div className="scan-notes" role="status">
            {scanNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.description}>What for?</label>
          <div className="description-row">
            <input
              id={ids.description}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={DESCRIPTION_MAX}
              placeholder="For example: Groceries"
              autoComplete="off"
              enterKeyHint="next"
              {...problemProps(errorId("description"), errors.description)}
            />
            <CategoryButton value={category} onPick={setPickedCategory} />
          </div>
          <FieldError id={errorId("description")} text={errors.description} />
          <p className="hint" aria-live="polite">
            Category: {categoryFor(category).label}
          </p>
        </div>

        {recurring && (
          <fieldset>
            <legend>Amount</legend>
            <label className="choice">
              <input type="radio" name="amount-kind" checked={amountKind === "fixed"} onChange={() => setAmountKind("fixed")} />
              <span>The same every time</span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="amount-kind"
                checked={amountKind === "variable"}
                onChange={() => {
                  setAmountKind("variable");
                  if (mode === "exact") switchMode("equally");
                }}
              />
              <span>It changes each time (like a hydro bill)</span>
            </label>
            {variable && (
              <p className="hint">
                Each time it's due, you get a "bill to fill in" on the group page. You type that time's amount, and the
                rest is filled in for you.
              </p>
            )}
          </fieldset>
        )}

        {!variable && (
        <div className="field">
          <div className="amount-label-row">
            <label htmlFor={ids.amount}>
              {fx.isForeign ? `Amount in ${currencySymbol(fx.currency)}` : "Amount (CA$)"}
            </label>
            {canConvert && (
              <select
                className="currency-select"
                value={fx.currency}
                onChange={(event) => chooseCurrency(event.target.value)}
                aria-label="Currency"
              >
                <option value="CAD">CA$ · Canadian Dollar</option>
                {FOREIGN_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {currencySymbol(code)} · {currencyName(code)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="money-input">
            <span aria-hidden="true">{fx.isForeign ? "" : "$"}</span>
            <input
              id={ids.amount}
              value={amountText}
              onChange={(event) => changeAmount(event.target.value)}
              inputMode={currencyDecimals(fx.currency) === 0 ? "numeric" : "decimal"}
              placeholder={currencyDecimals(fx.currency) === 0 ? "0" : "0.00"}
              autoComplete="off"
              enterKeyHint="next"
              className={fx.isForeign ? "no-prefix" : undefined}
              {...problemProps(errorId("amount"), errors.amount)}
            />
          </span>
          <FieldError id={errorId("amount")} text={errors.amount} />
          {fx.isForeign && (
            <RateLine
              fx={fx}
              cadCents={totalCents}
              hasEntry={entry !== null}
              symbol={currencySymbol(fx.currency)}
            />
          )}
        </div>
        )}

        <div className="field">
          <label htmlFor={ids.paidBy}>Paid by</label>
          <select
            id={ids.paidBy}
            value={paidBy}
            onChange={(event) => setPaidBy(event.target.value)}
            {...problemProps(errorId("paid-by"), errors.paidBy)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {nameFor(p)}
              </option>
            ))}
          </select>
          <FieldError id={errorId("paid-by")} text={errors.paidBy} />
        </div>

        {recurring && (
          <div className="field">
            <label htmlFor={`${ids.date}-often`}>How often</label>
            <select id={`${ids.date}-often`} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={recurring ? "date-range" : undefined}>
          <div className="field">
            <label htmlFor={ids.date}>{recurring ? "Starts" : "Date"}</label>
            <input
              id={ids.date}
              type="date"
              value={spentOn}
              onChange={(event) => setSpentOn(event.target.value)}
              {...problemProps(errorId("date"), errors.date)}
            />
          </div>
          {recurring && (
            <div className="field">
              <label htmlFor={`${ids.date}-end`}>Ends (optional)</label>
              <input
                id={`${ids.date}-end`}
                type="date"
                value={endOn}
                min={spentOn || undefined}
                onChange={(event) => setEndOn(event.target.value)}
              />
            </div>
          )}
        </div>
        <FieldError id={errorId("date")} text={errors.date} />
        {recurring && (
          <p className="hint">
            Monthly ones repeat on the start day (the 31st becomes the last day of shorter months). One that starts
            today is added within the hour; dates that have already passed are skipped.
          </p>
        )}

        <fieldset>
          <legend>Split</legend>
          {defaultOutdated && (
            <p className="hint">Default split needs updating: someone joined or left. A group admin can fix it in Group settings.</p>
          )}
          <div className="segmented">
            {SPLIT_METHODS.filter((option) => !(variable && option.key === "exact")).map((option) => (
              <label key={option.key} className="segment">
                <input
                  type="radio"
                  name="split-mode"
                  checked={mode === option.key}
                  onChange={() => switchMode(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          {itemLines && (
            <button type="button" className="button secondary item-split-button" onClick={() => setItemSheetOpen(true)}>
              Split by item
            </button>
          )}
          {recurring && mode === "equally" && (
            <label className="choice">
              <input
                type="checkbox"
                checked={wholeGroup}
                onChange={(event) => {
                  setWholeGroup(event.target.checked);
                  if (event.target.checked) setTicked(new Set(data.members.map((m) => m.id)));
                }}
              />
              <span>Everyone in {group.name}, including people who join later</span>
            </label>
          )}
          {carryNote && (
            <p className="field-note" role="status">
              {carryNote}
            </p>
          )}
          {mode === "percent" && <p className="hint">Tick who's in it, then give each person a percent.</p>}
          {mode === "shares" && (
            <p className="hint">Tick who's in it. Someone with 2 shares pays twice as much as someone with 1.</p>
          )}
          {mode === "exact" && (
            <p className="hint">
              Leave a box empty if that person isn't in it. A box can add and take away, like 10+2.50.
            </p>
          )}
          <ul className="split-list">
            {people.map((p) => {
              const boxId = `${ids.split}-${p.id}`;
              if (mode !== "exact") {
                const isTicked = ticked.has(p.id);
                const valueBox = mode === "percent" || mode === "shares";
                const problem = errors.people.get(p.id);
                return (
                  <li key={p.id}>
                    <label className="choice">
                      <input
                        id={boxId}
                        type="checkbox"
                        checked={isTicked}
                        disabled={recurring !== undefined && mode === "equally" && wholeGroup}
                        onChange={() => toggle(p.id)}
                        {...problemProps(errorId("split"), errors.split)}
                      />
                      <span>{nameFor(p)}</span>
                    </label>
                    {valueBox && isTicked && (
                      <span className="money-input small value-input">
                        <input
                          value={(mode === "percent" ? percentText : sharesText)[p.id] ?? ""}
                          onChange={(event) => changeValue(p.id, event.target.value)}
                          inputMode={mode === "percent" ? "decimal" : "numeric"}
                          placeholder={mode === "percent" ? "0" : "1"}
                          autoComplete="off"
                          aria-label={mode === "percent" ? `${nameFor(p)}: percent` : `${nameFor(p)}: shares`}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? errorId(p.id) : undefined}
                        />
                        <span aria-hidden="true">{mode === "percent" ? "%" : "×"}</span>
                      </span>
                    )}
                    <span className="split-amount">
                      {workedOut?.has(p.id) ? formatCents(workedOut.get(p.id)!) : ""}
                    </span>
                    <FieldError id={errorId(p.id)} text={problem} live />
                  </li>
                );
              }
              const cents = exactCents.get(p.id) ?? null;
              const problem = errors.people.get(p.id);
              const note = !problem && limitNote?.id === p.id ? limitNote.text : undefined;
              return (
                <li key={p.id}>
                  <label htmlFor={boxId}>{nameFor(p)}</label>
                  {exactRead.get(p.id)?.isSum && cents !== null && (
                    <span className="split-sum">= {formatCents(cents)}</span>
                  )}
                  <span className="money-input small">
                    <span aria-hidden="true">$</span>
                    <input
                      id={boxId}
                      value={exactText[p.id] ?? ""}
                      onChange={(event) => changeExact(p.id, event.target.value)}
                      onBlur={() => finishSum(p.id)}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem || note ? errorId(p.id) : undefined}
                    />
                  </span>
                  <FieldError id={errorId(p.id)} text={problem} live />
                  {note && (
                    <p id={errorId(p.id)} className="field-note" role="status">
                      {note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {mode === "percent" && (
            <p className={percentTotal === HUNDRED_PERCENT ? "split-status done" : "split-status"} aria-live="polite">
              {percentTotal === HUNDRED_PERCENT
                ? "Adds up to 100%"
                : percentTotal < HUNDRED_PERCENT
                  ? `${percentNumber(HUNDRED_PERCENT - percentTotal)}% left to give out (now ${percentNumber(percentTotal)}%)`
                  : `${percentNumber(percentTotal - HUNDRED_PERCENT)}% too much (now ${percentNumber(percentTotal)}%)`}
            </p>
          )}
          {mode === "exact" && exactTarget !== null && (
            <p className={exactTotal === exactTarget ? "split-status done" : "split-status"} aria-live="polite">
              {exactTotal < exactTarget && `${fmtEntry(exactTarget - exactTotal)} left to assign`}
              {/* Only happens if the total is made smaller after the amounts are filled in. */}
              {exactTotal > exactTarget &&
                `${fmtEntry(exactTotal - exactTarget)} over the total. Lower an amount to fix it.`}
              {exactTotal === exactTarget && `Adds up to ${fmtEntry(exactTarget)}`}
            </p>
          )}
          <FieldError id={errorId("split")} text={errors.split} />
        </fieldset>

        {!recurring && (
        <fieldset className="receipt-field">
          <legend>Receipt photo</legend>
          {newPhoto ? <ReceiptThumbnail src={newPhoto.url} /> : savedPhoto && <SavedReceipt path={savedPhoto} />}
          {removeSaved && !newPhoto && <p className="hint">The photo will be removed when you save.</p>}
          {preparingPhoto && (
            <p className="hint" role="status">
              Getting the photo ready…
            </p>
          )}
          {/* No "capture", so phones offer both the camera and the gallery. */}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={choosePhoto}
          />
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => photoInput.current?.click()}
              disabled={preparingPhoto || working}
              aria-describedby={photoProblem ? errorId("photo") : undefined}
            >
              {newPhoto || savedPhoto ? "Replace photo" : "Add receipt photo"}
            </button>
            {(newPhoto || savedPhoto) && (
              <button
                type="button"
                className="button secondary danger"
                onClick={removePhoto}
                disabled={preparingPhoto || working}
              >
                Remove photo
              </button>
            )}
          </div>
          {!newPhoto && !savedPhoto && !photoProblem && !preparingPhoto && (
            <p className="hint">Take a photo or choose one. Only people who can see this expense can see it.</p>
          )}
          <FieldError id={errorId("photo")} text={photoProblem ?? undefined} live />
        </fieldset>
        )}

        <fieldset>
          <legend>Who can see this?</legend>
          {onlyMe ? (
            <p className="private-note">
              <LockIcon /> Only you
            </p>
          ) : (
            <>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === "group"}
                  onChange={() => setVisibility("group")}
                />
                <span>Everyone in {group.name}</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === "participants"}
                  onChange={() => setVisibility("participants")}
                />
                <span className="private-note">
                  <LockIcon /> Only {onlyNames}
                </span>
              </label>
            </>
          )}
        </fieldset>

        <FeedbackLine feedback={feedback} />
        <div className="form-actions">
          <button
            type="submit"
            className="button"
            disabled={working || preparingPhoto || (mode === "percent" && !percentsOk)}
          >
            {savingPhoto
              ? "Saving the photo…"
              : recurring
                ? rule
                  ? "Save changes"
                  : "Set up recurring expense"
                : expense
                  ? "Save changes"
                  : "Add expense"}
          </button>
          <button type="button" className="button secondary" onClick={() => onDone()} disabled={working}>
            Cancel
          </button>
        </div>
      </form>
      {dialog}
      {itemSheetOpen && itemLines && (
        <ItemSplitSheet
          lines={itemLines}
          setLines={(update) => setItemLines((current) => (current ? update(current) : current))}
          people={data.members}
          // Items are priced in the receipt's currency, like the Amount box and Exact boxes.
          totalCents={exactTarget}
          format={fmtEntry}
          maxCents={fx.isForeign ? MAX_FOREIGN_CENTS : MAX_CENTS}
          payerId={paidBy}
          nameFor={nameFor}
          onUse={applyItemSplit}
          onClose={() => setItemSheetOpen(false)}
        />
      )}
    </>
  );
}

// How the split starts.
// - A new expense: the group's default split (By % or By shares) if it has one that
//   still works, otherwise equally between everyone.
// - An existing one reopens the way it was made (split_method). Percent and shares
//   come back from the numbers typed then (split_snapshot). Older expenses, saved
//   before this was remembered, open as "Equally" if their shares are exactly an equal
//   split, otherwise as "Exact" with each person's share filled in.
function startingSplit(expense: Expense | undefined, people: Member[], data: GroupData) {
  const blank = { percent: {} as Record<string, string>, shares: {} as Record<string, string> };
  if (!expense) {
    const usable = usableDefault(
      readDefaultSplit(data.group.default_split),
      data.members.map((m) => m.id),
    );
    if (usable) {
      const typed = Object.fromEntries(
        usable.members.map((m) => [m.member_id, String(usable.method === "percent" ? percentNumber(m.value) : m.value)]),
      );
      return {
        mode: usable.method as SplitMode,
        ticked: new Set(usable.members.map((m) => m.member_id)),
        exact: {},
        ...blank,
        [usable.method]: typed,
      };
    }
    return { mode: "equally" as SplitMode, ticked: new Set(people.map((p) => p.id)), exact: {}, ...blank };
  }
  const shares = new Map(expense.shares.map((s) => [s.member_id, s.share_cents]));
  const inSplit = people.filter((p) => shares.has(p.id)).map((p) => p.id);
  const exact: Record<string, string> = {};
  for (const [id, cents] of shares) exact[id] = centsToDecimal(cents);

  if (expense.split_method === "percent" || expense.split_method === "shares") {
    const method = expense.split_method;
    const values = readSnapshot(method, expense.split_snapshot);
    if (values.length > 0) {
      const typed = Object.fromEntries(
        values.map((v) => [v.member_id, String(method === "percent" ? percentNumber(v.value) : v.value)]),
      );
      return { mode: method as SplitMode, ticked: new Set(values.map((v) => v.member_id)), exact, ...blank, [method]: typed };
    }
  }
  if (expense.split_method === "exact") {
    // Saved as exact on purpose, or saved before split methods were remembered:
    // reopen as Equally only if it really is an equal split.
    const equal = splitEqually(expense.amount_cents, inSplit, expense.paid_by);
    const isEqual = inSplit.length === shares.size && inSplit.every((id) => equal.get(id) === shares.get(id));
    return { mode: (isEqual ? "equally" : "exact") as SplitMode, ticked: new Set(inSplit), exact, ...blank };
  }
  return { mode: "equally" as SplitMode, ticked: new Set(inSplit), exact, ...blank };
}

// The starting split from a recurring expense's split (members null = everyone now).
function splitFromTemplate(split: RecurringSplit, people: Member[]) {
  const ids = new Set(people.map((p) => p.id));
  const members = (split.members ?? []).filter((m) => ids.has(m.member_id));
  const all = split.members === null;
  const ticked = new Set(all ? people.map((p) => p.id) : members.map((m) => m.member_id));
  const typed = (fmt: (v: number) => string) => Object.fromEntries(members.map((m) => [m.member_id, fmt(m.value)]));
  return {
    mode: split.method as SplitMode,
    ticked,
    exact: split.method === "exact" ? typed(centsToDecimal) : ({} as Record<string, string>),
    percent: split.method === "percent" ? typed((v) => String(percentNumber(v))) : ({} as Record<string, string>),
    shares: split.method === "shares" ? typed(String) : ({} as Record<string, string>),
    wholeGroup: all,
  };
}

function countPlus(text: string): number {
  return text.split("+").length - 1;
}

// Marks a box as having a problem and links it to the message under it.
function problemProps(errorId: string, problem: string | undefined) {
  return problem ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

// A problem shown right under the box it's about. `live` reads it out as soon as it
// appears (for problems that show up while typing).
function FieldError({ id, text, live }: { id: string; text?: string; live?: boolean }) {
  if (!text) return null;
  return (
    <p id={id} className="field-error" role={live ? "alert" : undefined}>
      {text}
    </p>
  );
}

// What the Amount box shows for an amount in hundredths of a currency:
// "84.50" for US$84.50, "1500" for ¥1,500.
function entryText(hundredths: number, currency: string): string {
  if (currencyDecimals(currency) === 0) return String(Math.round(hundredths / 100));
  return centsToDecimal(hundredths);
}

// The Amount box, read as hundredths of its currency (null = empty).
function readEntry(text: string, currency: string): number | null {
  if (currencyDecimals(currency) === 0) {
    if (!/^\d{1,11}$/.test(text)) return null;
    return Number(text) * 100;
  }
  return readMoney(text)?.cents ?? null;
}

// Under a foreign amount: what it is in CA$, at which rate, and a way to type your own.
function RateLine({
  fx,
  cadCents,
  hasEntry,
  symbol,
}: {
  fx: ReturnType<typeof useForeignAmount>;
  cadCents: number | null;
  hasEntry: boolean;
  symbol: string;
}) {
  const rateId = useId();
  const { state } = fx;
  return (
    <div className="rate-line" aria-live="polite">
      {state.kind === "loading" && <p className="hint">Getting the Bank of Canada rate…</p>}
      {state.kind === "error" && (
        <p className="field-error">
          Couldn't get the rate. Type your own rate.{" "}
          <button type="button" className="link-button" onClick={fx.retry}>
            Try again
          </button>
        </p>
      )}
      {(state.kind === "bank" || state.kind === "own") && state.rate && (
        <p>
          {hasEntry && cadCents !== null ? <strong>= {formatCents(cadCents)}</strong> : "Rate"} at {rateText(state.rate)}{" "}
          <span className="muted">
            {state.kind === "bank" ? `(Bank of Canada, ${formatDay(state.date, true)})` : "(own rate)"}
          </span>
        </p>
      )}
      {fx.ownRateText === null ? (
        <button type="button" className="text-button" onClick={fx.startOwnRate}>
          Change rate
        </button>
      ) : (
        <div className="field own-rate">
          <label htmlFor={rateId}>CA$ for 1 {symbol}</label>
          <input
            id={rateId}
            value={fx.ownRateText}
            inputMode="decimal"
            autoComplete="off"
            placeholder="1.3672"
            onChange={(event) => {
              const tidy = event.target.value.replace(/\s/g, "").replace(/,/g, ".");
              if (/^\d{0,4}(\.\d{0,10})?$/.test(tidy)) fx.setOwnRateText(tidy);
            }}
          />
          <button type="button" className="text-button" onClick={fx.switchToBankRate}>
            Use Bank of Canada rate
          </button>
        </div>
      )}
      <p className="hint">Bank of Canada daily average rates. Your card may have charged a different rate.</p>
    </div>
  );
}
