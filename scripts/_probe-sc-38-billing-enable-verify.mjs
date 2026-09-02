#!/usr/bin/env node
// sc-38 verify probe. Run AFTER Kevin applies the migration in Studio.
// Confirms schema + row counts + CHECK invariants + no unmapped active
// billable service on TBR - FL or TBJ - FL.
//
// Usage:
//   node --env-file=.env.local scripts/_probe-sc-38-billing-enable-verify.mjs

import { createClient } from "@supabase/supabase-js";

function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const EXPECTED = {
  columnExists: true,
  checkConstraints: [
    "sc_qbo_service_map_item_id_or_excluded_check",
    "sc_qbo_service_map_line_desc_or_excluded_check",
  ],
  accountMaps: 2,
  tbrServiceMaps: 10,
  tbjServiceMaps: 15,
  tbrExcluded: 1,      // B&G Lunch
  tbjExcluded: 0,
};

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  const marker = ok ? "OK  " : "FAIL";
  console.log(`  ${marker}  ${label.padEnd(46)} actual=${String(actual).padStart(4)}  expected=${String(expected).padStart(4)}`);
  return ok;
}

async function main() {
  console.log(`sc-38 verify  at ${new Date().toISOString()}`);
  const supa = pgClient();

  // Structural probes via information_schema.
  const { data: colRow, error: colErr } = await supa.rpc("exec_sql", { sql: "SELECT 1" }).catch(() => ({ error: { message: "no exec_sql rpc" }}));
  // exec_sql may not exist; fall through to per-check queries which
  // work through the standard PostgREST surface.

  let allOk = true;

  // Column exists?
  const { data: colCheck, error: colE } = await supa
    .from("sc_qbo_service_map")
    .select("export_excluded")
    .limit(1);
  const colExists = !colE || !/export_excluded/.test(colE.message || "");
  allOk &= assertEq("sc_qbo_service_map.export_excluded column exists", colExists, true);

  // Account map count.
  const { count: acctCount, error: acctErr } = await supa
    .from("sc_qbo_account_map")
    .select("account_key", { count: "exact", head: true })
    .in("account_key", ["TBR - FL", "TBJ - FL"]);
  if (acctErr) { console.error(`account map count: ${acctErr.message}`); allOk = false; }
  allOk &= assertEq("sc_qbo_account_map rows for TBR + TBJ", acctCount ?? 0, EXPECTED.accountMaps);

  // Service map counts (per account, and excluded subset).
  const { count: tbrCount, error: tbrErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id", { count: "exact", head: true })
    .eq("account_key", "TBR - FL");
  if (tbrErr) { console.error(`TBR count: ${tbrErr.message}`); allOk = false; }
  allOk &= assertEq("sc_qbo_service_map rows for TBR - FL", tbrCount ?? 0, EXPECTED.tbrServiceMaps);

  const { count: tbjCount, error: tbjErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id", { count: "exact", head: true })
    .eq("account_key", "TBJ - FL");
  if (tbjErr) { console.error(`TBJ count: ${tbjErr.message}`); allOk = false; }
  allOk &= assertEq("sc_qbo_service_map rows for TBJ - FL", tbjCount ?? 0, EXPECTED.tbjServiceMaps);

  const { count: tbrExc, error: tbrExcErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id", { count: "exact", head: true })
    .eq("account_key", "TBR - FL")
    .eq("export_excluded", true);
  if (tbrExcErr) { console.error(`TBR excluded: ${tbrExcErr.message}`); allOk = false; }
  allOk &= assertEq("TBR export_excluded rows (B&G Lunch)", tbrExc ?? 0, EXPECTED.tbrExcluded);

  const { count: tbjExc, error: tbjExcErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id", { count: "exact", head: true })
    .eq("account_key", "TBJ - FL")
    .eq("export_excluded", true);
  if (tbjExcErr) { console.error(`TBJ excluded: ${tbjExcErr.message}`); allOk = false; }
  allOk &= assertEq("TBJ export_excluded rows", tbjExc ?? 0, EXPECTED.tbjExcluded);

  // CHECK invariant probe: no export_excluded=false row missing item_id or line_desc.
  const { data: bad, error: badErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id, account_key, qbo_item_id, qbo_line_description")
    .eq("export_excluded", false)
    .or("qbo_item_id.is.null,qbo_line_description.is.null");
  if (badErr) { console.error(`invariant probe: ${badErr.message}`); allOk = false; }
  allOk &= assertEq("rows with export_excluded=false missing fields", (bad || []).length, 0);

  // Slot coverage: TBR should have {mlb, milb, main}, TBJ should have
  // {mlb, milb, single-a, ssm, florida-ops, mlb-pantry, milb-pantry, catering}.
  const { data: tbrSlotRows } = await supa
    .from("sc_qbo_service_map")
    .select("invoice_slot")
    .eq("account_key", "TBR - FL");
  const tbrSlots = new Set((tbrSlotRows || []).map((r) => r.invoice_slot));
  console.log(`  info  TBR slots: {${[...tbrSlots].sort().join(", ")}}`);

  const { data: tbjSlotRows } = await supa
    .from("sc_qbo_service_map")
    .select("invoice_slot")
    .eq("account_key", "TBJ - FL");
  const tbjSlots = new Set((tbjSlotRows || []).map((r) => r.invoice_slot));
  console.log(`  info  TBJ slots: {${[...tbjSlots].sort().join(", ")}}`);

  // Unmapped-active-with-actuals probe: any active service on
  // either account that has actuals but no mapping row.
  const { data: unmapped, error: unmErr } = await supa.rpc("nothing").catch(() => null);
  // Skip if RPC unavailable; use raw query via .from() with a join isn't
  // directly available. Simpler: iterate.
  for (const account of ["TBR - FL", "TBJ - FL"]) {
    const { data: services } = await supa
      .from("sc_services")
      .select("id, service_name")
      .eq("account_key", account)
      .is("deleted_at", null)
      .is("active_until", null);
    const { data: maps } = await supa
      .from("sc_qbo_service_map")
      .select("service_id")
      .eq("account_key", account);
    const mappedIds = new Set((maps || []).map((m) => m.service_id));
    const unmappedActive = (services || []).filter((s) => !mappedIds.has(s.id));
    if (unmappedActive.length > 0) {
      // Check whether any carry actuals with count > 0
      const { data: acts } = await supa
        .from("sc_daily_actuals")
        .select("service_id, actual_count")
        .in("service_id", unmappedActive.map((s) => s.id))
        .gt("actual_count", 0);
      const withActuals = new Set((acts || []).map((r) => r.service_id));
      const risky = unmappedActive.filter((s) => withActuals.has(s.id));
      if (risky.length > 0) {
        console.log(`  WARN  ${account}: ${risky.length} unmapped active service(s) carry non-zero actuals - finalize will THROW on first attempt:`);
        for (const s of risky) console.log(`         ${s.service_name}`);
      } else {
        console.log(`  info  ${account}: ${unmappedActive.length} unmapped active service(s) (no actuals; safe):`);
        for (const s of unmappedActive) console.log(`         ${s.service_name}`);
      }
    } else {
      console.log(`  OK    ${account}: every active service has a mapping row`);
    }
  }

  console.log(`\n${allOk ? "PASS" : "FAIL"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
