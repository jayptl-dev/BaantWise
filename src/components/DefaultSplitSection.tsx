import { useId, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  defaultSplitForSave,
  defaultSplitNeedsUpdate,
  evenPercents,
  HUNDRED_PERCENT,
  percentNumber,
  readDefaultSplit,
  readPercent,
  readShares,
  type DefaultSplit,
} from "../lib/splitMethods";
import { mustChange } from "../lib/useDbAction";
import type { GroupData } from "../lib/useGroup";

type Method = DefaultSplit["method"];

// Group settings, admins only: how new expenses in this group are split to start with.
// It only pre-fills Add expense; people can still change the split on each expense.
// The database checks the shape again and only lets admins change it.
export function DefaultSplitSection({
  data,
  busy,
  run,
}: {
  data: GroupData;
  busy: boolean;
  run: (change: () => PromiseLike<{ error: { message: string } | null }>, successText?: string) => Promise<boolean>;
}) {
  const { group, members } = data;
  const ids = useId();
  const saved = readDefaultSplit(group.default_split);
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState<Method>(saved?.method ?? "shares");
  const [values, setValues] = useState<Record<string, string>>(() => startValues(saved, members.map((m) => m.id)));
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(saved ? saved.members.map((m) => m.member_id).filter((id) => members.some((m) => m.id === id)) : members.map((m) => m.id)),
  );
  const [tried, setTried] = useState(false);

  const needsUpdate = saved !== null && defaultSplitNeedsUpdate(saved, members.map((m) => m.id));
  const tickedIds = members.filter((m) => ticked.has(m.id)).map((m) => m.id);
  const read = (id: string) => (method === "percent" ? readPercent(values[id] ?? "") : readShares(values[id] ?? ""));
  const allRead = tickedIds.length > 0 && tickedIds.every((id) => read(id) !== null);
  const percentTotal = tickedIds.reduce((sum, id) => sum + (method === "percent" ? (read(id) ?? 0) : 0), 0);
  const valid = allRead && (method === "shares" || percentTotal === HUNDRED_PERCENT);

  function switchMethod(next: Method) {
    setMethod(next);
    setTried(false);
    if (next === "percent") {
      const even = evenPercents(tickedIds);
      setValues(Object.fromEntries(tickedIds.map((id) => [id, String(percentNumber(even.get(id)!))])));
    } else {
      setValues(Object.fromEntries(members.map((m) => [m.id, "1"])));
    }
  }

  async function save() {
    setTried(true);
    if (!valid) return;
    const split: DefaultSplit = { method, members: tickedIds.map((id) => ({ member_id: id, value: read(id)! })) };
    const ok = await run(
      () =>
        mustChange(
          supabase.from("groups").update({ default_split: defaultSplitForSave(split) }, { count: "exact" }).eq("id", group.id),
          "Only a group admin can do this",
        ),
      "Default split saved. New expenses will start with it.",
    );
    if (ok) setEditing(false);
  }

  async function clear() {
    const ok = await run(
      () =>
        mustChange(
          supabase.from("groups").update({ default_split: null }, { count: "exact" }).eq("id", group.id),
          "Only a group admin can do this",
        ),
      "New expenses will be split equally between everyone again.",
    );
    if (ok) setEditing(false);
  }

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "Someone who left";

  return (
    <section className="section" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Default split</h2>
      <p className="muted">How new expenses start out. People can still change the split on each expense.</p>
      {needsUpdate && (
        <p className="feedback error" role="status">
          Default split needs updating: someone joined or left since it was set.
        </p>
      )}

      {!editing && (
        <>
          <p>
            {saved
              ? `${saved.method === "percent" ? "By percent" : "By shares"}: ` +
                saved.members
                  .map((m) => `${nameOf(m.member_id)} ${saved.method === "percent" ? `${percentNumber(m.value)}%` : `×${m.value}`}`)
                  .join(", ")
              : "Equally between everyone."}
          </p>
          <div className="button-row">
            <button type="button" className="button secondary" onClick={() => setEditing(true)} disabled={busy}>
              Set default split
            </button>
            {saved && (
              <button type="button" className="button secondary" onClick={clear} disabled={busy}>
                Go back to equally
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="expense-form">
          <div className="segmented">
            {(["percent", "shares"] as const).map((m) => (
              <label key={m} className="segment">
                <input type="radio" name={`${ids}-method`} checked={method === m} onChange={() => switchMethod(m)} />
                <span>{m === "percent" ? "Percent" : "Shares"}</span>
              </label>
            ))}
          </div>
          <ul className="split-list">
            {members.map((m) => (
              <li key={m.id}>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={ticked.has(m.id)}
                    onChange={() => {
                      if (!values[m.id] && method === "shares") setValues((v) => ({ ...v, [m.id]: "1" }));
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      });
                    }}
                  />
                  <span>{m.display_name}</span>
                </label>
                {ticked.has(m.id) && (
                  <span className="money-input small value-input">
                    <input
                      value={values[m.id] ?? ""}
                      inputMode={method === "percent" ? "decimal" : "numeric"}
                      autoComplete="off"
                      aria-label={`${m.display_name}: ${method === "percent" ? "percent" : "shares"}`}
                      aria-invalid={tried && read(m.id) === null ? true : undefined}
                      onChange={(event) => {
                        const tidy = event.target.value.replace(/\s/g, "").replace(/,/g, ".");
                        const fits = method === "percent" ? /^\d{0,3}(\.\d{0,2})?$/.test(tidy) : /^\d{0,4}$/.test(tidy);
                        if (fits) setValues((v) => ({ ...v, [m.id]: tidy }));
                      }}
                    />
                    <span aria-hidden="true">{method === "percent" ? "%" : "×"}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {method === "percent" && (
            <p className={percentTotal === HUNDRED_PERCENT ? "split-status done" : "split-status"} aria-live="polite">
              {percentTotal === HUNDRED_PERCENT ? "Adds up to 100%" : `Now ${percentNumber(percentTotal)}%. It must add up to 100%.`}
            </p>
          )}
          {tried && !valid && (
            <p className="field-error" role="alert">
              {tickedIds.length === 0
                ? "Tick at least one person."
                : method === "percent"
                  ? "Give everyone ticked a percent, adding up to exactly 100%."
                  : "Give everyone ticked a whole number of shares from 1 to 1000."}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="button" onClick={save} disabled={busy}>
              Save default split
            </button>
            <button type="button" className="button secondary" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function startValues(saved: DefaultSplit | null, memberIds: string[]): Record<string, string> {
  if (!saved) return Object.fromEntries(memberIds.map((id) => [id, "1"]));
  return Object.fromEntries(
    saved.members.map((m) => [m.member_id, String(saved.method === "percent" ? percentNumber(m.value) : m.value)]),
  );
}
