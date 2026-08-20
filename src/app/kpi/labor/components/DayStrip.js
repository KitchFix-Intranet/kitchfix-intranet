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

import { useEffect, useRef, useState } from "react";
import { fmt$, fmtDate } from "../lib/formatting.js";
import {
  isoRange,
  aggregatePerDay,
  chooseLabelDensity,
} from "@/lib/labor/dayRangeAggregate";

// Compact date "MM/DD". fmtDate returns "MM/DD/YY" which is fine at
// wide bars but collides at narrow ones. Dropping the year is safe
// because the range header above the strip carries the full dates
// with year - the per-bar label only needs to disambiguate within
// the range.
function fmtDayLabel(iso) {
  const [ , m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}`;
}

function dowShort(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function DayBar({ day, dailyTarget, scale, todayISO, density }) {
  const amount = day.amountX10000 / 10000;
  const isToday = day.workDate === todayISO;
  const isFuture = day.workDate > todayISO;
  const isZero = !isFuture && amount <= 0.5;
  const barPct = isFuture ? 0 : Math.max(0, Math.min(100, (amount / scale) * 90));
  const barCls = isToday ? "kpi-wb-bar kpi-wb-bar-prog" : "kpi-wb-bar kpi-wb-bar-under";
  const targetPct = (dailyTarget != null && dailyTarget > 0)
    ? Math.max(0, Math.min(100, (dailyTarget / scale) * 90))
    : null;

  // Caption form is driven by the MEASURED per-bar width in the
  // parent's ResizeObserver, not by day count. See
  // chooseLabelDensity in src/lib/labor/dayRangeAggregate.js for
  // the boundaries (>= 90px full, >= 44px compact, < 44px minimal)
  // and the probe P11 for the assertion.
  const dateStr = fmtDayLabel(day.workDate);
  const caption = density === "full"
    ? `${dateStr} · ${dowShort(day.workDate)}`
    : density === "compact"
      ? dateStr
      : null;   // minimal: no date caption, value only

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
        {caption != null && (
          <span className="kpi-wb-dates" title={day.workDate}>{caption}</span>
        )}
      </div>
    </div>
  );
}

export function DayStrip({ data, todayISO }) {
  const { filters, actuals_daily, actuals_range, budget_prorate, range } = data;
  const days = isoRange(filters.start, filters.end);
  const { perDay } = aggregatePerDay(actuals_daily, days);
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

  // Measure the plot strip and pick the caption density from the
  // actual per-bar pixel width. Kevin's field measurement: at
  // 1920px the plot is 1162px so N=10 gives 103px per bar (full);
  // at 375px the plot is ~340px so N=10 gives 34px per bar
  // (minimal). A count-based rule cannot distinguish those. The
  // pure chooseLabelDensity(width, count) function is in
  // dayRangeAggregate.js so the probe can drive both boundaries
  // without a viewport it cannot resize in CI.
  const stripRef = useRef(null);
  const [density, setDensity] = useState(() => chooseLabelDensity(0, days.length));
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setDensity(chooseLabelDensity(w, days.length));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);

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
        ref={stripRef}
        className="kpi-wbars kpi-day-range-strip"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}
        data-density={density}
      >
        {perDay.map(day => (
          <DayBar
            key={day.workDate}
            day={day}
            dailyTarget={dailyTarget}
            scale={scale}
            todayISO={todayISO}
            density={density}
          />
        ))}
      </div>
    </div>
  );
}
