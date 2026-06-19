// READ-ONLY post-Part-A state check:
//   1. How many "probe" / "PROBE" junk rows did the verify script leave?
//   2. Has any REAL (non-probe) invoice landed in ai_line_items after the
//      Vercel deploy with vendor_id populated?

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("═══ Q1: probe junk left by verify-pr-8-1 script ═══");

// The verify script inserts up to 2 rows per run with vendor_name="probe"
// and account_key="PROBE". List every match.
const { data: probes, error: e1 } = await supa
  .from("ai_line_items")
  .select("id, invoice_uuid, account_key, vendor_name, vendor_id, line_num, description, created_at")
  .or("vendor_name.eq.probe,vendor_name.eq.PROBE,account_key.eq.PROBE")
  .order("created_at", { ascending: false });
if (e1) { console.error(e1.message); process.exit(1); }
console.log(`Total probe-shaped rows: ${probes.length}`);
for (const r of probes) {
  console.log(`  id=${r.id}`);
  console.log(`    created_at=${r.created_at}`);
  console.log(`    invoice_uuid=${r.invoice_uuid}`);
  console.log(`    account_key=${r.account_key}  vendor_name="${r.vendor_name}"  vendor_id=${r.vendor_id || "(null)"}`);
  console.log(`    line_num=${r.line_num}  description="${r.description}"`);
}

// Cross-check: rows-with-NULL-vendor_id vs probe count. If only probes
// have NULL vendor_id, the underlying state is still "Part A clean for
// real data".
console.log("");
const { count: totalNull } = await supa
  .from("ai_line_items").select("*", { count: "exact", head: true })
  .is("vendor_id", null);
console.log(`Total ai_line_items rows with vendor_id IS NULL: ${totalNull}`);
const probeNulls = probes.filter((r) => r.vendor_id === null).length;
console.log(`  of those, "probe" rows from the verify script: ${probeNulls}`);
console.log(`  non-probe NULL rows: ${totalNull - probeNulls}  (should be 0 if Part A backfill held)`);

console.log("");
console.log("═══ Q2: real post-deploy live write proof ═══");

// What is the most recent NON-probe non-historical row, and does it have
// vendor_id populated? This is the only proof that the new code path is
// actually writing vendor_id on real invoices.
const { data: recent, error: e2 } = await supa
  .from("ai_line_items")
  .select("id, invoice_uuid, account_key, vendor_name, vendor_id, created_at, is_historical")
  .eq("is_historical", false)
  .not("vendor_name", "in", "(probe,PROBE)")
  .order("created_at", { ascending: false })
  .limit(10);
if (e2) { console.error(e2.message); process.exit(1); }
console.log(`Most recent 10 non-probe, non-historical rows (newest first):`);
for (const r of recent) {
  const tag = r.vendor_id ? "✓ vendor_id" : "✗ NULL vendor_id";
  console.log(`  ${r.created_at}  ${tag}=${r.vendor_id || "(null)"}  vendor_name="${r.vendor_name}"  invoice_uuid=${r.invoice_uuid}`);
}

// Look up the most-recent insert across the WHOLE table for ground truth.
const { data: anyRecent } = await supa
  .from("ai_line_items")
  .select("created_at, vendor_name, vendor_id, is_historical")
  .order("created_at", { ascending: false })
  .limit(1);
console.log("");
console.log(`Single most-recent ai_line_items row in the whole table:`);
if (anyRecent?.[0]) {
  const r = anyRecent[0];
  console.log(`  created_at=${r.created_at}  vendor_name="${r.vendor_name}"  vendor_id=${r.vendor_id || "(null)"}  is_historical=${r.is_historical}`);
}
