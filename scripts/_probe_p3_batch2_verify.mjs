// P3 batch 2 - live verification of 3 RQ PG mirrors against real DB.
// Reuses batch 1's sentinel + precise-ID cleanup pattern with fresh prefix
// PROBE_INV2_BATCH2_ so cleanup cannot collide with batch 1's artifacts.
//
// Mirrors exercised:
//   1. skipReviewQueueLinePostgres + undoSkipPostgres (round-trip: pending -> rejected -> pending)
//   2. resolveReviewQueueMatchPostgres x 2 source variants (accept_suggested + manual_pick)
//   3. resolveReviewQueueCreatePostgres + Q3 invariant assertion (exactly 1 price_history row)
//
// PRE-REQ: src/lib/dataStore/inventory.js has TRANSIENT `export` on the four
// internal functions for this probe. Reverted via plain Edit after the run.

import { createClient } from "@supabase/supabase-js";
import {
  skipReviewQueueLinePostgres,
  undoSkipPostgres,
  resolveReviewQueueMatchPostgres,
  resolveReviewQueueCreatePostgres,
} from "../src/lib/dataStore/inventory.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SENTINEL = `PROBE_INV2_BATCH2_${STAMP}`;
const PROBE_EMAIL = "probe-inv2-batch2@kitchfix.local";

const cleanup = {
  ai_line_items: [],
  review_queue:  [],
  item_aliases:  [],
  price_history: [],
  invoice_submissions: [],
};

let failures = [];
function header(t) { console.log(); console.log("══════════════════════════════════════════════════════════════"); console.log(t); console.log("══════════════════════════════════════════════════════════════"); }
function pass(t) { console.log("  ✓ " + t); }
function fail(t) { console.log("  ✗ " + t); failures.push(t); }

// ─────────────────────────────────────────────────────────────────────
// PRE-SWEEP: clear any leftover PROBE_INV2_BATCH2_ rows from prior crashed runs
// ─────────────────────────────────────────────────────────────────────
header("PRE-SWEEP: clean PROBE_INV2_BATCH2_ leftovers");
async function preSweep(table, col, pattern) {
  const { data } = await supa.from(table).select("id").like(col, pattern);
  if (data && data.length > 0) {
    const ids = data.map((r) => r.id);
    const { count, error } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
    if (error) console.log("  " + table + " pre-sweep error: " + error.message);
    else console.log("  " + table + ": cleared " + count + " orphan rows");
  } else {
    console.log("  " + table + ": (none)");
  }
}
await preSweep("item_aliases",        "alias_text",     "PROBE_INV2_BATCH2_%");
await preSweep("review_queue",        "line_item_text", "PROBE_INV2_BATCH2_%");
await preSweep("ai_line_items",       "description",    "PROBE_INV2_BATCH2_%");
await preSweep("invoice_submissions", "vendor_name",    "PROBE_INV2_BATCH2_%");

// ─────────────────────────────────────────────────────────────────────
// SETUP: pick real fixture data (same item/account/vendor as batch 1)
// ─────────────────────────────────────────────────────────────────────
header("SETUP: real fixture row picks");

const { data: anyItem } = await supa.from("inventory_items")
  .select("id, account, vendor_id, name")
  .eq("status", "active")
  .eq("account", "STL - MO")
  .limit(1).single();
const PROBE_ITEM_ID    = anyItem.id;
const PROBE_ACCOUNT    = anyItem.account;
const PROBE_VENDOR_ID  = anyItem.vendor_id;
const { data: vendorRow } = await supa.from("vendors").select("name").eq("id", PROBE_VENDOR_ID).single();
const PROBE_VENDOR_NAME = vendorRow.name;
console.log("  PROBE_ITEM_ID:      " + PROBE_ITEM_ID + " (" + anyItem.name + ")");
console.log("  PROBE_ACCOUNT:      " + PROBE_ACCOUNT);
console.log("  PROBE_VENDOR_ID:    " + PROBE_VENDOR_ID);
console.log("  PROBE_VENDOR_NAME:  " + PROBE_VENDOR_NAME);

const { data: anyInv } = await supa.from("invoice_submissions")
  .select("id, vendor_id, invoice_date, account_key")
  .eq("vendor_id", PROBE_VENDOR_ID)
  .not("invoice_date", "is", null)
  .limit(1).single();
const BASE_INV_ID   = anyInv.id;
const BASE_INV_DATE = anyInv.invoice_date;
console.log("  BASE_INV_ID:        " + BASE_INV_ID + " (invoice_date=" + BASE_INV_DATE + ")");

// ─────────────────────────────────────────────────────────────────────
// SETUP: sentinel queue rows + ai_line_items rows
// Five queue rows (1 skip + 2 match variants + 1 create + 1 spare for undo)
// Four ai_line_items rows (Match accept, Match pick, Create — Skip doesn't read ai_line_items)
// Distinct unit_prices per line so price_history (item_id, source_or_invoice_id, price) is unique.
// ─────────────────────────────────────────────────────────────────────
header("SETUP: 4 queue rows + 3 ai_line_items rows");

let nextLineNum = 901;
async function insertQueueRow(label, opts) {
  const desc = SENTINEL + "_" + label;
  const { data, error } = await supa.from("review_queue").insert({
    account:              PROBE_ACCOUNT,
    line_item_text:       desc,
    vendor:               PROBE_VENDOR_NAME,
    invoice_id:           opts.invoiceId,
    invoice_date:         opts.queueDate,
    suggested_match_id:   PROBE_ITEM_ID,
    suggested_match_name: "PROBE",
    confidence:           80,
    status:               "pending",
    reason:               opts.reason || "low_match_confidence",
  }).select("id").single();
  if (error) throw new Error("queue insert " + label + ": " + error.message);
  cleanup.review_queue.push(data.id);
  return { id: data.id, desc };
}
async function insertLineRow(label, opts) {
  const desc = SENTINEL + "_" + label;
  const { data, error } = await supa.from("ai_line_items").insert({
    invoice_uuid:  opts.invoiceId,
    account_key:   PROBE_ACCOUNT,
    vendor_name:   PROBE_VENDOR_NAME,
    vendor_id:     PROBE_VENDOR_ID,
    invoice_date:  opts.lineDate || BASE_INV_DATE,
    line_num:      nextLineNum++,
    description:   desc,
    quantity:      99,
    unit:          "case",
    unit_price:    opts.unitPrice,
    extended_price: opts.unitPrice * 99,
    category:      "Food",
  }).select("id").single();
  if (error) throw new Error("line insert " + label + ": " + error.message);
  cleanup.ai_line_items.push(data.id);
  return { id: data.id, desc };
}

// Queue rows
const qSkip  = await insertQueueRow("SKIP",  { invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
const qMA    = await insertQueueRow("M_ACC", { invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
const qMP    = await insertQueueRow("M_PIK", { invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
const qCR    = await insertQueueRow("CREATE",{ invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
pass("Queue rows: SKIP=" + qSkip.id + " M_ACC=" + qMA.id + " M_PIK=" + qMP.id + " CREATE=" + qCR.id);

// AI line items (for Match and Create paths)
const liMA = await insertLineRow("M_ACC",  { invoiceId: BASE_INV_ID, unitPrice: 0.41 });
const liMP = await insertLineRow("M_PIK",  { invoiceId: BASE_INV_ID, unitPrice: 0.42 });
const liCR = await insertLineRow("CREATE", { invoiceId: BASE_INV_ID, unitPrice: 0.43 });
pass("Line rows: M_ACC=" + liMA.id + " M_PIK=" + liMP.id + " CREATE=" + liCR.id);

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────
async function getQueueRow(id) {
  const { data } = await supa.from("review_queue").select("*").eq("id", id).single();
  return data;
}
async function findInsertedAlias(itemId, aliasText) {
  const { data } = await supa.from("item_aliases").select("*").eq("item_id", itemId).eq("alias_text", aliasText);
  return data?.[0] || null;
}
async function findInsertedPriceHistory(itemId, sourceOrInvoiceId, price) {
  const since = new Date(Date.now() - 60000).toISOString();
  const { data } = await supa.from("price_history").select("*")
    .eq("item_id", itemId).eq("source_or_invoice_id", sourceOrInvoiceId).eq("price", price)
    .gte("recorded_at", since);
  return data?.[0] || null;
}

// ─────────────────────────────────────────────────────────────────────
// MIRROR 1: skipReviewQueueLinePostgres + undoSkipPostgres (round trip)
// ─────────────────────────────────────────────────────────────────────
header("MIRROR 1 - skip + undoSkip round-trip");

try {
  await skipReviewQueueLinePostgres({ queueId: qSkip.id, email: PROBE_EMAIL });
} catch (e) { fail("skip THREW: " + e.message); }
let q = await getQueueRow(qSkip.id);
if (q.status === "rejected") pass("after skip: status=rejected");
else fail("after skip: status=" + q.status + " (expected rejected)");
if (q.reviewed_by === PROBE_EMAIL) pass("after skip: reviewed_by set");
else fail("after skip: reviewed_by=" + q.reviewed_by);
if (q.reviewed_at) pass("after skip: reviewed_at set");
else fail("after skip: reviewed_at missing");

try {
  await undoSkipPostgres({ queueId: qSkip.id });
} catch (e) { fail("undoSkip THREW: " + e.message); }
q = await getQueueRow(qSkip.id);
if (q.status === "pending") pass("after undoSkip: status=pending");
else fail("after undoSkip: status=" + q.status + " (expected pending)");
if (q.reviewed_by === null) pass("after undoSkip: reviewed_by cleared");
else fail("after undoSkip: reviewed_by=" + q.reviewed_by);
if (q.reviewed_at === null) pass("after undoSkip: reviewed_at cleared");
else fail("after undoSkip: reviewed_at=" + q.reviewed_at);

// ─────────────────────────────────────────────────────────────────────
// MIRROR 2: resolveReviewQueueMatchPostgres - both source variants
// ─────────────────────────────────────────────────────────────────────
header("MIRROR 2 - Match orchestrator: accept_suggested + manual_pick");

async function exerciseMatch(label, queueId, aliasText, source, expectedPrice) {
  console.log();
  console.log("── M." + label + " - source='" + source + "' ──");
  let result;
  try {
    result = await resolveReviewQueueMatchPostgres({
      queueId, itemId: PROBE_ITEM_ID, source, email: PROBE_EMAIL,
    });
  } catch (e) { fail("M." + label + " THREW: " + e.message); return null; }

  const alias = await findInsertedAlias(PROBE_ITEM_ID, aliasText);
  if (!alias) { fail("M." + label + " alias MISSING"); }
  else {
    cleanup.item_aliases.push(alias.id);
    if (alias.source === "manual_resolve") pass("alias.source = 'manual_resolve'");
    else fail("alias.source = " + alias.source);
    if (alias.vendor_id === PROBE_VENDOR_ID) pass("alias.vendor_id = real id");
    else fail("alias.vendor_id = " + alias.vendor_id);
  }
  const ph = await findInsertedPriceHistory(PROBE_ITEM_ID, BASE_INV_ID, expectedPrice);
  if (!ph) { fail("M." + label + " price_history MISSING"); }
  else {
    cleanup.price_history.push(ph.id);
    if (ph.source === "manual_resolve") pass("price_history.source = 'manual_resolve'");
    else fail("price_history.source = " + ph.source);
    if (ph.effective_date === BASE_INV_DATE) pass("price_history.effective_date = " + ph.effective_date);
    else fail("price_history.effective_date = " + ph.effective_date);
    if (ph.vendor_id === PROBE_VENDOR_ID) pass("price_history.vendor_id = real id");
    else fail("price_history.vendor_id = " + ph.vendor_id);
  }
  const q = await getQueueRow(queueId);
  if (q.status === "accepted") pass("queue.status = accepted");
  else fail("queue.status = " + q.status);
  if (q.result_item_id === PROBE_ITEM_ID) pass("queue.result_item_id set");
  else fail("queue.result_item_id = " + q.result_item_id);
  // The orchestrator's return value should carry the source token
  if (result?.source === source) pass("return.source = '" + source + "'");
  else fail("return.source = " + result?.source);

  return { alias, ph, q, result };
}

const mAcc = await exerciseMatch("ACC", qMA.id, qMA.desc, "accept_suggested", 0.41);
const mPik = await exerciseMatch("PIK", qMP.id, qMP.desc, "manual_pick",      0.42);

// Cross-check: write-side fields should be byte-identical across the two
// source variants (the variant only affects the return value).
console.log();
console.log("── M cross-check: accept_suggested vs manual_pick ──");
if (mAcc?.alias && mPik?.alias) {
  const matches = ["item_id","vendor_id","confidence","source","learned_by"]
    .every((k) => mAcc.alias[k] === mPik.alias[k]);
  if (matches) pass("alias write fields IDENTICAL across source variants");
  else fail("alias write fields DIVERGED between variants");
}
if (mAcc?.ph && mPik?.ph) {
  const matches = ["item_id","account","vendor_id","source","effective_date","source_or_invoice_id","recorded_by"]
    .every((k) => mAcc.ph[k] === mPik.ph[k]);
  if (matches) pass("price_history write fields IDENTICAL across source variants");
  else fail("price_history write fields DIVERGED between variants");
}
if (mAcc?.q && mPik?.q) {
  const matches = ["status","result_item_id"].every((k) => mAcc.q[k] === mPik.q[k]);
  if (matches) pass("queue update fields IDENTICAL across source variants");
  else fail("queue update fields DIVERGED between variants");
}

// ─────────────────────────────────────────────────────────────────────
// MIRROR 3: resolveReviewQueueCreatePostgres + Q3 invariant
// Q3 = "exactly ONE price_history row results from this resolve, the
// invoice-tied one. NOT two."
// ─────────────────────────────────────────────────────────────────────
header("MIRROR 3 - Create orchestrator + Q3 invariant");

// Q3 baseline: count price_history rows for (PROBE_ITEM_ID, BASE_INV_ID, 0.43)
// BEFORE the exercise. Should be 0.
const { count: phBefore } = await supa.from("price_history")
  .select("*", { count: "exact", head: true })
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", 0.43);
console.log("  pre-exercise price_history count for (item, invoice, 0.43): " + phBefore);

let createResult;
try {
  createResult = await resolveReviewQueueCreatePostgres({
    queueId: qCR.id, itemId: PROBE_ITEM_ID, email: PROBE_EMAIL,
  });
} catch (e) { fail("CREATE THREW: " + e.message); }

// Q3 measurement: how many price_history rows did this resolve create?
const { count: phAfter, data: phRows } = await supa.from("price_history")
  .select("id, source, price, recorded_at", { count: "exact" })
  .eq("item_id", PROBE_ITEM_ID).eq("source_or_invoice_id", BASE_INV_ID).eq("price", 0.43);
console.log("  post-exercise price_history count for (item, invoice, 0.43): " + phAfter);
console.log("  rows added by this exercise: " + (phAfter - phBefore));
if ((phAfter - phBefore) === 1) pass("Q3 INVARIANT HOLDS: exactly 1 price_history row created");
else fail("Q3 VIOLATED: " + (phAfter - phBefore) + " price_history rows added (expected 1)");

for (const r of phRows || []) {
  console.log("    row id=" + r.id + " source=" + r.source + " price=" + r.price + " recorded_at=" + r.recorded_at);
  cleanup.price_history.push(r.id);
}

// Also verify the standard alias + queue-flip post-state
const cAlias = await findInsertedAlias(PROBE_ITEM_ID, qCR.desc);
if (cAlias) {
  cleanup.item_aliases.push(cAlias.id);
  if (cAlias.source === "manual_resolve") pass("Create alias.source = 'manual_resolve'");
  else fail("Create alias.source = " + cAlias.source);
} else { fail("Create alias MISSING"); }
const cQ = await getQueueRow(qCR.id);
if (cQ.status === "accepted") pass("Create queue.status = accepted");
else fail("Create queue.status = " + cQ.status);
if (cQ.result_item_id === PROBE_ITEM_ID) pass("Create queue.result_item_id set");
else fail("Create queue.result_item_id = " + cQ.result_item_id);
if (createResult?.source === "create_new") pass("Create return.source = 'create_new'");
else fail("Create return.source = " + createResult?.source);

// ─────────────────────────────────────────────────────────────────────
// CLEANUP
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

header("CLEANUP SWEEP: zero PROBE_INV2_BATCH2_% remain");
async function sweep(table, col, pat) {
  const { count, error } = await supa.from(table).select("*", { count: "exact", head: true }).like(col, pat);
  if (error) console.log("  " + table + " " + col + " error: " + error.message);
  else {
    const v = count === 0 ? "✓ clean" : "✗ STILL " + count + " rows";
    console.log("  " + table.padEnd(22) + col.padEnd(18) + " LIKE '" + pat + "': " + v);
    if (count > 0) failures.push("sweep " + table + "/" + col + " left " + count + " rows");
  }
}
await sweep("review_queue",        "line_item_text", SENTINEL + "%");
await sweep("ai_line_items",       "description",    SENTINEL + "%");
await sweep("item_aliases",        "alias_text",     SENTINEL + "%");
await sweep("invoice_submissions", "vendor_name",    SENTINEL + "%");

header("SUMMARY");
if (failures.length === 0) console.log("ALL 3 MIRRORS PASSED. Cleanup clean.");
else { console.log("FAILED items (" + failures.length + "):"); for (const f of failures) console.log("  - " + f); }
process.exit(failures.length === 0 ? 0 : 1);
