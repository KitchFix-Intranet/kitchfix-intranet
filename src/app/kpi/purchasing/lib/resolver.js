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
  today,           // reserved - not read by this resolver but kept in
                   // the signature per Kevin's brief; closed-week
                   // accounting is a rendering-layer decision the
                   // Overview seat owns.
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

  return {
    buckets,
    tracked,
    totals: {
      buckets_period_total: Math.round(buckets_period_total * 100) / 100,
      buckets_budget:       Math.round(buckets_budget * 100) / 100,
      tracked_period_total: Math.round(tracked_period_total * 100) / 100,
      tracked_budget:       Math.round(tracked_budget * 100) / 100,
      members:              [...members],
      range:                { start, end },
    },
  };
}
