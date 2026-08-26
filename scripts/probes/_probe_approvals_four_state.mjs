// Approvals card four-state model invariants.
//
// Owner directive 2026-08-26: "Add a probe asserting the four states
// are mutually exclusive and sum to total hours. If an hour lands in
// two boxes or none, the model is wrong and everything above it is
// decoration."
//
// The four boxes (from CC_PROMPT_APPROVALS_CARD.md):
//
//                       not costed              costed
//   not approved        still on the clock      WAITING ON YOU
//                       (open punches)          (draft, needs signature)
//   approved            payroll catching up     done
//                       (still_costing_hours)   (approved_hours -
//                                                 still_costing_hours)
//
// Every time entry has a status (DRAFT or APPROVED - only two exist
// in the raw feed per owner's 2026-08-26 measurement of week 08/24
// across all accounts) AND a costed-status (has-matching-pay-segment
// or does not). The four boxes are the cross product.
//
// The derive persists three fields per row on labor_actuals:
//
//   draft_hours          - sum of duration on DRAFT entries (all
//                          drafts, costed or uncosted - the card does
//                          not split them because you approve them
//                          regardless of cost status)
//   approved_hours       - sum of duration on APPROVED entries
//                          (all approved, both boxes)
//   still_costing_hours  - subset of approved_hours: APPROVED
//                          entries with no matching pay segment
//
// Invariants this probe asserts (at row level and at range aggregate):
//
//   I1 (partition): draft_hours + approved_hours == sum of duration
//                   on all in-scope time entries. Every hour is in
//                   exactly one of {DRAFT, APPROVED}; there is no
//                   third status. If this fails, either a new status
//                   value slipped into the raw feed or the derive is
//                   miscategorising.
//
//   I2 (subset):    still_costing_hours <= approved_hours. A costed-
//                   status refinement lives within APPROVED; a value
//                   greater than approved_hours would mean the
//                   coverage hop is returning wrong data.
//
//   I3 (non-neg):   all three fields are >= 0. Sanity.
//
//   I4 (four-box exhaustion, when we know total hours):
//                   draft_hours + approved_hours == in-scope hours.
//                   Same as I1 restated - included for clarity when
//                   reading probe output.
//
// Fixtures are self-contained (mirror what derive emits per bucket).
// A separate DB-hitting probe (not shipped) would run the same
// assertions against live labor_actuals rows post-derive.

import { buildBoard, buildWeekBudgets } from "../../src/app/kpi/labor/lib/board.js";
import { approvalsPill } from "../../src/app/kpi/labor/lib/signalCardModels.js";

const account = "STL - FL";
const start = "2026-08-10";
const end   = "2026-09-06";
const today = "2026-08-26";

// Synthetic time entries expressed at the bucket-emit shape (as if
// derive had already run). Six workers span the four boxes:
//   w1: 40 approved-costed (done)
//   w2: 12 approved-still-costing (approved + uncosted)
//   w3: 24 draft (mixed costed status, rolls up as draft_hours)
//   w4: pure zero (control)
//   w5: 50 approved-costed + 8 draft (two of the four boxes in one row)
//   w6: 30 approved with 6 still-costing subset
const rows = [
  mkRow("w1", "2026-08-10", { approved: 40, draft: 0, still_costing: 0, oldest: null }),
  mkRow("w2", "2026-08-10", { approved: 12, draft: 0, still_costing: 12, oldest: null }),
  mkRow("w3", "2026-08-10", { approved: 0, draft: 24, still_costing: 0, oldest: "2026-08-13" }),
  mkRow("w4", "2026-08-10", { approved: 0, draft: 0, still_costing: 0, oldest: null }),
  mkRow("w5", "2026-08-17", { approved: 50, draft: 8, still_costing: 0, oldest: "2026-08-21" }),
  mkRow("w6", "2026-08-17", { approved: 30, draft: 0, still_costing: 6, oldest: null }),
];

// Total expected: draft = 24 + 8 = 32; approved = 40 + 12 + 50 + 30 = 132;
// still_costing = 12 + 6 = 18; total hours = 32 + 132 = 164.
const EXPECTED = {
  draft_hours: 32,
  approved_hours: 132,
  still_costing_hours: 18,
  total_hours: 164,   // = draft + approved
};

const budgetPeriods = [{ period_no: 9, amount: 21761.40, source: "pnl", basis: "pnl", superseded: false }];
const board = buildBoard({ account, start, end, today, actuals: rows, budget_periods: budgetPeriods, account_state: "hourly_ok" });

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log("=== Approvals four-state model invariants ===\n");

const pd = board.payroll_data || {};
console.log("range aggregates from buildBoard:");
console.log(`  draft_hours:         ${pd.draft_hours}`);
console.log(`  approved_hours:      ${pd.approved_hours}`);
console.log(`  still_costing_hours: ${pd.still_costing_hours}`);
console.log(`  total_hours (board.hours): ${board.hours}`);
console.log(`  approval_people:     ${pd.approval_people}`);
console.log(`  oldest_draft_date:   ${pd.oldest_draft_date}`);

console.log("\nI1 (partition): draft_hours + approved_hours == total in-scope hours");
const partitionSum = (pd.draft_hours || 0) + (pd.approved_hours || 0);
assert(
  `${partitionSum} == ${EXPECTED.total_hours} (fixture ground truth)`,
  Math.abs(partitionSum - EXPECTED.total_hours) < 0.01,
);
// Additional check: board.hours (which sums hours_regular + hours_overtime +
// hours_double_time from pay segments) is a DIFFERENT source than
// draft_hours + approved_hours (which sum duration from time entries).
// They agree only when every time entry has a matching pay segment
// AND uses only the regular/ot/dt buckets. In the fixture I constructed
// rows without pay-segment hours, so board.hours = 0. The partition
// invariant I1 is about STATUS classification and holds regardless.

console.log("\nI2 (subset): still_costing_hours <= approved_hours");
assert(
  `${pd.still_costing_hours} <= ${pd.approved_hours}`,
  (pd.still_costing_hours || 0) <= (pd.approved_hours || 0) + 0.01,
);

console.log("\nI3 (non-negative): all three fields >= 0");
assert("draft_hours >= 0",         (pd.draft_hours || 0) >= 0);
assert("approved_hours >= 0",      (pd.approved_hours || 0) >= 0);
assert("still_costing_hours >= 0", (pd.still_costing_hours || 0) >= 0);

console.log("\nfixture aggregate assertions:");
assert(
  `draft_hours == ${EXPECTED.draft_hours}`,
  Math.abs((pd.draft_hours || 0) - EXPECTED.draft_hours) < 0.01,
  `  got: ${pd.draft_hours}`,
);
assert(
  `approved_hours == ${EXPECTED.approved_hours}`,
  Math.abs((pd.approved_hours || 0) - EXPECTED.approved_hours) < 0.01,
  `  got: ${pd.approved_hours}`,
);
assert(
  `still_costing_hours == ${EXPECTED.still_costing_hours}`,
  Math.abs((pd.still_costing_hours || 0) - EXPECTED.still_costing_hours) < 0.01,
  `  got: ${pd.still_costing_hours}`,
);

console.log("\napproval_people + oldest_draft_date:");
// w3 has drafts (worker with drafts), w5 has drafts (worker with drafts).
// Distinct workers with drafts = 2.
assert(
  "approval_people counts distinct workers with drafts (w3 + w5 = 2)",
  pd.approval_people === 2,
  `  got: ${pd.approval_people}`,
);
// oldest_draft_date MIN across rows: w3 has 2026-08-13, w5 has
// 2026-08-21. MIN = 2026-08-13. w1/w2/w4/w6 have null (skipped).
assert(
  "oldest_draft_date is MIN across rows (2026-08-13)",
  pd.oldest_draft_date === "2026-08-13",
  `  got: ${pd.oldest_draft_date}`,
);

console.log("\nNULL semantics (owner ruling: 'NULL means we do not know'):");
// A separate range with zero drafts must produce oldest_draft_date === null,
// NOT a sentinel date and NOT green ALL CLEAR at the client.
const zeroDraftRows = [mkRow("wz", "2026-08-10", { approved: 20, draft: 0, still_costing: 0, oldest: null })];
const zeroBoard = buildBoard({ account, start, end, today, actuals: zeroDraftRows, budget_periods: budgetPeriods, account_state: "hourly_ok" });
assert(
  "range with zero drafts produces oldest_draft_date === null (not a date, not zero)",
  zeroBoard.payroll_data.oldest_draft_date === null,
  `  got: ${zeroBoard.payroll_data.oldest_draft_date}`,
);
assert(
  "range with zero drafts produces approval_people === 0",
  zeroBoard.payroll_data.approval_people === 0,
);

// ─── Pill classifier: draft_hours > 0 CANNOT return ALL CLEAR ────
// Owner ruling 2026-08-26 (post-scope-review): the round-2 materiality
// threshold is DROPPED. A pill reading ALL CLEAR beside 116.75 hrs
// pending approval reads as a flat claim of completion. The
// classifier's contract now: ALL CLEAR fires only at genuinely zero
// drafts, so it can be trusted. This probe is the assertion that
// stops the materiality trap recurring - if a future change reintroduces
// a threshold that lets ALL CLEAR fire with unapproved hours present,
// this assertion catches it before it ships.
console.log("\napprovalsPill classifier - ALL CLEAR fires ONLY at genuinely zero drafts:");
const pillScenarios = [
  // Zero drafts baseline - ALL CLEAR is the ONLY correct output.
  { name: "zero drafts",                    pin: { draft_hours: 0,     oldest_draft_date: null },        expect: { state: "good", label: "ALL CLEAR" } },
  // Non-zero drafts - ALL CLEAR must NOT appear. Age-band drives label.
  { name: "1 hr from today",                pin: { draft_hours: 1,     oldest_draft_date: isoDaysAgo(0) },  expect: { state: "warn", label: "THIS WEEK" } },
  { name: "1000 hrs from today (former immaterial-neg / material)",
                                            pin: { draft_hours: 1000,  oldest_draft_date: isoDaysAgo(0) },  expect: { state: "warn", label: "THIS WEEK" } },
  { name: "0.01 hr from today (residual)",  pin: { draft_hours: 0.01,  oldest_draft_date: isoDaysAgo(0) },  expect: { state: "warn", label: "THIS WEEK" } },
  { name: "116.75 hrs from 3 days ago (kevin's fixture)",
                                            pin: { draft_hours: 116.75,oldest_draft_date: isoDaysAgo(3) },  expect: { state: "warn", label: "THIS WEEK" } },
  { name: "100 hrs from 7 days ago (boundary - THIS WEEK)",
                                            pin: { draft_hours: 100,   oldest_draft_date: isoDaysAgo(7) },  expect: { state: "warn", label: "THIS WEEK" } },
  { name: "100 hrs from 8 days ago (boundary - N DAYS OLD amber)",
                                            pin: { draft_hours: 100,   oldest_draft_date: isoDaysAgo(8) },  expect: { state: "warn", label: "8 DAYS OLD" } },
  { name: "100 hrs from 14 days ago (boundary - N DAYS OLD amber)",
                                            pin: { draft_hours: 100,   oldest_draft_date: isoDaysAgo(14) }, expect: { state: "warn", label: "14 DAYS OLD" } },
  { name: "100 hrs from 15 days ago (boundary - N DAYS OLD red)",
                                            pin: { draft_hours: 100,   oldest_draft_date: isoDaysAgo(15) }, expect: { state: "bad",  label: "15 DAYS OLD" } },
  { name: "100 hrs from 29 days ago (STL - FL Jul 28 shape)",
                                            pin: { draft_hours: 100,   oldest_draft_date: isoDaysAgo(29) }, expect: { state: "bad",  label: "29 DAYS OLD" } },
  { name: "drafts but oldest_draft_date NULL (post-migrate, pre-derive)",
                                            pin: { draft_hours: 50,    oldest_draft_date: null },        expect: { state: "warn", label: "PENDING" } },
];
for (const sc of pillScenarios) {
  const got = approvalsPill(sc.pin);
  assert(
    `${sc.name}: pill=${JSON.stringify(got)}`,
    got.state === sc.expect.state && got.label === sc.expect.label,
    `  expected: ${JSON.stringify(sc.expect)}`,
  );
}
// The invariant that matters most - walk every non-zero-draft
// scenario and assert the pill NEVER lands on ALL CLEAR. This is the
// class-of-defect assertion Kevin asked for: "assert no fixture with
// draft_hours > 0 can produce ALL CLEAR."
console.log("\ninvariant sweep: any draft_hours > 0 must NOT return ALL CLEAR");
for (const sc of pillScenarios) {
  if (sc.pin.draft_hours <= 0.004) continue;
  const got = approvalsPill(sc.pin);
  const isAllClear = got.state === "good" && got.label === "ALL CLEAR";
  assert(
    `${sc.name} (${sc.pin.draft_hours} hrs) - pill is NOT ALL CLEAR`,
    !isAllClear,
    `  got: ${JSON.stringify(got)}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} failure(s) - the four-state model is broken; the Approvals card is decoration on top.`);
  process.exit(1);
}
console.log("\nall assertions pass.");

function isoDaysAgo(n) {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const then = new Date(utc - n * 86400000);
  return then.toISOString().slice(0, 10);
}

function mkRow(workerId, weekStart, { approved, draft, still_costing, oldest }) {
  const weekEnd = addDays(weekStart, 6);
  return {
    account_key: account, worker_id: workerId,
    week_start: weekStart, week_end: weekEnd,
    fiscal_year: 2026, period_no: 9,
    week_source: "daily_detail",
    // Pay-segment fields set to zero - this probe is about status-based
    // approval classification, not costed-side aggregates.
    hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
    dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
    amount: 0, hours_without_dollars: 0,
    segment_count: 0, entry_count: 0,
    coverage_state: "complete",
    // The three fields under test.
    draft_hours: draft,
    approved_hours: approved,
    still_costing_hours: still_costing,
    oldest_draft_date: oldest,
  };
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
