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
// SEEDED FAILURE
//   SEEDED_FAILURE=1 fabricates a row where envelope_delta doesn't
//   equal btd - batr, and a row where variance_pct doesn't equal
//   actual_pct - target_pct. Both must fire.
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
  }

  const sumActual = cogsRows.reduce((s, r) => s + Number(r.actual || 0), 0);
  const totActual = j.statement_totals?.cogs?.actual;
  if (totActual != null && Math.abs(sumActual - totActual) > CENT) {
    fail(`${a} ${r.tag}`, `sum(rows.actual) ${sumActual.toFixed(2)} != total.actual ${Number(totActual).toFixed(2)}`);
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
    console.log(fired1 && fired2 ? "Seeded failure axis: PASS" : "Seeded failure axis: FAIL");
    process.exit(fired1 && fired2 ? 0 : 1);
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
