#!/usr/bin/env node
// scripts/probes/_probe_finance_close_no_double_count.mjs
//
// Kevin ruling 2026-09-18 · Guard J.
// The parent line is computed once. Assert on every {account, range}
// that a parent's actual equals the sum of all statement_rows whose
// parent_line_code === parent.line_code. If any downstream consumer
// starts re-deriving a parent from children (or the FIN_CLOSE emit
// double-counts), this probe fires with the specific parent that broke.
//
// Standing rule E-4 (Kevin 2026-09-18): a live-only check passes
// because the bug is absent, not because the guard works. This probe
// runs a seeded self-test BEFORE the live pass and refuses to proceed
// unless the invariant function fires the right verdict on constructed
// double-count scenarios. If the self-test regresses, no live check runs.
//
// Skip rule: a parent absent OR null on an account expected to carry
// one is a FAILURE, not a skip. Exception: R-98 says 3100 sub-rows are
// omitted on the hourly view (include_salary != 1); that specific case
// is opt-in via `allowNoChildrenOn`.
//
// USAGE (Guard L requires the dev server at :3000)
//   TEST_MODE=true nohup npm run dev > /tmp/kf-dev.log 2>&1 &
//   node --env-file=.env.local scripts/probes/_probe_finance_close_no_double_count.mjs

import { absorbFinanceCloseIntoSubLines, buildFinanceCloseRow } from "../../src/lib/kpi/shared/financeCloseAbsorb.js";

const BASE = process.env.PROBE_BASE || "http://localhost:3000";
const HEADERS = {};
const TOL = 0.02;
const PARENTS = ["3100", "3200", "3400", "3500"];

// ─── The invariant function under test ─────────────────────────────
// For each parent in PARENTS:
//   - Parent row must exist and have a non-null `actual`.
//   - Children (parent_line_code === parent) must exist unless the
//     parent is on `allowNoChildrenOn` (R-98 hourly-view carve-out).
//   - Sum of children.actual must equal parent.actual within TOL.
// Returns an array of failure strings. Empty array === passing.
function assertParentChildInvariant(statementRows, { allowNoChildrenOn = [], label = "" } = {}) {
  const failures = [];
  for (const parent of PARENTS) {
    const parentRow = statementRows.find(r => r.line_code === parent && !r.parent_line_code);
    const children = statementRows.filter(r => r.parent_line_code === parent);

    if (!parentRow) {
      failures.push(`${label}${parent}: parent row ABSENT (should exist on every account)`);
      continue;
    }
    if (parentRow.actual == null) {
      failures.push(`${label}${parent}: parent.actual is null (should have a value)`);
      continue;
    }
    if (children.length === 0) {
      if (allowNoChildrenOn.includes(parent)) continue;   // R-98 case
      failures.push(`${label}${parent}: children ABSENT (expected >=1)`);
      continue;
    }
    const childSum = children.reduce((s, r) => s + Number(r.actual || 0), 0);
    const diff = Math.round((Number(parentRow.actual) - childSum) * 100) / 100;
    if (Math.abs(diff) >= TOL) {
      failures.push(`${label}${parent}: parent=${Number(parentRow.actual).toFixed(2)} child_sum=${childSum.toFixed(2)} diff=${diff.toFixed(2)}`);
    }
  }
  return failures;
}

// ─── Seeded self-test (E-4) ────────────────────────────────────────
// Build synthetic statement_rows for a known scenario and prove the
// invariant fires the right verdict on:
//   1. correct       ->  no failures
//   2. FIN_CLOSE 2x  ->  double-count on child side, FAIL expected
//   3. parent 2x     ->  double-count on parent side, FAIL expected
//   4. absent parent ->  FAIL expected (skip-turned-failure)
//   5. absent child  ->  FAIL expected on parents that should have kids
//   6. R-98 hourly   ->  no failures when 3100 is on allow-list
function runSeededSelfTest() {
  const baseCorrect = [
    // TBJ - FL P9 shape - real numbers
    { line_code: "3100", actual: 42509.96 },
    { line_code: "3100.1", parent_line_code: "3100", actual: 25854.57 },
    { line_code: "3100.2", parent_line_code: "3100", actual: 16655.39 },
    { line_code: "3100.FIN_CLOSE", parent_line_code: "3100", actual: 0.00, flags: ["finance_close_adjustment"] },
    { line_code: "3200", actual: 40497.84 },
    { line_code: "3200.1", parent_line_code: "3200", actual: 38781.84 },
    { line_code: "3200.2", parent_line_code: "3200", actual: 1716.00 },
    { line_code: "3200.INVJE", parent_line_code: "3200", actual: -331.06, flags: ["inventory_adjustment"] },
    { line_code: "3200.FIN_CLOSE", parent_line_code: "3200", actual: 331.06, flags: ["finance_close_adjustment"] },
    { line_code: "3400", actual: 3778.29 },
    { line_code: "3400.1", parent_line_code: "3400", actual: 150.00 },
    { line_code: "3400.2", parent_line_code: "3400", actual: 2605.54 },
    { line_code: "3400.5", parent_line_code: "3400", actual: 1022.75 },
    { line_code: "3500", actual: 735.60 },
    { line_code: "3500.2", parent_line_code: "3500", actual: 611.41 },
    { line_code: "3500.4", parent_line_code: "3500", actual: 124.19 },
  ];
  const results = [];

  // Case 1: correct - PASS expected
  {
    const fails = assertParentChildInvariant(baseCorrect, { label: "seed-correct " });
    results.push({ name: "correct payload", expect: "PASS", actual: fails.length === 0 ? "PASS" : "FAIL", detail: fails });
  }

  // Case 2: FIN_CLOSE emitted twice on 3200 - child sum is $331.06 over parent, FAIL expected
  {
    const rows = [...baseCorrect,
      { line_code: "3200.FIN_CLOSE_DUP", parent_line_code: "3200", actual: 331.06, flags: ["finance_close_adjustment"] }];
    const fails = assertParentChildInvariant(rows, { label: "seed-dup-fin " });
    const shouldMention3200 = fails.some(f => f.includes("3200:"));
    results.push({ name: "FIN_CLOSE emitted twice", expect: "FAIL on 3200", actual: shouldMention3200 ? "FAIL as expected" : "UNEXPECTED PASS", detail: fails });
  }

  // Case 3: parent 3100 doubled (adjustment applied twice on parent side), FAIL expected
  {
    const rows = baseCorrect.map(r =>
      (r.line_code === "3100" && !r.parent_line_code) ? { ...r, actual: 42509.96 + 2058.08 } : r
    );
    const fails = assertParentChildInvariant(rows, { label: "seed-parent-dup " });
    const should = fails.some(f => f.includes("3100:"));
    results.push({ name: "parent doubled on 3100", expect: "FAIL on 3100", actual: should ? "FAIL as expected" : "UNEXPECTED PASS", detail: fails });
  }

  // Case 4: parent 3400 absent (row missing entirely) - FAIL expected
  {
    const rows = baseCorrect.filter(r => !(r.line_code === "3400" && !r.parent_line_code));
    const fails = assertParentChildInvariant(rows, { label: "seed-absent-parent " });
    const should = fails.some(f => f.includes("3400:") && f.includes("ABSENT"));
    results.push({ name: "parent 3400 absent", expect: "FAIL absent", actual: should ? "FAIL as expected" : "UNEXPECTED PASS", detail: fails });
  }

  // Case 5: 3400 children absent (parent exists but no sub-lines) - FAIL expected UNLESS allow-listed
  {
    const rows = baseCorrect.filter(r => r.parent_line_code !== "3400");
    const fails = assertParentChildInvariant(rows, { label: "seed-no-children " });
    const should = fails.some(f => f.includes("3400:") && f.includes("ABSENT"));
    results.push({ name: "3400 children absent (no allow-list)", expect: "FAIL absent", actual: should ? "FAIL as expected" : "UNEXPECTED PASS", detail: fails });
  }

  // Case 6: R-98 hourly view - 3100 has no children, but allow-listed. Other parents intact.
  {
    const rows = baseCorrect.filter(r => r.parent_line_code !== "3100");
    const fails = assertParentChildInvariant(rows, { allowNoChildrenOn: ["3100"], label: "seed-r98-hourly " });
    results.push({ name: "R-98 hourly view (3100 allow-listed)", expect: "PASS", actual: fails.length === 0 ? "PASS" : "FAIL", detail: fails });
  }

  // ─── R-126 additions ───────────────────────────────────────────────
  // Case 7: absorb helper on a real scenario - proves the helper folds
  // the adjustment onto the largest sub-line, drops the FIN_CLOSE row,
  // and Guard J holds. Uses CIN - AZ P9 3200 shape.
  {
    const rows = [
      { line_code: "3200", actual: 25416.87 },
      { line_code: "3200.1", parent_line_code: "3200", actual: 24209.47, reported: true, budget_at_this_revenue: 20000, target_pct: 25, sources: ["purchasing_actuals"], flags: [] },
      { line_code: "3200.2", parent_line_code: "3200", actual: 1000.00, reported: true, budget_at_this_revenue: 900, target_pct: 5, sources: ["purchasing_actuals"], flags: [] },
      { line_code: "3200.INVJE", parent_line_code: "3200", actual: 1380.00, reported: true, flags: ["inventory_adjustment"], sources: ["inventory_adjustments"] },
    ];
    const financeClose = {
      has_any_verified: true,
      verified_periods: [9],
      per_parent: new Map([["3200", { parent: "3200", adjustment: -172.60, by_period: [{ period_no: 9, amount: -172.60 }] }]]),
    };
    const { applied, fallbackRows } = absorbFinanceCloseIntoSubLines(rows, financeClose, { totalRevenue: 100000 });
    const absorbedRow = rows.find(r => r.line_code === "3200.1");
    const finCloseSurvivor = rows.filter(r => String(r.line_code).endsWith(".FIN_CLOSE"));
    const okAbsorbed = absorbedRow && Math.abs(absorbedRow.actual - (24209.47 - 172.60)) < 0.02;
    const okFlags = absorbedRow && Array.isArray(absorbedRow.flags) && absorbedRow.flags.includes("finance_close_absorbed");
    const okNoFinClose = finCloseSurvivor.length === 0;
    const okAppliedShape = applied.length === 1 && applied[0].absorber_line_code === "3200.1" && !applied[0].went_negative;
    const okFallback = fallbackRows.length === 0;
    const allOk = okAbsorbed && okFlags && okNoFinClose && okAppliedShape && okFallback;
    results.push({ name: "R-126 absorb onto largest sub-line", expect: "PASS", actual: allOk ? "PASS" : "FAIL", detail: { okAbsorbed, okFlags, okNoFinClose, okAppliedShape, okFallback, absorbed: absorbedRow?.actual, applied } });
  }

  // Case 8: R-126 rule 5 backstop - no absorbable candidate under a
  // parent (unreported-only sub-lines). Helper must emit a FIN_CLOSE
  // row so Guard J holds and the fallback branch is proven reachable.
  {
    const rows = [
      { line_code: "3500", actual: 735.60 },
      { line_code: "3500.2", parent_line_code: "3500", actual: null, reported: false, sources: [], flags: [] },
      { line_code: "3500.3", parent_line_code: "3500", actual: null, reported: false, sources: [], flags: [] },
    ];
    const financeClose = {
      has_any_verified: true,
      verified_periods: [9],
      per_parent: new Map([["3500", { parent: "3500", adjustment: 100.00, by_period: [{ period_no: 9, amount: 100.00 }] }]]),
    };
    const { applied, fallbackRows } = absorbFinanceCloseIntoSubLines(rows, financeClose, { totalRevenue: 100000 });
    const finCloseEmitted = rows.filter(r => String(r.line_code).endsWith(".FIN_CLOSE"));
    const okFallback = fallbackRows.length === 1 && String(fallbackRows[0].line_code) === "3500.FIN_CLOSE" && Math.abs(fallbackRows[0].actual - 100.00) < 0.02;
    const okAppliedEmpty = applied.length === 0;
    const okRowPushed = finCloseEmitted.length === 1;
    const allOk = okFallback && okAppliedEmpty && okRowPushed;
    results.push({ name: "R-126 rule 5 backstop emits FIN_CLOSE", expect: "PASS", actual: allOk ? "PASS" : "FAIL", detail: { okFallback, okAppliedEmpty, okRowPushed, fallbackRows: fallbackRows.map(r => r.line_code) } });
  }

  // Case 9: R-126 negative guard - top candidate would go negative;
  // walk down to next candidate. Setup: 3400.1=$150 (largest by name
  // but smaller by |actual|), 3400.2=$100, and a -$120 adjustment.
  // Ranking by |actual| desc: [3400.1 ($150), 3400.2 ($100)]. Top is
  // 3400.1; 150 - 120 = 30 >= 0, so 3400.1 absorbs. Not exercised.
  // Real test: top=3400.1=$150 with adj=-$200. Top would go to -50;
  // walk down to 3400.2=$100 which would go to -100 (also negative).
  // No candidate stays non-negative; use top and set went_negative=true.
  {
    const rows = [
      { line_code: "3400", actual: 1000 },
      { line_code: "3400.1", parent_line_code: "3400", actual: 150, reported: true, sources: ["purchasing_actuals"], flags: [] },
      { line_code: "3400.2", parent_line_code: "3400", actual: 100, reported: true, sources: ["purchasing_actuals"], flags: [] },
      { line_code: "3400.INVJE", parent_line_code: "3400", actual: 50, reported: true, flags: ["inventory_adjustment"], sources: ["inventory_adjustments"] },
    ];
    const financeClose = {
      has_any_verified: true,
      verified_periods: [9],
      per_parent: new Map([["3400", { parent: "3400", adjustment: -200, by_period: [{ period_no: 9, amount: -200 }] }]]),
    };
    const { applied } = absorbFinanceCloseIntoSubLines(rows, financeClose, { totalRevenue: 100000 });
    const absorbed = rows.find(r => r.line_code === "3400.1");
    const okAbsorbed = absorbed && Math.abs(absorbed.actual - (-50)) < 0.02;
    const okFlagged = applied.length === 1 && applied[0].went_negative === true;
    results.push({ name: "R-126 negative guard (top candidate)", expect: "PASS", actual: (okAbsorbed && okFlagged) ? "PASS" : "FAIL", detail: { absorbed: absorbed?.actual, applied } });
  }

  return results;
}

// ─── Run seeded self-test first ────────────────────────────────────
console.log("═══ E-4 seeded self-test ═══════════════════════════════════════════════");
const selfResults = runSeededSelfTest();
let selfOk = true;
for (const r of selfResults) {
  const line = `  ${r.name.padEnd(45)}  expect=${r.expect.padEnd(15)}  got=${r.actual}`;
  console.log(line);
  const passed = r.actual === "PASS" || r.actual === "FAIL as expected";
  if (!passed) {
    selfOk = false;
    console.error(`    detail: ${JSON.stringify(r.detail)}`);
  }
}
if (!selfOk) {
  console.error("\n═══ SELF-TEST REGRESSED · aborting live check ══════════════════════════");
  console.error("The invariant function itself no longer fires the right verdict.");
  console.error("Fix the invariant before running against live data.");
  process.exit(2);
}
console.log("  self-test: OK · invariant fires correctly on constructed scenarios\n");

// ─── Live pass ─────────────────────────────────────────────────────
const CASES = [
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06", expected: { cogs: 87521.69 }, name: "TBJ - FL P9",           allowNoChildrenOn: [] },
  { account: "TXR - AZ", start: "2026-08-10", end: "2026-09-06", expected: { cogs: 55498.46 }, name: "TXR - AZ P9",           allowNoChildrenOn: [] },
  { account: "CIN - OH", start: "2026-08-10", end: "2026-09-06", expected: { cogs: 23113.00 }, name: "CIN - OH P9 pass-thru", allowNoChildrenOn: [] },
  { account: "TBJ - NY", start: "2026-08-10", end: "2026-09-06", expected: { cogs: 15468.10 }, name: "TBJ - NY P9 fee",       allowNoChildrenOn: [] },
];

console.log("═══ Live Guard J · parent = sum(children) on every audit + non-audit account ═══");
let liveOk = true;
for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const url = `${BASE}/api/kpi/overview?${qs.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.error(`  ${c.name}: fetch FAIL · ${res.status} · ${(await res.text()).slice(0, 200)}`);
    liveOk = false;
    continue;
  }
  const body = await res.json();
  const rows = body.statement_rows || [];
  const fails = assertParentChildInvariant(rows, { allowNoChildrenOn: c.allowNoChildrenOn, label: `${c.name} · ` });

  console.log(`\n─── ${c.name} · ${c.account} · ${c.start} to ${c.end} ─────`);
  for (const parent of PARENTS) {
    const parentRow = rows.find(r => r.line_code === parent && !r.parent_line_code);
    const children = rows.filter(r => r.parent_line_code === parent);
    const parentActual = parentRow ? Number(parentRow.actual || 0) : null;
    const childSum = children.reduce((s, r) => s + Number(r.actual || 0), 0);
    const diff = parentActual != null ? Math.round((parentActual - childSum) * 100) / 100 : "N/A";
    const finCloseRow = children.find(r => (r.flags || []).includes("finance_close_adjustment"));
    const invjeRow = children.find(r => r.line_code === `${parent}.INVJE`);
    console.log(`  ${parent}: parent=${parentActual != null ? parentActual.toFixed(2).padStart(10) : "     null "}  child_sum=${childSum.toFixed(2).padStart(10)}  diff=${String(diff).padStart(8)}  ` +
      `subs=${children.length - (finCloseRow ? 1 : 0) - (invjeRow ? 1 : 0)}  INVJE=${(invjeRow ? Number(invjeRow.actual || 0) : 0).toFixed(2).padStart(9)}  FIN_CLOSE=${(finCloseRow ? Number(finCloseRow.actual || 0) : 0).toFixed(2).padStart(9)}`);
  }
  if (fails.length === 0) {
    console.log(`  · OK`);
  } else {
    console.error(`  · FAIL`);
    for (const f of fails) console.error(`    ${f}`);
    liveOk = false;
  }

  const cogsCard = (body.cards || []).find(x => x.key === "cogs");
  if (cogsCard) {
    const hero = Number(cogsCard.hero_actual);
    const cogsDiff = Math.abs(hero - c.expected.cogs);
    console.log(`  cogs card hero_actual = $${hero.toFixed(2)} · expect $${c.expected.cogs.toFixed(2)} · diff=${cogsDiff.toFixed(2)}${cogsDiff < 0.02 ? " · OK" : " · FAIL"}`);
    if (cogsDiff >= 0.02) liveOk = false;
  }

  // R-126 · no `.FIN_CLOSE` row survives on any live payload. Rule 5
  // backstop is the only path that would emit one; the probe asserts
  // it does not fire in production. If it does, that account's parent
  // has no absorbable sub-line and needs individual attention.
  const finCloseSurvivors = rows.filter(r => String(r.line_code).endsWith(".FIN_CLOSE"));
  if (finCloseSurvivors.length > 0) {
    console.error(`  R-126 FAIL: ${finCloseSurvivors.length} .FIN_CLOSE row(s) surfaced on ${c.name}: ${finCloseSurvivors.map(r => r.line_code).join(", ")}`);
    liveOk = false;
  } else {
    console.log(`  R-126 · no .FIN_CLOSE rows in payload · OK`);
  }
}

// ─── Guard L · Labor board reconciles feeds + adjustment ───────────
console.log("\n═══ Guard L · labor.board.spent_to_date == feeds + adjustment ══════════");
for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const url = `${BASE}/api/kpi/labor?${qs.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) { console.error(`  ${c.name}: labor fetch FAIL ${res.status}`); liveOk = false; continue; }
  const body = await res.json();
  const board = body.board;
  if (!board || board.applies === false) { console.log(`  ${c.name}: labor board does not apply`); continue; }
  const spent = Number(board.spent_to_date ?? 0);
  const feeds = board.spent_to_date_feeds != null ? Number(board.spent_to_date_feeds) : spent;
  const fc = board.finance_close_adjustment;
  const adj = Number(fc?.total ?? 0);
  const check = feeds + adj;
  const diff = Math.round((spent - check) * 100) / 100;
  const status = Math.abs(diff) < 0.02 ? "OK" : "FAIL";
  if (status === "FAIL") liveOk = false;
  console.log(
    `  ${c.name}: spent=${spent.toFixed(2)} · feeds=${feeds.toFixed(2)} · adj=${adj.toFixed(2)} · feeds+adj=${check.toFixed(2)} · diff=${diff.toFixed(2)} · ${status}`
  );
}

// ─── Guard A · open period byte-identical ──────────────────────────
// P10 payload must carry NO finance_close_adjustment fields on labor
// and NO FIN_CLOSE rows on overview. The parent sources must NOT list
// pnl_actuals on an open range.
console.log("\n═══ Guard A · open period (P10) byte-identical ═════════════════════════");
{
  const qs = new URLSearchParams({ account: "TBJ - FL", start: "2026-09-07", end: "2026-10-04", include_salary: "1" });
  const overview = await (await fetch(`${BASE}/api/kpi/overview?${qs.toString()}`, { headers: HEADERS })).json();
  const labor = await (await fetch(`${BASE}/api/kpi/labor?${qs.toString()}`, { headers: HEADERS })).json();
  const rows = overview.statement_rows || [];
  const finClose = rows.filter(r => (r.flags || []).includes("finance_close_adjustment"));
  const overviewOk = finClose.length === 0;
  const board = labor.board || {};
  const laborOk = !("spent_to_date_feeds" in board) && !("finance_close_adjustment" in board);
  const parentsWithPnl = rows.filter(r => PARENTS.includes(r.line_code) && !r.parent_line_code && Array.isArray(r.sources) && r.sources.includes("pnl_actuals"));
  const sourcesOk = parentsWithPnl.length === 0;
  console.log(`  overview P10 FIN_CLOSE rows: ${finClose.length} · ${overviewOk ? "OK" : "FAIL"}`);
  console.log(`  labor P10 spent_to_date_feeds/finance_close_adjustment absent: ${laborOk ? "OK" : "FAIL"}`);
  console.log(`  overview P10 parent sources contain pnl_actuals: ${parentsWithPnl.length} · ${sourcesOk ? "OK" : "FAIL"}`);
  if (!overviewOk || !laborOk || !sourcesOk) liveOk = false;
}

console.log("");
if (!selfOk || !liveOk) {
  console.log("FAIL · at least one assertion tripped");
  process.exit(1);
} else {
  console.log("PASS · seeded self-test passes; every live parent equals sum of its children; open period byte-identical");
  process.exit(0);
}
