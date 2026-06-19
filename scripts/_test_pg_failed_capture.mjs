// ════════════════════════════════════════════════════════════════════════════
// One-shot controlled test of the PG insert failure path for fd004ff4.
//
// What it does:
//   1. Resolves the invoice + reads its existing Sheets line items
//   2. Builds the same payload insertAILineItemsPostgres would (verbatim)
//   3. Calls supabase.insert on ai_line_items directly (= what the PG
//      adapter's last line does at invoice.js:1075)
//   4. Captures the PG error verbatim
//   5. Formats the would-be-throw message the same way the adapter
//      does at invoice.js:1076 (string-literal prefix)
//   6. Tests the migration writes: ai_scan_status='pg_failed' +
//      ai_scan_error=<message>
//   7. Reads the row back to confirm
//   8. Restores to original ai_scan_status + ai_scan_error
//
// What it does NOT do:
//   - No Claude API call
//   - No Sheets writes
//   - No production code import (replicates the adapter's logic to avoid
//     calling insertAILineItemsSheets via the orchestrator)
//   - No ai_line_items insertions left behind (rollback any success)
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
// client_uuid is a UUID column; no ILIKE. Pull all Ben E Keith invoices
// with no PG line items and pick the one whose client_uuid starts with the
// prefix. (fd004ff4 was the dup-line-38 Ben E Keith from the static trace.)
const { data: candidates, error: subErr } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, invoice_date, ai_scan_status, ai_scan_error, is_historical")
  .eq("vendor_name", "Ben E Keith")
  .eq("is_historical", false);
if (subErr) throw new Error(`sub lookup: ${subErr.message}`);
const match = (candidates || []).find((c) => String(c.client_uuid).startsWith(TARGET_PREFIX));
if (!match) throw new Error(`No Ben E Keith invoice found with client_uuid starting ${TARGET_PREFIX}`);
const sub = match;

const ORIGINAL_STATUS = sub.ai_scan_status;
const ORIGINAL_ERROR  = sub.ai_scan_error;

console.log("════════════════════════════════════════════════════════════════════");
console.log("  Target invoice");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  client_uuid:    ${sub.client_uuid}`);
console.log(`  PG id:          ${sub.id}`);
console.log(`  account_key:    ${sub.account_key}`);
console.log(`  vendor_name:    ${sub.vendor_name}`);
console.log(`  invoice_number: ${sub.invoice_number}`);
console.log(`  invoice_date:   ${sub.invoice_date}`);
console.log(`  is_historical:  ${sub.is_historical}`);
console.log(`  ORIGINAL ai_scan_status: ${ORIGINAL_STATUS ?? "(null)"}`);
console.log(`  ORIGINAL ai_scan_error:  ${ORIGINAL_ERROR ?? "(null)"}`);
console.log("");

// Pre-flight: confirm PG=0 so we don't pollute the existing row count
const { count: preCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
console.log(`  PG ai_line_items pre-flight count: ${preCount}`);
if (preCount !== 0) {
  console.error(`  ABORT: expected 0 PG rows. Aborting to avoid duplicates.`);
  process.exit(1);
}

// ── Step 2: Read Sheets line items for this invoice ────────────────────────
console.log("");
console.log("Reading Sheets line items...");
const sheetsRes = await sheetsApi.spreadsheets.values.get({
  spreadsheetId: AI_LINE_ITEMS,
  range: `'${sub.account_key}'!A:O`,
});
const allRows = sheetsRes.data.values || [];
const matchingRows = allRows.filter((r, i) => i > 0 && String(r[0] || "").trim() === sub.client_uuid);
console.log(`  Sheets rows for this invoice: ${matchingRows.length}`);
if (matchingRows.length === 0) throw new Error("No Sheets rows - cannot reproduce extraction");

// LINE_ITEM_HEADERS column order:
// 0 Invoice UUID, 1 Timestamp, 2 Account, 3 Vendor, 4 Invoice #,
// 5 Invoice Date, 6 Line #, 7 Item Description, 8 Quantity, 9 Unit,
// 10 Unit Price, 11 Extended Price, 12 Category, 13 Confidence, 14 Raw JSON
const lineItems = matchingRows.map((r) => ({
  invoiceNumber: r[4] || "",
  invoiceDate:   r[5] || "",
  lineNum:       parseInt(r[6], 10) || 0,
  description:   r[7] || "",
  quantity:      r[8] ? parseFloat(r[8]) : null,
  unit:          r[9] || null,
  unitPrice:     r[10] ? parseFloat(r[10]) : null,
  extendedPrice: r[11] ? parseFloat(r[11]) : null,
  category:      r[12] || null,
  confidence:    r[13] || null,
  rawJson:       r[14] || null,
  vendorName:    r[3] || sub.vendor_name,
}));

// Check for line_num dups (deterministic re-trigger signal)
const lineNumCount = new Map();
for (const li of lineItems) lineNumCount.set(li.lineNum, (lineNumCount.get(li.lineNum) || 0) + 1);
const dups = [...lineNumCount.entries()].filter(([, c]) => c > 1);
console.log(`  line_num dup signal: ${dups.length > 0 ? dups.map(([n, c]) => `${n}x${c}`).join(", ") : "(none)"}`);

// ── Step 3: Build payload like insertAILineItemsPostgres does ──────────────
// Vendor resolution
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const { data: aliases } = await supa.from("vendor_aliases").select("vendor_id, alias_normalized");
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
const aliasNormToVendorId = new Map();
for (const a of aliases || []) aliasNormToVendorId.set((a.alias_normalized || "").toLowerCase(), a.vendor_id);
function normalizeAlias(s) { return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ""); }
function resolveVendorId(vendorName) {
  const lower = String(vendorName || "").trim().toLowerCase();
  if (!lower) return null;
  const exact = nameToVendorId.get(lower);
  if (exact) return exact;
  const norm = normalizeAlias(vendorName);
  return aliasNormToVendorId.get(norm) || null;
}

function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

const rows = [];
let perLineVendorThrow = null;
for (const item of lineItems) {
  const vendorName = item.vendorName || sub.vendor_name;
  const vendorId = resolveVendorId(vendorName);
  if (!vendorId) {
    perLineVendorThrow = `[dataStore.invoice.pg] insertAILineItems: vendor "${vendorName}" did not resolve to a vendor_id (exact + alias lookup both failed). Add a vendors row for "${vendorName}" or a vendor_aliases entry mapping it to the canonical vendor, then re-submit invoice ${sub.client_uuid}.`;
    break;
  }
  rows.push({
    invoice_uuid:   sub.id,
    account_key:    sub.account_key,
    vendor_name:    vendorName,
    vendor_id:      vendorId,
    invoice_number: item.invoiceNumber || sub.invoice_number,
    invoice_date:   parseDateOrNull(item.invoiceDate) || sub.invoice_date,
    line_num:       item.lineNum || 0,
    description:    item.description || "",
    quantity:       item.quantity != null ? item.quantity : null,
    unit:           item.unit || null,
    unit_price:     item.unitPrice != null ? item.unitPrice : null,
    extended_price: item.extendedPrice != null ? item.extendedPrice : null,
    category:       item.category || null,
    confidence:     item.confidence || null,
    raw_json:       null,  // Sheets stores stringified JSON; parsing is irrelevant for this test
  });
}

if (perLineVendorThrow) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Per-line vendor unresolvable would throw BEFORE the insert");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Message (would be thrown):`);
  console.log(`    ${perLineVendorThrow}`);
  process.exit(0);
}

console.log(`  Built ${rows.length} row payload, all vendor_id resolved`);
console.log("");

// ── Step 4: Direct insert (this is exactly what invoice.js:1075 calls) ────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  STEP 4 - PG insert (calls supabase.from('ai_line_items').insert)");
console.log("════════════════════════════════════════════════════════════════════");
const { data: insData, error: insErr } = await supa.from("ai_line_items").insert(rows).select("id");
let thrownMessage = null;
let prefixPresent = null;
if (insErr) {
  // Replicate the wrap at invoice.js:1076 verbatim:
  // throw new Error(`[dataStore.invoice.pg] insertAILineItems: ${error.message}`);
  thrownMessage = `[dataStore.invoice.pg] insertAILineItems: ${insErr.message}`;
  prefixPresent = thrownMessage.includes("[dataStore.invoice.pg]");
  console.log("  INSERT FAILED.");
  console.log(`    PG code:    ${insErr.code}`);
  console.log(`    PG details: ${insErr.details || "(none)"}`);
  console.log(`    PG hint:    ${insErr.hint || "(none)"}`);
  console.log("");
  console.log("  VERBATIM thrown Error message (the production code wraps at invoice.js:1076):");
  console.log("  ┌─────────────────────────────────────────────────────────────────");
  for (const line of thrownMessage.split("\n")) console.log(`  │ ${line}`);
  console.log("  └─────────────────────────────────────────────────────────────────");
  console.log("");
  console.log(`  [dataStore.invoice.pg] prefix present: ${prefixPresent}`);
} else {
  console.log(`  INSERT SUCCEEDED: ${insData.length} rows.`);
  console.log("  (Original cause was either transient OR resolved by an earlier fix.)");
  console.log("  Rolling back inserted rows so the row state stays consistent.");
  const ids = insData.map((r) => r.id);
  const { error: delErr } = await supa.from("ai_line_items").delete().in("id", ids);
  if (delErr) {
    console.error(`  ROLLBACK FAILED: ${delErr.message} - ${ids.length} ROWS LEFT IN PG, MANUAL CLEANUP NEEDED`);
  } else {
    console.log(`  rolled back ${ids.length} rows.`);
  }
}

// ── Step 5: If we have a throw message, test the migration writes it ──────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  STEP 5 - Write pg_failed + ai_scan_error to verify migration");
console.log("════════════════════════════════════════════════════════════════════");
const testMessage = thrownMessage || "[dataStore.invoice.pg] insertAILineItems: (synthetic test - insert unexpectedly succeeded so no real throw was captured)";
const { error: updErr } = await supa
  .from("invoice_submissions")
  .update({ ai_scan_status: "pg_failed", ai_scan_error: testMessage })
  .eq("id", sub.id);
let writeAccepted = false;
let storedMessage = null;
let storedStatus = null;
if (updErr) {
  console.log(`  UPDATE FAILED: ${updErr.code} ${updErr.message}`);
} else {
  // Read back
  const { data: rb } = await supa
    .from("invoice_submissions")
    .select("ai_scan_status, ai_scan_error")
    .eq("id", sub.id)
    .maybeSingle();
  storedStatus = rb?.ai_scan_status;
  storedMessage = rb?.ai_scan_error;
  writeAccepted = storedStatus === "pg_failed" && storedMessage === testMessage;
  console.log(`  UPDATE succeeded.`);
  console.log(`  Read-back ai_scan_status: ${storedStatus}`);
  console.log(`  Read-back ai_scan_error:  ${storedMessage}`);
  console.log(`  Round-trip integrity:     ${writeAccepted ? "OK (exact match)" : "MISMATCH"}`);
}

// ── Step 6: Restore original state ────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  STEP 6 - Restore row to original state");
console.log("════════════════════════════════════════════════════════════════════");
const { error: restoreErr } = await supa
  .from("invoice_submissions")
  .update({ ai_scan_status: ORIGINAL_STATUS, ai_scan_error: ORIGINAL_ERROR })
  .eq("id", sub.id);
if (restoreErr) {
  console.log(`  RESTORE FAILED: ${restoreErr.message}`);
  console.log(`  Manual fix needed for row ${sub.id}:`);
  console.log(`    ai_scan_status -> ${ORIGINAL_STATUS}`);
  console.log(`    ai_scan_error  -> ${ORIGINAL_ERROR}`);
} else {
  const { data: rb2 } = await supa
    .from("invoice_submissions")
    .select("ai_scan_status, ai_scan_error")
    .eq("id", sub.id)
    .maybeSingle();
  const restored = (rb2?.ai_scan_status ?? null) === ORIGINAL_STATUS && (rb2?.ai_scan_error ?? null) === ORIGINAL_ERROR;
  console.log(`  Read-back ai_scan_status: ${rb2?.ai_scan_status ?? "(null)"}`);
  console.log(`  Read-back ai_scan_error:  ${rb2?.ai_scan_error ?? "(null)"}`);
  console.log(`  Restored to original:     ${restored ? "YES" : "MISMATCH - manual fix needed"}`);
}

// Confirm no PG ai_line_items left behind
const { count: postCount } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("invoice_uuid", sub.id);
console.log("");
console.log(`  PG ai_line_items post-test count: ${postCount}  (was ${preCount})`);

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  FINAL SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  1. PG threw on insert:      ${thrownMessage ? "YES" : "NO"}`);
if (thrownMessage) {
  console.log(`  2. Prefix present:          ${prefixPresent ? "YES" : "NO - HOLE IN CATCH HANDLER"}`);
}
console.log(`  3. ai_scan_error wrote:     ${writeAccepted ? "YES (round-trip exact)" : "FAILED"}`);
console.log(`  4. Row restored to original: ${ORIGINAL_STATUS}/${ORIGINAL_ERROR === null ? "null" : "set"}`);
