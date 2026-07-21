"use client";

// SC v2 Drill Rail (W5) - the period/month drill's exact-2dp rail.
//
// Composes the shared Rail primitives beside the workspace, reading
// from the SAME `periodMetrics` object the workspace consumes.
// Structural penny-guarantee: hero = actRev from the metrics; week
// lines = actRev per week from metrics.weeks; the sum of week actRev
// equals the total actRev to the cent because both aggregate through
// the same accumulator (aggregateWorkspaceMetrics in ServiceCalendar
// lines 85-216). No second derivation path anywhere.
//
// Money format: fmt$ = exact 2 decimal places (from season/format).
// Overview compact rules do NOT apply here - this is a billing rail.
//
// Guards:
//   - !isFeeAccount for rail render (caller gates - fee accounts have
//     no rail in W5; W6 owns the homestand ledger)
//   - !hasHomestandSchedule for week lines / bands (SC-073 - MLB
//     homestand accounts never see week cards or lines, ever)
//
// Loading / partial:
//   - `loading` -> render skeleton rail (hero-only, no money summed)
//   - `incomplete` -> hero money region shows explicit "incomplete"
//     treatment; retry reachable via the ribbon's AsOf (always visible
//     above the rail).

import { useState } from "react";
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
import { fmt$ } from "../season/format";
import { deriveOpsHomestandLedgerScoped } from "./opsRailDerive";
import { scrollIntoViewRM } from "./motion";

const QUEUE_TOP_N = 4;

export default function DrillRail({
  scope,             // "period" | "month"
  scopeLabel,        // "P7" | "Jul 2026" - the human anchor for the section
  periodMetrics,     // the SAME metrics the workspace consumes
  periodDays,        // per-day array for queue + notes derivation
  periodRange,       // { start, end } - drill window
  hasHomestandSchedule,
  yearData,          // W6: for the optional HOMESTANDS section on
                     // per-meal accounts w/ hasHomestandSchedule=true
                     // (CIN-KY). The ledger derives from the year
                     // records so the section is stable across drill
                     // navigation. Omit for accounts without schedule.
  today,             // YYYY-MM-DD (client-local)
  loading,           // bool - workspace fetch in-flight
  incomplete,        // bool - partial fetch (some days failed)
  exportControl,     // <ExportControl ... /> the caller already builds
  onTargetDay,       // (date) => void - queue rows + week-line + notes-line target
  onEnterToday,      // () => void - primary CTA when today needs entry
  onEnterOldest,     // (date) => void - primary CTA fallback
  /* Drill P1 PR-A (2026-07-20) DP1-08 - entry CTAs relocated from the
     deleted TodayRail / PastRail. Bulk entry becomes a secondary tier
     button below the primary footer; Enter-today secondary surfaces
     when the primary is Enter-oldest AND today is in scope + needs
     entry. Handlers reused from the ones ServiceCalendar already
     lifts (matching TodayRail's pre-deletion wiring). */
  onBulkModeToggle,  // (next: bool) => void — flips ServiceCalendar's bulkMode
}) {
  const [showAllQueue, setShowAllQueue] = useState(false);

  const m = periodMetrics || null;

  // Hero derivation (always structural, never separately summed)
  const heroActRev = m?.actRev || 0;
  const heroProjRev = m?.projRev || 0;
  const heroDaysEntered = m?.complete || 0;
  const heroTotalDays = m?.total || 0;
  const heroPct = heroTotalDays > 0 ? Math.round((heroDaysEntered / heroTotalDays) * 100) : 0;

  // Week lines (only when SC-073 guard permits).
  // PR-D drill Phase 1: buckets carry .label + .startDate/.endDate for
  // both grouping modes. Use the human label; use the date bounds for
  // "today in this week" so month scope's calendar-week keys (ISO
  // Monday date strings) don't leak into the visible label OR into
  // the isCurrent detection.
  const showWeekLines = !hasHomestandSchedule && m?.weeks;
  const weekLines = showWeekLines
    ? Object.entries(m.weeks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, wm]) => {
          const label = wm.label || key;
          const inRange = today
            && wm.startDate && wm.endDate
            && today >= wm.startDate && today <= wm.endDate;
          const isCurrent = today && wm.total > 0
            && (inRange || weekContainsToday(periodDays, key, today));
          return { key, label, wm, isCurrent };
        })
    : [];

  // Notes derivation - count days with at least one note entry.
  const notesDays = (periodDays || []).filter(d => (d?.noteEntries?.length || 0) > 0);
  const notesCount = notesDays.length;
  const firstNoteDay = notesDays.length ? notesDays.map(d => d.date).sort()[0] : null;

  // Queue - needs-entry + overdue days inside the drill range
  const queueRows = (periodDays || [])
    .filter(d => d?.status === "needs-entry" || d?.status === "overdue")
    .map(d => ({
      date: d.date,
      status: d.status,
      aging: d.status === "overdue" ? daysAgo(d.date, today) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const visibleQueue = showAllQueue ? queueRows : queueRows.slice(0, QUEUE_TOP_N);
  const overflow = queueRows.length - visibleQueue.length;

  // Primary footer action - pinned per bundle scope:
  //   1. today in scope + needs-entry -> Enter today
  //   2. else oldest overdue in scope -> Enter oldest · N days old
  //   3. Drill P2 PR-1 DP2-03 (2026-07-20): else oldest needs-entry ->
  //      Enter oldest · N days old. Prior fall-through was "caught-up"
  //      which contradicted the amber "N need" pill above (CIN-AZ had
  //      3 needs + 0 overdue rendering as caught-up checkmark with no
  //      way to enter). queueRows already contains BOTH needs-entry
  //      AND overdue (filter at :113) and is date-ascending; at this
  //      branch oldestOverdue is null so queueRows[0] is the oldest
  //      unentered day of any status. OpsRail already handles this at
  //      OpsRail.js:476.
  //   4. else quiet all-caught-up (genuinely zero unentered).
  const todayInScope = periodRange
    && today >= periodRange.start
    && today <= periodRange.end;
  const todayRow = queueRows.find(r => r.date === today && r.status === "needs-entry");
  const oldestOverdue = queueRows.find(r => r.status === "overdue");
  let footerKind, footerLabel, footerAction;
  if (todayInScope && todayRow) {
    footerKind = "today";
    footerLabel = `Enter today · ${fmtShortDate(today)}`;
    footerAction = () => onEnterToday?.(today);
  } else if (oldestOverdue) {
    footerKind = "oldest-overdue";
    footerLabel = `Enter oldest · ${oldestOverdue.aging} ${oldestOverdue.aging === 1 ? "day" : "days"} old`;
    footerAction = () => onEnterOldest?.(oldestOverdue.date);
  } else if (queueRows.length > 0) {
    // DP2-03: no overdue but needs-entry present. queueRows[0] is the
    // oldest by date. Compute aging inline - the row's `.aging` field
    // at :117 is 0 for needs-entry rows (only overdue rows compute it).
    const oldestNeeds = queueRows[0];
    const aging = daysAgo(oldestNeeds.date, today);
    footerKind = "oldest-needs";
    footerLabel = `Enter oldest · ${aging} ${aging === 1 ? "day" : "days"} old`;
    footerAction = () => onEnterOldest?.(oldestNeeds.date);
  } else {
    footerKind = "caught-up";
    footerLabel = "";
    footerAction = null;
  }

  if (loading) {
    return (
      <RailShell label={`${scope.toUpperCase()} · ${scopeLabel || ""}`}>
        <RailHero value="loading..." label="ENTERED" meta="fetching data" />
        <RailProgress pct={0} />
      </RailShell>
    );
  }

  // Drill P1 PR-C (2026-07-20) DP1-14 - hero matches SeasonRail's
  // per-meal grammar (Wave 4a / G2 / F10):
  //   Line 1: value + label + projection inline on one baseline.
  //   Progress bar.
  //   Caption below the bar: "N of M days entered" via
  //   RailHeroProgressCaption (same slot the overview uses).
  const heroProjection = `of ${fmt$(heroProjRev)}`;
  const heroCaption = `${heroDaysEntered} of ${heroTotalDays} days entered`;
  const heroBlock = incomplete ? (
    <div className="sc-rail-hero sc-rail-hero--incomplete">
      <span className="sc-rail-hero-value">-- data incomplete</span>
      <span className="sc-rail-hero-label">ENTERED</span>
      <span className="sc-rail-hero-meta">Use the refresh button in the header to retry the fetch.</span>
    </div>
  ) : (
    <RailHero
      value={heroActRev}
      format={fmt$}
      label="ENTERED"
      projection={heroProjection}
    />
  );

  return (
    <RailShell label={`${scope.toUpperCase()} · ${scopeLabel || ""}`}>
      {heroBlock}
      {!incomplete && <RailProgress pct={heroPct} complete={heroPct === 100} />}
      {!incomplete && <RailHeroProgressCaption>{heroCaption}</RailHeroProgressCaption>}

      <RailScroll>
        {/* Needs-attention queue - identical semantics to overview
            queue but limited to the drill range. Rows target the
            day (?day= param via caller's onTargetDay).
            Drill P1 PR-C DP1-15: meta becomes the severity pill
            (reuse G13's RailSection metaTone). Worst-state wins:
            any overdue -> red "{n} overdue"; else needs -> amber
            "{n} need". Empty -> plain count / null. */}
        {(() => {
          const overdueCount = queueRows.filter(r => r.status === "overdue").length;
          const needsCount = queueRows.filter(r => r.status === "needs-entry").length;
          const railMetaTone = overdueCount > 0 ? "overdue" : needsCount > 0 ? "needs" : undefined;
          const railMeta = overdueCount > 0
            ? `${overdueCount} overdue`
            : needsCount > 0 ? `${needsCount} need` : null;
          return (
        <RailSection
          label="NEEDS ENTRY"
          meta={railMeta}
          metaTone={railMetaTone}
        >
          {queueRows.length === 0 && (
            <p className="sc-rail-queue-empty">Nothing needs entry in this scope.</p>
          )}
          {visibleQueue.map(row => (
            <RailQueueRow
              key={row.date}
              date={row.date}
              status={row.status}
              aging={row.aging}
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
          );
        })()}

        {/* W6: HOMESTANDS section for per-meal accounts w/
            hasHomestandSchedule=true (CIN-KY is the proof case).
            Sits BELOW queue, ABOVE notes per bundle scope. Uses the
            same deriveOpsHomestandLedgerScoped from opsRailDerive
            (which extends deriveHomestandSegments; same load-bearing
            filters). Only ledger rows overlapping the drill range
            are shown. */}
        {hasHomestandSchedule && yearData && periodRange && (() => {
          const ledger = deriveOpsHomestandLedgerScoped(
            yearData,
            today,
            periodRange.start,
            periodRange.end
          );
          if (!ledger.length) return null;
          return (
            <RailSection
              label="Homestands"
              meta={`${ledger.length} in scope`}
            >
              {ledger.map(hs => {
                const isDone = hs.status === "done";
                const isCurrent = hs.status === "current";
                const tone = isDone
                  ? "done"
                  : (isCurrent ? "current" : (hs.status === "in-progress" ? "in-progress" : "upcoming"));
                const value = `${hs.gameEntered}/${hs.gameCount} games`;
                const sub = hs.meals > 0
                  ? `${hs.meals.toLocaleString("en-US")} meals`
                  : null;
                return (
                  <RailLine
                    key={hs.key}
                    label={`${hs.homestandId} vs ${hs.opponentLabel}`}
                    value={value}
                    sublabel={sub}
                    tone={tone}
                    onClick={() => onTargetDay?.(hs.startDate)}
                  />
                );
              })}
            </RailSection>
          );
        })()}

        {/* Bundle-A #7/#8 (2026-07-21): the Notes rail section
            (single row: "N days with notes" targeting the first
            note-day) has been REMOVED per owner. Notes count
            derivation (notesDays / notesCount / firstNoteDay at
            :107-109) retained above because it's cheap and
            harmless if a future consumer wants it back; only the
            RailSection render is stripped. */}

        {/* Week lines - identical source as the in-grid bands (m.weeks).
            SC-073: rendered ONLY when !hasHomestandSchedule.
            F1 (law 4 fix): when `incomplete`, every week's `wm.actRev`
            is a partial sum (one or more contributing days failed to
            fetch). Rather than showing a possibly-wrong penny total
            styled as complete money, we swap the money value out for
            `--` and force `attention` tone across the line; the count
            (entered/total) still displays via sublabel because that
            data is day-status, not money. The section header carries
            an explicit "totals incomplete" marker so the operator
            reads the whole block as pending. */}
        {showWeekLines && weekLines.length > 0 && (
          <RailSection
            label="Weeks"
            meta={incomplete
              ? <span className="sc-rail-section-meta--warn">totals incomplete</span>
              : null}
          >
            {weekLines.map(({ key, label, wm, isCurrent }) => {
              const money = incomplete ? "--" : fmt$(wm.actRev);
              const tone = incomplete
                ? "attention"
                : (isCurrent ? "current" : "in-progress");
              const sub = wm.total > 0 ? `${wm.complete}/${wm.total}` : null;
              return (
                <RailLine
                  key={key}
                  label={label}
                  value={money}
                  sublabel={sub}
                  tone={tone}
                  /* PR-D drill Phase 1: scroll target keys on the bucket
                     KEY (data-week attr), which is fiscal for period +
                     Monday-ISO for month - matches DayGrid's data-week
                     without needing a label round-trip. */
                  onClick={() => scrollToBand(key)}
                />
              );
            })}
          </RailSection>
        )}
      </RailScroll>

      {/* Footer: primary CTA (or caught-up). Drill P1 PR-A DP1-08
          adds a secondary-tier row below (Enter today + Bulk entry)
          for the three-CTA two-tier layout the deleted TodayRail
          used to host. */}
      <RailFooter
        kind={footerKind}
        label={footerLabel}
        onClick={footerAction}
      />
      {(() => {
        // DP1-08 secondary tier. Enter-today shows ONLY when today is
        // in scope + needs entry AND the primary is NOT already
        // Enter today (i.e. primary is Enter-oldest, so today is a
        // second explicit target). Bulk entry always shows when
        // onBulkModeToggle is wired (past-period + current both).
        const showEnterToday = todayInScope
          && todayRow
          && footerKind !== "today";
        const showBulk = !!onBulkModeToggle;
        if (!showEnterToday && !showBulk) return null;
        return (
          <div className="sc-drill-rail-actions" role="group" aria-label="Entry actions">
            {showEnterToday && (
              <button
                type="button"
                className="sc-drill-rail-action sc-drill-rail-action--secondary"
                onClick={() => onEnterToday?.(today)}
              >
                Enter today
              </button>
            )}
            {showBulk && (
              <button
                type="button"
                className="sc-drill-rail-action sc-drill-rail-action--secondary"
                onClick={() => onBulkModeToggle?.(true)}
              >
                Bulk entry
              </button>
            )}
          </div>
        );
      })()}
      {exportControl && (
        <div className="sc-drill-rail-export">
          {exportControl}
        </div>
      )}
    </RailShell>
  );
}

// ─── utils ───────────────────────────────────────────────
function daysAgo(iso, todayIso) {
  if (!iso || !todayIso) return 0;
  const [ay, am, ad] = iso.split("-").map(Number);
  const [by, bm, bd] = todayIso.split("-").map(Number);
  const then = new Date(ay, am - 1, ad).getTime();
  const now = new Date(by, bm - 1, bd).getTime();
  return Math.max(0, Math.floor((now - then) / 86400000));
}

function fmtShortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${DOW[date.getDay()]}, ${MON[date.getMonth()]} ${date.getDate()}`;
}

// Best-effort: does today's date fall in this week's date range?
// Reads the periodDays' meta to find days tagged with the given week
// label and checks if today is inside that span.
function weekContainsToday(periodDays, weekLabel, today) {
  if (!periodDays?.length || !today) return false;
  const inWeek = periodDays.filter(d => d.meta?.week === weekLabel);
  if (!inWeek.length) return false;
  const min = inWeek.map(d => d.date).sort()[0];
  const max = inWeek.map(d => d.date).sort().at(-1);
  return today >= min && today <= max;
}

// Scroll the in-grid band for a given week label into view. The
// bands are rendered by DayGrid with `data-week="<label>"` so a
// simple attribute selector locates the right one. Falls back
// silently if the band isn't found.
// W7 PR 2/3 migration: route through the shared scrollIntoViewRM
// helper so the reduce-motion branch is one implementation across
// every v2 surface (was: inline el.scrollIntoView call here).
function scrollToBand(weekLabel) {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`.sc-workspace-band[data-week="${weekLabel}"]`);
  scrollIntoViewRM(el, { block: "center" });
}
