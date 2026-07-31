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
  RailHeroProgressCaption,
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

// R1-2 (2026-07-31) - whole-dollar formatter for the Books hero,
// replacing the fmtOverviewMoney "$X.XM" reading. Owner ruling: the
// hero value is what the operator entered to date; "$1.1M" hid
// resolution behind rounding, and adjacency with a days-driven
// progress bar was implying a target the entered figure was not
// measured against. Preserves useAnimatedNumber ticking (250ms ease-
// out) - each frame passes an integer through toLocaleString.
function fmtWholeDollars(n) {
  const v = Math.round(Number(n) || 0);
  return "$" + v.toLocaleString("en-US");
}

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
  /* R1-2 (2026-07-31) - Books hero reframe. WAS: value + label +
     "of ~$X.XM" on one baseline, with the ~$1.1M "of ~$1.38M" reading
     as 80% while the bar below it sat at 56% (bar tracks DAYS, not
     money). Actuals here are client-driven and the projection is not
     a target the operator is measured against, so the fraction is a
     lie. NOW: whole-dollar entered figure, no "of", projection appears
     ONCE as a labelled caption BELOW the days caption. Bar unchanged
     (still days). Days caption unchanged. Season list futures and
     month-card footers unchanged (owner ruling: adjacency is the
     problem, not the number existing). */
  const heroProjectionCaption = `Season projected ~${fmtOverviewMoney(totals.projectedRevenue)}`;
  const heroCaptionCal = `${totals.daysEntered} of ${totals.totalActionableDays} days entered`;
  const heroCaptionPeriod = `${totals.daysEntered} of ${totals.totalActionableDays} days entered · ${totals.mealsYTD.toLocaleString("en-US")} meals YTD`;
  const [showAllQueue, setShowAllQueue] = useState(false);

  if (mode === "calendar") {
    return (
      <CalendarRail
        year={year}
        totals={totals}
        heroProjectionCaption={heroProjectionCaption}
        heroCaption={heroCaptionCal}
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
      heroProjectionCaption={heroProjectionCaption}
      heroCaption={heroCaptionPeriod}
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
  year, totals, heroProjectionCaption, heroCaption,
  yearData, periodRanges, today,
  onDrillToDay, onDrillToMonth,
  showAllQueue, setShowAllQueue,
}) {
  const monthLines = deriveMonthLines(yearData, year, today);
  const queue = deriveQueue(yearData, periodRanges, today);
  const footerAction = deriveFooterAction(yearData, periodRanges, today);
  /* R1-4 (2026-07-31) - visibleQueue always shows all rows when
     expanded, but the container caps height and scrolls internally so
     the rail's total height and the CTA position never change. */
  const visibleQueue = showAllQueue ? queue : queue.slice(0, QUEUE_TOP_N);
  const overflow = queue.length - visibleQueue.length;
  const canToggle = queue.length > QUEUE_TOP_N;

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
        format={fmtWholeDollars}
        label="ENTERED YTD"
        ariaSuffix={`${totals.actualRevenue > 0 ? "" : "no revenue entered yet, "}${totals.pctComplete}% complete`}
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />
      <RailHeroProgressCaption>{heroCaption}</RailHeroProgressCaption>
      {/* R1-2 - projection as its own caption BELOW the days line. */}
      <div className="sc-rail-hero-projection-caption">{heroProjectionCaption}</div>

      {/* V3 §S8.3 - NEEDS ENTRY pinned ABOVE the season scroll region.
          The queue stays visible while the season list inner-scrolls.
          OV-3 G13: meta becomes the severity pill - amber "{n} need"
          when only needs-entry present; red "{n} overdue" when any
          overdue exists. Worst-state wins; the count shown is that
          state's count. */}
      {(() => {
        const overdueCount = queue.filter(r => r.status === "overdue").length;
        const needsCount = queue.filter(r => r.status === "needs-entry").length;
        const railMetaTone = overdueCount > 0 ? "overdue" : needsCount > 0 ? "needs" : undefined;
        const railMeta = overdueCount > 0
          ? `${overdueCount} overdue`
          : needsCount > 0 ? `${needsCount} need` : null;
        return (
          <div className="sc-rail-pinned">
            <RailSection
              label="NEEDS ENTRY"
              meta={railMeta}
              metaTone={railMetaTone}
            >
          {queue.length === 0 && (
            <p className="sc-rail-queue-empty">Nothing needs entry right now.</p>
          )}
          {queue.length > 0 && (
            <div
              className="sc-rail-queue-list"
              data-expanded={showAllQueue ? "true" : "false"}
              style={{ "--queue-visible-count": QUEUE_TOP_N }}
            >
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
            </div>
          )}
          {canToggle && (
            <RailQueueMore
              count={overflow}
              expanded={showAllQueue}
              onClick={() => setShowAllQueue(v => !v)}
            />
          )}
            </RailSection>
          </div>
        );
      })()}

      <RailScroll>
        <RailSection label="Season">
          <SeasonList
            year={year}
            visibleMonthLines={visibleMonthLines}
            todayMonth={todayMonth}
            /* F3 (2026-07-19) - forward the pinned-queue count so
               the SeasonList's auto-scroll effect can re-fire when
               the queue rows push the season list past clientHeight
               after data arrival. */
            queueLength={queue.length}
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
  year, visibleMonthLines, todayMonth, queueLength, onDrillToMonth,
  tailEligible, tailAllLines, tailFirstShort, tailLastShort,
  tailSumProjected, showAllMonths, toggleTail,
}) {
  const currentRef = useRef(null);
  useEffect(() => {
    /* OV-3 F3 (2026-07-19) - auto-scroll goes deterministic. Three
       strikes on RO cleverness (G8 observed the container - never
       fired; G8-second-iteration observed firstElementChild - never
       fired on STL-FL either). Ripped: use three scheduled attempts
       (rAF + 300ms + 900ms) with the guard + done latch. Real
       content sources go into deps so React re-runs the effect on
       every data-arrival growth (queueLength for the CalendarRail
       pinned queue). Overflow guard still short-circuits the
       content-fits case (CIN-AZ per-meal), so no work happens
       there.
       Full history in the OV-3 F3 commit body. */
    /* F3-redux: match OpsSeasonList - direct scrollTop assignment
       (behavior:"auto" via property write, no scrollTo animation)
       + instrumentation attribute. See OpsSeasonList comment for
       the reasoning. */
    const el = currentRef.current;
    if (!el) return;
    const scrollNode = el.closest(".sc-rail-scroll");
    if (!scrollNode) return;
    let done = false;
    const tryScroll = () => {
      if (done) return;
      if (scrollNode.scrollHeight <= scrollNode.clientHeight) return;
      done = true;
      const top = el.getBoundingClientRect().top
        - scrollNode.getBoundingClientRect().top
        + scrollNode.scrollTop;
      const target = top - scrollNode.clientHeight / 2 + el.clientHeight / 2;
      scrollNode.scrollTop = target;
      scrollNode.setAttribute("data-f3-target", String(Math.round(target)));
    };
    const rafId = requestAnimationFrame(tryScroll);
    const t1 = setTimeout(tryScroll, 300);
    const t2 = setTimeout(tryScroll, 900);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, todayMonth, visibleMonthLines.length, queueLength]);
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
      <RailLine label={short} value="-" tone="off" onClick={onClick} />
    );
  }
  const money = displayRev > 0
    ? (hasActuals ? fmtLineMoney(displayRev) : `~${fmtLineMoney(displayRev)}`)
    : (hasActuals ? "$0" : "-");
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
  year, totals, heroProjectionCaption, heroCaption,
  yearData, periodRanges, today,
  onDrillToDay, onDrillToPeriod,
  showAllQueue, setShowAllQueue,
}) {
  const periodLines = derivePeriodLines(yearData, periodRanges, today);
  const groupedQueue = deriveQueueByPeriod(yearData, periodRanges, today);
  const footerAction = derivePeriodFooterAction(yearData, periodRanges, today);
  const visibleGroups = showAllQueue ? groupedQueue : groupedQueue.slice(0, QUEUE_TOP_N);
  const overflow = groupedQueue.length - visibleGroups.length;
  const canToggle = groupedQueue.length > QUEUE_TOP_N;

  return (
    <RailShell label={`SEASON · ${year} BOOKS`}>
      <RailHero
        value={totals.actualRevenue}
        format={fmtWholeDollars}
        label="ENTERED YTD"
      />
      <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />
      <RailHeroProgressCaption>{heroCaption}</RailHeroProgressCaption>
      {/* R1-2 - projection as its own caption BELOW the days line. */}
      <div className="sc-rail-hero-projection-caption">{heroProjectionCaption}</div>

      {/* V3 §S8.3 F-E2 + OV-3 G13 - PeriodRail pins NEEDS ENTRY with
          the same severity-pill meta as CalendarRail. groupedQueue
          rows carry per-period overdue + needs counts (see
          PeriodQueueRow); the meta aggregates across all groups. */}
      {(() => {
        const overdueCount = groupedQueue.reduce((n, g) => n + (g.overdue || 0), 0);
        const needsCount = groupedQueue.reduce((n, g) => n + (g.needs || 0), 0);
        const railMetaTone = overdueCount > 0 ? "overdue" : needsCount > 0 ? "needs" : undefined;
        const railMeta = overdueCount > 0
          ? `${overdueCount} overdue`
          : needsCount > 0 ? `${needsCount} need` : null;
        return (
          <div className="sc-rail-pinned">
            <RailSection
              label="NEEDS ENTRY"
              meta={railMeta}
              metaTone={railMetaTone}
            >
              {groupedQueue.length === 0 && (
                <p className="sc-rail-queue-empty">Every period is caught up.</p>
              )}
              {groupedQueue.length > 0 && (
                <div
                  className="sc-rail-queue-list"
                  data-expanded={showAllQueue ? "true" : "false"}
                  style={{ "--queue-visible-count": QUEUE_TOP_N }}
                >
                  {visibleGroups.map(g => (
                    <PeriodQueueRow
                      key={g.period}
                      group={g}
                      onClick={() => onDrillToPeriod?.(g.period)}
                    />
                  ))}
                </div>
              )}
              {canToggle && (
                <RailQueueMore
                  count={overflow}
                  expanded={showAllQueue}
                  onClick={() => setShowAllQueue(v => !v)}
                />
              )}
            </RailSection>
          </div>
        );
      })()}

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
      <RailLine label={period} value="-" tone="off" onClick={onClick} />
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
  /* R1-5 (2026-07-31) - spell out "Period N". The bare number
     (`7`, `8`) beside "24 overdue" reads as a count, not an
     identifier. Deliberate divergence from the period cards'
     "P7 · late Jun" - the rail is a standalone reading context. */
  const periodLabel = `Period ${period}`;
  return (
    <button
      type="button"
      className={`sc-rail-queue-row sc-rail-queue-row--${overdue > 0 ? "overdue" : "needs"}`}
      onClick={onClick}
      aria-label={`${periodLabel}, ${status}, open`}
    >
      <span className={`sc-rail-queue-dot sc-rail-queue-dot--${overdue > 0 ? "overdue" : "needs"}`} aria-hidden="true" />
      <span className="sc-rail-queue-body">
        <span className="sc-rail-queue-date">{periodLabel}</span>
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
