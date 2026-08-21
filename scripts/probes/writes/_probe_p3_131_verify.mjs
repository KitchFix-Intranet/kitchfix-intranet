// Task #131 verification - confirm undoMatchPostgres + undoReconcilePostgres
// now DELETE the row (vanish parity with Sheets tombstone) instead of
// flipping source enum.
//
// Round-trip: forward writes alias/price_history, undo DELETEs them,
// assert the rows are GONE (not just .source flipped).
// Drift-guard: a second undo on the same token is a silent no-op
// (PostgREST DELETE on 0-row match returns success). Note that this
// matches the pre-#131 PG behavior - PG has never had Sheets-style
// pre-write verifiers; the WHERE clause IS the guard, and a 0-match
// WHERE is silent on PG (Sheets verifiers throw). Documented separately.

import { createClient } from "@supabase/supabase-js";
import {
  writeMatchResolutionPostgres,
  resolveReviewQueueLinePostgres,
  undoMatchPostgres,
  undoReconcilePostgres,
} from "../../../src/lib/dataStore/inventory.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SENTINEL = `PROBE_INV2_131_${STAMP}`;
const PROBE_EMAIL = "probe-131@kitchfix.local";

const cleanup = { ai_line_items: [], review_queue: [] };
let failures = [];
function header(t) { console.log(); console.log("══════════════════════════════════════════════════════════════"); console.log(t); console.log("══════════════════════════════════════════════════════════════"); }
function pass(t) { console.log("  ✓ " + t); }
function fail(t) { console.log("  ✗ " + t); failures.push(t); }

// ─────────────────────────────────────────────────────────────────────
header("PRE-SWEEP");
async function preSweep(table, col, pat) {
  const { data } = await supa.from(table).select("id").like(col, pat);
  if (data?.length) {
    const ids = data.map((r) => r.id);
    const { count } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
    console.log("  " + table + ": cleared " + count + " orphans");
  } else console.log("  " + table + ": (none)");
}
await preSweep("review_queue", "line_item_text", "PROBE_INV2_131_%");
await preSweep("ai_line_items", "description",   "PROBE_INV2_131_%");

header("SETUP");
const { data: anyItem } = await supa.from("inventory_items")
  .select("id, account, vendor_id, name").eq("status", "active").eq("account", "STL - MO").limit(1).single();
const PROBE_ITEM_ID = anyItem.id;
const PROBE_ACCOUNT = anyItem.account;
const PROBE_VENDOR_ID = anyItem.vendor_id;
const { data: vRow } = await supa.from("vendors").select("name").eq("id", PROBE_VENDOR_ID).single();
const PROBE_VENDOR_NAME = vRow.name;

const { data: anyInv } = await supa.from("invoice_submissions")
  .select("id, invoice_date").eq("vendor_id", PROBE_VENDOR_ID)
  .not("invoice_date", "is", null).limit(1).single();
const BASE_INV_ID = anyInv.id;
const BASE_INV_DATE = anyInv.invoice_date;
console.log("  ITEM=" + PROBE_ITEM_ID + " VENDOR=" + PROBE_VENDOR_ID + " INV=" + BASE_INV_ID);

let nextLineNum = 951;
async function insQ(label, reason) {
  const desc = SENTINEL + "_" + label;
  const { data } = await supa.from("review_queue").insert({
    account: PROBE_ACCOUNT, line_item_text: desc, vendor: PROBE_VENDOR_NAME,
    invoice_id: BASE_INV_ID, invoice_date: BASE_INV_DATE,
    suggested_match_id: PROBE_ITEM_ID, suggested_match_name: "PROBE",
    confidence: 80, status: "pending", reason: reason || "low_match_confidence",
  }).select("id").single();
  cleanup.review_queue.push(data.id);
  return { id: data.id, desc };
}
async function insLI(label, price) {
  const desc = SENTINEL + "_" + label;
  const { data } = await supa.from("ai_line_items").insert({
    invoice_uuid: BASE_INV_ID, account_key: PROBE_ACCOUNT,
    vendor_name: PROBE_VENDOR_NAME, vendor_id: PROBE_VENDOR_ID,
    invoice_date: BASE_INV_DATE, line_num: nextLineNum++,
    description: desc, quantity: 99, unit: "case", unit_price: price,
    extended_price: price * 99, category: "Food",
  }).select("id").single();
  cleanup.ai_line_items.push(data.id);
  return { id: data.id, desc };
}

const qM = await insQ("M");
const qR = await insQ("R", "arithmetic_fail");
const liM = await insLI("M", 0.81);
const liR = await insLI("R", 0.82);
pass("setup complete");

// ─────────────────────────────────────────────────────────────────────
header("ROUND 1 - Match round-trip (DELETE-on-undo)");

const NOW_M = new Date().toISOString();
await writeMatchResolutionPostgres({
  supa, queueId: qM.id, itemId: PROBE_ITEM_ID, lineItemText: qM.desc,
  account: PROBE_ACCOUNT, vendor: PROBE_VENDOR_NAME, vendorId: PROBE_VENDOR_ID,
  invoiceUuid: BASE_INV_ID, invoiceDate: BASE_INV_DATE,
  unitPrice: 0.81, email: PROBE_EMAIL, now: NOW_M,
});

const { data: aliasBefore } = await supa.from("item_aliases").select("id")
  .eq("item_id", PROBE_ITEM_ID).eq("alias_text", qM.desc).single();
const { data: phBefore } = await supa.from("price_history").select("id")
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", 0.81).single();
console.log("  forward: alias_id=" + aliasBefore.id + " ph_id=" + phBefore.id);

// Undo - should DELETE
const matchToken = {
  queueId: qM.id, itemId: PROBE_ITEM_ID,
  aliasFingerprint: { aliasText: qM.desc },
  priceHistoryFingerprint: { itemId: PROBE_ITEM_ID, invoiceUuid: BASE_INV_ID, price: 0.81, recordedAt: NOW_M },
};
await undoMatchPostgres(matchToken);

// Verify GONE
const { data: aliasAfter } = await supa.from("item_aliases").select("id").eq("id", aliasBefore.id).maybeSingle();
const { data: phAfter } = await supa.from("price_history").select("id").eq("id", phBefore.id).maybeSingle();
if (aliasAfter === null) pass("item_aliases row DELETED (id=" + aliasBefore.id + " gone)");
else fail("item_aliases row STILL EXISTS: " + JSON.stringify(aliasAfter));
if (phAfter === null) pass("price_history row DELETED (id=" + phBefore.id + " gone)");
else fail("price_history row STILL EXISTS: " + JSON.stringify(phAfter));

// Cron-reprocess check: source_or_invoice_id lookup returns zero matches
const { data: cronSetCheck } = await supa.from("price_history").select("id, source")
  .eq("source_or_invoice_id", BASE_INV_ID).eq("item_id", PROBE_ITEM_ID).eq("price", 0.81);
if (cronSetCheck.length === 0) pass("cron processedInvoices Set lookup returns 0 (row vanished from reprocess scope)");
else fail("cron lookup STILL finds " + cronSetCheck.length + " row(s)");

// Queue still flips back
const { data: qMAfter } = await supa.from("review_queue").select("status").eq("id", qM.id).single();
if (qMAfter.status === "pending") pass("queue.status reverted to pending");
else fail("queue.status = " + qMAfter.status);

// Drift-guard: second undo is silent no-op on PG (PG has no Sheets-style
// verifier; WHERE matches 0 rows because row is gone; DELETE returns success)
try {
  await undoMatchPostgres(matchToken);
  pass("double-undo silent no-op (PG-side expected; no Sheets-style verifier)");
} catch (e) { fail("double-undo THREW unexpectedly: " + e.message); }

// ─────────────────────────────────────────────────────────────────────
header("ROUND 2 - Reconcile round-trip (DELETE-on-undo)");

const reconcileResult = await resolveReviewQueueLinePostgres({
  queueId: qR.id, correctedQty: 42, correctedUnit: "case", email: PROBE_EMAIL,
});
const NOW_R = reconcileResult.resolvedAt;

const { data: phRBefore } = await supa.from("price_history").select("id")
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", 0.82).single();
console.log("  forward: ph_id=" + phRBefore.id + "  recorded_at=" + NOW_R);

const { data: liRAfterFwd } = await supa.from("ai_line_items").select("quantity").eq("id", liR.id).single();
if (Number(liRAfterFwd.quantity) === 42) pass("forward: ai_line_items.quantity 99 -> 42");
else fail("forward quantity = " + liRAfterFwd.quantity);

const reconcileToken = {
  queueId: qR.id, invoiceUuid: BASE_INV_ID, lineItemText: qR.desc,
  originalQty: 99, originalUnit: "case", correctedQty: 42, correctedUnit: "case",
  priceHistoryFingerprint: { itemId: PROBE_ITEM_ID, invoiceUuid: BASE_INV_ID, recordedAt: NOW_R },
};
await undoReconcilePostgres(reconcileToken);

// Verify GONE
const { data: phRAfter } = await supa.from("price_history").select("id").eq("id", phRBefore.id).maybeSingle();
if (phRAfter === null) pass("price_history row DELETED (id=" + phRBefore.id + " gone) - Task #131 vanish on PG");
else fail("price_history row STILL EXISTS: " + JSON.stringify(phRAfter));

// ai_line_items.quantity restored, queue back to pending
const { data: liRAfter } = await supa.from("ai_line_items").select("quantity, unit").eq("id", liR.id).single();
if (Number(liRAfter.quantity) === 99) pass("ai_line_items.quantity restored to 99");
else fail("quantity = " + liRAfter.quantity);
if (liRAfter.unit === "case") pass("ai_line_items.unit restored to 'case'");
else fail("unit = " + liRAfter.unit);

const { data: qRAfter } = await supa.from("review_queue").select("status, reviewed_by").eq("id", qR.id).single();
if (qRAfter.status === "pending") pass("queue.status reverted to pending");
else fail("queue.status = " + qRAfter.status);
if (qRAfter.reviewed_by === null) pass("queue.reviewed_by cleared");
else fail("queue.reviewed_by = " + qRAfter.reviewed_by);

// Cron lookup check
const { data: cronCheck2 } = await supa.from("price_history").select("id")
  .eq("source_or_invoice_id", BASE_INV_ID).eq("item_id", PROBE_ITEM_ID).eq("price", 0.82);
if (cronCheck2.length === 0) pass("Reconcile: cron processedInvoices Set lookup returns 0 (row vanished)");
else fail("Reconcile: cron lookup STILL finds " + cronCheck2.length + " row(s)");

try {
  await undoReconcilePostgres(reconcileToken);
  pass("Reconcile double-undo silent no-op (PG-side expected)");
} catch (e) { fail("Reconcile double-undo THREW unexpectedly: " + e.message); }

// ─────────────────────────────────────────────────────────────────────
header("CLEANUP");
async function delIds(table, ids) {
  if (ids.length === 0) { console.log("  " + table + ": (none)"); return; }
  const { count } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
  console.log("  " + table + ": deleted " + count);
}
await delIds("review_queue",  cleanup.review_queue);
await delIds("ai_line_items", cleanup.ai_line_items);

header("CLEANUP SWEEP");
async function sweep(table, col, pat) {
  const { count } = await supa.from(table).select("*", { count: "exact", head: true }).like(col, pat);
  console.log("  " + table.padEnd(20) + ": " + (count === 0 ? "✓ clean" : "✗ " + count));
  if (count > 0) failures.push("sweep " + table);
}
await sweep("review_queue",  "line_item_text", SENTINEL + "%");
await sweep("ai_line_items", "description",    SENTINEL + "%");
// Alias + price_history were DELETED by the reversers, so any sentinel marker is gone with them

header("SUMMARY");
if (failures.length === 0) console.log("TASK #131 VANISH IMPLEMENTATION VERIFIED. Both PG reversers DELETE the row (parity with Sheets tombstone).");
else { console.log("FAILED (" + failures.length + "):"); for (const f of failures) console.log("  - " + f); }
process.exit(failures.length === 0 ? 0 : 1);
