"use client";

// SC v2 Ops Rail (W6) - fee-account and MLB-fee rail.
//
// One module composes both variants (MLB fee vs STL-FL) and both
// scopes (overview + drill), driven by props. Rail primitives from
// Rail.js are shared with SeasonRail/DrillRail; the OpsRail's
// DIFFERENCE is that this file (and opsRailDerive.js) import
// ZERO money formatters - no fmt$, no fmt$K, no fmtOverviewMoney.
// Grep proof in the PR body.
//
// Variant selection:
//   hasHomestandSchedule -> MLB fee variant (games hero + HS ledger
//     + neutral "to enter" queue; MLB is category-gated to NO
//     amber/red per law 3, so the queue tone is navy)
//   !hasHomestandSchedule -> STL-FL variant (days hero + urgency
//     queue; STL-FL is PDC-family so amber/red are policy)

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
  deriveOpsHeroTotals,
  deriveOpsHomestandLedger,
  deriveOpsHomestandLedgerScoped,
  deriveOpsQueueMlb,
  deriveOpsQueueStlFl,
  deriveOpsDrillQueueMlb,
  deriveOpsDrillQueueStlFl,
  deriveOpsFooterActionMlb,
  deriveOpsFooterActionStlFl,
  deriveOpsNotes,
  todayISO,
} from "./opsRailDerive";

const QUEUE_TOP_N = 4;

export default function OpsRail({
  // Common
  mode = "overview",           // "overview" | "drill"
  scopeLabel = "",             // "2026 BOOKS" | "P7" | "Jul 2026"
  hasHomestandSchedule = false,
  year,
  today,
  yearData,                    // full year - used for the overview + as the segment source
  // Drill-only
  periodDays = null,           // days[] in the drill scope (period or month)
  periodRange = null,          // { start, end }
  // DP2-06 v3 (2026-07-21): the drilled window's aggregated metrics.
  // Same `m` object PeriodWorkspace reads for its top-strip figures
  // (PeriodWorkspace.js:180 + :322-333). complete = entered days for
  // this scope, total = actionable days, actMeals = meals for this
  // scope. On MLB fee this is 9/14 for CIN-OH July (matches the
  // strip and the tiles). The drill hero + caption now source their
  // numbers here instead of a parallel aggregation.
  periodMetrics = null,
  loading = false,
  incomplete = false,          // partial-fetch treatment (F1 pattern from W5)
  // Handlers
  exportControl = null,        // <ExportControl ... /> from caller (drill only)
  onTargetDay,                 // (date) => void - queue rows + notes + HS row + footer target
  onDrillToMonth,              // (monthIndex) => void - month lines (overview season list)
  onDrillToPeriod,             // (periodLabel) => void - period lines (overview season list)
}) {
  const [showAllQueue, setShowAllQueue] = useState(false);
  const iso = today || todayISO();

  if (loading) {
    return (
      <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : "LOADING"}>
        <RailHero value="loading..." label={hasHomestandSchedule ? "GAME DAYS" : "DAYS ENTERED"} meta="fetching data" />
        <RailProgress pct={0} />
      </RailShell>
    );
  }

  // ─── Hero ─────────────────────────────────────────────────
  // OV-3 F10 (2026-07-19) - fee/homestand hero adopts the per-meal
  // grammar (value + label + projection on one baseline; caption
  // below the progress bar). Match the per-meal hero's type scale +
  // spacing so the two account families read identically.
  //
  // DP2-06 v3 (2026-07-21): drill hero + caption read from
  // periodMetrics (the workspace strip's source of truth). Prior
  // attempts:
  //  - v1: deriveOpsHeroTotals(yearData) - season-wide, showed 15/81
  //    on July drill.
  //  - v2: deriveOpsHeroTotalsScoped(periodDays) - broken aggregation,
  //    returned 0/0 for MLB. Retired.
  //  - v3 (here): periodMetrics.complete / .total / .actMeals - the
  //    SAME numbers the top strip renders (PeriodWorkspace.js:322-333)
  //    and the tiles reflect. Aggregator at ServiceCalendar.js:149
  //    (aggregateWorkspaceMetrics) handles both account shapes:
  //    complete = entered days (game days on MLB via SC-078 status
  //    widening); total = actionable days (game days on MLB, since
  //    prep/off/away drop out).
  // Overview mode (mode !== "drill") keeps deriveOpsHeroTotals since
  // the overview hero is season-to-date by design.
  const isDrill = mode === "drill";
  const scopedComplete = periodMetrics?.complete || 0;
  const scopedTotal = periodMetrics?.total || 0;
  const scopedMeals = periodMetrics?.actMeals || 0;
  const seasonTotals = deriveOpsHeroTotals(yearData, hasHomestandSchedule, iso);
  const heroValue = isDrill
    ? scopedComplete
    : (hasHomestandSchedule ? seasonTotals.gameDaysEntered : seasonTotals.daysEntered);
  const heroTotal = isDrill
    ? scopedTotal
    : (hasHomestandSchedule ? seasonTotals.totalGameDays : seasonTotals.totalActionableDays);
  const heroLabelText = hasHomestandSchedule ? "GAME DAYS" : "DAYS ENTERED";
  const heroLongLabel = hasHomestandSchedule ? "GAME DAYS ENTERED" : "DAYS ENTERED";
  // Caption:
  //  - Drill: entered/total + scoped meals. Homestand-count fact
  //    dropped on drill (aggregateWorkspaceMetrics doesn't carry
  //    homestand rollups; owner-accepted 2026-07-21 - strip doesn't
  //    show it either, so this matches the strip's minimalism).
  //  - Overview: entered/total + season meals + (MLB) season
  //    homestand count - unchanged from OV-3 F10.
  const heroCaption = isDrill
    ? `${scopedComplete} of ${scopedTotal} · ${scopedMeals.toLocaleString("en-US")} meals`
    : (hasHomestandSchedule
        ? `${seasonTotals.gameDaysEntered} of ${seasonTotals.totalGameDays} · ${seasonTotals.mealsYTD.toLocaleString("en-US")} meals · ${seasonTotals.homestandsComplete} of ${seasonTotals.totalHomestands} homestands`
        : `${seasonTotals.daysEntered} of ${seasonTotals.totalActionableDays} · ${seasonTotals.mealsYTD.toLocaleString("en-US")} meals`);
  // Projection on drill: "of {total}" - value + label + projection on
  // one baseline, matching DrillRail.js:163 + 176's per-meal shape.
  const heroProjection = isDrill ? `of ${heroTotal || 0}` : null;
  // Progress bar percent: drill uses scoped complete/total; overview
  // uses season pctComplete (unchanged).
  const heroPct = isDrill
    ? (scopedTotal > 0 ? Math.round((scopedComplete / scopedTotal) * 100) : 0)
    : seasonTotals.pctComplete;

  const heroBlock = incomplete ? (
    <div className="sc-rail-hero sc-rail-hero--incomplete">
      <span className="sc-rail-hero-value">-- data incomplete</span>
      <span className="sc-rail-hero-label">{heroLongLabel}</span>
      <span className="sc-rail-hero-meta">Use the refresh button in the header to retry the fetch.</span>
    </div>
  ) : (
    <RailHero
      value={heroValue}
      format={(n) => String(Math.round(n))}
      label={heroLabelText}
      projection={heroProjection}
    />
  );

  // ─── Queue ────────────────────────────────────────────────
  const queueRows = buildQueue({
    mode, hasHomestandSchedule, yearData, iso, periodRange,
  });
  const visibleQueue = showAllQueue ? queueRows : queueRows.slice(0, QUEUE_TOP_N);
  const overflow = queueRows.length - visibleQueue.length;

  // ─── Homestand ledger (MLB fee variant only) ─────────────
  const ledger = hasHomestandSchedule
    ? (mode === "drill" && periodRange
        ? deriveOpsHomestandLedgerScoped(yearData, iso, periodRange.start, periodRange.end)
        : deriveOpsHomestandLedger(yearData, iso))
    : [];

  // ─── Notes (drill only) ──────────────────────────────────
  const notes = mode === "drill" ? deriveOpsNotes(periodDays) : { count: 0, firstDate: null };

  // ─── Season list (overview only) ─────────────────────────
  const seasonListMonths = mode === "overview"
    ? deriveOverviewMonthList(yearData, year, iso, hasHomestandSchedule)
    : [];

  // ─── Footer action ───────────────────────────────────────
  const footerAction = mode === "drill"
    ? buildDrillFooter({ hasHomestandSchedule, yearData, iso, periodRange })
    : (hasHomestandSchedule
        ? deriveOpsFooterActionMlb(yearData, iso)
        : deriveOpsFooterActionStlFl(yearData, iso));

  return (
    <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : ""}>
      {heroBlock}
      {!incomplete && <RailProgress pct={heroPct} complete={heroPct === 100} />}
      {!incomplete && <RailHeroProgressCaption>{heroCaption}</RailHeroProgressCaption>}

      {/* V3 §S8.3 F-E2 + OV-3 G13 - OpsRail pinned queue.
          hasHomestandSchedule=true (MLB fee, MiLB AAA): "To enter"
          queue is game-day rows carrying no per-day severity; meta
          stays as the plain count.
          hasHomestandSchedule=false (STL - FL fee non-homestand):
          per-day needs / overdue apply - severity pill (amber
          "{n} need" / red "{n} overdue"). Worst-state wins. */}
      {(() => {
        let railMeta = queueRows.length > 0 ? `${queueRows.length}` : null;
        let railMetaTone;
        if (!hasHomestandSchedule) {
          const overdueCount = queueRows.filter(r => r.status === "overdue").length;
          const needsCount = queueRows.filter(r => r.status === "needs-entry").length;
          if (overdueCount > 0) {
            railMeta = `${overdueCount} overdue`;
            railMetaTone = "overdue";
          } else if (needsCount > 0) {
            railMeta = `${needsCount} need`;
            railMetaTone = "needs";
          }
        }
        return (
          <div className="sc-rail-pinned">
            <RailSection
              label={hasHomestandSchedule ? "To enter" : "NEEDS ENTRY"}
              meta={railMeta}
              metaTone={railMetaTone}
            >
              {queueRows.length === 0 && (
                <p className="sc-rail-queue-empty">
                  {hasHomestandSchedule ? "No unentered game days." : "Nothing needs entry right now."}
                </p>
              )}
              {visibleQueue.map(row => (
                <OpsQueueRow
                  key={row.date}
                  row={row}
                  hasHomestandSchedule={hasHomestandSchedule}
                  onClick={() => onTargetDay?.(row.date)}
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
        );
      })()}

      <RailScroll>
        {/* Homestand ledger - MLB fee variant only */}
        {hasHomestandSchedule && ledger.length > 0 && (
          <RailSection
            label="Homestands"
            meta={
              mode === "drill"
                ? `${ledger.length} in scope`
                : `${seasonTotals.homestandsComplete} of ${seasonTotals.totalHomestands} complete`
            }
          >
            {ledger.map(hs => (
              <HomestandRow
                key={hs.key}
                hs={hs}
                onClick={() => onTargetDay?.(hs.startDate)}
              />
            ))}
          </RailSection>
        )}

        {/* Bundle-A #7/#8 (2026-07-21): Notes rail section REMOVED
            per owner (was drill-only render at "N days with notes"
            targeting notes.firstDate). notes count derived at
            :173 is retained since it's used only here today; kept
            harmlessly in case any future consumer wants it. */}

        {/* Season list - overview only (per-month game-day or days-entered summary) */}
        {mode === "overview" && seasonListMonths.length > 0 && (
          <RailSection label="Season">
            <OpsSeasonList
              lines={seasonListMonths}
              todayMonth={new Date().getMonth()}
              year={new Date().getFullYear()}
              /* F3 - forward pinned-queue + homestand-ledger counts
                 so OpsSeasonList's auto-scroll re-runs when either
                 lands after mount and pushes the season list past
                 clientHeight. */
              queueLength={queueRows.length}
              ledgerLength={ledger.length}
              onDrillToMonth={onDrillToMonth}
            />
          </RailSection>
        )}
      </RailScroll>

      <RailFooter
        kind={footerAction.kind}
        label={footerAction.label}
        onClick={() => {
          if (footerAction.kind === "caught-up" || !footerAction.target) return;
          onTargetDay?.(footerAction.target.date);
        }}
      />
      {exportControl && (
        <div className="sc-drill-rail-export">
          {exportControl}
        </div>
      )}
    </RailShell>
  );
}

// ─── Queue row that respects the two tone families ────────
// MLB (hasHomestandSchedule=true): navy neutral "to enter" with the
// game-day opponent copy (never uses overdue/needs-entry semantic
// tags - law 3).
// STL-FL: uses the RailQueueRow directly with needs-entry/overdue
// semantics (amber/red per PDC family - law 3).
/*
  V3 §S8.3 F-E2 - OpsSeasonList: mirror SeasonRail's SeasonList so
  fee accounts (STL - FL, MLB fees) also auto-scroll the current
  month row into view on mount. RM-gated via prefers-reduced-motion.
*/
function OpsSeasonList({ lines, todayMonth, year, queueLength, ledgerLength, onDrillToMonth }) {
  const currentRef = useRef(null);
  useEffect(() => {
    /* OV-3 F3 + F3-redux (2026-07-19) - direct-math auto-scroll.
       F3-redux changes vs F3:
       1. behavior: "auto" always (was smooth). Smooth-scroll on a
          sticky ancestor + overflow-hidden parent + JS-driven
          scrollTo is a documented Chromium/WebKit quirk zone; user's
          fourth-strike report (STL-FL scrollTop 0 despite
          overflow=525 vs clientHeight=174) matches the class of
          symptom. Deterministic auto behavior removes the
          animation-cancellation surface.
       2. Direct scrollTop assignment instead of scrollTo() -
          scrollTo(behavior:"auto") should be equivalent but the
          direct property write bypasses any scroll-behavior CSS
          inheritance that could silently downgrade to smooth on
          the container's computed style.
       3. Instrumentation `data-f3-target` on scrollNode so the
          gate cell can inspect the target after the fact without
          re-running the effect.
       Deps unchanged from F3. Three timed attempts + done latch
       + overflow guard preserved. */
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
  }, [year, todayMonth, lines.length, queueLength, ledgerLength]);
  return (
    <>
      {lines.map((line) => (
        <div
          key={line.key}
          className="sc-season-list-row"
          data-month-index={line.monthIndex}
          data-current={line.monthIndex === todayMonth ? "true" : undefined}
          ref={line.monthIndex === todayMonth ? currentRef : null}
        >
          <RailLine
            label={line.label}
            value={line.value}
            sublabel={line.sub}
            tone={line.tone}
            onClick={line.state === "off" ? undefined : () => onDrillToMonth?.(line.monthIndex)}
          />
        </div>
      ))}
    </>
  );
}

function OpsQueueRow({ row, hasHomestandSchedule, onClick }) {
  if (hasHomestandSchedule) {
    const opp = row.opponent ? `vs ${row.opponent}` : "TBD";
    const dateLabel = formatDate(row.date);
    return (
      <button
        type="button"
        className="sc-rail-queue-row sc-rail-queue-row--ops-neutral"
        onClick={onClick}
        aria-label={`${dateLabel}, ${opp}, to enter`}
      >
        <span className="sc-rail-queue-dot sc-rail-queue-dot--ops-neutral" aria-hidden="true" />
        <span className="sc-rail-queue-body">
          <span className="sc-rail-queue-date">{dateLabel}</span>
          <span className="sc-rail-queue-status">{opp}</span>
        </span>
        <span className="sc-rail-queue-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </button>
    );
  }
  // STL-FL - PDC-family urgency
  return (
    <RailQueueRow
      date={row.date}
      status={row.status}
      aging={row.aging}
      onClick={onClick}
    />
  );
}

// ─── Homestand row - lists opponent(s), game count, meals ─
function HomestandRow({ hs, onClick }) {
  const isDone = hs.status === "done";
  const isCurrent = hs.status === "current";
  const tone = isDone ? "done" : (isCurrent ? "current" : (hs.status === "in-progress" ? "in-progress" : "upcoming"));
  const value = `${hs.gameEntered}/${hs.gameCount} games`;
  const sub = hs.meals > 0
    ? `${hs.meals.toLocaleString("en-US")} meals`
    : null;
  return (
    <RailLine
      label={`${hs.homestandId} vs ${hs.opponentLabel}`}
      value={value}
      sublabel={sub}
      tone={tone}
      onClick={onClick}
    />
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${DOW[date.getDay()]}, ${MON[date.getMonth()]} ${date.getDate()}`;
}

// ─── Helpers ──────────────────────────────────────────────
function buildQueue({ mode, hasHomestandSchedule, yearData, iso, periodRange }) {
  if (mode === "drill" && periodRange) {
    return hasHomestandSchedule
      ? deriveOpsDrillQueueMlb(yearData, iso, periodRange.start, periodRange.end)
      : deriveOpsDrillQueueStlFl(yearData, iso, periodRange.start, periodRange.end);
  }
  return hasHomestandSchedule
    ? deriveOpsQueueMlb(yearData, iso)
    : deriveOpsQueueStlFl(yearData, iso);
}

function buildDrillFooter({ hasHomestandSchedule, yearData, iso, periodRange }) {
  const queue = hasHomestandSchedule
    ? deriveOpsDrillQueueMlb(yearData, iso, periodRange.start, periodRange.end)
    : deriveOpsDrillQueueStlFl(yearData, iso, periodRange.start, periodRange.end);
  if (!queue.length) return { kind: "caught-up", target: null };
  if (hasHomestandSchedule) {
    const nextFuture = queue.find(r => r.date >= iso);
    if (nextFuture) {
      const opp = nextFuture.opponent ? ` · vs ${nextFuture.opponent}` : "";
      return {
        kind: "next-game",
        target: nextFuture,
        label: `Enter next game day${opp}`,
      };
    }
    const oldest = queue[0];
    const oppOld = oldest.opponent ? ` · vs ${oldest.opponent}` : "";
    return {
      kind: "oldest-unentered",
      target: oldest,
      label: `Enter oldest unentered${oppOld}`,
    };
  }
  // STL-FL drill
  const todayRow = queue.find(r => r.date === iso && r.status === "needs-entry");
  if (todayRow) {
    return {
      kind: "today",
      target: todayRow,
      label: `Enter today`,
    };
  }
  const oldestOverdue = queue.find(r => r.status === "overdue");
  if (oldestOverdue) {
    return {
      kind: "oldest-overdue",
      target: oldestOverdue,
      label: `Enter oldest · ${oldestOverdue.aging} ${oldestOverdue.aging === 1 ? "day" : "days"} old`,
    };
  }
  // DP2-04 (2026-07-20): STL-FL drill oldest-needs branch now carries
  // the same aging suffix DrillRail uses at DrillRail.js:157-160
  // (after P0 DP2-03). Prior label was a bare "Enter oldest" - the
  // DrillRail path shipped with the days-old grammar, so this brings
  // the two rail paths to identical language. Aging for needs-entry
  // rows is not pre-computed at opsRailDerive.js:260 (that field is
  // overdue-only), so we compute inline. MLB drill footer branches
  // above are untouched - game-day next-game / oldest-unentered
  // semantics are the owner-approved MLB path.
  const oldestNeeds = queue[0];
  const aging = ageInDays(oldestNeeds.date, iso);
  return {
    kind: "oldest-needs",
    target: oldestNeeds,
    label: `Enter oldest · ${aging} ${aging === 1 ? "day" : "days"} old`,
  };
}

// Local aging helper - opsRailDerive.js keeps its own daysAgo as a
// module-private; duplicated here to avoid changing that module's
// export surface for a single call site. Same math (whole-day diff
// via manual ISO parts to sidestep TZ midnight edge cases).
function ageInDays(iso, todayIso) {
  if (!iso || !todayIso) return 0;
  const [ay, am, ad] = iso.split("-").map(Number);
  const [by, bm, bd] = todayIso.split("-").map(Number);
  const then = new Date(ay, am - 1, ad).getTime();
  const now = new Date(by, bm - 1, bd).getTime();
  return Math.max(0, Math.floor((now - then) / 86400000));
}

// Overview season list - one line per month showing the primary
// counter for the account shape. MLB fee: game-days entered/total +
// meals YTD as sub. STL-FL: days entered/total + meals as sub.
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function deriveOverviewMonthList(yearData, year, iso, hasHomestandSchedule) {
  if (!Array.isArray(yearData)) return [];
  const todayMonth = iso ? Number(iso.slice(5, 7)) - 1 : -1;
  const lines = [];
  for (let i = 0; i < 12; i++) {
    const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`;
    const month = yearData.find(m => m.month === monthKey) || null;
    const isCurrent = i === todayMonth;
    const firstOfMonth = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    const isFuture = firstOfMonth > iso;

    let state, value, sub;
    if (hasHomestandSchedule) {
      const hs = month?.homestandSummary || {};
      const games = Number(hs.gameDays) || 0;
      const gamesEntered = Number(hs.gameDaysEntered) || 0;
      const monthMeals = Number(month?.actualCovers) || 0;
      if (games === 0) {
        state = "off";
        value = "-";
        sub = null;
      } else if (games === gamesEntered) {
        state = "done";
        value = `${games} games`;
        sub = monthMeals > 0 ? `${monthMeals.toLocaleString("en-US")} meals` : null;
      } else if (isCurrent) {
        state = "current";
        value = `${gamesEntered}/${games} games`;
        sub = monthMeals > 0 ? `${monthMeals.toLocaleString("en-US")} meals` : null;
      } else if (isFuture) {
        state = "upcoming";
        value = `${games} games`;
        sub = null;
      } else {
        state = "in-progress";
        value = `${gamesEntered}/${games} games`;
        sub = monthMeals > 0 ? `${monthMeals.toLocaleString("en-US")} meals` : null;
      }
    } else {
      // STL-FL variant
      const totalDays = Number(month?.totalDays) || 0;
      const daysEntered = Number(month?.daysWithActuals) || 0;
      const monthMeals = Number(month?.actualCovers) || 0;
      if (totalDays === 0) {
        state = "off";
        value = "-";
        sub = null;
      } else if (daysEntered === totalDays) {
        state = "done";
        value = `${totalDays} days`;
        sub = monthMeals > 0 ? `${monthMeals.toLocaleString("en-US")} meals` : null;
      } else if (isCurrent) {
        state = "current";
        value = `${daysEntered}/${totalDays} days`;
        sub = null;
      } else if (isFuture) {
        state = "upcoming";
        value = `${totalDays} days`;
        sub = null;
      } else {
        state = "in-progress";
        value = `${daysEntered}/${totalDays} days`;
        sub = null;
      }
    }
    lines.push({
      key: monthKey,
      monthIndex: i,
      label: state === "off" || state === "upcoming" ? MONTH_SHORT[i] : MONTH_NAMES[i],
      state,
      tone: state,
      value,
      sub,
    });
  }
  return lines;
}
