"use client";

// ════════════════════════════════════════════════════════════════════════════
// Operational-only display.
//
// Calendar display mode 2 of 3 - the one STL-FL forced into the open:
//   1. Homestand fee (4 MLB accounts):   homestand rhythm, no $.
//   2. OPERATIONAL ONLY (STL-FL):        meal counts, NO $, no homestand context.
//   3. Per-meal (everyone else):         meal counts WITH $.
//
// This module is the single source of truth for mode 2. The 6 calendar
// sites that previously had a fee-vs-per-meal binary fork now consume
// this module for the operational-only path.
//
// CORE DISCIPLINE: this file does NOT import fmt$ or any currency
// formatter. A $ figure cannot leak into operational-only display by
// accident, because the renderer literally has no way to format one.
// Adding a $ figure here would require adding that import - visible
// in code review.
//
// Sites that consume this module (kept in sync with ServiceCalendar.js):
//   562  -> OperationalMetricsStrip   (month metrics strip)
//   738  -> OperationalTileBody       (day tile body)
//   784  -> OperationalWeekSummary    (week summary row)
//   837  -> OperationalMonthFooter    (month footer)
//   915  -> isOperationalNoService    (year card noService gate - LOGIC, not JSX)
//   1030 -> OperationalYearCardStats  (year card stats fork)
// ════════════════════════════════════════════════════════════════════════════

import { GREEN, AMBER } from "./ServiceCalendar";

// ───────────────────────────────────────────────────────────────────────────
// Site 562 - month metrics strip (operational-only)
// Drops the per-meal Revenue + Pace tiles. Keeps Meals + Days complete
// + the bulk-mode link.
// ───────────────────────────────────────────────────────────────────────────
export function OperationalMetricsStrip({ metrics, completionPct, onBulkOpen }) {
  return (
    <div className="sc-metrics">
      <div className="sc-metric-block">
        <div className="sc-metric-label">Meals</div>
        <div className="sc-metric-row">
          <span className="sc-metric-hero">{metrics.actMeals.toLocaleString()}</span>
          <span className="sc-metric-context">of {metrics.projMeals.toLocaleString()} projected</span>
        </div>
      </div>
      <div className="sc-metric-divider" />
      <div className="sc-metric-block">
        <div className="sc-metric-label">Days complete</div>
        <div className="sc-metric-row">
          <span className="sc-metric-hero" style={{ color: (metrics.needsEntry + metrics.overdue) > 0 ? AMBER : GREEN }}>{metrics.complete}</span>
          <span className="sc-metric-context">/ {metrics.total}</span>
        </div>
        <div className="sc-progress-bar">
          <div className="sc-progress-fill" style={{ width: completionPct + "%", background: (metrics.needsEntry + metrics.overdue) > 0 ? AMBER : GREEN }} />
        </div>
        {metrics.complete < metrics.total && (
          <div className="sc-metric-warn sc-metric-warn--link" onClick={onBulkOpen}>{metrics.total - metrics.complete} days remaining →</div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Site 738 - tile body (operational-only)
// Drops the per-meal .sc-tile-rev line (where fmt$(revenue) lived).
// Keeps the optional gameType label (incl MiLB pill), meals line, and the
// no-service fallback.
//
// hasActuals MUST come from the same source object the per-meal branch
// reads (dd.hasActuals from the rendered day) so the two paths can never
// disagree about whether the day is entered.
// ───────────────────────────────────────────────────────────────────────────
export function OperationalTileBody({ meals, gameType, milbPill, status, hasActuals }) {
  return (
    <>
      {gameType && (
        <div className="sc-tile-game">
          {milbPill ? (
            <span className={`sc-mlb-pill sc-mlb-pill--${milbPill}`}>
              <span className="sc-mlb-pill-dot" />
              {milbPill === "day" ? "Day" : "Night"}
            </span>
          ) : gameType}
        </div>
      )}
      {status === "no-service" ? (
        <div className="sc-tile-noservice">No service</div>
      ) : (
        <div className={`sc-tile-meals ${hasActuals ? "" : "sc-tile-meals--proj"}`}>
          {meals.toLocaleString()} meals
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Site 784 - week summary (operational-only)
// Drops the per-meal .sc-week-rev span (fmt$(wRev)). Keeps entered/total.
// entered and total must come from the same source the per-meal branch
// uses (wEntered.length / wDays.length) so the two paths agree on
// whether days are entered.
// ───────────────────────────────────────────────────────────────────────────
export function OperationalWeekSummary({ entered, total }) {
  return <span className="sc-week-progress">{entered}/{total} entered</span>;
}

// ───────────────────────────────────────────────────────────────────────────
// Site 837 - month footer (operational-only)
// Drops the per-meal .sc-month-footer-rev span. Keeps month + entered +
// needs + upcoming text. All counts come from metrics (the same source
// the per-meal branch uses) so the two paths can never disagree about
// the month-level state.
// ───────────────────────────────────────────────────────────────────────────
export function OperationalMonthFooter({ monthLabel, complete, needsEntry, overdue, total, done, warn }) {
  return (
    <div className={`sc-month-footer ${done ? "sc-month-footer--done" : warn ? "sc-month-footer--warn" : ""}`}>
      <span>{monthLabel} · {complete} entered · {needsEntry + overdue} need entry · {total - complete - needsEntry - overdue} upcoming</span>
      {/* Deliberately no right-side $ figure. Operational-only mode. */}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Site 915 - year card noService gate (operational-only)
// LOGIC, not JSX. Returns boolean.
//
// Per-meal uses revenue===0 to detect "no service" - which is ALWAYS true
// for STL-FL (its per-meal prices are $0 by design; revenue is tracked
// in the contract-revenue layer, not here). This detects on COUNT-based
// signals instead:
//   - missing month payload, OR
//   - totalDays === 0 (no service days at all), OR
//   - zero projected AND zero actual meals (nothing was planned and
//     nothing was logged).
//
// Sidesteps the $0-price trap; STL-FL months with real meal-count
// activity correctly show as having service.
// ───────────────────────────────────────────────────────────────────────────
export function isOperationalNoService(md) {
  if (!md) return true;
  if (md.totalDays === 0) return true;
  return (md.totalProjectedMeals || 0) === 0 && (md.totalActualMeals || 0) === 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Site 1030 - year card stats fork (operational-only)
// Drops the per-meal .sc-year-card-rev span (fmtK(displayRev)).
// Keeps entered/total count from md, which is the same payload the
// per-meal branch reads.
// ───────────────────────────────────────────────────────────────────────────
export function OperationalYearCardStats({ md }) {
  return (
    <div className="sc-year-card-stats">
      <span>{md?.daysWithActuals || 0}/{md?.totalDays || 0} entered</span>
      {/* Deliberately no right-side $ figure. */}
    </div>
  );
}
