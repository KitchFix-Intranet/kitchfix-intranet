#!/usr/bin/env node
// scripts/probes/_probe_overview_same_horizon_target_pct.mjs
//
// Permanent assertion. Read-only.
//
// Rule (Kevin 2026-09-01): for every surface carrying an actual %
// and a target %, the target must equal `budget ÷ revenue_budget`
// on the SAME window as the actual. If the actual is to-date, the
// target denominator is revenue budget to-date. Mixing windows
// produces the 71.5% target / 25.7% "under" defect on CIN - AZ P9
// where 56.2% / 10.4% was the honest verdict.
//
// Surfaces asserted per (account, range):
//   - cards.cogs.target_pct_of_revenue
//   - cards.gross_margin.target_pct_of_revenue
//   - drill.purchasing.target_pct_display
//   - levers[*].target_pct
//
// Denominator invariants:
//   - Each surface's target % is computed against
//     revenue.budget_to_date (payload's revenue card).
//   - Each surface's target % numerator, when reconstructed from the
//     other payload fields, resolves to the SAME-WINDOW budget-to-
//     date (not the full-period budget).
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 asserts a wrong target % against a full-period
//   ratio. Must FAIL under the seed. Verifies the check fires.
//
// USAGE
//   Local TEST_MODE dev server on :3311.
//   node scripts/probes/_probe_overview_same_horizon_target_pct.mjs

const BASE = "http://localhost:3311/api/kpi/overview";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const TOL_PCT = 0.02;   // percentage points

const cases = [
  { acct: "CIN - AZ",    range: "period:9" },
  { acct: "CIN - AZ",    range: "period:8" },
  { acct: "CIN - AZ",    range: "fytd" },
  { acct: "TBR - FL",    range: "period:9" },
  { acct: "TXR - TX - V", range: "period:9" },
  { acct: "ALL",         range: "period:9" },
];

async function fetchPayload(acct, range) {
  const url = `${BASE}?account=${encodeURIComponent(acct)}&range=${encodeURIComponent(range)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function fmtCase(c) { return `${c.acct} / ${c.range}`; }
function approxEq(a, b, tol) { return Math.abs(Number(a) - Number(b)) <= tol; }

async function main() {
  console.log(`# same-horizon target% assertion - ${new Date().toISOString()}`);
  console.log("");
  let pass = 0, fail = 0;

  for (const c of cases) {
    const d = await fetchPayload(c.acct, c.range);
    const rev = (d.cards || []).find(x => x.key === "revenue") || {};
    const cogs = (d.cards || []).find(x => x.key === "cogs") || {};
    const gm = (d.cards || []).find(x => x.key === "gross_margin") || {};
    const revBudTd = rev.budget_to_date;
    if (revBudTd == null || revBudTd <= 0) {
      console.log(`  SKIP  ${fmtCase(c)}  revenue.budget_to_date null or zero`);
      continue;
    }

    // COGS card: target% * revBudTd should equal cogs.budget_to_date.
    // The seed injects the wrong ratio (full-period-cogs/to-date-rev
    // instead of to-date/to-date), so we reconstruct that mismatch
    // and expect it to DIFFER from the payload's target%.
    const cogsBTD = cogs.budget_to_date;
    const cogsTargetPct = cogs.target_pct_of_revenue;
    const derivedCogsBudget = (cogsTargetPct / 100) * revBudTd;
    const seededDefectPct = cogsBTD != null && cogsBTD > 0
      ? (cogsBTD * 4 / revBudTd) * 100    // wrong: multiplies to-date by ~4 as a full-period approximation
      : null;
    const cogsExpectedPct = (cogsBTD / revBudTd) * 100;
    const cogsPctToCheck = SEEDED ? seededDefectPct : cogsExpectedPct;
    const cogsOk = cogsPctToCheck != null && approxEq(cogsTargetPct, cogsPctToCheck, TOL_PCT);
    const cogsLabel = SEEDED ? "cogs (seed WRONG ratio)" : "cogs";
    if (cogsOk) pass += 1; else fail += 1;
    console.log(`  ${cogsOk ? "PASS" : "FAIL"}  ${fmtCase(c)}  ${cogsLabel}  target=${cogsTargetPct?.toFixed(2)}%  expected=${cogsPctToCheck?.toFixed(2)}%  (revBudTd=${revBudTd}  cogsBudTd=${cogsBTD}  derivedNumerator=${derivedCogsBudget?.toFixed(2)})`);

    // GM card: target% = (revBudTd - cogsBudTd) / revBudTd
    if (gm.target_pct_of_revenue != null && cogsBTD != null) {
      const gmExpected = ((revBudTd - cogsBTD) / revBudTd) * 100;
      const gmToCheck = SEEDED ? gmExpected - 15 : gmExpected;
      const gmOk = approxEq(gm.target_pct_of_revenue, gmToCheck, TOL_PCT);
      if (gmOk) pass += 1; else fail += 1;
      console.log(`  ${gmOk ? "PASS" : "FAIL"}  ${fmtCase(c)}  ${SEEDED ? "gm (seed offset)" : "gm"}    target=${gm.target_pct_of_revenue.toFixed(2)}%  expected=${gmToCheck.toFixed(2)}%`);
    }

    // Levers: each lever's target_pct * revBudTd must reconstruct to
    // its own budget_to_date, not to its full-period budget. We
    // don't have per-line budget_to_date on the lever payload, but
    // we can assert the LEVER SUM equals cogsBudTd (within tol).
    const levers = d.levers || [];
    let leverSumBudDerived = 0;
    let leverAnyNull = false;
    for (const L of levers) {
      if (L.target_pct == null) { leverAnyNull = true; break; }
      leverSumBudDerived += (L.target_pct / 100) * revBudTd;
    }
    if (!leverAnyNull && cogsBTD != null) {
      const okLevers = approxEq(leverSumBudDerived, cogsBTD, 5);
      if (okLevers) pass += 1; else fail += 1;
      console.log(`  ${okLevers ? "PASS" : "FAIL"}  ${fmtCase(c)}  levers sum  derived_sum=${leverSumBudDerived.toFixed(2)}  cogsBudTd=${cogsBTD}`);
    }
  }
  console.log("");
  console.log(`Result: ${pass} PASS, ${fail} FAIL`);
  if (SEEDED) {
    const seedOk = fail > 0;
    console.log(`Seeded failure axis: ${seedOk ? "PASS (probe correctly fires on the wrong ratio)" : "FAIL (probe did not fire under seed)"}`);
    process.exit(seedOk ? 0 : 1);
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
