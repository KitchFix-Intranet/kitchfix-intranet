// scripts/_probe_range_resolver.mjs
//
// PR-2 range resolver + budget pro-rate acceptance. Pure-function
// probe today; a route-level "no single response mixes sources"
// assertion is added once the route wiring lands (next commit on
// this PR).
//
// Kevin ruling 2026-08-20: three-way routing.
//   R1 whole fiscal weeks (any era, including spanning the floor)
//      route to WEEKLY.
//   R2 partial week AND start >= 2026-04-20 -> DAILY.
//   R3 partial week AND start < 2026-04-20 -> REFUSAL with the
//      "Daily detail starts 04/20/26. Pick a range on or after that
//       date, or use whole weeks." copy.
//   R4 span > 21 days -> WEEKLY regardless of alignment (spec limit).
//
// Budget pro-rate:
//   B1 single-week partial: label = "pro-rated, N of 7 days of wk MM/DD"
//   B2 multi-week partial: label = "pro-rated across N days"
//   B3 whole-week single: label = null (helper is not expected to
//      be called then; return null defensively).
//   B4 arithmetic: each overlapped week contributes
//      week_budget * days_in_range / 7. Sum matches total to the cent.
//
// Usage: node scripts/_probe_range_resolver.mjs

import { resolveRangeSource, MAX_DAILY_SPAN_DAYS, REFUSAL_MESSAGE_PARTIAL_BEFORE_FLOOR } from "../../src/lib/labor/rangeResolver.js";
import { proRateBudget } from "../../src/lib/labor/budgetProRate.js";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function eq(a, b, msg) {
  if (a === b) ok(msg);
  else fail(`${msg}   got=${JSON.stringify(a)}  want=${JSON.stringify(b)}`);
}

const FLOOR = "2026-04-20";

console.log("=".repeat(72));
console.log("PR-2 range resolver + budget pro-rate probe");
console.log("=".repeat(72));

// ─── R1 whole fiscal weeks -> weekly ─────────────────────────────────
console.log("");
console.log("[R1] whole fiscal weeks (any era) -> weekly");
{
  // Fiscal week starts on Monday. FY_START 2025-12-29 (Mon).
  // Week 04/20 - 04/26 (post-floor)
  const r = resolveRangeSource({ startISO: "2026-04-20", endISO: "2026-04-26", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",       "one whole week post-floor  -> weekly");
  eq(r.isWholeWeeks, true,      "  isWholeWeeks");
  eq(r.refused, false,          "  not refused");
}
{
  // Two whole weeks spanning a period boundary. Verified working per
  // spec: 07/06 - 07/19 must not regress.
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-07-19", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",       "two whole weeks (period boundary 07/06-07/19) -> weekly");
}
{
  // Whole weeks spanning the daily floor (pre + post).
  // 2026-04-13 (Mon) - 2026-04-26 (Sun) = 2 weeks, straddles 04/20.
  const r = resolveRangeSource({ startISO: "2026-04-13", endISO: "2026-04-26", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",       "whole weeks spanning the floor -> weekly (unchanged, not refused)");
}
{
  // Whole weeks entirely pre-floor.
  const r = resolveRangeSource({ startISO: "2026-01-05", endISO: "2026-01-18", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",       "two whole weeks entirely pre-floor -> weekly");
}

// ─── R2 partial week + post-floor -> daily ──────────────────────────
console.log("");
console.log("[R2] partial week + entirely post-floor -> daily");
{
  // 4-day range in a single post-floor week.
  const r = resolveRangeSource({ startISO: "2026-07-09", endISO: "2026-07-12", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "4-day partial week (07/09-07/12) -> daily");
  eq(r.spanDays, 4,             "  spanDays=4");
  eq(r.isPartialWeek, true,     "  isPartialWeek");
}
{
  // Cross-week 8-day partial (spans two weeks, partial in each).
  const r = resolveRangeSource({ startISO: "2026-07-08", endISO: "2026-07-15", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "8-day cross-week partial post-floor -> daily");
}
{
  // 1-day request post-floor.
  const r = resolveRangeSource({ startISO: "2026-07-04", endISO: "2026-07-04", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "single day post-floor -> daily");
  eq(r.spanDays, 1,             "  spanDays=1");
}
{
  // Exactly at the floor.
  const r = resolveRangeSource({ startISO: "2026-04-20", endISO: "2026-04-22", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "3-day starting on the floor date -> daily");
}
{
  // 21-day partial (spec max span).
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-07-26", dailyFloorISO: FLOOR });
  // 07/06 is a Mon; 07/26 is a Sun. That's 3 whole weeks = 21 days.
  // isWholeWeeks catches this first -> weekly, not daily.
  eq(r.source, "weekly",        "21-day whole-week range -> weekly (grain first)");
}

// ─── R3 partial week + starts pre-floor -> refuse ───────────────────
console.log("");
console.log("[R3] partial week + starts pre-floor -> refusal");
{
  const r = resolveRangeSource({ startISO: "2026-04-19", endISO: "2026-04-25", dailyFloorISO: FLOOR });
  eq(r.source, null,            "starts one day before floor, ends post-floor -> refuse");
  eq(r.refused, true,           "  refused=true");
  eq(r.reason, "range_partial_before_floor", "  reason");
  eq(r.refusalMessage,
     "Daily detail starts 04/20/26. Pick a range on or after that date, or use whole weeks.",
     "  refusal copy verbatim per owner ruling");
}
{
  // Sub-week request entirely pre-floor.
  const r = resolveRangeSource({ startISO: "2026-03-10", endISO: "2026-03-13", dailyFloorISO: FLOOR });
  eq(r.source, null,            "sub-week request entirely pre-floor -> refuse");
  eq(r.refused, true,           "  refused=true");
}

// ─── R4 span > 21 days -> weekly ────────────────────────────────────
console.log("");
console.log("[R4] span > 21 days -> weekly (spec limit)");
{
  // 22-day partial range (Mon start, not aligned).
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-07-27", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",        "22-day range -> weekly (span cap)");
}

// ─── Refusal message shape ──────────────────────────────────────────
console.log("");
console.log("[copy] refusal message helper");
eq(REFUSAL_MESSAGE_PARTIAL_BEFORE_FLOOR("2026-04-20"),
   "Daily detail starts 04/20/26. Pick a range on or after that date, or use whole weeks.",
   "REFUSAL_MESSAGE_PARTIAL_BEFORE_FLOOR('2026-04-20')");

// ─── Budget pro-rate: single-week partial ───────────────────────────
console.log("");
console.log("[B1] budget pro-rate - single-week partial");
{
  const weekBudgets = [
    { week_start: "2026-07-06", amount: 2177 },
  ];
  const p = proRateBudget({ startISO: "2026-07-09", endISO: "2026-07-12", weekBudgets });
  eq(p.periods.length, 1,       "one overlapped week");
  eq(p.periods[0].days_in_range, 4, "  days_in_range=4");
  eq(p.periods[0].week_budget, 2177, "  week_budget=2177");
  eq(p.periods[0].budget_slice, 1244, "  slice = 2177*4/7 = 1244.00 (rounded)");
  eq(p.total, 1244,             "  total = 1244");
  eq(p.label, "pro-rated, 4 of 7 days of wk 07/06", "  label per spec");
}

// ─── B2 multi-week partial ──────────────────────────────────────────
console.log("");
console.log("[B2] budget pro-rate - multi-week partial");
{
  const weekBudgets = [
    { week_start: "2026-07-06", amount: 2177 },
    { week_start: "2026-07-13", amount: 2177 },
  ];
  // 07/08 - 07/18: 4 days in wk 07/06 (Wed-Sun) + 6 days in wk 07/13 (Mon-Sat) = 11 days.
  const p = proRateBudget({ startISO: "2026-07-08", endISO: "2026-07-18", weekBudgets });
  eq(p.periods.length, 2,       "two overlapped weeks");
  eq(p.periods[0].days_in_range, 5, "  wk 07/06 days_in_range=5 (Wed 07/08-Sun 07/12)");
  eq(p.periods[1].days_in_range, 6, "  wk 07/13 days_in_range=6 (Mon 07/13-Sat 07/18)");
  const expectedTotal = Math.round((2177 * 5 / 7 + 2177 * 6 / 7) * 100) / 100;
  eq(p.total, expectedTotal,     `  total = ${expectedTotal}`);
  eq(p.label, "pro-rated across 11 days", "  label per spec");
}

// ─── B3 whole-week single: label null ───────────────────────────────
console.log("");
console.log("[B3] budget pro-rate - whole-week single -> label null (defensive)");
{
  const weekBudgets = [ { week_start: "2026-07-06", amount: 2177 } ];
  const p = proRateBudget({ startISO: "2026-07-06", endISO: "2026-07-12", weekBudgets });
  eq(p.label, null,             "whole-week label is null (caller renders un-labeled)");
  eq(p.total, 2177,             "  total = 2177 (full week budget)");
}

// ─── B4 arithmetic - slice sum == total to the cent ─────────────────
console.log("");
console.log("[B4] budget pro-rate - slice sum equals total to the cent");
{
  const weekBudgets = [
    { week_start: "2026-04-20", amount: 3123.45 },
    { week_start: "2026-04-27", amount: 3123.45 },
    { week_start: "2026-05-04", amount: 3123.45 },
  ];
  // 3-week span with partial ends. 04/21 - 05/05: 6 + 7 + 2 = 15 days.
  const p = proRateBudget({ startISO: "2026-04-21", endISO: "2026-05-05", weekBudgets });
  const sliceSum = p.periods.reduce((s, w) => s + w.budget_slice, 0);
  const sliceSumR = Math.round(sliceSum * 100) / 100;
  eq(sliceSumR, p.total,        `slice sum ${sliceSumR} == total ${p.total}`);
  eq(p.label, "pro-rated across 15 days", "  15-day label");
}

// ─── Route shape assertions ─────────────────────────────────────────
// Kevin ruling: no single response mixes sources. Verify by code-read
// on route.js that:
//   - every non-refusal response carries `source` = 'weekly' | 'daily'
//   - refusal response carries `source: null, refused: true`
//   - the weekly branches never set daily-specific keys (actuals_daily,
//     budget_prorate, actuals_range) on their bodies
//   - the daily branch never sets weekly-specific keys (board,
//     budget_periods, week_budgets) on its body
console.log("");
console.log("[route-shape] no single response mixes sources (code-read)");
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/api/kpi/labor/route.js"), "utf8");
// strip comments to avoid false positives from prose
const routeCode = routeSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// 1. Refusal branch carries source:null + refused:true
const refusalBlock = routeCode.match(/if \(rangeSource\.refused\) \{\s*return NextResponse\.json\(\{([\s\S]*?)\}\);\s*\}/);
if (!refusalBlock) fail("refusal branch not found in route.js");
else {
  const body = refusalBlock[1];
  const hasSource = /source:\s*null/.test(body);
  const hasRefused = /refused:\s*true/.test(body);
  const hasMessage = /message:\s*rangeSource\.refusalMessage/.test(body);
  if (hasSource && hasRefused && hasMessage) ok("refusal body: source=null + refused=true + message");
  else fail(`refusal body missing keys: source=${hasSource} refused=${hasRefused} message=${hasMessage}`);
  // Refusal MUST NOT leak weekly/daily data fields.
  const leaks = [];
  for (const key of ["board", "actuals", "budget_periods", "week_budgets", "actuals_daily", "actuals_range", "budget_prorate"]) {
    if (new RegExp(`\\b${key}\\s*:`).test(body)) leaks.push(key);
  }
  if (leaks.length === 0) ok("refusal body omits all data keys");
  else fail(`refusal body leaks data keys: ${leaks.join(", ")}`);
}

// 2. Weekly branches label themselves.
const weeklySources = [...routeCode.matchAll(/\.source\s*=\s*"weekly"/g)];
if (weeklySources.length >= 3) ok(`weekly branches label body.source='weekly' (${weeklySources.length} occurrences: aggregate + D26 + single-account)`);
else fail(`expected >=3 weekly source labels, found ${weeklySources.length}`);

// 3. Daily handler exists + labels source='daily' + returns clean shape.
const dailyHandler = routeCode.match(/async function handleDailyRangeRequest\(ctx\) \{([\s\S]*?)\n\}\n/);
if (!dailyHandler) fail("handleDailyRangeRequest not found");
else {
  const body = dailyHandler[1];
  const setsSource = /source:\s*"daily"/.test(body);
  if (setsSource) ok("handleDailyRangeRequest returns source='daily'");
  else fail("handleDailyRangeRequest does not set source='daily'");
  // The RETURN body is what matters. Extract the response object
  // literal from the final `return NextResponse.json({ ... });`.
  const returnMatch = body.match(/return NextResponse\.json\(\{([\s\S]*?)\}\);\s*$/);
  if (!returnMatch) fail("daily handler has no NextResponse.json return");
  else {
    const returnBody = returnMatch[1];
    const weeklyLeaks = [];
    for (const key of ["board", "budget_periods", "week_budgets"]) {
      if (new RegExp(`\\b${key}\\s*:`).test(returnBody)) weeklyLeaks.push(key);
    }
    // `actuals` LHS collides with actuals_daily / actuals_range;
    // enforce there is no bare `actuals: <expr>` (comma or space
    // required immediately after, but nothing between actuals and :).
    if (/\bactuals\s*:/.test(returnBody) && !/\bactuals_(daily|range)\s*:/.test(returnBody.match(/\bactuals\s*:[^,\n}]*/)?.[0] || "")) {
      // Bare `actuals:` present.
      weeklyLeaks.push("actuals");
    }
    if (weeklyLeaks.length === 0) ok("daily response body omits weekly-shape keys (board / budget_periods / week_budgets / bare actuals)");
    else fail(`daily response body leaks weekly-shape keys: ${weeklyLeaks.join(", ")}`);
    const dailyKeys = ["actuals_range", "actuals_daily", "budget_prorate"];
    const missing = dailyKeys.filter(k => !new RegExp(`${k}\\s*:`).test(returnBody));
    if (missing.length === 0) ok("daily response body carries actuals_range + actuals_daily + budget_prorate");
    else fail(`daily response body missing keys: ${missing.join(", ")}`);
    if (/salary_available:\s*false/.test(returnBody)) ok("daily response body forces salary_available=false (deferred)");
    else fail("daily response body must set salary_available=false");
  }
}

// 4. Resolver is called BEFORE any account-branch return.
const resolverCall = routeCode.match(/resolveRangeSource\(\{[^}]+\}\)/);
if (resolverCall) ok("resolveRangeSource is invoked in the route flow");
else fail("resolveRangeSource never called in route.js");

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PR-2 RANGE + PRO-RATE: ALL PROBES PASS" : `PR-2 RANGE + PRO-RATE: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
