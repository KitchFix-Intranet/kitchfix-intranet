// P3 batch 4 - live round-trip verification of the two Sheets-side Undo
// reversers (undoMatchSheets + undoReconcileSheets) against real Google
// Sheets. Both were STATIC-CLEAN in the batch-3 trace; this confirms live.
//
// For each reverser: setup sentinel rows, run forward (which appends
// alias/price_history + updates queue/ai_line_items), capture token, run
// undo, verify state restored, then attempt a DOUBLE-UNDO and confirm
// the drift-guard verifier throws (rather than silently no-op'ing - the
// failure mode we caught on the PG Reconcile path in batch 3).
//
// PRE-REQ: TRANSIENT `export` on the 4 Sheets functions. Reverted after.
// CLEANUP: uses deleteRowSA to actually remove sentinel rows (not just
// blank them), so production Sheets don't accumulate test garbage.

import {
  readSheetSA, appendRowSA, batchUpdateRangesSA, getSheetIdSA, deleteRowSA,
  SHEET_IDS,
} from "@/lib/sheets";
import {
  resolveReviewQueueLineSheets,
  resolveReviewQueueMatchSheets,
  undoReconcileSheets,
  undoMatchSheets,
} from "../src/lib/dataStore/inventory.js";

const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const SENTINEL = `PROBE_INV2_BATCH4_${STAMP}`;
const PROBE_EMAIL = "probe-inv2-batch4@kitchfix.local";
const ACCOUNT = "STL - MO";
// Use a real-ish UUID for invoice_id so it looks like a normal queue row.
// Sheets has no FK enforcement so any UUID works.
const PROBE_INVOICE_UUID = "00000000-0000-0000-0000-batch4probe01";
const PROBE_ITEM_ID = "item_05157f33-f870-0381-c8eb4666"; // real existing inventory item
const PROBE_VENDOR  = "What Chefs Want";

// Track rowA1 per tab for proper reverse-order delete cleanup
const sentinelRowA1 = {
  review_queue: [],
  ai_line_items: [],   // STL - MO tab
  item_aliases: [],
  price_history: [],
};

let failures = [];
function header(t) { console.log(); console.log("══════════════════════════════════════════════════════════════"); console.log(t); console.log("══════════════════════════════════════════════════════════════"); }
function pass(t) { console.log("  ✓ " + t); }
function fail(t) { console.log("  ✗ " + t); failures.push(t); }

// Column indices (must match RQ_IDX + AI_LI_IDX in the dataStore)
const RQ_IDX = {
  queueId: 0, lineItemText: 1, vendor: 2, invoiceId: 3, invoiceDate: 4,
  account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8,
  status: 9, reviewedBy: 10, reviewedAt: 11, resultItemId: 12, reason: 13,
};
const AI_LI_IDX = {
  invoiceUuid: 0, timestamp: 1, account: 2, vendor: 3, invoiceNumber: 4,
  invoiceDate: 5, lineNum: 6, description: 7, quantity: 8, unit: 9,
  unitPrice: 10, extendedPrice: 11, category: 12,
};
const REVIEW_QUEUE_TAB    = "review_queue";
const PRICE_HISTORY_TAB   = "price_history";
const ITEM_ALIASES_TAB    = "item_aliases";

// ─────────────────────────────────────────────────────────────────────
// PRE-SWEEP: hunt for any leftover PROBE_INV2_BATCH4_ rows and delete them
// ─────────────────────────────────────────────────────────────────────
header("PRE-SWEEP: clean leftover PROBE_INV2_BATCH4_ rows");

async function preSweepTab(spreadsheetId, tabName, sentinelCol) {
  const { rows } = await readSheetSA(spreadsheetId, tabName);
  const matching = [];
  for (let i = 0; i < rows.length; i++) {
    const v = String(rows[i][sentinelCol] || "").trim();
    if (v.startsWith("PROBE_INV2_BATCH4_")) matching.push(i + 2); // rowA1
  }
  if (matching.length === 0) { console.log("  " + tabName + ": (none)"); return; }
  const sheetId = await getSheetIdSA(spreadsheetId, tabName);
  // Delete in reverse rowA1 order so indices don't shift
  matching.sort((a, b) => b - a);
  let deleted = 0;
  for (const rowA1 of matching) {
    try { await deleteRowSA(spreadsheetId, sheetId, rowA1 - 1); deleted++; }
    catch (e) { console.log("  " + tabName + " delete rowA1=" + rowA1 + " error: " + e.message); }
  }
  console.log("  " + tabName + ": cleared " + deleted + " orphan rows");
}

await preSweepTab(SHEET_IDS.INVENTORY,     REVIEW_QUEUE_TAB,  RQ_IDX.lineItemText);
await preSweepTab(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT,           AI_LI_IDX.description);
await preSweepTab(SHEET_IDS.INVENTORY,     ITEM_ALIASES_TAB,  1); // alias_text col B
await preSweepTab(SHEET_IDS.INVENTORY,     PRICE_HISTORY_TAB, 5); // source_or_invoice_id col F (we'll match if anything sentinel-ish is there)

// ─────────────────────────────────────────────────────────────────────
// SETUP: append sentinel queue rows + ai_line_items rows
// ─────────────────────────────────────────────────────────────────────
header("SETUP: append sentinel rows for Reconcile + Match");

async function findRowA1ByCellValue(spreadsheetId, tabName, colIdx, expectedValue) {
  const { rows } = await readSheetSA(spreadsheetId, tabName);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][colIdx] || "").trim() === expectedValue) return i + 2;
  }
  return null;
}

async function insertQueueRow(label, opts) {
  const queueId = SENTINEL + "_QID_" + label;
  const desc    = SENTINEL + "_DESC_" + label;
  await appendRowSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB, [
    queueId,                          // A queueId
    desc,                             // B lineItemText
    PROBE_VENDOR,                     // C vendor
    PROBE_INVOICE_UUID,               // D invoiceId
    "2026-03-26",                     // E invoiceDate
    ACCOUNT,                          // F account
    PROBE_ITEM_ID,                    // G suggestedMatchId
    "PROBE",                          // H suggestedMatchName
    80,                               // I confidence
    "pending",                        // J status
    "",                               // K reviewedBy
    "",                               // L reviewedAt
    "",                               // M resultItemId
    opts.reason || "low_match_confidence", // N reason
  ]);
  const rowA1 = await findRowA1ByCellValue(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB, RQ_IDX.queueId, queueId);
  if (!rowA1) throw new Error("queue insert " + label + ": rowA1 not found after append");
  sentinelRowA1.review_queue.push(rowA1);
  return { queueId, desc, rowA1 };
}

async function insertLineRow(label, opts) {
  const desc = SENTINEL + "_DESC_" + label;
  await appendRowSA(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT, [
    PROBE_INVOICE_UUID,               // A invoice_uuid
    new Date().toISOString(),         // B timestamp
    ACCOUNT,                          // C account
    PROBE_VENDOR,                     // D vendor
    "INV-PROBE",                      // E invoice_number
    "2026-03-26",                     // F invoice_date
    opts.lineNum,                     // G line_num
    desc,                             // H description
    99,                               // I quantity
    "case",                           // J unit
    opts.unitPrice,                   // K unit_price
    opts.unitPrice * 99,              // L extended_price
    "Food",                           // M category
  ]);
  const rowA1 = await findRowA1ByCellValue(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT, AI_LI_IDX.description, desc);
  if (!rowA1) throw new Error("line insert " + label + ": rowA1 not found");
  sentinelRowA1.ai_line_items.push(rowA1);
  return { desc, rowA1, unitPrice: opts.unitPrice };
}

const qR = await insertQueueRow("R", { reason: "arithmetic_fail" });
const qM = await insertQueueRow("M", { reason: "low_match_confidence" });
pass("queue rows inserted: R rowA1=" + qR.rowA1 + "  M rowA1=" + qM.rowA1);

// IMPORTANT: ai_line_items.description must EQUAL queue.line_item_text exactly.
const liR = await insertLineRow("R", { lineNum: 401, unitPrice: 0.71 });
const liM = await insertLineRow("M", { lineNum: 402, unitPrice: 0.72 });
// But the forward path matches description against qrow.lineItemText, so they
// must be identical:
if (liR.desc !== qR.desc || liM.desc !== qM.desc) {
  fail("desc mismatch - forward path won't find the line"); process.exit(1);
}
pass("line rows inserted: R rowA1=" + liR.rowA1 + "  M rowA1=" + liM.rowA1);

// ─────────────────────────────────────────────────────────────────────
// ROUND 1 - undoReconcileSheets round-trip + drift-guard
// ─────────────────────────────────────────────────────────────────────
header("ROUND 1 - undoReconcileSheets: forward -> undo -> double-undo");

// Forward
let reconcileResult;
try {
  reconcileResult = await resolveReviewQueueLineSheets({
    queueId: qR.queueId, correctedQty: 42, correctedUnit: "case", email: PROBE_EMAIL,
  });
} catch (e) { fail("Reconcile FORWARD threw: " + e.message); process.exit(1); }
const reconcileToken = reconcileResult.undo;
pass("forward done. token rowA1s: queue=" + reconcileToken.queueRowA1 + " liA1=" + reconcileToken.aiLineItemsRowA1 + " phA1=" + reconcileToken.priceHistoryRowA1);
sentinelRowA1.price_history.push(reconcileToken.priceHistoryRowA1);

// Verify forward state: ai_line_items.quantity = 42, queue accepted, price_history appended
const { rows: liRowsPostFwd } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT);
const liRowPostFwd = liRowsPostFwd[liR.rowA1 - 2];
if (Number(liRowPostFwd[AI_LI_IDX.quantity]) === 42) pass("forward: ai_line_items.quantity 99 -> 42");
else fail("forward: ai_line_items.quantity = " + liRowPostFwd[AI_LI_IDX.quantity]);

const { rows: qRowsPostFwd } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
const qRowPostFwd = qRowsPostFwd[qR.rowA1 - 2];
if (String(qRowPostFwd[RQ_IDX.status]).trim() === "accepted") pass("forward: queue.status accepted");
else fail("forward: queue.status = " + qRowPostFwd[RQ_IDX.status]);

const { rows: phRowsPostFwd } = await readSheetSA(SHEET_IDS.INVENTORY, PRICE_HISTORY_TAB);
const phRowPostFwd = phRowsPostFwd[reconcileToken.priceHistoryRowA1 - 2];
if (String(phRowPostFwd[0]).trim() === PROBE_ITEM_ID) pass("forward: price_history.itemId set");
else fail("forward: price_history.itemId = " + phRowPostFwd[0]);

// Undo
try { await undoReconcileSheets(reconcileToken); }
catch (e) { fail("undoReconcileSheets threw: " + e.message); }

// Verify undo state
const { rows: liRowsPostUndo } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT);
const liRowPostUndo = liRowsPostUndo[liR.rowA1 - 2];
if (Number(liRowPostUndo[AI_LI_IDX.quantity]) === 99) pass("undo: ai_line_items.quantity restored to 99");
else fail("undo: ai_line_items.quantity = " + liRowPostUndo[AI_LI_IDX.quantity]);
if (String(liRowPostUndo[AI_LI_IDX.unit]).trim() === "case") pass("undo: ai_line_items.unit restored to 'case'");
else fail("undo: ai_line_items.unit = " + liRowPostUndo[AI_LI_IDX.unit]);

const { rows: qRowsPostUndo } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
const qRowPostUndo = qRowsPostUndo[qR.rowA1 - 2];
if (String(qRowPostUndo[RQ_IDX.status]).trim() === "pending") pass("undo: queue.status back to pending");
else fail("undo: queue.status = " + qRowPostUndo[RQ_IDX.status]);
if (String(qRowPostUndo[RQ_IDX.reviewedBy]).trim() === "") pass("undo: queue.reviewedBy cleared");
else fail("undo: queue.reviewedBy = " + qRowPostUndo[RQ_IDX.reviewedBy]);
if (String(qRowPostUndo[RQ_IDX.reviewedAt]).trim() === "") pass("undo: queue.reviewedAt cleared");
else fail("undo: queue.reviewedAt = " + qRowPostUndo[RQ_IDX.reviewedAt]);
if (String(qRowPostUndo[RQ_IDX.resultItemId]).trim() === "") pass("undo: queue.resultItemId cleared");
else fail("undo: queue.resultItemId = " + qRowPostUndo[RQ_IDX.resultItemId]);

const { rows: phRowsPostUndo } = await readSheetSA(SHEET_IDS.INVENTORY, PRICE_HISTORY_TAB);
const phRowPostUndo = phRowsPostUndo[reconcileToken.priceHistoryRowA1 - 2];
if (String(phRowPostUndo[0]).trim() === "") pass("undo: price_history.itemId BLANKED (tombstoned)");
else fail("undo: price_history.itemId = " + phRowPostUndo[0]);
if (Number(phRowPostUndo[3]) === 0) pass("undo: price_history.price = 0 (tombstoned)");
else fail("undo: price_history.price = " + phRowPostUndo[3]);
if (String(phRowPostUndo[5]).trim() === "") pass("undo: price_history.source_or_invoice_id BLANKED (tombstoned)");
else fail("undo: price_history.source_or_invoice_id = " + phRowPostUndo[5]);

// Drift-guard: second undo should throw
let doubleUndoErr = null;
try { await undoReconcileSheets(reconcileToken); }
catch (e) { doubleUndoErr = e.message; }
if (doubleUndoErr) pass("drift-guard fired on double-undo: \"" + doubleUndoErr.slice(0, 80) + "\"");
else fail("drift-guard DID NOT fire on double-undo (silently no-op'd - bug)");

// ─────────────────────────────────────────────────────────────────────
// ROUND 2 - undoMatchSheets round-trip + drift-guard
// ─────────────────────────────────────────────────────────────────────
header("ROUND 2 - undoMatchSheets: forward -> undo -> double-undo");

let matchResult;
try {
  matchResult = await resolveReviewQueueMatchSheets({
    queueId: qM.queueId, itemId: PROBE_ITEM_ID, source: "accept_suggested", email: PROBE_EMAIL,
  });
} catch (e) { fail("Match FORWARD threw: " + e.message); process.exit(1); }
const matchToken = matchResult.undo;
pass("forward done. token rowA1s: queue=" + matchToken.queueRowA1 + " aliasA1=" + matchToken.aliasRowA1 + " phA1=" + matchToken.priceHistoryRowA1);
sentinelRowA1.item_aliases.push(matchToken.aliasRowA1);
sentinelRowA1.price_history.push(matchToken.priceHistoryRowA1);

// Verify forward state: alias appended with itemId, price_history appended, queue accepted
const { rows: aliasRowsPostFwd } = await readSheetSA(SHEET_IDS.INVENTORY, ITEM_ALIASES_TAB);
const aliasRowPostFwd = aliasRowsPostFwd[matchToken.aliasRowA1 - 2];
if (String(aliasRowPostFwd[2]).trim() === PROBE_ITEM_ID) pass("forward: alias.itemId set");
else fail("forward: alias.itemId = " + aliasRowPostFwd[2]);
if (String(aliasRowPostFwd[3]).trim() === PROBE_VENDOR) pass("forward: alias.vendor set");
else fail("forward: alias.vendor = " + aliasRowPostFwd[3]);

// Undo
try { await undoMatchSheets(matchToken); }
catch (e) { fail("undoMatchSheets threw: " + e.message); }

// Verify undo state
const { rows: aliasRowsPostUndo } = await readSheetSA(SHEET_IDS.INVENTORY, ITEM_ALIASES_TAB);
const aliasRowPostUndo = aliasRowsPostUndo[matchToken.aliasRowA1 - 2];
if (String(aliasRowPostUndo[2]).trim() === "") pass("undo: alias.itemId BLANKED (tombstoned)");
else fail("undo: alias.itemId = " + aliasRowPostUndo[2]);
if (String(aliasRowPostUndo[3]).trim() === "") pass("undo: alias.vendor BLANKED (tombstoned)");
else fail("undo: alias.vendor = " + aliasRowPostUndo[3]);

const { rows: phRowsPostMatchUndo } = await readSheetSA(SHEET_IDS.INVENTORY, PRICE_HISTORY_TAB);
const phRowPostMatchUndo = phRowsPostMatchUndo[matchToken.priceHistoryRowA1 - 2];
if (String(phRowPostMatchUndo[0]).trim() === "") pass("undo: price_history.itemId BLANKED");
else fail("undo: price_history.itemId = " + phRowPostMatchUndo[0]);
if (Number(phRowPostMatchUndo[3]) === 0) pass("undo: price_history.price = 0 (tombstoned)");
else fail("undo: price_history.price = " + phRowPostMatchUndo[3]);
if (String(phRowPostMatchUndo[5]).trim() === "") pass("undo: price_history.source_or_invoice_id BLANKED");
else fail("undo: price_history.source_or_invoice_id = " + phRowPostMatchUndo[5]);

const { rows: qMRowsPostUndo } = await readSheetSA(SHEET_IDS.INVENTORY, REVIEW_QUEUE_TAB);
const qMRowPostUndo = qMRowsPostUndo[qM.rowA1 - 2];
if (String(qMRowPostUndo[RQ_IDX.status]).trim() === "pending") pass("undo: queue.status back to pending");
else fail("undo: queue.status = " + qMRowPostUndo[RQ_IDX.status]);
if (String(qMRowPostUndo[RQ_IDX.resultItemId]).trim() === "") pass("undo: queue.resultItemId cleared");
else fail("undo: queue.resultItemId = " + qMRowPostUndo[RQ_IDX.resultItemId]);

// Drift-guard: second undo should throw
let doubleUndoErrM = null;
try { await undoMatchSheets(matchToken); }
catch (e) { doubleUndoErrM = e.message; }
if (doubleUndoErrM) pass("drift-guard fired on double-undo: \"" + doubleUndoErrM.slice(0, 80) + "\"");
else fail("drift-guard DID NOT fire on double-undo");

// ─────────────────────────────────────────────────────────────────────
// CLEANUP: delete all sentinel rows (reverse rowA1 per tab so indices don't shift)
// ─────────────────────────────────────────────────────────────────────
header("CLEANUP: delete sentinel rows via deleteRowSA");

async function deleteRowsInTab(spreadsheetId, tabName, rowA1s) {
  if (rowA1s.length === 0) { console.log("  " + tabName + ": (none)"); return; }
  const sheetId = await getSheetIdSA(spreadsheetId, tabName);
  // Sort descending so highest rowA1 deletes first and indices below it don't shift
  const sorted = [...new Set(rowA1s)].sort((a, b) => b - a);
  for (const rowA1 of sorted) {
    try { await deleteRowSA(spreadsheetId, sheetId, rowA1 - 1); }
    catch (e) { console.log("  " + tabName + " delete rowA1=" + rowA1 + " error: " + e.message); }
  }
  console.log("  " + tabName + ": deleted " + sorted.length + " rows");
}

await deleteRowsInTab(SHEET_IDS.INVENTORY,     PRICE_HISTORY_TAB, sentinelRowA1.price_history);
await deleteRowsInTab(SHEET_IDS.INVENTORY,     ITEM_ALIASES_TAB,  sentinelRowA1.item_aliases);
await deleteRowsInTab(SHEET_IDS.INVENTORY,     REVIEW_QUEUE_TAB,  sentinelRowA1.review_queue);
await deleteRowsInTab(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT,           sentinelRowA1.ai_line_items);

header("CLEANUP SWEEP: zero PROBE_INV2_BATCH4_ rows remain");
async function sweepTab(spreadsheetId, tabName, sentinelCol) {
  const { rows } = await readSheetSA(spreadsheetId, tabName);
  let count = 0;
  for (const r of rows) {
    if (String(r[sentinelCol] || "").startsWith("PROBE_INV2_BATCH4_")) count++;
  }
  const v = count === 0 ? "✓ clean" : "✗ STILL " + count + " rows";
  console.log("  " + tabName.padEnd(20) + " col[" + sentinelCol + "]: " + v);
  if (count > 0) failures.push("sweep " + tabName + " col " + sentinelCol);
}
await sweepTab(SHEET_IDS.INVENTORY,     REVIEW_QUEUE_TAB,  RQ_IDX.lineItemText);
await sweepTab(SHEET_IDS.AI_LINE_ITEMS, ACCOUNT,           AI_LI_IDX.description);
await sweepTab(SHEET_IDS.INVENTORY,     ITEM_ALIASES_TAB,  1); // alias_text

header("SUMMARY");
if (failures.length === 0) console.log("BOTH REVERSERS ROUND-TRIP PASSED + drift-guards fired + Sheets cleanup clean.");
else { console.log("FAILED (" + failures.length + "):"); for (const f of failures) console.log("  - " + f); }
process.exit(failures.length === 0 ? 0 : 1);
