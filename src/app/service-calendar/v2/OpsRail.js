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
  RailProgressBlock,
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
// Phase 2B (2026-07-25): STL-FL contract block. Code-owned reference
// to the docs (see contract.js header for provenance).
import { getContractInfo } from "./contract";
// P3-B (2026-07-28): session strip + Handoff CSS.
import { useHandoffSafe } from "./handoff/coordinator";
import "./handoff/handoff.css";
// M-4a (2026-07-29): MLB variant gate. AAA (CIN-KY, TBJ-NY) both
// carry hasHomestandSchedule=true today but are NOT in this set;
// they must keep the pre-M-4a games-hero + to-enter queue shape.
// Gating on hasHomestandSchedule alone would give AAA a money
// concept that does not exist for them - the trap owner named in
// the Round 1 scope-change section.
import { DERIVE_HOMESTANDS_ACCOUNTS } from "../season/homestandDerivation";

const QUEUE_TOP_N = 4;

// Router. MLB homestand-surface accounts get the SPENT-led rail
// per the M-4a render (C1.3). Every other account (AAA, STL-FL)
// keeps the pre-M-4a games-hero rail byte-identical - the rest of
// this file is that unchanged rail.
export default function OpsRail(props) {
  if (DERIVE_HOMESTANDS_ACCOUNTS.has(props.accountKey)) {
    return <OpsRailMlbHomestand {...props} />;
  }
  return <OpsRailBase {...props} />;
}

function OpsRailBase({
  // Common
  mode = "overview",           // "overview" | "drill"
  scopeLabel = "",             // "2026 BOOKS" | "P7" | "Jul 2026"
  hasHomestandSchedule = false,
  // Phase 2B (2026-07-25): accountKey optional. Used only on the
  // fee-no-dollar branch (STL-FL) to look up the contract block via
  // contract.js. MLB branch ignores it (contract block is not part
  // of the MLB rail spec).
  accountKey = null,
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

  // P3-A gate defect 1 fix (2026-07-25): the loading early-return
  // unmounted the ring on the STL-FL branch during refetch, killing
  // the ambient sweep. See DrillRail's fix block for the full node-
  // stability rationale. MLB branch (hasHomestandSchedule) keeps
  // <RailProgress> - the ref is only meaningful on !hasHomestandSchedule.
  //
  // Ring pct + caption are derived below (heroPct, heroCaption) once
  // the full hero-derivation block runs. The lastRingRef capture
  // happens AFTER those variables exist; the ringData fallback pattern
  // then feeds the render. loading-with-no-prior-ring still falls
  // through to the pre-P3-A skeleton (via the `!ringData` clause on
  // the check below), so first-load behavior is unchanged.
  const lastRingRef = useRef(null);

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
  const seasonTotals = deriveOpsHeroTotals(yearData, hasHomestandSchedule, iso, { accountKey });
  const heroValue = isDrill
    ? scopedComplete
    : (hasHomestandSchedule ? seasonTotals.gameDaysEntered : seasonTotals.daysEntered);
  const heroTotal = isDrill
    ? scopedTotal
    : (hasHomestandSchedule ? seasonTotals.totalGameDays : seasonTotals.totalActionableDays);
  // Phase 2B (2026-07-25): STL-FL branch (!hasHomestandSchedule under
  // isFeeAccount at the mount) swaps "ENTERED" -> "CONFIRMED" and
  // "meals" -> "served". MLB branch (hasHomestandSchedule) untouched.
  // OpsRail is fee-only at the mount site (ServiceCalendar.js:2857),
  // so the !hasHomestandSchedule branch is guaranteed STL-FL and the
  // swap does not perturb any per-meal surface.
  const heroLabelText = hasHomestandSchedule ? "GAME DAYS" : "DAYS CONFIRMED";
  const heroLongLabel = hasHomestandSchedule ? "GAME DAYS ENTERED" : "DAYS CONFIRMED";
  // Caption:
  //  - Drill: confirmed/total + scoped served. Homestand-count fact
  //    dropped on drill (aggregateWorkspaceMetrics doesn't carry
  //    homestand rollups; owner-accepted 2026-07-21 - strip doesn't
  //    show it either, so this matches the strip's minimalism).
  //  - Overview: confirmed/total + season served + (MLB) season
  //    homestand count - unchanged from OV-3 F10.
  const unitWord = hasHomestandSchedule ? "meals" : "served";
  const heroCaption = isDrill
    ? `${scopedComplete} of ${scopedTotal} · ${scopedMeals.toLocaleString("en-US")} ${unitWord}`
    : (hasHomestandSchedule
        ? `${seasonTotals.gameDaysEntered} of ${seasonTotals.totalGameDays} · ${seasonTotals.mealsYTD.toLocaleString("en-US")} meals · ${seasonTotals.homestandsComplete} of ${seasonTotals.totalHomestands} homestands`
        : `${seasonTotals.daysEntered} of ${seasonTotals.totalActionableDays} · ${seasonTotals.mealsYTD.toLocaleString("en-US")} served`);
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
  const canToggle = queueRows.length > QUEUE_TOP_N; // R1-4 - toggle shows for both directions

  // ─── Homestand ledger (MLB fee variant only) ─────────────
  const ledger = hasHomestandSchedule
    ? (mode === "drill" && periodRange
        ? deriveOpsHomestandLedgerScoped(yearData, iso, periodRange.start, periodRange.end, { accountKey })
        : deriveOpsHomestandLedger(yearData, iso, { accountKey }))
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

  // Phase 2B (2026-07-25): STL-FL contract block. Renders on the fee-
  // no-dollar branch (STL-FL only - MLB has hasHomestandSchedule=true
  // and skips this). Cited reference to the docs per contract.js; no
  // computation. Provides the "where did the money go" affordance the
  // spec calls for on a flat-fee account.
  const contractInfo = !hasHomestandSchedule ? getContractInfo(accountKey) : null;

  // P3-A gate defect 1 fix (2026-07-25): capture last ring values on
  // the STL-FL branch. MLB uses <RailProgress> and does not need this.
  // Fresh-metrics test: not loading + not incomplete + has real total
  // (heroPct=0 with total=0 is the pre-load state, not a valid ring
  // value to hold). Fallback ringData is null on !hasHomestandSchedule
  // when never-loaded (loading skeleton fires below via early-return).
  const haveFreshRingMetrics = !hasHomestandSchedule && !incomplete && !loading && scopedTotal > 0;
  if (haveFreshRingMetrics) {
    lastRingRef.current = { pct: heroPct, complete: heroPct === 100, caption: heroCaption };
  }
  const ringData = !hasHomestandSchedule
    ? (haveFreshRingMetrics
        ? { pct: heroPct, complete: heroPct === 100, caption: heroCaption }
        : lastRingRef.current)
    : null;

  // Loading + no prior ringData = true first-load. Fall back to the
  // pre-P3-A skeleton so no ring flash before real data.
  if (loading && (hasHomestandSchedule || !ringData)) {
    return (
      <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : "LOADING"}>
        <RailHero value="loading..." label={hasHomestandSchedule ? "GAME DAYS" : "DAYS CONFIRMED"} meta="fetching data" />
        <RailProgress pct={0} />
      </RailShell>
    );
  }

  return (
    <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : ""}>
      {heroBlock}
      {/* R2-2 (2026-07-31) - STL-FL (!hasHomestandSchedule) swaps
          from arc-only ring to bar-plus-caption via RailProgressBlock.
          Owner ruling: match the overview's shape exactly - no
          visible percent digit, percent stays on RailProgress's
          role="progressbar" for screen readers. STL - FL vocabulary
          preserved: heroCaption reads its 2B "confirmed / served"
          text and passes through the block unchanged.
          RailProgressBlock also registers as the Handoff flight
          target on STL - FL - same code path as DrillRail's block
          mount, so the pill still lands there.
          MLB (hasHomestandSchedule) keeps <RailProgress> plus
          separate <RailHeroProgressCaption> byte-identical per
          owner ruling on R2-2's fences. MLB does not use v2 entry
          (§7 fence) so no Handoff fires there, so no flight target
          is needed. */}
      {!incomplete && (
        hasHomestandSchedule ? (
          <>
            <RailProgress pct={heroPct} complete={heroPct === 100} />
            <RailHeroProgressCaption>{heroCaption}</RailHeroProgressCaption>
          </>
        ) : (
          ringData && (
            <RailProgressBlock
              pct={ringData.pct}
              complete={ringData.complete}
              caption={heroCaption}
              ariaLabel={heroCaption}
            />
          )
        )
      )}
      {!hasHomestandSchedule && <OpsSessionStrip />}

      {contractInfo && (
        <div className="sc-rail-contract" aria-label="Contract summary">
          <div className="sc-rail-contract-row">
            <span className="sc-rail-contract-label">Annual fee</span>
            <span className="sc-rail-contract-value">
              ${contractInfo.annualFee.toLocaleString()}
            </span>
          </div>
          <div className="sc-rail-contract-row">
            <span className="sc-rail-contract-label">Billing</span>
            <span className="sc-rail-contract-value">{contractInfo.model}</span>
          </div>
          {contractInfo.note && (
            <div className="sc-rail-contract-note">{contractInfo.note}</div>
          )}
        </div>
      )}

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
              label={hasHomestandSchedule ? "To enter" : "NEEDS CONFIRMATION"}
              meta={railMeta}
              metaTone={railMetaTone}
            >
              {queueRows.length === 0 && (
                <p className="sc-rail-queue-empty">
                  {hasHomestandSchedule ? "No unentered game days." : "Nothing needs confirmation right now."}
                </p>
              )}
              {queueRows.length > 0 && (
                <div
                  className="sc-rail-queue-list"
                  data-expanded={showAllQueue ? "true" : "false"}
                  style={{ "--queue-visible-count": QUEUE_TOP_N }}
                >
                  {visibleQueue.map(row => (
                    <OpsQueueRow
                      key={row.date}
                      row={row}
                      hasHomestandSchedule={hasHomestandSchedule}
                      onClick={() => onTargetDay?.(row.date)}
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

// ═══════════════════════════════════════════════════════════
// M-4a (2026-07-29): MLB homestand-surface rail variant.
//
// Owner scope C1.3: the season rail leads with labor SPENT vs
// budget - the number a chef's whole year is measured by - then
// what NEEDS them, then IN PROGRESS, then a rollup, then a CTA.
// Drill rail carries the same money-first grammar but the hero
// swaps to GAME DAYS SERVED (scope-native) with the season SPEND
// riding as a small season-to-date line.
//
// Missing-vs-zero applied to the rollup: no live close-out on any
// homestand -> the SPENT hero is absent entirely (not "$0 of $Y").
// Non-MLB accounts never reach this function.
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// M-4b (2026-07-30 rev3): MLB rail = pinned in-progress card
// + three collapsed groups.
//
// TOP:
//   Hero (SPENT $X · of $Y labor budget) + progress bar +
//   merged caption "N% · N of M closed out".
//   Missing-vs-zero removed: $0 is a fact, not an absence.
//
// PINNED IN-PROGRESS CARD:
//   Sits between hero and groups. Always expanded, no header,
//   no count, no toggle. Renders ONLY when a block is
//   in-progress. On gap days it disappears entirely - no
//   placeholder.
//   Contains: In progress tag + head row (ordinal + opponents +
//   money) + dates + games detail + outlined "Open HSn" button.
//
// THREE COLLAPSED GROUPS in chronological order:
//   Closed out, Actuals due, Upcoming.
//   Actuals due opens by default. Others start collapsed.
//   Closed out NEVER auto-expands whatever its count.
//   A group with zero members does not render at all.
//
// ROWS (inside expanded groups):
//   Row shows ordinal + `vs` opponents (ellipsis truncate) +
//   right-aligned money. Budget for open blocks; spend for
//   closed. Clicking a row expands its card directly beneath.
//   Only ONE row is open at a time across all groups; clicking
//   a second row closes the first.
//
// CARDS (inline expansion beneath the open row):
//   Contain dates + games detail + one button.
//   Button label follows status:
//     actuals-due -> "Close out HSn" (filled green CTA)
//     everything else -> "Open HSn" (outlined, rail border)
//
// ACCENT LINE:
//   Single unbroken 3px border-left carries state colour
//   through row + card as one continuous unit. When a row is
//   open its bottom-corners lose rounding so it reads
//   continuous with the card above (which drops its top-
//   corner rounding). Closed rows keep their rounding.
//   Accent by state:
//     actuals-due -> --sc2-rail-accent-warn (amber)
//     closed-out  -> --sc2-rail-accent-success (green)
//     in-progress -> --sc2-rail-accent-active (blue)
//     upcoming    -> --sc2-rail-text-muted (muted)
//   No red.
// ═══════════════════════════════════════════════════════════
function OpsRailMlbHomestand({
  mode = "overview",
  scopeLabel = "",
  accountKey = null,
  year,
  today,
  yearData,
  homestands,                  // M-3 payload homestands[]
  periodDays = null,
  periodRange = null,
  periodMetrics = null,
  loading = false,
  incomplete = false,
  exportControl = null,
  onTargetHomestand,
  onTargetDay,
  onDrillToMonth,
  onDrillToPeriod,
}) {
  const isDrill = mode === "drill";
  const list = Array.isArray(homestands) ? homestands : [];

  // Season labor rollups. $0 is a fact (nothing recorded), not an
  // absence - owner ruling 2026-07-30. A dash reads as broken.
  const seasonSpent = list.reduce((s, h) => (
    h?.laborActual != null ? s + Number(h.laborActual) : s
  ), 0);
  const seasonBudget = list.reduce((sum, h) => {
    const amt = h?.budget?.amount;
    return amt != null ? sum + Number(amt) : sum;
  }, 0);
  const hasBudget = seasonBudget > 0;
  const spendPct = hasBudget
    ? Math.min(100, Math.round((seasonSpent / seasonBudget) * 100))
    : 0;

  // Drill scope: filter to blocks overlapping the drill window.
  const drillList = (isDrill && periodRange)
    ? list.filter((h) => h.startDate <= periodRange.end && h.endDate >= periodRange.start)
    : list;
  const inScope = isDrill ? drillList : list;

  // Sort so groups render in date order.
  const orderedScope = [...inScope].sort((a, b) =>
    String(a.startDate).localeCompare(String(b.startDate))
  );

  // Group buckets.
  const closedList = orderedScope.filter((h) => h?.status === "closed-out");
  const dueList = orderedScope.filter((h) => h?.status === "actuals-due");
  const upcomingList = orderedScope.filter((h) => h?.status === "upcoming");
  const inProgressHs = orderedScope.find((h) => h?.status === "in-progress") || null;

  const closedCount = closedList.length;
  const totalCount = orderedScope.length;

  // Row + group state.
  //  openRowKey: the single expanded row across ALL groups (null
  //    when nothing is open). Clicking a second row closes the
  //    first per owner: "One card open at a time."
  //  openGroups: which group headers are expanded. Actuals-due
  //    opens by default. Closed-out NEVER auto-expands regardless
  //    of count (owner constraint: preserves the spatial metaphor
  //    when September holds twelve closed blocks).
  const [openRowKey, setOpenRowKey] = useState(null);
  const [openGroups, setOpenGroups] = useState({
    "closed-out":  false,
    "actuals-due": true,
    "upcoming":    false,
  });
  const toggleGroup = (kind) => setOpenGroups((s) => ({ ...s, [kind]: !s[kind] }));
  const toggleRow = (key) => setOpenRowKey((cur) => (cur === key ? null : key));

  const handleOpen = (hs) => {
    if (!hs) return;
    if (onTargetHomestand) onTargetHomestand(hs.key);
    else if (onTargetDay) onTargetDay(hs.startDate);
  };

  // Drill hero: GAME DAYS SERVED in scope.
  const scopedComplete = periodMetrics?.complete || 0;
  const scopedTotal = periodMetrics?.total || 0;
  const scopedPct = scopedTotal > 0 ? Math.round((scopedComplete / scopedTotal) * 100) : 0;

  if (loading) {
    return (
      <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : "LOADING"}>
        <RailHero value="loading..." label={isDrill ? "GAME DAYS SERVED" : "SPENT"} meta="fetching data" />
        <RailProgress pct={0} />
      </RailShell>
    );
  }

  return (
    <RailShell label={scopeLabel ? scopeLabel.toUpperCase() : ""}>
      {/* HERO + progress + merged caption. */}
      {isDrill ? (
        <>
          <RailHero
            value={scopedComplete}
            format={(n) => String(Math.round(n))}
            label="GAME DAYS SERVED"
          />
          <MlbHeroSubtitle>{`of ${scopedTotal || 0}`}</MlbHeroSubtitle>
          <RailProgress pct={scopedPct} complete={scopedPct === 100} />
          <RailHeroProgressCaption>
            {formatCombinedCaption(scopedPct, closedCount, totalCount, scopeLabel)}
          </RailHeroProgressCaption>
        </>
      ) : (
        <>
          <RailHero
            value={seasonSpent}
            format={(n) => `$${Math.round(n).toLocaleString("en-US")}`}
            label="SPENT"
          />
          <MlbHeroSubtitle>
            {hasBudget
              ? `of $${Math.round(seasonBudget).toLocaleString("en-US")} labor budget`
              : "No budget recorded"}
          </MlbHeroSubtitle>
          <RailProgress pct={spendPct} complete={spendPct === 100} />
          <RailHeroProgressCaption>
            {formatCombinedCaption(spendPct, closedCount, totalCount, null)}
          </RailHeroProgressCaption>
        </>
      )}

      {/* PINNED IN-PROGRESS CARD.
          Renders ONLY when a block is in-progress. On gap days
          this disappears entirely - no placeholder occupying the
          most valuable slot on the surface. */}
      {inProgressHs && (
        <MlbPinnedInProgress
          block={inProgressHs}
          onOpen={() => handleOpen(inProgressHs)}
        />
      )}

      {/* THREE COLLAPSED GROUPS in chronological order.
          Zero-count groups do not render at all. */}
      {closedList.length > 0 && (
        <MlbGroup
          kind="closed-out"
          label="Closed out"
          rows={closedList}
          open={openGroups["closed-out"]}
          onToggle={() => toggleGroup("closed-out")}
          openRowKey={openRowKey}
          onToggleRow={toggleRow}
          onOpen={handleOpen}
        />
      )}
      {dueList.length > 0 && (
        <MlbGroup
          kind="actuals-due"
          label="Actuals due"
          rows={dueList}
          open={openGroups["actuals-due"]}
          onToggle={() => toggleGroup("actuals-due")}
          openRowKey={openRowKey}
          onToggleRow={toggleRow}
          onOpen={handleOpen}
        />
      )}
      {upcomingList.length > 0 && (
        <MlbGroup
          kind="upcoming"
          label="Upcoming"
          rows={upcomingList}
          open={openGroups["upcoming"]}
          onToggle={() => toggleGroup("upcoming")}
          openRowKey={openRowKey}
          onToggleRow={toggleRow}
          onOpen={handleOpen}
        />
      )}

      {exportControl && (
        <div className="sc-drill-rail-export">
          {exportControl}
        </div>
      )}
    </RailShell>
  );
}

// ─── MLB rail rev3 components ───────────────────────────────

function MlbHeroSubtitle({ children }) {
  return <p className="sc-rail-mlb-subtitle">{children}</p>;
}

// "12% · 1 of 13 closed out" merged onto the hero caption.
function formatCombinedCaption(pct, closed, total, scopeLabel) {
  const scopeSuffix = scopeLabel
    ? ` in ${scopeLabel.replace(/\s+·.*$/, "").trim()}`
    : "";
  const summary = total > 0 ? `${closed} of ${total} closed out${scopeSuffix}` : null;
  const parts = [`${pct}%`];
  if (summary) parts.push(summary);
  return parts.join(" · ");
}

// Money right-aligned on rows. Budget for open blocks, spend for
// closed. Never renders "$0" for an unclosed block - a missing
// budget renders empty rather than a lie.
function formatRowMoney(hs) {
  if (hs.laborActual != null) {
    return `$${Math.round(hs.laborActual).toLocaleString("en-US")}`;
  }
  if (hs.budget?.amount != null) {
    return `$${Math.round(hs.budget.amount).toLocaleString("en-US")}`;
  }
  return "";
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Pinned in-progress card. Always expanded, no group header,
// no count. Sits directly below the hero and carries the outlined
// "Open HSn" button - never the green CTA (only actionable things
// are green, per owner ruling).
function MlbPinnedInProgress({ block, onOpen }) {
  const opponents = (block.opponents && block.opponents.length > 0)
    ? block.opponents.join(" / ")
    : "TBD";
  const money = formatRowMoney(block);
  const range = shortRange(block.startDate, block.endDate);
  const gameWord = block.gameCount === 1 ? "game" : "games";
  return (
    <div className="sc-rail-mlb-pinned sc-rail-mlb-pinned--in-progress">
      <div className="sc-rail-mlb-pinned-tag">In progress</div>
      <div className="sc-rail-mlb-pinned-head">
        <span className="sc-rail-mlb-pinned-id">{block.ordinal || "HS"}</span>
        <span className="sc-rail-mlb-pinned-opp">vs {opponents}</span>
        {money && <span className="sc-rail-mlb-pinned-money">{money}</span>}
      </div>
      <div className="sc-rail-mlb-pinned-detail">
        {range} · {block.gameCount || 0} {gameWord}
      </div>
      <button
        type="button"
        className="sc-rail-mlb-btn sc-rail-mlb-btn--outlined"
        onClick={onOpen}
      >
        Open {block.ordinal || "homestand"}
      </button>
    </div>
  );
}

// Collapsed group. Header + optional list of items. Header is
// always ONE row tall regardless of count (owner constraint on the
// closed-out group; matched by the other two for consistency).
function MlbGroup({ kind, label, rows, open, onToggle, openRowKey, onToggleRow, onOpen }) {
  return (
    <div
      className={`sc-rail-mlb-group sc-rail-mlb-group--${kind}`}
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        className="sc-rail-mlb-group-header"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="sc-rail-mlb-group-label">{label}</span>
        <span className="sc-rail-mlb-group-count">{rows.length}</span>
        <span className="sc-rail-mlb-group-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <ul className="sc-rail-mlb-group-list">
          {rows.map((hs) => (
            <MlbItem
              key={hs.key}
              hs={hs}
              status={kind}
              open={openRowKey === hs.key}
              onToggle={() => onToggleRow(hs.key)}
              onOpen={() => onOpen(hs)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// One row + its optional inline card. The wrapping li carries the
// state accent as its border-left; both the row button and the
// inline card inherit that accent color through a CSS custom
// property so a single 3px stripe runs down the left of both.
function MlbItem({ hs, status, open, onToggle, onOpen }) {
  const opponents = (hs.opponents && hs.opponents.length > 0)
    ? hs.opponents.join(" / ")
    : "TBD";
  const money = formatRowMoney(hs);
  const range = shortRange(hs.startDate, hs.endDate);
  const gameWord = hs.gameCount === 1 ? "game" : "games";
  const isCta = status === "actuals-due";
  const btnLabel = isCta
    ? `Close out ${hs.ordinal || "homestand"}`
    : `Open ${hs.ordinal || "homestand"}`;
  const btnClass = isCta
    ? "sc-rail-mlb-btn sc-rail-mlb-btn--cta"
    : "sc-rail-mlb-btn sc-rail-mlb-btn--outlined";
  return (
    <li
      className={`sc-rail-mlb-item sc-rail-mlb-item--${status} ${open ? "sc-rail-mlb-item--open" : ""}`.trim()}
    >
      <button
        type="button"
        className="sc-rail-mlb-item-row"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="sc-rail-mlb-item-id">{hs.ordinal || "HS"}</span>
        <span className="sc-rail-mlb-item-opp">vs {opponents}</span>
        {money && <span className="sc-rail-mlb-item-money">{money}</span>}
      </button>
      {open && (
        <div className="sc-rail-mlb-item-card">
          <div className="sc-rail-mlb-item-detail">
            {range} · {hs.gameCount || 0} {gameWord}
          </div>
          <button
            type="button"
            className={btnClass}
            onClick={onOpen}
          >
            {btnLabel}
          </button>
        </div>
      )}
    </li>
  );
}

// Short "Jul 3 - Jul 12" style date range, avoiding the full
// formatHomestandRange import (this file already carries its own
// formatDate helper for the queue rows; a second-shape helper
// here keeps the MLB variant self-contained).
function shortRange(startIso, endIso) {
  const s = shortDate(startIso);
  const e = shortDate(endIso);
  if (!s) return "";
  if (!e || e === s) return s;
  return `${s} - ${e}`;
}
function shortDate(iso) {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
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
  // P3-A gate 4 fix (2026-07-28): cold `?period=P6` deep links can
  // reach here before periodRanges resolves, leaving periodRange=null.
  // Prior to gate 3, useDrillRail's `!!periodMetrics` clause hid the
  // rail during this window; that gate was dropped to keep the ring
  // node mounted across save refetches (see ServiceCalendar.js:2922+).
  // Guard here so the rail renders a caught-up footer during the cold
  // window instead of throwing. buildQueue at :552 already had this
  // guard - parity restored.
  if (!periodRange) return { kind: "caught-up", target: null };
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
  // STL-FL drill (fee-no-dollar shape). Phase 2B: "Enter" -> "Confirm"
  // per vocabulary swap. MLB drill branch above stays verbatim.
  const todayRow = queue.find(r => r.date === iso && r.status === "needs-entry");
  if (todayRow) {
    return {
      kind: "today",
      target: todayRow,
      label: `Confirm today`,
    };
  }
  const oldestOverdue = queue.find(r => r.status === "overdue");
  if (oldestOverdue) {
    return {
      kind: "oldest-overdue",
      target: oldestOverdue,
      label: `Confirm oldest · ${oldestOverdue.aging} ${oldestOverdue.aging === 1 ? "day" : "days"} old`,
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
    label: `Confirm oldest · ${aging} ${aging === 1 ? "day" : "days"} old`,
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

// P3-B (2026-07-28): session strip for the STL-FL branch. Reads
// sessionMap from the handoff coordinator. Fee-no-dollar semantics:
// count + served, no currency. Owner Ruling 3.
function OpsSessionStrip() {
  const { sessionMap } = useHandoffSafe();
  const dates = Object.keys(sessionMap || {});
  if (dates.length === 0) return null;
  let unitsSum = 0;
  for (const d of dates) unitsSum += Number(sessionMap[d]?.units) || 0;
  const days = dates.length;
  const dayWord = days === 1 ? "day" : "days";
  // P3-B gate-3 (2026-07-28): clean count/prose split; separator
  // enforced via CSS margin-inline-end on -n + leading space text
  // node in the label. See handoff.css :80+.
  return (
    <div className="sc-rail-session" role="status" aria-live="polite">
      <span className="sc-rail-session-n">{days}</span>
      <span className="sc-rail-session-label">
        {" "}{dayWord} confirmed · {unitsSum.toLocaleString()} served this session
      </span>
    </div>
  );
}
