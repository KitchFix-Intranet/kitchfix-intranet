// P3 batch 3 - live round-trip verification of the two PG Undo reversers
// against real DB. Exercises forward-then-undo and asserts that the undo
// restores prior state (including price_history.source actually being
// flipped to manual_resolve_reverted - not silently skipped, the bug that
// was found in undoReconcilePostgres on the static trace).
//
// Reverser 1 (undoMatchPostgres): forward via writeMatchResolutionPostgres
// (already batch-1-verified), undo, verify alias.source + price_history.source
// both flipped + queue back to pending.
//
// Reverser 2 (undoReconcilePostgres): forward via resolveReviewQueueLinePostgres
// (already batch-1-verified), undo, verify ai_line_items.quantity restored
// + price_history.source flipped (the bug from batch 3 static trace) + queue
// back to pending.
//
// PRE-REQ: src/lib/dataStore/inventory.js has TRANSIENT `export` on the four
// internal functions called here. Reverted via plain Edit after the run.

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
const SENTINEL = `PROBE_INV2_BATCH3_${STAMP}`;
const PROBE_EMAIL = "probe-inv2-batch3@kitchfix.local";

const cleanup = {
  ai_line_items: [], review_queue: [], item_aliases: [], price_history: [], invoice_submissions: [],
};
let failures = [];

function header(t) { console.log(); console.log("══════════════════════════════════════════════════════════════"); console.log(t); console.log("══════════════════════════════════════════════════════════════"); }
function pass(t) { console.log("  ✓ " + t); }
function fail(t) { console.log("  ✗ " + t); failures.push(t); }

// ─────────────────────────────────────────────────────────────────────
header("PRE-SWEEP: clean PROBE_INV2_BATCH3_ leftovers");
async function preSweep(table, col, pat) {
  const { data } = await supa.from(table).select("id").like(col, pat);
  if (data && data.length > 0) {
    const ids = data.map((r) => r.id);
    const { count } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
    console.log("  " + table + ": cleared " + count + " orphan rows");
  } else console.log("  " + table + ": (none)");
}
await preSweep("item_aliases",        "alias_text",     "PROBE_INV2_BATCH3_%");
await preSweep("review_queue",        "line_item_text", "PROBE_INV2_BATCH3_%");
await preSweep("ai_line_items",       "description",    "PROBE_INV2_BATCH3_%");
await preSweep("invoice_submissions", "vendor_name",    "PROBE_INV2_BATCH3_%");

// ─────────────────────────────────────────────────────────────────────
header("SETUP: real fixture row picks");
const { data: anyItem } = await supa.from("inventory_items")
  .select("id, account, vendor_id, name").eq("status", "active").eq("account", "STL - MO").limit(1).single();
const PROBE_ITEM_ID = anyItem.id;
const PROBE_ACCOUNT = anyItem.account;
const PROBE_VENDOR_ID = anyItem.vendor_id;
const { data: vendorRow } = await supa.from("vendors").select("name").eq("id", PROBE_VENDOR_ID).single();
const PROBE_VENDOR_NAME = vendorRow.name;
console.log("  PROBE_ITEM_ID: " + PROBE_ITEM_ID);
console.log("  PROBE_ACCOUNT: " + PROBE_ACCOUNT);

const { data: anyInv } = await supa.from("invoice_submissions")
  .select("id, vendor_id, invoice_date").eq("vendor_id", PROBE_VENDOR_ID)
  .not("invoice_date", "is", null).limit(1).single();
const BASE_INV_ID = anyInv.id;
const BASE_INV_DATE = anyInv.invoice_date;
console.log("  BASE_INV_ID:   " + BASE_INV_ID + " (invoice_date=" + BASE_INV_DATE + ")");

// ─────────────────────────────────────────────────────────────────────
header("SETUP: 2 sentinel queue rows + 1 ai_line_items row (Reconcile)");
async function insQ(label, opts) {
  const desc = SENTINEL + "_" + label;
  const { data, error } = await supa.from("review_queue").insert({
    account: PROBE_ACCOUNT, line_item_text: desc, vendor: PROBE_VENDOR_NAME,
    invoice_id: opts.invoiceId, invoice_date: opts.queueDate || BASE_INV_DATE,
    suggested_match_id: PROBE_ITEM_ID, suggested_match_name: "PROBE", confidence: 80,
    status: "pending", reason: opts.reason || "low_match_confidence",
  }).select("id").single();
  if (error) throw new Error("queue " + label + ": " + error.message);
  cleanup.review_queue.push(data.id);
  return { id: data.id, desc };
}
async function insLI(label, opts) {
  const desc = SENTINEL + "_" + label;
  const { data, error } = await supa.from("ai_line_items").insert({
    invoice_uuid: opts.invoiceId, account_key: PROBE_ACCOUNT,
    vendor_name: PROBE_VENDOR_NAME, vendor_id: PROBE_VENDOR_ID,
    invoice_date: opts.lineDate || BASE_INV_DATE,
    line_num: opts.lineNum, description: desc,
    quantity: 99, unit: "case", unit_price: opts.unitPrice, extended_price: opts.unitPrice * 99,
    category: "Food",
  }).select("id").single();
  if (error) throw new Error("line " + label + ": " + error.message);
  cleanup.ai_line_items.push(data.id);
  return { id: data.id, desc };
}

const qM = await insQ("M",  { invoiceId: BASE_INV_ID });
const qR = await insQ("R",  { invoiceId: BASE_INV_ID, reason: "arithmetic_fail" });
const liM = await insLI("M", { invoiceId: BASE_INV_ID, lineNum: 901, unitPrice: 0.51 });
const liR = await insLI("R", { invoiceId: BASE_INV_ID, lineNum: 902, unitPrice: 0.52 });
pass("queue: M=" + qM.id + "  R=" + qR.id);
pass("line:  M=" + liM.id + "  R=" + liR.id);

// ─────────────────────────────────────────────────────────────────────
// REVERSER 1 - undoMatchPostgres round-trip
// ─────────────────────────────────────────────────────────────────────
header("REVERSER 1 - Match round-trip: forward -> undo");

const NOW_M = new Date().toISOString();
const PRICE_M = 0.51;

// Forward (writeMatchResolutionPostgres, batch-1-verified)
try {
  await writeMatchResolutionPostgres({
    supa, queueId: qM.id, itemId: PROBE_ITEM_ID, lineItemText: qM.desc,
    account: PROBE_ACCOUNT, vendor: PROBE_VENDOR_NAME, vendorId: PROBE_VENDOR_ID,
    invoiceUuid: BASE_INV_ID, invoiceDate: BASE_INV_DATE,
    unitPrice: PRICE_M, email: PROBE_EMAIL, now: NOW_M,
  });
} catch (e) { fail("Match FORWARD threw: " + e.message); process.exit(1); }

// Capture post-forward state for assertions and token construction
const { data: aliasBefore } = await supa.from("item_aliases").select("*")
  .eq("item_id", PROBE_ITEM_ID).eq("alias_text", qM.desc).single();
const { data: phBefore } = await supa.from("price_history").select("*")
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", PRICE_M).single();
cleanup.item_aliases.push(aliasBefore.id);
cleanup.price_history.push(phBefore.id);
console.log("  forward done. alias.source=" + aliasBefore.source + "  ph.source=" + phBefore.source);
console.log("  ph.recorded_at=" + phBefore.recorded_at);

// Construct undo token mimicking what the Sheets path returns
const matchToken = {
  queueId: qM.id,
  itemId: PROBE_ITEM_ID,
  aliasFingerprint: { aliasText: qM.desc },
  priceHistoryFingerprint: {
    itemId: PROBE_ITEM_ID,
    invoiceUuid: BASE_INV_ID,
    price: PRICE_M,
    recordedAt: NOW_M,
  },
};

// Undo
try { await undoMatchPostgres(matchToken); }
catch (e) { fail("undoMatchPostgres threw: " + e.message); }

// Verify post-undo state
const { data: aliasAfter } = await supa.from("item_aliases").select("*").eq("id", aliasBefore.id).single();
const { data: phAfter } = await supa.from("price_history").select("*").eq("id", phBefore.id).single();
const qAfter = await supa.from("review_queue").select("*").eq("id", qM.id).single().then((r) => r.data);

if (aliasAfter.source === "manual_resolve_reverted") pass("alias.source flipped to manual_resolve_reverted");
else fail("alias.source = " + aliasAfter.source + " (expected manual_resolve_reverted)");
if (phAfter.source === "manual_resolve_reverted") pass("price_history.source flipped to manual_resolve_reverted");
else fail("price_history.source = " + phAfter.source + " (expected manual_resolve_reverted)");
if (qAfter.status === "pending") pass("queue.status reverted to pending");
else fail("queue.status = " + qAfter.status);
if (qAfter.reviewed_by === null) pass("queue.reviewed_by cleared");
else fail("queue.reviewed_by = " + qAfter.reviewed_by);
if (qAfter.result_item_id === null) pass("queue.result_item_id cleared");
else fail("queue.result_item_id = " + qAfter.result_item_id);

// ─────────────────────────────────────────────────────────────────────
// REVERSER 2 - undoReconcilePostgres round-trip
// ─────────────────────────────────────────────────────────────────────
header("REVERSER 2 - Reconcile round-trip: forward -> undo");
console.log("  pre-forward: ai_line_items.quantity=99 (initial sentinel value)");

// Forward (resolveReviewQueueLinePostgres, batch-1-verified)
let reconcileResult;
try {
  reconcileResult = await resolveReviewQueueLinePostgres({
    queueId: qR.id, correctedQty: 42, correctedUnit: "case", email: PROBE_EMAIL,
  });
} catch (e) { fail("Reconcile FORWARD threw: " + e.message); process.exit(1); }
const NOW_R = reconcileResult.resolvedAt;
console.log("  forward done. NOW_R (recorded_at) = " + NOW_R);

// Capture post-forward price_history row
const { data: phRBefore } = await supa.from("price_history").select("*")
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", 0.52).single();
cleanup.price_history.push(phRBefore.id);
console.log("  ph.id=" + phRBefore.id + "  ph.source=" + phRBefore.source + "  ph.recorded_at=" + phRBefore.recorded_at);

const { data: liRAfterForward } = await supa.from("ai_line_items").select("*").eq("id", liR.id).single();
if (Number(liRAfterForward.quantity) === 42) pass("forward: ai_line_items.quantity 99 -> 42");
else fail("forward: ai_line_items.quantity = " + liRAfterForward.quantity);

// Construct undo token
const reconcileToken = {
  queueId: qR.id,
  invoiceUuid: BASE_INV_ID,
  lineItemText: qR.desc,
  originalQty: 99,
  originalUnit: "case",
  correctedQty: 42,
  correctedUnit: "case",
  priceHistoryFingerprint: {
    itemId: PROBE_ITEM_ID,
    invoiceUuid: BASE_INV_ID,
    recordedAt: NOW_R,
  },
};

// Undo
try { await undoReconcilePostgres(reconcileToken); }
catch (e) { fail("undoReconcilePostgres threw: " + e.message); }

// Verify post-undo state
const { data: liRAfter } = await supa.from("ai_line_items").select("*").eq("id", liR.id).single();
const { data: phRAfter } = await supa.from("price_history").select("*").eq("id", phRBefore.id).single();
const qRAfter = await supa.from("review_queue").select("*").eq("id", qR.id).single().then((r) => r.data);

if (Number(liRAfter.quantity) === 99) pass("ai_line_items.quantity restored to 99");
else fail("ai_line_items.quantity = " + liRAfter.quantity + " (expected 99)");
if (liRAfter.unit === "case") pass("ai_line_items.unit restored to 'case'");
else fail("ai_line_items.unit = " + liRAfter.unit);

// THE KEY ASSERTION: did the price_history row actually flip source, or did it silently no-op?
if (phRAfter.source === "manual_resolve_reverted") pass("price_history.source FLIPPED to manual_resolve_reverted (Fix A confirmed: no longer silently no-ops)");
else if (phRAfter.source === "invoice_ocr") fail("price_history.source = 'invoice_ocr' - SILENT NO-OP (Fix A regression?)");
else fail("price_history.source = " + phRAfter.source + " (expected manual_resolve_reverted)");

if (qRAfter.status === "pending") pass("queue.status reverted to pending");
else fail("queue.status = " + qRAfter.status);
if (qRAfter.reviewed_by === null) pass("queue.reviewed_by cleared");
else fail("queue.reviewed_by = " + qRAfter.reviewed_by);

// ─────────────────────────────────────────────────────────────────────
header("CLEANUP: delete by captured IDs (reverse FK order)");
async function delIds(table, ids) {
  if (ids.length === 0) { console.log("  " + table + ": (none)"); return; }
  const { count, error } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
  if (error) console.log("  " + table + " DELETE error: " + error.message);
  else console.log("  " + table + ": deleted " + count + " / " + ids.length);
}
await delIds("price_history",       cleanup.price_history);
await delIds("item_aliases",        cleanup.item_aliases);
await delIds("review_queue",        cleanup.review_queue);
await delIds("ai_line_items",       cleanup.ai_line_items);
await delIds("invoice_submissions", cleanup.invoice_submissions);

header("CLEANUP SWEEP");
async function sweep(table, col, pat) {
  const { count } = await supa.from(table).select("*", { count: "exact", head: true }).like(col, pat);
  const v = count === 0 ? "✓ clean" : "✗ STILL " + count + " rows";
  console.log("  " + table.padEnd(22) + col.padEnd(18) + ": " + v);
  if (count > 0) failures.push("sweep " + table + "/" + col);
}
await sweep("review_queue",        "line_item_text", SENTINEL + "%");
await sweep("ai_line_items",       "description",    SENTINEL + "%");
await sweep("item_aliases",        "alias_text",     SENTINEL + "%");

header("SUMMARY");
if (failures.length === 0) console.log("BOTH REVERSERS ROUND-TRIP PASSED. Cleanup clean.");
else { console.log("FAILED (" + failures.length + "):"); for (const f of failures) console.log("  - " + f); }
process.exit(failures.length === 0 ? 0 : 1);
