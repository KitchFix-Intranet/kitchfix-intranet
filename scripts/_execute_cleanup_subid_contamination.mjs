// ════════════════════════════════════════════════════════════════════════════
// EXECUTE: cleanup of sub.id-vs-client_uuid contamination from the aborted
// sweep at task bo68osf5k (2026-06-12). 81 rows across 3 tabs.
//
// REQUIRES --execute flag (default behavior is a no-op preview).
//
// TWO-GUARD SAFETY (per Kevin's sign-off conditions):
//   1. col A (Invoice UUID) must equal one of the 12 known wrong PG IDs.
//   2. col B (Timestamp) must fall within the 2026-06-12T20:43:00Z to
//      2026-06-12T20:50:59Z window - the unique fingerprint of the
//      aborted sweep.
//
// A row is deleted ONLY if BOTH guards pass. The combination is unique to
// this sweep and cannot match any legitimate or pre-existing row.
//
// IMPLEMENTATION NOTES
//   - Re-reads each tab fresh (does NOT trust pre-computed row indices).
//   - Per-tab atomic batchUpdate with deleteDimension requests sorted
//     descending by startIndex (so earlier indices don't shift when later
//     ones are deleted).
//   - Post-deletion verification: re-reads each tab and confirms the
//     deleted (tab, expected col A) tuples are GONE, plus the count
//     dropped by the expected amount.
//   - Per-row logging both before and after delete.
// ════════════════════════════════════════════════════════════════════════════

import { google } from "googleapis";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");

const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheetsApi = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS_SHEET = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

// ── GUARD 1: the 12 PG IDs the sweep wrote with ────────────────────────────
const CONTAMINATION_PG_IDS = new Set([
  // 9 from the visible sweep log [1/36] through [11/36]
  "1b7c0799-b42c-4dc6-bc7e-983ad22ef6b9",
  "9714e1ba-e373-4916-8c26-e7272b0f1204",
  "62827688-1e33-4b0a-9f33-11ba7e03a4ad",
  "28897118-5eb3-4bbc-8a97-68bbafcb8691",
  "af62aa76-c87c-4e68-800f-e2d2d578e3a5",
  "beb39c29-2c61-4df3-839c-50152c62a6bd",
  "89bad712-df5c-486f-8ebb-b0ac8f9b5458",
  "a08563df-5801-4f95-80b6-ebdda9a2f057",
  "124558b3-cef9-4b7b-b3c5-af213e3cbe45",
  // 3 from invoices 12-14 that wrote rows before the kill but whose
  // [N/36] lines never flushed (caught by orphan probe)
  "52cfe1be-1f7c-4a3b-b242-64a352946dcd",
  "8e78f4d9-8870-4a21-b9ae-5262b7f6cd5c",
  "c7f59548-995e-4757-905b-7501858eedff",
]);

// ── GUARD 2: timestamp window. Sweep wrote between 20:43:00 and 20:50:59 ──
const WINDOW_START_MS = Date.parse("2026-06-12T20:43:00Z");
const WINDOW_END_MS   = Date.parse("2026-06-12T20:50:59Z");
function rowTimestampInWindow(rowB) {
  if (!rowB) return false;
  const t = Date.parse(rowB);
  if (Number.isNaN(t)) return false;
  return t >= WINDOW_START_MS && t <= WINDOW_END_MS;
}

// ── Tabs touched by the aborted sweep ──────────────────────────────────────
const TABS = ["TBR - FL", "TXR - AZ", "CIN - AZ"];

console.log("════════════════════════════════════════════════════════════════════");
console.log("  CLEANUP: sub.id contamination from aborted sweep bo68osf5k");
console.log(`  Mode: ${EXECUTE ? "EXECUTE (will delete)" : "DRY-RUN (no flag = no-op preview)"}`);
console.log("════════════════════════════════════════════════════════════════════");
console.log("");
console.log("Guards:");
console.log(`  G1: col A ∈ {${CONTAMINATION_PG_IDS.size} known wrong PG IDs}`);
console.log(`  G2: col B (timestamp) ∈ [${new Date(WINDOW_START_MS).toISOString()}, ${new Date(WINDOW_END_MS).toISOString()}]`);
console.log(`  Delete only if BOTH pass.`);
console.log("");

// ── Step 1: Get sheet metadata (tab name -> sheetId for the API) ──────────
const meta = await sheetsApi.spreadsheets.get({
  spreadsheetId: AI_LINE_ITEMS_SHEET,
  fields: "sheets.properties(title,sheetId)",
});
const sheetIdByTab = new Map();
for (const s of meta.data.sheets || []) {
  sheetIdByTab.set(s.properties.title, s.properties.sheetId);
}

// ── Step 2: Per tab - re-read live, find matches, delete (if --execute) ──
const allOutcomes = [];

for (const tab of TABS) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  TAB: "${tab}"`);
  console.log("════════════════════════════════════════════════════════════════════");

  const sheetId = sheetIdByTab.get(tab);
  if (sheetId == null) {
    console.log(`  ABORT: could not find sheetId for tab "${tab}"`);
    continue;
  }

  // Fresh read
  const readRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS_SHEET,
    range: `'${tab}'!A:O`,
  });
  const allRows = readRes.data.values || [];
  const totalBefore = allRows.length;
  console.log(`  Total rows in tab BEFORE (incl. header): ${totalBefore}`);

  // Identify rows to delete: BOTH guards must pass
  const toDelete = [];
  let g1OnlyFails = 0; // matched G1 but NOT G2 - shouldn't happen, log if it does
  for (let i = 1; i < allRows.length; i++) {
    const colA = String(allRows[i][0] || "").trim();
    const colB = String(allRows[i][1] || "").trim();
    const g1 = CONTAMINATION_PG_IDS.has(colA);
    if (!g1) continue;
    const g2 = rowTimestampInWindow(colB);
    if (!g2) {
      g1OnlyFails++;
      console.log(`  ⚠ row ${i + 1}: colA matches PG id ${colA.slice(0,8)} but colB="${colB}" is OUTSIDE timestamp window - SKIPPING (manual review)`);
      continue;
    }
    toDelete.push({ rowIndex0: i, sheetRowNumber: i + 1, colA, colB, contents: allRows[i] });
  }

  console.log(`  Rows passing G1 (PG id match):                       ${toDelete.length + g1OnlyFails}`);
  console.log(`  Rows passing BOTH guards (eligible for deletion):    ${toDelete.length}`);
  if (g1OnlyFails > 0) console.log(`  Rows matching G1 but failing G2 (skipped): ${g1OnlyFails}`);
  console.log("");

  if (toDelete.length === 0) {
    console.log("  Nothing to delete in this tab.");
    console.log("");
    continue;
  }

  // Preview what would be deleted - print every row
  console.log(`  Rows that will be deleted (mode=${EXECUTE ? "EXECUTE" : "preview"}):`);
  for (const r of toDelete) {
    const c = r.contents;
    console.log(`    row ${String(r.sheetRowNumber).padStart(4)}: uuid=${r.colA.slice(0,8)}.. ts=${r.colB.slice(0,19)} vendor="${(c[3]||"").slice(0,18)}" inv#=${(c[4]||"").slice(0,12)} line=${c[6]||"?"} desc="${(c[7]||"").slice(0,40)}"`);
  }

  if (!EXECUTE) {
    console.log("");
    console.log(`  (preview only - pass --execute to actually delete)`);
    continue;
  }

  // ── Step 3: Delete via batchUpdate ──────────────────────────────────────
  // Sort DESCENDING by rowIndex0 so deletes don't shift the indices we
  // haven't touched yet. Google processes batchUpdate requests in order.
  toDelete.sort((a, b) => b.rowIndex0 - a.rowIndex0);
  const requests = toDelete.map((r) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: r.rowIndex0,           // 0-based, inclusive
        endIndex:   r.rowIndex0 + 1,       // 0-based, exclusive
      },
    },
  }));

  console.log("");
  console.log(`  Sending batchUpdate: ${requests.length} deleteDimension requests (sorted descending)...`);
  try {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      resource: { requests },
    });
    console.log("  batchUpdate succeeded.");
  } catch (e) {
    console.log(`  ⚠ batchUpdate FAILED: ${e.message}`);
    allOutcomes.push({ tab, attempted: toDelete.length, deleted: 0, error: e.message });
    continue;
  }

  // ── Step 4: Verify by re-reading the tab ────────────────────────────────
  const verifyRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS_SHEET,
    range: `'${tab}'!A:B`,
  });
  const afterRows = verifyRes.data.values || [];
  const totalAfter = afterRows.length;
  const expectedAfter = totalBefore - toDelete.length;
  const countOk = totalAfter === expectedAfter;
  console.log("");
  console.log(`  Total rows in tab AFTER (incl. header):  ${totalAfter}`);
  console.log(`  Expected:                                ${expectedAfter}`);
  console.log(`  Count delta matches:                     ${countOk ? "YES ✓" : "NO ⚠"}`);

  // Confirm NO surviving rows have col A in the contamination set with the window timestamp
  let survivors = 0;
  for (let i = 1; i < afterRows.length; i++) {
    const colA = String(afterRows[i][0] || "").trim();
    const colB = String(afterRows[i][1] || "").trim();
    if (CONTAMINATION_PG_IDS.has(colA) && rowTimestampInWindow(colB)) {
      survivors++;
      console.log(`    ⚠ SURVIVOR at row ${i + 1}: ${colA.slice(0,8)}.. ts=${colB.slice(0,19)}`);
    }
  }
  console.log(`  Surviving contamination rows:            ${survivors} ${survivors === 0 ? "✓" : "⚠"}`);

  allOutcomes.push({ tab, attempted: toDelete.length, deleted: toDelete.length, surviving: survivors, countOk });
  console.log("");
}

// ── Final summary ──────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  FINAL SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
if (!EXECUTE) {
  console.log("  Ran in DRY-RUN mode (no --execute flag). Zero rows deleted.");
} else {
  let totalDeleted = 0;
  let totalSurvivors = 0;
  for (const o of allOutcomes) {
    console.log(`  ${o.tab.padEnd(16)}  deleted=${o.deleted} surviving_contamination=${o.surviving ?? "?"} count_check=${o.countOk ? "ok" : "MISMATCH"}`);
    totalDeleted += o.deleted;
    totalSurvivors += o.surviving || 0;
  }
  console.log("");
  console.log(`  Total rows deleted:          ${totalDeleted}`);
  console.log(`  Total surviving contam rows: ${totalSurvivors}`);
  console.log(`  Outcome: ${totalSurvivors === 0 && totalDeleted === 81 ? "CLEAN ✓ (expected 81 deleted, 0 survivors)" : "REVIEW NEEDED"}`);
}
console.log("");
