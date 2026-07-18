"use client";

// SC v2 Overview - Shared derivation module (Law 1).
//
// One source, three consumers: the rail hero, the rail season lines,
// and the card footers all read through the SAME functions here.
// Structural reconciliation, not coincidental agreement.
//
// Every input is already in memory - `yearData` (months[]) is the
// sc-year-summary payload, `periodRanges` is the fiscal-period map.
// No new fetches, no engine changes.

import { countActionableDays, countEnteredActionable, isActionableDay } from "../season/dayPredicates";

// Client-local today derivation (matches season/dayResolvers.isPastDate
// and audit Q5 policy - anchor pastness against local midnight, never
// payload isPast which was baked at fetch time).
function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Days elapsed since the given ISO date, computed against local midnight.
// Positive integer or 0. Negative dates (future) return 0 (aging is for
// the past only; the queue only shows needs/overdue so callers filter).
function daysAgo(iso) {
  if (!iso) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// ═══════════════════════════════════════════════════════════════
// Hero totals (Calendar + Period modes both share these).
// The rail hero + the rail progress bar + (via consumers) the
// chrome year-banner-stats all derive from the same aggregation.
// Per-meal path only - fee accounts get no rail per the fee-account
// discipline (bundle scope §4). Meals YTD is separate.
// ═══════════════════════════════════════════════════════════════
export function deriveHeroTotals(yearData) {
  if (!Array.isArray(yearData)) {
    return {
      actualRevenue: 0,
      projectedRevenue: 0,
      daysEntered: 0,
      totalActionableDays: 0,
      mealsYTD: 0,
      pctComplete: 0,
    };
  }
  let actualRevenue = 0;
  let projectedRevenue = 0;
  let daysEntered = 0;
  let totalActionableDays = 0;
  let mealsYTD = 0;
  for (const m of yearData) {
    actualRevenue += Number(m.actualRevenue) || 0;
    projectedRevenue += Number(m.projectedRevenue) || 0;
    mealsYTD += Number(m.actualCovers) || 0;
    if (Array.isArray(m.days)) {
      daysEntered += countEnteredActionable(m.days);
      totalActionableDays += countActionableDays(m.days);
    }
  }
  const pctComplete = totalActionableDays > 0
    ? Math.round((daysEntered / totalActionableDays) * 100)
    : 0;
  return { actualRevenue, projectedRevenue, daysEntered, totalActionableDays, mealsYTD, pctComplete };
}

// ═══════════════════════════════════════════════════════════════
// Season list - Calendar mode (12 month lines).
//
// Each line uses the SAME per-month figures MonthCard's footer uses:
//   - actionable days entered / total actionable days (via dayPredicates)
//   - displayRev = hasActuals ? actualRevenue : projectedRevenue
//     (matches MonthCard's `displayRev` at ~line 419-423)
//
// State classification mirrors MonthCard.js's monthState:
//   - "off"        no service (dropped from list or rendered quiet)
//   - "done"       total > 0 && entered === total
//   - "upcoming"   total > 0 && entered === 0 && future month
//   - "in-progress" total > 0 && entered > 0 && entered < total
//   - "current"    isCurrentMonth override on non-done, non-upcoming
// ═══════════════════════════════════════════════════════════════
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function deriveMonthLines(yearData, year, today) {
  if (!Array.isArray(yearData)) return [];
  const todayISO_ = today || todayISO();
  const todayMonth = Number(todayISO_.slice(5, 7)) - 1;
  const lines = [];
  for (let i = 0; i < 12; i++) {
    const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`;
    const monthSummary = yearData.find(m => m.month === monthKey) || null;
    const days = monthSummary?.days || null;
    const totalActionable = days ? countActionableDays(days) : 0;
    const entered = days ? countEnteredActionable(days) : 0;
    const actualRev = Number(monthSummary?.actualRevenue) || 0;
    const projectedRev = Number(monthSummary?.projectedRevenue) || 0;
    const hasActuals = entered > 0;
    const displayRev = hasActuals ? actualRev : projectedRev;

    // Off-detect (matches MonthCard's detectNoService semantic surface -
    // no revenue, no service days -> off; used to route to quiet render).
    const isOff = !monthSummary
      || (totalActionable === 0 && actualRev === 0 && projectedRev === 0);

    const isCurrent = i === todayMonth;
    const firstOfMonth = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    const isFuture = firstOfMonth > todayISO_;

    let state;
    if (isOff) state = "off";
    else if (totalActionable > 0 && entered === totalActionable) state = "done";
    else if (totalActionable > 0 && entered === 0 && isFuture) state = "upcoming";
    else if (isCurrent) state = "current";
    else state = "in-progress";

    lines.push({
      key: monthKey,
      monthIndex: i,
      label: MONTH_NAMES[i],
      short: MONTH_SHORT[i],
      state,
      entered,
      totalActionable,
      displayRev,
      hasActuals,
      isCurrent,
    });
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════
// Season list - Period mode (13 period lines).
//
// Each line reads the SAME per-day source PeriodCard's footer reads
// (a period's days come from bucketing yearData.months[].days[] by
// date within periodRange). Actuals + meals + needs/overdue counts
// come off the same records.
// ═══════════════════════════════════════════════════════════════
export function derivePeriodLines(yearData, periodRanges, today) {
  if (!Array.isArray(yearData) || !Array.isArray(periodRanges)) return [];
  const todayISO_ = today || todayISO();

  // Flat sorted list of all day records with month attached.
  const allDays = [];
  for (const m of yearData) {
    if (!Array.isArray(m.days)) continue;
    for (const d of m.days) allDays.push(d);
  }
  allDays.sort((a, b) => a.date.localeCompare(b.date));

  const lines = [];
  for (const r of periodRanges) {
    const periodDays = allDays.filter(d => d.date >= r.start && d.date <= r.end);
    const totalActionable = countActionableDays(periodDays);
    const entered = countEnteredActionable(periodDays);
    const needs = periodDays.filter(d => d.status === "needs-entry").length;
    const overdue = periodDays.filter(d => d.status === "overdue").length;
    const meals = periodDays.reduce((s, d) => s + (Number(d.actualMeals) || 0), 0);
    const isCurrent = todayISO_ >= r.start && todayISO_ <= r.end;
    const isPast = r.end < todayISO_;
    const isFuture = r.start > todayISO_;

    let state;
    if (totalActionable === 0) state = "off";
    else if (entered === totalActionable) state = "done";
    else if (entered === 0 && isFuture) state = "upcoming";
    else if (overdue > 0 || (isPast && entered < totalActionable)) state = "attention";
    else if (isCurrent) state = "current";
    else state = "in-progress";

    lines.push({
      key: r.period,
      period: r.period,
      start: r.start,
      end: r.end,
      state,
      entered,
      totalActionable,
      needs,
      overdue,
      meals,
      isCurrent,
    });
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════
// Needs-attention queue.
//
// Flat list of needs-entry + overdue days, oldest first. Aging is
// computed at read time against the local-midnight today (never the
// payload's `isPast`; see GOTCHAS `?clientToday=` and audit Q4 notes).
// Callers slice this for "top N + N more" display.
// ═══════════════════════════════════════════════════════════════
export function deriveQueue(yearData, periodRanges, today) {
  if (!Array.isArray(yearData)) return [];
  const todayISO_ = today || todayISO();
  const rangesForLookup = Array.isArray(periodRanges) ? periodRanges : [];

  const attachPeriod = (date) => {
    if (!rangesForLookup.length) return null;
    const range = rangesForLookup.find(r => date >= r.start && date <= r.end);
    return range?.period || null;
  };

  const rows = [];
  for (const m of yearData) {
    if (!Array.isArray(m.days)) continue;
    for (const d of m.days) {
      if (d.status !== "needs-entry" && d.status !== "overdue") continue;
      rows.push({
        date: d.date,
        status: d.status,
        aging: d.status === "overdue" ? daysAgo(d.date) : 0,
        period: attachPeriod(d.date),
        month: Number(d.date.slice(5, 7)) - 1,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// Same rows, but grouped by period for Period-mode rail display.
// Returns an ordered array of period buckets - each has period,
// aging headline (oldest overdue in period), needs count, overdue
// count. Buckets with zero attention items are dropped.
export function deriveQueueByPeriod(yearData, periodRanges, today) {
  const rows = deriveQueue(yearData, periodRanges, today);
  if (!rows.length) return [];
  const byPeriod = new Map();
  for (const row of rows) {
    if (!row.period) continue;
    let bucket = byPeriod.get(row.period);
    if (!bucket) {
      bucket = { period: row.period, needs: 0, overdue: 0, oldestOverdueAging: 0, oldestDate: row.date };
      byPeriod.set(row.period, bucket);
    }
    if (row.status === "overdue") {
      bucket.overdue++;
      if (row.aging > bucket.oldestOverdueAging) bucket.oldestOverdueAging = row.aging;
    } else {
      bucket.needs++;
    }
    if (row.date < bucket.oldestDate) bucket.oldestDate = row.date;
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.oldestDate.localeCompare(b.oldestDate));
}

// ═══════════════════════════════════════════════════════════════
// Footer action - pinned semantics.
//
// Priority:
//   1. Today needing entry     -> "Enter today · {short-date}"
//   2. Oldest overdue           -> "Enter oldest · {N} days old"
//   3. Oldest needs-entry       -> "Enter oldest · {short-date}"
//   4. All caught up            -> quiet state, no button pulse
// ═══════════════════════════════════════════════════════════════
export function deriveFooterAction(yearData, periodRanges, today) {
  const todayISO_ = today || todayISO();
  const rows = deriveQueue(yearData, periodRanges, todayISO_);
  if (!rows.length) {
    return { kind: "caught-up", target: null };
  }
  const todayRow = rows.find(r => r.date === todayISO_ && r.status === "needs-entry");
  if (todayRow) {
    return { kind: "today", target: todayRow, label: `Enter today · ${formatShortDate(todayISO_)}` };
  }
  const overdueRows = rows.filter(r => r.status === "overdue");
  if (overdueRows.length) {
    const oldest = overdueRows[0];
    return {
      kind: "oldest-overdue",
      target: oldest,
      label: `Enter oldest · ${oldest.aging} ${oldest.aging === 1 ? "day" : "days"} old`,
    };
  }
  const oldestNeeds = rows[0];
  return {
    kind: "oldest-needs",
    target: oldestNeeds,
    label: `Enter oldest · ${formatShortDate(oldestNeeds.date)}`,
  };
}

// Same but Period-mode framed: "Clear P{N} overdue · {M} days" when
// there's an overdue period, else falls back to the Calendar shape.
export function derivePeriodFooterAction(yearData, periodRanges, today) {
  const todayISO_ = today || todayISO();
  const periods = deriveQueueByPeriod(yearData, periodRanges, todayISO_);
  const oldestOverduePeriod = periods.find(p => p.overdue > 0);
  if (oldestOverduePeriod) {
    return {
      kind: "clear-period-overdue",
      target: oldestOverduePeriod,
      label: `Clear ${oldestOverduePeriod.period} overdue · ${oldestOverduePeriod.overdue} ${oldestOverduePeriod.overdue === 1 ? "day" : "days"}`,
    };
  }
  return deriveFooterAction(yearData, periodRanges, todayISO_);
}

function formatShortDate(iso) {
  if (!iso) return "";
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

// Compact money for overview law 3: hero-scale $X.XXM at >=1M else $XXXK.
export function fmtOverviewMoney(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    return "$" + (Math.round(m * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + "M";
  }
  if (Math.abs(v) >= 1_000) return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
}

// Season-line money (K only, ghosted futures get the ~ prefix at the
// call site so the fmt function stays value-only).
export function fmtLineMoney(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return "$" + Math.round(v / 1_000_000) + "M";
  if (Math.abs(v) >= 1_000) return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
}

// Re-export for any consumer that wants to derive alongside these.
export { todayISO, daysAgo };
