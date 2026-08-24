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
import HelpPop from "./HelpPop.js";

// PR-E - custom-range card popovers per kitchfix-help-copy.html
// (section "Custom range · the two cards that exist TODAY"). Verbatim.
// BUDGET side explains the pro-rate slicing; SPENT side underlines that
// the dollars are exact even though the yardstick is arithmetic.
const CUSTOM_BUDGET_BODY = (
  <>
    <b>Budgets are set by period, not by day.</b> So for a range that does not land on whole weeks, this takes that week&apos;s share of the days you picked.
    <br /><br />
    The label tells you exactly which slice - <b>&ldquo;4 of 7 days of wk 08/03&rdquo;</b> means four sevenths of that week&apos;s target.
    <br /><br />
    It is the right yardstick for a short range, but nobody set it as a goal. Your spend beside it is exact; this side is arithmetic.
    <span className="kpi-hs-pop-foot">Pick a range that starts on a Monday and ends on a Sunday and no slicing happens - you get the real weekly budget.</span>
  </>
);

const CUSTOM_SPENT_BODY = (
  <>
    <b>Every dollar here is real</b> - actual hourly labor on the exact days you picked, down to the day.
    <br /><br />
    The comparison underneath is against the pro-rated budget, so read it as a rough check rather than a verdict. <b>The spend is precise; the yardstick is a slice.</b>
    <span className="kpi-hs-pop-foot">Days with no bar are days nobody worked - a genuine zero, not missing data.</span>
  </>
);

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

function DayBar({ day, dailyTarget, scale, todayISO, density, variant, gameDates, nightGameDates }) {
  const amount = day.amountX10000 / 10000;
  const isToday = day.workDate === todayISO;
  const isFuture = day.workDate > todayISO;
  const isZero = !isFuture && amount <= 0.5;
  const barPct = isFuture ? 0 : Math.max(0, Math.min(100, (amount / scale) * 90));
  // Fill class: variance encodes STATE (green under, amber running today);
  // identity encodes IDENTITY (navy night, blue day, hatch prep, stub zero).
  // Owner reminder 2026-08-21: identity variant must never use green
  // or red - those mean under/over budget on the rail card, and a
  // green day-game would read as "good" when it only means daylight.
  let barCls;
  if (variant === "identity") {
    if (isZero || isFuture) barCls = "kpi-wb-bar kpi-hs-day-zero";
    else if (nightGameDates?.has(day.workDate)) barCls = "kpi-wb-bar kpi-hs-day-night";
    else if (gameDates?.has(day.workDate)) barCls = "kpi-wb-bar kpi-hs-day-day";
    else barCls = "kpi-wb-bar kpi-hs-day-prep";
  } else {
    barCls = isToday ? "kpi-wb-bar kpi-wb-bar-prog" : "kpi-wb-bar kpi-wb-bar-under";
  }
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
  // Owner ruling 2026-08-24: on a future range (server flag
  // `is_future_range`, true when start > today) the SPENT card
  // suppresses the variance line + colour class. Reads
  // `$0.00 · this range has not started` in muted grey. The pre-fix
  // path rendered `$0.00 · Under pro-rated budget · $18,000` in
  // green - reading as an accomplishment when nothing has happened.
  // BUDGET card + day-strip empty bars unchanged; knowing the
  // pro-rated budget before the range starts is useful for planning.
  const isFutureRange = data?.is_future_range === true;
  const variance = spentTotal - budgetTotal;
  const varianceCls = isFutureRange
    ? "kpi-spend-cell-mute"
    : Math.abs(variance) < 0.5
      ? "kpi-spend-cell-under"
      : variance > 0
        ? "kpi-spend-cell-over"
        : "kpi-spend-cell-under";
  const varianceLabel = isFutureRange
    ? "this range has not started"
    : Math.abs(variance) < 0.5
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
          <div className="kpi-day-range-card-eyebrow">
            BUDGET
            <HelpPop id="qCustomBudget" title="Budget for these days" body={CUSTOM_BUDGET_BODY} />
          </div>
          <div className="kpi-day-range-card-figure">{fmt$(budgetTotal)}</div>
          {budget_prorate?.label && (
            <div className="kpi-day-range-card-sub">{budget_prorate.label}</div>
          )}
        </div>
        <div className="kpi-day-range-card">
          <div className="kpi-day-range-card-eyebrow">
            SPENT
            <HelpPop id="qCustomSpent" title="What these days cost" body={CUSTOM_SPENT_BODY} />
          </div>
          <div className="kpi-day-range-card-figure">{fmt$(spentTotal)}</div>
          <div className={`kpi-day-range-card-sub ${varianceCls}`}>
            {varianceLabel}
            {/* Amount only when there IS a variance to name. On a
                future range the label is "this range has not started"
                and no dollar figure follows - the label is the whole
                message. */}
            {!isFutureRange && Math.abs(variance) >= 0.5 ? ` · ${fmt$(Math.abs(variance))}` : ""}
          </div>
        </div>
      </div>

      <DayStripPlot
        perDay={perDay}
        dailyTarget={dailyTarget}
        scale={scale}
        todayISO={todayISO}
        variant="variance"
      />
    </div>
  );
}

// The bar plot in isolation - callable from any parent card that
// wants a per-day strip without the CUSTOM RANGE header + budget/spent
// summary. Owner ruling 2026-08-21 after PR-2 review: keep density
// picker + layout + zero-day stub in ONE place, only the fill rule
// branches on `variant`. See DayBar for the identity vs variance
// fill logic.
export function DayStripPlot({
  perDay, dailyTarget = 0, scale, todayISO,
  variant = "variance",
  gameDates,           // Set<ISO string>  - required for variant="identity"
  nightGameDates,      // Set<ISO string>  - required for variant="identity"
  ariaLabel = "Per-day labor",
}) {
  // Measure the plot strip and pick the caption density from the
  // actual per-bar pixel width. Kevin's field measurement: at
  // 1920px the plot is 1162px so N=10 gives 103px per bar (full);
  // at 375px the plot is ~340px so N=10 gives 34px per bar
  // (minimal). A count-based rule cannot distinguish those. Both
  // variants share this picker so a density fix lands once.
  const stripRef = useRef(null);
  const n = perDay?.length || 0;
  const [density, setDensity] = useState(() => chooseLabelDensity(0, n));
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setDensity(chooseLabelDensity(w, n));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  const effectiveScale = scale ?? (() => {
    let max = dailyTarget || 1;
    for (const d of perDay || []) if (d.amountX10000 / 10000 > max) max = d.amountX10000 / 10000;
    return max * 1.10;
  })();

  return (
    <div
      ref={stripRef}
      className="kpi-wbars kpi-day-range-strip"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}
      data-density={density}
      data-variant={variant}
      aria-label={ariaLabel}
    >
      {(perDay || []).map(day => (
        <DayBar
          key={day.workDate}
          day={day}
          dailyTarget={variant === "variance" ? dailyTarget : null}
          scale={effectiveScale}
          todayISO={todayISO}
          density={density}
          variant={variant}
          gameDates={gameDates}
          nightGameDates={nightGameDates}
        />
      ))}
    </div>
  );
}

// Convenience: same aggregator the custom-range path uses, exported
// for callers that already have actuals_daily rows in hand.
export { aggregatePerDay, isoRange };
