"use client";

// MonthCard - one month-card in the Calendar grid. Mobile Overhaul
// adds the COLLAPSE accordion:
//   - Completed months (daysEntered === totalDays > 0) default to a
//     one-line collapsed tile.
//   - Empty future months (daysEntered === 0 AND today is BEFORE the
//     first day of the month) default to a one-line "Upcoming" tile.
//   - Off-season months default to a one-line "Off-season" tile (no
//     dense grid of em-dashes - audit P2-7).
//   - Current month + partial-progress months default expanded.
// Tapping the collapsed tile toggles to expanded in place. The
// "View ->" link still drills into the workspace from the expanded
// header. Chevron (expand-in-place) and "View ->" (drill) stay
// visually distinct.
//
// Closes audit P1-3 (uniform card heights - within each state),
// P1-9 (future-period 0/X punitive framing), P2-7 (off-season
// month-card collapse) plus the mobile-overhaul collapse centerpiece.

import { useState } from "react";
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
  const monthName = MONTH_NAMES[monthIndex];
  const todayMonth = todayDate ? Number(todayDate.slice(5, 7)) - 1 : null;
  const isCurrentMonth = todayMonth != null && todayMonth === monthIndex;

  const noService = detectNoService({
    monthSummary,
    hasHomestandSchedule,
    isFeeAccount,
    isMilb,
  });

  // Derive collapse defaults. The user can toggle with the chevron,
  // overriding the default. Only EXPANDED state mounts the grid.
  const collapseDefault = computeCollapseDefault({
    isCurrentMonth, noService, monthSummary, todayDate, year, monthIndex,
  });
  const [expanded, setExpanded] = useState(!collapseDefault);

  const toggle = (e) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const totalDays = Number(monthSummary?.totalDays) || 0;
  const daysEntered = Number(monthSummary?.daysWithActuals) || 0;
  const isComplete = totalDays > 0 && daysEntered === totalDays;
  const monthState = noService
    ? "off"
    : isComplete
      ? "done"
      : (totalDays > 0 && daysEntered === 0 && isFutureMonth(year, monthIndex, todayDate)
          ? "upcoming"
          : isCurrentMonth ? "current" : "in-progress");

  const cardClass = [
    "sc-season-month-card",
    expanded ? "sc-season-month-card--expanded" : "sc-season-month-card--collapsed",
    `sc-season-month-card--state-${monthState}`,
    isCurrentMonth && "sc-season-month-card--current",
  ].filter(Boolean).join(" ");

  return (
    <article
      className={cardClass}
      aria-label={`${monthName} ${year}`}
      data-state={monthState}
    >
      <header
        className="sc-season-month-card-header"
        onClick={(e) => {
          // Header click on collapsed card expands; on expanded card it
          // drills (matches the "View ->" affordance). The chevron is
          // the explicit expand/collapse control either way.
          if (!expanded) { e.stopPropagation(); setExpanded(true); return; }
          onClick?.(monthIndex);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!expanded) { setExpanded(true); return; }
            onClick?.(monthIndex);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span className="sc-season-month-card-name">{monthName}</span>
        <CollapsedSummary
          monthSummary={monthSummary}
          monthState={monthState}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
          totalDays={totalDays}
          daysEntered={daysEntered}
        />
        <ChevronToggle expanded={expanded} onClick={toggle} />
        {expanded && (
          <button
            type="button"
            className="sc-season-month-card-drill"
            onClick={(e) => { e.stopPropagation(); onClick?.(monthIndex); }}
            aria-label={`Open ${monthName}`}
          >
            View <span aria-hidden="true">→</span>
          </button>
        )}
      </header>

      {expanded && !noService && (
        <>
          <div className="sc-season-month-card-dow" aria-hidden="true">
            {DOW_HEADER.map((d, i) => (
              <span key={i} className="sc-season-month-card-dow-cell">{d}</span>
            ))}
          </div>

          <div className="sc-season-month-card-grid">
            {buildMonthWeeks(year, monthIndex).flat().map((cell, i) => renderCell({
              cell, monthIndex, daysByDate: indexDays(monthSummary), todayDate, kind,
            })).map((node, i) => (
              <span key={i} className="sc-season-month-card-cell">{node}</span>
            ))}
          </div>

          <MonthCardFooter
            monthSummary={monthSummary}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            monthState={monthState}
          />
        </>
      )}
    </article>
  );
}

// Inline summary that sits in the header row when the card is
// collapsed AND below the month name when expanded. Carries the
// glance state: completed (check + $), upcoming, in-progress, or
// off-season.
function CollapsedSummary({ monthSummary, monthState, hasHomestandSchedule, isFeeAccount, totalDays, daysEntered }) {
  if (monthState === "off") {
    return <span className="sc-season-month-card-summary">Off-season</span>;
  }
  if (monthState === "upcoming") {
    return (
      <span className="sc-season-month-card-summary sc-season-month-card-summary--upcoming">
        upcoming
        {totalDays > 0 && (
          <span className="sc-season-month-card-summary-aux"> · 0/{totalDays}</span>
        )}
      </span>
    );
  }
  // done / in-progress / current
  if (hasHomestandSchedule) {
    const hs = monthSummary?.homestandSummary || {};
    const gameDaysEntered = hs.gameDaysEntered || 0;
    const gameDays = hs.gameDays || 0;
    const done = gameDays > 0 && gameDaysEntered === gameDays;
    return (
      <span className={`sc-season-month-card-summary ${done ? "sc-season-month-card-summary--done" : ""}`}>
        {gameDaysEntered}/{gameDays} game days
        {done && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
    );
  }
  const done = totalDays > 0 && daysEntered === totalDays;
  const hasActuals = daysEntered > 0;
  const displayRev = hasActuals
    ? Number(monthSummary?.actualRevenue) || 0
    : Number(monthSummary?.projectedRevenue) || 0;
  return (
    <span className={`sc-season-month-card-summary ${done ? "sc-season-month-card-summary--done" : ""}`}>
      {daysEntered}/{totalDays} entered
      {!isFeeAccount && displayRev > 0 && (
        <span className={`sc-season-month-card-summary-rev ${hasActuals ? "sc-season-month-card-summary-rev--actual" : ""}`}>
          · {fmtK(displayRev)}
        </span>
      )}
      {done && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </span>
  );
}

function ChevronToggle({ expanded, onClick }) {
  return (
    <button
      type="button"
      className="sc-season-month-card-chevron"
      onClick={onClick}
      aria-label={expanded ? "Collapse month" : "Expand month"}
      aria-expanded={expanded}
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
        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

function indexDays(monthSummary) {
  const m = new Map();
  if (monthSummary?.days) {
    for (const d of monthSummary.days) m.set(d.date, d);
  }
  return m;
}

function renderCell({ cell, monthIndex, daysByDate, todayDate, kind }) {
  if (cell.month !== monthIndex) {
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

// Footer renders only when expanded.
function MonthCardFooter({ monthSummary, hasHomestandSchedule, isFeeAccount, monthState }) {
  if (!monthSummary) return null;
  if (monthState === "upcoming") {
    // Calm "Upcoming" framing - no 0% bar, no 0/X red flag.
    return (
      <footer className="sc-season-month-card-footer sc-season-month-card-footer--upcoming">
        <span className="sc-season-month-card-stat-aux">Upcoming month - nothing required yet.</span>
      </footer>
    );
  }
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

// Collapse default per the brief:
//   completed -> collapsed
//   empty future -> collapsed
//   off-season -> collapsed (single-line "Off-season")
//   current OR partial -> expanded
function computeCollapseDefault({ isCurrentMonth, noService, monthSummary, todayDate, year, monthIndex }) {
  if (isCurrentMonth) return false;
  if (noService) return true;
  if (!monthSummary) return true;
  const totalDays = Number(monthSummary.totalDays) || 0;
  const daysEntered = Number(monthSummary.daysWithActuals) || 0;
  if (totalDays > 0 && daysEntered === totalDays) return true; // completed
  if (totalDays > 0 && daysEntered === 0 && isFutureMonth(year, monthIndex, todayDate)) return true;
  return false; // partial -> expanded
}

function isFutureMonth(year, monthIndex, todayDate) {
  if (!todayDate) return true;
  const firstOfMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  return firstOfMonth > todayDate;
}

function detectNoService({ monthSummary, hasHomestandSchedule, isFeeAccount, isMilb }) {
  if (!monthSummary) return true;
  if (hasHomestandSchedule) {
    const hs = monthSummary.homestandSummary;
    return !hs || (hs.gameDays === 0 && hs.prepDays === 0);
  }
  if (isFeeAccount) {
    const projCovers = Number(monthSummary.projectedCovers) || 0;
    const actCovers  = Number(monthSummary.actualCovers) || 0;
    return Number(monthSummary.totalDays) === 0 || (projCovers === 0 && actCovers === 0);
  }
  if (isMilb) {
    return Number(monthSummary.totalDays) === 0;
  }
  const projRev = Number(monthSummary.projectedRevenue) || 0;
  const actRev  = Number(monthSummary.actualRevenue)    || 0;
  const totalDays = Number(monthSummary.totalDays)      || 0;
  return projRev === 0 && actRev === 0 && totalDays > 0;
}

function buildMonthWeeks(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  const startDow = first.getDay();
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
    if (cursor > last && cursor.getDay() === 1) break;
  }
  return weeks;
}

function fmtK(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(v) >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
}
