#!/usr/bin/env node
// scripts/probes/_probe_overview_same_horizon_target_pct.mjs
//
// Permanent assertion. Read-only.
//
// Rule updated PR-1 (Kevin 2026-09-02): target percent is budget/
// budget on FULL-PERIOD sums, not to-date. Kevin's rule "target is
// identical on day 1 and day 28" applies across FYTD too - to-date
// on both sides is invariant WITHIN a single period (proration
// cancels) but drifts on multi-period ranges as the running period
// elapses. Full-period is invariant across the fiscal year.
//
// Rule superseded (pre PR-1): target_pct = budget_to_date /
// revenue_budget_to_date. That form is still correct on single-
// period ranges but drifts on FYTD.
//
// Surfaces asserted per (account, range):
//   - cards.cogs.target_pct_of_revenue
//   - cards.gross_margin.target_pct_of_revenue
//   - levers[*].target_pct
//
// Invariant:
//   target_pct = cogs_period_budget / revenue_period_budget * 100
//   (using statement_totals.{cogs,revenue}.period_budget)
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
    const cogs = (d.cards || []).find(x => x.key === "cogs") || {};
    const gm = (d.cards || []).find(x => x.key === "gross_margin") || {};
    // PR-1 (2026-09-02): use full-period sums for the invariant.
    const revBudFull = d.statement_totals?.revenue?.period_budget;
    const cogsBudFull = d.statement_totals?.cogs?.period_budget;
    if (revBudFull == null || revBudFull <= 0) {
      console.log(`  SKIP  ${fmtCase(c)}  statement_totals.revenue.period_budget null or zero`);
      continue;
    }

    // COGS card: target% == cogs_full / rev_full * 100.
    const cogsTargetPct = cogs.target_pct_of_revenue;
    const cogsExpectedPct = (cogsBudFull / revBudFull) * 100;
    const seededDefectPct = SEEDED ? cogsExpectedPct + 5 : null;
    const cogsPctToCheck = SEEDED ? seededDefectPct : cogsExpectedPct;
    const cogsOk = cogsPctToCheck != null && approxEq(cogsTargetPct, cogsPctToCheck, TOL_PCT);
    const cogsLabel = SEEDED ? "cogs (seed OFFSET)" : "cogs";
    if (cogsOk) pass += 1; else fail += 1;
    console.log(`  ${cogsOk ? "PASS" : "FAIL"}  ${fmtCase(c)}  ${cogsLabel}  target=${cogsTargetPct?.toFixed(2)}%  expected=${cogsPctToCheck?.toFixed(2)}%  (revBudFull=${revBudFull}  cogsBudFull=${cogsBudFull})`);

    // GM card: target% == (rev_full - cogs_full) / rev_full * 100.
    if (gm.target_pct_of_revenue != null && cogsBudFull != null) {
      const gmExpected = ((revBudFull - cogsBudFull) / revBudFull) * 100;
      const gmToCheck = SEEDED ? gmExpected - 15 : gmExpected;
      const gmOk = approxEq(gm.target_pct_of_revenue, gmToCheck, TOL_PCT);
      if (gmOk) pass += 1; else fail += 1;
      console.log(`  ${gmOk ? "PASS" : "FAIL"}  ${fmtCase(c)}  ${SEEDED ? "gm (seed offset)" : "gm"}    target=${gm.target_pct_of_revenue.toFixed(2)}%  expected=${gmToCheck.toFixed(2)}%`);
    }

    // Levers: each lever's target_pct == line_budget_full / rev_full.
    // Sum across levers: sum(target_pct) * rev_full / 100 == cogs_full.
    const levers = d.levers || [];
    let leverSumBudDerived = 0;
    let leverAnyNull = false;
    for (const L of levers) {
      if (L.target_pct == null) { leverAnyNull = true; break; }
      leverSumBudDerived += (L.target_pct / 100) * revBudFull;
    }
    if (!leverAnyNull && cogsBudFull != null) {
      const okLevers = approxEq(leverSumBudDerived, cogsBudFull, 5);
      if (okLevers) pass += 1; else fail += 1;
      console.log(`  ${okLevers ? "PASS" : "FAIL"}  ${fmtCase(c)}  levers sum  derived_sum=${leverSumBudDerived.toFixed(2)}  cogsBudFull=${cogsBudFull}`);
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
