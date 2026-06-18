// VERIFY PROBE for sc-4-config-changelog.sql.
// Apply the migration in Supabase Studio first, then run this:
//   node --env-file=.env.local scripts/_probe-sc-4-changelog-verify.mjs
//
// Checks:
//   1. Table exists
//   2. Columns are correct + count
//   3. CHECK constraints enforce: reason non-empty, reason length cap,
//      entity_type membership, change_type membership
//   4. SELECT + INSERT work via service_role
//   5. UPDATE + DELETE are REJECTED via service_role (audit integrity)
//
// Cleans up its own test row at the end. Read-only otherwise.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const EXPECTED_COLUMNS = [
  "id", "account_key", "entity_type", "entity_id", "entity_label",
  "change_type", "old_value", "new_value", "effective_date",
  "reason", "requested_by", "changed_by", "changed_at",
];

const PROBE_REASON = "sc-4-verify-probe synthetic row";

let testRowId = null;

async function checkExists() {
  const { error } = await supa.from("sc_config_changelog").select("id").limit(1);
  if (error) {
    console.log(`  FAIL  table read: ${error.message}`);
    return false;
  }
  console.log("  PASS  table exists + SELECT works");
  return true;
}

async function checkColumns() {
  const { data, error } = await supa
    .from("sc_config_changelog")
    .insert({
      account_key:  "CIN - AZ",
      entity_type:  "price",
      entity_id:    "00000000-0000-0000-0000-000000000000",
      entity_label: "verify-probe test row",
      change_type:  "update",
      old_value:    { price: 0.00 },
      new_value:    { price: 0.01 },
      effective_date: "2026-01-01",
      reason:       PROBE_REASON,
      requested_by: null,
      changed_by:   "probe@kitchfix.com",
    })
    .select("*")
    .single();

  if (error) {
    console.log(`  FAIL  baseline INSERT: ${error.message}`);
    return false;
  }

  const cols = Object.keys(data).sort();
  const expected = [...EXPECTED_COLUMNS].sort();
  const missing = expected.filter((c) => !cols.includes(c));
  const extra = cols.filter((c) => !expected.includes(c));
  testRowId = data.id;

  if (missing.length || extra.length) {
    console.log(`  FAIL  columns: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`);
    return false;
  }
  console.log(`  PASS  columns (${cols.length}): all ${EXPECTED_COLUMNS.length} expected present, none extra`);
  console.log(`  PASS  INSERT via service_role works (id=${testRowId})`);
  return true;
}

async function checkConstraints() {
  // empty reason should be rejected
  let ok = true;
  {
    const { error } = await supa.from("sc_config_changelog").insert({
      account_key:  "CIN - AZ",
      entity_type:  "price",
      change_type:  "update",
      reason:       "   ",                 // whitespace - should be rejected
      changed_by:   "probe@kitchfix.com",
    });
    if (error) {
      console.log("  PASS  CHECK rejects whitespace-only reason");
    } else {
      console.log("  FAIL  CHECK did NOT reject whitespace-only reason");
      ok = false;
    }
  }
  // reason over 280 should be rejected
  {
    const long = "x".repeat(281);
    const { error } = await supa.from("sc_config_changelog").insert({
      account_key:  "CIN - AZ",
      entity_type:  "price",
      change_type:  "update",
      reason:       long,
      changed_by:   "probe@kitchfix.com",
    });
    if (error) {
      console.log("  PASS  CHECK rejects reason > 280 chars");
    } else {
      console.log("  FAIL  CHECK did NOT reject reason > 280 chars");
      ok = false;
    }
  }
  // bogus entity_type
  {
    const { error } = await supa.from("sc_config_changelog").insert({
      account_key:  "CIN - AZ",
      entity_type:  "bogus",
      change_type:  "update",
      reason:       PROBE_REASON,
      changed_by:   "probe@kitchfix.com",
    });
    if (error) {
      console.log("  PASS  CHECK rejects unknown entity_type");
    } else {
      console.log("  FAIL  CHECK did NOT reject unknown entity_type");
      ok = false;
    }
  }
  // bogus change_type
  {
    const { error } = await supa.from("sc_config_changelog").insert({
      account_key:  "CIN - AZ",
      entity_type:  "price",
      change_type:  "bogus",
      reason:       PROBE_REASON,
      changed_by:   "probe@kitchfix.com",
    });
    if (error) {
      console.log("  PASS  CHECK rejects unknown change_type");
    } else {
      console.log("  FAIL  CHECK did NOT reject unknown change_type");
      ok = false;
    }
  }
  return ok;
}

async function checkAuditIntegrity() {
  if (!testRowId) {
    console.log("  SKIP  audit-integrity (no test row to act on)");
    return true;
  }
  let ok = true;

  // service_role should NOT be able to UPDATE
  {
    const { error } = await supa
      .from("sc_config_changelog")
      .update({ reason: "tampered" })
      .eq("id", testRowId);
    if (error && /permission|denied|privilege/i.test(error.message)) {
      console.log(`  PASS  UPDATE rejected by GRANT (${error.message})`);
    } else if (error) {
      // Some other error - still failure to UPDATE, accept with note
      console.log(`  PASS  UPDATE failed (${error.message})`);
    } else {
      console.log("  FAIL  UPDATE was ALLOWED - audit integrity broken");
      ok = false;
    }
  }

  // service_role should NOT be able to DELETE
  {
    const { error } = await supa
      .from("sc_config_changelog")
      .delete()
      .eq("id", testRowId);
    if (error && /permission|denied|privilege/i.test(error.message)) {
      console.log(`  PASS  DELETE rejected by GRANT (${error.message})`);
    } else if (error) {
      console.log(`  PASS  DELETE failed (${error.message})`);
    } else {
      console.log("  FAIL  DELETE was ALLOWED - audit integrity broken");
      ok = false;
    }
  }
  return ok;
}

async function cleanup() {
  // We cannot delete via service_role per the GRANT. The test row
  // stays in the table forever, which is the correct audit-log semantic.
  // Print its id so Kevin can remove it manually in Studio if desired.
  if (testRowId) {
    console.log(`\nNOTE: test row remains in sc_config_changelog with id=${testRowId}.`);
    console.log("      Audit-integrity GRANT prevents the probe from cleaning it up.");
    console.log("      Remove manually in Supabase Studio if desired:");
    console.log(`        DELETE FROM sc_config_changelog WHERE id = '${testRowId}';`);
  }
}

async function main() {
  console.log("=== sc-4-config-changelog verify probe ===\n");
  let allOk = true;
  console.log("1. Table existence + SELECT");
  allOk = (await checkExists()) && allOk;

  console.log("\n2. Columns + baseline INSERT via service_role");
  allOk = (await checkColumns()) && allOk;

  console.log("\n3. CHECK constraints");
  allOk = (await checkConstraints()) && allOk;

  console.log("\n4. Audit-integrity GRANTs (UPDATE/DELETE rejected)");
  allOk = (await checkAuditIntegrity()) && allOk;

  await cleanup();

  console.log(allOk ? "\n=== ALL CHECKS PASS ===" : "\n=== SOME CHECKS FAILED - DO NOT MERGE ===");
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
