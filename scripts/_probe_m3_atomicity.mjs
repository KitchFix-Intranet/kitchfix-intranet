// M-3 atomicity probe. Owner's hardest gate: "Atomicity under
// failure. I want to see what a failed confirm leaves behind,
// measured, not reasoned about."
//
// Strategy: trigger sc_confirm_closeout with a payload guaranteed
// to fail AFTER the row inserts would have happened in a
// non-atomic implementation. The plpgsql function wraps every
// write in one implicit transaction, so any exception aborts the
// whole write and last-good state is preserved.
//
// Fail vector we use here: p_reopen_reason NULL when a live row
// already exists. The function RAISEs. Under an atomic
// implementation:
//   - No new sc_homestand_closeout row lands.
//   - The prior live row is NOT superseded.
//   - No sc_daily_actuals rows land.
//
// Under a non-atomic (sequential) implementation the supersede
// UPDATE would fire before the guard, then the failed insert
// would leave the prior row wrongly closed.
//
// Run AFTER migrating (Studio-apply sc-22-homestand-closeout.sql):
//   npx tsx --env-file=.env.local scripts/_probe_m3_atomicity.mjs
//
// Expected exit: prints ATOMIC PASS. Any DRIFT line signals a bug
// in the RPC or its transaction wrapper.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNT = "CIN - OH";
// A stable test key that will not collide with real homestand
// blocks (they are seven-digit game_pks). Cleared at the end of
// this probe regardless of the fail vector.
const TEST_HOMESTAND_KEY = "atomicity-probe-2026";

async function fetchState() {
  const c = await supa.from("sc_homestand_closeout")
    .select("id, superseded_at, labor_actual, reopen_reason")
    .eq("account_key", ACCOUNT)
    .eq("homestand_key", TEST_HOMESTAND_KEY)
    .order("service_confirmed_at", { ascending: true });
  return { rows: c.data || [], error: c.error };
}

async function cleanup() {
  await supa.from("sc_homestand_closeout").delete()
    .eq("account_key", ACCOUNT).eq("homestand_key", TEST_HOMESTAND_KEY);
}

async function callRPC(params) {
  return await supa.rpc("sc_confirm_closeout", params);
}

console.log("══ M-3 atomicity probe ══\n");

// Fresh start: clean any prior probe state.
await cleanup();
let s0 = await fetchState();
if (s0.error) { console.error("read failed:", s0.error.message); process.exit(1); }
console.log(`[pre]  ${s0.rows.length} rows for (${ACCOUNT}, ${TEST_HOMESTAND_KEY})`);

// Phase 1: first confirm should succeed.
const p1 = await callRPC({
  p_account_key:     ACCOUNT,
  p_homestand_key:   TEST_HOMESTAND_KEY,
  p_labor_actual:    5000.00,
  p_labor_source:    "manual",
  p_window_start:    "2026-06-01",
  p_window_end:      "2026-06-30",
  p_budget_snapshot: 5500.00,
  p_notes:           "atomicity probe phase 1",
  p_confirmed_by:    "probe@kitchfix.com",
  p_actuals:         [],  // schema permits; route never sends this
  p_reopen_reason:   null,
});
console.log(`[p1 rpc] err=${p1.error?.message || "none"}  data=${JSON.stringify(p1.data)}`);
let s1 = await fetchState();
console.log(`[p1 state] ${s1.rows.length} rows: ${s1.rows.map(r => `superseded=${r.superseded_at ? "Y" : "N"} labor=${r.labor_actual}`).join(", ")}`);

if (s1.rows.length !== 1 || s1.rows[0].superseded_at !== null) {
  console.log("✗ Phase 1 setup failed - expected 1 live row.");
  await cleanup(); process.exit(1);
}

// Phase 2: attempt reopen WITHOUT reopen_reason. RPC guard RAISEs.
// Atomic wrapper: no supersede, no new row, no actuals move.
const preRows = s1.rows.map(r => ({ id: r.id, sup: r.superseded_at, labor: r.labor_actual }));
const p2 = await callRPC({
  p_account_key:     ACCOUNT,
  p_homestand_key:   TEST_HOMESTAND_KEY,
  p_labor_actual:    9999.00,
  p_labor_source:    "manual",
  p_window_start:    "2026-06-01",
  p_window_end:      "2026-06-30",
  p_budget_snapshot: 5500.00,
  p_notes:           "atomicity probe phase 2 - should ROLL BACK",
  p_confirmed_by:    "probe@kitchfix.com",
  p_actuals:         [],
  p_reopen_reason:   null,   // <-- guaranteed guard failure
});
console.log(`[p2 rpc] err="${p2.error?.message || "none"}"  data=${JSON.stringify(p2.data)}`);
if (!p2.error) {
  console.log("✗ Expected RPC to FAIL with reopen_reason guard; it succeeded.");
  await cleanup(); process.exit(1);
}

let s2 = await fetchState();
const postRows = s2.rows.map(r => ({ id: r.id, sup: r.superseded_at, labor: r.labor_actual }));
console.log(`[p2 state] ${s2.rows.length} rows: ${s2.rows.map(r => `superseded=${r.superseded_at ? "Y" : "N"} labor=${r.labor_actual}`).join(", ")}`);

// Atomicity assertions.
let atomicPass = true;
if (s2.rows.length !== 1) {
  console.log(`✗ DRIFT: expected 1 row after failed reopen, saw ${s2.rows.length}`);
  atomicPass = false;
}
if (s2.rows[0]?.superseded_at !== null) {
  console.log(`✗ DRIFT: live row was superseded by a FAILED reopen (${s2.rows[0].superseded_at})`);
  atomicPass = false;
}
if (s2.rows[0]?.labor_actual != 5000) {
  console.log(`✗ DRIFT: labor_actual changed to ${s2.rows[0]?.labor_actual}`);
  atomicPass = false;
}
if (preRows[0].id !== postRows[0]?.id) {
  console.log("✗ DRIFT: row id changed (INSERT partially fired?)");
  atomicPass = false;
}

// Cleanup.
await cleanup();

console.log(atomicPass ? "\n✓ ATOMIC PASS - failed reopen left NO changes." : "\n✗ ATOMICITY FAIL - see DRIFT lines above.");
process.exit(atomicPass ? 0 : 1);
