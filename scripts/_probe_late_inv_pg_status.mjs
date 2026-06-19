import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const lateInvs = JSON.parse(fs.readFileSync("/tmp/late_sheets_invs.json", "utf8"));
console.log("Checking " + lateInvs.length + " distinct Sheets-late invoices against PG:");

const uuids = lateInvs.map((x) => x.invoice_uuid);
const { data: subs } = await supa.from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_complete, is_historical")
  .in("id", uuids);
const { data: subsByClientUuid } = await supa.from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_complete, is_historical")
  .in("client_uuid", uuids);

const subMap = new Map();
for (const s of subs || []) subMap.set(s.id, s);
for (const s of subsByClientUuid || []) subMap.set(s.client_uuid, s);

// Also check ai_line_items by invoice_uuid
const { data: lis } = await supa.from("ai_line_items").select("invoice_uuid").in("invoice_uuid", uuids);
const liByInv = new Map();
for (const l of lis || []) liByInv.set(l.invoice_uuid, (liByInv.get(l.invoice_uuid) || 0) + 1);

let foundSubs = 0, missingSubs = 0, hasLines = 0, missingLines = 0;
let recentSubmits = [];
for (const x of lateInvs) {
  const s = subMap.get(x.invoice_uuid);
  if (s) {
    foundSubs++;
    recentSubmits.push({sub: s, sheet: x});
    const lc = liByInv.get(x.invoice_uuid) || 0;
    if (lc > 0) hasLines++; else missingLines++;
  } else {
    missingSubs++;
    console.log("  UNRESOLVED invoice (no PG submission row): acct=" + x.account + " inv_num=" + x.invoice_number + " uuid=" + x.invoice_uuid);
  }
}
console.log();
console.log("Total: " + lateInvs.length);
console.log("  Found in invoice_submissions: " + foundSubs);
console.log("  Missing from invoice_submissions: " + missingSubs);
console.log("  Of those found: with ai_line_items in PG: " + hasLines);
console.log("  Of those found: WITHOUT ai_line_items in PG: " + missingLines);

console.log();
console.log("Submitted_at distribution of the late Sheets writes:");
const subDays = new Map();
for (const r of recentSubmits) {
  const d = String(r.sub.submitted_at).slice(0, 10);
  subDays.set(d, (subDays.get(d) || 0) + 1);
}
for (const [d, c] of [...subDays.entries()].sort()) console.log("  " + d + " : " + c);

console.log();
console.log("Their ai_scan_status:");
const statusCount = new Map();
for (const r of recentSubmits) {
  const k = r.sub.ai_scan_status + "/" + r.sub.ai_scan_complete;
  statusCount.set(k, (statusCount.get(k) || 0) + 1);
}
for (const [k, c] of [...statusCount.entries()].sort()) console.log("  " + k + " : " + c);
