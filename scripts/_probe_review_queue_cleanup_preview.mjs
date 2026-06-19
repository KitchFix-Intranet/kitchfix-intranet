// ════════════════════════════════════════════════════════════════════════════
// PROBE: preview-only output for the review_queue cleanup.
//
// READ-ONLY. Has NO execute mode. NO writes, NO deletes possible.
//
// Shows: exact counts, samples of kept vs removed per store, and the
// payload shape that the SEPARATE _run_review_queue_cleanup.mjs script
// will use when Kevin approves and runs it.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";
import { createClient } from "@supabase/supabase-js";

const TAB = "review_queue";
const SHEETS_COL = {
  queueId: 0, lineItemText: 1, vendor: 2, invoiceUuid: 3, invoiceDate: 4,
  account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8,
  status: 9, reason: 13,
};
function statusRank(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "accepted") return 3;
  if (v === "rejected") return 2;
  return 1;
}

console.log("=".repeat(100));
console.log("REVIEW_QUEUE CLEANUP - PREVIEW ONLY");
console.log("=".repeat(100));

// ── Sheets ──
const { rows: sheetsRows } = await safeRead(SHEET_IDS.INVENTORY, TAB);
console.log(`\nSheets review_queue: ${sheetsRows.length} rows`);

const sheetsGroups = new Map();
for (let i = 0; i < sheetsRows.length; i++) {
  const r = sheetsRows[i];
  const k = `${(r[SHEETS_COL.invoiceUuid]||"").trim()}::${(r[SHEETS_COL.lineItemText]||"").trim()}`;
  if (!sheetsGroups.has(k)) sheetsGroups.set(k, []);
  sheetsGroups.get(k).push({ idx: i, row: r });
}

const sheetsDeleteIndices = [];
const sheetsSamples = [];
for (const [k, rows] of sheetsGroups) {
  if (rows.length === 1) continue;
  const sorted = [...rows].sort((a, b) => {
    const sr = statusRank(b.row[SHEETS_COL.status]) - statusRank(a.row[SHEETS_COL.status]);
    if (sr !== 0) return sr;
    return b.idx - a.idx;
  });
  for (const d of sorted.slice(1)) sheetsDeleteIndices.push(d.idx);
  if (sheetsSamples.length < 3) sheetsSamples.push({ canonical: sorted[0], toDelete: sorted.slice(1), key: k });
}

console.log(`\nSheets-side plan:`);
console.log(`   distinct groups:     ${sheetsGroups.size}`);
console.log(`   dup groups (>1 row): ${[...sheetsGroups.values()].filter((g) => g.length > 1).length}`);
console.log(`   keep:                ${sheetsGroups.size}`);
console.log(`   delete:              ${sheetsDeleteIndices.length}`);
console.log(`   expected post-cleanup row count: ${sheetsGroups.size}`);

console.log(`\nSheets sample groups (first 3):`);
for (const s of sheetsSamples) {
  const c = s.canonical;
  console.log(`\n   GROUP (${s.toDelete.length + 1} rows): uuid=${(c.row[SHEETS_COL.invoiceUuid]||"").slice(0,8)} desc="${(c.row[SHEETS_COL.lineItemText]||"").slice(0,35)}"`);
  console.log(`      KEEP   row#${c.idx + 2}  queueId=${(c.row[SHEETS_COL.queueId]||"").slice(0,18)}  status=${c.row[SHEETS_COL.status]||"(empty)"}  matchName="${(c.row[SHEETS_COL.suggestedMatchName]||"").slice(0,35)}"`);
  for (const d of s.toDelete.slice(0, 3)) {
    console.log(`      DELETE row#${d.idx + 2}      queueId=${(d.row[SHEETS_COL.queueId]||"").slice(0,18)}  status=${d.row[SHEETS_COL.status]||"(empty)"}  matchName="${(d.row[SHEETS_COL.suggestedMatchName]||"").slice(0,35)}"`);
  }
  if (s.toDelete.length > 3) console.log(`      DELETE (+${s.toDelete.length - 3} more)`);
}

// ── PG ──
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
const pgSamples = [];
for (const [k, rows] of pgGroups) {
  if (rows.length === 1) continue;
  const sorted = [...rows].sort((a, b) => {
    const sr = statusRank(b.status) - statusRank(a.status);
    if (sr !== 0) return sr;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  for (const d of sorted.slice(1)) pgDeleteIds.push(d.id);
  if (pgSamples.length < 3) pgSamples.push({ canonical: sorted[0], toDelete: sorted.slice(1), key: k });
}

console.log(`\nPG-side plan:`);
console.log(`   distinct groups:     ${pgGroups.size}`);
console.log(`   dup groups (>1 row): ${[...pgGroups.values()].filter((g) => g.length > 1).length}`);
console.log(`   keep:                ${pgGroups.size}`);
console.log(`   delete:              ${pgDeleteIds.length}`);
console.log(`   expected post-cleanup row count: ${pgGroups.size}`);

console.log(`\nPG sample groups (first 3):`);
for (const s of pgSamples) {
  console.log(`\n   GROUP (${s.toDelete.length + 1} rows): invoice_id=${(s.canonical.invoice_id||"").slice(0,8)} desc="${(s.canonical.line_item_text||"").slice(0,35)}"`);
  console.log(`      KEEP   id=${s.canonical.id.slice(0,8)}  created=${(s.canonical.created_at||"").slice(0,19)}  status=${s.canonical.status}  matchName="${(s.canonical.suggested_match_name||"").slice(0,35)}"`);
  for (const d of s.toDelete.slice(0, 3)) {
    console.log(`      DELETE id=${d.id.slice(0,8)}  created=${(d.created_at||"").slice(0,19)}  status=${d.status}  matchName="${(d.suggested_match_name||"").slice(0,35)}"`);
  }
}

// ── API payload summary ──
console.log("\n" + "=".repeat(100));
console.log("API PAYLOADS the execute step will send (NOT sending here, this is preview only)");
console.log("=".repeat(100));

const sheetsDeleteIndicesDesc = [...sheetsDeleteIndices].sort((a, b) => b - a);
console.log(`\nSheets API: spreadsheets.batchUpdate on INVENTORY tab "${TAB}"`);
console.log(`   ${sheetsDeleteIndicesDesc.length} x deleteDimension requests, chunked 50 per call`);
console.log(`   requests sorted DESC by row index so deletions do not shift remaining indices`);
console.log(`   first 5 row-indices to delete (1-indexed for Sheets display): ${sheetsDeleteIndicesDesc.slice(0, 5).map((i) => i + 2).join(", ")}`);
console.log(`   last 5: ${sheetsDeleteIndicesDesc.slice(-5).map((i) => i + 2).join(", ")}`);
console.log(`   request shape: { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex, endIndex: startIndex+1 } } }`);
console.log(`   chunk count: ${Math.ceil(sheetsDeleteIndicesDesc.length / 50)} batchUpdate calls`);

console.log(`\nPG SQL:`);
console.log(`   DELETE FROM review_queue WHERE id IN (${pgDeleteIds.length} UUIDs);`);
console.log(`   (executed via supa.from("review_queue").delete().in("id", [...${pgDeleteIds.length} ids]))`);
console.log(`   first 3 id values: ${pgDeleteIds.slice(0, 3).map((id) => "'" + id + "'").join(", ")}`);
if (pgDeleteIds.length > 3) console.log(`   (+${pgDeleteIds.length - 3} more)`);

console.log("\n" + "=".repeat(100));
console.log(`SUMMARY: 1056 Sheets -> ${sheetsGroups.size} expected (delete ${sheetsDeleteIndices.length})`);
console.log(`         ${pgRowsAll.length}  PG    -> ${pgGroups.size} expected (delete ${pgDeleteIds.length})`);
console.log("PREVIEW ONLY. NO writes performed. The execute script is _run_review_queue_cleanup.mjs --execute");
console.log("=".repeat(100));
