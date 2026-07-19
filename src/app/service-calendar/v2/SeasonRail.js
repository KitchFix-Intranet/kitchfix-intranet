"use client";

// SC v2 Season Rail - composes the Rail primitives per mode (Calendar
// or Period) using shared derivations from overviewDerive.
//
// All figures come from the SAME per-day source the card footers use
// (dayPredicates over yearData.months[].days[]), which enforces the
// bundle's Law 1 (derived, not painted - one source).
//
// This component is inert to fetches - it only reads what's in memory.

import { useEffect, useRef, useState } from "react";
import {
  RailShell,
  RailHero,
  RailProgress,
  RailSection,
  RailScroll,
  RailQueueRow,
  RailQueueMore,
  RailLine,
  RailFooter,
} from "./Rail";
import {
  deriveHeroTotals,
  deriveMonthLines,
  derivePeriodLines,
  deriveQueue,
  deriveQueueByPeriod,
  deriveFooterAction,
  derivePeriodFooterAction,
  fmtOverviewMoney,
  fmtLineMoney,
  todayISO,
} from "./overviewDerive";

const QUEUE_TOP_N = 4; // top rows shown, rest folded under "+ N more"

export default function SeasonRail({
  mode,           // "calendar" | "period"
  year,
  yearData,
  periodRanges,
  onDrillToDay,   // (date, period, source) => void - queue rows + footer CTA
  onDrillToMonth, // (monthIndex) => void - Calendar-mode season lines
  onDrillToPeriod,// (periodLabel) => void - Period-mode season lines
  /* V3 §9.2 - fetch health for the year-summary payload; when
     "failed" the rail replaces its normal body with a banner + retry
     button so the operator can recover without a full page reload.
     `onRetry` fires the same handler AsOf's refresh button uses. */
  loadState,
  onRetry,
}) {
  if (loadState === "failed") {
    return (
      <RailShell label={`SEASON · ${year} BOOKS`}>
        <div className="sc-rail-failed" role="alert">
          <div className="sc-rail-failed-title">Books unavailable</div>
          <p className="sc-rail-failed-body">
            The season summary failed to load. Try again.
          </p>
          {onRetry && (
            <button
              type="button"
              className="sc-rail-failed-retry"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      </RailShell>
    );
  }
  const today = todayISO();
  const totals = deriveHeroTotals(yearData);
  // V3 §9.1 - vocabulary canon: verb "entered" everywhere; "recorded"
  // retired. Calendar hero meta = projected + days entered
  // (money-forward). Period hero meta = projected + days entered +
  // meals YTD. The meals-YTD figure is the FullSeasonCard's fourth
  // stat rehomed here (per bundle F4: every FullSeasonCard figure
  // must live in the rail before the card retires). totals.mealsYTD
  // is computed by the shared derive module - no new derivation path.
  const heroMetaCal = `of ~${fmtOverviewMoney(totals.projectedRevenue)} projected · ${totals.daysEntered} of ${totals.totalActionableDays} days entered`;
  const heroMetaPeriod = `of ~${fmtOverviewMoney(totals.projectedRevenue)} projected · ${totals.daysEntered} of ${totals.totalActionableDays} days entered · ${totals.mealsYTD.toLocaleString("en-US")} meals YTD`;
  const [showAllQueue, setShowAllQueue] = useState(false);

  if (mode === "calendar") {
    return (
      <CalendarRail
        year={year}
        totals={totals}
        heroMeta={heroMetaCal}
        yearData={yearData}
        periodRanges={periodRanges}
        today={today}
        onDrillToDay={onDrillToDay}
        onDrillToMonth={onDrillToMonth}
        showAllQueue={showAllQueue}
        setShowAllQueue={setShowAllQueue}
      />
    );
  }
  return (
    <PeriodRail
      year={year}
      totals={totals}
      heroMeta={heroMetaPeriod}
      yearData={yearData}
      periodRanges={periodRanges}
      today={today}
      onDrillToDay={onDrillToDay}
      onDrillToPeriod={onDrillToPeriod}
      showAllQueue={showAllQueue}
      setShowAllQueue={setShowAllQueue}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// Calendar mode - 12 month lines + flat needs queue.
// ═══════════════════════════════════════════════════════════════
function CalendarRail({
  year, totals, heroMeta,
  yearData, periodRanges, today,
  onDrillToDay, onDrillToMonth,
  showAllQueue, setShowAllQueue,
}) {
  const monthLines = deriveMonthLines(yearData, year, today);
  const queue = deriveQueue(yearData, periodRanges, today);
  const footerAction = deriveFooterAction(yearData, periodRanges, today);
  const visibleQueue = showAllQueue ? queue : queue.slice(0, QUEUE_TOP_N);
  const overflow = queue.length - visibleQueue.length;

  /* V3 §S8.5 F-F - Aug-Dec collapse row. Session-local toggle:
     collapsed (default) shows primary lines + a single "AUG - DEC
     · ~$X" toggle row; expanded shows ALL monthLines + a
     "Show less" toggle row at the end. Same button toggles either
     direction. F-D2: hyphen not em-dash in labels. */
  const [showAllMonths, setShowAllMonths] = useState(false);
  const todayMonth = new Date().getMonth();     /* 0-11 */
  const tailEligible = todayMonth < 11;
  const tailStartIdx = todayMonth + 2;          /* first slim-tail month */
  const tailAllLines = tailEligible ? monthLines.slice(tailStartIdx) : [];
  const tailSumProjected = tailAllLines.reduce(
    (acc, l) => acc + (Number(l.displayRev) || 0),
    0
  );
  const tailFirstShort = tailAllLines[0]?.short || "";
  const tailLastShort = tailAllLines[tailAllLines.length - 1]?.short || "";
  const visibleMonthLines = (tailEligible && !showAllMonths)
    ? monthLines.slice(0, tailStartIdx)
    : monthLines;
  const toggleTail = () => setShowAllMonths((v) => !v);

  return (
    <RailShell label={`SEASON · ${year} BOOKS`}>
      <RailHero
        value={totals.actualRevenue}
        format={fmtOverviewMoney}
        label="ENTERED YTD"
        meta={heroMeta}
        ariaSuffix={`${totals.actualRevenue > 0 ? "" : "no revenue entered yet, "}${totals.pctComplete}% complete`}
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />

      {/* V3 §S8.3 - NEEDS ENTRY pinned ABOVE the season scroll region.
          The queue stays visible while the season list inner-scrolls. */}
      <div className="sc-rail-pinned">
        <RailSection
          label="NEEDS ENTRY"
          meta={queue.length > 0 ? `${queue.length}` : null}
        >
          {queue.length === 0 && (
            <p className="sc-rail-queue-empty">Nothing needs entry right now.</p>
          )}
          {visibleQueue.map(row => (
            <RailQueueRow
              key={row.date}
              date={row.date}
              status={row.status}
              aging={row.aging}
              periodLabel={row.period}
              onClick={() => onDrillToDay?.(row.date, row.period, "queue")}
            />
          ))}
          {overflow > 0 && (
            <RailQueueMore
              count={overflow}
              onClick={() => setShowAllQueue(true)}
            />
          )}
        </RailSection>
      </div>

      <RailScroll>
        <RailSection label="Season">
          <SeasonList
            year={year}
            visibleMonthLines={visibleMonthLines}
            todayMonth={todayMonth}
            onDrillToMonth={onDrillToMonth}
            tailEligible={tailEligible}
            tailAllLines={tailAllLines}
            tailFirstShort={tailFirstShort}
            tailLastShort={tailLastShort}
            tailSumProjected={tailSumProjected}
            showAllMonths={showAllMonths}
            toggleTail={toggleTail}
          />
        </RailSection>
      </RailScroll>

      <RailFooter
        kind={footerAction.kind}
        label={footerAction.label}
        onClick={() => {
          if (footerAction.kind === "caught-up" || !footerAction.target) return;
          onDrillToDay?.(footerAction.target.date, footerAction.target.period, "footer");
        }}
      />
    </RailShell>
  );
}

/*
  V3 §S8.3 - SeasonList: auto-scroll the current month row into view
  on mount. Uses a ref on the current month's line + a rAF scroll.
  RM-gated via `scrollIntoView({ behavior: "auto" })` under
  prefers-reduced-motion; else smooth.
*/
function SeasonList({
  year, visibleMonthLines, todayMonth, onDrillToMonth,
  tailEligible, tailAllLines, tailFirstShort, tailLastShort,
  tailSumProjected, showAllMonths, toggleTail,
}) {
  const currentRef = useRef(null);
  useEffect(() => {
    /* F-E5 (2026-07-19) - swap scrollIntoView({ block: "center" })
       for direct math on the scroll container. Live probe showed
       scrollIntoView bubbled up to `<html>` and scrolled the whole
       page ~351 on load. The direct-math version scrolls ONLY
       .sc-rail-scroll and leaves the document untouched. Verified
       live at rail.scrollTop 96 with July centered, html untouched.
       F-E4 deps preserved. */
    const el = currentRef.current;
    if (!el) return;
    const scrollNode = el.closest(".sc-rail-scroll");
    if (!scrollNode) return;
    const rm = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const rafId = requestAnimationFrame(() => {
      const top = el.getBoundingClientRect().top
        - scrollNode.getBoundingClientRect().top
        + scrollNode.scrollTop;
      scrollNode.scrollTo({
        top: top - scrollNode.clientHeight / 2 + el.clientHeight / 2,
        behavior: rm ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, todayMonth, visibleMonthLines.length]);
  return (
    <>
      {visibleMonthLines.map((line) => (
        <div
          key={line.key}
          className="sc-season-list-row"
          data-month-index={line.monthIndex}
          data-current={line.monthIndex === todayMonth ? "true" : undefined}
          ref={line.monthIndex === todayMonth ? currentRef : null}
        >
          <MonthRailLine
            line={line}
            onClick={line.state === "off" ? undefined : () => onDrillToMonth?.(line.monthIndex)}
          />
        </div>
      ))}
      {tailEligible && tailAllLines.length > 0 && (
        <RailLine
          label={showAllMonths ? "Show less" : `${tailFirstShort} - ${tailLastShort}`}
          value={showAllMonths ? "" : `~${fmtOverviewMoney(tailSumProjected)}`}
          tone="upcoming"
          onClick={toggleTail}
        />
      )}
    </>
  );
}

function MonthRailLine({ line, onClick }) {
  const { label, short, state, entered, totalActionable, displayRev, hasActuals } = line;
  if (state === "off") {
    return (
      <RailLine label={short} value="—" tone="off" onClick={onClick} />
    );
  }
  const money = displayRev > 0
    ? (hasActuals ? fmtLineMoney(displayRev) : `~${fmtLineMoney(displayRev)}`)
    : (hasActuals ? "$0" : "—");
  if (state === "done") {
    return (
      <RailLine label={label} value={money} tone="done" onClick={onClick} />
    );
  }
  if (state === "upcoming") {
    return (
      <RailLine label={short} value={money} tone="upcoming" onClick={onClick} />
    );
  }
  // current + in-progress + attention: show the ratio + money
  const sub = totalActionable > 0 ? `${entered}/${totalActionable}` : null;
  return (
    <RailLine label={label} value={money} sublabel={sub} tone={state} onClick={onClick} />
  );
}

// ═══════════════════════════════════════════════════════════════
// Period mode - 13 period lines + period-grouped queue.
// ═══════════════════════════════════════════════════════════════
function PeriodRail({
  year, totals, heroMeta,
  yearData, periodRanges, today,
  onDrillToDay, onDrillToPeriod,
  showAllQueue, setShowAllQueue,
}) {
  const periodLines = derivePeriodLines(yearData, periodRanges, today);
  const groupedQueue = deriveQueueByPeriod(yearData, periodRanges, today);
  const footerAction = derivePeriodFooterAction(yearData, periodRanges, today);
  const visibleGroups = showAllQueue ? groupedQueue : groupedQueue.slice(0, QUEUE_TOP_N);
  const overflow = groupedQueue.length - visibleGroups.length;

  return (
    <RailShell label={`SEASON · ${year} BOOKS`}>
      <RailHero
        value={totals.actualRevenue}
        format={fmtOverviewMoney}
        label="ENTERED YTD"
        meta={heroMeta}
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />

      {/* V3 §S8.3 F-E2 - PeriodRail also pins NEEDS ENTRY above the
          season scroll region. Same structure as CalendarRail so
          both landing modes get the pinned queue + inner-scrolling
          season list. Auto-scroll (SeasonList's current-month
          rAF) is calendar-specific; period lines don't have a
          per-month current-target concept, so PeriodRail's scroll
          region uses the plain RailScroll without a ref. */}
      <div className="sc-rail-pinned">
        <RailSection
          label="NEEDS ENTRY"
          meta={groupedQueue.length > 0 ? `${groupedQueue.length}` : null}
        >
          {groupedQueue.length === 0 && (
            <p className="sc-rail-queue-empty">Every period is caught up.</p>
          )}
          {visibleGroups.map(g => (
            <PeriodQueueRow
              key={g.period}
              group={g}
              onClick={() => onDrillToPeriod?.(g.period)}
            />
          ))}
          {overflow > 0 && (
            <RailQueueMore
              count={overflow}
              onClick={() => setShowAllQueue(true)}
            />
          )}
        </RailSection>
      </div>

      <RailScroll>
        <RailSection label="Season">
          {periodLines.map(line => (
            <PeriodRailLine
              key={line.key}
              line={line}
              onClick={line.state === "off" ? undefined : () => onDrillToPeriod?.(line.period)}
            />
          ))}
        </RailSection>
      </RailScroll>

      <RailFooter
        kind={footerAction.kind}
        label={footerAction.label}
        onClick={() => {
          if (footerAction.kind === "caught-up") return;
          if (footerAction.kind === "clear-period-overdue" && footerAction.target?.period) {
            onDrillToPeriod?.(footerAction.target.period);
            return;
          }
          if (footerAction.target?.date) {
            onDrillToDay?.(footerAction.target.date, footerAction.target.period, "footer");
          }
        }}
      />
    </RailShell>
  );
}

function PeriodRailLine({ line, onClick }) {
  const { period, state, entered, totalActionable, meals, overdue } = line;
  if (state === "off") {
    return (
      <RailLine label={period} value="—" tone="off" onClick={onClick} />
    );
  }
  const mealsLabel = meals > 0 ? `${meals.toLocaleString("en-US")} meals` : "0 meals";
  if (state === "done") {
    return (
      <RailLine label={period} value={mealsLabel} tone="done" onClick={onClick} />
    );
  }
  if (state === "upcoming") {
    return (
      <RailLine label={period} value={mealsLabel} tone="upcoming" onClick={onClick} />
    );
  }
  if (state === "attention") {
    const sub = overdue > 0 ? `${overdue} overdue` : `${entered}/${totalActionable}`;
    return (
      <RailLine label={period} value={mealsLabel} sublabel={sub} tone="attention" onClick={onClick} />
    );
  }
  const sub = `${entered}/${totalActionable}`;
  return (
    <RailLine label={period} value={mealsLabel} sublabel={sub} tone={state} onClick={onClick} />
  );
}

function PeriodQueueRow({ group, onClick }) {
  const { period, overdue, needs, oldestOverdueAging } = group;
  const total = overdue + needs;
  const status = overdue > 0
    ? `${overdue} overdue · oldest ${oldestOverdueAging} ${oldestOverdueAging === 1 ? "day" : "days"}`
    : `${needs} to enter`;
  const bucketStatus = overdue > 0 ? "overdue" : "needs-entry";
  return (
    <button
      type="button"
      className={`sc-rail-queue-row sc-rail-queue-row--${overdue > 0 ? "overdue" : "needs"}`}
      onClick={onClick}
      aria-label={`${period}, ${status}, open`}
    >
      <span className={`sc-rail-queue-dot sc-rail-queue-dot--${overdue > 0 ? "overdue" : "needs"}`} aria-hidden="true" />
      <span className="sc-rail-queue-body">
        <span className="sc-rail-queue-date">{period}</span>
        <span className="sc-rail-queue-status">{status}</span>
      </span>
      <span className="sc-rail-queue-chevron" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </span>
    </button>
  );
}
