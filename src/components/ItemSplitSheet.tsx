import { useId, useState } from "react";
import { centsToDecimal, formatCents, MAX_CENTS, readMoney } from "../lib/money";
import type { ScannedItem } from "../lib/receiptScan";
import { carryForward, firstUnticked, itemsSoFar } from "../lib/itemSplit";
import { splitByItems } from "../lib/split";
import type { Member } from "../lib/useGroup";
import { Sheet } from "./Sheet";

export type ItemLine = { key: number; name: string; amountText: string; people: Set<string> };
type Line = ItemLine;

// The scanned items as editable lines, nobody ticked yet.
export function linesFromScan(items: ScannedItem[]): ItemLine[] {
  return items.map((item, index) => ({
    key: index,
    name: item.name,
    amountText: centsToDecimal(item.amountCents),
    people: new Set<string>(),
  }));
}

type ItemSplitSheetProps = {
  // Kept by the form, so ticks survive closing and reopening the sheet.
  lines: ItemLine[];
  setLines: (update: (current: ItemLine[]) => ItemLine[]) => void;
  people: Member[]; // in member order
  totalCents: number | null; // the expense's Amount, in the expense's own currency
  format?: (cents: number) => string; // how to write amounts (default CA$); a US$ receipt passes its own
  maxCents?: number; // the largest Amount allowed in that currency
  payerId: string;
  nameFor: (member: Member) => string;
  onUse: (shares: Map<string, number>) => void; // only people above $0
  onClose: () => void;
};

// "Split by item", one item at a time: pick the item (dropdown, or Back and Next), tick
// who had it, and see each person's running total. Moving on to an item nobody is
// ticked on starts it with the same people as the item before. Tax, tip and anything
// else not on an item are shared in proportion. The items are only used for this
// split; they're never saved.
export function ItemSplitSheet({
  lines,
  setLines,
  people,
  totalCents,
  format = formatCents,
  maxCents = MAX_CENTS,
  payerId,
  nameFor,
  onUse,
  onClose,
}: ItemSplitSheetProps) {
  const ids = useId();
  const [index, setIndex] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);

  const cents = (line: Line) => readMoney(line.amountText)?.cents ?? 0;
  const steps = lines.map((line) => ({ amountCents: cents(line), people: line.people }));
  const itemsTotal = steps.reduce((sum, step) => sum + step.amountCents, 0);
  const rest = totalCents === null ? null : totalCents - itemsTotal;
  const everyItemHasSomeone = lines.length > 0 && firstUnticked(steps) === -1;
  const amountOk = totalCents !== null && totalCents > 0 && totalCents <= maxCents;
  const order = people.map((p) => p.id);
  const soFar = itemsSoFar(steps, order, payerId);

  const at = Math.min(index, Math.max(lines.length - 1, 0));
  const line: Line | undefined = lines[at];
  const isLast = at >= lines.length - 1;

  function change(key: number, update: (line: Line) => Line) {
    setLines((current) => current.map((l) => (l.key === key ? update(l) : l)));
  }

  function setPeople(next: Set<string>) {
    if (!line) return;
    setWarning(null);
    change(line.key, (l) => ({ ...l, people: next }));
  }

  function togglePerson(memberId: string) {
    if (!line) return;
    const next = new Set(line.people);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    setPeople(next);
  }

  function goTo(to: number) {
    setWarning(null);
    setIndex(Math.max(0, Math.min(to, lines.length - 1)));
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    // The ticks carry over to the next item if nobody is on it yet.
    setLines((current) => carryForward(current, at, at + 1));
    goTo(at + 1);
  }

  function finish() {
    if (!amountOk || totalCents === null) {
      setWarning("Enter the expense's Amount first.");
      return;
    }
    const missing = firstUnticked(steps);
    if (missing !== -1) {
      setIndex(missing);
      setWarning(`Nobody is ticked for "${lines[missing].name || "this item"}". Tick at least one person.`);
      return;
    }
    const shares = splitByItems(
      totalCents,
      lines.map((l) => ({ amountCents: cents(l), memberIds: [...l.people] })),
      order,
      payerId,
    );
    onUse(new Map([...shares].filter(([, c]) => c > 0)));
  }

  function removeItem() {
    if (!line) return;
    setWarning(null);
    setLines((current) => current.filter((l) => l.key !== line.key));
    setIndex(Math.max(0, Math.min(at, lines.length - 2)));
  }

  const nextLabel = isLast ? "Done" : "Next";

  return (
    <Sheet title="Split by item" onClose={onClose}>
      {!line ? (
        <p className="muted">No items left.</p>
      ) : (
        <>
          <p className="item-step-count">
            Item {at + 1} of {lines.length}
          </p>
          <div className="item-picker">
            <label className="visually-hidden" htmlFor={`${ids}-pick`}>
              Item
            </label>
            <select id={`${ids}-pick`} value={at} onChange={(event) => goTo(Number(event.target.value))}>
              {lines.map((l, i) => (
                <option key={l.key} value={i}>
                  {l.people.size > 0 ? "✓ " : ""}
                  {i + 1}. {l.name || "Item"} · {format(cents(l))}
                </option>
              ))}
            </select>
            <button type="button" className="button" onClick={next}>
              {nextLabel}
            </button>
          </div>

          <div className="item-quick">
            <span className="hint">Who had it?</span>
            <button type="button" className="text-button" onClick={() => setPeople(new Set(order))}>
              Everyone
            </button>
            <button type="button" className="text-button" onClick={() => setPeople(new Set())}>
              Clear
            </button>
          </div>
          <div className="item-people" role="group" aria-label={`Who had ${line.name || "this item"}`}>
            {people.map((p) => (
              <label key={p.id} className="choice item-person">
                <input type="checkbox" checked={line.people.has(p.id)} onChange={() => togglePerson(p.id)} />
                <span>{nameFor(p)}</span>
                <span className="item-person-total">{format(soFar.get(p.id) ?? 0)}</span>
              </label>
            ))}
          </div>
          <p className="hint">Amounts are each person's items so far, before tax and tip.</p>

          {warning && (
            <p className="field-error" role="alert">
              {warning}
            </p>
          )}

          <div className="item-step-actions">
            <button type="button" className="button secondary" onClick={() => goTo(at - 1)} disabled={at === 0}>
              Back
            </button>
            <button type="button" className="button" onClick={next}>
              {nextLabel}
            </button>
          </div>

          <details className="item-fix">
            <summary>Fix this item's name or price</summary>
            <div className="item-fields">
              <div className="field">
                <label htmlFor={`${ids}-name-${line.key}`}>Item</label>
                <input
                  id={`${ids}-name-${line.key}`}
                  value={line.name}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(event) => change(line.key, (l) => ({ ...l, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor={`${ids}-amount-${line.key}`}>Price</label>
                <span className="money-input">
                  <span aria-hidden="true">$</span>
                  <input
                    id={`${ids}-amount-${line.key}`}
                    value={line.amountText}
                    inputMode="decimal"
                    autoComplete="off"
                    onChange={(event) => {
                      const read = readMoney(event.target.value);
                      if (read) change(line.key, (l) => ({ ...l, amountText: read.text }));
                    }}
                  />
                </span>
              </div>
            </div>
            <button type="button" className="text-button danger-text" onClick={removeItem}>
              Remove this item
            </button>
          </details>
        </>
      )}

      <div className="item-footer" aria-live="polite">
        {rest === null ? (
          <p className="field-error">Enter the expense's Amount first.</p>
        ) : (
          <p>
            Tax, tip and other: <strong>{format(rest)}</strong>, shared in proportion
          </p>
        )}
        {lines.length > 0 && !everyItemHasSomeone && (
          <p className="hint">
            {lines.length - steps.filter((s) => s.people.size > 0).length} of {lines.length} items still need someone.
          </p>
        )}
      </div>
      <div className="form-actions">
        {everyItemHasSomeone && !isLast && (
          <button type="button" className="button" onClick={finish}>
            Use this split
          </button>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
