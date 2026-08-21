// scripts/_probe_labor_rpc_coverage.mjs
//
// Guard against the silent-truncation class of bug PR-A hit: v42-1
// added five columns to labor_actuals, the derive JS populated them,
// but swap_labor_actuals_for_account's hardcoded INSERT column list
// never named them - the RPC dropped the fields at the JSON->columns
// boundary with zero error and a success report. 1,160 rows landed
// with NULL in the new columns after the 2026-08-20 re-derive.
//
// This probe calls labor_actuals_rpc_coverage() (defined in
// docs/migrations/v42-1b-rpc-rebind.sql). That function:
//   1. reads swap_labor_actuals_for_account's pg_proc source
//   2. extracts the parenthesised INSERT column list
//   3. joins against information_schema.columns for labor_actuals
//   4. returns the set of writable columns NOT in the INSERT list
//
// FAIL on any missing column. The whitelist for genuine exceptions
// (a serial PK, a trigger-set audit column, a generated column) is
// enforced in SQL by skipping is_identity + is_generated rows -
// exceptions have to be explicit at the schema level, not hidden in
// this script.
//
// Run this probe:
//   - after every migration that touches labor_actuals
//   - before merging any PR that adds a column to labor_actuals
//   - in CI, if you want the class to be impossible to repeat
//
// Usage: node --env-file=.env.local scripts/_probe_labor_rpc_coverage.mjs

import { createClient } from "@supabase/supabase-js";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log("=".repeat(72));
console.log("labor_actuals RPC coverage guard");
console.log("=".repeat(72));

// Prefer the multi-subject labor_actuals_coverage (v42-2). Fall
// back to labor_actuals_rpc_coverage (v42-1b) when v42-2 has not
// yet been applied - keeps the probe useful mid-apply.
let q = await supa.rpc("labor_actuals_coverage");
let usingLegacy = false;
if (q.error && /does not exist/i.test(q.error.message)) {
  usingLegacy = true;
  q = await supa.rpc("labor_actuals_rpc_coverage");
  console.log("");
  console.log("  NOTE  falling back to v42-1b coverage function (RPC only). Apply v42-2-view-rebind.sql to also check the view.");
}
if (q.error) {
  fail(`coverage function error: ${q.error.message}`);
  console.log("");
  console.log("If neither function exists, apply v42-1b + v42-2 first.");
} else {
  const rows = Array.isArray(q.data) ? q.data : [q.data];
  if (!rows.length) {
    fail("coverage function returned no rows");
  } else if (usingLegacy) {
    // v42-1b single-row shape.
    const row = rows[0];
    console.log("");
    console.log(`  writable columns on labor_actuals: ${row.actual_col_count}`);
    console.log(`  columns named in RPC INSERT:       ${row.insert_col_count}`);
    const missing = row.missing_columns || [];
    const extra   = row.extra_columns || [];
    if (missing.length > 0) fail(`RPC drops ${missing.length} writable column(s): ${missing.join(", ")}`);
    if (extra.length > 0)   console.log(`  NOTE  RPC INSERT names not on labor_actuals: ${extra.join(", ")}`);
    if (row.pass && missing.length === 0) ok(`RPC INSERT covers every writable column (${row.actual_col_count})`);
  } else {
    // v42-2 multi-subject shape: one row per subject.
    for (const row of rows) {
      console.log("");
      const label = row.subject === "rpc_insert" ? "swap RPC INSERT list" : "labor_actuals_latest view SELECT";
      console.log(`  [${row.subject}] ${label}`);
      console.log(`    writable columns on labor_actuals: ${row.actual_col_count}`);
      console.log(`    columns named:                     ${row.named_col_count}`);
      const missing = row.missing_columns || [];
      const extra   = row.extra_columns || [];
      if (missing.length > 0) {
        fail(`[${row.subject}] drops ${missing.length} writable column(s): ${missing.join(", ")}`);
        if (row.subject === "rpc_insert") console.log("      Fix: extend swap_labor_actuals_for_account's INSERT list + SELECT to name each column.");
        else console.log("      Fix: DROP + CREATE labor_actuals_latest with the missing column(s) in the SELECT projection.");
      }
      if (extra.length > 0) console.log(`    NOTE  ${extra.length} name(s) not on labor_actuals: ${extra.join(", ")}`);
      if (row.pass && missing.length === 0) ok(`[${row.subject}] covers every writable column (${row.actual_col_count})`);
    }
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "RPC COVERAGE GUARD: PASS" : `RPC COVERAGE GUARD: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
