// READ-ONLY: characterize the OCR/extraction failure rate at scale.
// Pulls the last 30 days of live invoice_submissions, breaks down by status,
// vendor, account, type. Looks at failure clustering. Does NOT propose fixes.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SINCE = new Date(Date.now() - 30 * 86400000).toISOString();
const PAGE = 1000;

// ── Pull last 30 days of live submissions ──────────────────────────────────
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, invoice_date, submitted_at, ai_scan_status, ai_scan_error, type, page_count, drive_urls, raw_drive_url, status")
    .eq("is_historical", false)
    .gte("submitted_at", SINCE)
    .order("submitted_at", { ascending: false })
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}

console.log("════════════════════════════════════════════════════════════════════");
console.log(`  OCR failure characterization - last 30 days (since ${SINCE.slice(0,10)})`);
console.log("════════════════════════════════════════════════════════════════════");
console.log(`Total live invoice_submissions: ${subs.length}`);
console.log("");

// ── Q1: status breakdown ───────────────────────────────────────────────────
const statusCount = new Map();
const typeCount = new Map();
for (const s of subs) {
  const st = s.ai_scan_status || "(null)";
  statusCount.set(st, (statusCount.get(st) || 0) + 1);
  const t = s.type || "(null)";
  typeCount.set(t, (typeCount.get(t) || 0) + 1);
}
console.log("Status breakdown:");
for (const [st, ct] of [...statusCount.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = ((ct / subs.length) * 100).toFixed(1);
  console.log(`  ${st.padEnd(12)} ${String(ct).padStart(4)}  (${pct}%)`);
}
console.log("");
console.log("Type breakdown (form type at submit):");
for (const [t, ct] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(14)} ${String(ct).padStart(4)}`);
}

// Effective pass rate = complete / (total - photo-only - pending - null)
const complete = statusCount.get("complete") || 0;
const failed   = statusCount.get("failed")   || 0;
const pgFailed = statusCount.get("pg_failed")|| 0;
const photoOnly = statusCount.get("photo-only") || 0;
const pending  = statusCount.get("pending")  || 0;
const nullStatus = statusCount.get("(null)") || 0;
const eligible = subs.length - photoOnly - pending - nullStatus;
console.log("");
console.log(`Effective pass rate (complete / eligible): ${complete} / ${eligible} = ${eligible ? ((complete/eligible)*100).toFixed(1) : 0}%`);
console.log(`  (excludes ${photoOnly} photo-only, ${pending} pending, ${nullStatus} null)`);
console.log(`Raw pass rate (complete / total):          ${complete} / ${subs.length} = ${((complete/subs.length)*100).toFixed(1)}%`);

// ── Q2: failures by vendor ─────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Failures by vendor (status in failed/pg_failed/null, sorted by fail rate)");
console.log("════════════════════════════════════════════════════════════════════");
const byVendor = new Map();
for (const s of subs) {
  const v = s.vendor_name || "(unknown)";
  const row = byVendor.get(v) || { total: 0, complete: 0, failed: 0, pg_failed: 0, null: 0, photoOnly: 0, pending: 0 };
  row.total++;
  if (s.ai_scan_status === "complete") row.complete++;
  else if (s.ai_scan_status === "failed") row.failed++;
  else if (s.ai_scan_status === "pg_failed") row.pg_failed++;
  else if (s.ai_scan_status === "photo-only") row.photoOnly++;
  else if (s.ai_scan_status === "pending") row.pending++;
  else row.null++;
  byVendor.set(v, row);
}
// Sort by fail rate (failed+null fraction of eligible)
const vendorRanked = [...byVendor.entries()].map(([v, r]) => {
  const elig = r.total - r.photoOnly - r.pending - r.null;
  const fails = r.failed + r.pg_failed;
  return { vendor: v, ...r, eligible: elig, fails, failPct: elig > 0 ? (fails / elig) * 100 : 0 };
}).filter((r) => r.total >= 3).sort((a, b) => b.failPct - a.failPct);

console.log(`  ${"vendor".padEnd(30)} ${"total".padStart(6)} ${"complete".padStart(9)} ${"failed".padStart(7)} ${"pg_f".padStart(5)} ${"null".padStart(5)} ${"po".padStart(4)} ${"fail%".padStart(7)}`);
console.log(`  ${"-".repeat(30)} ${"-".repeat(6)} ${"-".repeat(9)} ${"-".repeat(7)} ${"-".repeat(5)} ${"-".repeat(5)} ${"-".repeat(4)} ${"-".repeat(7)}`);
for (const r of vendorRanked.slice(0, 25)) {
  console.log(`  ${r.vendor.slice(0,30).padEnd(30)} ${String(r.total).padStart(6)} ${String(r.complete).padStart(9)} ${String(r.failed).padStart(7)} ${String(r.pg_failed).padStart(5)} ${String(r.null).padStart(5)} ${String(r.photoOnly).padStart(4)} ${r.failPct.toFixed(1).padStart(6)}%`);
}

// ── By account ────────────────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Failures by account");
console.log("════════════════════════════════════════════════════════════════════");
const byAccount = new Map();
for (const s of subs) {
  const a = s.account_key || "(unknown)";
  const row = byAccount.get(a) || { total: 0, complete: 0, failed: 0, pg_failed: 0, null: 0, photoOnly: 0 };
  row.total++;
  if (s.ai_scan_status === "complete") row.complete++;
  else if (s.ai_scan_status === "failed") row.failed++;
  else if (s.ai_scan_status === "pg_failed") row.pg_failed++;
  else if (s.ai_scan_status === "photo-only") row.photoOnly++;
  else if (s.ai_scan_status === "pending") row.null++;  // bucket pending with null for display
  else if (!s.ai_scan_status) row.null++;
  byAccount.set(a, row);
}
const accountRanked = [...byAccount.entries()].map(([a, r]) => {
  const elig = r.total - r.photoOnly - r.null;
  const fails = r.failed + r.pg_failed;
  return { account: a, ...r, eligible: elig, fails, failPct: elig > 0 ? (fails / elig) * 100 : 0 };
}).sort((a, b) => b.failPct - a.failPct);

console.log(`  ${"account".padEnd(16)} ${"total".padStart(6)} ${"complete".padStart(9)} ${"failed".padStart(7)} ${"pg_f".padStart(5)} ${"null".padStart(5)} ${"po".padStart(4)} ${"fail%".padStart(7)}`);
console.log(`  ${"-".repeat(16)} ${"-".repeat(6)} ${"-".repeat(9)} ${"-".repeat(7)} ${"-".repeat(5)} ${"-".repeat(5)} ${"-".repeat(4)} ${"-".repeat(7)}`);
for (const r of accountRanked) {
  console.log(`  ${r.account.padEnd(16)} ${String(r.total).padStart(6)} ${String(r.complete).padStart(9)} ${String(r.failed).padStart(7)} ${String(r.pg_failed).padStart(5)} ${String(r.null).padStart(5)} ${String(r.photoOnly).padStart(4)} ${r.failPct.toFixed(1).padStart(6)}%`);
}

// ── Q3: characterize failed invoices ──────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Failed invoice characterization");
console.log("════════════════════════════════════════════════════════════════════");
const failures = subs.filter((s) => s.ai_scan_status === "failed");
console.log(`Total failed (last 30d): ${failures.length}`);

// What can we see about each failed invoice?
// - ai_scan_error: would have post-fix prefix info if it's a pg_failed (already none here)
// - type: invoice vs cc_receipt vs credit
// - page_count: how many pages
// - drive_urls: how many URLs (multi-file or single)
// - raw_drive_url presence

// page_count distribution
const pageCounts = failures.map((f) => f.page_count || 0);
const pcGroups = new Map();
for (const pc of pageCounts) {
  const bucket = pc === 0 ? "(0 or null)" : pc === 1 ? "1 page" : pc <= 3 ? "2-3 pages" : pc <= 6 ? "4-6 pages" : "7+ pages";
  pcGroups.set(bucket, (pcGroups.get(bucket) || 0) + 1);
}
console.log("");
console.log("Failed invoices by page_count:");
for (const [g, c] of [...pcGroups.entries()].sort()) console.log(`  ${g.padEnd(14)} ${c}`);

// type distribution among failures
console.log("");
console.log("Failed invoices by type:");
const failByType = new Map();
for (const f of failures) {
  const t = f.type || "(null)";
  failByType.set(t, (failByType.get(t) || 0) + 1);
}
for (const [t, c] of [...failByType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(14)} ${c}`);

// raw_drive_url presence
const noRaw = failures.filter((f) => !f.raw_drive_url).length;
console.log("");
console.log(`Failed invoices without raw_drive_url: ${noRaw} of ${failures.length}`);

// drive_urls multi-file vs single
const driveUrlsDist = new Map();
for (const f of failures) {
  const n = Array.isArray(f.drive_urls) ? f.drive_urls.length : 0;
  const bucket = n === 0 ? "0 URLs" : n === 1 ? "1 URL" : n <= 3 ? "2-3 URLs" : "4+ URLs";
  driveUrlsDist.set(bucket, (driveUrlsDist.get(bucket) || 0) + 1);
}
console.log("");
console.log("Failed invoices by drive_urls count (how many files chef uploaded):");
for (const [g, c] of [...driveUrlsDist.entries()].sort()) console.log(`  ${g.padEnd(10)} ${c}`);

// ── ai_scan_error on any failures (should be null for true failed; non-null = mislabeled pg_failed) ──
const failedWithErr = failures.filter((f) => f.ai_scan_error);
console.log("");
console.log(`Failed invoices with non-null ai_scan_error: ${failedWithErr.length}`);
if (failedWithErr.length > 0) {
  console.log("  (note: these should be 0 - non-null ai_scan_error on status=failed means a pg_failed got mismarked)");
  for (const f of failedWithErr.slice(0, 5)) {
    console.log(`    ${f.client_uuid.slice(0,8)}  ${f.submitted_at}  ${f.account_key}  "${f.vendor_name}"`);
    console.log(`    err: ${f.ai_scan_error.slice(0, 120)}`);
  }
}

// ── Time-of-day clustering ─────────────────────────────────────────────────
console.log("");
console.log("Failed invoices by hour-of-day (UTC):");
const hourDist = new Map();
for (const f of failures) {
  const h = new Date(f.submitted_at).getUTCHours();
  hourDist.set(h, (hourDist.get(h) || 0) + 1);
}
for (let h = 0; h < 24; h++) {
  if (hourDist.has(h)) console.log(`  ${String(h).padStart(2, "0")}:00  ${"█".repeat(hourDist.get(h))} ${hourDist.get(h)}`);
}

// ── Sample of failures: Cheney close-up (or whichever has highest fail rate) ──
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Sample of recent failures - one per high-fail vendor");
console.log("════════════════════════════════════════════════════════════════════");
const highFailVendors = vendorRanked.filter((v) => v.fails > 0 && v.failPct >= 20).slice(0, 5);
for (const vr of highFailVendors) {
  console.log("");
  console.log(`  ── ${vr.vendor} (fail rate ${vr.failPct.toFixed(1)}%, ${vr.fails}/${vr.eligible}) ──`);
  const samples = failures.filter((f) => f.vendor_name === vr.vendor).slice(0, 4);
  for (const f of samples) {
    const driveCount = Array.isArray(f.drive_urls) ? f.drive_urls.length : 0;
    console.log(`    ${f.client_uuid.slice(0,8)}  ${f.submitted_at.slice(0,16)}  ${f.account_key.padEnd(14)}  type=${(f.type||"?").padEnd(8)}  pages=${f.page_count || "?"}  files=${driveCount}  status=${f.status || "?"}`);
  }
}
