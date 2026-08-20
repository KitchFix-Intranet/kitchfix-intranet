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

const q = await supa.rpc("labor_actuals_rpc_coverage");
if (q.error) {
  fail(`coverage function error: ${q.error.message}`);
  console.log("");
  console.log("If the function does not exist, apply v42-1b-rpc-rebind.sql first.");
} else {
  const row = Array.isArray(q.data) ? q.data[0] : q.data;
  if (!row) {
    fail("coverage function returned no rows");
  } else {
    console.log("");
    console.log(`  writable columns on labor_actuals: ${row.actual_col_count}`);
    console.log(`  columns named in RPC INSERT:       ${row.insert_col_count}`);
    const missing = row.missing_columns || [];
    const extra   = row.extra_columns || [];
    if (missing.length > 0) {
      fail(`RPC drops ${missing.length} writable column(s): ${missing.join(", ")}`);
      console.log("      Fix: extend swap_labor_actuals_for_account's INSERT list + SELECT to name each column. If a column truly should not be written from the payload (a serial PK / trigger column / generated column), mark it is_identity or is_generated at the schema level so the guard skips it.");
    }
    if (extra.length > 0) {
      console.log(`  NOTE  ${extra.length} name(s) in the RPC INSERT list are not columns on labor_actuals: ${extra.join(", ")} (typo or a dropped column)`);
    }
    if (row.pass && missing.length === 0) {
      ok(`RPC INSERT list covers every writable labor_actuals column (${row.actual_col_count} total)`);
    }
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "RPC COVERAGE GUARD: PASS" : `RPC COVERAGE GUARD: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
