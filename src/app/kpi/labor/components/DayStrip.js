"use client";
// src/app/kpi/labor/components/DayStrip.js
//
// PR-3b - the day strip. When the labor route returns source='daily'
// the week strip becomes a per-day strip: one bar per day, the same
// visual grammar as TierAWeekBar (kpi-wb / kpi-wb-plot / kpi-wb-bar
// / kpi-wb-cap classes), the pro-rated daily target as the reference
// line, and no period-shaped signals - projection, pace, projected
// close, and weekly allowance ABSENT (spec C2), not zeroed. All four
// assume a period; rendering them would be arithmetic on a fiction.
//
// The pro-rate label the server sends on budget_prorate is rendered
// verbatim; the client never restates or reformats it (spec).

import { fmt$, fmtDate } from "../lib/formatting.js";

const MS_PER_DAY = 86400000;

function isoRange(startISO, endISO) {
  const out = [];
  let cur = new Date(`${startISO}T00:00:00.000Z`).getTime();
  const end = new Date(`${endISO}T00:00:00.000Z`).getTime();
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += MS_PER_DAY;
  }
  return out;
}

// Aggregate actuals_daily into per-day totals. Integer-cent accumulator
// so a cross-grain sum stays exact to the cent.
function aggregatePerDay(actualsDaily, days) {
  const bucket = new Map(days.map(d => [d, 0]));
  for (const r of (actualsDaily || [])) {
    if (!bucket.has(r.work_date)) continue;
    bucket.set(r.work_date, bucket.get(r.work_date) + Math.round(Number(r.amount || 0) * 10000));
  }
  return days.map(d => ({ workDate: d, amountX10000: bucket.get(d) }));
}

function DayBar({ day, dailyTarget, scale, todayISO }) {
  const amount = day.amountX10000 / 10000;
  const isToday = day.workDate === todayISO;
  const isFuture = day.workDate > todayISO;
  const isZero = !isFuture && amount <= 0.5;
  const barPct = isFuture ? 0 : Math.max(0, Math.min(100, (amount / scale) * 90));
  const barCls = isToday ? "kpi-wb-bar kpi-wb-bar-prog" : "kpi-wb-bar kpi-wb-bar-under";
  const targetPct = (dailyTarget != null && dailyTarget > 0)
    ? Math.max(0, Math.min(100, (dailyTarget / scale) * 90))
    : null;

  const dowLabel = new Date(`${day.workDate}T00:00:00.000Z`)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

  return (
    <div className="kpi-wb">
      <div className="kpi-wb-plot">
        {targetPct != null && (
          <span className="kpi-wb-target" style={{ bottom: `${targetPct}%` }} />
        )}
        {isFuture || isZero ? (
          <div className="kpi-wb-basel" />
        ) : (
          <div className={barCls} style={{ height: `${Math.max(barPct, 2)}%` }} />
        )}
      </div>
      <div className="kpi-wb-cap">
        <b className="kpi-wb-cap-value">{isFuture ? "—" : fmt$(amount)}</b>
        <span className="kpi-wb-dates">{fmtDate(day.workDate)} · {dowLabel}</span>
      </div>
    </div>
  );
}

export function DayStrip({ data, todayISO }) {
  const { filters, actuals_daily, actuals_range, budget_prorate, range } = data;
  const days = isoRange(filters.start, filters.end);
  const perDay = aggregatePerDay(actuals_daily, days);
  const budgetTotal = Number(budget_prorate?.total || 0);
  const spentTotal = (actuals_range || [])
    .filter(r => !r.salaried)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const dailyTarget = days.length > 0 ? budgetTotal / days.length : 0;
  const scale = (() => {
    let max = dailyTarget || 1;
    for (const d of perDay) if (d.amountX10000 / 10000 > max) max = d.amountX10000 / 10000;
    return max * 1.10;
  })();

  const spanDays = range?.span_days ?? days.length;
  const variance = spentTotal - budgetTotal;
  const varianceCls = Math.abs(variance) < 0.5
    ? "kpi-spend-cell-under"
    : variance > 0
      ? "kpi-spend-cell-over"
      : "kpi-spend-cell-under";
  const varianceLabel = Math.abs(variance) < 0.5
    ? "On the pro-rated line"
    : variance > 0
      ? "Over pro-rated budget"
      : "Under pro-rated budget";

  return (
    <div className="kpi-day-range" role="region" aria-label="Custom range summary">
      <header className="kpi-day-range-hdr">
        <div className="kpi-day-range-title">
          <span className="kpi-day-range-eyebrow">CUSTOM RANGE</span>
          <span className="kpi-day-range-dates">
            {fmtDate(filters.start)} – {fmtDate(filters.end)} · {spanDays} day{spanDays === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="kpi-day-range-cards">
        <div className="kpi-day-range-card">
          <div className="kpi-day-range-card-eyebrow">BUDGET</div>
          <div className="kpi-day-range-card-figure">{fmt$(budgetTotal)}</div>
          {budget_prorate?.label && (
            <div className="kpi-day-range-card-sub">{budget_prorate.label}</div>
          )}
        </div>
        <div className="kpi-day-range-card">
          <div className="kpi-day-range-card-eyebrow">SPENT</div>
          <div className="kpi-day-range-card-figure">{fmt$(spentTotal)}</div>
          <div className={`kpi-day-range-card-sub ${varianceCls}`}>
            {varianceLabel}{Math.abs(variance) >= 0.5 ? ` · ${fmt$(Math.abs(variance))}` : ""}
          </div>
        </div>
      </div>

      <div
        className="kpi-wbars kpi-day-range-strip"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}
      >
        {perDay.map(day => (
          <DayBar
            key={day.workDate}
            day={day}
            dailyTarget={dailyTarget}
            scale={scale}
            todayISO={todayISO}
          />
        ))}
      </div>
    </div>
  );
}
