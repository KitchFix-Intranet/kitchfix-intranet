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
  const totals = deriveOpsHeroTotals(yearData, hasHomestandSchedule, iso);
  // MLB fee hero: game days entered / total; count numeric so RailHero
  // can animate the tick via useAnimatedNumber (the RailHero API from
  // W2-W4 F3). STL-FL hero: days entered / total. Meta lines carry
  // meals + homestand-progress or projected + counts.
  const heroValue = hasHomestandSchedule
    ? totals.gameDaysEntered
    : totals.daysEntered;
  const heroDenominator = hasHomestandSchedule ? totals.totalGameDays : totals.totalActionableDays;
  const heroLabelText = hasHomestandSchedule ? "GAME DAYS ENTERED" : "DAYS ENTERED";
  const meta = hasHomestandSchedule
    ? `of ${totals.totalGameDays} · ${totals.mealsYTD.toLocaleString("en-US")} meals YTD · ${totals.homestandsComplete} of ${totals.totalHomestands} homestands`
    : `of ${totals.totalActionableDays} · ${totals.mealsYTD.toLocaleString("en-US")} meals YTD`;

  const heroBlock = incomplete ? (
    <div className="sc-rail-hero sc-rail-hero--incomplete">
      <span className="sc-rail-hero-value">-- data incomplete</span>
      <span className="sc-rail-hero-label">{heroLabelText}</span>
      <span className="sc-rail-hero-meta">Use the refresh button in the header to retry the fetch.</span>
    </div>
  ) : (
    <RailHero
      value={heroValue}
      format={(n) => String(Math.round(n))}
      label={hasHomestandSchedule
        ? `OF ${totals.totalGameDays} GAME DAYS ENTERED`
        : `OF ${totals.totalActionableDays} DAYS ENTERED`}
      meta={meta}
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
      {!incomplete && <RailProgress pct={totals.pctComplete} complete={totals.pctComplete === 100} />}

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
                : `${totals.homestandsComplete} of ${totals.totalHomestands} complete`
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

        {/* Notes (drill only) */}
        {mode === "drill" && notes.count > 0 && (
          <RailSection label="Notes">
            <RailLine
              label={`${notes.count} ${notes.count === 1 ? "day" : "days"} with notes`}
              value=""
              tone="current"
              onClick={notes.firstDate ? () => onTargetDay?.(notes.firstDate) : undefined}
            />
          </RailSection>
        )}

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
    /* OV-3 F3 (2026-07-19) - matches SeasonRail.SeasonList exactly.
       Three attempts (rAF + 300ms + 900ms) with the overflow guard
       + done latch. Ripped: no ResizeObserver. Real content sources
       in deps so React re-runs on every data-arrival growth
       (queueLength for the pinned queue, ledgerLength for the
       homestand ledger above the season list, lines.length for the
       season list itself). See F3 commit body for the three-strike
       history. */
    const el = currentRef.current;
    if (!el) return;
    const scrollNode = el.closest(".sc-rail-scroll");
    if (!scrollNode) return;
    const rm = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let done = false;
    const tryScroll = () => {
      if (done) return;
      if (scrollNode.scrollHeight <= scrollNode.clientHeight) return;
      done = true;
      const top = el.getBoundingClientRect().top
        - scrollNode.getBoundingClientRect().top
        + scrollNode.scrollTop;
      scrollNode.scrollTo({
        top: top - scrollNode.clientHeight / 2 + el.clientHeight / 2,
        behavior: rm ? "auto" : "smooth",
      });
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
  return { kind: "oldest-needs", target: queue[0], label: "Enter oldest" };
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
