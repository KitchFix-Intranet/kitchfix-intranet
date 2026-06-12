// ════════════════════════════════════════════════════════════════════════════
// Verify the line_num re-sequence fix lands fd004ff4's lines in PG cleanly.
//
// What it does:
//   1. Resolves fd004ff4 (Ben E Keith, the dup-line-38 invoice)
//   2. Reads its 68 Sheets line items
//   3. Re-sequences line_num to 1..68 (same logic the production code now does
//      at src/lib/invoiceActions.js:1364)
//   4. Builds the PG payload + calls supabase.insert directly
//   5. Confirms it lands (no 23505), counts rows = 68
//   6. Rolls back (deletes the just-inserted rows so the invoice stays in
//      its current gap state - the actual recovery is a follow-up step)
//   7. Confirms invoice's ai_scan_status was not touched
//
// What it does NOT do:
//   - No Claude API call (uses existing Sheets rows as the OCR substitute)
//   - No Sheets writes
//   - No ai_scan_status changes
//   - No artifacts left behind (all inserts rolled back)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheetsApi = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

const TARGET_PREFIX = "fd004ff4";

// ── Step 1: Resolve invoice ────────────────────────────────────────────────
const { data: candidates } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, invoice_date, ai_scan_status, ai_scan_error, is_historical")
  .eq("vendor_name", "Ben E Keith")
  .eq("is_historical", false);
const sub = (candidates || []).find((c) => String(c.client_uuid).startsWith(TARGET_PREFIX));
if (!sub) throw new Error(`No Ben E Keith invoice found with prefix ${TARGET_PREFIX}`);

const ORIGINAL_STATUS = sub.ai_scan_status;
const ORIGINAL_ERROR  = sub.ai_scan_error;

console.log("════════════════════════════════════════════════════════════════════");
console.log("  Target invoice");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  client_uuid:    ${sub.client_uuid}`);
console.log(`  PG id:          ${sub.id}`);
console.log(`  account_key:    ${sub.account_key}`);
console.log(`  vendor_name:    ${sub.vendor_name}`);
console.log(`  ai_scan_status: ${ORIGINAL_STATUS ?? "(null)"}  (will NOT be touched)`);
console.log("");

// Pre-flight: confirm PG=0
const { count: preCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
if (preCount !== 0) {
  console.error(`  ABORT: expected 0 PG rows, got ${preCount}`);
  process.exit(1);
}

// ── Step 2: Read Sheets line items ─────────────────────────────────────────
const sheetsRes = await sheetsApi.spreadsheets.values.get({
  spreadsheetId: AI_LINE_ITEMS,
  range: `'${sub.account_key}'!A:O`,
});
const matchingRows = (sheetsRes.data.values || [])
  .filter((r, i) => i > 0 && String(r[0] || "").trim() === sub.client_uuid);
console.log(`  Sheets rows: ${matchingRows.length}`);

// Original Claude line_nums (for the contrast log)
const originalLineNums = matchingRows.map((r) => parseInt(r[6], 10));
const originalUniqueNums = new Set(originalLineNums).size;
console.log(`  Original Claude line_nums: ${originalLineNums.length} total, ${originalUniqueNums} unique`);
if (originalLineNums.length !== originalUniqueNums) {
  console.log(`  -> collision count: ${originalLineNums.length - originalUniqueNums} (this is what 23505'd the original insert)`);
}

// Convert Sheets row -> the OCR "item" shape that extractAndStoreLineItems.map gets
const items = matchingRows.map((r) => ({
  lineNum:       parseInt(r[6], 10) || 0,
  description:   r[7] || "",
  quantity:      r[8] ? parseFloat(r[8]) : 0,
  unit:          r[9] || "",
  unitPrice:     r[10] ? parseFloat(r[10]) : 0,
  extendedPrice: r[11] ? parseFloat(r[11]) : 0,
  category:      r[12] || "other",
}));

// ── Step 3: Apply the fix - re-sequence 1..N - exactly the production code ──
// This must match src/lib/invoiceActions.js:1364 verbatim for the test to be meaningful.
const lineItems = items.map((item, idx) => ({
  lineNum:       idx + 1,  // <-- THE FIX
  description:   item.description || "",
  quantity:      item.quantity || 0,
  unit:          item.unit || "",
  unitPrice:     item.unitPrice || 0,
  extendedPrice: item.extendedPrice || 0,
  category:      item.category || "other",
  confidence:    "high",
  rawJson:       JSON.stringify(item),
  vendorName:    sub.vendor_name,
  invoiceNumber: sub.invoice_number,
  invoiceDate:   sub.invoice_date,
  itemNumber:        null,
  packSize:          null,
  orderedCount:      null,
  shippedCount:      null,
  uomRaw:            null,
  amount:            null,
  weightLineValue:   null,
  catchWeightMarker: null,
  rawColumns:        null,
}));

const newLineNums = lineItems.map((li) => li.lineNum);
console.log(`  Re-sequenced line_nums: ${newLineNums[0]}..${newLineNums[newLineNums.length-1]} (${new Set(newLineNums).size} unique)`);
console.log("");

// ── Step 4: Vendor resolve + build PG rows ────────────────────────────────
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
function resolveVendorId(vn) {
  return nameToVendorId.get(String(vn || "").trim().toLowerCase()) || null;
}
const vendorId = resolveVendorId(sub.vendor_name);
if (!vendorId) {
  console.error(`  ABORT: vendor "${sub.vendor_name}" does not resolve`);
  process.exit(1);
}

function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

const rows = lineItems.map((item) => ({
  invoice_uuid:   sub.id,
  account_key:    sub.account_key,
  vendor_name:    sub.vendor_name,
  vendor_id:      vendorId,
  invoice_number: item.invoiceNumber || sub.invoice_number,
  invoice_date:   parseDateOrNull(item.invoiceDate) || sub.invoice_date,
  line_num:       item.lineNum,
  description:    item.description || "",
  quantity:       item.quantity != null ? item.quantity : null,
  unit:           item.unit || null,
  unit_price:     item.unitPrice != null ? item.unitPrice : null,
  extended_price: item.extendedPrice != null ? item.extendedPrice : null,
  category:       item.category || null,
  confidence:     item.confidence || null,
  raw_json:       null,
}));

// ── Step 5: PG insert ──────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  PG insert (with re-sequenced line_nums)");
console.log("════════════════════════════════════════════════════════════════════");
const { data: insData, error: insErr } = await supa.from("ai_line_items").insert(rows).select("id");
let landed = false;
if (insErr) {
  console.log(`  INSERT FAILED:`);
  console.log(`    PG code:    ${insErr.code}`);
  console.log(`    PG message: ${insErr.message}`);
  console.log(`    PG details: ${insErr.details || "(none)"}`);
  console.log(`  Verdict: fix did NOT resolve the failure.`);
} else {
  landed = true;
  console.log(`  INSERT SUCCEEDED: ${insData.length} rows.`);
  // Verify all 68 landed
  const { count: postCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
  console.log(`  PG ai_line_items count for this invoice: ${postCount}`);
  console.log(`  Verdict: ${postCount === matchingRows.length ? "FIX WORKS - all " + matchingRows.length + " rows landed cleanly" : "MISMATCH: expected " + matchingRows.length + ", got " + postCount}`);
}

// ── Step 6: Rollback ──────────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Rollback");
console.log("════════════════════════════════════════════════════════════════════");
if (landed) {
  const ids = insData.map((r) => r.id);
  const { error: delErr } = await supa.from("ai_line_items").delete().in("id", ids);
  if (delErr) {
    console.log(`  ROLLBACK FAILED: ${delErr.message} - ${ids.length} ROWS LEFT BEHIND, MANUAL CLEANUP NEEDED`);
  } else {
    console.log(`  rolled back ${ids.length} rows.`);
  }
}
const { count: postCount2 } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
console.log(`  PG ai_line_items post-rollback: ${postCount2}  (pre-test was ${preCount})`);

// ── Step 7: Confirm ai_scan_status unchanged ──────────────────────────────
const { data: postSub } = await supa
  .from("invoice_submissions")
  .select("ai_scan_status, ai_scan_error")
  .eq("id", sub.id)
  .maybeSingle();
const statusUnchanged = (postSub?.ai_scan_status ?? null) === ORIGINAL_STATUS && (postSub?.ai_scan_error ?? null) === ORIGINAL_ERROR;
console.log(`  ai_scan_status untouched: ${statusUnchanged ? "YES" : "NO - MISMATCH"}`);

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Summary");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  Re-sequence applied:            YES (idx+1 for ${matchingRows.length} rows)`);
console.log(`  Original collision count:       ${originalLineNums.length - originalUniqueNums}`);
console.log(`  Insert landed without 23505:    ${landed ? "YES" : "NO"}`);
console.log(`  Rolled back cleanly:            ${postCount2 === preCount ? "YES" : "NO"}`);
console.log(`  Invoice status untouched:       ${statusUnchanged ? "YES" : "NO"}`);
