// USAGE (path aliases required)
// This probe imports from the `@/…` path alias, which Node cannot resolve
// on its own. Run with the alias hook installed via `--import`:
//
//   node --env-file=.env.local \
//        --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/<this-file>
//
// Running without --import fails at import time with
//   `Cannot find package '@/…'`
// which reads identically to a probe defect - added 2026-08-31 after
// PR #916 review named this as the sentinel-#4 root cause.
// Classify each Sheets item_catalog dup group as Bug 1 (batch_match orphan)
// or Bug 2 (cross-vendor mismatch) or unclassified.
// Heuristics:
//   Bug 1 indicators: same primaryVendor across all rows in group; OR two+
//                     rows created at the EXACT same millisecond (within-
//                     batch dedup converted to batch_match, orphan path
//                     fired).
//   Bug 2 indicator:  2+ distinct primaryVendor values in the group.
//   Unclassified:     anything that fits neither cleanly.
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return rowAccount.startsWith(activeAccount + " -") || activeAccount.startsWith(rowAccount + " -");
}
function norm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase(); }
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

const groupsRaw = new Map();
for (const r of active) {
  const k = (r[CAT_IDX.account] || "") + " :: " + norm(r[CAT_IDX.name]);
  if (!groupsRaw.has(k)) groupsRaw.set(k, []);
  groupsRaw.get(k).push(r);
}
const dupGroups = [...groupsRaw.entries()]
  .filter(([_, rows]) => rows.length > 1)
  .map(([k, rows]) => ({ key: k, rows, excess: rows.length - 1 }));

console.log("Total dup groups: " + dupGroups.length);
console.log("Total excess rows: " + dupGroups.reduce((a, g) => a + g.excess, 0));
console.log("Total participating rows: " + dupGroups.reduce((a, g) => a + g.rows.length, 0));

// Classify each group
const bug1Groups = [];   // single-vendor (Bug 1: A1 + A2 + A2')
const bug2Groups = [];   // multi-vendor (Bug 2)
const unclassified = []; // neither cleanly

for (const g of dupGroups) {
  const vendors = new Set(g.rows.map((r) => norm(r[CAT_IDX.primaryVendor])));
  vendors.delete("");
  // Also check for same-millisecond pairs (strong Bug 1 signal)
  const tsCounts = new Map();
  for (const r of g.rows) {
    const t = String(r[CAT_IDX.createdAt] || "").trim();
    tsCounts.set(t, (tsCounts.get(t) || 0) + 1);
  }
  const hasSameMsPair = [...tsCounts.values()].some((c) => c >= 2);

  if (vendors.size === 1) {
    bug1Groups.push({ ...g, vendors, hasSameMsPair, signal: "single-vendor" });
  } else if (vendors.size > 1) {
    bug2Groups.push({ ...g, vendors, hasSameMsPair, signal: "multi-vendor" });
  } else {
    unclassified.push({ ...g, vendors, hasSameMsPair, signal: "no vendor data" });
  }
}

const sumExcess = (arr) => arr.reduce((a, g) => a + g.excess, 0);
const sumRows   = (arr) => arr.reduce((a, g) => a + g.rows.length, 0);

console.log();
console.log("=============================================================");
console.log("COVERAGE SPLIT");
console.log("=============================================================");
console.log("                            groups   participating-rows   excess-rows");
console.log("Bug 1 (single-vendor):     " + String(bug1Groups.length).padStart(7) + "   " + String(sumRows(bug1Groups)).padStart(18) + "   " + String(sumExcess(bug1Groups)).padStart(11));
console.log("Bug 2 (multi-vendor):      " + String(bug2Groups.length).padStart(7) + "   " + String(sumRows(bug2Groups)).padStart(18) + "   " + String(sumExcess(bug2Groups)).padStart(11));
console.log("Unclassified:               " + String(unclassified.length).padStart(7) + "   " + String(sumRows(unclassified)).padStart(18) + "   " + String(sumExcess(unclassified)).padStart(11));
console.log("                            -------   ------------------   -----------");
const totalGroups = bug1Groups.length + bug2Groups.length + unclassified.length;
const totalRows   = sumRows(bug1Groups) + sumRows(bug2Groups) + sumRows(unclassified);
const totalExcess = sumExcess(bug1Groups) + sumExcess(bug2Groups) + sumExcess(unclassified);
console.log("Total:                     " + String(totalGroups).padStart(7) + "   " + String(totalRows).padStart(18) + "   " + String(totalExcess).padStart(11));

console.log();
console.log("Bug 1 same-millisecond pairs (strong within-batch orphan signal):");
const ms = bug1Groups.filter((g) => g.hasSameMsPair);
console.log("  " + ms.length + " of " + bug1Groups.length + " Bug-1 groups have at least one same-ms duplicate insert");

console.log();
console.log("=============================================================");
console.log("SAMPLE Bug 1 groups (single-vendor)");
console.log("=============================================================");
for (const g of bug1Groups.slice(0, 8)) {
  console.log();
  console.log("[" + g.signal + (g.hasSameMsPair ? " + same-ms" : "") + "] " + g.key);
  for (const r of g.rows) {
    console.log("  " + r[CAT_IDX.createdAt] + "  vendor=" + r[CAT_IDX.primaryVendor] + "  by=" + r[CAT_IDX.createdBy] + "  loc=" + (r[CAT_IDX.locationId] || "(none)"));
  }
}

console.log();
console.log("=============================================================");
console.log("SAMPLE Bug 2 groups (multi-vendor)");
console.log("=============================================================");
for (const g of bug2Groups.slice(0, 8)) {
  console.log();
  console.log("[" + g.signal + "] " + g.key + "  vendors=[" + [...g.vendors].join(", ") + "]");
  for (const r of g.rows) {
    console.log("  " + r[CAT_IDX.createdAt] + "  vendor=" + r[CAT_IDX.primaryVendor] + "  by=" + r[CAT_IDX.createdBy] + "  loc=" + (r[CAT_IDX.locationId] || "(none)"));
  }
}

if (unclassified.length > 0) {
  console.log();
  console.log("=============================================================");
  console.log("UNCLASSIFIED groups (show all)");
  console.log("=============================================================");
  for (const g of unclassified) {
    console.log();
    console.log("[" + g.signal + "] " + g.key);
    for (const r of g.rows) {
      console.log("  " + r[CAT_IDX.createdAt] + "  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"  by=" + r[CAT_IDX.createdBy] + "  loc=" + (r[CAT_IDX.locationId] || "(none)"));
    }
  }
}

process.exit(0);
