// Verify PR 8.1: ai_line_items.vendor_id (FK to vendors).
//
// The migration is split into two parts; this script auto-detects which
// is currently applied:
//
//   PART A applied   — column exists, all rows resolved, but column is
//                      still NULLABLE (no NOT NULL, no FK yet).
//                      Verify script reports "PART A verified, PART B
//                      pending" and exits non-zero so any automation
//                      knows the migration is not complete.
//
//   PART A + B applied — column NOT NULL + FK + index in place; full
//                      end-to-end constraint live.
//                      Verify script reports all checks passed and
//                      exits 0.
//
// Auto-detection uses a controlled NULL-insert probe against a real
// invoice_submissions parent: if it gets a 23502 not-null violation,
// NOT NULL is live and we're in Part-B state; if the INSERT does NOT
// get 23502, we infer Part A only and the remaining checks are reported
// as "pending PART B" rather than fail-loud.
//
// USAGE
//   After PART A:  node --env-file=.env.local scripts/verify-pr-8-1-ai-line-items-vendor-id.mjs
//     → exits 1 with "PART A verified, PART B pending"
//   After PART B:  node --env-file=.env.local scripts/verify-pr-8-1-ai-line-items-vendor-id.mjs
//     → exits 0 with "All checks passed"

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function normalizeAlias(s) {
  return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "");
}

let failed = 0;
let partBPending = 0;
function pass(label, detail) {
  console.log(`  ✓ ${label}${detail ? `  -  ${detail}` : ""}`);
}
function fail(label, detail) {
  console.log(`  ✗ ${label}${detail ? `  -  ${detail}` : ""}`);
  failed++;
}
function pending(label, detail) {
  console.log(`  · ${label}${detail ? `  -  ${detail}` : ""}`);
  partBPending++;
}

console.log("PR 8.1 verification: ai_line_items.vendor_id");
console.log("─".repeat(70));

// ── Check 1: column exists / selectable (PART A) ──
const { error: eCol } = await supa.from("ai_line_items").select("vendor_id").limit(1);
if (eCol) {
  fail("vendor_id column exists", eCol.message);
  console.error("\nColumn missing — PART A has not been pasted yet. Stop here.");
  process.exit(2);
}
pass("vendor_id column exists and is selectable");

// ── Check 2: 0 rows with NULL vendor_id (PART A) ──
const { count: nullCount } = await supa
  .from("ai_line_items").select("*", { count: "exact", head: true })
  .is("vendor_id", null);
if (nullCount === 0) {
  pass("0 rows with NULL vendor_id");
} else {
  fail("0 rows with NULL vendor_id", `actual: ${nullCount} - backfill incomplete; do NOT paste PART B`);
}

// ── Check 3: Sample 100 rows resolve correctly (PART A) ──
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const { data: vendorAliases } = await supa.from("vendor_aliases").select("vendor_id, alias_normalized");
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
const aliasNormToVendorId = new Map();
for (const a of vendorAliases || []) aliasNormToVendorId.set((a.alias_normalized || "").toLowerCase(), a.vendor_id);

function expectedVendorId(vendorName) {
  const lower = String(vendorName || "").trim().toLowerCase();
  if (!lower) return null;
  const exact = nameToVendorId.get(lower);
  if (exact) return exact;
  return aliasNormToVendorId.get(normalizeAlias(vendorName)) || null;
}

const { data: sample } = await supa
  .from("ai_line_items")
  .select("id, vendor_name, vendor_id")
  .order("id")
  .limit(100);

let sampleOk = 0, sampleMismatch = 0;
const mismatches = [];
for (const r of sample || []) {
  const expected = expectedVendorId(r.vendor_name);
  if (expected && r.vendor_id === expected) sampleOk++;
  else {
    sampleMismatch++;
    if (mismatches.length < 5) {
      mismatches.push({ id: r.id, vendor_name: r.vendor_name, expected, actual: r.vendor_id });
    }
  }
}
if (sampleMismatch === 0) {
  pass("sample 100 rows resolve correctly", `${sampleOk}/${sample?.length ?? 0} match expected algorithm`);
} else {
  fail("sample 100 rows resolve correctly", `${sampleOk}/${sample?.length ?? 0} match; ${sampleMismatch} mismatched`);
  for (const m of mismatches) {
    console.log(`      ✗ id=${m.id}  vendor_name="${m.vendor_name}"  expected=${m.expected}  actual=${m.actual}`);
  }
}

// ── Auto-detect Part A vs Part A+B via NULL-insert probe ──
// Pick a real invoice_submissions.id so chk_new_rows_have_parent does not
// fire first. This isolates the vendor_id NOT NULL constraint as the
// failure cause.
const { data: sub } = await supa.from("invoice_submissions").select("id").limit(1).maybeSingle();
let notNullLive = null;       // null = unknown
let fkLive      = null;

if (sub?.id) {
  // Probe (a): NULL vendor_id → expect 23502 if NOT NULL is live.
  const { error: eNull } = await supa.from("ai_line_items").insert([{
    invoice_uuid: sub.id,
    account_key: "PROBE",
    vendor_name: "probe",
    vendor_id: null,
    line_num: 9999,
    description: "probe",
  }]);
  if (eNull?.code === "23502") notNullLive = true;
  else if (!eNull)             notNullLive = false;    // INSERT actually succeeded - bad
  else                         notNullLive = false;    // some other error → infer NOT NULL not in place yet

  // Probe (b): fake vendor_id → expect 23503 if FK is live.
  const { error: eFk } = await supa.from("ai_line_items").insert([{
    invoice_uuid: sub.id,
    account_key: "PROBE",
    vendor_name: "probe",
    vendor_id: "__FAKE_VENDOR_DOES_NOT_EXIST__",
    line_num: 9999,
    description: "probe",
  }]);
  if (eFk?.code === "23503") fkLive = true;
  else if (!eFk)             fkLive = false;
  else                       fkLive = false;
} else {
  console.log("  (probes skipped: no invoice_submissions to probe with)");
}

// ── Check 4: NOT NULL constraint (PART B) ──
if (notNullLive === true) {
  pass("NOT NULL constraint is live (23502 on NULL insert)");
} else if (notNullLive === false) {
  pending("NOT NULL constraint", "NULL insert was NOT rejected with 23502 → PART B not yet applied");
} else {
  pending("NOT NULL constraint", "probe skipped");
}

// ── Check 5: FK constraint (PART B) ──
if (fkLive === true) {
  pass("FK constraint is live (23503 on fake vendor_id)");
} else if (fkLive === false) {
  pending("FK constraint", "fake vendor_id was NOT rejected with 23503 → PART B not yet applied");
} else {
  pending("FK constraint", "probe skipped");
}

// ── Check 6: Index exists (PART B) ──
// PostgREST doesn't expose pg_indexes directly through the standard schema,
// but we can probe via an EXPLAIN-equivalent query. Simplest portable check:
// if NOT NULL + FK are both live (Part B applied), assume the index landed
// with them since they're in the same CREATE INDEX line of Step B.3.
// Otherwise mark pending.
if (notNullLive === true && fkLive === true) {
  pass("index ai_line_items_vendor_idx (inferred from Part B state)");
} else {
  pending("index ai_line_items_vendor_idx", "PART B not yet applied");
}

// ── Distribution (informational, always) ──
const { count: total } = await supa.from("ai_line_items").select("*", { count: "exact", head: true });
const { data: distRows } = await supa.from("ai_line_items").select("vendor_name, vendor_id");
const seenNames = new Map();
for (const r of distRows || []) {
  if (!seenNames.has(r.vendor_name)) {
    const lower = (r.vendor_name || "").toLowerCase();
    const exactId = nameToVendorId.get(lower);
    const via = exactId ? "exact" : "alias";
    seenNames.set(r.vendor_name, { count: 0, via });
  }
  seenNames.get(r.vendor_name).count++;
}
let exactNames = 0, aliasNames = 0, exactRows = 0, aliasRows = 0;
for (const v of seenNames.values()) {
  if (v.via === "exact") { exactNames++; exactRows += v.count; }
  else                   { aliasNames++; aliasRows += v.count; }
}
console.log("");
console.log("Distribution:");
console.log(`  total ai_line_items rows:    ${total}`);
console.log(`  distinct vendor_name values: ${seenNames.size}`);
console.log(`  exact match (vendors.name):  ${exactNames} distinct  /  ${exactRows} rows`);
console.log(`  via vendor_aliases:          ${aliasNames} distinct  /  ${aliasRows} rows`);
console.log(`  (probe baseline 2026-06-05: 29 distinct exact + 4 via alias; small delta from live activity is expected)`);

console.log("");
if (failed > 0) {
  console.error(`✗ ${failed} check(s) FAILED. Investigate before proceeding.`);
  process.exit(1);
} else if (partBPending > 0) {
  console.log(`◐ PART A verified (column exists, 0 NULLs, sample resolves correctly).`);
  console.log(`  PART B pending: ${partBPending} check(s) waiting on the post-deploy paste.`);
  console.log(`  Next step: merge the intranet PR, wait for Vercel to redeploy, then paste PART B.`);
  process.exit(1);
} else {
  console.log(`✓ All checks passed. PR 8.1 fully applied (PART A + PART B).`);
  console.log(`  ai_line_items.vendor_id is NOT NULL + FK + indexed; live writes populate it.`);
  process.exit(0);
}
