// Wire check for STL - MO's actual_estimated field.
//
// Owner directive 2026-08-26: before patching the render (item 2 of
// the homestand fixes), verify what the wire carries. If
// actual_estimated arrives negative on the wire, dropping the "est."
// suffix hides a server bug rather than fixing it.
//
// Mirrors the route.js pipeline for the homestand endpoint:
//   listHomestands + foldPreFloorEstimates
// then prints actual_estimated per stand + a verdict on sign.

import { createClient } from "@supabase/supabase-js";
import { listHomestands, computeHomestandBank } from "../../src/lib/labor/homestandResolver.js";
import { foldPreFloorEstimates } from "../../src/lib/labor/preFloorEstimator.js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
console.error("env: PRESENT");

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNT = "STL - MO";
const TODAY = new Date().toISOString().slice(0, 10);

const stands = await listHomestands(supa, ACCOUNT);
console.error(`\nSTL - MO homestands: ${stands.length}`);

// dailyFloorISO from route.js:424 (2026-04-20 is the default per code)
const dailyFloorISO = "2026-04-20";
const folded = await foldPreFloorEstimates(supa, ACCOUNT, stands, dailyFloorISO, TODAY);

console.log(`\nwire check on actual_estimated across all ${folded.length} stands:\n`);
console.log(`HS  window                      is_est  actual_est`);
console.log(`--  --------------------------- ------  ----------`);
let anyNegative = false;
let anyPositive = false;
for (const h of folded) {
  const est = h.actual_estimated;
  const sign = est == null ? "NULL" : est < 0 ? "NEGATIVE" : est > 0 ? "POSITIVE" : "ZERO";
  if (est != null && est < 0) anyNegative = true;
  if (est != null && est > 0) anyPositive = true;
  console.log(`${String(h.index).padStart(2)}  ${h.window_start} - ${h.window_end}  ${String(h.is_estimated).padEnd(6)}  ${est == null ? "null" : `$${est.toFixed(2)}`}  ${sign}`);
}

console.log(`\nverdict:`);
if (anyNegative) {
  console.log(`  SERVER BUG: at least one stand has NEGATIVE actual_estimated on the wire.`);
  console.log(`  Dropping the "est." suffix in the render would HIDE the sign issue.`);
  console.log(`  Fix the estimator OR the wire path before touching the render.`);
} else if (anyPositive) {
  console.log(`  wire is clean - every populated actual_estimated is >= 0.`);
  console.log(`  The observed "~-$12,262 est." is a client-render bug, not a server bug.`);
  console.log(`  Item 2's "drop est. suffix" fix is safe to apply.`);
} else {
  console.log(`  no populated actual_estimated values found - cannot verdict.`);
}
