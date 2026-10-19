import { useId, useState } from "react";
import { centsToDecimal, formatCents, MAX_CENTS, readMoney } from "../lib/money";
import type { ScannedItem } from "../lib/receiptScan";
import { carryForward, firstUnticked, itemsSoFar } from "../lib/itemSplit";
import {
  addPart,
  breakLine,
  canAddPart,
  canBreak,
  canGrow,
  canShrink,
  isBreakableCount,
  joinBack,
  MAX_COUNT,
  moveOne,
  partLabel,
  partsOf,
  removeLine,
  setLineName,
  setLinePrice,
} from "../lib/breakLine";
import { splitByItems } from "../lib/split";
import type { Member } from "../lib/useGroup";
import { Sheet } from "./Sheet";

// printed: the line as on the receipt, shown small under the plain name so it can be
// matched to the paper; null when it reads the same.
// quantity: how many are on the receipt line (from the scanner, or typed in; a weight
// like 0.535 is possible), null when unknown. part: set when the line has been broken
// into parts (lib/breakLine.ts); then quantity is the whole line's count.
export type ItemLine = {
  key: number;
  name: string;
  printed: string | null;
  amountText: string;
  people: Set<string>;
  quantity?: number | null;
  part?: { line: number; count: number };
};
type Line = ItemLine;

// The scanned items as editable lines, nobody ticked yet.
export function linesFromScan(items: ScannedItem[]): ItemLine[] {
  return items.map((item, index) => ({
    key: index,
    name: item.name,
    printed: item.printed,
    amountText: centsToDecimal(item.amountCents),
    people: new Set<string>(),
    quantity: item.quantity > 0 ? item.quantity : null,
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
// else not on an item are shared in proportion. The items and ticks are saved with the
// expense (lib/expenseItems.ts), so the sheet opens as it was left when editing.
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
  // "Break this line" on a line whose count isn't known: asks how many first.
  const [askCount, setAskCount] = useState<{ key: number; text: string } | null>(null);
  // What's being typed in a broken line's price box (its parts get repriced as you type).
  const [priceDraft, setPriceDraft] = useState<{ key: number; text: string } | null>(null);

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
    const remaining = removeLine(lines, line.key);
    setLines(() => remaining);
    setIndex(Math.max(0, Math.min(at, remaining.length - 1)));
  }

  // Break this line into parts. With a known count of 2 or more it breaks right away;
  // otherwise it asks how many are on the line first.
  function startBreak() {
    if (!line) return;
    setWarning(null);
    if (isBreakableCount(line.quantity)) {
      const count = line.quantity;
      setLines((current) => breakLine(current, line.key, count));
      setAskCount(null);
    } else {
      setAskCount({ key: line.key, text: "" });
    }
  }

  function breakWithTypedCount() {
    if (!line || !askCount) return;
    const count = Number(askCount.text);
    if (!isBreakableCount(count)) {
      setWarning(`Type how many are on this line, from 2 to ${MAX_COUNT}.`);
      return;
    }
    setWarning(null);
    setLines((current) => breakLine(current, line.key, count));
    setAskCount(null);
  }

  function addOnePart() {
    if (!line) return;
    const result = addPart(lines, line.key);
    if (result.added === null) return;
    setWarning(null);
    setLines(() => result.lines);
    setIndex(result.lines.findIndex((l) => l.key === result.added));
  }

  function join() {
    if (!line) return;
    const parts = partsOf(lines, line.key);
    const joined = joinBack(lines, line.key);
    setWarning(null);
    setLines(() => joined);
    setIndex(Math.max(0, joined.findIndex((l) => l.key === parts[0]?.key)));
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
                  {i + 1}. {l.name || "Item"}
                  {partLabel(l) ? ` (${partLabel(l)})` : ""} · {format(cents(l))}
                </option>
              ))}
            </select>
            <button type="button" className="button" onClick={next}>
              {nextLabel}
            </button>
          </div>

          {line.printed && <p className="item-printed">On the receipt: {line.printed}</p>}

          {line.part ? (
            <PartControls
              lines={lines}
              line={line}
              format={format}
              onMove={(direction) => setLines((current) => moveOne(current, line.key, direction))}
              onAddPart={addOnePart}
              onJoin={join}
            />
          ) : (
            canBreak(line) && (
              <div className="item-break">
                {askCount?.key === line.key ? (
                  <div className="item-break-ask">
                    <label htmlFor={`${ids}-count-${line.key}`}>How many are on this line?</label>
                    <input
                      id={`${ids}-count-${line.key}`}
                      value={askCount.text}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      autoFocus
                      onChange={(event) => setAskCount({ key: line.key, text: event.target.value.replace(/\D/g, "") })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          breakWithTypedCount();
                        }
                      }}
                    />
                    <button type="button" className="button secondary" onClick={breakWithTypedCount}>
                      Break
                    </button>
                    <button type="button" className="text-button" onClick={() => setAskCount(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="text-button" onClick={startBreak}>
                    {isBreakableCount(line.quantity)
                      ? `Break this line (${line.quantity} on it) to share it differently`
                      : "Several on this line? Break it to share it differently"}
                  </button>
                )}
              </div>
            )
          )}

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
            <summary>{line.part ? "Fix this line's name or price" : "Fix this item's name, price or count"}</summary>
            <div className="item-fields">
              <div className="field">
                <label htmlFor={`${ids}-name-${line.key}`}>Item</label>
                <input
                  id={`${ids}-name-${line.key}`}
                  value={line.name}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(event) => {
                    const name = event.target.value;
                    setLines((current) => setLineName(current, line.key, name));
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${ids}-amount-${line.key}`}>{line.part ? "Whole line's price" : "Price"}</label>
                <span className="money-input">
                  <span aria-hidden="true">$</span>
                  {line.part ? (
                    <input
                      id={`${ids}-amount-${line.key}`}
                      value={
                        priceDraft?.key === line.part.line
                          ? priceDraft.text
                          : centsToDecimal(partsOf(lines, line.key).reduce((sum, p) => sum + cents(p), 0))
                      }
                      inputMode="decimal"
                      autoComplete="off"
                      onChange={(event) => {
                        const read = readMoney(event.target.value);
                        if (!read || !line.part) return;
                        setPriceDraft({ key: line.part.line, text: read.text });
                        setLines((current) => setLinePrice(current, line.key, Math.max(0, read.cents ?? 0)));
                      }}
                      onBlur={() => setPriceDraft(null)}
                    />
                  ) : (
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
                  )}
                </span>
              </div>
              {!line.part && (
                <div className="field">
                  <label htmlFor={`${ids}-qty-${line.key}`}>How many on this line</label>
                  <input
                    id={`${ids}-qty-${line.key}`}
                    value={
                      typeof line.quantity === "number" && Number.isInteger(line.quantity) ? String(line.quantity) : ""
                    }
                    placeholder={typeof line.quantity === "number" && !Number.isInteger(line.quantity) ? String(line.quantity) : "1"}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={2}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      change(line.key, (l) => ({ ...l, quantity: digits === "" ? null : Number(digits) }));
                    }}
                  />
                </div>
              )}
            </div>
            <button type="button" className="text-button danger-text" onClick={removeItem}>
              {line.part ? "Remove this whole line" : "Remove this item"}
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

type PartControlsProps = {
  lines: ItemLine[];
  line: ItemLine;
  format: (cents: number) => string;
  onMove: (direction: 1 | -1) => void;
  onAddPart: () => void;
  onJoin: () => void;
};

// For one part of a broken line: which part this is, how many it has (− and + move one
// to or from the line's other parts), its share of the price, and Add a part / Join back.
function PartControls({ lines, line, format, onMove, onAddPart, onJoin }: PartControlsProps) {
  const parts = partsOf(lines, line.key);
  const number = parts.findIndex((p) => p.key === line.key) + 1;
  const count = line.part?.count ?? 0;
  const name = line.name || "this item";
  return (
    <div className="item-part">
      <p className="item-part-title">
        Part {number} of {parts.length} · <strong>{partLabel(line)}</strong> · {format(readMoney(line.amountText)?.cents ?? 0)}
      </p>
      <div className="item-part-count" role="group" aria-label={`How many of ${name} in this part`}>
        <button
          type="button"
          className="button secondary item-part-step"
          onClick={() => onMove(-1)}
          disabled={!canShrink(lines, line.key)}
          aria-label="One fewer in this part"
        >
          −
        </button>
        <span className="item-part-number" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          className="button secondary item-part-step"
          onClick={() => onMove(1)}
          disabled={!canGrow(lines, line.key)}
          aria-label="One more in this part"
        >
          +
        </button>
      </div>
      <div className="item-part-actions">
        <button type="button" className="text-button" onClick={onAddPart} disabled={!canAddPart(lines, line.key)}>
          Add a part
        </button>
        <button type="button" className="text-button" onClick={onJoin}>
          Join back into one line
        </button>
      </div>
    </div>
  );
}
