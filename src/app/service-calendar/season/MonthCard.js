"use client";

// MonthCard - one month-card in the Calendar grid.
//
// Bundle 1 (Section D1-D3) reshape: on DESKTOP all 12 months render
// expanded and uniform (the chevron is suppressed, the top summary
// inside the expanded header is dropped, the footer carries the X/Y
// figure). On MOBILE the existing collapse accordion behavior is
// preserved (completed/off/empty-future default collapsed; current +
// partial default expanded; tap to toggle). The desktop check comes
// in via the isDesktop prop computed once at the SeasonShell level
// via a matchMedia listener (SSR-safe, default true).
//
// Closes audit P1-3 (uniform card heights). Footer + body rules:
//   - Upcoming / future months render the same x/Y entered + projected
//     $ footer as the active months for grid consistency (the projected
//     dollar figure uses monthSummary.projectedRevenue via displayRev;
//     no progress bar at 0%).
//   - Off-season months render the day-tile grid (all tiles in the
//     off state) instead of a separate "Off-season" placeholder, so
//     every card reads as a real calendar. The off-season footer
//     guard suppresses the misleading "0/0 entered $0" line on those
//     cards.
//   - buildMonthWeeks always produces 6 week-rows + a CSS
//     grid-auto-rows floor ensures trailing all-empty rows hold
//     height, so short months no longer render shorter than long
//     ones and the small-multiples grid is uniform.

import { useState } from "react";
import DaySquare from "../DaySquare";
import { resolveDayStatus, buildCompactContent } from "../dayResolvers";
import { mlbMonthPhaseLabel } from "./mlbSeasonPhase";
import { fmt$K } from "./format";
import ProgressBar from "./ProgressBar";
import { countActionableDays, countEnteredActionable } from "./dayPredicates";

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
  isDesktop = true,          // Bundle 1 D1: force-expanded gate; SSR-safe default
  loadState = "loaded",      // SC-033: "failed" forces every cell to the failed atom
  onClick,                   // (monthIndex) => void
  syncingDates,              // F3: Set<YYYY-MM-DD> for the current account; overlays SYNCING badge on matching tiles
  springDateSet,             // sc-19: Set<YYYY-MM-DD> for Spring Training dates on this account; drives the sm bottom-left copper corner wedge
  currentPeriodRange,        // V3 §6.7 - { period, start, end } for the period containing today; day tiles inside this range get the --in-period wash
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

  // Derive collapse default for MOBILE only. User can toggle with the
  // chevron / tap-to-expand. On DESKTOP, expanded is always true (the
  // userExpanded state is still maintained so a mobile user who
  // toggled and then resized to desktop keeps their preference under
  // the desktop force).
  const collapseDefault = computeCollapseDefault({
    isCurrentMonth, noService, monthSummary, todayDate, year, monthIndex,
  });
  const [userExpanded, setUserExpanded] = useState(!collapseDefault);
  const expanded = isDesktop ? true : userExpanded;

  const handleExpand = () => setUserExpanded(true);
  const handleCollapse = () => setUserExpanded(false);
  const handleDrill = () => onClick?.(monthIndex);

  // Kevin's ruling 2026-07-11: BOTH counters are actionable-only.
  // See season/dayPredicates.js for the ruling + supersession of the
  // P1 item 4 widened predicate. Denominator was previously the
  // server-side monthSummary.totalDays (all days in the month); the
  // client now derives it from the shipped day statuses so away /
  // no-service / exhibition / off-season / prep drop out of both
  // sides. A December off-season card, or an untouched future
  // per-meal month with all-zero projections, both cleanly land on
  // "0 of 0" - the totalDays === 0 guard below routes those to the
  // off-treatment / neutral bar.
  const daysEntered = countEnteredActionable(monthSummary?.days);
  const totalDays = countActionableDays(monthSummary?.days);
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

  // No button-inside-a-button (WCAG 4.1.2). The interactive elements
  // are SIBLINGS of the article's children:
  //   Collapsed: ONE row-button that expands the card. The chevron is
  //             a decorative (aria-hidden) span inside that button.
  //   Expanded:  the header is plain content (name + optional mobile
  //             chevron-collapse), and the whole-card drill is a
  //             stretched invisible button rendered as the article's
  //             LAST child (inset: 0 covers the card; the chevron sits
  //             above it via z-index so tapping the chevron collapses
  //             instead of drilling). Mirrors the period-card click
  //             pattern; resolves audit CC-4.
  return (
    <article
      className={cardClass}
      aria-label={`${monthName} ${year}`}
      data-state={monthState}
    >
      {expanded ? (
        <header className="sc-season-month-card-header">
          <span className="sc-season-month-card-name">{monthName}</span>
          {/* V3 §6.5 - month-level urgency chip: worst wins.
              Aggregated from the month's day states in monthSummary. */}
          <MonthUrgencyChip
            monthSummary={monthSummary}
            hasHomestandSchedule={hasHomestandSchedule}
          />
          {!isDesktop && (
            <button
              type="button"
              className="sc-season-month-card-chevron"
              onClick={handleCollapse}
              aria-label={`Collapse ${monthName}`}
              aria-expanded={true}
            >
              <ChevronGlyph expanded={true} />
            </button>
          )}
        </header>
      ) : (
        <button
          type="button"
          className="sc-season-month-card-header sc-season-month-card-collapsed-trigger"
          onClick={handleExpand}
          aria-label={`Expand ${monthName}`}
          aria-expanded={false}
        >
          <span className="sc-season-month-card-name">{monthName}</span>
          <CollapsedSummary
            monthSummary={monthSummary}
            monthState={monthState}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            totalDays={totalDays}
            daysEntered={daysEntered}
            monthIndex={monthIndex}
          />
          <span className="sc-season-month-card-chevron sc-season-month-card-chevron--static" aria-hidden="true">
            <ChevronGlyph expanded={false} />
          </span>
        </button>
      )}

      {/* Body grid renders for ALL expanded months including off-
          season. indexDays() yields an empty map when monthSummary has
          no days[], so off-season cells fall through to status "off"
          and render as off day tiles. The MonthCardFooter's off-season
          guard keeps the misleading "0/0 entered $0" line off those
          cards. */}
      {expanded && (
        <>
          <div className="sc-season-month-card-dow" aria-hidden="true">
            {DOW_HEADER.map((d, i) => (
              <span key={i} className="sc-season-month-card-dow-cell">{d}</span>
            ))}
          </div>

          <div className="sc-season-month-card-grid">
            {buildMonthWeeks(year, monthIndex).flat().map((cell, i) => renderCell({
              cell, monthIndex, daysByDate: indexDays(monthSummary), todayDate, kind, loadState, syncingDates, springDateSet, currentPeriodRange,
            })).map((node, i) => (
              <span key={i} className="sc-season-month-card-cell">{node}</span>
            ))}
          </div>

          <MonthCardFooter
            monthSummary={monthSummary}
            monthIndex={monthIndex}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            monthState={monthState}
          />
        </>
      )}

      {/* Whole-card drill: a stretched invisible button anchored to
          the article (which is now position: relative). Renders only
          when expanded - the collapsed-trigger button already covers
          the whole tile for the expand action. The mobile collapse
          chevron sits above this via z-index so tapping the chevron
          collapses without drilling. */}
      {expanded && (
        <button
          type="button"
          className="sc-season-month-card-drill"
          onClick={handleDrill}
          aria-label={`Open ${monthName}`}
        />
      )}
    </article>
  );
}

// Inline summary that sits in the header row when the card is
// collapsed AND below the month name when expanded. Carries the
// glance state: completed (check + $), upcoming, in-progress, or
// off-season.
function CollapsedSummary({ monthSummary, monthState, hasHomestandSchedule, isFeeAccount, totalDays, daysEntered, monthIndex }) {
  if (monthState === "off") {
    const offLabel = (hasHomestandSchedule && mlbMonthPhaseLabel(monthIndex)) || "Off-season";
    return <span className="sc-season-month-card-summary sc-season-month-card-summary--phase">{offLabel}</span>;
  }
  if (monthState === "upcoming") {
    // Bundle 1 D3: drop the "0/totalDays" aux - it read as a failing
    // grade on a future month. The calm "Upcoming" framing in the
    // footer carries the same signal without the punitive 0/X.
    return (
      <span className="sc-season-month-card-summary sc-season-month-card-summary--upcoming">
        upcoming
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
          {/* SC-012: tilde-only in the collapsed row (space is tight
              vs the expanded footer's "~$X projected"). */}
          · {hasActuals ? "" : "~"}{fmt$K(displayRev)}
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

// Glyph-only chevron. The interactive wrapping (button vs decorative
// span) lives at the call site so each state can have its own valid
// semantics: a single row-button when collapsed, a sibling button
// when expanded.
function ChevronGlyph({ expanded }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 150ms ease",
      }}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function indexDays(monthSummary) {
  const m = new Map();
  if (monthSummary?.days) {
    for (const d of monthSummary.days) m.set(d.date, d);
  }
  return m;
}

/*
  V3 §6.5 - MonthUrgencyChip. Aggregates the month's day states
  worst-wins: red "N overdue" outranks amber "N need entry".
  Nothing rendered when both counts are zero. Chip tokens per
  state (fill/bd/text ride --sc2-state-* which the T-table
  Option B values shipped in Step 1). 11/800 radius full.
  Suppressed on fee/homestand accounts - urgency is a per-meal
  operator signal; fee accounts have their own contract-status
  band elsewhere.
*/
function MonthUrgencyChip({ monthSummary, hasHomestandSchedule }) {
  if (hasHomestandSchedule) return null;
  if (!monthSummary?.days) return null;
  let overdue = 0;
  let needs = 0;
  for (const d of monthSummary.days) {
    const s = d?.status;
    if (s === "overdue") overdue++;
    else if (s === "needs-entry") needs++;
  }
  if (overdue > 0) {
    return (
      <span className="sc-season-month-card-chip sc-season-month-card-chip--overdue">
        {overdue} overdue
      </span>
    );
  }
  if (needs > 0) {
    return (
      <span className="sc-season-month-card-chip sc-season-month-card-chip--needs">
        {needs} need entry
      </span>
    );
  }
  return null;
}

function renderCell({ cell, monthIndex, daysByDate, todayDate, kind, loadState = "loaded", syncingDates, springDateSet, currentPeriodRange }) {
  if (cell.month !== monthIndex) {
    return <span className="sc-season-month-card-cell-empty" aria-hidden="true" />;
  }
  const day = daysByDate.get(cell.dateStr);
  // SC-033: loadState="failed" overrides every in-month cell to the
  // failed atom regardless of whether a per-day record exists. Content
  // is dropped so the atom renders its dashed shell + ⚠ badge only.
  const status = loadState === "failed"
    ? "failed"
    : (day ? resolveDayStatus(day.status) : "off");
  const isToday = todayDate === cell.dateStr;
  const content = loadState === "failed" ? null : (day ? buildCompactContent(day, kind) : null);
  return (
    <DaySquare
      dateNumber={cell.day}
      status={status}
      size="sm"
      kind={kind}
      content={content}
      isToday={isToday}
      ariaLabel={`${cell.dateStr}, ${status}`}
      isSyncing={syncingDates?.has(cell.dateStr) || false}
      // P2 (item 3, R3): year-summary carries hasNoteEntries per day
      // (set by loadYearSummary via readNoteDatesInRange). Boolean is
      // pre-derived NOTE-only per Kevin's Q-b ruling.
      hasNote={!!day?.hasNoteEntries}
      // sc-18 (2026-07-12): overlay-account game-day wedge on sm
      // tiles. day.hasScheduleGame is set server-side by
      // loadYearSummary when the account is flagged
      // has_schedule_overlay=true AND the date has a GAME row.
      // Non-overlay accounts pass undefined -> false, no wedge.
      isGameDayOverlay={!!day?.hasScheduleGame}
      // sc-19 (2026-07-12): Spring Training corner wedge on sm tiles.
      // springDateSet is derived client-side from phaseCalendar.js at
      // the ServiceCalendar level; non-PDC accounts get an empty Set
      // -> false, no wedge.
      isSpringPhase={!!springDateSet?.has(cell.dateStr)}
      // V3 §6.7 - the current-period wash on in-period day tiles
      // (period-scope orientation, not alarm). Range comes from
      // SeasonShell (periodRanges + today).
      isInPeriod={!!(currentPeriodRange && cell.dateStr >= currentPeriodRange.start && cell.dateStr <= currentPeriodRange.end)}
    />
  );
}

// Footer renders only when expanded.
function MonthCardFooter({ monthSummary, monthIndex, hasHomestandSchedule, isFeeAccount, monthState }) {
  // Off-state renders the phase word instead of a stats figure, so every
  // card has a populated bottom line (figures win whenever there are
  // actuals; phase text fills the rest). This runs BEFORE the monthSummary
  // guard on purpose: off-season months are absent from the year-summary
  // (monthSummary === null) yet still need their label. MLB resolves to
  // Off-season / Spring Training / Post Season by month; PDC + MiLB to
  // "Off-season".
  if (monthState === "off") {
    const phaseText = hasHomestandSchedule
      ? (mlbMonthPhaseLabel(monthIndex) || "Off-season")
      : "Off-season";
    return (
      <footer className="sc-season-month-card-footer">
        <span className="sc-season-month-card-phasefoot">{phaseText}</span>
      </footer>
    );
  }
  if (!monthSummary) return null;
  // Upcoming months fall through to the standard footer below - the
  // per-meal branch prints "0/X entered" + the projected $XK
  // (displayRev uses projectedRevenue when there are no actuals), the
  // fee branch prints "0/X entered", and the homestand branch prints
  // "0/X game days". No progress bar at 0%, so the framing stays calm
  // without being inconsistent with sibling cards.
  // Actionable-only counts (Kevin's ruling 2026-07-11) - see
  // season/dayPredicates.js. Away / no-service / exhibition / off-
  // season / prep drop out of BOTH sides.
  const daysEntered = countEnteredActionable(monthSummary.days);
  const totalDays = countActionableDays(monthSummary.days);
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
        {feePct > 0 && <ProgressBar pct={feePct} complete={feePct === 100} />}
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
        {completionPct > 0 && <ProgressBar pct={completionPct} complete={completionPct === 100} />}
      </footer>
    );
  }
  const hasActuals = daysEntered > 0;
  const displayRev = hasActuals
    ? Number(monthSummary.actualRevenue) || 0
    : Number(monthSummary.projectedRevenue) || 0;
  // SC-012: projected reads unmistakably projected. Entered stays as
  // fmt$K(displayRev) money-green; projected renders as
  // "~$85K projected" muted (tilde + the word). The value-switch above
  // is unchanged.
  return (
    <footer className="sc-season-month-card-footer">
      <div className="sc-season-month-card-stats">
        <span className="sc-season-month-card-stat-main">
          <strong>{daysEntered}</strong>/{totalDays} entered
        </span>
        <span className={`sc-season-month-card-stat-rev ${hasActuals ? "sc-season-month-card-stat-rev--actual" : ""}`}>
          {displayRev > 0
            ? (hasActuals ? fmt$K(displayRev) : `~${fmt$K(displayRev)} projected`)
            : "$0"}
        </span>
      </div>
      {completionPct > 0 && <ProgressBar pct={completionPct} complete={completionPct === 100} />}
    </footer>
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

  // Always emit 6 rows. The grid is a standard calendar layout, and a
  // fixed 6-row count is what keeps every month's body the same height
  // - short months pad with trailing next-month cells (rendered as
  // sc-season-month-card-cell-empty by renderCell). Combined with the
  // CSS grid-auto-rows floor on .sc-season-month-card-grid, this makes
  // the 12 cards true small-multiples.
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
  }
  return weeks;
}

// P1 item 4 (2026-07-10): the one completeness rule. `entered` OR
// `no-service` — the classifier's widened predicate matches the
// workspace's aggregateWorkspaceMetrics and the export DRAFT stamp
// (per-meal branch). Used by MonthCard's collapsed + expanded footers
// and by yearBannerStats' per-meal aggregate in ServiceCalendar.js.
export function countCompleteDays(days) {
  if (!Array.isArray(days)) return 0;
  let n = 0;
  for (const d of days) if (d?.status === "entered" || d?.status === "no-service") n++;
  return n;
}

