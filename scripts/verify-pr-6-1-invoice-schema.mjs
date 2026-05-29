// Verify PR 6.1 invoice schema was applied correctly + the is_historical
// preservation-first pattern works as designed.
//
// Usage:
//   node --env-file=.env.local scripts/verify-pr-6-1-invoice-schema.mjs
//
// Checks (mirrors PR 5.1 + PR 5.3 verification style):
//   1. All 4 tables exist + count = 0
//   2. Each table has the is_historical + data_provenance columns
//   3. ai_scan_complete is a GENERATED column (auto-derived from ai_scan_status)
//   4. invoice_submissions status enum CHECK gated on is_historical (FALSE
//      enforces strict; TRUE allows any)
//   5. ai_line_items NULL invoice_uuid + NULL historical_invoice_ref
//      rejected by CHECK when is_historical=FALSE
//   6. ai_line_items NULL invoice_uuid allowed when is_historical=TRUE
//      AND historical_invoice_ref populated
//   7. ai_line_items partial UNIQUE INDEX rejects dupe (invoice_uuid,
//      line_num) on is_historical=FALSE; allows dupes when TRUE
//   8. F24 partial UNIQUE INDEX on invoice_submissions rejects exact
//      dupe on is_historical=FALSE; allows when TRUE
//   9. Cleanup: all test rows hard-removed; fail if any remain
//
// Exit code 0 on full pass; 1 on any failure.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) { console.error(`  FAIL  ${label}: ${detail}`); failures++; }

console.log("=== PR 6.1 invoice schema verification ===\n");

// Use a real vendor (created in PR 5.1) for FK validity.
// SYS-339 exists in production after the Module 5 cutover.
const TEST_VENDOR_ID = "SYS-339";

// ── Pre-flight: cleanup any leftover test rows ──
async function cleanup() {
  await supabase.from("ai_line_items")
    .delete().like("historical_invoice_ref", "VERIFY-PR-6-1-%");
  await supabase.from("invoice_rejections")
    .delete().like("rejected_by", "verify-pr-6-1%");
  await supabase.from("invoice_submissions")
    .delete().like("submitter_email", "verify-pr-6-1%");
  await supabase.from("gl_codes")
    .delete().like("account_key", "VERIFY-PR-6-1-%");
}
await cleanup();

// ── 1. Count checks ──
for (const table of ["invoice_submissions", "invoice_rejections", "ai_line_items", "gl_codes"]) {
  const { count, error } = await supabase
    .from(table).select("*", { count: "exact", head: true });
  if (error) fail(`count(${table})`, error.message);
  else if (count !== 0) fail(`count(${table}) = 0`, `got ${count}`);
  else pass(`count(${table}) = 0`);
}

// ── 2. is_historical + data_provenance columns present + defaultable ──
// Probe by inserting a minimal row and reading back the auto-set columns.
const probeUuid = crypto.randomUUID();
const probeInsert = await supabase.from("invoice_submissions").insert({
  client_uuid:     probeUuid,
  submitter_email: "verify-pr-6-1-probe@kitchfix.com",
  account_key:     "STL - FL",
  vendor_name:     "Sysco",
  vendor_id:       TEST_VENDOR_ID,
  total_amount:    1.00,
  gl_breakdown:    [],
  // is_historical + data_provenance intentionally absent - PG defaults fire
});
if (probeInsert.error) {
  fail("probe insert (defaults fire)", probeInsert.error.message);
} else {
  const { data: probeRow } = await supabase
    .from("invoice_submissions")
    .select("is_historical, data_provenance, ai_scan_complete, ai_scan_status")
    .eq("client_uuid", probeUuid)
    .maybeSingle();
  if (probeRow?.is_historical === false && probeRow?.data_provenance === "app_scan") {
    pass("invoice_submissions defaults: is_historical=false, data_provenance='app_scan'");
  } else {
    fail("invoice_submissions defaults",
      `got is_historical=${probeRow?.is_historical} data_provenance=${probeRow?.data_provenance}`);
  }
  // Verify ai_scan_complete is FALSE (not NULL) when ai_scan_status is NULL.
  // The GENERATED expression uses COALESCE(ai_scan_status, '') = 'complete' to
  // guard against SQL three-valued logic - a naive `ai_scan_status = 'complete'`
  // would evaluate NULL when status is NULL, breaking the old BOOLEAN NOT NULL
  // DEFAULT false semantics. With COALESCE, NULL coalesces to '' which is not
  // 'complete' so the boolean is FALSE.
  if (probeRow?.ai_scan_status === null && probeRow?.ai_scan_complete === false) {
    pass("ai_scan_complete = FALSE (not NULL) when ai_scan_status NULL (COALESCE guard)");
  } else {
    fail("ai_scan_complete GENERATED behavior (NULL ai_scan_status)",
      `expected ai_scan_complete=false, got ai_scan_status=${probeRow?.ai_scan_status} ai_scan_complete=${probeRow?.ai_scan_complete}`);
  }
}

// ── 3. ai_scan_complete auto-derives from ai_scan_status ──
{
  const u = crypto.randomUUID();
  await supabase.from("invoice_submissions").insert({
    client_uuid:     u,
    submitter_email: "verify-pr-6-1-aiscan@kitchfix.com",
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    vendor_id:       TEST_VENDOR_ID,
    total_amount:    1.00,
    gl_breakdown:    [],
    ai_scan_status:  "complete",
  });
  const { data } = await supabase
    .from("invoice_submissions")
    .select("ai_scan_complete")
    .eq("client_uuid", u).maybeSingle();
  if (data?.ai_scan_complete === true) {
    pass("ai_scan_complete = TRUE when ai_scan_status='complete'");
  } else {
    fail("ai_scan_complete derivation",
      `got ${data?.ai_scan_complete} for ai_scan_status='complete'`);
  }
  // Try to write ai_scan_complete directly - should fail because GENERATED
  const writeAttempt = await supabase.from("invoice_submissions")
    .update({ ai_scan_complete: false }).eq("client_uuid", u);
  if (writeAttempt.error) {
    pass(`ai_scan_complete is GENERATED (direct write rejected: ${writeAttempt.error.code || "error"})`);
  } else {
    fail("ai_scan_complete GENERATED write protection",
      "direct UPDATE on GENERATED column should have errored");
  }
}

// ── 4. invoice_submissions status enum CHECK (gated by is_historical) ──
{
  const u = crypto.randomUUID();
  // Non-historical row with bogus status should fail
  const bogusStatus = await supabase.from("invoice_submissions").insert({
    client_uuid:     u,
    submitter_email: "verify-pr-6-1-status@kitchfix.com",
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    vendor_id:       TEST_VENDOR_ID,
    total_amount:    1.00,
    gl_breakdown:    [],
    status:          "complete",     // not in enum
    // is_historical defaults FALSE - CHECK should fire
  });
  if (bogusStatus.error && /chk_status_enum|check constraint/i.test(bogusStatus.error.message)) {
    pass("status enum CHECK rejects 'complete' on is_historical=FALSE");
  } else if (!bogusStatus.error) {
    fail("status enum CHECK on FALSE", "expected check_violation, got success");
    await supabase.from("invoice_submissions").delete().eq("client_uuid", u);
  } else {
    fail("status enum CHECK on FALSE", `wrong error: ${bogusStatus.error.message}`);
  }

  // Historical row with same bogus status should succeed
  const u2 = crypto.randomUUID();
  const histBogus = await supabase.from("invoice_submissions").insert({
    client_uuid:     u2,
    submitter_email: "verify-pr-6-1-status-hist@kitchfix.com",
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    vendor_id:       TEST_VENDOR_ID,
    total_amount:    1.00,
    gl_breakdown:    [],
    status:          "complete",
    is_historical:   true,
  });
  if (histBogus.error) {
    fail("status enum CHECK bypass on is_historical=TRUE", histBogus.error.message);
  } else {
    pass("status enum CHECK bypassed on is_historical=TRUE (status='complete' accepted)");
  }
}

// ── 5/6. ai_line_items NULL parent enforcement ──
// First, need a real submission to use as parent for the success case.
const parentUuid = crypto.randomUUID();
const { data: parentRow, error: parentErr } = await supabase
  .from("invoice_submissions")
  .insert({
    client_uuid:     parentUuid,
    submitter_email: "verify-pr-6-1-parent@kitchfix.com",
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    vendor_id:       TEST_VENDOR_ID,
    total_amount:    1.00,
    gl_breakdown:    [],
  })
  .select("id")
  .maybeSingle();
if (parentErr || !parentRow) {
  fail("seed parent submission for ai_line_items tests", parentErr?.message || "no row returned");
} else {
  // (5) New row (is_historical=FALSE) with NULL invoice_uuid should fail
  const orphanNew = await supabase.from("ai_line_items").insert({
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    line_num:        1,
    description:     "Test line",
    invoice_uuid:    null,
    historical_invoice_ref: "VERIFY-PR-6-1-ORPHAN",
  });
  if (orphanNew.error && /chk_new_rows_have_parent|check constraint/i.test(orphanNew.error.message)) {
    pass("ai_line_items rejects NULL invoice_uuid when is_historical=FALSE");
  } else if (!orphanNew.error) {
    fail("ai_line_items NULL invoice_uuid on FALSE", "expected check_violation, got success");
  } else {
    fail("ai_line_items NULL invoice_uuid on FALSE", `wrong error: ${orphanNew.error.message}`);
  }

  // (6) Historical row with NULL invoice_uuid + populated historical_invoice_ref should pass
  const orphanHist = await supabase.from("ai_line_items").insert({
    account_key:           "STL - FL",
    vendor_name:           "Sysco",
    line_num:              1,
    description:           "Test historical",
    invoice_uuid:          null,
    historical_invoice_ref: "VERIFY-PR-6-1-HIST-1",
    is_historical:         true,
  });
  if (orphanHist.error) {
    fail("ai_line_items accepts NULL invoice_uuid + historical_invoice_ref on is_historical=TRUE",
      orphanHist.error.message);
  } else {
    pass("ai_line_items accepts NULL invoice_uuid + historical_invoice_ref on is_historical=TRUE");
  }

  // ── 7. partial UNIQUE INDEX on ai_line_items ──
  // Insert a real-parent row at (invoice_uuid=parentRow.id, line_num=42)
  const lineA = await supabase.from("ai_line_items").insert({
    invoice_uuid:    parentRow.id,
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    line_num:        42,
    description:     "First line at line_num=42",
  });
  if (lineA.error) fail("seed line A for UNIQUE test", lineA.error.message);

  // Second non-historical row with same key -> UNIQUE violation
  const lineDup = await supabase.from("ai_line_items").insert({
    invoice_uuid:    parentRow.id,
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    line_num:        42,
    description:     "Dupe non-historical",
  });
  if (lineDup.error && lineDup.error.code === "23505") {
    pass("ai_line_items UNIQUE (invoice_uuid, line_num) rejects dupe on is_historical=FALSE");
  } else if (!lineDup.error) {
    fail("ai_line_items UNIQUE on FALSE", "expected unique_violation");
  } else {
    fail("ai_line_items UNIQUE on FALSE", `wrong error code: ${lineDup.error.code}`);
  }

  // Historical row at same key -> allowed (partial index excludes is_historical=TRUE)
  const lineHistDup = await supabase.from("ai_line_items").insert({
    invoice_uuid:    parentRow.id,
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    line_num:        42,
    description:     "Historical dupe at same key",
    is_historical:   true,
    historical_invoice_ref: "VERIFY-PR-6-1-HIST-DUP",
  });
  if (lineHistDup.error) {
    fail("ai_line_items partial UNIQUE bypass on is_historical=TRUE", lineHistDup.error.message);
  } else {
    pass("ai_line_items partial UNIQUE INDEX bypassed on is_historical=TRUE");
  }
}

// ── 8. invoice_submissions F24 partial UNIQUE INDEX ──
{
  const sharedKey = {
    submitter_email: "verify-pr-6-1-f24@kitchfix.com",
    account_key:     "STL - FL",
    vendor_name:     "Sysco",
    vendor_id:       TEST_VENDOR_ID,
    invoice_number:  "VERIFY-F24-001",
    invoice_date:    "2026-01-15",
    total_amount:    100.00,
    gl_breakdown:    [],
  };
  const u1 = crypto.randomUUID();
  const ok = await supabase.from("invoice_submissions").insert({ ...sharedKey, client_uuid: u1 });
  if (ok.error) fail("seed F24 base row", ok.error.message);

  const u2 = crypto.randomUUID();
  const dup = await supabase.from("invoice_submissions").insert({ ...sharedKey, client_uuid: u2 });
  if (dup.error && dup.error.code === "23505") {
    pass("F24 partial UNIQUE INDEX rejects exact dupe on is_historical=FALSE");
  } else if (!dup.error) {
    fail("F24 UNIQUE on FALSE", "expected unique_violation");
  } else {
    fail("F24 UNIQUE on FALSE", `wrong error: ${dup.error.code} ${dup.error.message}`);
  }

  const u3 = crypto.randomUUID();
  const histDup = await supabase.from("invoice_submissions").insert({
    ...sharedKey, client_uuid: u3, is_historical: true,
  });
  if (histDup.error) {
    fail("F24 partial UNIQUE bypass on is_historical=TRUE", histDup.error.message);
  } else {
    pass("F24 partial UNIQUE INDEX bypassed on is_historical=TRUE");
  }
}

// ── 9. Cleanup ──
await cleanup();
const finalCounts = {};
for (const t of ["invoice_submissions", "invoice_rejections", "ai_line_items", "gl_codes"]) {
  const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
  finalCounts[t] = count;
}
if (Object.values(finalCounts).every((c) => c === 0)) {
  pass("cleanup: all 4 tables back to 0 rows");
} else {
  fail("cleanup", `orphan rows: ${JSON.stringify(finalCounts)}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
