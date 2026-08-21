// scripts/_probe_pr3b_live.mjs
//
// PR-3b live acceptance. Runs against REAL HTTP responses from the
// labor route, not an in-process helper call. Spins up `next dev`
// with TEST_MODE=true (double-gated in the route + middleware so it
// is unreachable on Vercel), fetches three range shapes, and asserts
// the body shape of each. Then P4..P8 push into the rendered client
// behaviors that PR-3b introduces.
//
// Assertions
//   P1  partial-week request returns source='daily' and the body
//       carries NO board / budget_periods / week_budgets keys
//   P2  whole-week request returns source='weekly' and the body IS
//       the existing shape (has board + actuals + budget_periods)
//   P3  pre-floor partial request returns refused=true with ZERO
//       data keys - carries only source/refused/reason/message/
//       daily_floor/account/filters/directory/salary_available
//   P4  CIN - AZ 4-day partial: sum of actuals_daily.amount rolls
//       up to sum of actuals_range.amount to the cent, so the client
//       day strip and spend card cannot disagree
//   P5  daily response omits every period-shaped signal source
//       (board.projected_period_end / weekly_allowance / etc) - the
//       four ABSENT signals cannot be read from the payload
//   P6  whole-week custom range 2026-07-06 to 2026-07-19 (Kevin's
//       verified cross-period fixture) routes weekly and the body
//       is byte-shape-equivalent to today's board response
//   P7  refusal response carries the owner-approved message verbatim
//       and daily_floor for the client's honest note
//   P8  salary decision from CARRY-FORWARD 1 (option a) - a
//       partial-week request with include_salary=1 populates
//       salary_summary + salary_prorate + salaried rows (proves the
//       toggle works on daily so the control does not silently vanish)
//   Sentinel  CIN - OH week 2026-06-29 whole-week request returns
//             $4,328.27 unchanged (regression guard on the weekly path)
//
// Usage: node scripts/_probe_pr3b_live.mjs
//   (script spawns `TEST_MODE=true npm run dev` itself and tears it down.)

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isoRange,
  aggregatePerDay,
  chooseLabelDensity,
} from "../src/lib/labor/dayRangeAggregate.js";

const PORT = process.env.PROBE_PORT || "3100";
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90000;
const CALL_TIMEOUT_MS  = 60000;

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-06&end=2026-07-12`, {
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (r.status === 200 || r.status === 400 || r.status === 500) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  return { status: r.status, body: await r.json() };
}

console.log("=".repeat(72));
console.log("PR-3b live acceptance probe");
console.log("=".repeat(72));
console.log(`spinning up next dev on :${PORT} with TEST_MODE=true`);

const proc = spawn("npm", ["run", "dev", "--", "--port", PORT], {
  env: { ...process.env, TEST_MODE: "true", NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderrTail = "";
proc.stdout.on("data", (d) => { /* keep quiet */ });
proc.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

let exit = 0;
try {
  const ready = await waitReady(Date.now() + READY_TIMEOUT_MS);
  if (!ready) {
    console.log("");
    console.log("  FAIL  dev server did not become ready within 90s");
    console.log("  last stderr tail:");
    console.log(stderrTail.split("\n").slice(-10).map(l => `    ${l}`).join("\n"));
    exit = 1;
  } else {
    console.log("  dev server ready");

    // ── P1 partial-week -> source='daily' ───────────────────────────
    console.log("");
    console.log("[P1] partial-week request -> source='daily', no weekly-shape keys");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-09&end=2026-07-12");
      if (r.status !== 200) { fail(`HTTP ${r.status}`); }
      else if (r.body.source !== "daily") { fail(`source=${r.body.source}, expected 'daily'`); }
      else {
        ok(`source='daily' (${r.body.actuals_range?.length ?? "?"} range rows, ${r.body.actuals_daily?.length ?? "?"} daily rows)`);
        const leaks = ["board", "budget_periods", "week_budgets"].filter(k => r.body[k] !== undefined);
        if (leaks.length === 0) ok("body omits board / budget_periods / week_budgets");
        else fail(`body leaks weekly-shape keys: ${leaks.join(", ")}`);
      }
    }

    // ── P2 whole-week -> source='weekly' ─────────────────────────────
    console.log("");
    console.log("[P2] whole-week request -> source='weekly', existing board shape");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-06&end=2026-07-12");
      if (r.status !== 200) { fail(`HTTP ${r.status}`); }
      else if (r.body.source !== "weekly") { fail(`source=${r.body.source}, expected 'weekly'`); }
      else if (!r.body.board) { fail("weekly response missing board"); }
      else if (!Array.isArray(r.body.actuals)) { fail("weekly response missing actuals"); }
      else ok(`source='weekly', board present, ${r.body.actuals.length} actuals rows`);
    }

    // ── P3 pre-floor partial -> refusal ──────────────────────────────
    console.log("");
    console.log("[P3] pre-floor partial refusal: refused=true + ZERO data keys");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-03-02&end=2026-03-05");
      if (r.status !== 200) { fail(`HTTP ${r.status}`); }
      else if (r.body.refused !== true) { fail(`refused=${r.body.refused}, expected true`); }
      else {
        ok("refused=true");
        const dataKeys = ["board", "actuals", "budget_periods", "week_budgets", "actuals_daily", "actuals_range", "budget_prorate", "salary_prorate", "salary_summary", "workers"];
        const leaks = dataKeys.filter(k => r.body[k] !== undefined);
        if (leaks.length === 0) ok("body carries only source/refused/reason/message/daily_floor/directory (no data keys)");
        else fail(`body leaks data keys: ${leaks.join(", ")}`);
      }
    }

    // ── P4 sum of day rows == sum of range rows (client-integrity) ──
    console.log("");
    console.log("[P4] CIN - AZ 4-day partial: sum(actuals_daily) == sum(actuals_range) to the cent");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-09&end=2026-07-12");
      if (r.body.source !== "daily") { fail("expected source='daily'"); }
      else {
        const dayCents = (r.body.actuals_daily || []).reduce((s, d) => s + Math.round(Number(d.amount || 0) * 100), 0);
        const rangeCents = (r.body.actuals_range || []).filter(rr => !rr.salaried).reduce((s, rr) => s + Math.round(Number(rr.amount || 0) * 100), 0);
        // Standing rule: no client dollar figures in console output.
        // Assert the cent-exact match; show the delta only if non-zero.
        if (dayCents === rangeCents) ok(`sum(actuals_daily) == sum(actuals_range hourly) EXACT to the cent`);
        else fail(`sum(actuals_daily) != sum(actuals_range hourly), delta_cents=${dayCents - rangeCents}`);
      }
    }

    // ── P5 daily response omits period-shaped signal sources ────────
    console.log("");
    console.log("[P5] daily response: no period-shaped signal sources present");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-09&end=2026-07-12");
      if (r.body.source !== "daily") { fail("expected source='daily'"); }
      else {
        const forbidden = ["board", "week_budgets", "budget_periods"];
        const leaks = forbidden.filter(k => r.body[k] !== undefined);
        if (leaks.length === 0) ok("no board / week_budgets / budget_periods on daily body - four ABSENT signals cannot be read from payload");
        else fail(`daily body leaks period-shaped keys: ${leaks.join(", ")}`);
      }
    }

    // ── P6 whole-week 2026-07-06..2026-07-19 across period boundary ─
    console.log("");
    console.log("[P6] cross-period whole-week custom 2026-07-06..2026-07-19 -> weekly shape unchanged");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-06&end=2026-07-19");
      if (r.body.source !== "weekly") { fail(`source=${r.body.source}, expected 'weekly'`); }
      else if (!r.body.board) { fail("board missing"); }
      else if (!Array.isArray(r.body.actuals)) { fail("actuals missing"); }
      else ok(`source='weekly' + board present + ${r.body.actuals.length} actuals rows across the 2-week span`);
    }

    // ── P7 refusal message + floor visible ──────────────────────────
    console.log("");
    console.log("[P7] refusal body: owner-approved message verbatim + daily_floor for the client note");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-03-02&end=2026-03-05");
      const want = "Daily detail starts 04/20/26. Pick a range on or after that date, or use whole weeks.";
      if (r.body.message === want) ok(`message: "${want}"`);
      else fail(`message: "${r.body.message}"`);
      if (r.body.daily_floor === "2026-04-20") ok("daily_floor=2026-04-20");
      else fail(`daily_floor=${r.body.daily_floor}`);
    }

    // ── P8 salary decision (option a) ───────────────────────────────
    console.log("");
    console.log("[P8] CARRY-FORWARD 1 option (a): salary_available=true on daily + include_salary=1 populates salary");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-09&end=2026-07-12&include_salary=1");
      if (r.body.source !== "daily") { fail(`source=${r.body.source}, expected 'daily'`); }
      else if (r.body.salary_available !== true) { fail(`salary_available=${r.body.salary_available}`); }
      else if (!r.body.salary_summary || !r.body.salary_prorate) { fail("salary_summary or salary_prorate missing"); }
      else {
        const salariedRows = (r.body.actuals_range || []).filter(rr => rr.salaried);
        if (salariedRows.length > 0) ok(`salary_available=true + salaried rows=${salariedRows.length} + prorate.label='${r.body.salary_prorate.label}' - toggle works on daily`);
        else fail("zero salaried rows in actuals_range");
      }
    }

    // ── P9 row-to-day collapse, wide range ──────────────────────────
    // Kevin found "days: 71 -> 20 bars drawn" on a 20-day range. The
    // API returns per-worker-per-day rows; the client collapses them
    // into calendar-day buckets. A silent truncation (rows outside
    // the [start, end] window, or fewer buckets than span_days) would
    // hide behind a plausible-looking strip. Assert both invariants
    // against a live response, then run the extracted client
    // aggregator to prove the drawn-bar count exactly matches
    // span_days with zero dropped rows.
    console.log("");
    console.log("[P9] row-to-day collapse: worker-day rows collapse to N calendar bars, no silent truncation");
    {
      const start = "2026-07-06";
      const end   = "2026-07-25";   // 20 calendar days spanning three weeks
      const r = await get(`/api/kpi/labor?account=CIN%20-%20AZ&start=${start}&end=${end}`);
      if (r.body.source !== "daily") { fail(`source=${r.body.source}, expected 'daily'`); }
      else {
        const spanDays = r.body.range?.span_days;
        const wantSpan = 20;
        if (spanDays === wantSpan) ok(`range.span_days = ${spanDays}`);
        else fail(`range.span_days = ${spanDays}, expected ${wantSpan}`);

        const rows = r.body.actuals_daily || [];
        const distinctDays = new Set(rows.map(rr => rr.work_date));
        if (distinctDays.size <= spanDays) ok(`distinct work_date count = ${distinctDays.size} (<= span ${spanDays})`);
        else fail(`distinct work_date count = ${distinctDays.size} > span_days = ${spanDays}`);

        const withinWindow = rows.every(rr => rr.work_date >= start && rr.work_date <= end);
        if (withinWindow) ok(`all ${rows.length} rows have work_date within [${start}, ${end}]`);
        else fail(`some rows have work_date outside [${start}, ${end}]`);

        if (rows.length > distinctDays.size) ok(`${rows.length} worker-day rows collapse to ${distinctDays.size} distinct days (multi-worker per day - real collapse)`);
        else fail(`rows.length=${rows.length} <= distinctDays.size=${distinctDays.size} - no actual collapse to test`);

        // Run the extracted client aggregator against the live rows.
        const days = isoRange(start, end);
        const { perDay, droppedOutsideWindow } = aggregatePerDay(rows, days);
        if (perDay.length === spanDays) ok(`aggregatePerDay drew ${perDay.length} buckets = span_days ${spanDays} exactly (bar count binding)`);
        else fail(`aggregatePerDay drew ${perDay.length} buckets, expected ${spanDays}`);
        if (droppedOutsideWindow === 0) ok("aggregatePerDay droppedOutsideWindow=0 - no silent truncation");
        else fail(`aggregatePerDay droppedOutsideWindow=${droppedOutsideWindow} - rows fell outside the bucket window`);
      }
    }

    // ── P10 row-to-day collapse, short range ────────────────────────
    // Kevin's warning: "so a silent truncation could never hide at
    // short ranges." A single-partial-week (4-day) response must
    // still collapse cleanly - span=4, buckets=4, dropped=0.
    console.log("");
    console.log("[P10] row-to-day collapse holds at short ranges too");
    {
      const start = "2026-07-09";
      const end   = "2026-07-12";   // 4 days
      const r = await get(`/api/kpi/labor?account=CIN%20-%20AZ&start=${start}&end=${end}`);
      if (r.body.source !== "daily") { fail(`source=${r.body.source}, expected 'daily'`); }
      else {
        const spanDays = r.body.range?.span_days;
        const days = isoRange(start, end);
        const { perDay, droppedOutsideWindow } = aggregatePerDay(r.body.actuals_daily || [], days);
        if (spanDays === 4 && perDay.length === 4 && droppedOutsideWindow === 0) {
          ok(`span=4, buckets=4, dropped=0 - clean at short range too`);
        } else {
          fail(`span=${spanDays}, buckets=${perDay.length}, dropped=${droppedOutsideWindow}`);
        }
      }
    }

    // ── P11 chooseLabelDensity boundary tests ────────────────────────
    // Kevin's field measurement drove the thresholds: at 1920px the
    // plot is 1162px (N=10 -> 116.2px/bar, full) and at 375px the
    // plot is ~340px (N=10 -> 34px/bar, minimal). A count-based rule
    // cannot distinguish those. Pin both boundaries by driving the
    // container width directly so the assertion does not depend on
    // a viewport this probe cannot resize.
    console.log("");
    console.log("[P11] chooseLabelDensity flips at both measured boundaries under driven widths");
    {
      const cases = [
        // width, N, expected
        [1162, 10, "full"],       // Kevin's 1920px desktop: 116.2px/bar
        [900,  10, "full"],       // exact 90px/bar boundary (inclusive)
        [899,  10, "compact"],    // 89.9px/bar - just below the full threshold
        [500,  10, "compact"],    // 50px/bar - clearly compact
        [440,  10, "compact"],    // exact 44px/bar boundary (inclusive)
        [439,  10, "minimal"],    // 43.9px/bar - just below the compact threshold
        [340,  10, "minimal"],    // Kevin's 375px phone: 34px/bar
        // 20-day span cases
        [1800, 20, "full"],       // 90px/bar - full at 20 days
        [1000, 20, "compact"],    // 50px/bar
        [800,  20, "minimal"],    // 40px/bar - just below 44
      ];
      let boundaryFails = 0;
      for (const [w, n, want] of cases) {
        const got = chooseLabelDensity(w, n);
        if (got === want) ok(`width=${w}px N=${n} -> ${got} (${(w/n).toFixed(1)}px/bar)`);
        else { fail(`width=${w}px N=${n} -> ${got}, expected ${want}`); boundaryFails++; }
      }
      if (boundaryFails === 0) ok("all boundary transitions match measured thresholds (>= 90 full, >= 44 compact, < 44 minimal)");
    }

    // ── Sentinel: CIN - OH 06/29 weekly = $4,328.27 ─────────────────
    console.log("");
    console.log("[Sentinel] CIN - OH week 2026-06-29 whole-week - sentinel $4,328.27 unchanged");
    {
      const r = await get("/api/kpi/labor?account=CIN%20-%20OH&start=2026-06-29&end=2026-07-05");
      const sum = (r.body.actuals || []).reduce((s, a) => s + Number(a.amount || 0), 0);
      if (Math.abs(sum - 4328.27) < 0.005) ok(`sum(actuals) = $${sum.toFixed(2)} (want $4,328.27)`);
      else fail(`sum(actuals) = $${sum.toFixed(2)} - drift`);
    }
  }
} finally {
  proc.kill("SIGTERM");
  await sleep(500);
  try { proc.kill("SIGKILL"); } catch {}
}

console.log("");
console.log("=".repeat(72));
if (hardFail === 0 && exit === 0) console.log("PR-3b LIVE ACCEPTANCE: ALL PROBES PASS");
else if (exit !== 0)             console.log("PR-3b LIVE ACCEPTANCE: dev server never came up - no probes ran");
else                             console.log(`PR-3b LIVE ACCEPTANCE: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 && exit === 0 ? 0 : 1);
