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

import { useMemo } from "react";
import DaySquare from "../DaySquare";
import {
  resolveDayStatus,
  resolveDayKind,
} from "../dayResolvers";
import {
  derivePhaseTimeline,
  derivePeriodPhase,
  humanAnchor,
} from "./phaseDerivation";
import { CANONICAL_PHASES } from "./phaseCalendar";
import StateLegend from "./StateLegend";
import "./periodWorkspace.css";

const fmt$ = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const fmtK = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(v) >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
};

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
  partialError,
  // nav handlers
  onClimbToSeason,
  onPrevPeriod,
  onNextPeriod,
  onTodayJump,
  // day click + bulk
  onDayClick,
  bulkMode,
  onBulkModeToggle,         // (next: bool) => void
  bulkSelected,             // Set<dateStr>
  onBulkTileClick,          // (dateStr) => void (toggles selection)
  onBulkOpenPanel,          // opens the existing bulk entry panel
  onBulkConfirmAsProjected, // runs handleBulkConfirm (existing)
  onBulkCancel,             // exits bulk mode + clears selection
  saving,
}) {
  const kind = useMemo(
    () => resolveDayKind({
      billingModel: account?.billingModel,
      category: account?.category,
      hasHomestandSchedule,
    }),
    [account?.billingModel, account?.category, hasHomestandSchedule]
  );

  const phaseTimeline = useMemo(
    () => derivePhaseTimeline(account?.key, account?.category, year),
    [account?.key, account?.category, year]
  );

  const phaseAssignment = useMemo(
    () => derivePeriodPhase(periodRange, phaseTimeline),
    [periodRange, phaseTimeline]
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
  // contract).
  const cells = useMemo(
    () => buildWorkspaceWeekGrid(periodRange, periodDays),
    [periodRange, periodDays]
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

  // Prev/Next clamp - disable the buttons at the boundaries.
  const periodIdx = periodRanges?.findIndex(r => r.period === periodKey) ?? -1;
  const canPrev = periodIdx > 0;
  const canNext = periodIdx >= 0 && periodIdx < (periodRanges?.length - 1);

  // Today's day record (when the current period contains it). Drives
  // the today hero.
  const todayDay = useMemo(
    () => isCurrentPeriod && periodDays
      ? periodDays.find(d => d.date === today) || null
      : null,
    [isCurrentPeriod, periodDays, today]
  );

  // Header title
  const periodNum = periodKey ? String(periodKey).replace(/^P/i, "") : "";
  const anchor = periodRange ? humanAnchor(periodRange.start, periodRange.end) : "";
  const phasePrimaryLabel = phaseAssignment?.primary
    ? CANONICAL_PHASES[phaseAssignment.primary]?.label
    : null;
  const dateRangeLabel = periodRange
    ? `${fmtDateRange(periodRange.start, periodRange.end)}`
    : "";

  // ─── Loading / partial / empty branches ──────────────────────
  if (loading && !periodDays && !partialError) {
    return <WorkspaceSkeleton />;
  }
  if (partialError) {
    return (
      <div className="sc-workspace sc-fade-in">
        <NavRow
          onClimbToSeason={onClimbToSeason}
          onPrevPeriod={onPrevPeriod}
          onNextPeriod={onNextPeriod}
          onTodayJump={onTodayJump}
          canPrev={canPrev}
          canNext={canNext}
          periodNum={periodNum}
          phaseLabel={phasePrimaryLabel}
        />
        <WorkspacePartialBanner failedMonth={partialError.failedMonth} />
        <WorkspaceSkeleton inline />
      </div>
    );
  }
  if (!periodRange) {
    return (
      <div className="sc-workspace sc-fade-in">
        <NavRow
          onClimbToSeason={onClimbToSeason}
          onPrevPeriod={onPrevPeriod}
          onNextPeriod={onNextPeriod}
          onTodayJump={onTodayJump}
          canPrev={canPrev}
          canNext={canNext}
          periodNum={periodNum}
          phaseLabel={phasePrimaryLabel}
        />
        <div className="sc-workspace-empty">Pick a period from the Season grid.</div>
      </div>
    );
  }

  const m = periodMetrics || { projMeals: 0, actMeals: 0, projRev: 0, actRev: 0, complete: 0, needsEntry: 0, overdue: 0, total: 0, weeks: {} };

  return (
    <div className="sc-workspace sc-fade-in">
      <NavRow
        onClimbToSeason={onClimbToSeason}
        onPrevPeriod={onPrevPeriod}
        onNextPeriod={onNextPeriod}
        onTodayJump={onTodayJump}
        canPrev={canPrev}
        canNext={canNext}
      />

      <StateLegend
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
        showDayNight={true}
      />

      <header className="sc-workspace-header">
        <div className="sc-workspace-title">
          <span className="sc-workspace-title-period">Period {periodNum}</span>
          <span className="sc-workspace-title-anchor">· {anchor}</span>
          {phasePrimaryLabel && (
            <span className="sc-workspace-title-phase">
              · {phasePrimaryLabel}
              {phaseAssignment.secondary
                ? ` (-> ${CANONICAL_PHASES[phaseAssignment.secondary]?.label})`
                : ""}
            </span>
          )}
        </div>
        <div className="sc-workspace-range">{dateRangeLabel}</div>
      </header>

      <FinancialFrame
        m={m}
        kind={kind}
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        periodRange={periodRange}
        today={today}
      />

      {isCurrentPeriod && todayDay && (
        <TodayHero
          day={todayDay}
          kind={kind}
          homestandMap={homestandMap}
          onEnterActuals={() => onDayClick?.(todayDay.date)}
        />
      )}

      <BulkAffordance
        bulkMode={bulkMode}
        bulkSelected={bulkSelected}
        saving={saving}
        onToggle={onBulkModeToggle}
        onCancel={onBulkCancel}
        onOpenPanel={onBulkOpenPanel}
        onConfirmAsProjected={onBulkConfirmAsProjected}
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
        onDayClick={onDayClick}
        onBulkTileClick={onBulkTileClick}
      />

      <WeekSubtotals
        weekLabels={weekLabels}
        weekMetrics={m.weeks}
        kind={kind}
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
      />
    </div>
  );
}

// ─── Nav row ─────────────────────────────────────────────────────
// The breadcrumb (left) doubles as the climb-to-Season affordance:
// click "Season" climbs up. The Stage 3 climb button is folded into
// the breadcrumb's "Season" crumb so there's ONE climb path, not two.
// Stepper (right) handles prev/next/today within the current period.
function NavRow({ onClimbToSeason, onPrevPeriod, onNextPeriod, onTodayJump, canPrev, canNext, periodNum, phaseLabel }) {
  return (
    <nav className="sc-workspace-nav" aria-label="Period navigation">
      <ol className="sc-workspace-breadcrumb">
        <li className="sc-workspace-breadcrumb-item">
          <button
            type="button"
            className="sc-workspace-breadcrumb-link sc-workspace-breadcrumb-link--back"
            onClick={onClimbToSeason}
            aria-label="Back to Season"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Season</span>
          </button>
        </li>
        {phaseLabel && (
          <li className="sc-workspace-breadcrumb-item sc-workspace-breadcrumb-phase" aria-hidden="true">
            <span className="sc-workspace-breadcrumb-sep">/</span>
            <span className="sc-workspace-breadcrumb-phase-chip">{phaseLabel}</span>
          </li>
        )}
        {periodNum && (
          <li className="sc-workspace-breadcrumb-item" aria-current="page">
            <span className="sc-workspace-breadcrumb-sep">/</span>
            <span className="sc-workspace-breadcrumb-current">Period {periodNum}</span>
          </li>
        )}
      </ol>
      <div className="sc-workspace-nav-step">
        <button
          type="button"
          className="sc-workspace-nav-arrow-btn"
          disabled={!canPrev}
          onClick={onPrevPeriod}
          aria-label="Previous period"
        >&#8249;</button>
        <button
          type="button"
          className="sc-workspace-nav-today"
          onClick={onTodayJump}
        >
          Today
        </button>
        <button
          type="button"
          className="sc-workspace-nav-arrow-btn"
          disabled={!canNext}
          onClick={onNextPeriod}
          aria-label="Next period"
        >&#8250;</button>
      </div>
    </nav>
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
function FinancialFrame({ m, kind, hasHomestandSchedule, isFeeAccount, periodRange, today }) {
  const completionPct = m.total > 0 ? Math.round(m.complete / m.total * 100) : 0;
  const progressColor = (m.needsEntry + m.overdue) > 0 ? "var(--status-needs-strong)" : "var(--accent-sc)";

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

  if (hasHomestandSchedule) {
    return (
      <section className="sc-workspace-frame sc-workspace-frame--fee">
        <div className="sc-workspace-frame-hero">
          <div className="sc-workspace-frame-hero-num">
            <strong>{m.complete}</strong> <span className="sc-workspace-frame-hero-divisor">/ {m.total}</span>
          </div>
          <div className="sc-workspace-frame-hero-label">Game days entered</div>
        </div>
        <div className="sc-workspace-frame-aux">
          <div className="sc-workspace-frame-stat">
            <span className="sc-workspace-frame-stat-label">Meals</span>
            <span className="sc-workspace-frame-stat-value">{m.actMeals.toLocaleString("en-US")}</span>
          </div>
        </div>
        <ProgressLine pct={completionPct} color={progressColor} />
      </section>
    );
  }

  if (isFeeAccount) {
    // STL-FL discipline: NO $ tokens. Operational frame: days
    // entered + meals. Contract-allocation $ data isn't engine-
    // accessible at the period level yet (deferred per the spec
    // section 6 note); render the operational truth honestly.
    return (
      <section className="sc-workspace-frame sc-workspace-frame--operational">
        <div className="sc-workspace-frame-hero">
          <div className="sc-workspace-frame-hero-num">
            <strong>{m.complete}</strong> <span className="sc-workspace-frame-hero-divisor">/ {m.total}</span>
          </div>
          <div className="sc-workspace-frame-hero-label">Days entered</div>
        </div>
        <div className="sc-workspace-frame-aux">
          <div className="sc-workspace-frame-stat">
            <span className="sc-workspace-frame-stat-label">Meals served</span>
            <span className="sc-workspace-frame-stat-value">{m.actMeals.toLocaleString("en-US")}</span>
          </div>
          {(m.needsEntry + m.overdue) > 0 && (
            <div className="sc-workspace-frame-stat sc-workspace-frame-stat--warn">
              <span className="sc-workspace-frame-stat-label">Needs entry</span>
              <span className="sc-workspace-frame-stat-value">{m.needsEntry + m.overdue}</span>
            </div>
          )}
        </div>
        <ProgressLine pct={completionPct} color={progressColor} />
      </section>
    );
  }

  // Per-meal + MiLB - the financial-clarity hero. Revenue from
  // periodMetrics ONLY (#257-safe; no client-side recompute).
  const delta = m.actRev - m.projRev;
  const deltaLabel = delta >= 0
    ? `+${fmt$(Math.abs(delta))} ahead`
    : `${fmt$(Math.abs(delta))} to go`;
  const deltaColor = delta >= 0 ? "var(--text-success)" : "var(--accent-text)";

  return (
    <section className="sc-workspace-frame">
      <div className="sc-workspace-frame-numbers">
        <div className="sc-workspace-frame-money">
          <span className="sc-workspace-frame-entered">{fmt$(m.actRev)}</span>
          <span className="sc-workspace-frame-projected">of {fmtK(m.projRev)} projected</span>
        </div>
        <div className="sc-workspace-frame-delta" style={{ color: deltaColor }}>{deltaLabel}</div>
      </div>
      <div className="sc-workspace-frame-labels">
        <span className="sc-workspace-frame-label">Entered</span>
        <span className="sc-workspace-frame-label">Projected</span>
        <span />
      </div>
      <div className="sc-workspace-frame-progress">
        <div className="sc-workspace-frame-progress-label">
          <strong>{m.complete}</strong> / {m.total} days entered
          {(m.needsEntry > 0 || m.overdue > 0) && (
            <span className="sc-workspace-frame-progress-pending">
              {" · "}{m.needsEntry + m.overdue} pending
            </span>
          )}
        </div>
        <ProgressLine pct={completionPct} color={progressColor} />
      </div>
    </section>
  );
}

function ProgressLine({ pct, color }) {
  return (
    <div className="sc-workspace-progress-bar" aria-hidden="true">
      <div
        className="sc-workspace-progress-bar-fill"
        style={{ width: pct + "%", background: color }}
      />
    </div>
  );
}

// ─── Today hero ──────────────────────────────────────────────────
// Spec 5.4: prominent card for the 6am floor user. Only renders on
// the current period AND when today's day record is unentered (needs
// entry / overdue / future / no-service). For already-entered today,
// a quieter "Today entered" badge replaces the action card.
function TodayHero({ day, kind, homestandMap, onEnterActuals }) {
  const dateLabel = formatHumanDate(day.date);
  const needsAction = !day.hasActuals && day.status !== "off-season";

  if (!needsAction) {
    return (
      <div className="sc-workspace-today-pill">
        <span className="sc-workspace-today-pill-flag">TODAY</span>
        <span className="sc-workspace-today-pill-text">{dateLabel} entered</span>
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
    <section className="sc-workspace-today-hero" aria-label="Today">
      <div className="sc-workspace-today-hero-eyebrow">
        <span className="sc-workspace-today-hero-flag">TODAY</span>
        {statusWord && (
          <span className="sc-workspace-today-hero-status">{statusWord}</span>
        )}
      </div>
      <div className="sc-workspace-today-hero-date">{dateLabel}</div>
      {projection && <div className="sc-workspace-today-hero-projection">{projection}</div>}
      <button
        type="button"
        className="sc-workspace-today-hero-cta"
        onClick={onEnterActuals}
      >
        Enter actuals
      </button>
    </section>
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
function BulkAffordance({ bulkMode, bulkSelected, saving, onToggle, onCancel, onOpenPanel, onConfirmAsProjected }) {
  if (!bulkMode) {
    return (
      <div className="sc-workspace-bulk-rest">
        <button
          type="button"
          className="sc-workspace-bulk-rest-btn"
          onClick={() => onToggle?.(true)}
        >
          Select days
        </button>
        <span className="sc-workspace-bulk-rest-hint">to enter many at once</span>
      </div>
    );
  }
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
              onClick={onConfirmAsProjected}
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
function DayGrid({ cells, today, kind, hasHomestandSchedule, isFeeAccount, isMilb, homestandMap, bulkMode, bulkSelected, onDayClick, onBulkTileClick }) {
  return (
    <div className="sc-workspace-grid-wrap">
      <div className="sc-workspace-grid-dow" aria-hidden="true">
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
          <span key={d} className="sc-workspace-grid-dow-cell">{d}</span>
        ))}
      </div>
      <div className="sc-workspace-grid" role="list" aria-label="Days in this period">
        {cells.map((cell, i) => {
          if (!cell.day) {
            return <span key={i} className="sc-workspace-grid-cell sc-workspace-grid-cell-empty" aria-hidden="true" />;
          }
          const d = cell.day;
          const isToday = d.date === today;
          const status = resolveDayStatus(d.status);
          const isSelected = bulkMode && bulkSelected?.has(d.date);
          const content = buildLargeContent(d, kind, homestandMap, isMilb);
          // Bulk-selectable gate: only future / needs-entry days are
          // selectable for bulk entry. Entered days + off days have
          // no editable target; tile click in bulk mode is a no-op
          // for them.
          const isBulkSelectable = bulkMode && !d.hasActuals && status !== "off";
          return (
            <span key={d.date} className="sc-workspace-grid-cell">
              <DaySquare
                date={d.date}
                status={status}
                size="lg"
                kind={kind}
                content={content}
                isToday={isToday}
                isSelected={isSelected}
                onClick={() => {
                  if (bulkMode) {
                    if (isBulkSelectable) onBulkTileClick?.(d.date);
                    return;
                  }
                  onDayClick?.(d.date);
                }}
                ariaLabel={`${d.date}, ${status}`}
              />
            </span>
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
function buildLargeContent(day, kind, homestandMap, isMilb) {
  const projMeals = sumProjectedMeals(day);
  const actMeals = day.hasActuals ? sumActualMeals(day) : 0;
  const meals = day.hasActuals ? actMeals : projMeals;

  if (kind === "mlb-fee") {
    const hs = homestandMap?.[day.date];
    return {
      opponent: hs?.opponent || null,
      meals: meals || null,
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
      isEstimated: !day.hasActuals && day.isPast,
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
    isEstimated: !day.hasActuals && day.isPast,
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
function WeekSubtotals({ weekLabels, weekMetrics, kind, hasHomestandSchedule, isFeeAccount }) {
  if (!weekLabels?.length) return null;
  return (
    <div className="sc-workspace-weeks" aria-label="Week subtotals">
      {weekLabels.map((w, i) => {
        const wm = weekMetrics?.[w] || { actRev: 0, projRev: 0, actMeals: 0, complete: 0, total: 0 };
        let body;
        if (hasHomestandSchedule || isFeeAccount) {
          body = (
            <>
              {wm.complete}/{wm.total} entered
              {wm.actMeals > 0 ? ` · ${wm.actMeals.toLocaleString("en-US")} meals` : ""}
            </>
          );
        } else {
          const rev = wm.actRev > 0 ? wm.actRev : wm.projRev;
          const prefix = wm.actRev > 0 ? "" : "~";
          body = (
            <>
              {prefix}{fmtK(rev)} · {wm.complete}/{wm.total}
            </>
          );
        }
        return (
          <span key={w} className="sc-workspace-weeks-item">
            <span className="sc-workspace-weeks-label">{w}</span>
            <span className="sc-workspace-weeks-body">{body}</span>
            {i < weekLabels.length - 1 && <span className="sc-workspace-weeks-sep">·</span>}
          </span>
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

function WorkspaceSkeleton({ inline = false }) {
  return (
    <div className={`sc-workspace ${inline ? "" : "sc-fade-in"}`} aria-hidden="true">
      <div className="sc-workspace-skel sc-workspace-skel--frame" />
      <div className="sc-workspace-skel sc-workspace-skel--hero" />
      <div className="sc-workspace-grid-wrap">
        <div className="sc-workspace-skel sc-workspace-skel--dow" />
        <div className="sc-workspace-grid">
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className="sc-workspace-skel sc-workspace-skel--tile" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ──────────────────────────────────────────────────
function fmtDateRange(startStr, endStr) {
  const s = new Date(startStr + "T12:00:00");
  const e = new Date(endStr   + "T12:00:00");
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monthShort[s.getMonth()]} ${s.getDate()} - ${monthShort[e.getMonth()]} ${e.getDate()}`;
}

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
function buildWorkspaceWeekGrid(periodRange, periodDays) {
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
      cells.push({
        day: inPeriod ? (byDate.get(dateStr) || null) : null,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    week++;
    if (cursor > end && cursor.getDay() === 1) break;
  }
  return cells;
}
