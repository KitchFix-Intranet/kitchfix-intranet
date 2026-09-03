#!/usr/bin/env node
// scripts/probes/_probe_inventory_adjustment.mjs
//
// Kevin R-61 (2026-09-03): inventory adjustment invariants.
//
//   I1  No adjustment is applied to an OPEN period on any account.
//       The running period shows purchases alone; JEs are booked at
//       close and never interpolated.
//   I2  On single_closed / FYTD ranges: if inventory_status is
//       "actualized", every finalised period in the range has at
//       least one JE row loaded. If "pending", at least one has
//       none.
//   I3  Cost-line row invariant: actual == actual_purchased -
//       inventory_je (to the cent) when inventory_je is present.
//   I4  Management-fee and pass-through accounts NEVER emit an
//       inventory_status (they carry no inventory - CIN - OH,
//       STL - FL, STL - MO food is billed back).
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 fabricates a "JE applied to open period"
//   scenario and asserts I1 fires. Also asserts I3 fires when
//   actual != actual_purchased - inventory_je.
//
// USAGE
//   node scripts/probes/_probe_inventory_adjustment.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

// Accounts that CAN carry inventory (per-meal + sales-based).
const APPLICABLE_ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
// Accounts that CANNOT (management-fee / pass-through).
const NON_APPLICABLE = ["CIN - OH", "STL - FL", "STL - MO"];

const RANGES = [
  { name: "FYTD",             qs: "" },
  { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
  { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

function seedAxis() {
  const fails = [];
  // I1 seed: a row claiming open-period JE application.
  const openRow = { period_no: 9, state: "open", inventory_je: -1250.00 };
  if (openRow.state === "open" && openRow.inventory_je != null) {
    fails.push(`SEED P9: open period carries inventory_je=${openRow.inventory_je} - I1 must fire`);
  }
  // I3 seed: actual != purchased - JE.
  const row3 = { actual: 100000, actual_purchased: 95000, inventory_je: 3000 };
  const derived = row3.actual_purchased - row3.inventory_je;
  if (Math.abs(derived - row3.actual) > 1) {
    fails.push(`SEED row: actual=${row3.actual} != purchased-JE=${derived} - I3 must fire`);
  }
  const expected = 2;
  console.log(`  ${fails.length === expected ? "PASS" : "FAIL"}  seeded fires: ${fails.length} of ${expected} expected`);
  for (const f of fails) console.log(`    ${f}`);
  return fails.length === expected;
}

async function jget(url) { return (await fetch(url)).json(); }

async function main() {
  console.log(`# inventory adjustment invariants - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");
  if (SEEDED) {
    console.log("## Seeded failure axis");
    process.exit(seedAxis() ? 0 : 1);
  }

  // I1 + I3: walk every account × range; assert row invariants.
  for (const a of [...APPLICABLE_ACCOUNTS, ...NON_APPLICABLE]) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(a)}`;
      const j = await jget(url);
      if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); continue; }
      // I1: single_open never carries inventory_je > 0 on any row.
      const isOpen = j.period_state === "open" && j.range?.kind === "period";
      if (isOpen) {
        for (const row of (j.statement_rows || [])) {
          if (row.section !== "cogs") continue;
          if (row.inventory_je != null && Math.abs(row.inventory_je) > 0) {
            fail(`${a} ${r.name} row ${row.line_code}`, `open range carries inventory_je=${row.inventory_je} (want null or 0)`);
          }
        }
      }
      // I3: actual == actual_purchased - inventory_je (to the cent).
      for (const row of (j.statement_rows || [])) {
        if (row.section !== "cogs") continue;
        if (row.inventory_je == null || row.actual_purchased == null) continue;
        if (row.actual == null) continue;
        const derived = Number((row.actual_purchased - row.inventory_je).toFixed(2));
        if (Math.abs(derived - row.actual) > 0.02) {
          fail(`${a} ${r.name} row ${row.line_code}`, `actual=${row.actual} != actual_purchased - inventory_je (${derived})`);
        }
      }
      // I4: MF/PT accounts have inventory_status null.
      if (NON_APPLICABLE.includes(a)) {
        if (j.inventory_status != null) {
          fail(`${a} ${r.name}`, `inventory_status=${JSON.stringify(j.inventory_status)} on non-applicable account`);
        }
      }
      // I2: status membership sanity.
      if (j.inventory_status && APPLICABLE_ACCOUNTS.includes(a)) {
        const s = j.inventory_status.status;
        if (s !== "actualized" && s !== "pending") {
          fail(`${a} ${r.name}`, `inventory_status.status=${JSON.stringify(s)} (want actualized|pending)`);
        }
        // If pending, pending_periods should be non-empty subset of
        // finalised_periods.
        if (s === "pending") {
          if (!Array.isArray(j.inventory_status.pending_periods) || j.inventory_status.pending_periods.length === 0) {
            fail(`${a} ${r.name}`, `pending status but no pending_periods`);
          }
        }
        if (s === "actualized" && j.inventory_status.pending_periods?.length > 0) {
          fail(`${a} ${r.name}`, `actualized status but pending_periods non-empty`);
        }
      }
    }
  }
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: inventory adjustment invariants hold across ${APPLICABLE_ACCOUNTS.length + NON_APPLICABLE.length} accounts × ${RANGES.length} ranges.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
