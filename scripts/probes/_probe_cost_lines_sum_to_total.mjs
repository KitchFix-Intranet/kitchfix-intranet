#!/usr/bin/env node
// scripts/probes/_probe_cost_lines_sum_to_total.mjs
//
// PR-2 items 8 + follow-up (Kevin, 2026-09-02). Cost-lines table
// row + total consistency. Kevin's first render mixed period
// budgets on rows with budget-to-date on the total; the second
// pass mixed envelope_delta (a card concept) on the dollar cell
// with variance_pct on the percent cell. Third pass locked in
// the correct OPERAND: dollar cell renders (actual -
// budget_at_this_revenue) which algebraically equals
// (percent_gap * revenue), so dollar direction and percent
// direction agree by construction.
//
// Assertions per (account, range):
//
//   Row-level internal consistency
//     envelope_delta = budget_to_date - budget_at_this_revenue
//     variance_pct   = actual_pct - target_pct
//     no half-null trio (btd/batr/envelope_delta) on scored rows
//
//   Server row-sum vs server total
//     sum(rows.actual) == statement_totals.cogs.actual
//
//   Sign-agreement (post the correct-operand fix)
//     Per scored row: (actual - batr) direction matches
//       variance_pct direction. Holds by construction because
//       both equal percent_gap * (revenue vs revenue base).
//     Per total row: same rule on scored sums.
//
//   pct-gap = variance-vs-batr / revenue (algebraic identity)
//     Per scored row: (actual - batr) equals (variance_pct/100)
//       * total_revenue within a cent-equivalent tolerance.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 fabricates (a) envelope_delta wrong,
//   (b) variance_pct wrong, (c) sign disagreement between dollar
//   and percent, (d) variance-vs-batr not equal to pct * rev.
//   All four must fire.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_cost_lines_sum_to_total.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_cost_lines_sum_to_total.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);
const CENT = 0.02;
const PCT_TOL = 0.05;
// pct-gap * revenue = variance-vs-batr. Rounding of pct at 4dp on
// large revenue values (~$2M) can drift by up to about $200 while
// still being algebraically correct. Cap the tolerance well below
// the smallest legitimate dollar disagreement Kevin would care about.
const PCT_TIMES_REV_TOL = 300;

const ACCOUNTS = [
  "TBR - FL", "TBJ - FL", "TXR - AZ", "CIN - AZ",
  "CIN - OH", "STL - FL", "STL - MO",
  "CIN - KY", "TBJ - NY",
  "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { tag: "P8 closed", qs: "start=2026-07-13&end=2026-08-09" },
  { tag: "P9 open",   qs: "start=2026-08-10&end=2026-09-06" },
  { tag: "FYTD",      qs: "" },
];

const FAILS = [];
function fail(where, why) { FAILS.push(`${where}  ${why}`); }

function isSuppressed(r) {
  const flags = Array.isArray(r.flags) ? r.flags : [];
  return flags.includes("billed_back") || flags.includes("inactive");
}

async function checkPayload(a, r) {
  const url = r.qs
    ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
    : `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const j = await (await fetch(url)).json();
  if (j.error) { fail(`${a} ${r.tag}`, `HTTP ${JSON.stringify(j.error)}`); return; }
  const cogsRows = (j.statement_rows || []).filter(x => x.section === "cogs" && !x.parent_line_code);
  if (cogsRows.length === 0) return;
  const totalRevenue = j.cards?.find(c => c.key === "revenue")?.hero_actual;

  for (const row of cogsRows) {
    if (isSuppressed(row)) continue;
    const nullSet = [row.budget_to_date, row.budget_at_this_revenue, row.envelope_delta].map(v => v == null);
    if (nullSet.some(x => x !== nullSet[0])) {
      fail(`${a} ${r.tag} ${row.line_code}`, `half-null: btd=${row.budget_to_date} batr=${row.budget_at_this_revenue} env=${row.envelope_delta}`);
      continue;
    }
    if (row.budget_to_date != null && row.budget_at_this_revenue != null && row.envelope_delta != null) {
      const derived = row.budget_to_date - row.budget_at_this_revenue;
      if (Math.abs(derived - row.envelope_delta) > CENT) {
        fail(`${a} ${r.tag} ${row.line_code}`, `envelope_delta ${row.envelope_delta} != btd-batr ${derived.toFixed(2)}`);
      }
    }
    if (row.variance_pct != null && row.actual_pct != null && row.target_pct != null) {
      const derived = row.actual_pct - row.target_pct;
      if (Math.abs(derived - row.variance_pct) > PCT_TOL) {
        fail(`${a} ${r.tag} ${row.line_code}`, `variance_pct ${row.variance_pct} != actual_pct - target_pct ${derived.toFixed(4)}`);
      }
    }
    // Sign-agreement (correct-operand form): (actual - batr) direction
    // must match variance_pct direction. Holds by construction after
    // the operand fix; the assertion catches drift.
    if (row.actual != null && row.budget_at_this_revenue != null && row.variance_pct != null) {
      const varianceVsBatr = row.actual - row.budget_at_this_revenue;
      const dollarUnder = varianceVsBatr <= 0;
      const pctUnder = row.variance_pct <= 0;
      if (dollarUnder !== pctUnder) {
        fail(`${a} ${r.tag} ${row.line_code}`,
          `sign disagreement: actual-batr=${varianceVsBatr.toFixed(2)} says ${dollarUnder ? "under" : "over"} but variance_pct=${row.variance_pct} says ${pctUnder ? "under" : "over"}`);
      }
    }
    // Algebraic identity: (actual - batr) equals (variance_pct / 100)
    // * total_revenue. Same comparison expressed in two units - dollars
    // vs percentage points. The tolerance absorbs pct rounding at 4dp
    // against large revenues.
    if (row.actual != null && row.budget_at_this_revenue != null
        && row.variance_pct != null && totalRevenue != null) {
      const varianceVsBatr = row.actual - row.budget_at_this_revenue;
      const derivedFromPct = (row.variance_pct / 100) * totalRevenue;
      if (Math.abs(varianceVsBatr - derivedFromPct) > PCT_TIMES_REV_TOL) {
        fail(`${a} ${r.tag} ${row.line_code}`,
          `algebraic drift: actual-batr=${varianceVsBatr.toFixed(2)} vs pct*rev=${derivedFromPct.toFixed(2)} (diff=${(varianceVsBatr - derivedFromPct).toFixed(2)})`);
      }
    }
  }

  const sumActual = cogsRows.reduce((s, r) => s + Number(r.actual || 0), 0);
  const totActual = j.statement_totals?.cogs?.actual;
  if (totActual != null && Math.abs(sumActual - totActual) > CENT) {
    fail(`${a} ${r.tag}`, `sum(rows.actual) ${sumActual.toFixed(2)} != total.actual ${Number(totActual).toFixed(2)}`);
  }

  // Total-row sign agreement: scored sum(actual - batr) direction
  // matches (cogsCard.pct - cogsCard.target_pct) direction.
  const scoredRows = cogsRows.filter(rr => !isSuppressed(rr));
  const scoredSumActual = scoredRows.reduce((s, rr) => s + Number(rr.actual || 0), 0);
  const scoredSumBatr = scoredRows.reduce((s, rr) => s + Number(rr.budget_at_this_revenue || 0), 0);
  const cogsCard = (j.cards || []).find(c => c.key === "cogs");
  const cogsPct = cogsCard?.pct_of_revenue;
  const cogsTargetPct = cogsCard?.target_pct_of_revenue;
  if (scoredSumBatr > 0 && cogsPct != null && cogsTargetPct != null) {
    const totalVarianceVsBatr = scoredSumActual - scoredSumBatr;
    const dollarUnder = totalVarianceVsBatr <= 0;
    const pctUnder = (cogsPct - cogsTargetPct) <= 0;
    if (dollarUnder !== pctUnder) {
      fail(`${a} ${r.tag}`,
        `total sign disagreement: scored(actual-batr)=${totalVarianceVsBatr.toFixed(2)} says ${dollarUnder ? "under" : "over"} but cogs pct-diff=${(cogsPct - cogsTargetPct).toFixed(2)} says ${pctUnder ? "under" : "over"}`);
    }
  }
}

async function main() {
  console.log(`# cost-lines row + total consistency (correct-operand form) - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");

  if (SEEDED) {
    console.log("## Seeded failure axis - envelope_delta != btd - batr must fire");
    const seedRow = {
      line_code: "3200", section: "cogs",
      actual: 30000, budget_to_date: 32000, budget_at_this_revenue: 31000,
      envelope_delta: 500,   // WRONG: should be 32000 - 31000 = 1000
      flags: [],
    };
    const derived = seedRow.budget_to_date - seedRow.budget_at_this_revenue;
    const fired1 = Math.abs(derived - seedRow.envelope_delta) > CENT;
    console.log(`  ${fired1 ? "PASS" : "FAIL"}  envelope_delta ${seedRow.envelope_delta} vs derived ${derived}: check ${fired1 ? "fires" : "silent"}`);

    console.log("");
    console.log("## Seeded failure axis - variance_pct != actual_pct - target_pct must fire");
    const seedRow2 = { line_code: "3400", actual_pct: 20, target_pct: 21, variance_pct: -3 };
    const dPct = seedRow2.actual_pct - seedRow2.target_pct;
    const fired2 = Math.abs(dPct - seedRow2.variance_pct) > PCT_TOL;
    console.log(`  ${fired2 ? "PASS" : "FAIL"}  variance_pct ${seedRow2.variance_pct} vs derived ${dPct}: check ${fired2 ? "fires" : "silent"}`);

    console.log("");
    console.log("## Seeded failure axis - dollar (actual-batr) direction disagrees with variance_pct direction must fire");
    const seedRow3 = { actual: 30000, budget_at_this_revenue: 34000, variance_pct: 3 };
    const varVsBatr = seedRow3.actual - seedRow3.budget_at_this_revenue;
    const dollarUnder3 = varVsBatr <= 0;
    const pctUnder3 = seedRow3.variance_pct <= 0;
    const fired3 = dollarUnder3 !== pctUnder3;
    console.log(`  ${fired3 ? "PASS" : "FAIL"}  actual-batr=${varVsBatr} (${dollarUnder3 ? "under" : "over"}) vs pct=${seedRow3.variance_pct} (${pctUnder3 ? "under" : "over"}): check ${fired3 ? "fires" : "silent"}`);

    console.log("");
    console.log("## Seeded failure axis - (actual - batr) != (variance_pct / 100) * revenue must fire");
    const seedRow4 = { actual: 30000, budget_at_this_revenue: 34000, variance_pct: -1, revenue: 100000 };
    const va = seedRow4.actual - seedRow4.budget_at_this_revenue;   // -4000
    const derivedFromPct = (seedRow4.variance_pct / 100) * seedRow4.revenue;  // -1000
    const fired4 = Math.abs(va - derivedFromPct) > PCT_TIMES_REV_TOL;
    console.log(`  ${fired4 ? "PASS" : "FAIL"}  actual-batr=${va} vs pct*rev=${derivedFromPct}: diff ${(va - derivedFromPct).toFixed(2)} > ${PCT_TIMES_REV_TOL}: check ${fired4 ? "fires" : "silent"}`);

    console.log("");
    const allSeedPass = fired1 && fired2 && fired3 && fired4;
    console.log(allSeedPass ? "Seeded failure axis: PASS" : "Seeded failure axis: FAIL");
    process.exit(allSeedPass ? 0 : 1);
  }

  for (const a of ACCOUNTS) {
    for (const r of RANGES) await checkPayload(a, r);
  }

  const scanned = ACCOUNTS.length * RANGES.length;
  console.log(`  ${FAILS.length === 0 ? "OK" : "FAIL"} ${scanned} (account x range) configurations, ${FAILS.length} violations`);
  if (FAILS.length === 0) {
    console.log("");
    console.log(`Result: 0 row/total inconsistencies across all ranges.`);
    process.exit(0);
  }
  console.log("");
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS.slice(0, 30)) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
