"use client";

// SC v2 Season Rail - composes the Rail primitives per mode (Calendar
// or Period) using shared derivations from overviewDerive.
//
// All figures come from the SAME per-day source the card footers use
// (dayPredicates over yearData.months[].days[]), which enforces the
// bundle's Law 1 (derived, not painted - one source).
//
// This component is inert to fetches - it only reads what's in memory.

import { useState } from "react";
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
}) {
  const today = todayISO();
  const totals = deriveHeroTotals(yearData);
  const heroValue = fmtOverviewMoney(totals.actualRevenue);
  const heroMeta = `of ~${fmtOverviewMoney(totals.projectedRevenue)} projected · ${totals.daysEntered} of ${totals.totalActionableDays} days recorded`;
  const [showAllQueue, setShowAllQueue] = useState(false);

  if (mode === "calendar") {
    return (
      <CalendarRail
        year={year}
        totals={totals}
        heroValue={heroValue}
        heroMeta={heroMeta}
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
      heroValue={heroValue}
      heroMeta={heroMeta}
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
  year, totals, heroValue, heroMeta,
  yearData, periodRanges, today,
  onDrillToDay, onDrillToMonth,
  showAllQueue, setShowAllQueue,
}) {
  const monthLines = deriveMonthLines(yearData, year, today);
  const queue = deriveQueue(yearData, periodRanges, today);
  const footerAction = deriveFooterAction(yearData, periodRanges, today);
  const visibleQueue = showAllQueue ? queue : queue.slice(0, QUEUE_TOP_N);
  const overflow = queue.length - visibleQueue.length;

  return (
    <RailShell label={`SEASON · ${year} BOOKS`}>
      <RailHero
        value={heroValue}
        label="ENTERED YTD"
        meta={heroMeta}
        ariaSuffix={`${totals.actualRevenue > 0 ? "" : "no revenue entered yet, "}${totals.pctComplete}% complete`}
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />

      <RailScroll>
        <RailSection
          label="Needs attention"
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

        <RailSection label="Season">
          {monthLines.map(line => (
            <MonthRailLine
              key={line.key}
              line={line}
              onClick={line.state === "off" ? undefined : () => onDrillToMonth?.(line.monthIndex)}
            />
          ))}
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
  year, totals, heroValue, heroMeta,
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
        value={heroValue}
        label="ENTERED YTD"
        meta={heroMeta}
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />

      <RailScroll>
        <RailSection
          label="Needs attention"
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
