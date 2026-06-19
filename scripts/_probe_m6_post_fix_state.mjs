// READ-ONLY focused verification of Module 6 post-visibility-fix state.
// Answers: does new-invoice extraction land in PG right now?

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const PAGE = 1000;

// ── PART A.1: pg_failed rows + ai_scan_error verbatim ────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PART A.1 - pg_failed rows + captured ai_scan_error");
console.log("════════════════════════════════════════════════════════════════════");
const { data: pgFailed, error: pgFailedErr } = await supa
  .from("invoice_submissions")
  .select("client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_error, is_historical")
  .eq("ai_scan_status", "pg_failed")
  .order("submitted_at", { ascending: false });
if (pgFailedErr) throw new Error(`pg_failed query: ${pgFailedErr.message}`);
console.log(`  Total pg_failed: ${pgFailed.length}`);
if (pgFailed.length > 0) {
  console.log("");
  for (const r of pgFailed) {
    console.log(`  ─── ${r.client_uuid.slice(0, 8)} ─────────────────`);
    console.log(`      account=${r.account_key}  vendor="${r.vendor_name}"  inv#=${r.invoice_number}`);
    console.log(`      submitted=${r.submitted_at}  historical=${r.is_historical}`);
    console.log(`      ai_scan_error:`);
    console.log(`        ${r.ai_scan_error || "(NULL - this is wrong, error not captured)"}`);
    console.log("");
  }
}

// ── PART A.2: total status breakdown ─────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PART A.2 - status breakdown across all invoice_submissions");
console.log("════════════════════════════════════════════════════════════════════");
const { count: subTotal } = await supa.from("invoice_submissions").select("*", { count: "exact", head: true });
const statuses = ["complete", "failed", "pg_failed", "pending", "photo-only"];
console.log(`  Total invoice_submissions: ${subTotal}`);
const statusCounts = {};
for (const s of statuses) {
  const { count } = await supa.from("invoice_submissions").select("*", { count: "exact", head: true }).eq("ai_scan_status", s);
  statusCounts[s] = count;
  console.log(`    ai_scan_status=${s.padEnd(11)}: ${count}`);
}
// null/unset
const { count: nullStatus } = await supa.from("invoice_submissions").select("*", { count: "exact", head: true }).is("ai_scan_status", null);
console.log(`    ai_scan_status=(null)     : ${nullStatus}`);
console.log("");

// Quick correctness check: complete invoices have line items, failed/null don't
console.log("  Complete-status correctness (sample of 50 complete rows):");
const { data: completeSamples } = await supa
  .from("invoice_submissions")
  .select("id, ai_scan_status")
  .eq("ai_scan_status", "complete")
  .limit(50);
let completeWithLi = 0, completeWithoutLi = 0;
if (completeSamples?.length) {
  for (const s of completeSamples) {
    const { count } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", s.id);
    if ((count || 0) > 0) completeWithLi++;
    else completeWithoutLi++;
  }
  console.log(`    complete WITH line items in PG: ${completeWithLi} / ${completeSamples.length}`);
  console.log(`    complete WITHOUT line items:    ${completeWithoutLi} / ${completeSamples.length}`);
}

// ── PART A.3: gap re-check (Sheets vs PG distinct invoice_uuid) ───────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PART A.3 - gap re-check (PG-only universe; full Sheets pass deferred)");
console.log("════════════════════════════════════════════════════════════════════");
// Quick PG-side count of submissions with status=failed/pg_failed and zero PG line items.
// (Full Sheets-vs-PG run is in scripts/_probe_dual_write_gap_full_history.mjs - we ran
// it earlier; 34 was the result. Here we look at the PG-status-derived signal instead.)
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, ai_scan_status, ai_scan_error, submitted_at, is_historical")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}
const pgLineCountBySubId = new Map();
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa.from("ai_line_items").select("invoice_uuid").range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) pgLineCountBySubId.set(r.invoice_uuid, (pgLineCountBySubId.get(r.invoice_uuid) || 0) + 1);
  if (data.length < PAGE) break;
}
let failedNoLines = 0, pgFailedNoLines = 0, completeNoLines = 0, nullNoLines = 0;
const failedByDay = new Map();
for (const s of subs) {
  if (s.is_historical) continue;
  const pgN = pgLineCountBySubId.get(s.id) || 0;
  if (pgN === 0) {
    const d = String(s.submitted_at || "").slice(0, 10);
    failedByDay.set(d, (failedByDay.get(d) || 0) + 1);
    if (s.ai_scan_status === "failed") failedNoLines++;
    else if (s.ai_scan_status === "pg_failed") pgFailedNoLines++;
    else if (s.ai_scan_status === "complete") completeNoLines++;
    else if (!s.ai_scan_status) nullNoLines++;
  }
}
console.log(`  PG live invoices with zero ai_line_items rows:`);
console.log(`    status=failed     : ${failedNoLines}`);
console.log(`    status=pg_failed  : ${pgFailedNoLines}`);
console.log(`    status=complete   : ${completeNoLines}  (anomaly - status=complete but no PG rows)`);
console.log(`    status=(null)     : ${nullNoLines}`);
console.log(`  Total zero-PG live invoices: ${failedNoLines + pgFailedNoLines + completeNoLines + nullNoLines}`);
console.log("");
console.log("  Zero-PG-line-items invoices by submitted_at day (last 10 days):");
const sortedDays = [...failedByDay.entries()].sort();
const recentDays = sortedDays.slice(-10);
for (const [d, c] of recentDays) console.log(`    ${d}  ${c}`);

// ── PART B.4: trace one working invoice end-to-end ───────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PART B.4 - trace ONE recent successful invoice");
console.log("════════════════════════════════════════════════════════════════════");
const { data: workingSamples } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, submitted_at, ai_scan_status, ai_scan_error, is_historical")
  .eq("ai_scan_status", "complete")
  .eq("is_historical", false)
  .order("submitted_at", { ascending: false })
  .limit(5);
for (const s of workingSamples || []) {
  const { count: liCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", s.id);
  console.log(`  ${s.client_uuid.slice(0, 8)}  ${s.account_key}  "${s.vendor_name}"  inv#=${s.invoice_number}  submitted=${s.submitted_at}`);
  console.log(`    ai_scan_status=${s.ai_scan_status}  ai_scan_error=${s.ai_scan_error || "(null)"}  vendor_id=${s.vendor_id}`);
  console.log(`    PG ai_line_items rows: ${liCount}`);
}

// ── PART B.5: would a failing invoice still fail if re-scanned? ──────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PART B.5 - static reproducibility check on a failing invoice");
console.log("════════════════════════════════════════════════════════════════════");
// Take one Shamrock pg_failed/failed row. Check whether the static-detectable
// conditions (vendor resolve, line_num collisions in PG line items if any)
// would still cause a failure.
const { data: probSamples } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, submitted_at, ai_scan_status, ai_scan_error, is_historical")
  .or("ai_scan_status.eq.failed,ai_scan_status.eq.pg_failed")
  .eq("is_historical", false)
  .order("submitted_at", { ascending: false })
  .limit(8);
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
for (const s of probSamples || []) {
  const vid = nameToVendorId.get((s.vendor_name || "").toLowerCase().trim());
  console.log(`  ${s.client_uuid.slice(0, 8)}  ${s.account_key}  "${s.vendor_name}"  status=${s.ai_scan_status}`);
  console.log(`    vendor resolves: ${vid ? "YES (" + vid + ")" : "NO"}`);
  console.log(`    ai_scan_error: ${s.ai_scan_error || "(null - pre-fix failure, no captured error)"}`);
}
console.log("");
console.log("Done.");
