"use client";

// SC v2 Ops rail derivations (W6).
//
// Zero money formatters imported here or in the OpsRail composition
// files that consume it. Fee accounts + STL-FL surfaces read counts
// and meals, never dollars - the no-$ discipline (bundle scope §2,
// program scope §3) is enforced by the ABSENCE of any fmt$ / fmt$K /
// fmtOverviewMoney import in this file and in OpsRail.js /
// OpsDrillRail.js. Grep proof accompanies the PR.
//
// Every homestand figure flows through the existing
// season/homestandDerivation.deriveHomestandSegments (audit Q5) -
// which we extended in the same commit to accumulate per-HS `meals`
// alongside its existing `gameCount` / `gameEntered` fields. Same
// filters (skip !homestandId + EXH + AWAY) - one accumulator on the
// same bucket, not a parallel derivation path.

import {
  deriveHomestandSegments,
  formatHomestandRange,
} from "../season/homestandDerivation.js";
import {
  countActionableDays,
  countEnteredActionable,
  isActionableDay,
} from "../season/dayPredicates.js";

// Client-local today (matches overviewDerive / dayResolvers.isPastDate).
function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(iso, todayIso) {
  if (!iso || !todayIso) return 0;
  const [ay, am, ad] = iso.split("-").map(Number);
  const [by, bm, bd] = todayIso.split("-").map(Number);
  const then = new Date(ay, am - 1, ad).getTime();
  const now = new Date(by, bm - 1, bd).getTime();
  return Math.max(0, Math.floor((now - then) / 86400000));
}

// ═══════════════════════════════════════════════════════════════
// Overview totals for the ops rail hero.
//
// MLB fee (hasHomestandSchedule=true, isFeeAccount=true):
//   gameDaysEntered / totalGameDays from month.homestandSummary
//   (audit Q3 canonical shape; same aggregation ServiceCalendar's
//   yearBannerStats reads at 1787-1794).
//   mealsYTD = sum of month.actualCovers.
//   homestandsComplete / totalHomestands from
//   deriveHomestandSegments (segments where all gameCount === gameEntered).
//
// STL-FL (isFeeAccount=true, hasHomestandSchedule=false):
//   daysEntered / totalActionableDays via dayPredicates.
//   mealsYTD = sum of month.actualCovers.
// ═══════════════════════════════════════════════════════════════
// M-0 (2026-08-04): every call to deriveHomestandSegments now threads
// `accountKey` so the MLB-only gate holds. Callers that don't have an
// accountKey handy pass `undefined`; the derivation returns [] for
// non-MLB accounts, matching the pre-M-0 behavior for CIN-KY / TBJ-NY
// (empty stored ids also gave []) and never reaching STL-FL / TBJ-FL /
// PDC through outer gates. `accountKey` is an object option (not a
// positional arg) so future guards can extend the shape without churn.
export function deriveOpsHeroTotals(yearData, hasHomestandSchedule, todayDate, opts = {}) {
  const { accountKey } = opts;
  const totals = {
    gameDaysEntered: 0,
    totalGameDays: 0,
    daysEntered: 0,
    totalActionableDays: 0,
    mealsYTD: 0,
    homestandsComplete: 0,
    totalHomestands: 0,
    homestandsInProgress: 0,
    // pctComplete drives the RailProgress bar - based on the primary
    // hero counter for the account shape.
    pctComplete: 0,
  };
  if (!Array.isArray(yearData)) return totals;

  for (const m of yearData) {
    totals.mealsYTD += Number(m.actualCovers) || 0;
    if (Array.isArray(m.days)) {
      totals.daysEntered += countEnteredActionable(m.days);
      totals.totalActionableDays += countActionableDays(m.days);
    }
    if (m.homestandSummary) {
      totals.gameDaysEntered += Number(m.homestandSummary.gameDaysEntered) || 0;
      totals.totalGameDays += Number(m.homestandSummary.gameDays) || 0;
    }
  }

  if (hasHomestandSchedule) {
    const segments = deriveHomestandSegments(yearData, todayDate || todayISO(), { accountKey });
    totals.totalHomestands = segments.length;
    for (const s of segments) {
      if (s.gameCount > 0 && s.gameCount === s.gameEntered) {
        totals.homestandsComplete++;
      } else if (s.gameEntered > 0) {
        totals.homestandsInProgress++;
      }
    }
    totals.pctComplete = totals.totalGameDays > 0
      ? Math.round((totals.gameDaysEntered / totals.totalGameDays) * 100)
      : 0;
  } else {
    totals.pctComplete = totals.totalActionableDays > 0
      ? Math.round((totals.daysEntered / totals.totalActionableDays) * 100)
      : 0;
  }
  return totals;
}

// ═══════════════════════════════════════════════════════════════
// DP2-06 v2 retired 2026-07-21: deriveOpsHeroTotalsScoped attempted
// a parallel per-day aggregation for the drill hero, but returned
// zeros for MLB (the game-day predicate mis-matched the workspace
// aggregator's semantics). Rather than debug two aggregators, the
// drill hero now reads the SAME `periodMetrics` object the top
// strip + tiles derive from - computed once by
// aggregateWorkspaceMetrics in ServiceCalendar.js. See OpsRail.js:80
// for the wire-up. Overview hero keeps deriveOpsHeroTotals(yearData).
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Homestand ledger rows (MLB fee accounts only).
//
// Returns the full segment list from deriveHomestandSegments in
// season order, with a rendering-friendly status flag:
//   "done"        - all games recorded (gameEntered === gameCount)
//   "in-progress" - endDate <= today AND gameEntered < gameCount
//                   (games happened but not fully recorded)
//   "current"     - today falls inside [start,end]
//   "next"        - future
//
// The "next unentered game" idea (footer + queue) walks the same
// segments' game-day dates - a separate helper (`deriveOpsQueue`)
// filters day records to the actionable set.
// ═══════════════════════════════════════════════════════════════
export function deriveOpsHomestandLedger(yearData, todayDate, opts = {}) {
  const { accountKey } = opts;
  const iso = todayDate || todayISO();
  const segments = deriveHomestandSegments(yearData, iso, { accountKey });
  return segments.map(seg => {
    let status = seg.status; // done/now/next from the base derivation
    if (status === "now") status = "current";
    if (status === "done" && seg.gameEntered < seg.gameCount) status = "in-progress";
    return {
      // M-0: React key uses the DERIVATION's stable key (first game's
      // gamePk, else startDate), not the ordinal display label.
      key: seg.key,
      homestandId: seg.homestandId,
      opponents: seg.opponents,
      opponentLabel: seg.opponents.length > 0 ? seg.opponents.join(" / ") : "TBD",
      startDate: seg.startDate,
      endDate: seg.endDate,
      dateRange: formatHomestandRange(seg.startDate, seg.endDate),
      gameCount: seg.gameCount,
      gameEntered: seg.gameEntered,
      meals: seg.meals || 0,
      status,
    };
  });
}

// Same shape but scoped to a drill window (period or month). Filters
// segments to those overlapping the [start,end] range, then trims each
// remaining segment's counts to the days within the window. Uses the
// same helper output structure - all filters preserved.
export function deriveOpsHomestandLedgerScoped(yearData, todayDate, rangeStart, rangeEnd, opts = {}) {
  const { accountKey } = opts;
  const iso = todayDate || todayISO();
  const segments = deriveHomestandSegments(yearData, iso, { accountKey });
  const scoped = segments.filter(seg =>
    seg.startDate <= rangeEnd && seg.endDate >= rangeStart
  );
  if (!scoped.length) return [];

  // M-0 (2026-08-04): match by DATE RANGE, not by stored homestand_id.
  // For each scoped segment, walk yearData days within the intersection
  // of the segment's date range and the requested window; count GAME
  // rows (entered + meals). Same shape as the pre-M-0 output.
  return scoped.map(seg => {
    const winStart = seg.startDate > rangeStart ? seg.startDate : rangeStart;
    const winEnd = seg.endDate < rangeEnd ? seg.endDate : rangeEnd;
    let gameCount = 0, gameEntered = 0, meals = 0;
    for (const m of yearData || []) {
      if (!m.days) continue;
      for (const d of m.days) {
        if (d.date < winStart || d.date > winEnd) continue;
        if (d.dayType !== "GAME") continue;
        gameCount += 1;
        if (d.status === "entered") gameEntered += 1;
        if (d.actualMeals != null) meals += Number(d.actualMeals) || 0;
      }
    }
    let status = seg.status;
    if (status === "now") status = "current";
    if (status === "done" && gameEntered < gameCount) status = "in-progress";
    return {
      key: seg.key,
      homestandId: seg.homestandId,
      opponents: seg.opponents,
      opponentLabel: seg.opponents.length > 0 ? seg.opponents.join(" / ") : "TBD",
      startDate: seg.startDate,
      endDate: seg.endDate,
      dateRange: formatHomestandRange(seg.startDate, seg.endDate),
      gameCount,
      gameEntered,
      meals,
      status,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// To-enter queue for the ops rail.
//
// MLB fee (hasHomestandSchedule=true):
//   Past unentered GAME days across the year (dayType === "GAME" &&
//   date < today && !d.hasActuals). Oldest first. Neutral navy tone
//   (law 3 - MLB category = no amber/red anywhere).
//
// STL-FL (hasHomestandSchedule=false, isFeeAccount=true):
//   The same needs-entry + overdue filter overviewDerive.deriveQueue
//   uses (PDC-family - amber/red allowed per legend/classifier
//   semantics). We build it here to keep OpsRail's imports isolated
//   from overviewDerive's money surface.
// ═══════════════════════════════════════════════════════════════
export function deriveOpsQueueMlb(yearData, todayDate) {
  const iso = todayDate || todayISO();
  const rows = [];
  if (!Array.isArray(yearData)) return rows;
  for (const m of yearData) {
    if (!Array.isArray(m.days)) continue;
    for (const d of m.days) {
      if (d.dayType !== "GAME") continue;
      // sc-12/13: EXH and AWAY never enter the queue - dayType is
      // "EXHIBITION" or "AWAY" for those; they never pass this gate.
      if (d.hasActuals) continue;
      if (d.date >= iso) continue;
      rows.push({
        date: d.date,
        opponent: d.opponent || null,
        aging: daysAgo(d.date, iso),
        // Semantic tag: MLB rows are always "unentered" (never overdue).
        // The rail rendering translates this to neutral navy "to enter"
        // framing per law 3.
        semantic: "unentered",
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function deriveOpsQueueStlFl(yearData, todayDate) {
  const iso = todayDate || todayISO();
  const rows = [];
  if (!Array.isArray(yearData)) return rows;
  for (const m of yearData) {
    if (!Array.isArray(m.days)) continue;
    for (const d of m.days) {
      if (d.status !== "needs-entry" && d.status !== "overdue") continue;
      rows.push({
        date: d.date,
        status: d.status,
        aging: d.status === "overdue" ? daysAgo(d.date, iso) : 0,
        semantic: "urgency", // STL-FL keeps PDC-family amber/red per legend
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// Footer action - pinned semantics per fee variant.
//
// MLB fee: "Enter next game day · vs OPP" targeting the next
//   unentered FUTURE game day (today onwards). If none exists, and
//   there ARE past unentered game days, target the oldest of those.
//   Else all-caught-up (quiet).
//
// STL-FL: same shape as overview's deriveFooterAction (today needs,
//   oldest overdue, oldest needs, caught-up) - but computed here so
//   OpsRail doesn't import overviewDerive.
// ═══════════════════════════════════════════════════════════════
export function deriveOpsFooterActionMlb(yearData, todayDate) {
  const iso = todayDate || todayISO();
  // Walk the year for the earliest UNENTERED game day whose date >=
  // today. Fall through to past unentered.
  let nextFuture = null;
  let oldestPast = null;
  if (Array.isArray(yearData)) {
    for (const m of yearData) {
      if (!Array.isArray(m.days)) continue;
      for (const d of m.days) {
        if (d.dayType !== "GAME") continue;
        if (d.hasActuals) continue;
        if (d.date >= iso) {
          if (!nextFuture || d.date < nextFuture.date) {
            nextFuture = { date: d.date, opponent: d.opponent || null };
          }
        } else {
          if (!oldestPast || d.date < oldestPast.date) {
            oldestPast = { date: d.date, opponent: d.opponent || null };
          }
        }
      }
    }
  }
  if (nextFuture) {
    const oppLabel = nextFuture.opponent ? ` · vs ${nextFuture.opponent}` : "";
    return {
      kind: "next-game",
      target: nextFuture,
      label: `Enter next game day${oppLabel}`,
    };
  }
  if (oldestPast) {
    const oppLabel = oldestPast.opponent ? ` · vs ${oldestPast.opponent}` : "";
    return {
      kind: "oldest-unentered",
      target: oldestPast,
      label: `Enter oldest unentered${oppLabel}`,
    };
  }
  return { kind: "caught-up", target: null };
}

export function deriveOpsFooterActionStlFl(yearData, todayDate) {
  const iso = todayDate || todayISO();
  const rows = deriveOpsQueueStlFl(yearData, iso);
  if (!rows.length) return { kind: "caught-up", target: null };
  // Phase 2B (2026-07-25): STL-FL-only function by name (Stl_Fl). Verb
  // swap "Enter" -> "Confirm" per vocab ruling. MLB footer action
  // lives in deriveOpsFooterActionMlb above and is untouched.
  const todayRow = rows.find(r => r.date === iso && r.status === "needs-entry");
  if (todayRow) {
    return {
      kind: "today",
      target: todayRow,
      label: `Confirm today · ${fmtShortDate(iso)}`,
    };
  }
  const oldestOverdue = rows.find(r => r.status === "overdue");
  if (oldestOverdue) {
    return {
      kind: "oldest-overdue",
      target: oldestOverdue,
      label: `Confirm oldest · ${oldestOverdue.aging} ${oldestOverdue.aging === 1 ? "day" : "days"} old`,
    };
  }
  const oldestNeeds = rows[0];
  return {
    kind: "oldest-needs",
    target: oldestNeeds,
    label: `Confirm oldest · ${fmtShortDate(oldestNeeds.date)}`,
  };
}

// Drill-scoped queue (filters year queue rows to [start,end]).
// P3-A gate 4 fix (2026-07-28): defense-in-depth. Callers already
// guard - buildQueue at OpsRail.js:552, buildDrillFooter at :565,
// DrillRail's inline homestand ledger at :320 - but a null/undefined
// rangeStart/rangeEnd here would silently return an empty queue
// (`r.date >= undefined` is always false), which reads as caught-up
// on a cold deep link. Explicit early-return makes the null case
// obvious to callers reading traces / doing follow-up debugging.
export function deriveOpsDrillQueueMlb(yearData, todayDate, rangeStart, rangeEnd) {
  if (rangeStart == null || rangeEnd == null) return [];
  return deriveOpsQueueMlb(yearData, todayDate)
    .filter(r => r.date >= rangeStart && r.date <= rangeEnd);
}
export function deriveOpsDrillQueueStlFl(yearData, todayDate, rangeStart, rangeEnd) {
  if (rangeStart == null || rangeEnd == null) return [];
  return deriveOpsQueueStlFl(yearData, todayDate)
    .filter(r => r.date >= rangeStart && r.date <= rangeEnd);
}

// Notes count for a set of days (drill scope). Same NOTE-only signal
// v2 rail uses everywhere.
export function deriveOpsNotes(days) {
  if (!Array.isArray(days)) return { count: 0, firstDate: null };
  const withNotes = days.filter(d => (d?.noteEntries?.length || 0) > 0);
  const dates = withNotes.map(d => d.date).sort();
  return { count: withNotes.length, firstDate: dates[0] || null };
}

function fmtShortDate(iso) {
  if (!iso) return "";
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

export { todayISO, daysAgo };
