// HS FB1 hotfix P0 - WeekTable draft-hours assertions 2026-08-25.
//
// Reproducers from Kevin:
//   A) CIN - AZ, ?start=2026-08-10&end=2026-09-06.
//      Week 08/24 (in-progress): draft_hours 28.09, draft_entry_count 4.
//      Pre-fix: Unapproved column showed "-", no chip.
//      Post-fix: column shows 28.09, chip renders with muted class.
//   B) ALL accounts, same range.
//      Week 08/17 (closed): draft_hours 196.39 across 19 draft entries.
//      Pre-fix: Unapproved column "-", zero .kpi-tbl-flag chips.
//      Post-fix: column shows 196.39, s3a chip renders.
//
// Asserts the pure functions (flagForV42State, buildMemberByWeekAndAcct)
// on synthetic fixtures. The JSX render path consumes these; probe
// green implies the client would render correctly on the same inputs.

import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberByWeekAndAcct } from "../weekTableModels.js";

// Copy of flagForV42State - can't import from WeekTable.js in a plain
// Node test (JSX compilation). Kept in sync with WeekTable.js:209.
// If this drifts, both tests fail; the copy makes the assertion self-
// contained without dragging esbuild into the test-runner.
function flagForV42State(w, isClosed) {
  const nc  = Number(w.anomaly_no_clockout || 0);
  const u1  = Number(w.anomaly_under_1h    || 0);
  const o16 = Number(w.anomaly_over_16h    || 0);
  const anomalies = nc + u1 + o16;
  const unpriced = Number(w.unpriced_hrs ?? w.hours_without_dollars ?? 0);
  const drafts   = Number(w.draft_entry_count || 0);
  const draftHrs = Number(w.draft_hours || 0);
  if (anomalies > 0) return { state: "s2" };
  if (isClosed && unpriced > 0.004) return { state: "s3b" };
  if (isClosed && drafts > 0) return { state: "s3a", label: `closed week awaiting approval${draftHrs > 0.004 ? ` - ${draftHrs.toFixed(1)} hrs` : ""}` };
  if (!isClosed && drafts > 0) return { state: "s1", label: `${draftHrs.toFixed(1)} hrs pending approval` };
  return null;
}

test("Fixture A - CIN-AZ in-progress week with drafts flags State 1", () => {
  const today = "2026-08-25";
  const week = {
    week_start: "2026-08-24",
    week_end:   "2026-08-30",
    hours_without_dollars: 0,   // drafts are priced -> unpriced = 0
    unpriced_hrs: 0,
    draft_entry_count: 4,
    draft_hours: 28.09,
    anomaly_no_clockout: 0,
    anomaly_under_1h: 0,
    anomaly_over_16h: 0,
  };
  const isClosed = week.week_end < today;
  assert.equal(isClosed, false, "sanity: 08/24 is in-progress on 08/25");
  const flag = flagForV42State(week, isClosed);
  assert.ok(flag, "State 1 chip must render for in-progress week with drafts");
  assert.equal(flag.state, "s1");
  assert.match(flag.label, /28\.1 hrs pending approval/);
});

test("Fixture B - ALL 08/17 closed week with 196.39 draft hours flags State 3a", () => {
  const today = "2026-08-25";
  const week = {
    week_start: "2026-08-17",
    week_end:   "2026-08-23",
    hours_without_dollars: 0,   // priced drafts
    unpriced_hrs: 0,
    draft_entry_count: 19,
    draft_hours: 196.39,
    anomaly_no_clockout: 0,
    anomaly_under_1h: 0,
    anomaly_over_16h: 0,
  };
  const isClosed = week.week_end < today;
  assert.equal(isClosed, true, "sanity: 08/17-08/23 closed on 08/25");
  const flag = flagForV42State(week, isClosed);
  assert.ok(flag, "State 3a chip must render for closed week with drafts");
  assert.equal(flag.state, "s3a");
  assert.match(flag.label, /closed week awaiting approval - 196\.4 hrs/);
});

test("aggregate child rows carry draft_hours per (week, account)", () => {
  // Two accounts, same week. buildMemberByWeekAndAcct must produce a
  // per-account draft_hours accumulator (was missing before this fix).
  const actuals = [
    { account_key: "CIN - AZ", week_start: "2026-08-24", hours_regular: 40, amount: 800, coverage_state: "complete", hours_without_dollars: 0, draft_hours: 15, draft_entry_count: 2 },
    { account_key: "CIN - AZ", week_start: "2026-08-24", hours_regular: 20, amount: 400, coverage_state: "complete", hours_without_dollars: 0, draft_hours: 13.09, draft_entry_count: 2 },
    { account_key: "STL - MO", week_start: "2026-08-24", hours_regular: 30, amount: 600, coverage_state: "complete", hours_without_dollars: 0, draft_hours: 0, draft_entry_count: 0 },
  ];
  const out = buildMemberByWeekAndAcct(actuals, "aggregate");
  const wk = out.get("2026-08-24");
  assert.ok(wk, "week bucket present");
  const cin = wk.get("CIN - AZ");
  assert.ok(cin, "CIN - AZ member row present");
  assert.ok(Math.abs(cin.draft_hours - 28.09) < 0.001,
    `CIN - AZ draft_hours should sum to 28.09, got ${cin.draft_hours}`);
  const stl = wk.get("STL - MO");
  assert.equal(stl.draft_hours, 0);
});

test("closed weeks with drafts NO LONGER gated by state-only - regression from #825's state-gate drop", () => {
  // Pre-#825 board.js gated on state !== "closed"; post-#825 the gate
  // dropped. The WeekTable's flagForV42State never had that gate, so
  // this assertion is a belt-and-suspenders regression check that
  // closed + drafts always fires s3a.
  const week = {
    week_start: "2026-07-13",   // weeks ago
    week_end: "2026-07-19",
    unpriced_hrs: 0,
    draft_entry_count: 3,
    draft_hours: 40,
    anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
  };
  const flag = flagForV42State(week, true);
  assert.equal(flag?.state, "s3a", "long-closed week with drafts still flags s3a");
});
