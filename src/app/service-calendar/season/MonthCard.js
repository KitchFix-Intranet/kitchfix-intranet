"use client";

// MonthCard - one month-card in the Calendar grid. Renders its days
// through the Stage 0 atom at small size. Reproduces the trusted
// year-heatmap's information density (M-S DOW header + ~28 day cells
// + a footer of "X/Y entered" + revenue or completion).
//
// The atom is the SINGLE source of day rendering - no day tile
// re-implemented inline. The MonthCard's job is:
//   1. Build the 7x6 calendar grid for the month
//   2. Look up each in-month day's status from the year-summary data
//   3. Map (resolveDayStatus + buildCompactContent) into atom props
//   4. Render off-day fills for the cells that fall outside the month
//      (the leading/trailing days of the first/last week)
//   5. Show off-season state when the month has no service
//   6. Show the per-account footer (revenue for per-meal, completion
//      for fee, homestand count for MLB-fee)

import DaySquare from "../DaySquare";
import { resolveDayStatus, buildCompactContent } from "../dayResolvers";

const DOW_HEADER = ["M","T","W","T","F","S","S"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export default function MonthCard({
  year,
  monthIndex,                // 0-11
  monthSummary,              // sc-year-summary months[i] or null
  todayDate,                 // YYYY-MM-DD string or null
  kind,                      // resolved DayKind from dayResolvers
  hasHomestandSchedule,      // bool - drives footer mode
  isFeeAccount,              // bool - drives footer mode
  isMilb,                    // bool - drives no-service detection on per-meal
  onClick,                   // (monthIndex) => void
}) {
  // Build the calendar grid. The week starts on Monday to match the
  // existing heatmap's DOW header convention.
  const weeks = buildMonthWeeks(year, monthIndex);

  // Index the days[] payload by date string for O(1) lookup as we
  // walk the 7x6 grid cells.
  const daysByDate = new Map();
  if (monthSummary?.days) {
    for (const d of monthSummary.days) daysByDate.set(d.date, d);
  }

  const monthName = MONTH_NAMES[monthIndex];
  const isCurrentMonth = todayDate
    ? Number(todayDate.slice(5, 7)) - 1 === monthIndex
    : false;

  const noService = detectNoService({
    monthSummary,
    hasHomestandSchedule,
    isFeeAccount,
    isMilb,
  });

  return (
    <article
      className={`sc-season-month-card ${isCurrentMonth ? "sc-season-month-card--current" : ""}`}
      onClick={() => onClick?.(monthIndex)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(monthIndex); }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${monthName} ${year}, open month`}
    >
      <header className="sc-season-month-card-header">
        <span className="sc-season-month-card-name">{monthName}</span>
        <span className="sc-season-month-card-drill" aria-hidden="true">View →</span>
      </header>

      <div className="sc-season-month-card-dow" aria-hidden="true">
        {DOW_HEADER.map((d, i) => (
          <span key={i} className="sc-season-month-card-dow-cell">{d}</span>
        ))}
      </div>

      <div className="sc-season-month-card-grid">
        {weeks.flat().map((cell, i) => renderCell({
          cell, monthIndex, daysByDate, todayDate, kind,
        })).map((node, i) => (
          <span key={i} className="sc-season-month-card-cell">{node}</span>
        ))}
      </div>

      {noService ? (
        <div className="sc-season-month-card-noservice">Off-season</div>
      ) : (
        <MonthCardFooter
          monthSummary={monthSummary}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
        />
      )}
    </article>
  );
}

// Renders a single cell - either an in-month atom tile or a quiet
// out-of-month spacer. The atom carries every day's status, today
// flag, and compact content.
function renderCell({ cell, monthIndex, daysByDate, todayDate, kind }) {
  if (cell.month !== monthIndex) {
    // Out-of-month cell - render a quiet placeholder, NOT through the
    // atom (the atom is for actual day rendering). Keeps the calendar
    // grid shape without polluting the atom's contract.
    return <span className="sc-season-month-card-cell-empty" aria-hidden="true" />;
  }
  const day = daysByDate.get(cell.dateStr);
  const status = day ? resolveDayStatus(day.status) : "off";
  const isToday = todayDate === cell.dateStr;
  const content = day ? buildCompactContent(day, kind) : null;
  return (
    <DaySquare
      dateNumber={cell.day}
      status={status}
      size="sm"
      kind={kind}
      content={content}
      isToday={isToday}
      ariaLabel={`${cell.dateStr}, ${status}`}
    />
  );
}

// The month-card footer matches the trusted heatmap's three modes.
// Per-meal: "X/Y entered" + $ (lifetime-K-formatted). Fee homestand:
// "X/Y game days" + "N homestand(s)". Operational fee (STL-FL):
// "X/Y entered" only, NO $ token.
function MonthCardFooter({ monthSummary, hasHomestandSchedule, isFeeAccount }) {
  if (!monthSummary) return null;
  const totalDays = Number(monthSummary.totalDays) || 0;
  const daysEntered = Number(monthSummary.daysWithActuals) || 0;
  const completionPct = totalDays > 0 ? Math.round(daysEntered / totalDays * 100) : 0;

  if (hasHomestandSchedule) {
    const hs = monthSummary.homestandSummary || {};
    const gameDays = hs.gameDays || 0;
    const gameDaysEntered = hs.gameDaysEntered || 0;
    const hsCount = hs.homestandIds?.length || 0;
    const feePct = gameDays > 0 ? Math.round(gameDaysEntered / gameDays * 100) : 0;
    return (
      <footer className="sc-season-month-card-footer">
        <div className="sc-season-month-card-stats">
          <span className="sc-season-month-card-stat-main">
            <strong>{gameDaysEntered}</strong>/{gameDays} game days
          </span>
          <span className="sc-season-month-card-stat-aux">
            {hsCount} {hsCount === 1 ? "homestand" : "homestands"}
          </span>
        </div>
        {feePct > 0 && <ProgressBar pct={feePct} />}
      </footer>
    );
  }

  if (isFeeAccount) {
    // Operational-only fee (STL-FL): NO $ token. The structural
    // discipline lives in the JSX absence - never call fmtMoney here.
    return (
      <footer className="sc-season-month-card-footer">
        <div className="sc-season-month-card-stats">
          <span className="sc-season-month-card-stat-main">
            <strong>{daysEntered}</strong>/{totalDays} entered
          </span>
        </div>
        {completionPct > 0 && <ProgressBar pct={completionPct} />}
      </footer>
    );
  }

  // Per-meal / MiLB - shows $ (lifetime-K formatted, matching the
  // current heatmap's footer convention).
  const hasActuals = daysEntered > 0;
  const displayRev = hasActuals
    ? Number(monthSummary.actualRevenue) || 0
    : Number(monthSummary.projectedRevenue) || 0;
  return (
    <footer className="sc-season-month-card-footer">
      <div className="sc-season-month-card-stats">
        <span className="sc-season-month-card-stat-main">
          <strong>{daysEntered}</strong>/{totalDays} entered
        </span>
        <span className={`sc-season-month-card-stat-rev ${hasActuals ? "sc-season-month-card-stat-rev--actual" : ""}`}>
          {displayRev > 0 ? fmtK(displayRev) : "$0"}
        </span>
      </div>
      {completionPct > 0 && <ProgressBar pct={completionPct} />}
    </footer>
  );
}

function ProgressBar({ pct }) {
  return (
    <div className="sc-season-month-card-bar" aria-hidden="true">
      <div
        className={`sc-season-month-card-bar-fill ${pct === 100 ? "sc-season-month-card-bar-fill--complete" : ""}`}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}

// "Off-season" detection per account type. Matches the trusted year-
// heatmap's noService logic so the redesigned card surfaces the same
// "Off-season" label on the same months.
function detectNoService({ monthSummary, hasHomestandSchedule, isFeeAccount, isMilb }) {
  if (!monthSummary) return true;
  if (hasHomestandSchedule) {
    const hs = monthSummary.homestandSummary;
    return !hs || (hs.gameDays === 0 && hs.prepDays === 0);
  }
  if (isFeeAccount) {
    // STL-FL with $0 per-meal prices: rev-based gate would always say
    // "no service". Use count-based: no projected AND no actual meals.
    const projCovers = Number(monthSummary.projectedCovers) || 0;
    const actCovers  = Number(monthSummary.actualCovers) || 0;
    return Number(monthSummary.totalDays) === 0 || (projCovers === 0 && actCovers === 0);
  }
  if (isMilb) {
    return Number(monthSummary.totalDays) === 0;
  }
  // Per-meal default: both projected and actual revenue zero with a
  // positive day count = "no service" (planned off-season).
  const projRev = Number(monthSummary.projectedRevenue) || 0;
  const actRev  = Number(monthSummary.actualRevenue)    || 0;
  const totalDays = Number(monthSummary.totalDays)      || 0;
  return projRev === 0 && actRev === 0 && totalDays > 0;
}

// Build a 6-week grid of cells for the given month. Mondays start
// each row to match the trusted heatmap's DOW header. Out-of-month
// cells carry month=null sentinel so the renderer can distinguish.
function buildMonthWeeks(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  // Find the Monday on or before first-of-month.
  const startDow = first.getDay(); // 0=Sun, 1=Mon, ...
  const daysBeforeMonday = startDow === 0 ? 6 : startDow - 1;
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - daysBeforeMonday);

  const weeks = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const month = cursor.getMonth();
      const day = cursor.getDate();
      const dateStr = `${cursor.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      row.push({
        month: month === monthIndex ? monthIndex : null,
        day,
        dateStr,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
    // Stop early once we're past last-of-month AND back on a Monday
    if (cursor > last && cursor.getDay() === 1) break;
  }
  return weeks;
}

function fmtK(n) {
  if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
  return "$" + Math.round(n);
}
