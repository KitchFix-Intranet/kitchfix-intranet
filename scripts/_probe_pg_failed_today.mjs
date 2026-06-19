// Check what's captured in ai_scan_error for the 13 pg_failed rows from today.
// PR #138 visibility fix should have captured the actual cause now that
// production is actively failing.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data } = await supa
  .from("invoice_submissions")
  .select("client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_error")
  .eq("ai_scan_status", "pg_failed")
  .order("submitted_at", { ascending: false });

console.log(`Total pg_failed rows: ${data?.length || 0}`);
console.log("");

// Group by ai_scan_error signature
const byError = new Map();
for (const r of data || []) {
  const sig = (r.ai_scan_error || "(null)").slice(0, 200);
  if (!byError.has(sig)) byError.set(sig, []);
  byError.get(sig).push(r);
}

for (const [sig, rows] of [...byError.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ── ${rows.length} invoice(s) with ai_scan_error: ──`);
  console.log(`     ${sig}`);
  console.log("");
  for (const r of rows.slice(0, 3)) {
    console.log(`     ${r.client_uuid.slice(0, 8)}  ${r.submitted_at}  ${r.account_key}  "${r.vendor_name}"  inv#=${r.invoice_number}`);
  }
  if (rows.length > 3) console.log(`     ... and ${rows.length - 3} more`);
  console.log("");
}

// Also check the 25 failed + 8 null - these are pre-#138 era, no captured error
console.log("─────────────────────────────────────────────────────────────────────");
console.log("Pre-#138 invoices in gap (status=failed or null, no captured error):");
const { data: olderGap } = await supa
  .from("invoice_submissions")
  .select("submitted_at, ai_scan_status, vendor_name")
  .or("ai_scan_status.eq.failed,ai_scan_status.is.null")
  .eq("is_historical", false)
  .order("submitted_at", { ascending: false });
const olderRecent = (olderGap || []).filter((r) => new Date(r.submitted_at) >= new Date("2026-06-01"));
const byDate = new Map();
for (const r of olderRecent) {
  const d = String(r.submitted_at).slice(0, 10);
  byDate.set(d, (byDate.get(d) || 0) + 1);
}
console.log("  By date:");
for (const [d, c] of [...byDate.entries()].sort()) console.log(`    ${d}  ${c}`);
