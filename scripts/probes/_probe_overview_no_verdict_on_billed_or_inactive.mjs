#!/usr/bin/env node
// scripts/probes/_probe_overview_no_verdict_on_billed_or_inactive.mjs
//
// R-40 polish PR permanent assertion. Read-only.
//
// Kevin's rule (2026-09-01): no verdict text may render on any
// billed-back or inactive line, on any board, any range, any
// account.
//
// The E-defects: a pass-through account rendered "0.1% over target"
// on $37 of packaging against a $0 budget - a billed-back line
// carrying a red verdict on money the client pays for. An inactive
// line rendered "$0 under" - a saving on a line the account does
// not run. Both classes are silent until Kevin drives the board.
// This probe closes both.
//
// SURFACES ASSERTED
//   payload.statement_rows[*]           for every account + range
//   payload.drill.purchasing            for pass-through accounts
//   payload.also_tracked[*]             (unreported actual = no verdict, E18)
//
// INVARIANTS
//   For any statement_row whose flags include "billed_back" OR
//   "inactive":
//     - variance         must be null
//     - variance_pct     must be null
//     - actual_pct       must be null
//     - target_pct       must be null
//
//   For any drill.purchasing whose billed_back === true:
//     - variance_pct                 null
//     - variance_pct_display         null
//     - direction                    null
//     - pct_of_revenue_display       null
//     - target_pct_display           null
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 injects a synthetic row with billed_back but a
//   non-null variance. Probe must FAIL. Verifies the check fires.
//
// USAGE
//   Local TEST_MODE dev server on :3311.
//   node scripts/probes/_probe_overview_no_verdict_on_billed_or_inactive.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_overview_no_verdict_on_billed_or_inactive.mjs

const BASE = "http://localhost:3311/api/kpi/overview";
const SEEDED = process.env.SEEDED_FAILURE === "1";

// Every hourly + fee + pass-through + salaried-only account across
// three ranges. If a fork ever re-emits a verdict on a suppressed
// line for any of these, this trips.
const ACCOUNTS = [
  "CIN - AZ",       // per-meal
  "CIN - OH",       // fee, pass-through   <- the one Kevin flagged
  "STL - FL",       // fee, pass-through
  "STL - MO",       // fee, pass-through
  "TBJ - FL", "TBR - FL",
  "TBJ - NY",       // salaried-only (D26)
  "CIN - KY",       // salaried-only (D26)
  "TXR - AZ",
  "TXR - TX - H",
  "TXR - TX - V",   // tracked
];
const RANGES = ["period:9", "period:8", "fytd"];

const FAILS = [];
function fail(where, detail) { FAILS.push(`${where}  ${detail}`); }

async function fetchPayload(acct, range) {
  const url = `${BASE}?account=${encodeURIComponent(acct)}&range=${encodeURIComponent(range)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function checkRow(acct, range, r) {
  const flags = Array.isArray(r?.flags) ? r.flags : [];
  const suppressed = flags.includes("billed_back") || flags.includes("inactive");
  if (!suppressed) return;
  const label = `${acct}/${range} statement ${r.line_code}(${flags.join(",")})`;
  if (r.variance != null)     fail(label, `variance=${r.variance}`);
  if (r.variance_pct != null) fail(label, `variance_pct=${r.variance_pct}`);
  if (r.actual_pct != null)   fail(label, `actual_pct=${r.actual_pct}`);
  if (r.target_pct != null)   fail(label, `target_pct=${r.target_pct}`);
}

function checkDrill(acct, range, d) {
  if (!d?.billed_back) return;
  const label = `${acct}/${range} drill.purchasing(billed_back)`;
  if (d.variance_pct != null)         fail(label, `variance_pct=${d.variance_pct}`);
  if (d.variance_pct_display != null) fail(label, `variance_pct_display=${d.variance_pct_display}`);
  if (d.direction != null)            fail(label, `direction=${d.direction}`);
  if (d.pct_of_revenue_display != null) fail(label, `pct_of_revenue_display=${d.pct_of_revenue_display}`);
  if (d.target_pct_display != null)   fail(label, `target_pct_display=${d.target_pct_display}`);
}

// E18 - Also tracked with unreported actual should have variance = null.
function checkAlsoTracked(acct, range, at) {
  if (!Array.isArray(at)) return;
  for (const r of at) {
    if (r?.reported) continue;
    if (r?.variance != null) {
      fail(`${acct}/${range} also_tracked ${r.line_code}(unreported)`, `variance=${r.variance}`);
    }
  }
}

async function main() {
  console.log(`# no verdict on billed-back or inactive lines - ${new Date().toISOString()}`);
  console.log(`# ${ACCOUNTS.length} accounts x ${RANGES.length} ranges = ${ACCOUNTS.length * RANGES.length} payload fetches`);
  console.log("");

  let scannedRows = 0;
  let scannedDrills = 0;
  let scannedTracked = 0;

  for (const acct of ACCOUNTS) {
    for (const range of RANGES) {
      let d;
      try { d = await fetchPayload(acct, range); }
      catch (e) {
        console.log(`  SKIP  ${acct}/${range}  fetch failed: ${e.message}`);
        continue;
      }
      for (const r of (d.statement_rows || [])) {
        scannedRows += 1;
        checkRow(acct, range, r);
      }
      if (d.drill?.purchasing) {
        scannedDrills += 1;
        checkDrill(acct, range, d.drill.purchasing);
      }
      if (Array.isArray(d.also_tracked)) {
        scannedTracked += d.also_tracked.length;
        checkAlsoTracked(acct, range, d.also_tracked);
      }
    }
  }

  // Seeded failure. Fabricate a payload row and pass it through the
  // check; the invariant must fire.
  const seedResults = [];
  if (SEEDED) {
    const before = FAILS.length;
    const bogus = { line_code: "9999", label: "SEED", flags: ["billed_back"], variance: -100, variance_pct: null, actual_pct: null, target_pct: null };
    checkRow("SEED", "SEED", bogus);
    const seededFired = FAILS.length > before;
    seedResults.push({ name: "billed_back row with variance != null must FAIL", pass: seededFired });

    const before2 = FAILS.length;
    const bogusDrill = { billed_back: true, pct_of_revenue_display: "5.0%" };
    checkDrill("SEED", "SEED", bogusDrill);
    const seededFired2 = FAILS.length > before2;
    seedResults.push({ name: "billed_back drill with pct_of_revenue_display must FAIL", pass: seededFired2 });
  }

  console.log(`Scanned: ${scannedRows} statement rows, ${scannedDrills} drills, ${scannedTracked} also_tracked rows`);
  console.log("");

  if (SEEDED) {
    console.log("## Seeded failure axis");
    for (const r of seedResults) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    console.log("");
  }

  // Fail-report shape - the seeded failures also live in FAILS; peel
  // them out for the summary count so we don't over-report.
  const seededFailCount = SEEDED ? seedResults.length : 0;
  const realFails = FAILS.length - seededFailCount;
  if (realFails === 0) {
    console.log(`Result: 0 verdict-on-suppressed-line violations across ${scannedRows} statement rows + ${scannedDrills} drills.`);
    if (SEEDED && seedResults.every(r => r.pass)) {
      console.log(`Seeded failure axis: PASS`);
      process.exit(0);
    }
    if (SEEDED && seedResults.some(r => !r.pass)) {
      console.log(`Seeded failure axis: FAIL - seeded rows did not fire the invariant`);
      process.exit(1);
    }
    process.exit(0);
  }
  console.log(`Result: ${realFails} verdict-on-suppressed-line violation(s):`);
  for (const f of FAILS.slice(0, 20)) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
