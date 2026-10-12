// sc-chase guard - stop chasing fully-entered weeks.
//
// The chase cron sends Jennifer-and-friends a "0 of N days not entered"
// reminder if a week was fully entered but not yet finalized. That
// scenario is the common state for biweekly first-weeks (CIN - AZ Oct 5
// 2026 fired it live) because they cannot be finalized until the pair
// closes. The fix adds one skip in the live send loop:
//
//   if (isWeekFullyEntered(comp)) { log.push(...); continue; }
//
// placed BEFORE the dry-run report block AND the sc_week_chase_sent
// ledger insert, so no email, no Slack, no ledger row for the skipped
// week. Both stages (N3.reminder + N3.urgent) share the loop, so one
// guard covers both.
//
// The predicate is a pure function on computeWeekCompleteness's output.
// It is tested here directly - this proves the decision logic; code
// review confirms the inline if (route.js) calls the predicate. Mocking
// the whole GET handler (6+ Supabase queries, 4 cross-module imports,
// Next.js Request / Response plumbing) would quadruple this test file
// to prove the same decision.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isWeekFullyEntered } from "../isWeekFullyEntered.js";

// ─── Case 1: fully-entered week -> skip (no send, no ledger) ──────
test("sc-chase: fully-entered week predicate returns true (no send, no ledger write)", () => {
  // Mirrors the real CIN - AZ Oct 5 state: all five service days entered,
  // Sat/Sun planned-off, 0 missing. computeWeekCompleteness shape per
  // scWeekFinalize.js (serviceDays + serviceDaysEntered + missingDates).
  const comp = {
    serviceDays:         5,
    serviceDaysEntered:  5,
    missingDates:        [],
  };
  assert.equal(
    isWeekFullyEntered(comp),
    true,
    "biweekly first-week, complete, unfinalized: predicate must return true so the guard skips before the ledger insert and the email/Slack send"
  );
  // Empty / absent missingDates (defensive): same decision.
  assert.equal(isWeekFullyEntered({ serviceDays: 5, serviceDaysEntered: 5 }), true, "absent missingDates treated as empty");
  assert.equal(isWeekFullyEntered({}), true, "empty comp treated as fully entered (defensive)");
  assert.equal(isWeekFullyEntered(null), true, "null comp treated as fully entered (defensive)");
});

// ─── Case 2: incomplete week -> chase still fires (no regression) ──
test("sc-chase: week with any missing days predicate returns false (chase still fires)", () => {
  // One missing day in the middle of the week: chase still fires. This
  // is the regression anchor - the guard must NOT swallow a legitimate
  // chase just because the other six days are entered.
  const compOneMissing = {
    serviceDays:         7,
    serviceDaysEntered:  6,
    missingDates:        ["2026-10-07"],
  };
  assert.equal(isWeekFullyEntered(compOneMissing), false, "one missing day: chase must still fire");

  // All seven days missing: chase definitely fires.
  const compAllMissing = {
    serviceDays:         7,
    serviceDaysEntered:  0,
    missingDates:        ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"],
  };
  assert.equal(isWeekFullyEntered(compAllMissing), false, "all seven missing: chase must fire");
});

// ─── Case 3: wiring guard - the inline if calls the predicate ──────
// Static check that the route file imports/uses isWeekFullyEntered
// before the ledger insert and the dry-run branch. Catches an
// accidental revert of the guard without exercising the full handler.
test("sc-chase: route.js wires the predicate before the ledger insert and dry-run branch", () => {
  const here = fileURLToPath(import.meta.url);
  const routePath = path.resolve(here, "..", "..", "route.js");
  const src = readFileSync(routePath, "utf8");
  const guardIdx = src.indexOf("if (isWeekFullyEntered(comp))");
  const dryRunIdx = src.indexOf("if (dryRun) {");
  const insertIdx = src.indexOf('.from("sc_week_chase_sent")');
  assert.ok(guardIdx > 0, "route.js must call isWeekFullyEntered(comp) inside GET");
  assert.ok(dryRunIdx > guardIdx, "guard must sit BEFORE the dry-run branch (same skip in reporting + send paths)");
  assert.ok(insertIdx > guardIdx, "guard must sit BEFORE the sc_week_chase_sent insert (no ledger row written on skip)");
});
