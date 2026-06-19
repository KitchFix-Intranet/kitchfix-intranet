// P3 batch 1 - live verification of the two RQ PG mirrors against real DB,
// with sentinel rows + precise-ID cleanup. Read-then-write-then-cleanup.
//
// Exercises BOTH mirrors through all THREE ladder branches:
//   B1: happy path (caller-provided invoice_date)
//   B2: fallback (invoice_submissions.invoice_date lookup)
//   B3: skip-warn (no resolvable date)
//
// PRE-REQ: src/lib/dataStore/inventory.js has TRANSIENT `export` on
// writeMatchResolutionPostgres + resolveReviewQueueLinePostgres for this
// probe to direct-call them. Reverted via `git restore` after the run.
//
// Cleanup: all 17 anticipated sentinel rows tracked by captured ID and
// deleted in reverse-FK order. Post-cleanup sweep confirms zero
// PROBE_INV2_% rows remain across all 5 touched tables.

import { createClient } from "@supabase/supabase-js";
import {
  writeMatchResolutionPostgres,
  resolveReviewQueueLinePostgres,
} from "../src/lib/dataStore/inventory.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SENTINEL = `PROBE_INV2_BATCH1_${STAMP}`;
const PROBE_EMAIL = "probe-inv2-batch1@kitchfix.local";

// Track every created row ID for the final cleanup pass.
const cleanup = {
  ai_line_items: [],
  review_queue:  [],
  item_aliases:  [],
  price_history: [],
  invoice_submissions: [],
};

let failedBranches = [];

function header(t) {
  console.log();
  console.log("══════════════════════════════════════════════════════════════");
  console.log(t);
  console.log("══════════════════════════════════════════════════════════════");
}
function pass(t) { console.log("  ✓ " + t); }
function fail(t) { console.log("  ✗ " + t); failedBranches.push(t); }

// ─────────────────────────────────────────────────────────────────────
// PRE-SWEEP: clear any leftover PROBE_INV2_BATCH1_ rows from prior crashed
// runs. Scoped to the SENTINEL prefix - never touches non-probe data.
// ─────────────────────────────────────────────────────────────────────
header("PRE-SWEEP: clean up any leftover PROBE_INV2_BATCH1_ rows from prior runs");

async function preSweepTable(table, col, pattern) {
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
// Reverse-FK order so dependents get deleted before their parents.
await preSweepTable("item_aliases",        "alias_text",     "PROBE_INV2_BATCH1_%");
await preSweepTable("review_queue",        "line_item_text", "PROBE_INV2_BATCH1_%");
await preSweepTable("ai_line_items",       "description",    "PROBE_INV2_BATCH1_%");
await preSweepTable("invoice_submissions", "vendor_name",    "PROBE_INV2_BATCH1_%");

// ─────────────────────────────────────────────────────────────────────
// SETUP: pick real fixture rows + create NULL_INV_ID
// ─────────────────────────────────────────────────────────────────────
header("SETUP: real fixture row picks");

// Pick a real active inventory_items row from STL - MO. Need its vendor_id
// (real, FK valid) and its vendor name (to verify resolveVendorIdPostgres
// finds it back). Also need its account.
const { data: anyItem } = await supa.from("inventory_items")
  .select("id, account, vendor_id, name")
  .eq("status", "active")
  .eq("account", "STL - MO")
  .limit(1).single();
if (!anyItem) { console.log("Could not find a probe inventory_items row. Abort."); process.exit(1); }
const PROBE_ITEM_ID    = anyItem.id;
const PROBE_ACCOUNT    = anyItem.account;
const PROBE_VENDOR_ID  = anyItem.vendor_id;
const { data: vendorRow } = await supa.from("vendors").select("name").eq("id", PROBE_VENDOR_ID).single();
const PROBE_VENDOR_NAME = vendorRow.name;
console.log("  PROBE_ITEM_ID:      " + PROBE_ITEM_ID + " (" + anyItem.name + ")");
console.log("  PROBE_ACCOUNT:      " + PROBE_ACCOUNT);
console.log("  PROBE_VENDOR_ID:    " + PROBE_VENDOR_ID);
console.log("  PROBE_VENDOR_NAME:  " + PROBE_VENDOR_NAME);

// Pick a real invoice_submission with vendor matching the item's vendor AND
// invoice_date populated. Used for B1 + B2 paths (B2 relies on its date
// being available for the fallback).
const { data: anyInv } = await supa.from("invoice_submissions")
  .select("id, vendor_id, invoice_date, account_key")
  .eq("vendor_id", PROBE_VENDOR_ID)
  .not("invoice_date", "is", null)
  .limit(1).single();
if (!anyInv) { console.log("Could not find a probe invoice_submission. Abort."); process.exit(1); }
const BASE_INV_ID   = anyInv.id;
const BASE_INV_DATE = anyInv.invoice_date;
console.log("  BASE_INV_ID:        " + BASE_INV_ID + " (invoice_date=" + BASE_INV_DATE + ")");

// Create a probe invoice_submission with NULL invoice_date. Used for B3
// (skip-warn) where the fallback Step 2 also returns null.
header("SETUP: insert NULL_INV_ID (probe invoice_submission with NULL invoice_date)");
const { data: nullInv, error: nullInvErr } = await supa.from("invoice_submissions").insert({
  submitter_email: PROBE_EMAIL,
  account_key:     PROBE_ACCOUNT,
  vendor_name:     SENTINEL + "_VENDOR",
  vendor_id:       PROBE_VENDOR_ID,
  invoice_number:  SENTINEL + "_INVNUM",
  invoice_date:    null,
  total_amount:    0.01,
  gl_breakdown:    {},
  drive_urls:      ["probe://inv2/null_invoice"],
}).select("id").single();
if (nullInvErr) { console.log("Insert NULL_INV failed: " + nullInvErr.message); process.exit(1); }
const NULL_INV_ID = nullInv.id;
cleanup.invoice_submissions.push(NULL_INV_ID);
pass("NULL_INV_ID: " + NULL_INV_ID);

// ─────────────────────────────────────────────────────────────────────
// SETUP: 3 sentinel queue rows for Mirror A + 3 queue + 3 line for Mirror B
// ─────────────────────────────────────────────────────────────────────
header("SETUP: 6 sentinel review_queue rows + 3 sentinel ai_line_items rows");

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
    reason:               opts.reason || "arithmetic_fail",
  }).select("id").single();
  if (error) throw new Error("queue insert " + label + ": " + error.message);
  cleanup.review_queue.push(data.id);
  return { id: data.id, desc };
}

// ai_line_items has a UNIQUE constraint covering (invoice_uuid, line_num),
// so each sentinel row needs a distinct line_num within its invoice.
// Also: price_history has UNIQUE (item_id, source_or_invoice_id, price), so
// when two probe lines share the same invoice_uuid (B1+B2 both use BASE_INV_ID
// to verify the fallback ladder), they need distinct unit_price to avoid
// triplet collisions when the mirror writes price_history.
let nextLineNum = 991;
async function insertLineRow(label, opts) {
  const desc = SENTINEL + "_" + label;
  const { data, error } = await supa.from("ai_line_items").insert({
    invoice_uuid:  opts.invoiceId,
    account_key:   PROBE_ACCOUNT,
    vendor_name:   PROBE_VENDOR_NAME,
    vendor_id:     PROBE_VENDOR_ID,
    invoice_date:  opts.lineDate,
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

// Mirror A queue rows (function takes queueId, doesn't read invoice_date
// from the row; we pass invoiceDate as a param. The row exists so the
// review_queue UPDATE has something to flip.)
const qA1 = await insertQueueRow("MA_B1", { invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
const qA2 = await insertQueueRow("MA_B2", { invoiceId: BASE_INV_ID, queueDate: null });
const qA3 = await insertQueueRow("MA_B3", { invoiceId: NULL_INV_ID, queueDate: null });
pass("Mirror A queue rows: " + qA1.id + " / " + qA2.id + " / " + qA3.id);

// Mirror B queue rows + matching ai_line_items rows. The PG mirror reads
// the queue row, then looks up ai_line_items by (invoice_uuid, description).
const qB1 = await insertQueueRow("MB_B1", { invoiceId: BASE_INV_ID, queueDate: BASE_INV_DATE });
const qB2 = await insertQueueRow("MB_B2", { invoiceId: BASE_INV_ID, queueDate: null });
const qB3 = await insertQueueRow("MB_B3", { invoiceId: NULL_INV_ID, queueDate: null });
pass("Mirror B queue rows: " + qB1.id + " / " + qB2.id + " / " + qB3.id);

// IMPORTANT: ai_line_items.description must match queue line_item_text exactly.
const lB1 = await insertLineRow("MB_B1", { invoiceId: BASE_INV_ID, lineDate: BASE_INV_DATE, unitPrice: 0.11 });
const lB2 = await insertLineRow("MB_B2", { invoiceId: BASE_INV_ID, lineDate: null,          unitPrice: 0.22 });
const lB3 = await insertLineRow("MB_B3", { invoiceId: NULL_INV_ID, lineDate: null,          unitPrice: 0.33 });
pass("Mirror B line rows: " + lB1.id + " / " + lB2.id + " / " + lB3.id);

// ─────────────────────────────────────────────────────────────────────
// HELPERS: capture inserts post-exercise, verify, mark for cleanup
// ─────────────────────────────────────────────────────────────────────
async function findInsertedAlias(itemId, aliasText) {
  const { data } = await supa.from("item_aliases")
    .select("id, item_id, alias_text, alias_normalized, vendor_id, confidence, learned_by, source, learned_at")
    .eq("item_id", itemId).eq("alias_text", aliasText);
  return data?.[0] || null;
}
async function findInsertedPriceHistory(itemId, sourceOrInvoiceId, price) {
  // For ladder B2/B3 tests on Mirror B, source_or_invoice_id is the same UUID
  // as several existing rows that the cron already created. Filter by
  // recorded_at within the last 60s to find the one we just wrote.
  const since = new Date(Date.now() - 60000).toISOString();
  const { data } = await supa.from("price_history")
    .select("id, item_id, account, vendor_id, price, effective_date, invoice_id, source_or_invoice_id, source, recorded_at, recorded_by")
    .eq("item_id", itemId).eq("source_or_invoice_id", sourceOrInvoiceId).eq("price", price)
    .gte("recorded_at", since);
  return data?.[0] || null;
}
async function getQueueRow(id) {
  const { data } = await supa.from("review_queue").select("*").eq("id", id).single();
  return data;
}
async function getLineRow(id) {
  const { data } = await supa.from("ai_line_items").select("*").eq("id", id).single();
  return data;
}
async function resetQueueRow(id) {
  await supa.from("review_queue").update({
    status: "pending", reviewed_by: null, reviewed_at: null, result_item_id: null,
  }).eq("id", id);
}

// ─────────────────────────────────────────────────────────────────────
// MIRROR A: writeMatchResolutionPostgres × 3 branches
// ─────────────────────────────────────────────────────────────────────
header("MIRROR A - writeMatchResolutionPostgres × 3 branches");

async function exerciseA(label, opts) {
  console.log();
  console.log("── A." + label + " - " + opts.desc + " ──");
  const now = new Date().toISOString();
  try {
    await writeMatchResolutionPostgres({
      supa,
      queueId:      opts.queueId,
      itemId:       PROBE_ITEM_ID,
      lineItemText: opts.aliasText,
      account:      PROBE_ACCOUNT,
      vendor:       PROBE_VENDOR_NAME,
      vendorId:     PROBE_VENDOR_ID,
      invoiceUuid:  opts.invoiceUuid,
      invoiceDate:  opts.invoiceDate,
      unitPrice:    opts.unitPrice,
      email:        PROBE_EMAIL,
      now,
    });
  } catch (e) {
    fail("A." + label + " THREW: " + e.message);
    return;
  }
  // Read-back verification
  const alias = await findInsertedAlias(PROBE_ITEM_ID, opts.aliasText);
  if (!alias) {
    fail("A." + label + " item_aliases insert MISSING (expected always)");
  } else {
    cleanup.item_aliases.push(alias.id);
    if (alias.source === "manual_resolve") pass("alias.source = 'manual_resolve' (P1 enum confirmed)");
    else fail("alias.source = '" + alias.source + "' expected 'manual_resolve'");
    if (alias.vendor_id === PROBE_VENDOR_ID) pass("alias.vendor_id = real id (not name)");
    else fail("alias.vendor_id = '" + alias.vendor_id + "' (expected " + PROBE_VENDOR_ID + ")");
  }
  const ph = await findInsertedPriceHistory(PROBE_ITEM_ID, opts.invoiceUuid || "", opts.unitPrice);
  if (opts.expectPriceHistory) {
    if (!ph) fail("A." + label + " price_history insert MISSING (expected)");
    else {
      cleanup.price_history.push(ph.id);
      if (ph.effective_date === opts.expectedDate) pass("price_history.effective_date = " + ph.effective_date + " (expected " + opts.expectedDate + ")");
      else fail("price_history.effective_date = " + ph.effective_date + " (expected " + opts.expectedDate + ")");
      if (ph.source === "manual_resolve") pass("price_history.source = 'manual_resolve' (P1 enum confirmed)");
      else fail("price_history.source = '" + ph.source + "' expected 'manual_resolve'");
      if (ph.vendor_id === PROBE_VENDOR_ID) pass("price_history.vendor_id = real id");
      else fail("price_history.vendor_id = '" + ph.vendor_id + "'");
    }
  } else {
    if (ph) fail("A." + label + " price_history insert UNEXPECTED (B3 should skip)");
    else pass("price_history insert SKIPPED (correct)");
  }
  const q = await getQueueRow(opts.queueId);
  if (q.status === "accepted") pass("queue row flipped to accepted");
  else fail("queue row status = '" + q.status + "' (expected accepted)");
  if (q.result_item_id === PROBE_ITEM_ID) pass("queue.result_item_id = item id");
  else fail("queue.result_item_id = '" + q.result_item_id + "'");
}

await exerciseA("B1", {
  desc:        "happy path (caller-provided date)",
  queueId:     qA1.id,
  aliasText:   qA1.desc,
  invoiceUuid: BASE_INV_ID,
  invoiceDate: BASE_INV_DATE,
  unitPrice:   1.11,
  expectPriceHistory: true,
  expectedDate: BASE_INV_DATE,
});
await exerciseA("B2", {
  desc:        "fallback (caller date null → invoice_submissions lookup)",
  queueId:     qA2.id,
  aliasText:   qA2.desc,
  invoiceUuid: BASE_INV_ID,
  invoiceDate: null,
  unitPrice:   2.22,
  expectPriceHistory: true,
  expectedDate: BASE_INV_DATE,
});
await exerciseA("B3", {
  desc:        "skip-warn (caller date null + invoice_submissions date null)",
  queueId:     qA3.id,
  aliasText:   qA3.desc,
  invoiceUuid: NULL_INV_ID,
  invoiceDate: null,
  unitPrice:   3.33,
  expectPriceHistory: false,
  expectedDate: null,
});

// ─────────────────────────────────────────────────────────────────────
// MIRROR B: resolveReviewQueueLinePostgres × 3 branches
// ─────────────────────────────────────────────────────────────────────
header("MIRROR B - resolveReviewQueueLinePostgres × 3 branches");

async function exerciseB(label, opts) {
  console.log();
  console.log("── B." + label + " - " + opts.desc + " ──");
  try {
    await resolveReviewQueueLinePostgres({
      queueId:        opts.queueId,
      correctedQty:   42,
      correctedUnit:  "case",
      email:          PROBE_EMAIL,
    });
  } catch (e) {
    fail("B." + label + " THREW: " + e.message);
    return;
  }
  // Verify ai_line_items.quantity updated
  const li = await getLineRow(opts.lineId);
  if (Number(li.quantity) === 42) pass("ai_line_items.quantity = 42 (was 99)");
  else fail("ai_line_items.quantity = " + li.quantity + " (expected 42)");
  // Verify price_history insert behavior. Look up by the per-branch expected
  // price so the (item_id, source_or_invoice_id, price) triplet is unique
  // even when two branches share the same source_or_invoice_id (B1+B2 both
  // use BASE_INV_ID to exercise the fallback ladder).
  const ph = await findInsertedPriceHistory(PROBE_ITEM_ID, opts.invoiceUuid || "", opts.expectedPrice);
  if (opts.expectPriceHistory) {
    if (!ph) fail("B." + label + " price_history insert MISSING (expected)");
    else {
      cleanup.price_history.push(ph.id);
      if (ph.effective_date === opts.expectedDate) pass("price_history.effective_date = " + ph.effective_date + " (expected " + opts.expectedDate + ")");
      else fail("price_history.effective_date = " + ph.effective_date + " (expected " + opts.expectedDate + ")");
      if (ph.source === "invoice_ocr") pass("price_history.source = 'invoice_ocr'");
      else fail("price_history.source = '" + ph.source + "' (expected 'invoice_ocr')");
      if (ph.vendor_id === PROBE_VENDOR_ID) pass("price_history.vendor_id = real id (not name)");
      else fail("price_history.vendor_id = '" + ph.vendor_id + "'");
    }
  } else {
    if (ph) fail("B." + label + " price_history insert UNEXPECTED (B3 should skip)");
    else pass("price_history insert SKIPPED (correct)");
  }
  const q = await getQueueRow(opts.queueId);
  if (q.status === "accepted") pass("queue row flipped to accepted");
  else fail("queue row status = '" + q.status + "' (expected accepted)");
}

await exerciseB("B1", {
  desc:        "happy path (ai_line_items.invoice_date populated)",
  queueId:     qB1.id, lineId: lB1.id,
  invoiceUuid: BASE_INV_ID,
  expectPriceHistory: true,
  expectedDate: BASE_INV_DATE,
  expectedPrice: 0.11,
});
await exerciseB("B2", {
  desc:        "fallback (li + qrow dates null → invoice_submissions lookup)",
  queueId:     qB2.id, lineId: lB2.id,
  invoiceUuid: BASE_INV_ID,
  expectPriceHistory: true,
  expectedDate: BASE_INV_DATE,
  expectedPrice: 0.22,
});
await exerciseB("B3", {
  desc:        "skip-warn (all three sources null)",
  queueId:     qB3.id, lineId: lB3.id,
  invoiceUuid: NULL_INV_ID,
  expectPriceHistory: false,
  expectedDate: null,
  expectedPrice: 0.33,
});

// ─────────────────────────────────────────────────────────────────────
// CLEANUP: delete every tracked ID in reverse-FK order, verify zero remaining
// ─────────────────────────────────────────────────────────────────────
header("CLEANUP: delete by captured IDs (reverse FK order)");

async function delIds(table, ids) {
  if (ids.length === 0) { console.log("  " + table + ": (none)"); return; }
  const { error, count } = await supa.from(table).delete({ count: "exact" }).in("id", ids);
  if (error) console.log("  " + table + " DELETE error: " + error.message);
  else console.log("  " + table + ": deleted " + count + " / " + ids.length + " (expected match)");
}

await delIds("price_history",       cleanup.price_history);
await delIds("item_aliases",        cleanup.item_aliases);
await delIds("review_queue",        cleanup.review_queue);
await delIds("ai_line_items",       cleanup.ai_line_items);
await delIds("invoice_submissions", cleanup.invoice_submissions);

// Sweep: confirm zero PROBE_INV2_% rows remain across every touched table.
header("CLEANUP SWEEP: confirm zero PROBE_INV2_% rows remain");

async function sweep(table, col, like) {
  const { count, error } = await supa.from(table).select("*", { count: "exact", head: true }).like(col, like);
  if (error) console.log("  " + table + " (" + col + ") error: " + error.message);
  else {
    const verdict = count === 0 ? "✓ clean" : "✗ STILL " + count + " ROWS";
    console.log("  " + table.padEnd(22) + col.padEnd(18) + " LIKE '" + like + "': " + verdict);
    if (count > 0) failedBranches.push("sweep " + table + "/" + col + " left " + count + " rows");
  }
}
await sweep("review_queue",        "line_item_text", SENTINEL + "%");
await sweep("ai_line_items",       "description",    SENTINEL + "%");
await sweep("item_aliases",        "alias_text",     SENTINEL + "%");
await sweep("invoice_submissions", "vendor_name",    SENTINEL + "%");
await sweep("invoice_submissions", "invoice_number", SENTINEL + "%");

// price_history doesn't carry the sentinel in any text column; verify via
// the captured-id check (already done by the delete count above).

// ─────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────
header("SUMMARY");
if (failedBranches.length === 0) {
  console.log("ALL 6 BRANCH EXERCISES PASSED. Cleanup left zero PROBE_INV2_% rows.");
} else {
  console.log("FAILED items (" + failedBranches.length + "):");
  for (const f of failedBranches) console.log("  - " + f);
}
process.exit(failedBranches.length === 0 ? 0 : 1);
