// HS FB1 hotfix P0 assertion 2026-08-25.
//
// Reproducer: TBR - FL week 08/17 carried draft_hours 122.98 across
// 10 draft entries, all PRICED (unpriced_hrs = 0). Payroll Data card
// read "FINAL · Unapproved: none" against truly-unapproved labor.
//
// Root cause: board.js keyed unapproved_flag / unapproved_hours off
// unpriced_hrs, gated on state !== "closed". Kevin's V42 ruling that
// unpriced_hrs (not draft_hours) is the money-cap signal was correct
// for the bar cap; wrong when applied to approval status. A priced
// draft is still unapproved.
//
// This test asserts the fix on the pure buildBoard function so any
// regression flips the assertion, independent of live data.

import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../board.js";

// Minimal worker-week fixture for a single closed week with drafts.
// draft_hours > 0 and hours_without_dollars == 0 mirrors TBR - FL 08/17
// exactly - the drafts have been priced but not approved.
function drafted({ workerId, weekStart, weekEnd, draft_hours, hours_without_dollars = 0, amount = 0 }) {
  return {
    account_key: "TBR - FL",
    worker_id: workerId,
    week_start: weekStart,
    week_end: weekEnd,
    line_code: "HOURLY",
    fiscal_year: 2026,
    period_no: 9,
    week_source: "rippling_time_entry",
    hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
    dollars_regular: amount, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
    amount,
    hours_without_dollars,
    segment_count: 1, entry_count: 1,
    coverage_state: hours_without_dollars > 0 ? "partial" : "complete",
    draft_entry_count: 1,
    draft_hours,
    anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
  };
}

test("P0 fixture - closed week with priced drafts flags as unapproved", () => {
  // Reproducer: week 08/17..08/23 fully closed by today 08/25. Ten
  // priced drafts summing to 122.98 hours.
  const today = "2026-08-25";
  const start = "2026-08-17";
  const end   = "2026-08-23";
  const actuals = [];
  const perWorker = 122.98 / 10;
  for (let i = 0; i < 10; i++) {
    actuals.push(drafted({
      workerId: `w${i}`,
      weekStart: start,
      weekEnd: end,
      draft_hours: perWorker,
      hours_without_dollars: 0,
      amount: 100,
    }));
  }
  const board = buildBoard({
    account: "TBR - FL",
    start, end, today,
    actuals,
    budget_periods: [{ period_no: 9, amount: 10000, basis: "envelope" }],
    account_state: "hourly_ok",
  });

  // 1. Per-week flag: closed week with drafts flags as unapproved.
  const week = board.weeks?.find(w => w.week_start === start);
  assert.ok(week, "week 08/17 present in board.weeks");
  assert.equal(week.state, "closed", "week must be closed (end 08/23 < today 08/25)");
  assert.equal(week.unapproved_flag, true, "unapproved_flag must be TRUE - closed weeks with drafts are still unapproved");
  assert.ok(Math.abs(week.unapproved_hours - 122.98) < 0.01,
    `unapproved_hours should equal draft_hours 122.98, got ${week.unapproved_hours}`);
  assert.equal(week.unpriced_hrs, 0, "unpriced_hrs should be 0 (drafts already priced)");

  // 2. Range payroll_data: draft_hours surfaced, drives approval status.
  assert.ok(Math.abs((board.payroll_data.draft_hours || 0) - 122.98) < 0.01,
    `payroll_data.draft_hours should equal 122.98, got ${board.payroll_data.draft_hours}`);
  assert.equal(board.payroll_data.unpriced_hours, 0, "payroll_data.unpriced_hours stays 0 (bar cap unchanged)");
  assert.equal(board.payroll_data.unapproved_weeks, 1, "unapproved_weeks counts weeks with draft_hours > 0");
});

test("no drafts + priced coverage = FINAL / everything approved", () => {
  // Control case: fully-priced, no drafts. Card should read FINAL.
  const today = "2026-08-25";
  const start = "2026-08-17";
  const end   = "2026-08-23";
  const actuals = [];
  for (let i = 0; i < 5; i++) {
    actuals.push({
      account_key: "TBR - FL", worker_id: `w${i}`,
      week_start: start, week_end: end, line_code: "HOURLY",
      fiscal_year: 2026, period_no: 9, week_source: "rippling_labor",
      hours_regular: 40, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      dollars_regular: 1000, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      amount: 1000,
      hours_without_dollars: 0,
      segment_count: 1, entry_count: 1,
      coverage_state: "complete",
      draft_entry_count: 0,
      draft_hours: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
    });
  }
  const board = buildBoard({
    account: "TBR - FL",
    start, end, today,
    actuals,
    budget_periods: [{ period_no: 9, amount: 10000, basis: "envelope" }],
    account_state: "hourly_ok",
  });
  const week = board.weeks?.find(w => w.week_start === start);
  assert.equal(week.unapproved_flag, false);
  assert.equal(week.unapproved_hours, 0);
  assert.equal(board.payroll_data.draft_hours, 0);
  assert.equal(board.payroll_data.unapproved_weeks, 0);
});

test("closed-state gate is DROPPED - approval status does not expire", () => {
  // A week closed weeks ago still shows unapproved if it has drafts.
  // Pre-fix gate `state !== "closed"` would have swallowed this.
  const today = "2026-08-25";
  const start = "2026-07-13";  // several weeks ago
  const end   = "2026-07-19";
  const actuals = [drafted({
    workerId: "w1", weekStart: start, weekEnd: end,
    draft_hours: 40, amount: 800,
  })];
  const board = buildBoard({
    account: "TBR - FL",
    start, end, today,
    actuals,
    budget_periods: [{ period_no: 8, amount: 10000, basis: "envelope" }],
    account_state: "hourly_ok",
  });
  const week = board.weeks?.find(w => w.week_start === start);
  assert.equal(week.state, "closed", "sanity: week is closed");
  assert.equal(week.unapproved_flag, true, "closed weeks with drafts stay flagged - status does not expire");
});
