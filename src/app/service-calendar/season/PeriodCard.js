"use client";

// PeriodCard - one of the 13 period-cards in the Period grid.
//
// Mirrors the MonthCard pattern (Stage 1) for visual continuity:
// header (phase-tinted) + day cells (rendered through the Stage 0
// atom at sm) + footer (per-account-kind stats). The phase tint
// comes from the SHARED SPINE (derivePhaseTimeline + derivePeriodPhase
// in phaseDerivation.js) - the same data the strip's blocks read.
//
// Spec 7.4 (locked): straddle rule is majority-phase tint + both
// phase names in the subtitle when the period spans more than one.
// Confirmed against CIN-AZ recorded data: P3 in CIN-AZ straddles
// Early Camp -> MLB ST (Jan 19 - Feb 9 transition), so the card
// will tint by the majority phase (MLB ST owns more days) and the
// subtitle reads "P3 · mid Feb · Camps -> Spring Training".

import DaySquare from "../DaySquare";
import {
  resolveDayStatus,
  buildCompactContent,
} from "../dayResolvers";
import {
  derivePeriodPhase,
  humanAnchor,
} from "./phaseDerivation";
import { CANONICAL_PHASES } from "./phaseCalendar";

export default function PeriodCard({
  periodRange,                // { period, start, end } from sc-year-summary
  days,                       // pre-bucketed day records for this period
  todayDate,                  // YYYY-MM-DD or null
  kind,                       // resolved day-kind from dayResolvers
  hasHomestandSchedule,
  isFeeAccount,
  timeline,                   // derivePhaseTimeline result (the shared spine)
  onClick,                    // (periodKey) => void
}) {
  const periodLabel = String(periodRange.period);
  const periodNum = periodLabel.replace(/^P/i, "");
  const anchor = humanAnchor(periodRange.start, periodRange.end);

  const phaseAssignment = derivePeriodPhase(periodRange, timeline);
  const primaryPhase = phaseAssignment.primary
    ? CANONICAL_PHASES[phaseAssignment.primary]
    : null;
  const straddles = phaseAssignment.secondary != null;

  // Sort + dedupe by date defensively. Year-summary's days[] is
  // ordered, but a period spans 1-2 months so days come from two
  // months' arrays - de-duping protects against any edge accidentally
  // doubling a date.
  const sortedDays = useSortedUniqueDays(days);

  const isOffSeasonPeriod = detectOffSeason(sortedDays, kind);
  const isCurrentPeriod = todayDate
    ? sortedDays.some(d => d.date === todayDate)
    : false;

  const headerStyle = primaryPhase
    ? { background: primaryPhase.tint, color: primaryPhase.textTint }
    : undefined;

  return (
    <article
      className={`sc-season-period-card ${isCurrentPeriod ? "sc-season-period-card--current" : ""} ${isOffSeasonPeriod ? "sc-season-period-card--offseason" : ""}`}
      onClick={() => onClick?.(periodLabel)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.(periodLabel);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Period ${periodNum}, ${anchor}, open period`}
    >
      <header className="sc-season-period-card-header" style={headerStyle}>
        <div className="sc-season-period-card-title">
          <span className="sc-season-period-card-num">P{periodNum}</span>
          <span className="sc-season-period-card-anchor">· {anchor}</span>
        </div>
        <div className="sc-season-period-card-subtitle">
          {primaryPhase ? (
            straddles
              ? phaseAssignment.bothLabels.slice(0, 2).join(" -> ")
              : primaryPhase.label
          ) : (
            <span className="sc-season-period-card-subtitle-pending">phase pending</span>
          )}
        </div>
      </header>

      {/* Day cells - aligned to day-of-week (Mon-first) so the period
          reads the same as a month grid. Empty spacers fill any
          partial leading/trailing week so the columns stay coherent
          with the DOW header above.

          The atom is the SINGLE day renderer; no inline day tile. The
          CSS overrides .sc-daysq--sm inside this grid the same way
          MonthCard does (date-as-hero, no middle line at year scale). */}
      <div className="sc-season-period-card-dow" aria-hidden="true">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <span key={i} className="sc-season-period-card-dow-cell">{d}</span>
        ))}
      </div>
      <div className="sc-season-period-card-grid">
        {buildWeekAlignedCells(periodRange, sortedDays).map((cell, i) => {
          if (!cell.day) {
            return <span key={i} className="sc-season-period-card-cell sc-season-period-card-cell-empty" aria-hidden="true" />;
          }
          const status = resolveDayStatus(cell.day.status);
          const content = buildCompactContent(cell.day, kind);
          return (
            <span key={cell.day.date} className="sc-season-period-card-cell">
              <DaySquare
                date={cell.day.date}
                status={status}
                size="sm"
                kind={kind}
                content={content}
                isToday={cell.day.date === todayDate}
                ariaLabel={`${cell.day.date}, ${status}`}
              />
            </span>
          );
        })}
      </div>

      {isOffSeasonPeriod ? (
        <div className="sc-season-period-card-noservice">Off-season</div>
      ) : (
        <PeriodCardFooter
          days={sortedDays}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
        />
      )}
    </article>
  );
}

// ─── Footer ─────────────────────────────────────────────────────
// Three modes mirror MonthCard's footer:
//   homestand-fee: X/Y game days + N homestand(s)
//   operational-fee (STL-FL): X/Y entered, NO $ (structural absence)
//   per-meal / MiLB: X/Y entered + revenue (compact K format)
//
// Revenue is summed from the year-summary day records' projection
// totals. The year-summary's per-day record doesn't carry the per-day
// $; we use the parent months[].projectedRevenue and actualRevenue,
// pro-rated by day count - but actually we don't have either at this
// granularity. So the period footer shows the days-complete + a
// totals row that's count-only at year scope. The Period workspace
// (Stage 3) reads sc-load's day.totals for the real $ breakdown.

function PeriodCardFooter({ days, hasHomestandSchedule, isFeeAccount }) {
  if (!days?.length) return null;
  const totalDays = days.length;
  const entered = days.filter(d => d.status === "entered").length;
  const needsAttention = days.filter(d => d.status === "needs-entry" || d.status === "overdue").length;
  const totalMeals = days.reduce((sum, d) => sum + (Number(d.actualMeals) || 0), 0);
  const completionPct = totalDays > 0 ? Math.round(entered / totalDays * 100) : 0;

  if (hasHomestandSchedule) {
    const gameDays = days.filter(d => d.dayType === "GAME").length;
    const gameDaysEntered = days.filter(d => d.dayType === "GAME" && d.status === "entered").length;
    const homestands = new Set(days.map(d => d.homestandId).filter(Boolean));
    const feePct = gameDays > 0 ? Math.round(gameDaysEntered / gameDays * 100) : 0;
    return (
      <footer className="sc-season-period-card-footer">
        <div className="sc-season-period-card-stats">
          <span className="sc-season-period-card-stat-main">
            <strong>{gameDaysEntered}</strong>/{gameDays} game days
          </span>
          <span className="sc-season-period-card-stat-aux">
            {homestands.size} {homestands.size === 1 ? "homestand" : "homestands"}
          </span>
        </div>
        {feePct > 0 && <ProgressBar pct={feePct} />}
      </footer>
    );
  }

  if (isFeeAccount) {
    return (
      <footer className="sc-season-period-card-footer">
        <div className="sc-season-period-card-stats">
          <span className="sc-season-period-card-stat-main">
            <strong>{entered}</strong>/{totalDays} entered
          </span>
          {needsAttention > 0 && (
            <span className="sc-season-period-card-stat-warn">
              {needsAttention} to enter
            </span>
          )}
        </div>
        {completionPct > 0 && <ProgressBar pct={completionPct} />}
      </footer>
    );
  }

  return (
    <footer className="sc-season-period-card-footer">
      <div className="sc-season-period-card-stats">
        <span className="sc-season-period-card-stat-main">
          <strong>{entered}</strong>/{totalDays} entered
        </span>
        <span className="sc-season-period-card-stat-aux">
          {totalMeals > 0 ? `${totalMeals.toLocaleString("en-US")} meals` : "0 meals"}
        </span>
      </div>
      {completionPct > 0 && <ProgressBar pct={completionPct} />}
    </footer>
  );
}

function ProgressBar({ pct }) {
  return (
    <div className="sc-season-period-card-bar" aria-hidden="true">
      <div
        className={`sc-season-period-card-bar-fill ${pct === 100 ? "sc-season-period-card-bar-fill--complete" : ""}`}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}

// "Offseason" detection per kind. For PDC fee + per-meal: zero meals
// across the period AND no future days (all upcoming/off). For
// homestand: no game days at all. Matches the Stage 1 MonthCard
// discipline of NEVER calling a productive period "offseason".
function detectOffSeason(days, kind) {
  if (!days?.length) return true;
  const hasService = days.some(d =>
    d.status === "entered" || d.status === "needs-entry"
    || d.status === "overdue" || d.status === "future"
    || d.status === "upcoming-game" || d.status === "future-service"
    || d.dayType === "GAME"
  );
  return !hasService;
}

// Inline-ish memo: sortedDays is recomputed each render. The 13
// periods x ~28 days = ~365 records total; cheap to sort on each
// render and avoids React Hook coordination at the cell level.
function useSortedUniqueDays(days) {
  if (!days?.length) return [];
  const seen = new Set();
  const out = [];
  for (const d of days) {
    if (seen.has(d.date)) continue;
    seen.add(d.date);
    out.push(d);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Build a 7-wide grid of cells with day-of-week alignment. Empty
// spacers fill any leading/trailing days outside the period range
// so the columns stay coherent with the DOW header (Mon-first).
function buildWeekAlignedCells(periodRange, sortedDays) {
  if (!sortedDays?.length) return [];
  const byDate = new Map(sortedDays.map(d => [d.date, d]));
  const startStr = periodRange.start;
  const endStr   = periodRange.end;
  const start = new Date(startStr + "T12:00:00");
  const end   = new Date(endStr   + "T12:00:00");

  // Find the Monday on or before period.start. dow: 0=Sun, 1=Mon, ...
  const startDow = start.getDay();
  const daysBeforeMonday = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - daysBeforeMonday);

  // Walk weeks until we've passed period.end (and are back on Monday).
  const cells = [];
  const cursor = new Date(gridStart);
  let week = 0;
  while (week < 6) {
    for (let i = 0; i < 7; i++) {
      const dateStr = formatDate(cursor);
      const inPeriod = dateStr >= startStr && dateStr <= endStr;
      cells.push({
        day: inPeriod ? (byDate.get(dateStr) || { date: dateStr, status: "off", actualMeals: 0 }) : null,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    week++;
    if (cursor > end && cursor.getDay() === 1) break;
  }
  return cells;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
