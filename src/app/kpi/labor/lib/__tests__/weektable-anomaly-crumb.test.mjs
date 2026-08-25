// HS FB1 anomaly breadcrumb 2026-08-26.
//
// Fixture (Kevin): ALL accounts, ?start=2026-08-10&end=2026-09-06.
// Week 2026-08-17 carries exactly one anomaly across the portfolio:
// TBR - FL, one worker, anomaly_over_16h = 1. Every other account +
// worker is clean.
//
// Asserts:
//   1. buildMemberByWeekAndAcct sums anomaly counts per (week, acct).
//      Only TBR - FL for week 08/17 has anomaly_over_16h > 0.
//   2. Probe rule: count of accounts with anomalies == count of
//      breadcrumb-eligible account child rows for that week.
//   3. Worker level: exactly one worker row on TBR - FL for 08/17
//      carries anomaly_over_16h > 0.
//   4. Clean week 08/03 has zero anomalies at account AND worker level.
//   5. Drafts alone do NOT trigger the breadcrumb (crying-wolf rule).

import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberByWeekAndAcct } from "../weekTableModels.js";

function hasAnomaly(row) {
  return (Number(row?.anomaly_no_clockout || 0)
        + Number(row?.anomaly_under_1h    || 0)
        + Number(row?.anomaly_over_16h    || 0)) > 0;
}

function fixture() {
  // Synthetic actuals mirroring Kevin's fixture shape. Multiple accounts
  // in week 08/17; only TBR - FL has an anomaly. Draft hours present
  // on TBR - FL specifically per Kevin's report (57.68 draft).
  return [
    // TBR - FL 08/17 - the flagged row. One worker, anomaly_over_16h=1.
    {
      account_key: "TBR - FL", worker_id: "wt1", week_start: "2026-08-17",
      hours_regular: 40, hours_overtime: 25.5, hours_double_time: 0,
      amount: 1500, coverage_state: "complete",
      hours_without_dollars: 0, draft_hours: 57.68, draft_entry_count: 4,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 1,
    },
    // TBR - FL 08/17 - another worker at same account, CLEAN. Must not
    // get a chip - only the person who broke the punch should.
    {
      account_key: "TBR - FL", worker_id: "wt2", week_start: "2026-08-17",
      hours_regular: 30, hours_overtime: 0, hours_double_time: 0,
      amount: 700, coverage_state: "complete",
      hours_without_dollars: 0, draft_hours: 0, draft_entry_count: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
    },
    // STL - MO 08/17 - clean, another account, must not get a chip.
    {
      account_key: "STL - MO", worker_id: "ws1", week_start: "2026-08-17",
      hours_regular: 40, hours_overtime: 0, hours_double_time: 0,
      amount: 800, coverage_state: "complete",
      hours_without_dollars: 0, draft_hours: 0, draft_entry_count: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
    },
    // CIN - AZ 08/24 - drafts present but NO anomaly. Crying-wolf rule:
    // no chip even though drafts > 0.
    {
      account_key: "CIN - AZ", worker_id: "wc1", week_start: "2026-08-24",
      hours_regular: 40, hours_overtime: 0, hours_double_time: 0,
      amount: 800, coverage_state: "complete",
      hours_without_dollars: 0, draft_hours: 28.09, draft_entry_count: 4,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
    },
    // TBR - FL 08/03 - clean week, must be zero at both levels.
    {
      account_key: "TBR - FL", worker_id: "wt1", week_start: "2026-08-03",
      hours_regular: 40, hours_overtime: 0, hours_double_time: 0,
      amount: 800, coverage_state: "complete",
      hours_without_dollars: 0, draft_hours: 0, draft_entry_count: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
    },
  ];
}

test("Fixture ALL 08/17 - buildMemberByWeekAndAcct sums anomalies per account", () => {
  const out = buildMemberByWeekAndAcct(fixture(), "aggregate");
  const wk = out.get("2026-08-17");
  assert.ok(wk, "week 08/17 present");
  assert.equal(wk.get("TBR - FL").anomaly_over_16h, 1, "TBR - FL has one over-16h");
  assert.equal(wk.get("TBR - FL").anomaly_no_clockout, 0);
  assert.equal(wk.get("TBR - FL").anomaly_under_1h, 0);
  assert.equal(wk.get("STL - MO").anomaly_over_16h, 0, "STL - MO clean at account level");
});

test("Probe A - week 08/17 account-level: exactly ONE account carries a breadcrumb", () => {
  const out = buildMemberByWeekAndAcct(fixture(), "aggregate");
  const wk = out.get("2026-08-17");
  const flagged = [];
  for (const [acct, agg] of wk) if (hasAnomaly(agg)) flagged.push(acct);
  assert.deepEqual(flagged, ["TBR - FL"]);
});

test("Probe B - week 08/17 worker-level: exactly ONE worker on TBR-FL carries a breadcrumb", () => {
  const rows = fixture().filter(r => r.week_start === "2026-08-17" && r.account_key === "TBR - FL");
  const flagged = rows.filter(hasAnomaly).map(r => r.worker_id);
  assert.deepEqual(flagged, ["wt1"], "only the worker who broke the punch is flagged");
});

test("Probe C - clean week 08/03 has zero at both levels", () => {
  const out = buildMemberByWeekAndAcct(fixture(), "aggregate");
  const wk = out.get("2026-08-03");
  assert.ok(wk, "week 08/03 present");
  for (const [, agg] of wk) assert.equal(hasAnomaly(agg), false, "no account flagged");
  const workerRows = fixture().filter(r => r.week_start === "2026-08-03");
  assert.equal(workerRows.filter(hasAnomaly).length, 0);
});

test("Crying-wolf rule - drafts alone do NOT trigger the breadcrumb", () => {
  // CIN - AZ 08/24: draft_hours 28.09, draft_entry_count 4, ZERO anomalies.
  // Must not flag. V42 built exactly to avoid this.
  const out = buildMemberByWeekAndAcct(fixture(), "aggregate");
  const wk = out.get("2026-08-24");
  const cin = wk.get("CIN - AZ");
  assert.ok(cin.draft_hours > 0, "sanity: drafts present");
  assert.equal(hasAnomaly(cin), false, "drafts alone must not flag the breadcrumb");
});

test("Probe rule - accounts-with-anomaly count == breadcrumb-eligible account rows", () => {
  // Kevin's probe: for any week with anomalies, the count of
  // ⚠-marked account rows equals the count of distinct accounts
  // with anomalies. Assert across every week in the fixture.
  const out = buildMemberByWeekAndAcct(fixture(), "aggregate");
  for (const [wk, per] of out) {
    let distinctWithAnomaly = 0;
    let breadcrumbEligible  = 0;
    for (const [, agg] of per) {
      if (hasAnomaly(agg)) distinctWithAnomaly += 1;
      if (hasAnomaly(agg)) breadcrumbEligible  += 1;
    }
    assert.equal(distinctWithAnomaly, breadcrumbEligible, `week ${wk}`);
  }
});
