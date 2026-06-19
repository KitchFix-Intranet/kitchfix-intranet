// One-off setup: create the invoice_verifications tab in the INVENTORY
// spreadsheet (the tab cron PR #20 reads to release invoice-level holds
// from the overcount_suspect_reextract review_queue rows).
//
// Sheets-only reference tab. No PG mirror, not cron-written, NOT in
// dual-write recon.
//
// Schema (header at row 1):
//   A verificationId   "ver_<uid>"
//   B invoiceUuid      maps to invoice_submissions.id
//   C account          filtered against accountTab via accountMatch
//   D verifiedAt       ISO timestamp
//   E verifiedBy       operator email
//   F note             optional free-text
import { createTabSA, readSheetSA, appendRowsSA, SHEET_IDS } from "@/lib/sheets";

const TAB = "invoice_verifications";
const HEADER = ["verificationId", "invoiceUuid", "account", "verifiedAt", "verifiedBy", "note"];

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
  console.log("  tab is not empty - will NOT overwrite. Existing contents:");
  for (const r of beforeRows.slice(0, 10)) console.log("    " + JSON.stringify(r));
  console.log("  Delete existing rows manually if you want to repopulate, then re-run.");
  process.exit(0);
}

console.log("Appending header row...");
await appendRowsSA(SHEET_IDS.INVENTORY, TAB, [HEADER]);
console.log("  ✓ appended 1 header row");

console.log();
console.log("Verifying...");
const after = await readSheetSA(SHEET_IDS.INVENTORY, TAB);
console.log("Tab contents:");
console.log("  header (raw from sheet): " + JSON.stringify(after.headers || []));
console.log("  data rows: " + (after.rows || []).length);
console.log();
console.log("Header columns:");
for (let i = 0; i < HEADER.length; i++) {
  const col = String.fromCharCode(65 + i);
  console.log("  " + col + " = " + HEADER[i]);
}

process.exit(0);
