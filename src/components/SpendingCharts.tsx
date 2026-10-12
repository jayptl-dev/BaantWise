import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { categoryFor, isCategoryKey, type CategoryKey } from "../lib/categories";
import { formatDay, shorten, todayLocal } from "../lib/format";
import { formatCents } from "../lib/money";
import {
  PERIODS,
  barSize,
  categoryTotals,
  emptyPeriodLine,
  isPeriod,
  monthLabel,
  monthlyTotals,
  percentOf,
  rowsInPeriod,
  type Period,
  type SpendingRow,
} from "../lib/spending";
import { CategoryEmoji } from "./CategoryEmoji";

const MONTHS_SHOWN = 12;

// The two charts and the list behind a tapped category, shared by the group
// "Spending" screen and "My spending". The chosen period and category live in the
// address (?period=…&category=…), so Back from an expense returns to the same view.
// Every number is real text next to its bar (no chart picture), so screen readers
// and big text sizes work.
export function SpendingCharts({ rows, mine }: { rows: SpendingRow[]; mine: boolean }) {
  const [params, setParams] = useSearchParams();
  const periodParam = params.get("period");
  const period: Period = isPeriod(periodParam) ? periodParam : "this_month";
  const categoryParam = params.get("category");
  const category: CategoryKey | null = isCategoryKey(categoryParam) ? categoryParam : null;
  const today = todayLocal();

  function choose(next: { period?: Period; category?: CategoryKey | null }) {
    const p = new URLSearchParams();
    const nextPeriod = next.period ?? period;
    const nextCategory = next.category === undefined ? category : next.category;
    if (nextPeriod !== "this_month") p.set("period", nextPeriod);
    if (nextCategory) p.set("category", nextCategory);
    setParams(p, { replace: true });
  }

  return (
    <>
      <PeriodSwitch period={period} onChange={(p) => choose({ period: p })} />
      {category ? (
        <CategoryList
          rows={rows}
          period={period}
          category={category}
          today={today}
          mine={mine}
          onBack={() => choose({ category: null })}
        />
      ) : (
        <>
          <CategoryBars rows={rows} period={period} today={today} mine={mine} onPick={(c) => choose({ category: c })} />
          <MonthBars rows={rows} today={today} mine={mine} />
        </>
      )}
    </>
  );
}

function PeriodSwitch({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const name = useId();
  return (
    <fieldset className="period-switch">
      <legend className="visually-hidden">Time period</legend>
      <div className="segmented">
        {PERIODS.map((p) => (
          <label key={p.key} className="segment">
            <input type="radio" name={name} checked={period === p.key} onChange={() => onChange(p.key)} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CategoryBars(props: {
  rows: SpendingRow[];
  period: Period;
  today: string;
  mine: boolean;
  onPick: (category: CategoryKey) => void;
}) {
  const { rows, period, today, mine, onPick } = props;
  const totals = useMemo(() => categoryTotals(rows, period, today), [rows, period, today]);
  const all = totals.reduce((sum, t) => sum + t.totalCents, 0);
  const biggest = totals[0]?.totalCents ?? 0;

  return (
    <section className="section" aria-labelledby="by-category">
      <h2 id="by-category">By category</h2>
      {totals.length === 0 ? (
        <p className="muted">{emptyPeriodLine(period, mine)}</p>
      ) : (
        <>
          <p className="chart-total">
            Total: <strong>{formatCents(all)}</strong>
          </p>
          <ul className="bar-list">
            {totals.map((t) => {
              const { label } = categoryFor(t.category);
              return (
                <li key={t.category}>
                  <button type="button" className="bar-row" onClick={() => onPick(t.category)}>
                    <span className="bar-label">
                      <CategoryEmoji category={t.category} /> {label}
                    </span>
                    <span className="bar-value">
                      {formatCents(t.totalCents)} · {percentOf(t.totalCents, all)}
                    </span>
                    <span className="bar-track" aria-hidden="true">
                      <span className="bar-fill" style={{ width: `${barSize(t.totalCents, biggest)}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hint">Tap a category to see its expenses.</p>
        </>
      )}
    </section>
  );
}

function MonthBars({ rows, today, mine }: { rows: SpendingRow[]; today: string; mine: boolean }) {
  const months = useMemo(() => monthlyTotals(rows, MONTHS_SHOWN, today), [rows, today]);
  const biggest = Math.max(0, ...months.map((m) => m.totalCents));
  const thisYear = today.slice(0, 4);

  return (
    <section className="section" aria-labelledby="by-month">
      <h2 id="by-month">Last 12 months</h2>
      {biggest === 0 ? (
        <p className="muted">
          {mine ? "You don't have any spending in the last 12 months." : "No group expenses in the last 12 months."}
        </p>
      ) : (
        <ul className="month-bars">
          {months.map((m) => (
            <li key={m.month}>
              <span className="month-value">{m.totalCents > 0 ? formatCents(m.totalCents) : "$0"}</span>
              <span className="month-track" aria-hidden="true">
                <span className="month-fill" style={{ height: `${barSize(m.totalCents, biggest)}%` }} />
              </span>
              <span className="month-label">{monthLabel(m.month, !m.month.startsWith(thisYear))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The expenses behind one category bar, in the chosen period.
function CategoryList(props: {
  rows: SpendingRow[];
  period: Period;
  category: CategoryKey;
  today: string;
  mine: boolean;
  onBack: () => void;
}) {
  const { rows, period, category, today, mine, onBack } = props;
  const shown = useMemo(
    () => rowsInPeriod(rows, period, today).filter((r) => r.category === category && r.amountCents > 0),
    [rows, period, category, today],
  );
  const total = shown.reduce((sum, r) => sum + r.amountCents, 0);
  const { label } = categoryFor(category);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase() ?? "";

  return (
    <section className="section" aria-labelledby="category-heading">
      <button type="button" className="text-button" onClick={onBack}>
        ← All categories
      </button>
      <h2 id="category-heading">
        <CategoryEmoji category={category} /> {label}
      </h2>
      {shown.length === 0 ? (
        <p className="muted">Nothing in {label} {period === "all_time" ? "yet" : periodLabel}.</p>
      ) : (
        <>
          <p className="chart-total">
            {mine ? "Your share" : "Total"}, {periodLabel}: <strong>{formatCents(total)}</strong>
          </p>
          <ul className="expense-list">
            {shown.map((r) => (
              <li key={r.id}>
                <Link to={`/groups/${r.groupId}/expenses/${r.id}`} className="expense-link">
                  <span className="expense-main">
                    <span className="expense-title">{shorten(r.description, 50)}</span>
                    <span className="expense-sub">
                      {[formatDay(r.spentOn, true), mine ? r.groupName : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="my-part">
                    {mine && <span className="visually-hidden">Your share: </span>}
                    <strong>{formatCents(r.amountCents)}</strong>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
