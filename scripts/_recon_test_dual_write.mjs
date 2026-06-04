// Controlled end-to-end test of the dual-write path for storage_locations.
//
// Sequence (approved 2026-06-04):
//   Phase 1: addStorageSubZone()  -> Sheets append + PG insert
//   Phase 2: Read both sides; field-by-field equality check
//   Phase 3: deactivateStorageLocation() -> active=FALSE on both sides
//   Phase 4: Re-read both sides; verify deactivation propagated
//   Phase 5: HARD DELETE from PG via direct service-role client
//   Phase 6: HARD DELETE from Sheets via deleteRowSA
//   Phase 7: Re-scan both sides; confirm 0 rows match the marker
//
// HERMETIC env override: DUAL_WRITE_TABLES is set to include
// storage_locations regardless of what .env.local has. The orchestrators
// (cutover.js) read process.env.DUAL_WRITE_TABLES at module load, so the
// override MUST be set before the dynamic import below.

const RUN_TS = new Date().toISOString();
const MARKER = `__RECON_TEST_${RUN_TS}__`;
const ACCOUNT          = "STL - MO";
const PARENT_LOCATION  = "loc_64239fc6-117b-1b40-708cacf5"; // STL - MO Walk-in Cooler
const ICON             = "box";
const COLOR            = "gray";
const EMAIL            = "k.fietek@kitchfix.com";

// ── Hermetic env override (must precede the dataStore import) ──
process.env.DUAL_WRITE_TABLES = "storage_locations";

const { addStorageSubZone, deactivateStorageLocation } = await import("../src/lib/dataStore/inventory.js");
const { isDualWrite } = await import("../src/lib/cutover.js");
const { safeRead, deleteRowSA, findRowByValueSA, getSheetIdSA, SHEET_IDS } = await import("../src/lib/sheets.js");
const { createClient } = await import("@supabase/supabase-js");

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("════════════════════════════════════════════════════════════════════");
console.log("  DUAL-WRITE TEST: storage_locations end-to-end");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`marker:    ${MARKER}`);
console.log(`account:   ${ACCOUNT}`);
console.log(`parent:    ${PARENT_LOCATION}`);
console.log(`dual-write flag (storage_locations): ${isDualWrite("storage_locations") ? "ON" : "OFF"}`);
if (!isDualWrite("storage_locations")) {
  console.error("[recon-test] FATAL: storage_locations NOT in DUAL_WRITE_TABLES after env override. Aborting.");
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────
// Phase 1: addStorageSubZone()
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 1: addStorageSubZone() ──");
const addResult = await addStorageSubZone({
  account:           ACCOUNT,
  parentLocationId:  PARENT_LOCATION,
  name:              MARKER,
  icon:              ICON,
  color:             COLOR,
  email:             EMAIL,
  module:            "ops",
});
const TEST_ID = addResult.locationId;
console.log(`  orchestrator returned: locationId=${TEST_ID} name="${addResult.name}"`);

// ────────────────────────────────────────────────────────────────────
// Phase 2: read both sides + field-by-field equality
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 2: verify INSERT landed in BOTH stores ──");

async function readSheetsRow(id) {
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "storage_locations");
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || "").trim() === id) {
      return {
        rowIdx: i + 2,
        id:                rows[i][0],
        account:           rows[i][1],
        name:              rows[i][2],
        icon:              rows[i][3],
        sort_order:        Number(rows[i][4]),
        active:            String(rows[i][5]).trim().toUpperCase() === "TRUE",
        created_by:        rows[i][6],
        created_at:        rows[i][7],
        parent_location_id: rows[i][8],
        color:             rows[i][9] || null,
      };
    }
  }
  return null;
}
async function readPgRow(id) {
  const { data } = await supa.from("storage_locations").select("*").eq("id", id).maybeSingle();
  return data;
}

const sheetsRow = await readSheetsRow(TEST_ID);
const pgRow     = await readPgRow(TEST_ID);
console.log(`  Sheets row found: ${sheetsRow ? `YES (row ${sheetsRow.rowIdx})` : "NO"}`);
console.log(`  PG row found:     ${pgRow ? "YES" : "NO"}`);
if (!sheetsRow || !pgRow) {
  console.error("[recon-test] FATAL: dual-write did NOT produce a row on at least one side. Aborting.");
  console.error(`  sheets: ${JSON.stringify(sheetsRow)}`);
  console.error(`  pg:     ${JSON.stringify(pgRow)}`);
  process.exit(3);
}

const FIELDS = ["id", "name", "parent_location_id", "account", "active", "sort_order", "color", "icon"];
const mismatches = [];
for (const f of FIELDS) {
  const s = sheetsRow[f];
  const p = pgRow[f];
  const eq = s === p || (s == null && p == null);
  if (!eq) mismatches.push({ field: f, sheets: s, pg: p });
}
console.log(`  Field-by-field equality (${FIELDS.join(", ")}):`);
for (const f of FIELDS) {
  const s = sheetsRow[f]; const p = pgRow[f];
  const ok = s === p || (s == null && p == null);
  console.log(`    ${f.padEnd(20)} sheets=${JSON.stringify(s).padEnd(35)}  pg=${JSON.stringify(p).padEnd(35)}  ${ok ? "✓" : "✗ MISMATCH"}`);
}
if (mismatches.length > 0) {
  console.error("[recon-test] FATAL: field mismatch after insert. Aborting before deactivation/cleanup.");
  process.exit(4);
}
console.log(`  Phase 2 PASS: row matches field-for-field across both stores.`);

// ────────────────────────────────────────────────────────────────────
// Phase 3: deactivateStorageLocation()
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 3: deactivateStorageLocation() ──");
const deactResult = await deactivateStorageLocation({
  account:    ACCOUNT,
  locationId: TEST_ID,
  module:     "ops",
});
console.log(`  orchestrator returned: ${JSON.stringify(deactResult)}`);

// ────────────────────────────────────────────────────────────────────
// Phase 4: verify deactivation propagated to BOTH sides
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 4: verify deactivation landed in BOTH stores ──");
const sheetsAfter = await readSheetsRow(TEST_ID);
const pgAfter     = await readPgRow(TEST_ID);
console.log(`  Sheets active=${sheetsAfter?.active}  sort_order=${sheetsAfter?.sort_order}`);
console.log(`  PG     active=${pgAfter?.active}      sort_order=${pgAfter?.sort_order}`);
if (sheetsAfter?.active !== false || pgAfter?.active !== false) {
  console.error("[recon-test] FATAL: deactivation did NOT propagate to one side. Aborting before cleanup.");
  process.exit(5);
}
if (sheetsAfter.sort_order !== 999 || pgAfter.sort_order !== 999) {
  console.error("[recon-test] WARN: sort_order did not become 999 on both sides; deactivation side-effect may diverge.");
}
console.log(`  Phase 4 PASS: deactivation propagated; both sides now active=false.`);

// ────────────────────────────────────────────────────────────────────
// Phase 5+6: HARD DELETE from BOTH stores
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 5: HARD DELETE from PG ──");
const { error: pgDelErr } = await supa.from("storage_locations").delete().eq("id", TEST_ID);
if (pgDelErr) {
  console.error(`[recon-test] PG delete failed: ${pgDelErr.message}`);
  process.exit(6);
}
console.log(`  PG: DELETE FROM storage_locations WHERE id='${TEST_ID}' → OK`);

console.log("");
console.log("── Phase 6: HARD DELETE from Sheets ──");
// deleteRowSA requires the numeric sheet gid (not tab name) and a 0-indexed
// startIndex. findRowByValueSA returns 1-indexed (header+1), so we subtract 1.
// (Earlier versions passed the tab name and 1-indexed row, which the
// Sheets API silently rejected via the SA helper's internal catch - the
// script reported "OK" but no row was deleted. Fixed 2026-06-04.)
const sheetId = await getSheetIdSA(SHEET_IDS.INVENTORY, "storage_locations");
const rowNum  = await findRowByValueSA(SHEET_IDS.INVENTORY, "storage_locations", 0, TEST_ID);
console.log(`  storage_locations gid=${sheetId}  row 1-indexed=${rowNum}`);
if (sheetId == null || !rowNum) {
  console.error("[recon-test] Could not resolve gid or row; cannot delete from Sheets.");
  process.exit(7);
}
await deleteRowSA(SHEET_IDS.INVENTORY, sheetId, rowNum - 1);
console.log(`  Sheets: deleteRowSA gid=${sheetId} startIndex=${rowNum - 1} → OK`);

// ────────────────────────────────────────────────────────────────────
// Phase 7: confirm absent from BOTH stores
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log("── Phase 7: confirm absence on both sides ──");

// PG check
const { data: pgCheck } = await supa.from("storage_locations").select("id, name").or(`id.eq.${TEST_ID},name.eq.${MARKER}`);
const pgRemaining = (pgCheck || []).length;
console.log(`  PG rows matching id=${TEST_ID} OR name=${MARKER}: ${pgRemaining}`);

// Sheets check (re-read, scan for id or name)
const { rows: sheetsAll } = await safeRead(SHEET_IDS.INVENTORY, "storage_locations");
const sheetsRemaining = sheetsAll.filter((r) => (r[0] || "").trim() === TEST_ID || (r[2] || "").trim() === MARKER).length;
console.log(`  Sheets rows matching id=${TEST_ID} OR name=${MARKER}: ${sheetsRemaining}`);

if (pgRemaining === 0 && sheetsRemaining === 0) {
  console.log("");
  console.log("✅ TEST PASS — dual-write proven end-to-end (add + deactivate + hard-delete)");
  console.log("   Zero residue: 0 rows on both sides matching the marker.");
  process.exit(0);
} else {
  console.error("");
  console.error("✗ TEST FAIL — residue left behind. Manual cleanup may be required.");
  console.error(`  PG remaining: ${pgRemaining}, Sheets remaining: ${sheetsRemaining}`);
  process.exit(8);
}
