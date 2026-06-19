// One-off setup: create the catchweight_derivations_log tab in the INVENTORY
// spreadsheet (the tab cron PR #22 appends to when catch_weight_subline
// derivation fires).
//
// Sheets-only reference tab. No PG mirror. NOT in dual-write recon.
//
// Schema (header at row 1):
//   A  timestamp        - ISO timestamp the cron logged the detection
//   B  account          - account tab name
//   C  vendor           - line's vendor
//   D  invoiceUuid      - source invoice UUID
//   E  invoiceNumber    - invoice number
//   F  lineDescription  - what the AI extracted as description
//   G  oldQty           - OCR'd quantity BEFORE derivation
//   H  oldUnit          - OCR'd unit BEFORE derivation
//   I  derivedQty       - the weight from weightLineValue
//   J  derivedUnit      - "lb"
//   K  unitPrice        - per-unit price (per-lb on catch-weight lines)
//   L  amount           - extended amount from the invoice
//   M  derivationReason - always "catch_weight_subline"
//   N  cronMode         - "shadow" | "live"
import { createTabSA, readSheetSA, appendRowsSA, SHEET_IDS } from "@/lib/sheets";

const TAB = "catchweight_derivations_log";
const HEADER = [
  "timestamp", "account", "vendor", "invoiceUuid", "invoiceNumber",
  "lineDescription", "oldQty", "oldUnit", "derivedQty", "derivedUnit",
  "unitPrice", "amount", "derivationReason", "cronMode",
];

console.log("Creating " + TAB + " tab in INVENTORY spreadsheet...");
const created = await createTabSA(SHEET_IDS.INVENTORY, TAB);
if (!created.success) {
  console.log("  (tab create returned: " + created.error + ")");
  console.log("  if 'tab already exists' that's fine, proceeding to verify");
} else {
  console.log("  ✓ tab created");
}

console.log("Checking existing contents...");
const before = await readSheetSA(SHEET_IDS.INVENTORY, TAB);
const beforeRows = before.rows || [];
console.log("  found " + beforeRows.length + " existing data rows");

if (beforeRows.length > 0) {
  console.log("  tab is not empty - will NOT overwrite. Existing contents (first 5):");
  for (const r of beforeRows.slice(0, 5)) console.log("    " + JSON.stringify(r));
  console.log("  Delete existing rows manually if you want to repopulate, then re-run.");
  process.exit(0);
}

console.log("Appending header row (14 columns)...");
await appendRowsSA(SHEET_IDS.INVENTORY, TAB, [HEADER]);
console.log("  ✓ appended 1 header row");

console.log();
console.log("Verifying...");
const after = await readSheetSA(SHEET_IDS.INVENTORY, TAB);
console.log("Tab contents:");
console.log("  header (raw from sheet): " + JSON.stringify(after.headers || []));
console.log("  data rows: " + (after.rows || []).length);
console.log();
console.log("Header columns (A-N):");
for (let i = 0; i < HEADER.length; i++) {
  const col = i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + (i - 26));
  console.log("  " + col + " = " + HEADER[i]);
}

process.exit(0);
