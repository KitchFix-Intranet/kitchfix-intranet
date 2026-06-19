// What did today's invoice uploads do?
// PR #138 merged 2026-06-12T16:45:17Z. Anything submitted AFTER that should
// be running on the new code path (pg_failed + ai_scan_error).
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MERGE_TS = "2026-06-12T16:45:17Z";
const TODAY_START = "2026-06-12T00:00:00Z";

console.log(`PR #138 merge time: ${MERGE_TS}`);
console.log(`Current date: 2026-06-12`);
console.log("");

// Today's submissions
const { data: todays } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_error, is_historical")
  .gte("submitted_at", TODAY_START)
  .eq("is_historical", false)
  .order("submitted_at", { ascending: false });

console.log(`Today's live submissions: ${todays?.length || 0}`);
console.log("");
if (!todays?.length) {
  console.log("(none yet)");
}

let post = 0, pre = 0;
const postSubs = [];
const preSubs = [];
for (const s of todays || []) {
  if (s.submitted_at >= MERGE_TS) { post++; postSubs.push(s); }
  else { pre++; preSubs.push(s); }
}
console.log(`  Pre-merge (before 16:45 UTC):  ${pre}`);
console.log(`  Post-merge (after 16:45 UTC):  ${post}`);
console.log("");

if (postSubs.length > 0) {
  console.log("POST-MERGE submissions (these should reflect the new code path):");
  for (const s of postSubs) {
    const { count } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", s.id);
    console.log(`  ${s.client_uuid.slice(0, 8)}  ${s.submitted_at}  ${s.account_key}  "${s.vendor_name}"`);
    console.log(`    status=${s.ai_scan_status}  ai_scan_error=${s.ai_scan_error || "(null)"}  PG line items=${count}`);
  }
} else {
  console.log("No post-merge submissions yet - new code path hasn't been exercised by a real upload.");
}

if (preSubs.length > 0) {
  console.log("");
  console.log("PRE-MERGE today submissions (ran on old code):");
  for (const s of preSubs) {
    const { count } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", s.id);
    console.log(`  ${s.client_uuid.slice(0, 8)}  ${s.submitted_at}  ${s.account_key}  "${s.vendor_name}"`);
    console.log(`    status=${s.ai_scan_status}  ai_scan_error=${s.ai_scan_error || "(null)"}  PG line items=${count}`);
  }
}

// Also check Vercel deploy state - last deployment timestamp
console.log("");
console.log("(Vercel auto-deploy from main happens within ~2-5min of merge; if no");
console.log(" post-merge uploads have occurred, the new code is deployed but untested.)");
