#!/usr/bin/env node
// C3 unit test for the rolling respread (Kevin 2026-09-16).
// No live data reaches C3 today (closest is TBJ 3100 hourly at 37%
// used with $14k remaining) - Kevin ruling: "Write the clamp anyway,
// and put a unit test on the function with a synthetic negative
// remainder so it is proved before a real period reaches it."
//
// Test surface: src/app/kpi/overview/components/currentPeriodRolling.js
// {rollingOf, summaryFor, invariantCheck}.
//
// Run: node scripts/tests/rolling_c3.test.mjs

import { rollingOf, summaryFor, invariantCheck } from "../../src/app/kpi/overview/components/currentPeriodRolling.js";

let passed = 0, failed = 0;
function assert(cond, name, detail = "") {
  if (cond) { passed++; console.log(`  PASS · ${name}`); }
  else { failed++; console.log(`  FAIL · ${name}${detail ? "\n         " + detail : ""}`); }
}

// C3 synthetic · a labor line that has already blown its whole
// envelope in week 1. Envelope $3,000; landed on the closed week
// $5,000. Remain = 3000 - 5000 = -$2,000. The formula would produce
// negative weekly budgets (dividing -$2,000 across the open weeks
// proportionally); the clamp must catch this and drive open weeks
// to $0.
console.log("\nC3 · envelope already exceeded, remain = -$2,000");
{
  const plan       = [750, 750, 750, 750];
  const landed     = [5000, 0, 0, 0];
  const envelope   = 3000;
  const closedFlags = [true, false, false, false];
  const weekRev    = [4000, 4000, 4000, 4000];
  const r = rollingOf(plan, landed, envelope, closedFlags, weekRev);
  assert(r.isC3 === true, "isC3 flag set");
  assert(r.remain === -2000, `remain is -$2000 (got ${r.remain})`);
  assert(r.rolling[0] === 750, `closed week[0] unchanged at plan (got ${r.rolling[0]})`);
  assert(r.rolling[1] === 0, `open week[1] clamped to 0 (got ${r.rolling[1]})`);
  assert(r.rolling[2] === 0, `open week[2] clamped to 0 (got ${r.rolling[2]})`);
  assert(r.rolling[3] === 0, `open week[3] clamped to 0 (got ${r.rolling[3]})`);
  // The summary card reads "▼ $X over the period · already past the
  // envelope". Total delta = sum(open rolling - open plan)
  //   = (0 - 750) × 3 = -$2,250.
  const s = summaryFor(plan, r.rolling, closedFlags, 1);
  assert(s.trim === true, "summary trim = true (over the envelope)");
  assert(s.totalDelta === -2250, `total open delta = -$2,250 (got ${s.totalDelta})`);
  assert(s.thisWeekDelta === -750, `current week delta = -$750 (got ${s.thisWeekDelta})`);
}

// C1 synthetic · no closed weeks (week 1 is current). rolling ==
// plan on every week; control still enabled; summary reads "nothing
// to redistribute yet".
console.log("\nC1 · no closed weeks");
{
  const plan       = [1000, 1000, 1000, 1000];
  const landed     = [500, 0, 0, 0];
  const envelope   = 4000;
  const closedFlags = [false, false, false, false];
  const weekRev    = [3000, 3000, 3000, 3000];
  const r = rollingOf(plan, landed, envelope, closedFlags, weekRev);
  assert(r.isC1 === true, "isC1 flag set");
  assert(r.rolling[0] === 1000 && r.rolling[3] === 1000, "rolling == plan on every week");
  const s = summaryFor(plan, r.rolling, closedFlags, 0);
  assert(s.totalDelta === 0, `total delta = 0 (got ${s.totalDelta})`);
}

// C2 synthetic · one open week (week 4 current). remain is spread
// entirely across that one week; of-it-this-week equals total.
console.log("\nC2 · one open week");
{
  const plan       = [800, 800, 800, 800];
  const landed     = [700, 850, 900, 0];   // weeks 1-3 closed
  const envelope   = 3200;
  const closedFlags = [true, true, true, false];
  const weekRev    = [3000, 3000, 3000, 3000];
  const r = rollingOf(plan, landed, envelope, closedFlags, weekRev);
  assert(r.isC2 === true, "isC2 flag set (openWeekCount === 1)");
  assert(r.remain === 3200 - (700 + 850 + 900), `remain = 750 (got ${r.remain})`);
  assert(r.rolling[3] === 750, `week 4 absorbs the whole remainder (got ${r.rolling[3]})`);
  const s = summaryFor(plan, r.rolling, closedFlags, 3);
  assert(s.thisWeekDelta === s.totalDelta, "of-it-this-week equals total (one open week)");
}

// Kevin § B invariant seed · TBJ 3100 hourly. Verifies the pure
// function against the render's own numbers.
console.log("\nInvariant · TBJ 3100 hourly (render seed)");
{
  const plan       = [5764, 6646, 5461, 4574];
  const landed     = [8260, 0, 0, 0];         // week 1 closed at $8,260
  const envelope   = 22445;                    // sum of plan
  const closedFlags = [true, false, false, false];
  const weekRev    = [31668, 36519, 30005, 25131];
  const r = rollingOf(plan, landed, envelope, closedFlags, weekRev);
  assert(!r.isC1 && !r.isC2 && !r.isC3, "no edge case flag");
  assert(r.rolling[0] === 5764, `week 1 unchanged (got ${r.rolling[0]})`);
  // Render seed values are 5652 / 4644 / 3889. Allow ±$1 per week
  // rounding.
  assert(Math.abs(r.rolling[1] - 5652) <= 1, `week 2 = 5652 (got ${r.rolling[1]})`);
  assert(Math.abs(r.rolling[2] - 4644) <= 1, `week 3 = 4644 (got ${r.rolling[2]})`);
  assert(Math.abs(r.rolling[3] - 3889) <= 1, `week 4 = 3889 (got ${r.rolling[3]})`);
  const inv = invariantCheck(plan, landed, r.rolling, closedFlags);
  assert(inv.holds, `invariant holds within $1 (openShift=${inv.openShift}, closedVar=${inv.closedVar}, delta=${inv.delta})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
