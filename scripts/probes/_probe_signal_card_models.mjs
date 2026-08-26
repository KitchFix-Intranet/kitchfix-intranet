// Probe: the four signal card model derivations post-2026-08-26
// revisions - Covers strings differ per card, buildHoursLeftModel
// hides on any range that is not single_period_in_progress, pace
// facts carry the swapped Projected end / Vs budget labels, and the
// hours model reads from the pinned block never from the merged
// board.
//
// This is a companion to _probe_hourly_only_pinning.mjs. That probe
// proves the server-side pinning contract holds; this probe proves
// the client-side reads consume the pinning correctly and the derived
// Covers strings match the spec.

import { buildBoard, buildWeekBudgets } from "../../src/app/kpi/labor/lib/board.js";
import { withSalary, pinHourlyOnly } from "../../src/lib/labor/salaryBoard.js";
import { buildPaceCardModel, buildHoursLeftModel, buildCoversLine } from "../../src/app/kpi/labor/lib/signalCardModels.js";

const account = "STL - FL";
const start = "2026-08-10";
const end   = "2026-09-06";
const today = "2026-08-26";

const hourlyActuals = [
  { account_key: account, worker_id: "w1", week_start: "2026-08-10", week_end: "2026-08-16", fiscal_year: 2026, period_no: 9, week_source: "daily_detail", hours_regular: 40, hours_overtime: 2, hours_double_time: 0, hours_premium_other: 0, dollars_regular: 800, dollars_overtime: 60, dollars_double_time: 0, dollars_premium_other: 0, amount: 860, hours_without_dollars: 0, segment_count: 5, entry_count: 5, coverage_state: "complete", draft_hours: 0 },
  { account_key: account, worker_id: "w2", week_start: "2026-08-17", week_end: "2026-08-23", fiscal_year: 2026, period_no: 9, week_source: "daily_detail", hours_regular: 35, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, dollars_regular: 700, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0, amount: 700, hours_without_dollars: 0, segment_count: 5, entry_count: 5, coverage_state: "complete", draft_hours: 12.5 },
  { account_key: account, worker_id: "w3", week_start: "2026-08-24", week_end: "2026-08-30", fiscal_year: 2026, period_no: 9, week_source: "daily_detail", hours_regular: 20, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, dollars_regular: 400, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0, amount: 400, hours_without_dollars: 5, segment_count: 3, entry_count: 3, coverage_state: "partial", draft_hours: 8 },
];
const budgetPeriods = [{ period_no: 9, amount: 21761.40, source: "pnl", basis: "pnl", superseded: false }];

const boardInProgress = buildBoard({ account, start, end, today, actuals: hourlyActuals, budget_periods: budgetPeriods, account_state: "hourly_ok" });
const bodyHourly = { actuals: hourlyActuals, budget_periods: budgetPeriods, board: boardInProgress, week_budgets: buildWeekBudgets({ start, end, budget_periods: budgetPeriods }) };
Object.assign(bodyHourly, pinHourlyOnly(bodyHourly.board));

// Salary body for the "unconditional read" assertion
const salBud = new Map(); salBud.set(account, new Map([[9, 8000]]));
const salRows = [
  { account_key: account, worker_id: "s1", week_start: "2026-08-10", amount: 2000, annual_comp_at_time: 52000 },
  { account_key: account, worker_id: "s1", week_start: "2026-08-17", amount: 2000, annual_comp_at_time: 52000 },
];
const bodySalary = withSalary(bodyHourly, { account, members: [account], start, end, today, buildBoard, buildWeekBudgets, salary3100_2: salBud, salaryRows: salRows });

// Closed-period board (P9 fully closed) for hides-on-non-in-progress test
const closedToday = "2026-09-30";
const boardClosed = buildBoard({ account, start, end, today: closedToday, actuals: hourlyActuals, budget_periods: budgetPeriods, account_state: "hourly_ok" });
const bodyClosed = { actuals: hourlyActuals, budget_periods: budgetPeriods, board: boardClosed };
Object.assign(bodyClosed, pinHourlyOnly(bodyClosed.board));

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log("=== signal card model probe ===\n");

// ── 1. Covers strings per card ──────────────────────────────────
console.log("Covers derivation (single_period_in_progress, 1 closed + 1 in-progress + 1 not-started):");
const coversPace     = buildCoversLine(boardInProgress, "pace", { draftHoursHourly: 20.5 });
const coversOT       = buildCoversLine(boardInProgress, "overtime");
const coversPay      = buildCoversLine(boardInProgress, "payroll_data");
const coversHours    = buildCoversLine(boardInProgress, "hours_available");
console.log(`  pace     : "${coversPace}"`);
console.log(`  overtime : "${coversOT}"`);
console.log(`  payroll  : "${coversPay}"`);
console.log(`  hours    : "${coversHours}"`);

assert("pace covers mentions closed weeks + in-progress week + draft hours",
  coversPace.includes("closed") && coversPace.includes("in progress") && coversPace.includes("20.5 hrs not yet approved"));
assert("overtime covers mentions closed weeks + in-progress week + NO draft hours",
  coversOT.includes("closed") && coversOT.includes("in progress") && !coversOT.includes("not yet approved"));
assert("payroll covers ends with · Hourly only",
  coversPay.endsWith("· Hourly only"));
assert("hours covers ends with · Hourly only",
  coversHours.endsWith("· Hourly only"));
assert("hours covers names weeks remaining",
  coversHours.includes("weeks remaining"));

console.log("\nCovers derivation on a fully-closed period:");
const coversPaceClosed = buildCoversLine(boardClosed, "pace");
const coversHoursClosed = buildCoversLine(boardClosed, "hours_available");
console.log(`  pace closed  : "${coversPaceClosed}"`);
console.log(`  hours closed : "${coversHoursClosed}"`);
assert("pace covers on closed period uses \"all N weeks\" shape",
  coversPaceClosed && coversPaceClosed.includes("all") && coversPaceClosed.includes("weeks of the period"));
assert("hours covers returns null on closed period (card is absent)",
  coversHoursClosed === null);

// ── 2. buildHoursLeftModel gating + unconditional pinned read ────
console.log("\nHours available model gates on kind === single_period_in_progress:");
const mHoursInProg = buildHoursLeftModel(boardInProgress, bodyHourly.hours_available_hourly);
const mHoursClosed = buildHoursLeftModel(boardClosed, bodyClosed.hours_available_hourly);
assert("in-progress: model returns a rendered card (hidden !== true)", !mHoursInProg.hidden);
assert("closed:      model returns { hidden: true } (card absent)", mHoursClosed.hidden === true);

// The unconditional pinned read test: build the model from the SALARY
// body using the same pinnedHours field, and confirm every derived
// value matches the hourly-body model. If any field is read from
// board instead of pinnedHours, the two won't match.
const mHoursSalary = buildHoursLeftModel(bodySalary.board, bodySalary.hours_available_hourly);
console.log("\nunconditional-pin assertion (model on salary body must match model on hourly body):");
function json(o) { return JSON.stringify(o); }
assert("hero identical",     json(mHoursInProg.hero)  === json(mHoursSalary.hero));
assert("heroSub identical",  json(mHoursInProg.heroSub) === json(mHoursSalary.heroSub));
assert("facts identical",    json(mHoursInProg.facts) === json(mHoursSalary.facts),
  `\n  hourly: ${json(mHoursInProg.facts)}\n  salary: ${json(mHoursSalary.facts)}`);

// ── 3. Pace card fact swap: Projected end shows end figure, Vs budget shows arrow
console.log("\nPace card facts (Projected end + Vs budget swap):");
const mPace = buildPaceCardModel(boardInProgress);
const facts = mPace.facts;
console.log(facts.map(f => `  ${f.label}: ${typeof f.value === "object" ? JSON.stringify(f.value) : f.value}`).join("\n"));
const projFact = facts.find(f => f.label === "Projected end");
const vsBudgetFact = facts.find(f => f.label === "Vs budget");
assert("Projected end fact exists", !!projFact);
assert("Vs budget fact exists", !!vsBudgetFact);
if (projFact && vsBudgetFact) {
  // With one closed week the projection can happen, so both facts
  // should be populated. Vs budget carries the arrow descriptor;
  // Projected end is a plain money string (no arrow).
  const projIsPlainString = typeof projFact.value === "string";
  const vsIsArrow = vsBudgetFact.value && typeof vsBudgetFact.value === "object" && vsBudgetFact.value.shape === "arrow";
  // If one closed week exists, both should be populated; if we tripped
  // the "needs a closed week" path (< 1 closed), both are muted.
  if (boardInProgress.closed_weeks_count >= 1) {
    assert("Projected end shows a plain money string (end figure, not arrow)", projIsPlainString);
    assert("Vs budget carries the arrow descriptor (over/under label)", vsIsArrow);
  }
}
assert("Left to spend is NO LONGER a fact (retired in favour of Vs budget)",
  !facts.find(f => f.label === "Left to spend"));

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nall assertions pass.");
