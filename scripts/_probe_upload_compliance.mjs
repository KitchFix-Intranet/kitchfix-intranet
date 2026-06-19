// ════════════════════════════════════════════════════════════════════════════
// PROBE: Upload-compliance recon (read-only)
//
// Mirrors the recon-alarm's CHECK 2 (silent gap: ai_scan_complete=TRUE but
// 0 ai_line_items) + CHECK 3 (ai_scan_status='failed') logic over a 14-day
// window, grouped by account, with the false-positive guard applied.
//
// Compliance angle: a bad upload is (a) FAILED (ai_scan reached the failed
// path) or (b) EMPTY (claims complete but produced no line items). Both are
// upload-side problems Kevin addresses with account leaders.
//
// READ-ONLY. PG reads only, no writes.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LOOKBACK_DAYS = 14;
const since  = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();   // skip in-flight (last 24h)

console.log("=".repeat(100));
console.log(`UPLOAD COMPLIANCE RECON  (lookback ${LOOKBACK_DAYS}d, excludes last 24h in-flight)`);
console.log(`since:  ${since}`);
console.log(`cutoff: ${cutoff}`);
console.log("=".repeat(100));

// ── Q1: confirm where upload status + account live + account population rate ──
console.log("\n## Q1: Column locations + account-field population\n");

const { count: totalInWindow } = await supa
  .from("invoice_submissions")
  .select("*", { count: "exact", head: true })
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff);
console.log(`Total invoice_submissions in 14d window (non-historical, settled): ${totalInWindow}`);

const { count: missingAccount } = await supa
  .from("invoice_submissions")
  .select("*", { count: "exact", head: true })
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff)
  .or("account_key.is.null,account_key.eq.");
console.log(`Rows with missing account_key: ${missingAccount} (${totalInWindow ? (missingAccount / totalInWindow * 100).toFixed(1) : 0}%)`);

const { data: distinctAccounts } = await supa
  .from("invoice_submissions")
  .select("account_key")
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff);
const accountSet = new Set((distinctAccounts || []).map((r) => r.account_key).filter(Boolean));
console.log(`Distinct accounts in window: ${accountSet.size}`);
console.log(`Columns confirmed: invoice_submissions.{ai_scan_status, ai_scan_complete, account_key, invoice_number, type, vendor_id, submitted_at, is_historical}`);

// ── Bucket 1: FAILED (ai_scan_status='failed') ──
console.log("\n## Bucket 1: FAILED (ai_scan_status='failed')\n");

const { data: failedRows, error: fE } = await supa
  .from("invoice_submissions")
  .select("id, account_key, vendor_id, invoice_number, submitted_at, type, ai_scan_status")
  .eq("ai_scan_status", "failed")
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff)
  .order("submitted_at", { ascending: false });
if (fE) { console.error(`failed query: ${fE.message}`); process.exit(1); }

console.log(`Total FAILED in window: ${failedRows.length}`);

const failedByAccount = new Map();
for (const r of failedRows) {
  const a = r.account_key || "(no account)";
  if (!failedByAccount.has(a)) failedByAccount.set(a, []);
  failedByAccount.get(a).push(r);
}
console.log("By account:");
for (const [a, rs] of [...failedByAccount.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${String(rs.length).padStart(3)}  ${a}`);
}

// ── Bucket 2: EMPTY (ai_scan_complete=TRUE but 0 ai_line_items) ──
console.log("\n## Bucket 2: EMPTY (ai_scan_complete=TRUE but 0 ai_line_items) - RAW (before false-positive guard)\n");

const { data: candidates, error: cE } = await supa
  .from("invoice_submissions")
  .select("id, account_key, vendor_id, invoice_number, submitted_at, type, ai_scan_status, status")
  .eq("ai_scan_complete", true)
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff)
  .order("submitted_at", { ascending: false });
if (cE) { console.error(`empty candidates: ${cE.message}`); process.exit(1); }
console.log(`Candidates (ai_scan_complete=TRUE): ${candidates.length}`);

const candidateIds = candidates.map((c) => c.id);
const present = new Set();
for (let i = 0; i < candidateIds.length; i += 200) {
  const slice = candidateIds.slice(i, i + 200);
  const { data, error } = await supa
    .from("ai_line_items")
    .select("invoice_uuid")
    .in("invoice_uuid", slice);
  if (error) { console.error(`line items: ${error.message}`); process.exit(1); }
  for (const r of data || []) present.add(r.invoice_uuid);
}
const empties = candidates.filter((c) => !present.has(c.id));
console.log(`EMPTY (no ai_line_items rows): ${empties.length}`);

// ── False-positive guard: separate credits + cc_receipts + (potentially) other non-invoice doc types ──
console.log("\n## Q3: False-positive guard applied\n");

const emptyByType = new Map();
for (const r of empties) {
  const t = r.type || "(null)";
  if (!emptyByType.has(t)) emptyByType.set(t, []);
  emptyByType.get(t).push(r);
}
console.log("EMPTY by type:");
for (const [t, rs] of [...emptyByType.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${String(rs.length).padStart(3)}  type='${t}'`);
}

// The guard: skip type IN ('credit','cc_receipt'). 'credit' is already excluded by
// Stage 0 from inventory. 'cc_receipt' is allowed in the type CHECK per PR #133
// migration; it may not produce ai_line_items in the same shape (no vendor invoice
// line items, just a receipt total).
const NON_INVOICE_TYPES = new Set(["credit", "cc_receipt"]);
const emptiesAfterGuard = empties.filter((r) => !NON_INVOICE_TYPES.has(r.type));
console.log(`\nEMPTY after guard (excluded type IN ('credit','cc_receipt')): ${emptiesAfterGuard.length}`);
console.log(`Suppressed by guard: ${empties.length - emptiesAfterGuard.length}`);

console.log("\n## Bucket 2: EMPTY after false-positive guard - by account\n");
const emptyAcct = new Map();
for (const r of emptiesAfterGuard) {
  const a = r.account_key || "(no account)";
  if (!emptyAcct.has(a)) emptyAcct.set(a, []);
  emptyAcct.get(a).push(r);
}
for (const [a, rs] of [...emptyAcct.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${String(rs.length).padStart(3)}  ${a}`);
}

// Examples
console.log("\n## EMPTY examples (first 8 after guard):\n");
for (const r of emptiesAfterGuard.slice(0, 8)) {
  console.log(`   ${r.submitted_at}  account=${r.account_key}  vendor_id=${r.vendor_id}  invoice#=${r.invoice_number}  type=${r.type}  status=${r.status}`);
}
console.log("\n## FAILED examples (first 8):\n");
for (const r of failedRows.slice(0, 8)) {
  console.log(`   ${r.submitted_at}  account=${r.account_key}  vendor_id=${r.vendor_id}  invoice#=${r.invoice_number}  type=${r.type}`);
}

// ── Combined view: total bad uploads by account ──
console.log("\n" + "=".repeat(100));
console.log("COMBINED: total bad uploads (FAILED + guarded EMPTY) by account, last 14d");
console.log("=".repeat(100));
const combined = new Map();
for (const r of failedRows) {
  const a = r.account_key || "(no account)";
  if (!combined.has(a)) combined.set(a, { failed: 0, empty: 0 });
  combined.get(a).failed++;
}
for (const r of emptiesAfterGuard) {
  const a = r.account_key || "(no account)";
  if (!combined.has(a)) combined.set(a, { failed: 0, empty: 0 });
  combined.get(a).empty++;
}
console.log(`\n${"account".padEnd(24)} ${"FAILED".padStart(7)} ${"EMPTY".padStart(7)} ${"TOTAL".padStart(7)}`);
for (const [a, c] of [...combined.entries()].sort((a, b) => (b[1].failed + b[1].empty) - (a[1].failed + a[1].empty))) {
  console.log(`${a.padEnd(24)} ${String(c.failed).padStart(7)} ${String(c.empty).padStart(7)} ${String(c.failed + c.empty).padStart(7)}`);
}
console.log(`${"TOTAL".padEnd(24)} ${String(failedRows.length).padStart(7)} ${String(emptiesAfterGuard.length).padStart(7)} ${String(failedRows.length + emptiesAfterGuard.length).padStart(7)}`);
console.log("");
