// Bug 2 recon - read-only.
// Find cross-vendor dup groups in current Sheets item_catalog, pull full
// detail (vendors, ids, created_by, location, dates) so we can eyeball
// genuinely-same vs coincidental-name-collision.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

// Use the SAME normalize as the cron (index.js:214) so we're grouping by
// the cron's match key, not the coverage probe's looser whitespace-collapse.
function cronNormalize(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
// Also keep the looser coverage-probe norm for comparison.
function probeNorm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }

const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, active: 11, isVarietyGroup: 13, createdBy: 14, createdAt: 15, status: 16,
};

const data = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const rows = data.rows || [];
const active = rows.filter((r) => {
  if (r[CAT_IDX.active] !== "TRUE" && r[CAT_IDX.active] !== true) return false;
  const s = String(r[CAT_IDX.status] || "").trim().toLowerCase();
  if (s === "excluded" || s === "archived" || s === "review_deleted") return false;
  return true;
});

console.log("Active catalog rows: " + active.length);

// Group by (account, cronNormalize(name)) - the cron's actual match key
const cronGroups = new Map();
for (const r of active) {
  const k = (r[CAT_IDX.account] || "") + " :: " + cronNormalize(r[CAT_IDX.name]);
  if (!cronGroups.has(k)) cronGroups.set(k, []);
  cronGroups.get(k).push(r);
}
const cronDupGroups = [...cronGroups.entries()]
  .filter(([_, rows]) => rows.length > 1)
  .map(([k, rows]) => ({ key: k, rows }));

// Also group by the probe's looser norm to compare
const probeGroups = new Map();
for (const r of active) {
  const k = (r[CAT_IDX.account] || "") + " :: " + probeNorm(r[CAT_IDX.name]);
  if (!probeGroups.has(k)) probeGroups.set(k, []);
  probeGroups.get(k).push(r);
}
const probeDupGroups = [...probeGroups.entries()]
  .filter(([_, rows]) => rows.length > 1);

console.log("Dup groups by CRON normalize (alphanumeric-only):  " + cronDupGroups.length);
console.log("Dup groups by PROBE normalize (whitespace-only):   " + probeDupGroups.length);
console.log();

// Classify each cron-grouping as cross-vendor (Bug 2) vs single-vendor (Bug 1)
const crossVendor = [];
const singleVendor = [];
const novendor = [];
for (const g of cronDupGroups) {
  const vendors = new Set(g.rows.map((r) => probeNorm(r[CAT_IDX.primaryVendor])));
  vendors.delete("");
  if (vendors.size > 1) crossVendor.push({ ...g, vendors: [...vendors] });
  else if (vendors.size === 1) singleVendor.push({ ...g, vendors: [...vendors] });
  else novendor.push({ ...g, vendors: [...vendors] });
}

console.log("Cross-vendor groups (Bug 2 candidates):  " + crossVendor.length);
console.log("Single-vendor groups (Bug 1):            " + singleVendor.length);
console.log("No-vendor groups:                        " + novendor.length);
console.log();
console.log("=============================================================");
console.log("CROSS-VENDOR DUP GROUPS - full detail");
console.log("=============================================================");
for (const g of crossVendor) {
  console.log();
  console.log("KEY: " + g.key);
  console.log("Distinct vendors: [" + g.vendors.map((v) => `"${v}"`).join(", ") + "]");
  for (const r of g.rows) {
    console.log("  itemId=" + r[CAT_IDX.itemId] +
                "  name=\"" + r[CAT_IDX.name] + "\"" +
                "  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"" +
                "  unit=" + r[CAT_IDX.unit] +
                "  cat=" + r[CAT_IDX.category] +
                "  loc=" + (r[CAT_IDX.locationId] || "(none)") +
                "  by=" + r[CAT_IDX.createdBy] +
                "  created=" + r[CAT_IDX.createdAt]);
  }
}

// Also surface what the cron normalize catches that probe normalize doesn't
// (cron groups that probe didn't dedup - they would have looked like distinct
// rows to the coverage probe but the cron treats them as same)
const cronGroupedSet = new Set(cronDupGroups.map((g) => g.key));
const probeGroupedSet = new Set(probeDupGroups.map(([k, _]) => k));
const cronOnly = [...cronGroupedSet].filter((k) => !probeGroupedSet.has(k));
console.log();
console.log("=============================================================");
console.log("Cron-only dup groups (cron sees as same, coverage probe doesn't):");
console.log("=============================================================");
console.log("Count: " + cronOnly.length);
for (const k of cronOnly.slice(0, 10)) {
  const g = cronGroups.get(k);
  console.log();
  console.log("KEY: " + k);
  for (const r of g) {
    console.log("  itemId=" + r[CAT_IDX.itemId] + "  name=\"" + r[CAT_IDX.name] + "\"  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"");
  }
}

process.exit(0);
