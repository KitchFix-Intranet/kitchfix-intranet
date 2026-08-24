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
//   R4 span > MAX_DAILY_SPAN_DAYS (31 as of 2026-08-24) -> WEEKLY.
//   M1-M5 calendar-month cap change (raised 21 -> 31 on 2026-08-24):
//      calendar months now land inside the daily path.
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

// ─── R4 span > MAX_DAILY_SPAN_DAYS -> weekly ─────────────────────────
console.log("");
console.log(`[R4] span > MAX_DAILY_SPAN_DAYS (${MAX_DAILY_SPAN_DAYS}) -> weekly (spec cap)`);
{
  // Just over the cap: 32-day partial (Mon 07/06 through Wed 08/05 =
  // 31 days -> daily; +1 day = 32 -> weekly). New cap boundary since
  // the 2026-08-24 raise from 21 to 31.
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-08-06", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",        "32-day range -> weekly (over 31-day cap)");
  eq(r.reason, "span_exceeds_daily_max", "  reason cites span cap");
}
{
  // At the cap: 31-day partial routes to daily (this is the whole
  // point of the raise - calendar months land inside daily now).
  // 2026-07-01 Wed through 2026-07-31 Fri = 31 days.
  const r = resolveRangeSource({ startISO: "2026-07-01", endISO: "2026-07-31", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "31-day range (calendar month July) -> daily");
  eq(r.spanDays, 31,            "  spanDays=31");
  eq(r.reason, "partial_week_post_floor", "  reason daily-path");
}

// ─── M1-M5 calendar-month routing (post 2026-08-24 cap raise) ───────
// M1 is the probe that matters per Kevin: July on CIN - OH must be
// $18,714.03. The routing check here is pure - the arithmetic check
// runs in _probe_month_daily_arithmetic.mjs against Supabase.
// M5 is the guard - whole-week ranges (including 28-day fiscal
// periods) must still route to weekly.
console.log("");
console.log("[M1-M5] calendar-month routing after MAX_DAILY_SPAN_DAYS=31");
{
  // M1 - July (calendar): 07/01 Wed - 07/31 Fri, 31 days.
  const r = resolveRangeSource({ startISO: "2026-07-01", endISO: "2026-07-31", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "M1 July calendar month -> daily");
}
{
  // M2 - June (calendar): 06/01 Mon - 06/30 Tue, 30 days.
  const r = resolveRangeSource({ startISO: "2026-06-01", endISO: "2026-06-30", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "M2 June calendar month -> daily");
  eq(r.spanDays, 30,            "  spanDays=30");
}
{
  // M3 - August (calendar): 08/01 Sat - 08/31 Mon, 31 days. Both
  // ends partial. Post-floor, sits at the cap. Feb picked initially
  // but Feb 2026 is entirely pre-floor -> refusal, wrong shape for
  // this test.
  const r = resolveRangeSource({ startISO: "2026-08-01", endISO: "2026-08-31", dailyFloorISO: FLOOR });
  eq(r.source, "daily",         "M3 Aug calendar month (partial both ends) -> daily");
  eq(r.spanDays, 31,            "  spanDays=31");
}
{
  // M4 - Two calendar months (June + July, 61 days) -> weekly.
  // Calendar months are supported at daily grain; multi-month is not.
  const r = resolveRangeSource({ startISO: "2026-06-01", endISO: "2026-07-31", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",        "M4 two-month span -> weekly (over cap)");
}
{
  // M5a - 28-day whole-week range (four fiscal periods aligned).
  // 2026-07-06 Mon - 2026-08-02 Sun = 28 days, four whole weeks.
  // isWholeWeeks catches this first - MUST still route to weekly
  // regardless of the cap raise. Guard against silent path shift.
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-08-02", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",        "M5a 28-day whole-week fiscal period -> weekly (unchanged)");
  eq(r.reason, "whole_weeks",   "  reason cites whole-week alignment, NOT the span cap");
}
{
  // M5b - 14-day whole-week range: same guard, tighter.
  const r = resolveRangeSource({ startISO: "2026-07-06", endISO: "2026-07-19", dailyFloorISO: FLOOR });
  eq(r.source, "weekly",        "M5b 14-day whole-week range -> weekly (unchanged)");
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

// ─── Route shape assertions - runtime response body ─────────────────
// Owner ruling 2026-08-21: "a grep that follows a refactor is a grep
// that will go stale again. Replace the code-read with a runtime
// assertion on the response body." Prior version grep'd route.js for
// `handleDailyRangeRequest` and its `source: "daily"` literal, both
// of which went stale when the daily handler was refactored to
// delegate to buildDailyRangeBody in src/lib/labor/dailyRangeBody.js.
// The behavior was correct; the probe just couldn't see it any more.
//
// Runtime approach: gated behind PROBE_LIVE_HTTP=1 (matches the H6
// pattern in _probe_kpi_homestand - owner ruling on dev-server
// spin-ups being explicit opt-in after a 20-minute hang cost us
// twice). When unset, prints SKIP so the default `node
// scripts/probes/_probe_range_resolver.mjs` invocation exits on the
// in-process R1..B4 tests without spinning next dev.
console.log("");

if (process.env.PROBE_LIVE_HTTP !== "1") {
  console.log("[route-shape] SKIP - live HTTP requires PROBE_LIVE_HTTP=1 (see block header for why we replaced the code-read)");
  console.log("");
  console.log("=".repeat(72));
  console.log(hardFail === 0 ? "PR-2 RANGE + PRO-RATE: ALL PROBES PASS (route-shape SKIPPED)" : `PR-2 RANGE + PRO-RATE: ${hardFail} FAILURE(S)`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}

console.log("[route-shape] runtime response body: no single response mixes sources");
{
  const { spawn } = await import("node:child_process");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const PORT = process.env.PROBE_PORT || "3101";
  const BASE = `http://localhost:${PORT}`;
  const READY_TIMEOUT_MS = 90000;
  console.log(`  spinning up next dev on :${PORT} with TEST_MODE=true`);
  const proc = spawn("npm", ["run", "dev", "--", "--port", PORT], {
    env: { ...process.env, TEST_MODE: "true", NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrTail = "";
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

  async function waitReady(deadline) {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&start=2026-07-06&end=2026-07-12`, { signal: AbortSignal.timeout(30000) });
        if (r.status === 200 || r.status === 400 || r.status === 500) return true;
      } catch {}
      await sleep(1000);
    }
    return false;
  }

  try {
    const ready = await waitReady(Date.now() + READY_TIMEOUT_MS);
    if (!ready) {
      fail(`dev server did not become ready within ${READY_TIMEOUT_MS}ms`);
      console.log(stderrTail);
    } else {
      // Case 1 - REFUSAL: partial-week range starting before the daily
      // floor (04/20/26). Owner ruling: source=null, refused=true, no
      // data keys leak.
      const refBody = await (await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&start=2026-04-19&end=2026-04-22`)).json();
      if (refBody.source === null && refBody.refused === true && typeof refBody.message === "string") {
        ok("refusal: source=null + refused=true + message present");
      } else {
        fail(`refusal body wrong: source=${refBody.source} refused=${refBody.refused} message=${typeof refBody.message}`);
      }
      const refusalLeaks = ["board", "actuals", "budget_periods", "week_budgets", "actuals_daily", "actuals_range", "budget_prorate"]
        .filter(k => refBody[k] !== undefined);
      if (refusalLeaks.length === 0) ok("refusal body omits all data keys");
      else fail(`refusal body leaks data keys: ${refusalLeaks.join(", ")}`);

      // Case 2 - DAILY: partial-week range entirely post-floor. Owner
      // ruling: source='daily', carries actuals_range + actuals_daily +
      // budget_prorate, no board / budget_periods / week_budgets.
      const dailyBody = await (await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&start=2026-07-09&end=2026-07-12`)).json();
      if (dailyBody.source === "daily") ok("daily: source='daily'");
      else fail(`daily body source wrong: got ${dailyBody.source}`);
      const dailyMissing = ["actuals_range", "actuals_daily", "budget_prorate"]
        .filter(k => dailyBody[k] === undefined);
      if (dailyMissing.length === 0) ok("daily body carries actuals_range + actuals_daily + budget_prorate");
      else fail(`daily body missing keys: ${dailyMissing.join(", ")}`);
      const weeklyLeaksInDaily = ["board", "budget_periods", "week_budgets", "actuals"]
        .filter(k => dailyBody[k] !== undefined);
      if (weeklyLeaksInDaily.length === 0) ok("daily body omits weekly-shape keys (board / budget_periods / week_budgets / actuals)");
      else fail(`daily body leaks weekly-shape keys: ${weeklyLeaksInDaily.join(", ")}`);

      // Case 3 - WEEKLY: whole-week range. Owner ruling: source='weekly',
      // carries board, no actuals_range / actuals_daily / budget_prorate.
      const weeklyBody = await (await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&start=2026-07-06&end=2026-07-12`)).json();
      if (weeklyBody.source === "weekly") ok("weekly: source='weekly'");
      else fail(`weekly body source wrong: got ${weeklyBody.source}`);
      if (weeklyBody.board !== undefined) ok("weekly body carries board");
      else fail("weekly body missing board");
      const dailyLeaksInWeekly = ["actuals_range", "actuals_daily", "budget_prorate"]
        .filter(k => weeklyBody[k] !== undefined);
      if (dailyLeaksInWeekly.length === 0) ok("weekly body omits daily-shape keys (actuals_range / actuals_daily / budget_prorate)");
      else fail(`weekly body leaks daily-shape keys: ${dailyLeaksInWeekly.join(", ")}`);
    }
  } finally {
    try { proc.kill("SIGTERM"); } catch {}
    await sleep(500);
    try { proc.kill("SIGKILL"); } catch {}
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PR-2 RANGE + PRO-RATE: ALL PROBES PASS" : `PR-2 RANGE + PRO-RATE: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
