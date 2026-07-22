"use client";

// SeasonShell - the redesigned Season-level container (Stage 1).
// Spec section 4: top to bottom = account context + persistent
// operational strip + Calendar/Period toggle + 4x3 month grid.
//
// Stage 1 scope:
//   - The shell renders. Calendar is the active side of the toggle;
//     Period is DISABLED (Stage 2 enables it).
//   - The Calendar grid reproduces the trusted year heatmap's
//     information using the Stage 0 atom as the SINGLE day renderer.
//   - The phase strip renders a SHAPE PLACEHOLDER (PhaseStrip.js
//     comment explains why - no engine change to add phase data).
//   - The month-card click delegates to the parent (the orchestrator)
//     which drives the legacy month-view drill so the wiring works
//     today; Stage 3+ replaces the drill target with the new
//     Period workspace.
//
// The shell is PRESENTATIONAL - it takes resolved props and emits
// onClick. State + data effects live in ServiceCalendar.js. The
// legacy lens/scope path remains intact alongside this new shell
// (spec 11.4).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./season.css";
import PhaseStrip from "./PhaseStrip";
import SeasonStepper from "./SeasonStepper";
import MonthCard from "./MonthCard";
import PeriodCard from "./PeriodCard";
import FullSeasonCard from "./FullSeasonCard";
import StateLegend from "./StateLegend";
import { resolveDayKind } from "../dayResolvers";
import { derivePhaseTimeline, bucketDaysByPeriod } from "./phaseDerivation";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function SeasonShell({
  account,                  // { key, name, category, billingModel }
  year,                     // number (the active season year)
  yearData,                 // months[] from sc-year-summary
  yearToday,                // { date, period, week } from sc-year-summary
  yearBannerStats,          // existing computed stats from ServiceCalendar.js
  hasHomestandSchedule,
  isFeeAccount,
  isMilb,
  loading,
  loadState = "loaded",     // SC-033: "loading" | "loaded" | "failed"
  onMonthClick,             // (monthIndex) => void
  // Stage 2 additions:
  periodRanges,             // [{ period, start, end }] from sc-year-summary
  onPeriodClick,            // (periodLabel) => void
  // Lifted view toggle (passed from orchestrator). The action signal
  // moved to the ChromeBar, so the shell no longer carries jump props.
  view,                     // "calendar" | "period" - lifted to orchestrator chrome bar
  onViewChange,             // (next) => void
  // F3: Set<string> of "YYYY-MM-DD" dates whose save is currently
  // queued locally. Threaded down to MonthCard + PeriodCard so their
  // DaySquare cells overlay the SYNCING badge on the right dates.
  syncingDates,
  // SC v2 (W2-W4): when true, the Period grid skips the FullSeasonCard
  // render at the summary slot - every figure it carried (entered YTD,
  // projected, days entered, meals YTD) has been rehomed into the
  // v2 SeasonRail hero + season lines + period-mode hero meta. Card
  // stays on v1 unchanged.
  scV2 = false,
  // sc-19 (2026-07-12): Set<string> of dates inside a Spring Training
  // phase block for the current account (phaseCalendar.js). Threaded
  // to MonthCard + PeriodCard so their sm cells can render the
  // dark-copper bottom-left corner wedge. Empty Set for non-PDC /
  // accounts without a Spring block.
  springDateSet,
}) {
  // Calendar | Period view state. Design Batch 2 lifts this to the
  // orchestrator's chrome bar so the toggle lives in the chrome with
  // the other controls; SeasonShell becomes a controlled consumer.
  // Backwards-compat: if the parent doesn't pass view/onViewChange,
  // fall back to local state so prior call sites keep working.
  const [localView, setLocalView] = useState("calendar");
  const effectiveView = view ?? localView;
  const handleViewChange = onViewChange ?? setLocalView;

  const kind = useMemo(
    () => resolveDayKind({
      billingModel: account?.billingModel,
      category: account?.category,
      hasHomestandSchedule,
    }),
    [account?.billingModel, account?.category, hasHomestandSchedule]
  );

  // Phase timeline = the SHARED SPINE. Strip reads this; period-card
  // tints read this. ONE derivation, two consumers.
  const phaseTimeline = useMemo(
    () => derivePhaseTimeline(account?.key, account?.category, year),
    [account?.key, account?.category, year]
  );

  // Bucket year days into periods using periodRanges. Pure client
  // (spec 11.6) - no engine extension. Only fires when Period view
  // is active; dep-array is stable PRIMARY state (no derived bool).
  const periodBuckets = useMemo(
    () => effectiveView === "period" ? bucketDaysByPeriod(yearData, periodRanges) : new Map(),
    [view, yearData, periodRanges]
  );

  const todayDate = yearToday?.date || null;

  /* V3 §9.3 F-C - real roving tabindex management. Track the
     currently-focused card index in state; on every render (data
     shape may change slim-vs-expanded), a ref-based effect walks
     the current card list and sets tabIndex=0 on the roving target
     and tabIndex=-1 on the rest. Initial roving = 0 (first card).
     Tab enters the grid once (lands on the roving card), next Tab
     exits to legend/rail. */
  const calendarGridRef = useRef(null);
  const [rovingIndex, setRovingIndex] = useState(0);
  useEffect(() => {
    const grid = calendarGridRef.current;
    if (!grid) return;
    /* OV-3 Wave 3 - slim-expand removed; the roving list simplifies
       back to drill + collapsed-trigger. Still filter to visible so
       the mobile-collapsed and desktop-expanded shapes coexist. */
    const cards = Array.from(grid.querySelectorAll(
      ".sc-season-month-card-drill, .sc-season-month-card-collapsed-trigger"
    )).filter((c) => c.offsetParent !== null);
    if (!cards.length) return;
    const target = Math.min(rovingIndex, cards.length - 1);
    cards.forEach((c, i) => {
      c.tabIndex = i === target ? 0 : -1;
    });
  });

  // Bundle 1 (Section D1): the all-expanded-on-desktop layout needs
  // one matchMedia listener for the 12 cards instead of one per card.
  // SSR-safe: default true so the desktop layout (dominant case) is
  // the first paint; on mount we read the media query and subscribe
  // to changes.
  const isDesktop = useIsDesktop();

  // Design Batch 3: the stepper drills into the period that contains
  // the clicked homestand's start date. The mapping happens here so
  // SeasonStepper stays presentational.
  const handleSegmentClick = (segment) => {
    if (!segment || !onPeriodClick) return;
    const range = periodRanges?.find(
      (r) => segment.startDate >= r.start && segment.startDate <= r.end
    );
    if (range) onPeriodClick(range.period);
  };

  // Loading skeleton matches the new shape so the layout doesn't
  // shift when data lands. Spec section 4 + GOTCHAS skeleton rule.
  // Bundle 1 (Section C1): the StateLegend renders at the BOTTOM of
  // the shell now in both loaded and loading states.
  // SC-033: on a failed year fetch, render the shell with an empty
  // yearData so the 12 month cards render their bodies + MonthCard
  // forces every cell to the failed atom via loadState. Skeleton stays
  // for the true loading branch.
  if (loadState !== "failed" && (loading || !yearData)) {
    return (
      <>
      <div className="sc-season sc-season-shell sc-fade-in">
        {!hasHomestandSchedule && (
          <PhaseStrip category={account?.category} today={null} year={year} isLoading />
        )}
        <div className="sc-season-grid sc-season-grid--loading" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <MonthSkeleton key={i} />
          ))}
        </div>
      </div>
      <StateLegend
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
        /* Coverage split (2026-07-22): day/night pill is lg-only
           (buildCompactContent strips dayNight from the sm content
           bag; DayNightPill's atom render gate is size==="lg"). So
           on the season overview the bar keys point at a signal
           that can't paint here = orphan keys. Drop them. Markers
           + EXH stay - both paint on sm tiles. */
        dropDayNight={true}
      />
      </>
    );
  }

  // In the failed branch, yearData is either the real (partial?) months
  // array or a synthetic empty [] so MonthCard's null-monthSummary
  // branch renders empty cells (which loadState then forces to failed).
  const effectiveYearData = loadState === "failed" ? (yearData || []) : yearData;

  return (
    <>
    <div className="sc-season sc-season-shell sc-fade-in">
      {hasHomestandSchedule ? (
        <SeasonStepper
          yearData={yearData}
          todayDate={todayDate}
          onSegmentClick={handleSegmentClick}
        />
      ) : (
        <PhaseStrip
          accountKey={account?.key}
          category={account?.category}
          today={yearToday}
          year={year}
        />
      )}

      {effectiveView === "calendar" ? (
        <div
          className="sc-season-grid"
          role="grid"
          aria-label={`${year} months`}
          ref={calendarGridRef}
          onFocus={(e) => {
            /* V3 §9.3 F-C - track the currently-focused card so the
               tabindex ref-effect can maintain ONE tabstop. OV-3
               Wave 3: slim-expand removed from the roving list. */
            const card = e.target.closest(
              ".sc-season-month-card-drill, .sc-season-month-card-collapsed-trigger"
            );
            if (!card) return;
            const cards = Array.from(
              e.currentTarget.querySelectorAll(
                ".sc-season-month-card-drill, .sc-season-month-card-collapsed-trigger"
              )
            ).filter((c) => c.offsetParent !== null);
            const idx = cards.indexOf(card);
            if (idx !== -1) setRovingIndex(idx);
          }}
          onKeyDown={(e) => {
            /* V3 §9.3 - roving keyboard nav across the month grid.
               ONE tabstop (whichever button currently has focus);
               arrows move focus by 1 (Left/Right) or by 4-col row
               (Up/Down); Home/End jump to first/last card. Enter
               is left to the native <button> click. No preventDefault
               unless we successfully move focus so v1 fallbacks
               (mobile chevron expand, form submit) survive.

               OV-3 Wave 3: slim-expand removed; the roving list is
               drill + collapsed-trigger only. */
            const key = e.key;
            if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(key)) return;
            const cards = Array.from(
              e.currentTarget.querySelectorAll(
                ".sc-season-month-card-drill, .sc-season-month-card-collapsed-trigger"
              )
            ).filter((c) => c.offsetParent !== null);
            if (!cards.length) return;
            const active = document.activeElement;
            const idx = cards.indexOf(active);
            if (idx === -1) return;
            let next = idx;
            if (key === "ArrowRight") next = Math.min(cards.length - 1, idx + 1);
            else if (key === "ArrowLeft") next = Math.max(0, idx - 1);
            else if (key === "ArrowDown") next = Math.min(cards.length - 1, idx + 4);
            else if (key === "ArrowUp") next = Math.max(0, idx - 4);
            else if (key === "Home") next = 0;
            else if (key === "End") next = cards.length - 1;
            if (next !== idx) {
              e.preventDefault();
              setRovingIndex(next);
              cards[next]?.focus();
            }
          }}
        >
          {MONTH_SHORT.map((_, monthIndex) => {
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
            const monthSummary = effectiveYearData.find(m => m.month === monthKey) || null;
            return (
              <div role="gridcell" key={monthIndex}>
                <MonthCard
                  year={year}
                  monthIndex={monthIndex}
                  monthSummary={monthSummary}
                  todayDate={todayDate}
                  kind={kind}
                  hasHomestandSchedule={hasHomestandSchedule}
                  isFeeAccount={isFeeAccount}
                  isMilb={isMilb}
                  isDesktop={isDesktop}
                  loadState={loadState}
                  onClick={onMonthClick}
                  syncingDates={syncingDates}
                  springDateSet={springDateSet}
                  /* V3 §6.7 - current period range (the one containing
                     today) so MonthCard can mark in-period day tiles
                     with the --in-period class. Undefined when no
                     periods or today is out of range. */
                  currentPeriodRange={
                    (periodRanges || []).find(
                      (r) => todayDate && todayDate >= r.start && todayDate <= r.end
                    )
                  }
                  /* V3 §6.6 - phase timeline for the header 3px tick
                     (phase-family tint of the month's dominant phase). */
                  phaseTimeline={phaseTimeline}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <PeriodGrid
          year={year}
          periodRanges={periodRanges}
          periodBuckets={periodBuckets}
          todayDate={todayDate}
          kind={kind}
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
          timeline={phaseTimeline}
          yearData={effectiveYearData}
          yearBannerStats={yearBannerStats}
          loadState={loadState}
          onPeriodClick={onPeriodClick}
          syncingDates={syncingDates}
          springDateSet={springDateSet}
          scV2={scV2}
        />
      )}
      </div>

      {/* Legend as the card's bottom band - moved out of .sc-season so it
          sits flush as a sibling, like the chrome bar is the top band.
          Renders in both calendar and period sub-views. */}
      <StateLegend
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
        /* Coverage split (2026-07-22): day/night pill is lg-only
           (buildCompactContent strips dayNight from the sm content
           bag; DayNightPill's atom render gate is size==="lg"). So
           on the season overview the bar keys point at a signal
           that can't paint here = orphan keys. Drop them. Markers
           + EXH stay - both paint on sm tiles. */
        dropDayNight={true}
      />
      </>
  );
}

// useIsDesktop - SSR-safe matchMedia hook used by Bundle 1 (Section
// D1) to force every MonthCard expanded on desktop while preserving
// mobile collapse behavior. Default true so first paint matches the
// dominant viewport; mount effect reads the actual match and
// subscribes to changes.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e) => setIsDesktop(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return isDesktop;
}

// SC-016: card-shaped skeleton with month-card anatomy - a title bar,
// a 7-column dot grid (2 rows = 14 dots), and a footer bar. Each part
// carries its own shimmer via CSS reusing the sc-season-shimmer
// keyframes (no new animation added). Reduced-motion falls back to
// flat fills via the existing tokens.css duration override.
function MonthSkeleton() {
  return (
    <div className="sc-season-month-skeleton">
      <div className="sc-season-month-skeleton-title" />
      <div className="sc-season-month-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="sc-season-month-skeleton-dot" />
        ))}
      </div>
      <div className="sc-season-month-skeleton-footer" />
    </div>
  );
}

// PeriodGrid - the 4x3 of 13 period-cards + the Full Season summary.
// P13 sits in row 4 column 1; Full Season summary fills cols 2-4
// (grid-column: span 3 on desktop). The CSS handles wrap on smaller
// viewports - on mobile both cards stack vertically.
function PeriodGrid({
  year, periodRanges, periodBuckets, todayDate, kind,
  hasHomestandSchedule, isFeeAccount, timeline, yearData, yearBannerStats,
  loadState = "loaded",
  onPeriodClick,
  syncingDates,
  springDateSet,
  scV2 = false,
}) {
  if (!periodRanges?.length) {
    return (
      <div className="sc-season-period-grid-empty">
        {loadState === "failed"
          ? "Could not load fiscal period data. Refresh to retry."
          : "Fiscal period data is loading."}
      </div>
    );
  }
  return (
    <div className="sc-season-period-grid" role="list" aria-label={`${year} fiscal periods`}>
      {periodRanges.map((r) => (
        <div role="listitem" key={r.period}>
          <PeriodCard
            periodRange={r}
            days={periodBuckets.get(r.period) || []}
            todayDate={todayDate}
            kind={kind}
            hasHomestandSchedule={hasHomestandSchedule}
            isFeeAccount={isFeeAccount}
            timeline={timeline}
            loadState={loadState}
            onClick={onPeriodClick}
            syncingDates={syncingDates}
            springDateSet={springDateSet}
          />
        </div>
      ))}
      {!scV2 && (
        <div role="listitem" className="sc-season-period-grid-summary">
          <FullSeasonCard
            yearData={yearData}
            yearBannerStats={yearBannerStats}
            isFeeAccount={isFeeAccount}
            hasHomestandSchedule={hasHomestandSchedule}
          />
        </div>
      )}
    </div>
  );
}

