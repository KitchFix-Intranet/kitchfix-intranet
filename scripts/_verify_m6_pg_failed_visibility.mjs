// Verify the m6-pg-failed-visibility migration applied cleanly.
// Exits 0 on success; logs each check.
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let ok = true;

// 1. The ai_scan_error column exists - probe by selecting it
const { data, error } = await supa
  .from("invoice_submissions")
  .select("ai_scan_status, ai_scan_error")
  .limit(1);
if (error) {
  console.log(`  [FAIL] ai_scan_error column not selectable: ${error.message}`);
  ok = false;
} else {
  console.log(`  [OK]   ai_scan_error column exists (select succeeded)`);
}

// 2. The CHECK accepts 'pg_failed' - probe with a guarded test write.
// Pick an invoice that is already 'failed' or 'pg_failed' so we don't
// overwrite a live record's status. Restore the original value after.
const { data: failedRows } = await supa
  .from("invoice_submissions")
  .select("client_uuid, ai_scan_status, ai_scan_error")
  .or("ai_scan_status.eq.failed,ai_scan_status.eq.pg_failed")
  .limit(1);
if (!failedRows?.length) {
  console.log(`  [SKIP] no 'failed'/'pg_failed' row to probe CHECK constraint`);
} else {
  const original = failedRows[0];
  const probeError = "[verify_probe] schema sanity check - safe to ignore";
  const { error: upd1 } = await supa
    .from("invoice_submissions")
    .update({ ai_scan_status: "pg_failed", ai_scan_error: probeError })
    .eq("client_uuid", original.client_uuid);
  if (upd1) {
    console.log(`  [FAIL] CHECK rejected 'pg_failed': ${upd1.message}`);
    ok = false;
  } else {
    console.log(`  [OK]   CHECK accepts 'pg_failed'`);
    // restore
    const { error: upd2 } = await supa
      .from("invoice_submissions")
      .update({ ai_scan_status: original.ai_scan_status, ai_scan_error: original.ai_scan_error })
      .eq("client_uuid", original.client_uuid);
    if (upd2) {
      console.log(`  [WARN] could not restore row ${original.client_uuid} to ${original.ai_scan_status}: ${upd2.message}`);
      ok = false;
    } else {
      console.log(`  [OK]   restored row ${original.client_uuid.slice(0,8)} to ${original.ai_scan_status}`);
    }
  }
}

// 3. The CHECK still rejects garbage values - confirm the new constraint
// isn't fully permissive. Same restore-after-probe pattern.
const { data: anyRow } = await supa
  .from("invoice_submissions")
  .select("client_uuid, ai_scan_status, ai_scan_error")
  .limit(1);
if (anyRow?.length) {
  const r = anyRow[0];
  const { error: garbErr } = await supa
    .from("invoice_submissions")
    .update({ ai_scan_status: "this_should_not_pass" })
    .eq("client_uuid", r.client_uuid);
  if (!garbErr) {
    console.log(`  [FAIL] CHECK accepted garbage 'this_should_not_pass' - constraint missing`);
    ok = false;
    // restore
    await supa
      .from("invoice_submissions")
      .update({ ai_scan_status: r.ai_scan_status })
      .eq("client_uuid", r.client_uuid);
  } else {
    console.log(`  [OK]   CHECK rejects garbage: ${garbErr.code || garbErr.message.slice(0, 40)}`);
  }
}

console.log("");
console.log(ok ? "Done. All checks passed." : "Done. SOME CHECKS FAILED - migration not applied or applied wrong.");
process.exit(ok ? 0 : 1);
