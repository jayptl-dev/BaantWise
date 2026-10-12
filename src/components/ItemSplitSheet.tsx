import { useId, useState } from "react";
import { centsToDecimal, formatCents, MAX_CENTS, readMoney } from "../lib/money";
import type { ScannedItem } from "../lib/receiptScan";
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
  totalCents: number | null; // the expense's Amount
  payerId: string;
  nameFor: (member: Member) => string;
  onUse: (shares: Map<string, number>) => void; // only people above $0
  onClose: () => void;
};

// "Split by item": tick who had each thing on the receipt. Tax, tip and anything else
// not on an item are shared in proportion. The items are only used for this split;
// they're never saved.
export function ItemSplitSheet({ lines, setLines, people, totalCents, payerId, nameFor, onUse, onClose }: ItemSplitSheetProps) {
  const ids = useId();
  const [open, setOpen] = useState<number | null>(lines[0]?.key ?? null);

  const cents = (line: Line) => readMoney(line.amountText)?.cents ?? 0;
  const itemsTotal = lines.reduce((sum, line) => sum + cents(line), 0);
  const rest = totalCents === null ? null : totalCents - itemsTotal;
  const everyItemHasSomeone = lines.length > 0 && lines.every((line) => line.people.size > 0);
  const amountOk = totalCents !== null && totalCents > 0 && totalCents <= MAX_CENTS;
  const ready = amountOk && everyItemHasSomeone;

  function change(key: number, update: (line: Line) => Line) {
    setLines((current) => current.map((line) => (line.key === key ? update(line) : line)));
  }

  function togglePerson(key: number, memberId: string) {
    change(key, (line) => {
      const next = new Set(line.people);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return { ...line, people: next };
    });
  }

  function use() {
    if (!ready || totalCents === null) return;
    const shares = splitByItems(
      totalCents,
      lines.map((line) => ({ amountCents: cents(line), memberIds: [...line.people] })),
      people.map((p) => p.id),
      payerId,
    );
    onUse(new Map([...shares].filter(([, c]) => c > 0)));
  }

  function whoLine(line: Line): string {
    if (line.people.size === 0) return "Nobody yet";
    if (line.people.size === people.length && people.length > 1) return "Everyone";
    return people
      .filter((p) => line.people.has(p.id))
      .map((p) => p.display_name)
      .join(", ");
  }

  return (
    <Sheet title="Split by item" onClose={onClose}>
      <p className="hint">Tap an item, then tick who had it. Tap someone again to untick them.</p>
      {lines.length === 0 && <p className="muted">No items left.</p>}
      <ul className="item-list">
        {lines.map((line) => {
          const isOpen = open === line.key;
          return (
            <li key={line.key} className={line.people.size === 0 ? "item needs-person" : "item"}>
              <button
                type="button"
                className="item-summary"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : line.key)}
              >
                <span className="item-name">{line.name || "Item"}</span>
                <span className="item-amount">{formatCents(cents(line))}</span>
                <span className="item-who">{whoLine(line)}</span>
              </button>
              {isOpen && (
                <div className="item-edit">
                  <div className="item-people">
                    {people.map((p) => (
                      <label key={p.id} className="choice">
                        <input
                          type="checkbox"
                          checked={line.people.has(p.id)}
                          onChange={() => togglePerson(line.key, p.id)}
                        />
                        <span>{nameFor(p)}</span>
                      </label>
                    ))}
                  </div>
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
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() => {
                      setLines((current) => current.filter((l) => l.key !== line.key));
                      setOpen(null);
                    }}
                  >
                    Remove this item
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="item-footer" aria-live="polite">
        {rest === null ? (
          <p className="field-error">Enter the expense's Amount first.</p>
        ) : (
          <p>
            Tax, tip and other: <strong>{formatCents(rest)}</strong>, shared in proportion
          </p>
        )}
        {amountOk && !everyItemHasSomeone && lines.length > 0 && (
          <p className="hint">Every item needs at least one person.</p>
        )}
      </div>
      <div className="form-actions">
        <button type="button" className="button" onClick={use} disabled={!ready}>
          Use this split
        </button>
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
