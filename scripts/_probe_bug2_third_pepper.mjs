// Quick look-up: what's item_dc50ec3d (the third STL-MO pepper Claude
// matched to)? Helps understand if Bug 2 is one-shape or many.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, active: 11, createdBy: 14, createdAt: 15, status: 16,
};
const data = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const targets = new Set([
  "item_6307966c-a8cb-bab5-eb50d1f2", // WCW "Peppers - Bell Red"
  "item_75f3f79f-6721-79b8-32e0ac58", // Kuna "Peppers - Bell Red"
  "item_dc50ec3d-cdfc-b252-3e6a8483", // Kuna ???
]);
const hits = (data.rows || []).filter((r) => targets.has(r[CAT_IDX.itemId]));
console.log("Pepper catalog rows in STL - MO:");
for (const r of hits) {
  console.log("  " + r[CAT_IDX.itemId] +
              "  name=\"" + r[CAT_IDX.name] + "\"" +
              "  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"" +
              "  active=" + r[CAT_IDX.active] +
              "  status=\"" + r[CAT_IDX.status] + "\"" +
              "  created=" + r[CAT_IDX.createdAt]);
}

// All STL-MO pepper rows (any pepper, any state)
console.log();
console.log("ALL STL-MO 'pepper' rows (any active state):");
const allPepper = (data.rows || []).filter((r) =>
  /STL - MO/.test(String(r[CAT_IDX.account] || "")) &&
  /pepper/i.test(String(r[CAT_IDX.name] || ""))
);
for (const r of allPepper) {
  console.log("  " + r[CAT_IDX.itemId] +
              "  name=\"" + r[CAT_IDX.name] + "\"" +
              "  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"" +
              "  active=" + r[CAT_IDX.active] +
              "  status=\"" + r[CAT_IDX.status] + "\"" +
              "  created=" + r[CAT_IDX.createdAt]);
}
process.exit(0);
