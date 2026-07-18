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
}) {
  const [showAllQueue, setShowAllQueue] = useState(false);

  const m = periodMetrics || null;

  // Hero derivation (always structural, never separately summed)
  const heroActRev = m?.actRev || 0;
  const heroProjRev = m?.projRev || 0;
  const heroDaysEntered = m?.complete || 0;
  const heroTotalDays = m?.total || 0;
  const heroPct = heroTotalDays > 0 ? Math.round((heroDaysEntered / heroTotalDays) * 100) : 0;

  // Week lines (only when SC-073 guard permits)
  const showWeekLines = !hasHomestandSchedule && m?.weeks;
  const weekLines = showWeekLines
    ? Object.entries(m.weeks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, wm]) => {
          const isCurrent = today && wm.total > 0 && weekContainsToday(periodDays, label, today);
          return { label, wm, isCurrent };
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
  //   3. else quiet all-caught-up
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

  // Incomplete-fetch treatment for the hero money region. Rail
  // structure is preserved; the money value refuses to render a
  // possibly-wrong sum, and points the operator at the ribbon
  // AsOf refresh reachable above. Progress bar + queue + week
  // lines can still show what data DID come in - they're annotations,
  // not billing figures.
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
      meta={`of ${fmt$(heroProjRev)} projected · ${heroDaysEntered} of ${heroTotalDays} days entered`}
    />
  );

  return (
    <RailShell label={`${scope.toUpperCase()} · ${scopeLabel || ""}`}>
      {heroBlock}
      {!incomplete && <RailProgress pct={heroPct} complete={heroPct === 100} />}

      <RailScroll>
        {/* Needs-attention queue - identical semantics to overview
            queue but limited to the drill range. Rows target the
            day (?day= param via caller's onTargetDay). */}
        <RailSection
          label="NEEDS ENTRY"
          meta={queueRows.length > 0 ? `${queueRows.length}` : null}
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

        {/* Notes line - single row, count + first-day target. Omitted
            when there are zero notes. */}
        {notesCount > 0 && (
          <RailSection label="Notes">
            <RailLine
              label={`${notesCount} ${notesCount === 1 ? "day" : "days"} with notes`}
              value=""
              tone="current"
              onClick={firstNoteDay ? () => onTargetDay?.(firstNoteDay) : undefined}
            />
          </RailSection>
        )}

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
            {weekLines.map(({ label, wm, isCurrent }) => {
              const money = incomplete ? "--" : fmt$(wm.actRev);
              const tone = incomplete
                ? "attention"
                : (isCurrent ? "current" : "in-progress");
              const sub = wm.total > 0 ? `${wm.complete}/${wm.total}` : null;
              return (
                <RailLine
                  key={label}
                  label={label}
                  value={money}
                  sublabel={sub}
                  tone={tone}
                  onClick={() => scrollToBand(label)}
                />
              );
            })}
          </RailSection>
        )}
      </RailScroll>

      {/* Footer: primary CTA (or caught-up) + quiet secondary Export.
          Refines the one-primary-button law: exactly one primary acts;
          Export is the sole quiet utility. */}
      <RailFooter
        kind={footerKind}
        label={footerLabel}
        onClick={footerAction}
      />
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
