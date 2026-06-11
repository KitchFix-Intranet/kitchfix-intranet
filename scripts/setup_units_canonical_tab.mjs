// One-off setup: create the units_canonical reference tab in the INVENTORY
// spreadsheet and populate it with the 15-row canonical list + variant
// mappings.
//
// Tab schema (header at row 1):
//   A canonical  - the dropdown-displayed standard form
//   B variants   - comma-separated raw variants the canonical form absorbs
//                  (recorded now for a FUTURE one-time normalization pass;
//                  the dropdown reads col A only)
//
// Idempotent: if the tab already exists, the create call returns an error
// and we proceed to (over)write the rows. Safe to re-run.
import { createTabSA, readSheetSA, appendRowsSA, SHEET_IDS } from "@/lib/sheets";

const TAB = "units_canonical";

const ROWS = [
  ["canonical", "variants"],                  // header
  ["case",   "cs, cases"],
  ["each",   "ea, count, ct, cnt"],
  ["lb",     "pound, pounds, lbs, #"],
  ["oz",     "ounce, ounces"],
  ["gal",    "gallon, gallons, gl"],
  ["box",    "bx, boxes"],
  ["bag",    "bg, bags"],
  ["pack",   "pk, packs"],
  ["jar",    "jars"],
  ["bottle", "btl, bot, bottles"],
  ["can",    "cans"],
  ["bunch",  "bunches, bn, bnch"],
  ["tub",    "tubs"],
  ["dozen",  "dz, doz, dozens"],
  ["tray",   "trays, tr"],
];

console.log("Creating units_canonical tab in INVENTORY spreadsheet...");
const created = await createTabSA(SHEET_IDS.INVENTORY, TAB);
if (!created.success) {
  console.log("  (tab create returned: " + created.error + ")");
  console.log("  - if 'tab already exists' that's fine, proceeding to populate");
} else {
  console.log("  ✓ tab created");
}

console.log("Checking existing contents...");
const before = await readSheetSA(SHEET_IDS.INVENTORY, TAB);
const beforeRows = before.rows || [];
console.log("  found " + beforeRows.length + " existing data rows");

if (beforeRows.length > 0) {
  console.log("  tab is not empty - will NOT overwrite. Existing contents:");
  for (const r of beforeRows.slice(0, 20)) {
    console.log("    [" + (r[0] || "") + "] -> [" + (r[1] || "") + "]");
  }
  console.log("  Delete the existing rows manually if you want to repopulate, then re-run.");
  process.exit(0);
}

console.log("Appending header + 15 canonical rows...");
await appendRowsSA(SHEET_IDS.INVENTORY, TAB, ROWS);
console.log("  ✓ appended " + ROWS.length + " rows");

console.log();
console.log("Verifying...");
const after = await readSheetSA(SHEET_IDS.INVENTORY, TAB);
const afterRows = after.rows || [];
console.log("Tab contents (" + afterRows.length + " data rows + header):");
console.log("  A=canonical  | B=variants");
console.log("  -------------+------------------------------------");
for (const r of afterRows) {
  console.log("  " + String(r[0] || "").padEnd(12) + " | " + String(r[1] || ""));
}

process.exit(0);
