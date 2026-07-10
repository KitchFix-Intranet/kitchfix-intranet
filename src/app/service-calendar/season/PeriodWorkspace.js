"use client";

// PeriodWorkspace - Stage 3 of the SC redesign.
//
// Replaces PeriodLensView (the validated week-button + slide model)
// with the new layout (spec section 5):
//   1. Nav: climb-to-Season + prev/next period + Today jump.
//   2. Human-anchored title + phase.
//   3. Financial frame forked by billing model.
//   4. Today hero (only on the current period, when today is unentered).
//   5. All-weeks day grid (7-wide, DOW-aligned, atom at lg). NO week
//      buttons. NO directional slide.
//   6. Quiet week-subtotals footnote.
//   7. Bulk-entry affordance (mode toggle; tile clicks select while
//      bulkMode=true; existing sc-bulk-submit handler stays).
//
// PRESENTATIONAL. State + handlers live in ServiceCalendar.js. The
// workspace consumes the existing periodDays + periodMetrics (the
// post-B2a memos) and the existing bulk handlers - no engine change,
// no data fork, no new effects.
//
// DayDetail wiring (Decision 2 - spec 11.3 fix): the workspace passes
// scopeLabel="period" + periodRevenue as monthRevenue so DayDetail's
// "% of {scope}" readout reads correctly when opened from here. The
// surgical DayDetail change keeps legacy callers working (default
// scopeLabel="month").

import { useEffect, useMemo, useRef, useState } from "react";
import DaySquare from "../DaySquare";
import {
  resolveDayStatus,
  resolveDayKind,
  isPastDate,
} from "../dayResolvers";
import { CheckCircle } from "../Icons";
import { fmt$ } from "./format";
import ProgressBar from "./ProgressBar";
import "./periodWorkspace.css";

export default function PeriodWorkspace({
  account,                  // { key, name, category, billingModel }
  year,
  periodKey,
  periodRange,              // { period, start, end } - the active period
  periodRanges,             // array (for prev/next clamp)
  periodDays,               // memoized days[] for the period (null until loaded)
  periodMetrics,            // memoized totals + week subtotals
  hasHomestandSchedule,
  isFeeAccount,
  isMilb,
  homestandMap,
  today,                    // YYYY-MM-DD string
  loading,
  loadState = "loaded",     // SC-047: "loading" | "loaded" | "failed"
  partialError,
  // day click + bulk
  onDayClick,
  bulkMode,
  onBulkModeToggle,         // (next: bool) => void
  bulkSelected,             // Set<dateStr>
  onBulkTileClick,          // (dateStr) => void (toggles selection)
  onBulkOpenPanel,          // opens the existing bulk entry panel
  onBulkReview,             // opens the "match projections" review overlay
  onBulkConfirmAsProjected, // runs handleBulkConfirm (kept for compat -
                            // no longer wired from BulkAffordance; the
                            // review overlay owns the call now)
  onBulkCancel,             // exits bulk mode + clears selection
  saving,
  scope = "period",         // "period" | "month" - month drops the week
                            // subtotals (fiscal-week labels collide on a
                            // calendar month spanning two periods).
  // Exception-chip jumps in the per-meal strip. Both jump to the OLDEST
  // day of the given status inside the current drill (not year-scoped).
  onJumpFirstOverdue,
  onJumpFirstNeeds,
  // F3: Set<YYYY-MM-DD> of dates whose sc-submit-day is queued locally
  // in the current account; each matching cell overlays a SYNCING badge
  // on the DaySquare below.
  syncingDates,
}) {
  const kind = useMemo(
    () => resolveDayKind({
      billingModel: account?.billingModel,
      category: account?.category,
      hasHomestandSchedule,
    }),
    [account?.billingModel, account?.category, hasHomestandSchedule]
  );

  // Detect current period: today's date is in the period's range.
  // Drives the today hero rendering + the Today jump tooltip.
  const isCurrentPeriod = useMemo(
    () => Boolean(periodRange && today >= periodRange.start && today <= periodRange.end),
    [periodRange, today]
  );

  // Week-aligned cell grid. ~4-5 rows of 7 cells. Out-of-period
  // slots in the first/last row render as quiet placeholders, NOT
  // through the atom (preserves the atom's "actual day rendering"
  // contract). SC-047: when the drill fetch failed and there are no
  // real days, fabricate in-period stubs so renderCell can force each
  // to the dashed atom via loadState.
  const cells = useMemo(
    () => buildWorkspaceWeekGrid(periodRange, periodDays, loadState),
    [periodRange, periodDays, loadState]
  );

  // Week labels present in this period (W1-W4 typically). Used for
  // the quiet subtotals footnote.
  const weekLabels = useMemo(() => {
    if (!periodDays?.length) return [];
    const seen = new Set();
    for (const d of periodDays) {
      const w = d.meta?.week;
      if (w && !seen.has(w)) seen.add(w);
    }
    return [...seen].sort();
  }, [periodDays]);

  // Today's day record (when the current period contains it). Drives
  // the today hero.
  const todayDay = useMemo(
    () => isCurrentPeriod && periodDays
      ? periodDays.find(d => d.date === today) || null
      : null,
    [isCurrentPeriod, periodDays, today]
  );

  // ─── Loading / partial / empty branches ──────────────────────
  // SC-047: on total drill failure, skip the loading skeleton and
  // render the workspace shell; cells resolve to the dashed atom via
  // the loadState pass-through. Matches the SC-033 overview pattern.
  if (loading && !periodDays && !partialError && loadState !== "failed") {
    return <WorkspaceSkeleton tileCount={skeletonTileCount(periodRange)} />;
  }
  if (partialError) {
    return (
      <div className="sc-workspace sc-fade-in">
        <WorkspacePartialBanner failedMonth={partialError.failedMonth} />
        <WorkspaceSkeleton inline tileCount={skeletonTileCount(periodRange)} />
      </div>
    );
  }
  if (!periodRange) {
    return (
      <div className="sc-workspace sc-fade-in">
        <div className="sc-workspace-empty">Pick a period from the Season grid.</div>
      </div>
    );
  }

  const m = periodMetrics || { projMeals: 0, actMeals: 0, projRev: 0, actRev: 0, complete: 0, needsEntry: 0, overdue: 0, total: 0, weeks: {} };

  return (
    <div className="sc-workspace sc-fade-in">
      <FinancialFrame
        m={m}
        kind={kind}
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        periodRange={periodRange}
        today={today}
        onJumpFirstOverdue={onJumpFirstOverdue}
        onJumpFirstNeeds={onJumpFirstNeeds}
        todaySlot={isCurrentPeriod && todayDay ? (
          <TodayRail
            day={todayDay}
            kind={kind}
            homestandMap={homestandMap}
            onEnterActuals={() => onDayClick?.(todayDay.date)}
            onBulkUpdate={onBulkModeToggle ? () => onBulkModeToggle(true) : undefined}
          />
        ) : (
          // SC-040: past-scope drill with unentered days keeps a bulk
          // entry point. For MLB (schedule view per SC-037b) needsEntry
          // + overdue are both zero via the pipeline unification, so
          // the rail auto-hides there - correct per the ruling.
          !isCurrentPeriod
            && periodRange?.end
            && today
            && today > periodRange.end
            && (m.needsEntry + m.overdue) > 0
        ) ? (
          <PastRail
            unentered={m.needsEntry + m.overdue}
            periodRange={periodRange}
            scope={scope}
            onBulkUpdate={onBulkModeToggle ? () => onBulkModeToggle(true) : undefined}
          />
        ) : null}
      />

      <BulkAffordance
        bulkMode={bulkMode}
        bulkSelected={bulkSelected}
        saving={saving}
        onToggle={onBulkModeToggle}
        onCancel={onBulkCancel}
        onOpenPanel={onBulkOpenPanel}
        onReview={onBulkReview}
      />

      <DayGrid
        cells={cells}
        today={today}
        kind={kind}
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
        homestandMap={homestandMap}
        bulkMode={bulkMode}
        bulkSelected={bulkSelected}
        loadState={loadState}
        onDayClick={onDayClick}
        onBulkTileClick={onBulkTileClick}
      />

      {scope !== "month" && (
        <WeekSubtotals
          weekLabels={weekLabels}
          weekMetrics={m.weeks}
          kind={kind}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
        />
      )}

    </div>
  );
}

// ─── Financial frame ─────────────────────────────────────────────
// Three forks, locked to billing model (spec 6):
//   per-meal: $ entered / projected / delta + days bar
//   mlb-fee (homestand): completeness (game-days entered) + meals
//   fee-no-dollar (STL-FL): days entered + meals YTD, NO $ tokens
//
// Mobile Overhaul D2 (P1-9 the "0/28" punitive fix): when the
// period is entirely future / unstarted (no entered days AND today
// is before the period's start date), render a calm "Upcoming"
// frame instead of the punitive "0 / 28" with an empty bar.
function FinancialFrame({ m, kind, hasHomestandSchedule, isFeeAccount, periodRange, today, todaySlot, onJumpFirstOverdue, onJumpFirstNeeds }) {
  const completionPct = m.total > 0 ? Math.round(m.complete / m.total * 100) : 0;
  // SC-037(b): homestand accounts are pure schedule view - no amber
  // trigger, no urgency chips (classifier folds unentered games to
  // "future" so the counts would be zero anyway; the removal makes
  // the intent structural, not incidental).
  const progressColor = hasHomestandSchedule
    ? "var(--text-success)"
    : ((m.needsEntry + m.overdue) > 0 ? "var(--status-needs-strong)" : "var(--text-success)");

  // Upcoming-period detection: today is before periodRange.start AND
  // nothing has been entered yet. The whole period is in the future.
  const isUpcoming = m.complete === 0
    && periodRange?.start
    && today
    && today < periodRange.start;

  if (isUpcoming) {
    const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startDt = new Date(periodRange.start + "T12:00:00");
    const startLabel = `${MON[startDt.getMonth()]} ${startDt.getDate()}`;
    return (
      <section className="sc-workspace-frame sc-workspace-frame--upcoming">
        <div className="sc-workspace-frame-upcoming">
          <span className="sc-workspace-frame-upcoming-tag">Upcoming</span>
          <span className="sc-workspace-frame-upcoming-title">Starts {startLabel}</span>
          {m.total > 0 && (
            <span className="sc-workspace-frame-upcoming-sub">
              {m.total} service {m.total === 1 ? "day" : "days"} scheduled
            </span>
          )}
        </div>
      </section>
    );
  }

  // Fee accounts (MLB homestand + STL-FL operational-only) render the
  // same twin-stat/divider/progress/chips layout as per-meal: one
  // visual family across account types. Stat contents differ (day-
  // completion + meal counts, no revenue tint since STL-FL/MLB don't
  // carry per-meal $) but the shape is identical.
  // SC-037(b): MLB homestand loses the chips entirely - schedule view,
  // not urgency tracker. STL-FL keeps them; SC-038's pipeline
  // unification makes STL-FL's chip counts match its tiles now.
  if (hasHomestandSchedule || isFeeAccount) {
    const showUrgencyChips = !hasHomestandSchedule;
    const exceptionCount = m.overdue + m.needsEntry;
    const daysLabel = hasHomestandSchedule ? "Game days entered" : "Days entered";
    return (
      <section className="sc-workspace-frame sc-workspace-frame--per-meal">
        <div className="sc-workspace-frame-band">
          <div className="sc-workspace-frame-stats">
            <div className="sc-workspace-frame-stat">
              <span className="sc-workspace-frame-stat-num">
                {m.complete}<span className="sc-workspace-frame-stat-num-total">/{m.total}</span>
              </span>
              <span className="sc-workspace-frame-stat-label">{daysLabel}</span>
            </div>
            <span className="sc-workspace-frame-stat-divider" aria-hidden="true" />
            <div className="sc-workspace-frame-stat">
              <span className="sc-workspace-frame-stat-num">
                {m.actMeals.toLocaleString("en-US")}
              </span>
              <span className="sc-workspace-frame-stat-label">Meal counts</span>
            </div>
          </div>
          <div className="sc-workspace-frame-progress">
            <div className="sc-workspace-frame-progress-label">
              <span>Progress</span>
              <strong style={{ color: progressColor }}>{completionPct}%</strong>
            </div>
            <ProgressLine pct={completionPct} color={progressColor} />
          </div>
          {showUrgencyChips && (exceptionCount > 0 ? (
            <span className="sc-workspace-frame-chips">
              {m.overdue > 0 && (
                <button
                  type="button"
                  className="sc-workspace-frame-chip sc-workspace-frame-chip--overdue"
                  onClick={onJumpFirstOverdue}
                  aria-label={`Jump to first of ${m.overdue} overdue days`}
                >
                  <span className="sc-workspace-frame-chip-glyph" aria-hidden="true">!</span>
                  {m.overdue} overdue
                </button>
              )}
              {m.needsEntry > 0 && (
                <button
                  type="button"
                  className="sc-workspace-frame-chip sc-workspace-frame-chip--needs"
                  onClick={onJumpFirstNeeds}
                  aria-label={`Jump to first of ${m.needsEntry} days needing entry`}
                >
                  <span className="sc-workspace-frame-chip-glyph" aria-hidden="true">✎</span>
                  {m.needsEntry} need entry
                </button>
              )}
            </span>
          ) : (
            <span className="sc-workspace-frame-caughtup" aria-live="polite">
              ✓ All caught up
            </span>
          ))}
        </div>
        {todaySlot}
      </section>
    );
  }

  // Per-meal + MiLB - the financial-clarity strip (PR B redesign).
  // Half-height Option 2: entered $ leads inline with a small "entered"
  // label + "of $X projected" context, days/pending + progress ride the
  // same band, todaySlot is a slim full-bleed second tier beneath.
  // Projection-gap delta ("to go" / "ahead") removed - a projected
  // target invents a false goal/failure.
  const exceptionCount = m.overdue + m.needsEntry;
  return (
    <section className="sc-workspace-frame sc-workspace-frame--per-meal">
      <div className="sc-workspace-frame-band">
        <div className="sc-workspace-frame-stats">
          {/* SC-067 (render C2-modified): the ENTERED · PROJECTED
              lockup rebuilds as a stacked pair with the word "of"
              between the figures. Each figure splits into a symbol
              span (--sym) + a number span (--num), the label indents
              to align with the first digit past the $/~$, and the
              muted "of ~$X" trails the projected side. Fee accounts
              keep their twin-stat header - this touches per-meal only. */}
          <div className="sc-workspace-frame-stat sc-workspace-frame-stat--lockup">
            <div className="sc-workspace-lockup">
              <div className="sc-workspace-lockup-row sc-workspace-lockup-row--entered">
                <span className="sc-workspace-lockup-sym">$</span>
                <span className="sc-workspace-lockup-num">{Math.round(m.actRev).toLocaleString("en-US")}</span>
              </div>
              <span className="sc-workspace-lockup-of" aria-hidden="true">of</span>
              <div className="sc-workspace-lockup-row sc-workspace-lockup-row--projected">
                <span className="sc-workspace-lockup-sym">~$</span>
                <span className="sc-workspace-lockup-num">{Math.round(m.projRev).toLocaleString("en-US")}</span>
              </div>
            </div>
            <div className="sc-workspace-lockup-labels" aria-hidden="true">
              <span className="sc-workspace-lockup-label sc-workspace-lockup-label--entered">Entered</span>
              <span className="sc-workspace-lockup-label sc-workspace-lockup-label--projected">Projected</span>
            </div>
            <span className="sc-workspace-frame-stat-label sr-only">Entered of Projected</span>
          </div>
          <span className="sc-workspace-frame-stat-divider" aria-hidden="true" />
          <div className="sc-workspace-frame-stat">
            <span className="sc-workspace-frame-stat-num">
              {m.complete}<span className="sc-workspace-frame-stat-num-total">/{m.total}</span>
            </span>
            <span className="sc-workspace-frame-stat-label">Days</span>
          </div>
        </div>
        <div className="sc-workspace-frame-progress">
          <div className="sc-workspace-frame-progress-label">
            <span>Progress</span>
            <strong style={{ color: progressColor }}>{completionPct}%</strong>
          </div>
          <ProgressLine pct={completionPct} color={progressColor} />
        </div>
        {exceptionCount > 0 ? (
          <span className="sc-workspace-frame-chips">
            {m.overdue > 0 && (
              <button
                type="button"
                className="sc-workspace-frame-chip sc-workspace-frame-chip--overdue"
                onClick={onJumpFirstOverdue}
                aria-label={`Jump to first of ${m.overdue} overdue days`}
              >
                <span className="sc-workspace-frame-chip-glyph" aria-hidden="true">!</span>
                {m.overdue} overdue
              </button>
            )}
            {m.needsEntry > 0 && (
              <button
                type="button"
                className="sc-workspace-frame-chip sc-workspace-frame-chip--needs"
                onClick={onJumpFirstNeeds}
                aria-label={`Jump to first of ${m.needsEntry} days needing entry`}
              >
                <span className="sc-workspace-frame-chip-glyph" aria-hidden="true">✎</span>
                {m.needsEntry} need entry
              </button>
            )}
          </span>
        ) : (
          <span className="sc-workspace-frame-caughtup" aria-live="polite">
            ✓ All caught up
          </span>
        )}
      </div>
      {todaySlot}
    </section>
  );
}

function ProgressLine({ pct, color }) {
  return <ProgressBar variant="line" pct={pct} color={color} />;
}

// ─── Today rail ──────────────────────────────────────────────────
// Spec 5.4 (PR 2 restructure): the today action folds into the
// financial frame as a single-row rail under a hairline divider,
// replacing the standalone hero card. Only renders on the current
// period AND when today's day record is unentered (needs entry /
// overdue / future / no-service). For already-entered today, a
// quieter row (TODAY flag + "{dateLabel} entered" + check glyph,
// no CTA) sits in the same slot.
function TodayRail({ day, kind, homestandMap, onEnterActuals, onBulkUpdate }) {
  const dateLabel = formatHumanDate(day.date);
  const needsAction = !day.hasActuals && day.status !== "off-season";

  if (!needsAction) {
    // SC-069: even when today is already entered, the operator may
    // want to revise or bulk-update forward-looking days. Primary CTA
    // becomes "Edit today" (reuses onEnterActuals - already reopens
    // the day in edit mode), and Bulk Update stays present so a
    // fully-caught-up current period isn't a dead end.
    return (
      <div className="sc-workspace-frame-today" aria-label="Today">
        <div className="sc-workspace-frame-today-info">
          <span className="sc-workspace-frame-today-flag">TODAY</span>
          <span className="sc-workspace-frame-today-done">
            <CheckCircle size="sm" />
            {dateLabel} entered
          </span>
        </div>
        <div className="sc-workspace-frame-today-actions">
          <button
            type="button"
            className="sc-workspace-frame-today-cta"
            onClick={onEnterActuals}
          >
            Edit today
          </button>
          {onBulkUpdate && (
            <button
              type="button"
              className="sc-workspace-frame-today-bulk"
              onClick={onBulkUpdate}
            >
              Bulk Update
            </button>
          )}
        </div>
      </div>
    );
  }

  // Pick the projection display per kind. STL-FL/fee-no-dollar: no $.
  let projection = "";
  const projMeals = sumProjectedMeals(day);
  if (kind === "fee-no-dollar") {
    projection = projMeals > 0 ? `${projMeals.toLocaleString("en-US")} meals projected` : "";
  } else if (kind === "mlb-fee") {
    const hs = homestandMap?.[day.date];
    const opp = hs?.opponent;
    projection = opp ? `vs ${opp} · ${projMeals.toLocaleString("en-US")} meals projected` : `${projMeals.toLocaleString("en-US")} meals projected`;
  } else {
    const projRev = day.totals?.projectedRevenue;
    if (projMeals > 0 && projRev) {
      projection = `${projMeals.toLocaleString("en-US")} meals · ~${fmt$(projRev)}`;
    } else if (projMeals > 0) {
      projection = `${projMeals.toLocaleString("en-US")} meals projected`;
    }
  }

  // Pick the urgency word per status. We only render the word when
  // it adds signal beyond the "TODAY" flag - falling through to
  // "today" used to print "TODAY today" -> "TODAY TODAY" via CSS
  // uppercase, the live-bug Kevin caught.
  const statusWord = day.status === "overdue" ? "overdue"
                   : day.status === "needs-entry" ? "needs entry"
                   : null;

  return (
    <div className="sc-workspace-frame-today" aria-label="Today">
      <div className="sc-workspace-frame-today-info">
        <span className="sc-workspace-frame-today-flag">TODAY</span>
        {statusWord && (
          <span className="sc-workspace-frame-today-status">{statusWord}</span>
        )}
        <span className="sc-workspace-frame-today-date">{dateLabel}</span>
        {projection && (
          <span className="sc-workspace-frame-today-proj">
            <span className="sc-workspace-frame-today-proj-pill">Projected</span>
            {projection}
          </span>
        )}
      </div>
      <div className="sc-workspace-frame-today-actions">
        <button
          type="button"
          className="sc-workspace-frame-today-cta"
          onClick={onEnterActuals}
        >
          Enter actuals
        </button>
        {onBulkUpdate && (
          <button
            type="button"
            className="sc-workspace-frame-today-bulk"
            onClick={onBulkUpdate}
          >
            Bulk Update
          </button>
        )}
      </div>
    </div>
  );
}

// SC-040: past-scope bulk affordance. Renders in place of TodayRail when
// the drill scope is entirely past AND unentered days remain (per-meal /
// MiLB / STL-FL). MLB skips because SC-037(b)'s ruling folds all games
// to "future" - the unentered count stays 0 there.
function PastRail({ unentered, periodRange, scope, onBulkUpdate }) {
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const startDt = new Date(periodRange.start + "T12:00:00");
  const endDt = new Date(periodRange.end + "T12:00:00");
  const rangeLabel = `${MON[startDt.getMonth()]} ${startDt.getDate()} - ${MON[endDt.getMonth()]} ${endDt.getDate()}`;
  const flag = scope === "month" ? "PAST MONTH" : "PAST PERIOD";
  return (
    <div className="sc-workspace-frame-today sc-workspace-frame-today--past" aria-label={flag}>
      <div className="sc-workspace-frame-today-info">
        <span className="sc-workspace-frame-today-flag">{flag}</span>
        <span className="sc-workspace-frame-today-status">
          {unentered} {unentered === 1 ? "day" : "days"} unentered
        </span>
        <span className="sc-workspace-frame-today-date">{rangeLabel}</span>
      </div>
      {onBulkUpdate && (
        <div className="sc-workspace-frame-today-actions">
          <button
            type="button"
            className="sc-workspace-frame-today-bulk"
            onClick={onBulkUpdate}
          >
            Bulk Update
          </button>
        </div>
      )}
    </div>
  );
}

function sumProjectedMeals(day) {
  if (!day?.projected) return 0;
  let n = 0;
  for (const ci of Object.keys(day.projected)) {
    const v = day.projected[ci];
    if (v != null) n += Number(v) || 0;
  }
  return n;
}

// ─── Bulk affordance ─────────────────────────────────────────────
// Decision 1: mode-toggle interaction. A "Select days" button enters
// bulkMode. While bulkMode=true, tile clicks SELECT (atom shows
// isSelected). Out of bulkMode, tile clicks open DayDetail. The mode
// gate prevents the tap-to-open vs tap-to-select conflict the brief
// pre-mortem flagged.
function BulkAffordance({ bulkMode, bulkSelected, saving, onToggle, onCancel, onOpenPanel, onReview }) {
  // Rest-state trigger moved into TodayRail as "Bulk Update"; this
  // component now only renders the active-mode controls (selected count
  // + panel/confirm/cancel). Note: TodayRail only renders on the current
  // period, so past-period drill-ins lose the standalone entry into
  // bulk mode - flagged for follow-up if needed.
  if (!bulkMode) return null;
  const count = bulkSelected?.size || 0;
  return (
    <div className="sc-workspace-bulk-active" role="region" aria-label="Bulk entry">
      <span className="sc-workspace-bulk-active-count">
        {count} day{count !== 1 ? "s" : ""} selected
      </span>
      <div className="sc-workspace-bulk-active-actions">
        {count > 0 && (
          <>
            <button
              type="button"
              className="sc-workspace-bulk-btn sc-workspace-bulk-btn--outline"
              disabled={saving}
              onClick={onReview}
            >
              {saving ? "Saving..." : "All match projections"}
            </button>
            <button
              type="button"
              className="sc-workspace-bulk-btn sc-workspace-bulk-btn--primary"
              disabled={saving}
              onClick={onOpenPanel}
            >
              Enter custom values
            </button>
          </>
        )}
        <button
          type="button"
          className="sc-workspace-bulk-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Day grid (all-weeks, no buttons, no slide) ─────────────────
// WAI-ARIA grid pattern (https://www.w3.org/WAI/ARIA/apg/patterns/grid/):
// role="grid" > role="row" > role="gridcell", with roving tabindex so
// keyboard users tab in ONCE and arrow-key between cells (Left/Right walk
// real-day cells in reading order skipping placeholders; Up/Down jump one
// week and clamp; Home/End jump to the first/last real cell in the row).
// Enter/Space activation still fires the atom's onClick (DaySquare owns
// that; the atom does not consume arrow keys so they bubble to the grid).
function DayGrid({ cells, today, kind, hasHomestandSchedule, isFeeAccount, isMilb, homestandMap, bulkMode, bulkSelected, loadState = "loaded", onDayClick, onBulkTileClick }) {
  // Chunk the flat cells array into weeks of 7 for the row wrappers.
  // Null cells stay in place so column alignment holds on desktop; on
  // mobile they hide (see periodWorkspace.css @media).
  const rows = useMemo(() => {
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [cells]);

  // Roving focus target = flat index into `cells`. Initialize to today's
  // real-day cell when present, else the first real-day cell. Resets on
  // period change (cells / today swap in a fresh set).
  const initialFocusIdx = useMemo(() => {
    if (!cells?.length) return -1;
    const todayIdx = cells.findIndex(c => c.day && c.day.date === today);
    if (todayIdx >= 0) return todayIdx;
    return cells.findIndex(c => c.day);
  }, [cells, today]);

  const [focusIdx, setFocusIdx] = useState(initialFocusIdx);
  useEffect(() => { setFocusIdx(initialFocusIdx); }, [initialFocusIdx]);

  // Array of DOM refs to the wrapping cell spans; the focusable div is
  // the DaySquare (span's firstElementChild). Callback ref pattern -
  // React 19 handles null on unmount, so stale entries auto-clear.
  const cellRefs = useRef([]);

  const focusRealCell = (idx) => {
    setFocusIdx(idx);
    const span = cellRefs.current[idx];
    const focusable = span?.firstElementChild;
    if (focusable && typeof focusable.focus === "function") {
      focusable.focus();
    }
  };

  const scanForRealCell = (fromIdx, step) => {
    let i = fromIdx + step;
    while (i >= 0 && i < cells.length) {
      if (cells[i].day) return i;
      i += step;
    }
    return -1;
  };

  const handleGridKeyDown = (e) => {
    if (focusIdx < 0) return;
    let next = -1;
    switch (e.key) {
      case "ArrowRight":
        next = scanForRealCell(focusIdx, 1);
        break;
      case "ArrowLeft":
        next = scanForRealCell(focusIdx, -1);
        break;
      case "ArrowDown": {
        const target = focusIdx + 7;
        if (target < cells.length && cells[target]?.day) next = target;
        break;
      }
      case "ArrowUp": {
        const target = focusIdx - 7;
        if (target >= 0 && cells[target]?.day) next = target;
        break;
      }
      case "Home": {
        // First real-day cell in the current row (clamp; do not cross weeks).
        const start = Math.floor(focusIdx / 7) * 7;
        for (let i = start; i < start + 7 && i < cells.length; i++) {
          if (cells[i].day) { next = i; break; }
        }
        break;
      }
      case "End": {
        // Last real-day cell in the current row.
        const start = Math.floor(focusIdx / 7) * 7;
        for (let i = Math.min(start + 6, cells.length - 1); i >= start; i--) {
          if (cells[i].day) { next = i; break; }
        }
        break;
      }
      default:
        return;
    }
    if (next >= 0 && next !== focusIdx) {
      e.preventDefault();
      focusRealCell(next);
    }
  };

  return (
    <div className="sc-workspace-grid-wrap">
      <div className="sc-workspace-grid-dow" aria-hidden="true">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
          <span key={d} className="sc-workspace-grid-dow-cell">{d}</span>
        ))}
      </div>
      <div
        className="sc-workspace-grid"
        role="grid"
        aria-label="Days in this period"
        onKeyDown={handleGridKeyDown}
      >
        {rows.map((week, weekIdx) => (
          <div key={weekIdx} role="row" className="sc-workspace-grid-row">
            {week.map((cell, colIdx) => {
              const flatIdx = weekIdx * 7 + colIdx;
              if (!cell.day) {
                return <span key={flatIdx} className="sc-workspace-grid-cell sc-workspace-grid-cell-empty" aria-hidden="true" />;
              }
              const d = cell.day;
              const isToday = d.date === today;
              // SC-047: when the drill fetch failed, every in-period
              // cell resolves to "failed" regardless of raw d.status,
              // and content drops so the atom renders the dashed shell.
              const status = resolveDayStatus(d.status, loadState === "failed" ? "failed" : undefined);
              const isSelected = bulkMode && bulkSelected?.has(d.date);
              const content = loadState === "failed" ? null : buildLargeContent(d, kind, homestandMap, isMilb);
              // Bulk-selectable gate: needs-entry / overdue / future
              // days are always selectable. SC-069 widens the gate to
              // also allow ENTERED FUTURE days so a fully-caught-up
              // current period isn't a dead end - operators can
              // revise forward projections in bulk. Past entered days
              // stay LOCKED (bulk cannot stomp confirmed history).
              // Off days ("off-season" / "prep") never selectable.
              const isEnteredFuture = d.hasActuals && d.date > today;
              const isBulkSelectable = bulkMode && status !== "off" && (!d.hasActuals || isEnteredFuture);
              const isRoving = flatIdx === focusIdx;
              return (
                <span
                  key={d.date}
                  ref={(el) => { cellRefs.current[flatIdx] = el; }}
                  className="sc-workspace-grid-cell"
                >
                  <DaySquare
                    date={d.date}
                    status={status}
                    size="lg"
                    kind={kind}
                    content={content}
                    isToday={isToday}
                    isSelected={isSelected}
                    role="gridcell"
                    tabIndex={isRoving ? 0 : -1}
                    onClick={() => {
                      setFocusIdx(flatIdx);
                      if (bulkMode) {
                        if (isBulkSelectable) onBulkTileClick?.(d.date);
                        return;
                      }
                      onDayClick?.(d.date);
                    }}
                    ariaLabel={`${d.date}, ${status}`}
                    isSyncing={syncingDates?.has(d.date) || false}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Builds the large-size content bag from the per-day record. The
// per-day record (post-B2a periodDays) has day.totals, day.projected,
// day.actual, day.meta.week, day.gameType, day.hasActuals - richer
// than year-summary's day shape, so we render real $ and meals.
function buildLargeContent(day, kind, homestandMap, isMilb) {
  const projMeals = sumProjectedMeals(day);
  const actMeals = day.hasActuals ? sumActualMeals(day) : 0;
  const meals = day.hasActuals ? actMeals : projMeals;

  if (kind === "mlb-fee") {
    const hs = homestandMap?.[day.date];
    // SC-042: entered days preserve 0 (renders honest "0 meals");
    // unentered days drop the 0 so prep/off tiles don't read "~0 meals".
    // isEstimated flags unentered days so renderMlbFee prefixes with ~.
    return {
      opponent: hs?.opponent || null,
      meals: day.hasActuals ? (meals ?? null) : (meals > 0 ? meals : null),
      isEstimated: !day.hasActuals,
    };
  }
  if (kind === "milb") {
    // Stage 5 polymorphism fix: MiLB is per-meal financially (the
    // pill carries the operational shape; $ + meals carry the
    // financial truth). docs/SC_BILLING_MODEL_AUDIT.md confirms
    // CIN-KY is "Per-meal only, two-tier". Without revenue here,
    // the workspace day-tile would silently drop $ for MiLB.
    const g = (day.gameType || day.meta?.gameType || "").toLowerCase();
    const milbPill = g.includes("day") ? "day"
                  : g.includes("night") ? "night"
                  : null;
    const rev = day.hasActuals
      ? day.totals?.actualRevenue
      : day.totals?.projectedRevenue;
    return {
      milbPill,
      meals: meals || null,
      revenue: rev != null ? rev : null,
      isEstimated: !day.hasActuals && isPastDate(day.date),
    };
  }
  if (kind === "fee-no-dollar") {
    return { served: meals || null };
  }
  // per-meal default
  const rev = day.hasActuals
    ? day.totals?.actualRevenue
    : day.totals?.projectedRevenue;
  return {
    revenue: rev != null ? rev : null,
    meals: meals || null,
    isEstimated: !day.hasActuals && isPastDate(day.date),
  };
}

function sumActualMeals(day) {
  if (!day?.actual) return 0;
  let n = 0;
  for (const ci of Object.keys(day.actual)) {
    const v = day.actual[ci];
    if (v != null) n += Number(v) || 0;
  }
  return n;
}

// ─── Week subtotals footnote ────────────────────────────────────
// SC-043: week cards speak the right denominator for the account kind:
//   MLB homestand -> "{n} games" + "{entered} / {n} entered"
//   STL-FL        -> "{meals} meals" + "{entered} / {days} entered"
//   per-meal/MiLB -> "$X" or "~$X" + "{entered} / {days} entered"
// A week whose applicable-day count is 0 renders the No service / No
// games variant (italic label, no counts). Numerator still uses
// hasActuals; explicit-zero days count as complete per the ruling.
function WeekSubtotals({ weekLabels, weekMetrics, kind, hasHomestandSchedule, isFeeAccount }) {
  // SC-073: MLB homestand accounts do not surface week cards - the
  // schedule cadence + game-day rhythm is already the read; a week
  // subtotal on top adds visual weight without operator payoff.
  // Owner ruling 2026-07-09 supersedes the fee-week half of SC-043.
  // Per-meal / MiLB / STL-FL fee-no-dollar keep theirs unchanged.
  // Aggregate's gameDays counters stay populated (cheap; the metric
  // may return in a future dashboard).
  if (hasHomestandSchedule) return null;
  if (!weekLabels?.length) return null;
  return (
    <div className="sc-workspace-weeks" aria-label="Week subtotals">
      {weekLabels.map((w) => {
        const wm = weekMetrics?.[w] || {
          actRev: 0, projRev: 0, actMeals: 0,
          complete: 0, total: 0,
          serviceDays: 0, serviceDaysEntered: 0,
          gameDays: 0, gameDaysEntered: 0,
        };
        // Denominator + subline depend on kind. Numerator = *DaysEntered.
        let denomCount;
        let denomWord;
        let enteredCount;
        let value;
        let emptyLabel;
        if (hasHomestandSchedule) {
          denomCount = wm.gameDays;
          denomWord = "games";
          enteredCount = wm.gameDaysEntered;
          value = `${denomCount} ${denomCount === 1 ? "game" : "games"}`;
          emptyLabel = "No games";
        } else if (isFeeAccount) {
          denomCount = wm.serviceDays;
          denomWord = "days";
          enteredCount = wm.serviceDaysEntered;
          value = `${wm.actMeals.toLocaleString("en-US")} meals`;
          emptyLabel = "No service";
        } else {
          denomCount = wm.serviceDays;
          denomWord = "days";
          enteredCount = wm.serviceDaysEntered;
          const rev = wm.actRev > 0 ? wm.actRev : wm.projRev;
          const prefix = wm.actRev > 0 ? "" : "~";
          value = `${prefix}${fmt$(rev)}`;
          emptyLabel = "No service";
        }
        const isEmpty = denomCount === 0;
        const isDone = !isEmpty && enteredCount === denomCount;
        const cardClass = "sc-workspace-weeks-item"
          + (isDone ? " sc-workspace-weeks-item--done" : "")
          + (isEmpty ? " sc-workspace-weeks-item--empty" : "");
        return (
          <div key={w} className={cardClass}>
            <span className="sc-workspace-weeks-label">{w}</span>
            {isEmpty ? (
              <span className="sc-workspace-weeks-empty">{emptyLabel}</span>
            ) : (
              <>
                <span className="sc-workspace-weeks-value">{value}</span>
                <span className="sc-workspace-weeks-days">{enteredCount} / {denomCount} entered</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Banners + skeleton ─────────────────────────────────────────
function WorkspacePartialBanner({ failedMonth }) {
  return (
    <div className="sc-workspace-partial" role="status">
      <span aria-hidden="true">!</span>
      <span>Partial data - we couldn't load {failedMonth || "one of the months"}. The full period appears when it lands.</span>
    </div>
  );
}

// Derive the skeleton tile count from the active periodRange when
// possible; falls back to 28 when periodRange is not yet known
// (matches the pre-C1a literal). Same week-aligned math as
// buildWorkspaceWeekGrid so the skeleton grid matches the real grid
// row count on 28/29/30/31/35-day periods.
function skeletonTileCount(periodRange) {
  if (!periodRange?.start || !periodRange?.end) return 28;
  const start = new Date(periodRange.start + "T12:00:00");
  const end   = new Date(periodRange.end   + "T12:00:00");
  const startDow = start.getDay();
  const daysBeforeMonday = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - daysBeforeMonday);
  const totalDays = Math.floor((end - gridStart) / 86400000) + 1;
  const weeks = Math.ceil(totalDays / 7);
  return weeks * 7;
}

function WorkspaceSkeleton({ inline = false, tileCount = 28 }) {
  return (
    <div className={`sc-workspace ${inline ? "" : "sc-fade-in"}`} aria-hidden="true">
      <div className="sc-workspace-skel sc-workspace-skel--frame" />
      <div className="sc-workspace-skel sc-workspace-skel--hero" />
      <div className="sc-workspace-grid-wrap">
        <div className="sc-workspace-skel sc-workspace-skel--dow" />
        <div className="sc-workspace-grid">
          {Array.from({ length: tileCount }).map((_, i) => (
            <div key={i} className="sc-workspace-skel sc-workspace-skel--tile" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ──────────────────────────────────────────────────
function formatHumanDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${dow} ${monthShort[d.getMonth()]} ${d.getDate()}`;
}

// Builds the week-aligned grid for the period (Mon-first). Returns
// cells = [{ day | null }]; null cells render as quiet placeholders.
// Mirrors PeriodCard's pattern but uses the rich periodDays shape
// (with day.totals etc.) instead of the thin year-summary shape.
function buildWorkspaceWeekGrid(periodRange, periodDays, loadState = "loaded") {
  if (!periodRange) return [];
  const byDate = new Map();
  if (periodDays?.length) for (const d of periodDays) byDate.set(d.date, d);

  const start = new Date(periodRange.start + "T12:00:00");
  const end   = new Date(periodRange.end   + "T12:00:00");

  const startDow = start.getDay();
  const daysBeforeMonday = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - daysBeforeMonday);

  const cells = [];
  const cursor = new Date(gridStart);
  let week = 0;
  while (week < 6) {
    for (let i = 0; i < 7; i++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,"0")}-${String(cursor.getDate()).padStart(2,"0")}`;
      const inPeriod = dateStr >= periodRange.start && dateStr <= periodRange.end;
      // SC-047: on total failure, fabricate a stub day for in-period
      // dates when we have no real data so renderCell can force each
      // cell to the dashed failed atom.
      const realDay = inPeriod ? byDate.get(dateStr) : null;
      const stubDay = inPeriod && loadState === "failed" && !realDay
        ? { date: dateStr, status: null, meta: {} }
        : null;
      cells.push({ day: realDay || stubDay || null });
      cursor.setDate(cursor.getDate() + 1);
    }
    week++;
    if (cursor > end && cursor.getDay() === 1) break;
  }
  return cells;
}
