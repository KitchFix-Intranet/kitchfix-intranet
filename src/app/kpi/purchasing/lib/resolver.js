// src/app/kpi/purchasing/lib/resolver.js
//
// OVERVIEW PHASE 2 PR-2 - purchasing server-side resolver.
//
// Master KPI CC seat.  Extracts the purchasing board's per-bucket +
// tracked-line rollups into a pure function the Overview page will
// consume server-side, without asking the client to re-implement the
// board's folds.
//
// **The purchasing board does NOT change in this PR.**  Its client
// folds stay (bucketWeeklySpend / periodWeeklySpend / kpiBudget /
// bucketBudget in ./board.js).  This module is a SECOND consumer of
// the same raw route payload - a merge-gate probe
// (_probe_purchasing_resolver_parity.mjs) asserts to the cent that
// resolver totals match the client folds, so both consumption paths
// speak the same number.  When the Overview lands, the client folds
// retire per §11 E-10.
//
// **One implementation per number.**  The gl_line_code -> bucket
// mapping (GL_PREFIX_FOR_BUCKET) lives in ./board.js and is imported
// here.  No copy.  The tracked-line list (TRACKED_LINE_CODES:
// 5002.1, 5002.5, 5017.3) also lives in ./board.js.  If those change,
// they change in one place and both the client board and the Overview
// resolver see the same set.
//
// Signature (verbatim from Kevin's PR-2 brief):
//
//   buildPurchasingBoard({
//     members,       // string[] account keys
//     start, end,    // ISO YYYY-MM-DD, [start, end] range
//     today,         // ISO YYYY-MM-DD (used for closed-week accounting)
//     actualsRows,   // raw purchasing_actuals rows (from paginateActuals)
//     weeklyRows,    // raw v_purchasing_by_site_week rows
//     pendingRow,    // { amount, line_count } from loadPending +
//                    //   loadReportOnlyPending merged via mergePending
//     budgetMap,     // Map<gl_line_code, Map<account_key, Map<period_no, amount>>>
//                    //   as produced by loadPurchasingBudgets in the
//                    //   purchasing route
//   })
//   -> {
//     buckets: {
//       "3200": { key, gl_prefix, period_total, week_series[], budget },
//       "3400": { ... },
//       "3500": { ... },
//     },
//     tracked: {
//       "5002.1": { line_code, period_total, week_series[], budget },
//       "5002.5": { ... },
//       "5017.3": { ... },
//     },
//     totals: {
//       buckets_period_total,   // sum of the three bucket period totals (kpi line)
//       buckets_budget,         // sum of the three bucket budgets
//       tracked_period_total,   // sum of the three tracked line period totals
//       tracked_budget,         // sum of the three tracked line budgets
//       members,                // echo of input for downstream provenance
//       range: { start, end },
//     },
//   }
//
// Grain:
//   - period_total  : sum across [start, end] (matches the client fold
//                     bucketWeeklySpend + kpiBudget totals)
//   - week_series   : ordered array [{ week_start, amount }] for every
//                     fiscal week in [start, end], zero-filled - byte-
//                     identical to bucketWeeklySpend output
//   - budget        : range-scoped budget summed via the per-week
//                     convention (period_amount / 4 per fiscal week
//                     in range).  Matches the route's budgetForRange
//                     helper.  Envelope exclusions apply
//                     (PURCHASING_ENVELOPE_EXCLUSIONS is currently a
//                     named empty set - see accountModels.js).

import {
  weekStartsInRange,
  periodOf,
  periodStartISO,
  periodEndISO,
} from "@/app/kpi/labor/lib/periods.js";
import {
  GL_PREFIX_FOR_BUCKET,
  TRACKED_LINE_CODES,
} from "@/app/kpi/purchasing/lib/board.js";
import { PURCHASING_ENVELOPE_EXCLUSIONS } from "@/lib/accountModels";

// The three P&L cost-of-goods buckets.  Keyed by gl_prefix (3200 /
// 3400 / 3500) per Kevin's PR-2 brief output shape, with the semantic
// key (food / packaging / vehicle) alongside for cross-reference to
// the client BUCKET_DEFS.
const BUCKET_DEFS = [
  { key: "food",      gl_prefix: "3200" },
  { key: "packaging", gl_prefix: "3400" },
  { key: "vehicle",   gl_prefix: "3500" },
];

// ─── Weekly series builders (shared shape) ───────────────────────────
//
// These mirror bucketWeeklySpend / periodWeeklySpend from board.js.
// The client folds already produce the correct series for a bucket;
// we do NOT reimplement bucket-membership tests (imported from
// GL_PREFIX_FOR_BUCKET above).  Where the client uses `weekly[]`
// filtered by a bucket predicate, we do the same.

function seriesForPredicate(weeklyRows, weeks, predicate) {
  const bySpend = new Map(weeks.map(w => [w, 0]));
  for (const r of weeklyRows || []) {
    if (!predicate(r?.gl_line_code)) continue;
    const w = r?.week_start;
    if (!bySpend.has(w)) continue;
    bySpend.set(w, (bySpend.get(w) || 0) + Number(r.amount || 0));
  }
  return weeks.map(w => ({
    week_start: w,
    amount: Math.round((bySpend.get(w) || 0) * 100) / 100,
  }));
}

function sumSeries(series) {
  let s = 0;
  for (const w of series) s += Number(w.amount || 0);
  return Math.round(s * 100) / 100;
}

// ─── Budget resolvers (shared with the route's budgetForRange) ───────
//
// Route's budgetForRange (route.js:515-534) sums period_amount / 4
// across the fiscal weeks in [start, end], per member, excluding
// PURCHASING_ENVELOPE_EXCLUSIONS.  We replicate that convention here
// - one implementation, in this file - because it is a range-shaping
// rule that must produce the same number whether the client folds or
// the resolver runs it.
//
// budgetMap shape:
//   Map<gl_line_code, Map<account_key, Map<period_no, amount>>>
//
// Callers can pass a Map or a plain object with the same shape (the
// probe deserialises from JSON so it will be a plain object of plain
// objects).  budgetLookup normalises the two.
function budgetLookup(budgetMap, glLineCode) {
  if (!budgetMap) return null;
  if (typeof budgetMap.get === "function") return budgetMap.get(glLineCode) || null;
  return budgetMap[glLineCode] || null;
}

function accountLookup(perLine, accountKey) {
  if (!perLine) return null;
  if (typeof perLine.get === "function") return perLine.get(accountKey) || null;
  return perLine[accountKey] || null;
}

function periodLookup(byAcct, periodNo) {
  if (!byAcct) return null;
  if (typeof byAcct.get === "function") {
    const v = byAcct.get(Number(periodNo));
    return v == null ? null : Number(v);
  }
  // Plain object - key coerces to string; try both
  const v = byAcct[periodNo] ?? byAcct[String(periodNo)];
  return v == null ? null : Number(v);
}

function budgetForRange({ budgetMap, glLineCode, members, weeks }) {
  const perLine = budgetLookup(budgetMap, glLineCode);
  if (!perLine) return 0;
  let total = 0;
  for (const w of weeks) {
    const p = periodOf(w);
    if (p == null) continue;
    for (const m of members) {
      if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
      const byAcct = accountLookup(perLine, m);
      if (!byAcct) continue;
      const amt = periodLookup(byAcct, p);
      if (amt == null) continue;
      total += amt / 4;
    }
  }
  return Math.round(total * 100) / 100;
}

// Bucket-level budget: walk every gl_line_code in budgetMap and sum
// budgetForRange for those whose code matches the bucket predicate.
function bucketBudgetForRange({ budgetMap, bucketKey, members, weeks }) {
  const pred = GL_PREFIX_FOR_BUCKET[bucketKey];
  if (!pred) return 0;
  let total = 0;
  const keys = typeof budgetMap?.keys === "function"
    ? [...budgetMap.keys()]
    : Object.keys(budgetMap || {});
  for (const gl of keys) {
    if (!pred(gl)) continue;
    total += budgetForRange({ budgetMap, glLineCode: gl, members, weeks });
  }
  return Math.round(total * 100) / 100;
}

// ─── Budget-to-date by days (Overview Phase 2 PR-3 · §11 B-11) ──────
//
// Additive to the existing budgetForRange (which sums period_amount/4
// per fiscal week). This function sums per-period budget with day-
// proration on the CURRENT period only - closed periods contribute
// full budget, current period contributes (days_elapsed_through_
// yesterday / days_in_period), future periods contribute nothing.
//
// Sums across ALL purchasing lines that carry a budget in budgetMap
// (any GL - the buckets + the tracked lines both flow through this
// map). Envelope exclusions apply (PURCHASING_ENVELOPE_EXCLUSIONS is
// a named empty set today).
//
// Returns { amount, days_elapsed_current, days_in_current,
//           current_period_no, closed_period_nos }.
// amount is null when no budget exists in the range OR the range
// enumerates zero fiscal weeks.
function parseISOUTC(iso) {
  const m = String(iso || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
const MS_PER_DAY = 86400000;

// Compute for ONE gl_line_code across members - closed-full + current-
// prorated. Returned amount is the sum across the members set.
// Kevin ruling R-63 (2026-09-03): optional `throughISO` overrides the
// proration edge for the current period. When absent, the existing
// days_through_yesterday behavior stands so the Purchasing page keeps
// current semantics. Overview passes throughISO so revenue + cost
// share one window.
function budgetToDateDaysForLine({ budgetMap, glLineCode, members, periodsInRange, today, throughISO }) {
  const perLine = budgetLookup(budgetMap, glLineCode);
  if (!perLine) return { amount: 0, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  const todayD = parseISOUTC(today);
  if (!todayD) return { amount: null, days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  const throughD = throughISO ? parseISOUTC(throughISO) : null;
  let total = 0;
  let anyContribution = false;
  const closed = [];
  let currentPeriodNo = null;
  let daysElapsedCurrent = null;
  let daysInCurrent = null;
  for (const p of periodsInRange) {
    const pStart = parseISOUTC(periodStartISO(p));
    const pEnd = parseISOUTC(periodEndISO(p));
    if (!pStart || !pEnd) continue;
    // Sum across members for this period.
    let periodSum = 0;
    let anyMember = false;
    for (const m of members) {
      if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
      const byAcct = accountLookup(perLine, m);
      if (!byAcct) continue;
      const amt = periodLookup(byAcct, p);
      if (amt == null) continue;
      periodSum += amt;
      anyMember = true;
    }
    if (!anyMember) continue;
    if (pEnd < todayD) {
      if (!closed.includes(p)) closed.push(p);
      total += periodSum;
      anyContribution = true;
    } else if (pStart <= todayD && todayD <= pEnd) {
      currentPeriodNo = p;
      const daysInclusive = Math.floor((pEnd.getTime() - pStart.getTime()) / MS_PER_DAY) + 1;
      daysInCurrent = daysInclusive;
      // R-63: throughISO drives proration when set.
      let daysElapsed;
      if (throughD && throughD >= pStart && throughD <= pEnd) {
        daysElapsed = Math.floor((throughD.getTime() - pStart.getTime()) / MS_PER_DAY) + 1;
      } else if (throughD && throughD < pStart) {
        daysElapsed = 0;
      } else {
        const daysThroughYesterday = Math.max(0, Math.floor((todayD.getTime() - pStart.getTime()) / MS_PER_DAY));
        daysElapsed = Math.min(daysThroughYesterday, daysInclusive);
      }
      daysElapsedCurrent = Math.max(0, Math.min(daysElapsed, daysInclusive));
      total += periodSum * (daysElapsedCurrent / daysInclusive);
      anyContribution = true;
    }
    // future: no contribution
  }
  return {
    amount: anyContribution ? Math.round(total * 100) / 100 : null,
    days_elapsed_current: daysElapsedCurrent,
    days_in_current: daysInCurrent,
    current_period_no: currentPeriodNo,
    closed_period_nos: closed,
  };
}

// Aggregate over every GL in budgetMap that matches the predicate.
// Returns aggregate amount + a single days_* context (they're all the
// same today's calendar - one current period, one closed set).
function budgetToDateDaysForPredicate({ budgetMap, predicate, members, periodsInRange, today, throughISO }) {
  let total = 0;
  let anyLine = false;
  let ctx = { days_elapsed_current: null, days_in_current: null, current_period_no: null, closed_period_nos: [] };
  const keys = typeof budgetMap?.keys === "function"
    ? [...budgetMap.keys()]
    : Object.keys(budgetMap || {});
  for (const gl of keys) {
    if (!predicate(gl)) continue;
    const r = budgetToDateDaysForLine({ budgetMap, glLineCode: gl, members, periodsInRange, today, throughISO });
    if (r.amount != null) {
      total += r.amount;
      anyLine = true;
    }
    // context: keep the first non-null we see (all lines share
    // calendar so this is deterministic).
    if (ctx.current_period_no == null && r.current_period_no != null) {
      ctx = {
        days_elapsed_current: r.days_elapsed_current,
        days_in_current: r.days_in_current,
        current_period_no: r.current_period_no,
        closed_period_nos: r.closed_period_nos,
      };
    } else if (ctx.closed_period_nos.length === 0 && r.closed_period_nos.length > 0) {
      ctx.closed_period_nos = r.closed_period_nos;
    }
  }
  return {
    amount: anyLine ? Math.round(total * 100) / 100 : null,
    ...ctx,
  };
}

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Build the purchasing board rollups from raw route inputs.
 *
 * Pure function.  No I/O.  Same-input-same-output.  Suitable for the
 * Overview page to call server-side without a second HTTP hop, and for
 * the parity probe to call alongside the client folds to prove they
 * agree to the cent.
 *
 * See the module docblock for the contract.
 *
 * @param {Object} args
 * @returns {{ buckets: Object, tracked: Object, totals: Object }}
 */
export function buildPurchasingBoard({
  members,
  start,
  end,
  today,
  throughISO,      // R-63 (Kevin 2026-09-03): Overview passes this so
                   // the buckets_/tracked_ budget-to-date days proration
                   // stops at the same edge as the SC + labor loaders.
                   // Absent -> existing days_through_yesterday behavior.
  actualsRows,     // reserved for future card-level (pending / uncoded)
                   // rollups; the current buckets + tracked contract
                   // consumes weeklyRows + budgetMap only.
  weeklyRows,
  pendingRow,      // reserved for future totals surface; card spend is
                   // never attributed to a bucket (§3.5).
  budgetMap,
}) {
  const weeks = weekStartsInRange(start, end);

  // ─── Buckets: 3200 / 3400 / 3500 ───────────────────────────────────
  const buckets = {};
  for (const { key, gl_prefix } of BUCKET_DEFS) {
    const pred = GL_PREFIX_FOR_BUCKET[key];
    const week_series = seriesForPredicate(weeklyRows, weeks, pred);
    const period_total = sumSeries(week_series);
    const budget = bucketBudgetForRange({ budgetMap, bucketKey: key, members, weeks });
    buckets[gl_prefix] = {
      key,
      gl_prefix,
      period_total,
      week_series,
      budget,
    };
  }

  // ─── Tracked: 5002.1 R&M, 5002.5 Equipment, 5017.3 Perks ───────────
  //
  // Each tracked line is keyed by its full gl_line_code (matches the
  // Overview's "Also tracked" render, which shows the code alongside
  // the label).  The series predicate is an exact-match test on the
  // gl_line_code - same shape the client's ledger cards use.
  const tracked = {};
  for (const lineCode of TRACKED_LINE_CODES) {
    const pred = (gl) => gl === lineCode;
    const week_series = seriesForPredicate(weeklyRows, weeks, pred);
    const period_total = sumSeries(week_series);
    const budget = budgetForRange({ budgetMap, glLineCode: lineCode, members, weeks });
    tracked[lineCode] = {
      line_code: lineCode,
      period_total,
      week_series,
      budget,
    };
  }

  // ─── Totals: portfolio-level rollups ───────────────────────────────
  //
  // buckets_period_total mirrors kpiBudget's population (food +
  // packaging + vehicle = 3200|3400|3500) and matches the KPI period
  // card's hero on the purchasing board.  tracked_* sums the three
  // "Also tracked" line codes; the Overview surfaces this beneath the
  // gross-margin section per §5.4.9 / R-17b.
  let buckets_period_total = 0;
  let buckets_budget = 0;
  for (const gl_prefix of Object.keys(buckets)) {
    buckets_period_total += buckets[gl_prefix].period_total;
    buckets_budget       += buckets[gl_prefix].budget;
  }
  let tracked_period_total = 0;
  let tracked_budget = 0;
  for (const lineCode of Object.keys(tracked)) {
    tracked_period_total += tracked[lineCode].period_total;
    tracked_budget       += tracked[lineCode].budget;
  }

  // Overview Phase 2 PR-3 · §11 B-11 rider (approved by Kevin at
  // Phase 0). New field, additive - `buckets_budget` +
  // `tracked_budget` above stay byte-identical across the PR-3 change
  // per the parity capture. The Overview resolver reads
  // `buckets_budget_to_date_days` + `tracked_budget_to_date_days`;
  // the purchasing board's own surfaces keep reading the range-
  // scoped fields. Rollout for §11 B-11 is Phase 6; this ships
  // the value only.
  //
  // periodsInRange is the set of fiscal periods the range's fiscal
  // weeks touch. Same set the totals blocks above sum against, so
  // day-proration doesn't accidentally include a period outside
  // the requested range.
  const periodsInRange = [...new Set(weeks.map(w => periodOf(w)).filter(p => p != null))].sort((a, b) => a - b);
  const buckets_budget_to_date_days = budgetToDateDaysForPredicate({
    budgetMap,
    predicate: (gl) => (
      GL_PREFIX_FOR_BUCKET.food(gl) ||
      GL_PREFIX_FOR_BUCKET.packaging(gl) ||
      GL_PREFIX_FOR_BUCKET.vehicle(gl)
    ),
    members,
    periodsInRange,
    today: today || null,
    throughISO: throughISO || null,
  });
  const tracked_budget_to_date_days = budgetToDateDaysForPredicate({
    budgetMap,
    predicate: (gl) => TRACKED_LINE_CODES.includes(gl),
    members,
    periodsInRange,
    today: today || null,
    throughISO: throughISO || null,
  });

  return {
    buckets,
    tracked,
    totals: {
      buckets_period_total: Math.round(buckets_period_total * 100) / 100,
      buckets_budget:       Math.round(buckets_budget * 100) / 100,
      tracked_period_total: Math.round(tracked_period_total * 100) / 100,
      tracked_budget:       Math.round(tracked_budget * 100) / 100,
      // Overview Phase 2 PR-3 · §11 B-11 rider
      buckets_budget_to_date_days,
      tracked_budget_to_date_days,
      members:              [...members],
      range:                { start, end },
    },
  };
}
