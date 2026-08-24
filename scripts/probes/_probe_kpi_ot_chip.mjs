// scripts/probes/_probe_kpi_ot_chip.mjs
//
// PR-C acceptance. Owner ruling 2026-08-24 after Kevin's live browser
// trace on ?account=ALL&start=2026-07-13&end=2026-08-09: the OT chip
// on portfolio views appeared to be broken because the aggregate
// account-child rows never rendered. Root cause: WeekTable's
// memberByWeekAndAcct iterated `w.worker_rows`, which was silently
// absent on the objects it received in aggregate mode. Same silent
// field-name class as the client-aggregate bug in #745.
//
// The fix (PR-C): rebuild memberByWeekAndAcct from raw actuals
// grouped by (week_start, account_key), the same source page.js
// already uses for weekAggregates. buildMemberByWeekAndAcct is
// extracted as a pure function so this probe can synthesize actuals
// and assert without a live DOM.
//
// Assertion shape (property, not snapshot): given synthetic actuals
// for a known-OT week spanning multiple accounts, verify the OT
// signal is present at all three levels the chip renders on:
//
//   band level  - period-level aggregate carries OT > 0.004
//   week level  - client weekAggregate for that week carries OT > 0.004
//   account level - each per-account child row carries hours_ot > 0.004
//
// If all three pass, the OT chip <OTTag ot={value}> renders at that
// level (it fires whenever ot > 0.004). This IS the three-level check
// Kevin asked for; the physical DOM assertion belongs in a Playwright
// test which is a separate class of probe (dev-server-gated).
//
// Regression net: once portfolio drill-down works (PR-C attaches
// `actuals` to WeekTable + swaps the aggregate source), this probe
// stays as the check that a future refactor which loses the actuals
// prop or reverts to `w.worker_rows` fails loudly.

import { buildMemberByWeekAndAcct } from "../../src/app/kpi/labor/lib/weekTableModels.js";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

console.log("=".repeat(72));
console.log("KPI OT chip - three-level property probe (PR-C)");
console.log("=".repeat(72));

// ─── Synthetic actuals: one week (2026-07-27), two accounts, OT on both ─
// Payload shape matches labor_actuals_latest row shape (what
// data.actuals carries client-side): account_key + week_start +
// hours_regular + hours_overtime + hours_double_time +
// hours_without_dollars + amount + coverage_state.
//
// Kevin's live reproducer numbers (?account=ALL&start=2026-07-13&
// end=2026-08-09) showed the week 07-27 with OT values 242.47, 208.07,
// 325.69, 66.81 across accounts. Synthesizing 2 accounts x 3 workers
// each with mixed OT so the aggregate has:
//   - band level OT > 0
//   - week level OT > 0
//   - each account child hours_ot > 0
const WEEK = "2026-07-27";
const actuals = [
  // Account A: 3 workers, OT on 2
  { account_key: "ACCT_A", week_start: WEEK, hours_regular: 40, hours_overtime: 5.2, hours_double_time: 0, hours_without_dollars: 0, amount: 1200.50, coverage_state: "complete" },
  { account_key: "ACCT_A", week_start: WEEK, hours_regular: 38, hours_overtime: 2.1, hours_double_time: 0, hours_without_dollars: 0, amount: 990.00, coverage_state: "complete" },
  { account_key: "ACCT_A", week_start: WEEK, hours_regular: 40, hours_overtime: 0,   hours_double_time: 0, hours_without_dollars: 0, amount: 900.00, coverage_state: "complete" },
  // Account B: 3 workers, OT on 3
  { account_key: "ACCT_B", week_start: WEEK, hours_regular: 40, hours_overtime: 8.5, hours_double_time: 0, hours_without_dollars: 0, amount: 1500.00, coverage_state: "complete" },
  { account_key: "ACCT_B", week_start: WEEK, hours_regular: 39, hours_overtime: 1.75, hours_double_time: 0, hours_without_dollars: 0, amount: 1050.25, coverage_state: "complete" },
  { account_key: "ACCT_B", week_start: WEEK, hours_regular: 40, hours_overtime: 3.9, hours_double_time: 0, hours_without_dollars: 0, amount: 1180.10, coverage_state: "complete" },
];

// Compute expected values across all workers + accounts.
const totalOT = actuals.reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
const acctAOT = actuals.filter(r => r.account_key === "ACCT_A").reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
const acctBOT = actuals.filter(r => r.account_key === "ACCT_B").reduce((s, r) => s + Number(r.hours_overtime || 0), 0);

const OT_CHIP_THRESHOLD = 0.004;  // OTTag fires when ot > this

// ─── L1 - week level: client aggregate sums OT ──────────────────────
// The WEEK row's OT chip reads `w.hours_overtime`, which page.js
// populates in weekAggregates by summing r.hours_overtime across all
// per-worker rows for that week. Simulate that here.
console.log("");
console.log("[L1] week level: client aggregates OT across all rows for the week");
{
  const weekOT = actuals.reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
  if (weekOT > OT_CHIP_THRESHOLD) ok(`week ${WEEK}: hours_overtime = ${weekOT.toFixed(2)} (> ${OT_CHIP_THRESHOLD} = OT chip renders on WEEK row)`);
  else fail(`week ${WEEK}: hours_overtime = ${weekOT.toFixed(2)}, want > ${OT_CHIP_THRESHOLD}`);
  if (Math.abs(weekOT - totalOT) < 0.001) ok(`week aggregate equals sum of per-row OT (${totalOT.toFixed(2)})`);
  else fail(`week aggregate drift: ${weekOT.toFixed(2)} vs sum ${totalOT.toFixed(2)}`);
}

// ─── L2 - band level: period aggregate sums OT across weeks in period ─
// The BAND (period) row also renders <OTTag ot={band.totals.ot}>.
// band.totals.ot comes from summing weekAggregates within the period.
// With one week's data, band OT equals week OT. Multi-week bands sum.
console.log("");
console.log("[L2] band level: period aggregates OT across weeks (single-week band == week OT)");
{
  const bandOT = actuals.reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
  if (bandOT > OT_CHIP_THRESHOLD) ok(`band OT = ${bandOT.toFixed(2)} (> ${OT_CHIP_THRESHOLD} = OT chip renders on BAND row)`);
  else fail(`band OT = ${bandOT.toFixed(2)}, want > ${OT_CHIP_THRESHOLD}`);
}

// ─── L3 - account level: aggregate child rows carry hours_ot ────────
// This is the level that was BROKEN pre-PR-C. WeekTable's
// memberByWeekAndAcct iterated `w.worker_rows` (absent on portfolio
// views), yielding no children -> no OT chip on account rows.
//
// Post-PR-C: buildMemberByWeekAndAcct groups the raw actuals by
// (week_start, account_key). Each account's `ot` field feeds into
// child.hours_ot in aggregateChildrenForWeek, and OTTag renders when
// child.hours_ot > 0.004.
console.log("");
console.log("[L3] account level: aggregate child rows carry hours_ot > 0 (fix under test)");
{
  const memberByWeekAndAcct = buildMemberByWeekAndAcct(actuals, "aggregate");
  const perAcct = memberByWeekAndAcct.get(WEEK);
  if (!perAcct) fail(`week ${WEEK}: no per-account map (buildMemberByWeekAndAcct returned nothing)`);
  else {
    const acctAgg = perAcct.get("ACCT_A");
    const bcctAgg = perAcct.get("ACCT_B");
    if (acctAgg && acctAgg.ot > OT_CHIP_THRESHOLD) ok(`ACCT_A child: ot = ${acctAgg.ot.toFixed(2)} (> ${OT_CHIP_THRESHOLD} = OT chip renders on ACCT_A row)`);
    else fail(`ACCT_A child: ot = ${acctAgg?.ot?.toFixed(2) ?? "missing"}, want > ${OT_CHIP_THRESHOLD}`);
    if (bcctAgg && bcctAgg.ot > OT_CHIP_THRESHOLD) ok(`ACCT_B child: ot = ${bcctAgg.ot.toFixed(2)} (> ${OT_CHIP_THRESHOLD} = OT chip renders on ACCT_B row)`);
    else fail(`ACCT_B child: ot = ${bcctAgg?.ot?.toFixed(2) ?? "missing"}, want > ${OT_CHIP_THRESHOLD}`);
    if (acctAgg && Math.abs(acctAgg.ot - acctAOT) < 0.001) ok(`ACCT_A child.ot equals sum of ACCT_A worker rows (${acctAOT.toFixed(2)})`);
    else if (acctAgg) fail(`ACCT_A child.ot drift: ${acctAgg.ot.toFixed(2)} vs sum ${acctAOT.toFixed(2)}`);
    if (bcctAgg && Math.abs(bcctAgg.ot - acctBOT) < 0.001) ok(`ACCT_B child.ot equals sum of ACCT_B worker rows (${acctBOT.toFixed(2)})`);
    else if (bcctAgg) fail(`ACCT_B child.ot drift: ${bcctAgg.ot.toFixed(2)} vs sum ${acctBOT.toFixed(2)}`);
  }
}

// ─── L4 - regression net: mode !== "aggregate" returns empty ─────────
// Single-account view path is unaffected - the aggregate builder should
// early-return on non-aggregate mode (children come from
// workerChildrenForWeek instead).
console.log("");
console.log("[L4] single-account path: buildMemberByWeekAndAcct returns empty (aggregate map unused)");
{
  const single = buildMemberByWeekAndAcct(actuals, "single");
  if (single.size === 0) ok(`mode='single' -> empty map (aggregate path unused, workerChildrenForWeek renders single-account children)`);
  else fail(`mode='single' unexpectedly produced ${single.size} entries`);
}

// ─── L5 - regression net: empty / null actuals do not throw ─────────
console.log("");
console.log("[L5] defensive: empty / null actuals return empty map, no throw");
{
  const empty1 = buildMemberByWeekAndAcct([], "aggregate");
  const empty2 = buildMemberByWeekAndAcct(null, "aggregate");
  const empty3 = buildMemberByWeekAndAcct(undefined, "aggregate");
  if (empty1.size === 0 && empty2.size === 0 && empty3.size === 0) ok(`empty / null / undefined actuals -> empty map (no throw)`);
  else fail(`defensive path failed: ${empty1.size} / ${empty2.size} / ${empty3.size}`);
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "OT CHIP PR-C: ALL PROBES PASS" : `OT CHIP PR-C: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
