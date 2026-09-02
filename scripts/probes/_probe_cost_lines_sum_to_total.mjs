#!/usr/bin/env node
// scripts/probes/_probe_cost_lines_sum_to_total.mjs
//
// PR-2 item 8 (Kevin, 2026-09-02) - the most important check in
// the PR. Kevin's first render failed because rows compared against
// period budgets while the total compared against budget-to-date -
// a $20,198 disagreement inside one table.
//
// After this PR the client cost-lines table sums the scored rows
// client-side (see CostLines.js TotalRow) so visible row values
// and visible total values are the same numbers by construction.
// That removes the row/total mismatch class - but doesn't guard
// against a per-row internal inconsistency.
//
// This probe asserts row-level internal consistency:
//   envelope_delta = budget_to_date - budget_at_this_revenue  (per row)
//   variance_pct   = actual_pct - target_pct                  (per row)
//   sum(rows.actual) == statement_totals.cogs.actual          (server sum)
// Plus a no-half-nulls guard for scored rows.
//
// PR-2 defect follow-up (Kevin, 2026-09-02): the cost-lines vs-
// target cell was rendering -envelope_delta as the dollar variance,
// which is a card-level concept and disagrees with the per-row
// percent verdict. A row read "3.5% under" on percent AND "$3,596
// over" in dollars simultaneously. Sign-agreement assertion added:
//
//   For every scored cost row and for the total row: if the row's
//   percent variance says UNDER, the row's dollar variance must also
//   say UNDER. A row saying "under" on percent and "over" in dollars
//   catches this class.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 fabricates (a) envelope_delta != btd - batr,
//   (b) variance_pct != actual_pct - target_pct, and
//   (c) variance vs variance_pct sign disagreement. All three must
//   fire.
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
    // Sign-agreement: dollar variance direction MUST match percent
    // variance direction. Rendering envelope_delta as the dollar cell
    // (PR-2 defect) tripped this because envelope is a card concept
    // that can flip the other way from a per-row variance.
    if (row.variance != null && row.variance_pct != null) {
      const dollarUnder = row.variance <= 0;
      const pctUnder = row.variance_pct <= 0;
      if (dollarUnder !== pctUnder) {
        fail(`${a} ${r.tag} ${row.line_code}`,
          `sign disagreement: dollar variance=${row.variance} says ${dollarUnder ? "under" : "over"} but variance_pct=${row.variance_pct} says ${pctUnder ? "under" : "over"}`);
      }
    }
  }

  const sumActual = cogsRows.reduce((s, r) => s + Number(r.actual || 0), 0);
  const totActual = j.statement_totals?.cogs?.actual;
  if (totActual != null && Math.abs(sumActual - totActual) > CENT) {
    fail(`${a} ${r.tag}`, `sum(rows.actual) ${sumActual.toFixed(2)} != total.actual ${Number(totActual).toFixed(2)}`);
  }

  // Total-row sign agreement: sum(scored row variances) direction
  // must match (cogsCard.pct - cogsCard.target_pct) direction. This
  // is what the operator sees on the total row in the cost-lines
  // table (dollar cell and percent cell must agree).
  const scoredRows = cogsRows.filter(r => !isSuppressed(r));
  const scoredSumBtd = scoredRows.reduce((s, r) => s + Number(r.budget_to_date || 0), 0);
  const scoredSumActual = scoredRows.reduce((s, r) => s + Number(r.actual || 0), 0);
  const totalVariance = scoredSumBtd > 0 ? scoredSumActual - scoredSumBtd : null;
  const cogsCard = (j.cards || []).find(c => c.key === "cogs");
  const cogsPct = cogsCard?.pct_of_revenue;
  const cogsTargetPct = cogsCard?.target_pct_of_revenue;
  if (totalVariance != null && cogsPct != null && cogsTargetPct != null) {
    const dollarUnder = totalVariance <= 0;
    const pctUnder = (cogsPct - cogsTargetPct) <= 0;
    if (dollarUnder !== pctUnder) {
      fail(`${a} ${r.tag}`,
        `total sign disagreement: total variance=${totalVariance.toFixed(2)} says ${dollarUnder ? "under" : "over"} but cogs pct-diff=${(cogsPct - cogsTargetPct).toFixed(2)} says ${pctUnder ? "under" : "over"}`);
    }
  }
}

async function main() {
  console.log(`# cost-lines row internal consistency - ${new Date().toISOString()}`);
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
    console.log("## Seeded failure axis - dollar variance direction disagrees with percent direction must fire");
    const seedRow3 = { line_code: "3100", variance: -35587, variance_pct: 3 };
    const dollarUnder3 = seedRow3.variance <= 0;
    const pctUnder3 = seedRow3.variance_pct <= 0;
    const fired3 = dollarUnder3 !== pctUnder3;
    console.log(`  ${fired3 ? "PASS" : "FAIL"}  dollar=${seedRow3.variance} (${dollarUnder3 ? "under" : "over"}) vs pct=${seedRow3.variance_pct} (${pctUnder3 ? "under" : "over"}): check ${fired3 ? "fires" : "silent"}`);

    console.log("");
    const allSeedPass = fired1 && fired2 && fired3;
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
    console.log(`Result: 0 row-internal inconsistencies across all ranges.`);
    process.exit(0);
  }
  console.log("");
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS.slice(0, 30)) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
