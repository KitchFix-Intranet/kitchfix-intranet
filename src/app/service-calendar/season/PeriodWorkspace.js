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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DaySquare from "../DaySquare";
import {
  resolveDayStatus,
  resolveDayKind,
  isPastDate,
} from "../dayResolvers";
import { CheckCircle } from "../Icons";
import { fmt$ } from "./format";
import ProgressBar from "./ProgressBar";
import { formatMlbHomeGameTime, formatMilbHomeGameTime } from "../gameTimeFormat";
import { scrollIntoViewRM } from "../v2/motion";
import "./periodWorkspace.css";

// sc-30 PR-A1 (2026-08-07): shift an ISO YYYY-MM-DD by N days. UTC
// arithmetic so DST edges do not shift the result. Used by the
// finalize-state fetch to widen the range by 7 days on each side so
// weeks straddling period boundaries stay covered.
function shiftIso(iso, days) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// sc-30 (2026-08-06, PR-A) + PR-A1 (2026-08-07): per-week finalize
// control at the week band for per-meal accounts. Fee/MLB/MiLB-AAA
// accounts do not render this; the gate is
// isPerMealBillingAccount(account.key). Override affordances render
// only for SC_LOCK_OVERRIDE members (K-10).
import WeekFinalizeControl from "../v2/billing/WeekFinalizeControl";
import { isPerMealBillingAccount } from "../v2/billing/perMealAccounts";
import { isScLockOverride } from "@/lib/admin";
import "../v2/billing/weekFinalize.css";

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
  // sc-17 (2026-07-11): informational schedule overlay - a
  // { "YYYY-MM-DD": {opponent, dayNight, gameTime, isDoubleheader} } map
  // for accounts flagged has_schedule_overlay. Drives ONLY the tile
  // decoration on lg drill-in tiles (opponent chip + pill on top of
  // the existing served count). Independent of homestandMap - overlay
  // never touches classify/kind/counters.
  scheduleOverlay,
  // sc-19 (2026-07-12): Set<YYYY-MM-DD> of Spring Training dates for
  // this account (phaseCalendar.js-derived), plus the derived phase
  // timeline. springDateSet drives the sm year-grid corner wedge in
  // PeriodCard/MonthCard AND the lg "ST" pill on drill-in DaySquare.
  // phaseTimeline is the source-of-truth for the chrome bar "· Spring
  // Training" rider (period + month drill headers).
  springDateSet,
  phaseTimeline,
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
  // SC v2 (W5): when true, WeekSubtotals cards do NOT render (the same
  // component-non-render pattern used to retire FullSeasonCard in
  // W2-W4). Their figures move to slim in-grid bands (this same
  // component renders them, guarded by !hasHomestandSchedule per
  // SC-073) and to the drill rail (composed at the caller in
  // ServiceCalendar.js under scV2). Flag off = every v1 render survives.
  scV2 = false,
  // W5: focus target from the ?day= URL param. When present + inside the
  // period, the DayGrid adopts it as the initial roving position and
  // scrolls the tile into view. NEVER auto-opens DayDetail (contract).
  focusTargetDate = null,
  // sc-30 PR-A1 (2026-08-07): viewer email for the finalize control.
  // Drives the SC_LOCK_OVERRIDE affordances (Revert + Retry). Also
  // gates the FETCH of finalize states (skip when unknown).
  viewerEmail = null,
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

  // ─── sc-30 PR-A1 (2026-08-07): finalize state fetch + handlers ───
  //
  // Gate: only per-meal billing accounts (fee / MLB / MiLB-AAA don't
  // render the control at all). Structural exclusion, not a derived
  // property (perMealAccounts.js explicit Set).
  const accountKey = account?.key || "";
  const showFinalize = scV2 && isPerMealBillingAccount(accountKey);
  const isOverrideUser = isScLockOverride(viewerEmail);
  // Map<week_start ISO, live-row-object | null>. Populated after the
  // fetch below; null-row = OPEN week.
  const [finalizeRowsByWeek, setFinalizeRowsByWeek] = useState(() => new Map());
  const [finalizeReloadTick, setFinalizeReloadTick] = useState(0);
  useEffect(() => {
    if (!showFinalize || !periodRange?.start || !periodRange?.end) return;
    // Widen the fetch by 7 days on each side so a week straddling
    // period boundaries is still covered (the row keys on the week
    // start Monday which can fall in the neighboring period).
    const first = shiftIso(periodRange.start, -7);
    const last  = shiftIso(periodRange.end,   +7);
    const url = `/api/service-calendar?action=sc-finalize-states&account=${encodeURIComponent(accountKey)}&first=${first}&last=${last}`;
    let cancelled = false;
    fetch(url, { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(body => {
        if (cancelled) return;
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        const map = new Map();
        for (const r of rows) {
          if (r.status === "reverted") continue; // live rows only
          map.set(r.week_start, r);
        }
        setFinalizeRowsByWeek(map);
      })
      .catch((err) => {
        if (cancelled) return;
        // Non-fatal: the button falls back to open-open-open. Log
        // for local debug; the operator sees the button as if the
        // week were OPEN (server rejects on click if actually
        // finalized). This is honest.
        // eslint-disable-next-line no-console
        console.warn("[PeriodWorkspace] sc-finalize-states fetch failed:", err?.message || err);
      });
    return () => { cancelled = true; };
  }, [showFinalize, accountKey, periodRange?.start, periodRange?.end, finalizeReloadTick]);

  const handleFinalize = useCallback(async ({ accountKey: acctK, weekStart }) => {
    const res = await fetch("/api/service-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "sc-finalize-week", accountKey: acctK, weekStart }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.body = body;
      throw err;
    }
    setFinalizeReloadTick((n) => n + 1);
  }, []);

  const handleRevert = useCallback(async ({ accountKey: acctK, weekStart, reason }) => {
    const res = await fetch("/api/service-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "sc-revert-finalize", accountKey: acctK, weekStart, reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.body = body;
      throw err;
    }
    setFinalizeReloadTick((n) => n + 1);
  }, []);

  // Retry action is a PR-C placeholder per spec §3. In PR-A1 the
  // handler is a no-op stub that surfaces a "not yet implemented"
  // error so a click during shadow testing does not silently succeed.
  const handleRetry = useCallback(async () => {
    throw new Error("Retry ships in PR-C (QBO adapter). Contact billing for now.");
  }, []);

  // P3-B gate-2 (2026-07-28): tile-flip detection lives HERE, not in
  // DaySquare. Mechanism: DaySquare's `useRef(hasActuals)` inside a
  // possibly-remounting subtree initializes to the ALREADY-true value
  // on the fresh instance, so a false->true transition is invisible.
  // Cells can churn (buildWorkspaceWeekGrid emits null placeholders
  // during refetch, flipping the outer <span key={d.date}> in/out).
  // PeriodWorkspace is stably mounted across refetch, so the prev-map
  // here persists across the whole session.
  //
  // P3-B re-gate 5 rider (2026-07-28) - flip only on operator-present
  // transitions:
  //   - First sighting of a date on this scope = SILENT SEED, no flip
  //     (previously seeded via `!!undefined = false`, so stage-2
  //     hasActuals=true on the same load tripped the diff and flipped
  //     every already-entered tile on load / navigation).
  //   - Scope change (account / periodRange / scope word) = drop both
  //     refs and treat every date on the next load as first-sight.
  //   - Genuine flip = date is ALREADY seeded on this scope AND prev
  //     value was false AND current value is true (bulk-saved tiles
  //     included per Ruling 2).
  const prevHasActualsMapRef = useRef(new Map());
  const seededDatesRef = useRef(new Set());
  const lastScopeKeyRef = useRef(null);
  const [justFlippedDates, setJustFlippedDates] = useState(() => new Set());
  useEffect(() => {
    if (!Array.isArray(periodDays) || periodDays.length === 0) return undefined;
    // Scope key covers every dimension that means "different drill
    // surface." A change here silently reseeds - the next render's
    // isFirstSight branch will run for every date.
    const scopeKey = `${account?.key || ""}::${scope}::${periodRange?.start || ""}::${periodRange?.end || ""}`;
    if (lastScopeKeyRef.current !== scopeKey) {
      prevHasActualsMapRef.current = new Map();
      seededDatesRef.current = new Set();
      lastScopeKeyRef.current = scopeKey;
    }
    const newlyFlipped = [];
    for (const d of periodDays) {
      if (!d?.date) continue;
      if (!seededDatesRef.current.has(d.date)) {
        // First sighting - silent seed, no flip.
        prevHasActualsMapRef.current.set(d.date, !!d.hasActuals);
        seededDatesRef.current.add(d.date);
        continue;
      }
      const prev = prevHasActualsMapRef.current.get(d.date);
      if (prev === false && d.hasActuals === true) newlyFlipped.push(d.date);
      prevHasActualsMapRef.current.set(d.date, !!d.hasActuals);
    }
    if (newlyFlipped.length === 0) return undefined;
    setJustFlippedDates(new Set(newlyFlipped));
    const id = setTimeout(() => setJustFlippedDates(new Set()), 500);
    return () => clearTimeout(id);
  }, [periodDays, account?.key, scope, periodRange?.start, periodRange?.end]);

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
      {/* Drill P1 PR-A DP1-07 removed the 2nd strip (TodayRail +
          PastRail). Drill P2 PR-1 DP2-01 (2026-07-20) removes the
          whole <FinancialFrame> as well - the strip's remaining body
          ($X of ~$Y / ENTERED / PROJECTED / N/M DAYS / progress /
          needs pill) all lives in the right rail now (DrillRail hero
          + progress + queue rows, OpsRail hero for fee/MLB). No
          information loss - just duplication removed.
          Function definition retained below (dead code) to avoid
          churn on shared helpers; onJumpFirstOverdue / onJumpFirstNeeds
          props still flow through ServiceCalendar for the same reason
          (rail queue rows target days directly, so the jumps aren't
          needed on the scv2 drill). W9 demolition PR cleans up. */}

      <BulkAffordance
        bulkMode={bulkMode}
        bulkSelected={bulkSelected}
        periodDays={periodDays}
        isFeeAccount={isFeeAccount}
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
        scheduleOverlay={scheduleOverlay}
        springDateSet={springDateSet}
        accountKey={account?.key}
        bulkMode={bulkMode}
        bulkSelected={bulkSelected}
        loadState={loadState}
        onDayClick={onDayClick}
        onBulkTileClick={onBulkTileClick}
        syncingDates={syncingDates}
        scV2={scV2}
        weekMetrics={m.weeks}
        focusTargetDate={focusTargetDate}
        /* PR-D drill Phase 1: month scope keys band lookup by the row's
           Monday date (calendar-week), not by day.meta.week (fiscal). */
        scope={scope}
        /* P3-B gate-2: per-date one-shot flip signal. Set<date>. */
        justFlippedDates={justFlippedDates}
      />

      {/* W5: WeekSubtotals cards do not render under scV2 - their
          figures moved to in-grid bands (rendered by DayGrid) + the
          drill rail. SC-073 (hasHomestandSchedule guard) is still
          honored inside WeekSubtotals for v1 too. */}
      {scope !== "month" && !scV2 && (
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
function BulkAffordance({ bulkMode, bulkSelected, periodDays, isFeeAccount, saving, onToggle, onCancel, onOpenPanel, onReview }) {
  // Rest-state trigger moved into TodayRail as "Bulk Update"; this
  // component now only renders the active-mode controls (selected count
  // + panel/confirm/cancel). Note: TodayRail only renders on the current
  // period, so past-period drill-ins lose the standalone entry into
  // bulk mode - flagged for follow-up if needed.
  //
  // Phase 2A (2026-07-24) additions:
  // - P2-1 scroll-to-focus: the banner scrollIntoViewRM on mode-enter
  //   so an operator scrolled down doesn't miss it appearing.
  // - P2-5 selection guidance: "Select days to enter" copy while
  //   count===0; actions disabled until something is selected; running
  //   projected total renders as soon as count>0. Totals are server-
  //   derived (day.totals.projectedRevenue), never client-computed.
  const bannerRef = useRef(null);
  useEffect(() => {
    if (bulkMode && bannerRef.current) {
      scrollIntoViewRM(bannerRef.current, { block: "start" });
    }
  }, [bulkMode]);

  const runningTotal = useMemo(() => {
    if (!bulkMode || !bulkSelected || bulkSelected.size === 0) return null;
    // Sum per-day figures at cent precision. Prior shape had
    // Math.round(x) inside the accumulator (whole-dollar round-then-
    // sum) - same defect fixed on the review header at
    // ServiceCalendar.js:3966 (bulk-match) and :4098 (bulk-custom).
    // These three surfaces are the same journey: this running total
    // is shown while the operator is selecting days, then the review
    // header shows on confirm; they must agree at the cent or the
    // selection screen contradicts the review screen seconds later.
    // day.totals.projectedRevenue is already at 2dp per R13
    // (season/format.js:22-28); straight sum preserves the invoice-
    // convention footing.
    let meals = 0, revenue = 0;
    for (const d of periodDays || []) {
      if (!bulkSelected.has(d.date)) continue;
      for (const v of Object.values(d.projected || {})) meals += v || 0;
      revenue += Number(d.totals?.projectedRevenue) || 0;
    }
    return { meals, revenue };
  }, [bulkMode, bulkSelected, periodDays]);

  if (!bulkMode) return null;
  const count = bulkSelected?.size || 0;
  const noneSelected = count === 0;
  return (
    <div ref={bannerRef} className="sc-workspace-bulk-active" role="region" aria-label="Bulk entry">
      <span className="sc-workspace-bulk-active-count">
        {noneSelected ? (
          <>Select days to enter</>
        ) : (
          <>{count} day{count !== 1 ? "s" : ""} selected</>
        )}
      </span>
      <div className="sc-workspace-bulk-active-actions">
        {runningTotal && (
          <span className="sc-workspace-bulk-active-total">
            {runningTotal.meals.toLocaleString()} meals
            {!isFeeAccount && Number.isFinite(runningTotal.revenue) && (
              <>{" · "}{fmt$(runningTotal.revenue)}</>
            )}
          </span>
        )}
        <button
          type="button"
          className="sc-workspace-bulk-btn sc-workspace-bulk-btn--outline"
          disabled={saving || noneSelected}
          onClick={onReview}
        >
          {saving ? "Saving..." : "All match projections"}
        </button>
        <button
          type="button"
          className="sc-workspace-bulk-btn sc-workspace-bulk-btn--primary"
          disabled={saving || noneSelected}
          onClick={onOpenPanel}
        >
          Enter custom values
        </button>
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
// syncingDates is threaded from PeriodWorkspace through the callsite
// above; the :834 consumer below was a free variable from F3 (#378)
// until this hotfix, crashing every REAL-day cell with
// `ReferenceError: syncingDates is not defined` the moment a drill
// tried to render. Masked until #382 killed the earlier TDZ crash
// upstream of any drill mount, then surfaced on the first month
// click after that landed.
function DayGrid({ cells, today, kind, hasHomestandSchedule, isFeeAccount, isMilb, homestandMap, scheduleOverlay, springDateSet, accountKey, bulkMode, bulkSelected, loadState = "loaded", onDayClick, onBulkTileClick, syncingDates, scV2 = false, weekMetrics = null, focusTargetDate = null, scope = "period", justFlippedDates = null }) {
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

  // Roving focus target = flat index into `cells`. Precedence:
  //   1. focusTargetDate (?day= URL param, W5) - the tile is scrolled +
  //      focused, but DayDetail is NOT auto-opened (contract per scope
  //      §10 addition). The click OR Enter is still an explicit action.
  //   2. Today's real-day cell.
  //   3. First real-day cell.
  // Resets on period change (cells / today swap in a fresh set).
  const initialFocusIdx = useMemo(() => {
    if (!cells?.length) return -1;
    if (focusTargetDate) {
      const targetIdx = cells.findIndex(c => c.day && c.day.date === focusTargetDate);
      if (targetIdx >= 0) return targetIdx;
    }
    const todayIdx = cells.findIndex(c => c.day && c.day.date === today);
    if (todayIdx >= 0) return todayIdx;
    return cells.findIndex(c => c.day);
  }, [cells, today, focusTargetDate]);

  const [focusIdx, setFocusIdx] = useState(initialFocusIdx);
  useEffect(() => { setFocusIdx(initialFocusIdx); }, [initialFocusIdx]);

  // Array of DOM refs to the wrapping cell spans; the focusable div is
  // the DaySquare (span's firstElementChild). Callback ref pattern -
  // React 19 handles null on unmount, so stale entries auto-clear.
  const cellRefs = useRef([]);

  // W5: when a ?day= target lands, scroll the tile into view. This is
  // a one-shot on mount / on the target-date change. Uses smooth
  // scrolling; prefers-reduced-motion honored via CSS scroll-behavior
  // fallback (the browser respects it for scrollIntoView too). Does
  // NOT auto-open DayDetail per contract - opening entry stays an
  // explicit click / Enter.
  //
  // W7 PR 3/3 I-1 harden. Chat-Claude observed once (post-#466) that
  // ?day=2026-07-14 opened the modal on July 15 (the oldest-overdue
  // post-entry). Trace verdict: the code path itself is defensively
  // correct - focusable is captured after cellRefs populate; keys are
  // stable per d.date so React reuses the DaySquare DOM node across
  // data-phase re-renders; nothing rewrites ?day= on modal open. What
  // remains as a plausible race: if the effect ran during initial
  // "loading" load-state (focusIdx = -1 because cells was empty), the
  // early return fired and no focus was placed; then loadState
  // transitioned to "loaded" and cells populated but focusIdx moved
  // via the setFocusIdx bridge without re-firing this effect (the
  // effect deps didn't watch loadState). Two additions here:
  //   1. loadState is now a dep. When the drill flips loading->loaded,
  //      the effect re-fires with the now-valid focusIdx.
  //   2. The rAF callback checks document.activeElement before
  //      stealing focus. If the active element is body (no landing)
  //      OR still inside the workspace grid (user hasn't tabbed
  //      away), we assert focus on the ?day= tile - respecting the
  //      user's explicit URL-signaled intent. If the user has tabbed
  //      into the rail or elsewhere, we don't yank them back.
  useEffect(() => {
    if (!focusTargetDate) return;
    if (focusIdx < 0) return;
    const cell = cellRefs.current[focusIdx];
    if (!cell) return;
    const focusable = cell.firstElementChild;
    const gridRoot = cell.closest ? cell.closest(".sc-workspace-grid") : null;
    requestAnimationFrame(() => {
      scrollIntoViewRM(cell, { block: "center" });
      if (!focusable || typeof focusable.focus !== "function") return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      const activeIsBody = !active || active === (typeof document !== "undefined" ? document.body : null);
      const activeIsInGrid = gridRoot ? gridRoot.contains(active) : false;
      if (activeIsBody || activeIsInGrid) {
        focusable.focus({ preventScroll: true });
      }
    });
  }, [focusTargetDate, focusIdx, loadState]);

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
        {rows.map((week, weekIdx) => {
          // PR-D drill Phase 1: band lookup branches on scope.
          //   period: fiscal-week key from day.meta.week (unchanged).
          //   month : calendar-week key = Monday ISO of the row (from
          //           the cell's `date` attached at buildWorkspaceWeekGrid).
          //           The Monday is always cells[0] because the grid is
          //           Mon-Sun aligned. Calendar buckets carry .label
          //           ("Week 1"..N), .startDate/.endDate, and .periods
          //           for the P7 / P7-8 prefix (DP1-11).
          const firstDayCell = week.find(c => c.day);
          const rowKey = scope === "month"
            ? (week[0]?.date || null)
            : (firstDayCell?.day?.meta?.week || null);
          const wm = rowKey && weekMetrics ? weekMetrics[rowKey] : null;
          const bandLabel = wm?.label || rowKey;
          // Two-guard model (bundle scope §3, plus P2B-b fee reopen):
          //  - !hasHomestandSchedule (SC-073 - MLB homestand accounts
          //    never see week cards or bands)
          //  - fee accounts NOW render bands with a served-count figure
          //    (P2B-b, 2026-07-25). The prior !isFeeAccount block was
          //    dollar-avoidance (STL-FL's actRev is structurally $0);
          //    the fee band is a served count, not a dollar, so the
          //    dollar-avoidance rationale dissolves. Per-meal band
          //    unchanged - value expression branches at :944 below.
          const showBand = scV2 && !hasHomestandSchedule && rowKey && wm;
          // DP1-11: period prefix. Single period -> "P7" (with the P
          // canon stripped-and-added so "7" and "P7" both format the
          // same); two or more -> "P7-8" and amber via data-straddle.
          // Fiscal buckets by definition contain one period; calendar
          // buckets can straddle a month with a period boundary.
          const prefixPeriods = (wm?.periods || []).map(p => String(p).replace(/^P/i, ""));
          const bandPrefix = prefixPeriods.length === 1
            ? `P${prefixPeriods[0]}`
            : prefixPeriods.length > 1
              ? `P${prefixPeriods[0]}-${prefixPeriods[prefixPeriods.length - 1]}`
              : null;
          const isStraddle = prefixPeriods.length > 1;
          // #3 Part 2 REDO (2026-07-21): NO separate pill element.
          // Owner reversed: pill the EXISTING label ("P8 WEEK 4")
          // via a data-current attribute + CSS, not a duplicate
          // text pill. isCurrentWeek retained so CSS can target
          // the current band; weekNum + composed pill string
          // deleted (were only used by the retired separate pill).
          const isCurrentWeek = !!(today && wm?.startDate && wm?.endDate
            && today >= wm.startDate && today <= wm.endDate);
          return (
            <React.Fragment key={weekIdx}>
              {showBand && (
                <div
                  className="sc-workspace-band"
                  data-week={rowKey}
                  data-straddle={isStraddle ? "true" : undefined}
                  data-current={isCurrentWeek ? "true" : undefined}
                  aria-hidden="true"
                >
                  {/* #3 Part 2 REDO v2 (2026-07-21): wrap prefix +
                      label in one container so the current-week
                      pill background paints as ONE continuous shape.
                      Prior treatment styled each span individually,
                      leaving a seam between "P8" and "WEEK 4". */}
                  <span className="sc-workspace-band-title">
                    {bandPrefix && (
                      <span className="sc-workspace-band-prefix">{bandPrefix}</span>
                    )}
                    <span className="sc-workspace-band-label">{bandLabel}</span>
                  </span>
                  <span className="sc-workspace-band-count">
                    {wm.complete} of {wm.total} {isFeeAccount ? "confirmed" : "entered"}
                  </span>
                  <span className="sc-workspace-band-sum">
                    {isFeeAccount
                      ? `${(wm.actMeals || 0).toLocaleString()} meals`
                      : fmt$(wm.actRev)}
                  </span>
                </div>
              )}
              {/* sc-30 PR-A1 (2026-08-07): per-week finalize control.
                  Placement: distinct row BELOW the band, ABOVE the
                  day cells. The band itself stays aria-hidden (it is
                  decorative); this row is interactive and gets its
                  own role. Fee/MLB/MiLB-AAA accounts don't render
                  this at all (showFinalize=false). The row's Monday
                  is week[0]?.date - buildWorkspaceWeekGrid produces
                  Mon-Sun-aligned rows so index 0 is always Monday.
                  weekDayRecords is filtered to the actual day
                  records (excluding ghosts and empties) so the
                  client-side completeness rule sees real statuses. */}
              {showFinalize && (() => {
                const rowMonday = week[0]?.date || null;
                if (!rowMonday) return null;
                const weekDayRecords = week
                  .filter(c => c && c.day)
                  .map(c => c.day);
                // Skip render on out-of-period leading rows where
                // ALL cells are ghost/empty (no real days). Trailing
                // ghost rows never reach here since
                // buildWorkspaceWeekGrid stops before them.
                if (weekDayRecords.length === 0) return null;
                const liveRow = finalizeRowsByWeek.get(rowMonday) || null;
                return (
                  <div
                    className="sc-workspace-week-finalize-row"
                    data-week-start={rowMonday}
                    role="group"
                    aria-label={`Finalize actions for week starting ${rowMonday}`}
                  >
                    <WeekFinalizeControl
                      accountKey={accountKey}
                      weekStart={rowMonday}
                      weekDays={weekDayRecords}
                      liveRow={liveRow}
                      isOverrideUser={isOverrideUser}
                      onFinalize={handleFinalize}
                      onRevert={handleRevert}
                      onRetry={handleRetry}
                    />
                  </div>
                );
              })()}
              <div role="row" className="sc-workspace-grid-row">
                {week.map((cell, colIdx) => {
              const flatIdx = weekIdx * 7 + colIdx;
              if (cell.ghost) {
                // P1 item 6 (render R4b): in-period date with no
                // metadata row. Inert (aria-hidden + no onClick),
                // excluded from roving (cell.day is null, scan helpers
                // skip it), never renders content or overlays.
                const dayNumber = Number(cell.ghostDate.slice(8, 10));
                return (
                  <span
                    key={flatIdx}
                    className="sc-workspace-grid-cell"
                    aria-hidden="true"
                  >
                    <span className="sc-daysq sc-daysq--lg sc-daysq--ghost">
                      <span className="sc-daysq-top">
                        <span className="sc-daysq-date">{dayNumber}</span>
                      </span>
                    </span>
                  </span>
                );
              }
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
              const content = loadState === "failed" ? null : buildLargeContent(d, kind, homestandMap, isMilb, accountKey, scheduleOverlay);
              // Bulk-selectable gate. Phase 2A / Ruling 4 (2026-07-24):
              // ENTERED PAST days are now selectable so the two
              // operator workflows the no-service ruling identified
              // - cancelled-after-entry, wrong-day - work in bulk too.
              // Manual zeroing loses the audit signal; a bulk overwrite
              // preserves it (BulkReview flags the row + the batch,
              // Ledger records every value as old->new).
              //
              // Gate now reads SERVER status (d.status) not the resolved
              // display status: `resolveDayStatus` maps both `no-service`
              // AND `prep` to "off", which would conflate two different
              // rulings.
              //
              // "no-service" splits on hasActuals - the classifier emits
              // it for TWO distinct realities (serviceCalendar.js):
              //   :303  hasAct && !anyNonZeroAct     -> recorded
              //         cancellation (operator marked no-service; all-
              //         zero actuals exist). Selectable - re-entry is
              //         legitimate, audit trail via Ledger.
              //   :310  !hasAct && hasProj &&        -> planned off-day
              //         !anyNonZeroProj                (PR #167; nothing
              //         ever scheduled). BLOCKED - schedule truth:
              //         nothing scheduled, nothing to bulk-enter. A bulk
              //         write here would inject zero-value rows into
              //         sc_daily_actuals and flip the day's classifica-
              //         tion from planned-off (:310) to recorded
              //         no-service (:303), silently promoting a non-
              //         scheduled day to a cancellation in the Ledger
              //         and exports.
              //
              // Full 9-status partition (owner Ruling 5, 2026-07-24):
              //   ALLOW:
              //     entered, needs-entry, overdue, future,
              //     no-service + hasActuals (kind 1)
              //   BLOCK:
              //     no-service + !hasActuals (kind 2),
              //     off-season, prep,
              //     exhibition, away (via isDisplayOnly)
              //
              // Do NOT drop the hasActuals term on no-service without
              // reading serviceCalendar.js:303-310. Removing it re-
              // admits planned off-days.
              const isExhibition = status === "exhibition";
              const isAway = status === "away";
              const isDisplayOnly = isExhibition || isAway;
              const dayNotScheduled = d.status === "off-season"
                || d.status === "prep"
                || (d.status === "no-service" && !d.hasActuals);
              const isBulkSelectable = bulkMode && !dayNotScheduled && !isDisplayOnly;
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
                    hasActuals={d.hasActuals}
                    /* P3-B (2026-07-28): tile flip animation gate.
                       true = per-meal + STL-FL (P3-B in scope).
                       false = MLB fee homestand (byte-identical). */
                    entryMotion={!(isFeeAccount && hasHomestandSchedule)}
                    /* P3-B gate-2: workspace-level flip signal. */
                    justFlipped={!!(justFlippedDates && justFlippedDates.has(d.date))}
                    role="gridcell"
                    tabIndex={isRoving ? 0 : -1}
                    /* M-3 (2026-08-XX): if the parent provides no
                       onDayClick AND bulk mode is off, there is
                       nothing to do on click; render the tile as
                       fully inert (no cursor pointer, no aria role
                       button) rather than truthy-but-noop. MLB
                       accounts follow this path per ruling B. */
                    onClick={(isDisplayOnly || (!onDayClick && !bulkMode)) ? undefined : () => {
                      setFocusIdx(flatIdx);
                      if (bulkMode) {
                        if (isBulkSelectable) onBulkTileClick?.(d.date);
                        return;
                      }
                      onDayClick?.(d.date);
                    }}
                    ariaLabel={`${d.date}, ${status}`}
                    isSyncing={syncingDates?.has(d.date) || false}
                    // P2 (item 3, R3): the drill-in day payload carries
                    // noteEntries directly (see loadMonth in the
                    // orchestrator). NOTE-only signal - history rows
                    // are excluded per Kevin's Q-b ruling.
                    hasNote={(d.noteEntries?.length || 0) > 0}
                    // sc-19 (2026-07-12): drives the "ST" pill on the
                    // lg tile's top-right cluster. Client-derived from
                    // phaseCalendar.js.
                    isSpringPhase={!!springDateSet?.has(d.date)}
                  />
                </span>
              );
            })}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Builds the large-size content bag from the per-day record. The
// per-day record (post-B2a periodDays) has day.totals, day.projected,
// day.actual, day.meta.week, day.gameType, day.hasActuals - richer
// than year-summary's day shape, so we render real $ and meals.
function buildLargeContent(day, kind, homestandMap, isMilb, accountKey, scheduleOverlay) {
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
      // sc-15 (2026-07-11): day/night from sc_homestand_schedule.day_night
      // (populated for HOME GAME rows). Drives the ghost pill on lg tiles.
      // Null for AWAY / EXHIBITION - no pill on those tiles.
      dayNight: hs?.dayNight || null,
      // Ghost pill (2026-07-11): pre-format the venue-local time here so
      // the atom stays presentation-only. "1:10 ET" / "7:05 CT" per the
      // account's home-park timezone map. Null when no MLB game_time.
      pillTime: formatMlbHomeGameTime(hs?.gameTime, accountKey),
      // sc-16 (2026-07-11): DH affix pass-through. MLB fee accounts don't
      // have any DH rows today (defaults false); the mlb-fee render
      // decorates the opponent chip when the flag is true.
      isDoubleheader: !!hs?.isDoubleheader,
    };
  }
  if (kind === "milb") {
    // Stage 5 polymorphism fix: MiLB is per-meal financially (the
    // pill carries the operational shape; $ + meals carry the
    // financial truth). docs/SC_BILLING_MODEL_AUDIT.md confirms
    // CIN-KY is "Per-meal only, two-tier". Without revenue here,
    // the workspace day-tile would silently drop $ for MiLB.
    //
    // sc-16 (2026-07-11): source precedence for schedule-having MiLB
    // accounts (Louisville/Buffalo). When homestandMap has an hs row
    // for this date, the schedule wins:
    //   opponent          <- hs.opponent (NEW field on the milb bag)
    //   dayNight          <- hs.dayNight   (over parsed gameType text)
    //   pillTime          <- MLB-style formatter from hs.gameTime (UTC)
    //   isDoubleheader    <- hs.isDoubleheader
    // Other MiLB accounts (no hs) fall through to the sc_day_metadata
    // path unchanged.
    const hs = homestandMap?.[day.date];
    const g = (day.gameType || day.meta?.gameType || "").toLowerCase();
    const parsedDayNight = g.includes("day") ? "day"
                        : g.includes("night") ? "night"
                        : null;
    const dayNight = hs?.dayNight || parsedDayNight;
    const pillTime = hs?.gameTime
      ? formatMlbHomeGameTime(hs.gameTime, accountKey)
      : formatMilbHomeGameTime(day.gameTime || day.meta?.gameTime);
    const rev = day.hasActuals
      ? day.totals?.actualRevenue
      : day.totals?.projectedRevenue;
    return {
      opponent: hs?.opponent || null,
      isDoubleheader: !!hs?.isDoubleheader,
      // Ghost pill (2026-07-11): MiLB uses `dayNight` now (parity with
      // MLB fee) - the pill render on lg reads this alongside pillTime.
      // `milbPill` retained for backward-compat with any sm-scope reader
      // (year-grid pickCompactSmall gate).
      milbPill: dayNight,
      dayNight,
      pillTime,
      meals: meals || null,
      revenue: rev != null ? rev : null,
      isEstimated: !day.hasActuals && isPastDate(day.date),
    };
  }
  if (kind === "fee-no-dollar") {
    // sc-17 (2026-07-11): if the account is flagged for schedule
    // overlay (STL - FL today), a GAME row on this date brings an
    // opponent chip + day/night pill into the tile ADDITIVELY -
    // the served-only render stays intact underneath, no state /
    // color / border change. Days without a row keep rendering
    // exactly as they did pre-sc-17.
    //
    // sc-28 (2026-08-05): the overlay map now also carries AWAY rows
    // where (account, opponent_team_id) sits in the home-dining
    // opponent map. `isAwayHomeDining` marks those days for the
    // render layer to switch the pill copy ("at OPP · Meals@Home"
    // in the copper family) and route the location label to "at"
    // instead of "VS". Non-qualifying away games do not reach this
    // branch - loadScheduleOverlay drops them.
    const ov = scheduleOverlay?.[day.date];
    return {
      served: meals || null,
      opponent: ov?.opponent || null,
      dayNight: ov?.dayNight || null,
      pillTime: formatMlbHomeGameTime(ov?.gameTime, accountKey),
      isDoubleheader: !!ov?.isDoubleheader,
      isAwayHomeDining: !!ov?.isAwayHomeDining,
    };
  }
  // per-meal default
  const rev = day.hasActuals
    ? day.totals?.actualRevenue
    : day.totals?.projectedRevenue;
  // sc-17b (2026-07-11): overlay for per-meal accounts that are
  // flagged for informational schedule display (TBJ - FL, Dunedin
  // Blue Jays). Same additive treatment as the fee-no-dollar branch
  // above - opponent + pill get prepended when a GAME row exists;
  // days without a row keep rendering pre-sc-17b behavior.
  const ovPm = scheduleOverlay?.[day.date];
  return {
    revenue: rev != null ? rev : null,
    meals: meals || null,
    isEstimated: !day.hasActuals && isPastDate(day.date),
    opponent: ovPm?.opponent || null,
    dayNight: ovPm?.dayNight || null,
    pillTime: formatMlbHomeGameTime(ovPm?.gameTime, accountKey),
    isDoubleheader: !!ovPm?.isDoubleheader,
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
      // P1 item 6 (render R4b, 2026-07-10): in-period calendar dates
      // that carry no metadata row (no projection, no actual, no
      // sc_day_metadata) and are NOT the failed-state fabrication
      // render as GHOST tiles: white ground + 1px dashed border +
      // muted numeral, inert to keyboard + counts. Marker only; the
      // roving-tabindex helpers still use `cell.day` (null for ghosts)
      // so ghosts are naturally skipped there. The render branch
      // detects `cell.ghost` before falling through to the out-of-
      // period empty span.
      const ghostDate = inPeriod && !realDay && !stubDay ? dateStr : null;
      // PR-D drill Phase 1: attach `date` to every cell (in-period and
      // out-of-period) so the calendar-week band lookup can key on the
      // row's Monday without walking back through gridStart arithmetic.
      // Existing consumers (renderCell etc.) ignore the extra field.
      cells.push({ date: dateStr, day: realDay || stubDay || null, ghost: !!ghostDate, ghostDate });
      cursor.setDate(cursor.getDate() + 1);
    }
    week++;
    if (cursor > end && cursor.getDay() === 1) break;
  }
  return cells;
}
