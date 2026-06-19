// Read-only probe: state of the 6 STL-MO deferred invoices flagged
// overcount_suspect_reextract.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNT_KEY = "STL - MO";

// Read review_queue from Sheets (cron path)
console.log("Reading review_queue from Sheets...");
const { rows } = await readSheetSA(SHEET_IDS.INVENTORY, "review_queue");
console.log("Total review_queue rows: " + rows.length);

const overcountRows = rows.filter((r) =>
  String(r[13] || "").trim() === "overcount_suspect_reextract" &&
  String(r[5] || "").trim() === ACCOUNT_KEY
);
console.log("STL-MO overcount_suspect_reextract rows: " + overcountRows.length);

// Group by invoice_uuid
const byInv = new Map();
for (const r of overcountRows) {
  const inv = String(r[3] || "").trim();
  if (!byInv.has(inv)) byInv.set(inv, []);
  byInv.get(inv).push(r);
}
console.log("Distinct invoice_uuids deferred: " + byInv.size);

// For each, pull invoice_submissions + ai_line_items
const invIds = [...byInv.keys()];
console.log("");
console.log("══════════════════════════════════════════════════════════════════");
console.log("PER-INVOICE LIVE STATE");
console.log("══════════════════════════════════════════════════════════════════");

// Look up by client_uuid (the value in review_queue col D maps to invoice_submissions.client_uuid)
const { data: subs } = await supa.from("invoice_submissions")
  .select("id, client_uuid, vendor_name, invoice_number, invoice_date, total_amount, submitted_at, status, type, ai_scan_status, ai_scan_complete, is_historical, data_provenance, dupe_override")
  .in("client_uuid", invIds);

// Also try by id directly
const { data: subsById } = await supa.from("invoice_submissions")
  .select("id, client_uuid, vendor_name, invoice_number, invoice_date, total_amount, submitted_at, status, type, ai_scan_status, ai_scan_complete, is_historical, data_provenance, dupe_override")
  .in("id", invIds);

const subMap = new Map();
for (const s of subs || []) subMap.set(s.client_uuid, s);
for (const s of subsById || []) subMap.set(s.id, s);

// invoice_verifications tab to check release state
let verifiedSet = new Set();
try {
  const { rows: verRows } = await readSheetSA(SHEET_IDS.INVENTORY, "invoice_verifications");
  for (const v of verRows) {
    const acct = String(v[2] || "").trim();
    const uuid = String(v[1] || "").trim();
    if (uuid && (acct === ACCOUNT_KEY || acct.startsWith(ACCOUNT_KEY + " -") || ACCOUNT_KEY.startsWith(acct + " -"))) {
      verifiedSet.add(uuid);
    }
  }
  console.log("invoice_verifications tab read: " + verRows.length + " rows (STL-MO verified=" + verifiedSet.size + ")");
} catch (e) {
  console.log("invoice_verifications tab read failed: " + e.message);
}

console.log("");
let idx = 0;
for (const [invUuid, lines] of byInv) {
  idx++;
  const sub = subMap.get(invUuid);
  console.log("--- Invoice " + idx + "/" + byInv.size + " ---");
  console.log("  invoice_uuid:       " + invUuid);
  console.log("  queue_rows:         " + lines.length + " line(s) deferred");
  console.log("  released by verif?: " + (verifiedSet.has(invUuid) ? "YES (would release on next cron)" : "NO (still held)"));
  if (sub) {
    console.log("  vendor:             " + sub.vendor_name);
    console.log("  invoice_number:     " + sub.invoice_number);
    console.log("  invoice_date:       " + sub.invoice_date);
    console.log("  total_amount:       $" + sub.total_amount);
    console.log("  submitted_at:       " + sub.submitted_at);
    console.log("  type:               " + sub.type);
    console.log("  status:             " + sub.status);
    console.log("  ai_scan_status:     " + sub.ai_scan_status);
    console.log("  ai_scan_complete:   " + sub.ai_scan_complete);
    console.log("  is_historical:      " + sub.is_historical);
    console.log("  data_provenance:    " + sub.data_provenance);
    console.log("  dupe_override:      " + sub.dupe_override);

    // Get sum of ai_line_items extended_price for this invoice
    const { data: aiLines } = await supa.from("ai_line_items")
      .select("extended_price, line_num").eq("invoice_uuid", sub.id);
    const sumExt = (aiLines || []).reduce((s, l) => s + Number(l.extended_price || 0), 0);
    const overBy = sumExt - Number(sub.total_amount || 0);
    console.log("  ai_line_items rows: " + (aiLines?.length || 0) + "  sum_extended=$" + sumExt.toFixed(2));
    console.log("  over_by:            $" + overBy.toFixed(2) + " (" + ((Number(sub.total_amount) > 0 ? overBy / Number(sub.total_amount) * 100 : 0)).toFixed(1) + "%)");
  } else {
    console.log("  NOT FOUND in invoice_submissions (by either client_uuid or id)");
  }
  console.log("");
}

// Coverage stats
const recentSubmitted = (subs || []).filter((s) => s).map((s) => s.submitted_at);
const oldest = recentSubmitted.sort()[0];
const newest = recentSubmitted.sort()[recentSubmitted.length - 1];
console.log("Submitted_at range: " + oldest + " ... " + newest);
process.exit(0);
