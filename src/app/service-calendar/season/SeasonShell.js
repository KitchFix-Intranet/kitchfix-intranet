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

import { useEffect, useMemo, useState } from "react";
import "./season.css";
import PhaseStrip from "./PhaseStrip";
import SeasonStepper from "./SeasonStepper";
import MonthCard from "./MonthCard";
import PeriodCard from "./PeriodCard";
import FullSeasonCard from "./FullSeasonCard";
import StateLegend from "./StateLegend";
import InfoCard from "./InfoCard";
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
  onMonthClick,             // (monthIndex) => void
  // Stage 2 additions:
  periodRanges,             // [{ period, start, end }] from sc-year-summary
  onPeriodClick,            // (periodLabel) => void
  // Design Batch 2 - info card props (passed from orchestrator):
  view,                     // "calendar" | "period" - lifted to orchestrator chrome bar
  onViewChange,             // (next) => void
  onJumpToNext,             // () => void; jumps to the next needs-entry/overdue day
  hasJumpTarget = false,    // boolean
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

  // Derive the InfoCard inputs from yearBannerStats. Bundle 1
  // (Section B) moved Today / Period / Week / Recorded into the
  // ChromeBar, so the InfoCard now only consumes the action-band
  // inputs (needs / overdue / feeStats).
  const stats = yearBannerStats;

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
  if (loading || !yearData) {
    return (
      <div className="sc-season sc-season-shell sc-fade-in">
        <InfoCard loading />
        {!hasHomestandSchedule && (
          <PhaseStrip category={account?.category} today={null} year={year} />
        )}
        <div className="sc-season-grid sc-season-grid--loading" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="sc-season-month-skeleton" />
          ))}
        </div>
        <StateLegend
          hasHomestandSchedule={hasHomestandSchedule}
          isFeeAccount={isFeeAccount}
          isMilb={isMilb}
        />
      </div>
    );
  }

  return (
    <div className="sc-season sc-season-shell sc-fade-in">
      <InfoCard
        isFeeAccount={isFeeAccount}
        needsEntry={stats?.needsEntry || 0}
        overdue={stats?.overdue || 0}
        feeStats={isFeeAccount && stats ? {
          gameDaysEntered: stats.gameDaysEntered || 0,
          totalGameDays: stats.totalGameDays || 0,
        } : null}
        todayLabel={stats?.todayLabel}
        onJumpToNext={onJumpToNext}
        hasJumpTarget={hasJumpTarget}
      />

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
        <div className="sc-season-grid" role="list" aria-label={`${year} months`}>
          {MONTH_SHORT.map((_, monthIndex) => {
            const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
            const monthSummary = yearData.find(m => m.month === monthKey) || null;
            return (
              <div role="listitem" key={monthIndex}>
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
                  onClick={onMonthClick}
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
          yearData={yearData}
          yearBannerStats={yearBannerStats}
          onPeriodClick={onPeriodClick}
        />
      )}

      {/* Bundle 1 (Section C1): legend at the bottom, static (not
          sticky). Renders in both calendar and period sub-views. */}
      <StateLegend
        hasHomestandSchedule={hasHomestandSchedule}
        isFeeAccount={isFeeAccount}
        isMilb={isMilb}
      />
    </div>
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

// PeriodGrid - the 4x3 of 13 period-cards + the Full Season summary.
// P13 sits in row 4 column 1; Full Season summary fills cols 2-4
// (grid-column: span 3 on desktop). The CSS handles wrap on smaller
// viewports - on mobile both cards stack vertically.
function PeriodGrid({
  year, periodRanges, periodBuckets, todayDate, kind,
  hasHomestandSchedule, isFeeAccount, timeline, yearData, yearBannerStats,
  onPeriodClick,
}) {
  if (!periodRanges?.length) {
    return (
      <div className="sc-season-period-grid-empty">
        Fiscal period data is loading.
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
            onClick={onPeriodClick}
          />
        </div>
      ))}
      <div role="listitem" className="sc-season-period-grid-summary">
        <FullSeasonCard
          yearData={yearData}
          yearBannerStats={yearBannerStats}
          isFeeAccount={isFeeAccount}
          hasHomestandSchedule={hasHomestandSchedule}
        />
      </div>
    </div>
  );
}

