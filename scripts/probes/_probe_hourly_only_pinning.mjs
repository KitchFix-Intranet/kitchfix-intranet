// Probe: hours_available_hourly + approvals_hourly are
// byte-identical on a response with or without include_salary=1.
//
// Owner assertion, 2026-08-26: the pinning is proven by the identity
// of these two fields across the salary toggle, not by any rendering
// check. This probe asserts that identity by exercising the same
// helpers the route uses, on the same inputs, and diffing the pinned
// fields JSON-canonicalised.
//
// Method:
//   1. Build a synthetic hourly-only board (from a small buildBoard
//      call on canned inputs)
//   2. Assemble a hourly-only "body" and call Object.assign(body,
//      pinHourlyOnly(body.board)) - same as route.js
//   3. Call withSalary() with canned salary inputs to produce the
//      salary-on body
//   4. Compare hours_available_hourly + approvals_hourly on
//      the two bodies; assert deep-equal
//
// If this fails, the salary merge is silently overriding one of the
// pinned fields - the client cannot trust them and the card pinning
// is meaningless.

import { buildBoard, buildWeekBudgets } from "../../src/app/kpi/labor/lib/board.js";
import { withSalary, pinHourlyOnly } from "../../src/lib/labor/salaryBoard.js";

// ─── Canned inputs (P9 window, three weeks of hourly, one salary row)
const account = "STL - FL";
const start = "2026-08-10";
const end   = "2026-09-06";
const today = "2026-08-26";

// Three hourly rows: one full closed week, one partial (draft) week,
// one that will be treated as in-progress.
const hourlyActuals = [
  {
    account_key: account, worker_id: "w1",
    week_start: "2026-08-10", week_end: "2026-08-16",
    fiscal_year: 2026, period_no: 9,
    week_source: "daily_detail",
    hours_regular: 40, hours_overtime: 2, hours_double_time: 0, hours_premium_other: 0,
    dollars_regular: 800, dollars_overtime: 60,
    dollars_double_time: 0, dollars_premium_other: 0,
    amount: 860, hours_without_dollars: 0,
    segment_count: 5, entry_count: 5,
    coverage_state: "complete",
    // v43-1 - fully approved week, all costed. approved_hours = 42
    // (reg + ot), draft_hours = 0, still_costing_hours = 0, no
    // oldest_draft. The "done" quadrant.
    draft_hours: 0,
    approved_hours: 42,
    still_costing_hours: 0,
    oldest_draft_date: null,
  },
  {
    account_key: account, worker_id: "w2",
    week_start: "2026-08-17", week_end: "2026-08-23",
    fiscal_year: 2026, period_no: 9,
    week_source: "daily_detail",
    hours_regular: 35, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
    dollars_regular: 700, dollars_overtime: 0,
    dollars_double_time: 0, dollars_premium_other: 0,
    amount: 700, hours_without_dollars: 0,
    segment_count: 5, entry_count: 5,
    coverage_state: "complete",
    // v43-1 - mixed: 35 approved-and-costed, 12.5 draft-and-costed.
    // Oldest draft is 2026-08-20 (a Thursday of this week).
    draft_hours: 12.5,
    approved_hours: 35,
    still_costing_hours: 0,
    oldest_draft_date: "2026-08-20",
  },
  {
    account_key: account, worker_id: "w3",
    week_start: "2026-08-24", week_end: "2026-08-30",
    fiscal_year: 2026, period_no: 9,
    week_source: "daily_detail",
    hours_regular: 20, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
    dollars_regular: 400, dollars_overtime: 0,
    dollars_double_time: 0, dollars_premium_other: 0,
    amount: 400, hours_without_dollars: 5,
    segment_count: 3, entry_count: 3,
    coverage_state: "partial",
    // v43-1 - the interesting one: 20 approved-and-costed, 5 approved-
    // but-still-costing (approved_hours = 25, still_costing = 5), plus
    // 8 draft-hours (some draft/costed and some draft/uncosted split
    // rolls up into draft_hours). Oldest draft this week 2026-08-27.
    draft_hours: 8,
    approved_hours: 25,
    still_costing_hours: 5,
    oldest_draft_date: "2026-08-27",
  },
];

const budgetPeriods = [
  { period_no: 9, amount: 21761.40, source: "pnl", basis: "pnl", superseded: false },
];

// ─── Build hourly-only body (mirrors route.js single-account path)
const hourlyOnlyBoard = buildBoard({
  account, start, end, today,
  actuals: hourlyActuals,
  budget_periods: budgetPeriods,
  account_state: "hourly_ok",
});
const bodyHourly = {
  actuals: hourlyActuals,
  budget_periods: budgetPeriods,
  board: hourlyOnlyBoard,
  week_budgets: buildWeekBudgets({ start, end, budget_periods: budgetPeriods }),
};
Object.assign(bodyHourly, pinHourlyOnly(bodyHourly.board));

// ─── Build salary-on body via withSalary (mirrors route.js merge path)
const salaryBudgetMap = new Map();
const inner = new Map();
inner.set(9, 8000);  // synthetic 3100.2 P9 budget for one member
salaryBudgetMap.set(account, inner);
const salaryRows = [
  {
    account_key: account, worker_id: "s1",
    week_start: "2026-08-10", amount: 2000, annual_comp_at_time: 52000,
  },
  {
    account_key: account, worker_id: "s1",
    week_start: "2026-08-17", amount: 2000, annual_comp_at_time: 52000,
  },
];

// Start salary body from the SAME hourly body (pre-pinning would also
// work, but we start from post-pinning because that's what route.js
// does - Object.assign happens before the withSalary call).
const bodySalary = withSalary(bodyHourly, {
  account, members: [account], start, end, today,
  buildBoard, buildWeekBudgets,
  salary3100_2: salaryBudgetMap, salaryRows,
});

// ─── Assertions
function json(o) { return JSON.stringify(o, null, 2); }
function deepEqual(a, b) { return json(a) === json(b); }

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log("=== hourly-only pinning probe ===\n");

console.log("presence:");
assert("bodyHourly has hours_available_hourly",  !!bodyHourly.hours_available_hourly);
assert("bodyHourly has approvals_hourly", !!bodyHourly.approvals_hourly);
assert("bodySalary has hours_available_hourly",  !!bodySalary.hours_available_hourly);
assert("bodySalary has approvals_hourly", !!bodySalary.approvals_hourly);

console.log("\nsalary path is different from hourly path (sanity - if identical, we haven't proven anything):");
assert(
  "bodySalary.board.spent_to_date > bodyHourly.board.spent_to_date (salary rows landed)",
  bodySalary.board.spent_to_date > bodyHourly.board.spent_to_date,
  `  hourly: ${bodyHourly.board.spent_to_date}, salary: ${bodySalary.board.spent_to_date}`,
);
assert(
  "bodySalary.salary_included is true",
  bodySalary.salary_included === true,
);

console.log("\nbyte-identical assertion (the one that matters):");
const ok1 = deepEqual(bodyHourly.hours_available_hourly, bodySalary.hours_available_hourly);
assert(
  "hours_available_hourly is byte-identical across include_salary toggle",
  ok1,
  ok1 ? null : `\n--- hourly ---\n${json(bodyHourly.hours_available_hourly)}\n--- salary ---\n${json(bodySalary.hours_available_hourly)}`,
);
const ok2 = deepEqual(bodyHourly.approvals_hourly, bodySalary.approvals_hourly);
assert(
  "approvals_hourly is byte-identical across include_salary toggle",
  ok2,
  ok2 ? null : `\n--- hourly ---\n${json(bodyHourly.approvals_hourly)}\n--- salary ---\n${json(bodySalary.approvals_hourly)}`,
);

// Polish round 2 item 1 - explicit assertion on the materiality
// denominator. Named separately from the deep-equal above so a
// future collaborator can grep for it and see the contract stated
// explicitly. Salary rows carry hours_regular = 0 (shapeSalaryRow),
// so total_hours is hourly-only by construction on both bodies. If
// this ever diverges, the pill's materiality ratio is silently
// accepting salary dilution and the FINAL/PARTIAL boundary becomes
// unreliable.
assert(
  "approvals_hourly.total_hours is byte-identical across the toggle",
  bodyHourly.approvals_hourly.total_hours === bodySalary.approvals_hourly.total_hours,
  `  hourly: ${bodyHourly.approvals_hourly.total_hours}, salary: ${bodySalary.approvals_hourly.total_hours}`,
);
assert(
  "approvals_hourly.total_hours matches board.hours on hourly body (sanity)",
  bodyHourly.approvals_hourly.total_hours === bodyHourly.board.hours,
);

// v43-1 approvals fields - explicit byte-identity across the toggle
// for each new field. Same reason as total_hours: a future change
// that accidentally makes any of these salary-touchable silently
// breaks the card. Also asserts the oldest_draft_date NULL contract
// carries through the pin unchanged (NULL in, NULL out).
console.log("\nv43-1 approvals fields (individual byte-identity across toggle):");
for (const key of ["approved_hours", "still_costing_hours", "oldest_draft_date", "approval_people"]) {
  const h = bodyHourly.approvals_hourly[key];
  const s = bodySalary.approvals_hourly[key];
  assert(
    `approvals_hourly.${key} is byte-identical across the toggle`,
    h === s || (h === null && s === null),
    `  hourly: ${JSON.stringify(h)}, salary: ${JSON.stringify(s)}`,
  );
}
// Sanity: fixture-derived aggregates match. Row w1 = 42 approved,
// w2 = 35 approved + 12.5 draft (oldest 08-20), w3 = 25 approved +
// 8 draft + 5 still-costing (oldest 08-27). Range totals: 102
// approved, 20.5 draft, 5 still-costing, 2 people with drafts, MIN
// oldest = 08-20.
assert(
  "oldest_draft_date is MIN across rows (2026-08-20)",
  bodyHourly.approvals_hourly.oldest_draft_date === "2026-08-20",
  `  got: ${bodyHourly.approvals_hourly.oldest_draft_date}`,
);
assert(
  "approved_hours matches fixture sum (102)",
  Math.abs(bodyHourly.approvals_hourly.approved_hours - 102) < 0.01,
  `  got: ${bodyHourly.approvals_hourly.approved_hours}`,
);
assert(
  "draft_hours matches fixture sum (20.5)",
  Math.abs(bodyHourly.approvals_hourly.draft_hours - 20.5) < 0.01,
  `  got: ${bodyHourly.approvals_hourly.draft_hours}`,
);
assert(
  "still_costing_hours matches fixture sum (5)",
  Math.abs(bodyHourly.approvals_hourly.still_costing_hours - 5) < 0.01,
  `  got: ${bodyHourly.approvals_hourly.still_costing_hours}`,
);
assert(
  "approval_people counts distinct workers with drafts (w2 + w3 = 2)",
  bodyHourly.approvals_hourly.approval_people === 2,
  `  got: ${bodyHourly.approvals_hourly.approval_people}`,
);

console.log("\ncontent snapshot (the pinned inputs the two cards read):");
console.log("  hours_available_hourly:");
console.log(json(bodyHourly.hours_available_hourly).split("\n").map(l => "    " + l).join("\n"));
console.log("  approvals_hourly:");
console.log(json(bodyHourly.approvals_hourly).split("\n").map(l => "    " + l).join("\n"));

// ─── Closed-period contract: hours_available_hourly.applies must
// be false on any kind other than single_period_in_progress. Owner
// tightening 2026-08-26 - the card is client-side gated on kind, but
// the server field must not lie about it, or a future consumer
// trusting the flag will render a card we deliberately suppress.
// Payroll data renders on every kind so its applies still tracks
// the board.
const closedToday = "2026-09-30";
const boardClosed = buildBoard({ account, start, end, today: closedToday, actuals: hourlyActuals, budget_periods: budgetPeriods, account_state: "hourly_ok" });
const bodyClosed = { actuals: hourlyActuals, budget_periods: budgetPeriods, board: boardClosed };
Object.assign(bodyClosed, pinHourlyOnly(bodyClosed.board));

console.log("\nclosed-period applies contract:");
assert(
  "boardClosed.kind is single_period_closed (setup sanity)",
  boardClosed.kind === "single_period_closed",
  `  got: ${boardClosed.kind}`,
);
assert(
  "hours_available_hourly.applies is FALSE on closed period",
  bodyClosed.hours_available_hourly.applies === false,
  `  got: ${bodyClosed.hours_available_hourly.applies}`,
);
assert(
  "approvals_hourly.applies stays TRUE on closed period (card renders on every kind)",
  bodyClosed.approvals_hourly.applies === true,
  `  got: ${bodyClosed.approvals_hourly.applies}`,
);
assert(
  "hours_available_hourly.applies is TRUE on the in-progress body (baseline)",
  bodyHourly.hours_available_hourly.applies === true,
);

if (failures > 0) {
  console.log(`\n${failures} failure(s) - pinning is broken.`);
  process.exit(1);
}
console.log("\nall assertions pass.");
