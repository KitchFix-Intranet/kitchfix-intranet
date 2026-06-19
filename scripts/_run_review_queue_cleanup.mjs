// ════════════════════════════════════════════════════════════════════════════
// TOOL: review_queue duplicate cleanup (Sheets + PG).
//
// DEFAULT BEHAVIOR: PREVIEW ONLY. Prints the exact delete plan + samples +
// final API payloads. NO writes, NO deletes.
//
// EXECUTE: pass `--execute` to actually perform the deletes. The script
// requires the preview to render first so the operator sees what they
// are approving.
//
// Canonical rule per (invoiceUuid, lineItemText) group:
//   1. Sort by statusRank DESC:  accepted (3) > rejected (2) > pending (1)
//   2. Tie-break: newest created_at first  (PG)  OR  highest row index first (Sheets)
//      (PG has a real created_at column; Sheets does not - row index is the
//      reliable proxy for "appended latest", which means "freshest Claude
//      read with the most up-to-date suggestedMatchName for the dashboard")
//   3. Keep position [0]; delete the rest.
//
// Cross-store integrity: the same dedup logic applies to both stores. The
// row sets do not need to be the same - PG was loaded by INV-3 backfill;
// Sheets has been growing via the cron's chronic re-fires.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS, getServiceAccountSheetsClient } from "../src/lib/sheets.js";
import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");
const TAB = "review_queue";

// review_queue Sheets columns - matches row-shapes.js QUEUE_COLS
const SHEETS_COL = {
  queueId: 0, lineItemText: 1, vendor: 2, invoiceUuid: 3, invoiceDate: 4,
  account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8,
  status: 9, reason: 13,
};

function statusRank(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "accepted") return 3;
  if (v === "rejected") return 2;
  return 1;  // pending or empty
}

console.log("=".repeat(100));
console.log(`REVIEW_QUEUE CLEANUP  ${EXECUTE ? "[EXECUTE MODE - WILL DELETE]" : "[PREVIEW ONLY]"}`);
console.log("=".repeat(100));

// ── 1. Load Sheets ──
const { rows: sheetsRows } = await safeRead(SHEET_IDS.INVENTORY, TAB);
console.log(`\nSheets review_queue: ${sheetsRows.length} rows`);

// Group by (uuid, lineText). Each row gets its original index attached.
const sheetsGroups = new Map();
for (let i = 0; i < sheetsRows.length; i++) {
  const r = sheetsRows[i];
  const k = `${(r[SHEETS_COL.invoiceUuid]||"").trim()}::${(r[SHEETS_COL.lineItemText]||"").trim()}`;
  if (!sheetsGroups.has(k)) sheetsGroups.set(k, []);
  sheetsGroups.get(k).push({ idx: i, row: r });
}

const sheetsDeleteIndices = [];
const sheetsKeep = [];
const sheetsSamples = [];
for (const [k, rows] of sheetsGroups) {
  if (rows.length === 1) {
    sheetsKeep.push(rows[0]);
    continue;
  }
  // Sort: statusRank DESC, then row index DESC (newest appended first)
  const sorted = [...rows].sort((a, b) => {
    const sr = statusRank(b.row[SHEETS_COL.status]) - statusRank(a.row[SHEETS_COL.status]);
    if (sr !== 0) return sr;
    return b.idx - a.idx;  // higher row index = appended later = newer
  });
  const canonical = sorted[0];
  const toDelete = sorted.slice(1);
  sheetsKeep.push(canonical);
  for (const d of toDelete) sheetsDeleteIndices.push(d.idx);
  if (sheetsSamples.length < 3) sheetsSamples.push({ canonical, toDelete, key: k });
}

console.log(`\nSheets-side plan:`);
console.log(`   distinct groups:           ${sheetsGroups.size}`);
console.log(`   groups with > 1 row:       ${[...sheetsGroups.values()].filter((g) => g.length > 1).length}`);
console.log(`   keep (canonical):          ${sheetsKeep.length}`);
console.log(`   delete (excess):           ${sheetsDeleteIndices.length}`);
console.log(`   final row count expected:  ${sheetsKeep.length}`);

console.log(`\nSheets sample groups (first 3):`);
for (const s of sheetsSamples) {
  const c = s.canonical;
  console.log(`\n   GROUP key=${s.key.slice(0,30)}...   (${s.toDelete.length + 1} rows)`);
  console.log(`      KEEP   row#${c.idx + 2}  queueId=${(c.row[SHEETS_COL.queueId]||"").slice(0,18)}  status=${c.row[SHEETS_COL.status]||"(empty)"}  matchName="${(c.row[SHEETS_COL.suggestedMatchName]||"").slice(0,30)}"  reason=${c.row[SHEETS_COL.reason]||""}`);
  for (const d of s.toDelete.slice(0, 3)) {
    console.log(`      DELETE row#${d.idx + 2}      queueId=${(d.row[SHEETS_COL.queueId]||"").slice(0,18)}  status=${d.row[SHEETS_COL.status]||"(empty)"}  matchName="${(d.row[SHEETS_COL.suggestedMatchName]||"").slice(0,30)}"`);
  }
  if (s.toDelete.length > 3) console.log(`      DELETE (+${s.toDelete.length - 3} more)`);
}

// ── 2. Load PG ──
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pgRowsAll = [];
let from = 0;
while (true) {
  const { data, error } = await supa.from("review_queue").select("id, invoice_id, line_item_text, status, reason, suggested_match_name, created_at").range(from, from + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  pgRowsAll.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`\nPG review_queue: ${pgRowsAll.length} rows`);

const pgGroups = new Map();
for (const r of pgRowsAll) {
  const k = `${r.invoice_id || ""}::${r.line_item_text || ""}`;
  if (!pgGroups.has(k)) pgGroups.set(k, []);
  pgGroups.get(k).push(r);
}

const pgDeleteIds = [];
const pgKeep = [];
const pgSamples = [];
for (const [k, rows] of pgGroups) {
  if (rows.length === 1) { pgKeep.push(rows[0]); continue; }
  const sorted = [...rows].sort((a, b) => {
    const sr = statusRank(b.status) - statusRank(a.status);
    if (sr !== 0) return sr;
    return (b.created_at || "").localeCompare(a.created_at || "");  // newer first
  });
  pgKeep.push(sorted[0]);
  for (const d of sorted.slice(1)) pgDeleteIds.push(d.id);
  if (pgSamples.length < 3) pgSamples.push({ canonical: sorted[0], toDelete: sorted.slice(1), key: k });
}

console.log(`\nPG-side plan:`);
console.log(`   distinct groups:           ${pgGroups.size}`);
console.log(`   groups with > 1 row:       ${[...pgGroups.values()].filter((g) => g.length > 1).length}`);
console.log(`   keep (canonical):          ${pgKeep.length}`);
console.log(`   delete (excess):           ${pgDeleteIds.length}`);
console.log(`   final row count expected:  ${pgKeep.length}`);

console.log(`\nPG sample groups (first 3):`);
for (const s of pgSamples) {
  console.log(`\n   GROUP key=${s.key.slice(0,30)}...   (${s.toDelete.length + 1} rows)`);
  console.log(`      KEEP   id=${s.canonical.id.slice(0,8)}  created=${(s.canonical.created_at||"").slice(0,19)}  status=${s.canonical.status}  matchName="${(s.canonical.suggested_match_name||"").slice(0,30)}"`);
  for (const d of s.toDelete.slice(0, 3)) {
    console.log(`      DELETE id=${d.id.slice(0,8)}  created=${(d.created_at||"").slice(0,19)}  status=${d.status}  matchName="${(d.suggested_match_name||"").slice(0,30)}"`);
  }
}

// ── 3. Final API payloads (shown for review) ──
console.log("\n" + "=".repeat(100));
console.log("API PAYLOAD SUMMARY");
console.log("=".repeat(100));

// Sheets payload: batchUpdate with deleteDimension requests, indices sorted DESC
const sheetsDeleteIndicesDesc = [...sheetsDeleteIndices].sort((a, b) => b - a);
console.log(`\nSheets API: spreadsheets.batchUpdate(${SHEET_IDS.INVENTORY.slice(0,12)}..., requests: ${sheetsDeleteIndicesDesc.length} x deleteDimension)`);
console.log(`   batched in chunks of 50 to stay under request size limits`);
console.log(`   row indices to delete (first 5, last 5 of ${sheetsDeleteIndicesDesc.length}):`);
console.log(`     first: ${sheetsDeleteIndicesDesc.slice(0, 5).map((i) => `sheet-row#${i+2}`).join(", ")}`);
console.log(`     last:  ${sheetsDeleteIndicesDesc.slice(-5).map((i) => `sheet-row#${i+2}`).join(", ")}`);
console.log(`   each request shape: { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: i+1 } } }`);

// PG payload: single DELETE WHERE id IN (...)
console.log(`\nPG SQL:`);
console.log(`   DELETE FROM review_queue WHERE id IN (${pgDeleteIds.length} UUIDs);`);
console.log(`   sample id list (first 5): ${pgDeleteIds.slice(0, 5).map((id) => `'${id}'`).join(", ")}`);
if (pgDeleteIds.length > 5) console.log(`   (+${pgDeleteIds.length - 5} more)`);

// ── 4. Execute or stop ──
console.log("\n" + "=".repeat(100));
if (!EXECUTE) {
  console.log("PREVIEW MODE. No deletes performed.");
  console.log("Re-run with --execute to perform the deletes.");
  console.log("=".repeat(100));
  process.exit(0);
}

console.log("EXECUTING DELETES...");
console.log("=".repeat(100));

// 4a. Sheets delete: need numeric sheetId. Fetch metadata.
const sheetsClient = getServiceAccountSheetsClient();
const meta = await sheetsClient.spreadsheets.get({
  spreadsheetId: SHEET_IDS.INVENTORY,
  fields: "sheets(properties(sheetId,title))",
});
const sheetMeta = (meta.data.sheets || []).find((s) => s.properties.title === TAB);
if (!sheetMeta) throw new Error(`Could not find sheetId for tab "${TAB}"`);
const sheetId = sheetMeta.properties.sheetId;
console.log(`Resolved sheetId for "${TAB}": ${sheetId}`);

// Send deleteDimension requests in chunks of 50, indices already sorted DESC.
const CHUNK = 50;
for (let i = 0; i < sheetsDeleteIndicesDesc.length; i += CHUNK) {
  const chunkIndices = sheetsDeleteIndicesDesc.slice(i, i + CHUNK);
  const requests = chunkIndices.map((idx) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: idx + 1,   // +1 because Sheets has a header row at index 0
        endIndex:   idx + 2,
      },
    },
  }));
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_IDS.INVENTORY,
    requestBody: { requests },
  });
  console.log(`Sheets: deleted ${i + chunkIndices.length} / ${sheetsDeleteIndicesDesc.length}`);
}

// 4b. PG delete: single statement
{
  const { error } = await supa.from("review_queue").delete().in("id", pgDeleteIds);
  if (error) throw new Error(`PG delete: ${error.message}`);
  console.log(`PG: deleted ${pgDeleteIds.length} rows`);
}

console.log("\nDONE. Re-run scripts/_probe_pipeline_audit.mjs to verify 379 Sheets / 167 PG / 0 dup groups.");
