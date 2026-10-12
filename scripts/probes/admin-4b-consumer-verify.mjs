// scripts/probes/admin-4b-consumer-verify.mjs
//
// Verifies the Stage 4b wiring: admin_drift_log table exists + accepts
// writes, no inline SUPER_ADMINS/OPS_LEADERSHIP_SET refs left in
// directory/route.js, no OPS_LEADERSHIP_EMAILS.includes() calls remain
// in the 7 consumer files, and the expected count of
// isOpsLeadershipDb() call sites.
//
// Independent of a dev server; does NOT exercise the full gates. Full
// gate-rewrite correctness is verified by the lint + build + the
// Stage 4a parity probe (admin-consumer-verify.mjs) still passing.
//
// Usage:
//   node --env-file=.env.local scripts/probes/admin-4b-consumer-verify.mjs
//
// Exit codes:
//   0 - all checks pass
//   1 - any check failed
//   2 - migration not applied (admin_drift_log absent)
//   3 - env or connection error

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), "..", "..");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("ABSENT: SUPABASE_URL"); process.exit(3); }
if (!SB_KEY) { console.error("ABSENT: SUPABASE_SERVICE_ROLE_KEY"); process.exit(3); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

console.log("ADMIN STAGE-4B CONSUMER VERIFY");
console.log("==============================");

const results = [];
function record(name, ok, detail = "") {
  const pad = (name + ":").padEnd(44, " ");
  console.log(`${pad}${ok ? "PASS ✓" : "FAIL ✗"}  ${detail}`);
  results.push({ name, ok, detail });
}

// ─── Check 1: admin_drift_log table exists ───────────────────────────
{
  const { error } = await supa.from("admin_drift_log").select("id").limit(1);
  if (error && /does not exist|could not find the table/i.test(error.message)) {
    console.log("");
    console.log("MIGRATION NOT APPLIED - admin_drift_log table absent.");
    console.log(`  Supabase error: ${error.message}`);
    console.log("");
    console.log("Expected flow:");
    console.log("  1. Paste docs/migrations/admin-drift-log.sql into Supabase Studio");
    console.log("  2. Re-run this probe");
    console.log("");
    console.log("RESULT: MIGRATION NOT APPLIED YET (exit 2)");
    process.exit(2);
  }
  if (error) {
    console.error(`unexpected error on initial SELECT: ${error.message}`);
    process.exit(3);
  }
  record("admin_drift_log table exists", true);
}

// ─── Check 2: logDrift insert succeeds + readback ────────────────────
{
  const marker = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error: insErr } = await supa.from("admin_drift_log").insert({
    email: `probe-${marker}@test.com`,
    permission: "probe_test",
    event_type: "probe",
    db_value: true,
    hardcoded_value: false,
    error_msg: null,
    consumer: "admin-4b-verify",
  });
  if (insErr) {
    record("logDrift write round-trip", false, insErr.message);
  } else {
    const { data: readBack, error: readErr } = await supa
      .from("admin_drift_log")
      .select("id, permission, event_type, consumer")
      .eq("email", `probe-${marker}@test.com`)
      .limit(1);
    if (readErr) {
      record("logDrift write round-trip", false, `readback: ${readErr.message}`);
    } else if (!readBack || readBack.length === 0) {
      record("logDrift write round-trip", false, "insert reported ok but readback returned no row");
    } else {
      const row = readBack[0];
      const expect = row.permission === "probe_test" && row.event_type === "probe" && row.consumer === "admin-4b-verify";
      record("logDrift write round-trip", expect, expect ? `id=${row.id}` : `shape mismatch: ${JSON.stringify(row)}`);
      // Clean up the probe row so the drift signal isn't poisoned
      const { error: delErr } = await supa.from("admin_drift_log").delete().eq("id", row.id);
      if (delErr) {
        console.log(`  (note: probe row cleanup failed: ${delErr.message} - leaves one 'probe' event_type row behind)`);
      } else {
        console.log(`  (probe row id=${row.id} cleaned up)`);
      }
    }
  }
}

// ─── Check 3: no inline SUPER_ADMINS/OPS_LEADERSHIP_SET refs in directory route ──
{
  const src = readFileSync(join(REPO_ROOT, "src/app/api/directory/route.js"), "utf8");
  const leftover = [];
  // Allowed matches: comment blocks that mention the names in prose +
  // actual code refs. We look specifically for the DECLARATIONS and
  // CALL SITES that should be gone.
  if (/^const\s+SUPER_ADMINS\s*=/m.test(src)) leftover.push("const SUPER_ADMINS = ... declaration");
  if (/^const\s+SUPER_ADMINS_SET\s*=/m.test(src)) leftover.push("const SUPER_ADMINS_SET = ... declaration");
  if (/^const\s+OPS_LEADERSHIP_SET\s*=/m.test(src)) leftover.push("const OPS_LEADERSHIP_SET = ... declaration");
  if (/\bSUPER_ADMINS_SET\s*\.has\s*\(/.test(src)) leftover.push("SUPER_ADMINS_SET.has() call");
  if (/\bOPS_LEADERSHIP_SET\s*\.has\s*\(/.test(src)) leftover.push("OPS_LEADERSHIP_SET.has() call");
  record("directory/route.js inline refs removed", leftover.length === 0, leftover.length === 0 ? "no inline SUPER_ADMINS or OPS_LEADERSHIP_SET left" : leftover.join(", "));
}

// ─── Check 4: no OPS_LEADERSHIP_EMAILS.includes() in the 7 consumer files ──
{
  const consumerFiles = [
    "src/lib/invoiceActions.js",
    "src/app/api/dashboard/route.js",
    "src/app/api/ops/route.js",
    "src/app/api/kpi/purchasing/export/route.js",
    "src/app/api/kpi/labor/export/route.js",
    "src/app/api/kpi/labor/views/route.js",
    "src/app/api/kpi/labor/views/[id]/route.js",
  ];
  const stillUsing = [];
  for (const rel of consumerFiles) {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    if (/\bOPS_LEADERSHIP_EMAILS\s*\.\s*includes\s*\(/.test(src)) stillUsing.push(rel);
  }
  record("no OPS_LEADERSHIP_EMAILS.includes() in consumers", stillUsing.length === 0, stillUsing.length === 0 ? "7 consumer files clean" : `still using: ${stillUsing.join(", ")}`);
}

// ─── Check 5: expected isOpsLeadershipDb call count ──────────────────
// Expected: 14 call sites across the 7 OPS consumer files (handoff
// said "13" but the actual tally is 3+2+3+1+1+2+2) + at least 2 in
// directory/route.js (requirePeopleAdmin + bootstrap).
// The `isOpsLeadershipDb(` regex requires a trailing `(` so the
// import-line reference does not match - no subtraction needed.
{
  const consumerFiles = [
    "src/lib/invoiceActions.js",
    "src/app/api/dashboard/route.js",
    "src/app/api/ops/route.js",
    "src/app/api/kpi/purchasing/export/route.js",
    "src/app/api/kpi/labor/export/route.js",
    "src/app/api/kpi/labor/views/route.js",
    "src/app/api/kpi/labor/views/[id]/route.js",
  ];
  let consumerCalls = 0;
  for (const rel of consumerFiles) {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    const matches = src.match(/\bisOpsLeadershipDb\s*\(/g) || [];
    consumerCalls += matches.length;
  }
  const dirSrc = readFileSync(join(REPO_ROOT, "src/app/api/directory/route.js"), "utf8");
  const dirMatches = dirSrc.match(/\bisOpsLeadershipDb\s*\(/g) || [];
  const dirCalls = dirMatches.length;

  const expectConsumer = 14;
  const expectDirMin = 2;
  const ok = consumerCalls === expectConsumer && dirCalls >= expectDirMin;
  record("isOpsLeadershipDb() call count", ok, `consumers=${consumerCalls}/${expectConsumer}, directory=${dirCalls}/${expectDirMin}+`);
}

// ─── Verdict ──────────────────────────────────────────────────────────
console.log("");
const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  console.log("RESULT: ALL PASS");
  process.exit(0);
}
console.log(`RESULT: FAIL (${failed.length} check(s) failed)`);
for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
process.exit(1);
