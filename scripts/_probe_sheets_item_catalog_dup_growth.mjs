// Read-only: scan Sheets item_catalog for dup groups using the same
// methodology as the PG probe (same active item + same account,
// normalized case-insensitive name). Compare to PG counts and check
// whether new dups have appeared AFTER 2026-06-04 (the INV-3 backfill
// cutoff that froze the PG side).
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

// CAT_IDX from src/lib/dataStore/inventory.js (mirror of code-derived schema):
// 0=itemId, 1=account, 2=name, 3=category, 4=unit, 5=locationId,
// 6=primaryVendor, 7=lastPrice, 8=lastPriceDate, 9=lastPriceVendor,
// 10=priceAtLastCount, 11=active ('TRUE'/'FALSE' string), 12=linkedToInvoice,
// 13=isVarietyGroup, 14=createdBy, 15=createdAt, 16=status, 17=notes,
// 18=lastVerified
const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, lastPrice: 7, active: 11, linkedToInvoice: 12,
  isVarietyGroup: 13, createdBy: 14, createdAt: 15, status: 16,
};

const data = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const rows = data.rows || [];
console.log("Total item_catalog rows in Sheets: " + rows.length);

// Filter to active. Sheets uses strings "TRUE"/"FALSE" + an empty status
// (or status like "excluded"/"archived"). Mirror the PG probe's "status='active'"
// by using active='TRUE' AND status NOT IN excluded/archived/etc.
const isActiveStr = (v) => v === "TRUE" || v === true;
const active = rows.filter((r) => {
  if (!isActiveStr(r[CAT_IDX.active])) return false;
  const s = String(r[CAT_IDX.status] || "").trim().toLowerCase();
  // Status field is dual-meaning (cron writes timestamp, intranet writes status);
  // exclude rows where status is one of the known inactive strings.
  if (s === "excluded" || s === "archived" || s === "review_deleted") return false;
  return true;
});
console.log("Active item_catalog rows:           " + active.length);

// Group by (account, normalized name)
function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}
const groupsRaw = new Map();
for (const r of active) {
  const k = (r[CAT_IDX.account] || "") + " :: " + norm(r[CAT_IDX.name]);
  if (!groupsRaw.has(k)) groupsRaw.set(k, []);
  groupsRaw.get(k).push(r);
}
const dupGroups = [...groupsRaw.entries()]
  .filter(([_, rows]) => rows.length > 1)
  .map(([k, rows]) => ({ key: k, rows, excess: rows.length - 1 }));

const totalDupRows = dupGroups.reduce((a, g) => a + g.rows.length, 0);
const totalExcess  = dupGroups.reduce((a, g) => a + g.excess, 0);

console.log();
console.log("============================================================");
console.log("SHEETS DUP STATE - now");
console.log("============================================================");
console.log("Distinct duplicate groups:        " + dupGroups.length);
console.log("Rows in dup groups:                " + totalDupRows);
console.log("Excess rows over 1-per-group:      " + totalExcess);
console.log();
console.log("Comparison to PG snapshot (2026-06-04 backfill cutoff):");
console.log("  PG dup groups (per yesterday's recon):  73");
console.log("  PG excess rows:                          88");
console.log("  Sheets dup groups now:                   " + dupGroups.length);
console.log("  Sheets excess rows now:                  " + totalExcess);
console.log("  Delta = Sheets - PG = NEW dups since INV-3 backfill froze PG");

// Check createdAt distribution - specifically rows AFTER 2026-06-04 17:54:46
const INV3_CUTOFF = "2026-06-04T17:54:46";
const byDate = new Map();
const postCutoffDupRows = [];
const allDupRows = [];
for (const g of dupGroups) for (const r of g.rows) {
  const cdRaw = String(r[CAT_IDX.createdAt] || "").trim();
  const cd = cdRaw.slice(0, 10);
  byDate.set(cd, (byDate.get(cd) || 0) + 1);
  allDupRows.push(r);
  if (cdRaw > INV3_CUTOFF) postCutoffDupRows.push(r);
}

console.log();
console.log("============================================================");
console.log("CREATED_AT distribution (Sheets dup rows)");
console.log("============================================================");
for (const [d, n] of [...byDate.entries()].sort()) {
  console.log("  " + d + " : " + n + (d > "2026-06-04" ? "  <-- POST-INV-3-CUTOFF" : ""));
}

console.log();
console.log("============================================================");
console.log("POST-INV-3-CUTOFF dup rows: " + postCutoffDupRows.length);
console.log("(any row >0 here = the cron is STILL producing dups today)");
console.log("============================================================");
if (postCutoffDupRows.length > 0) {
  console.log("Sample of post-cutoff dup rows (up to 12):");
  for (const r of postCutoffDupRows.slice(0, 12)) {
    console.log("  " + r[CAT_IDX.createdAt] + "  acct=" + (r[CAT_IDX.account] || "").padEnd(14) +
      " vendor=" + (r[CAT_IDX.primaryVendor] || "").slice(0,18).padEnd(18) +
      " name=\"" + (r[CAT_IDX.name] || "").slice(0, 50) + "\"");
  }
}

// Per-group: any group with at least one row created after cutoff?
const groupsWithPostCutoff = dupGroups.filter((g) =>
  g.rows.some((r) => String(r[CAT_IDX.createdAt] || "").trim() > INV3_CUTOFF)
);
console.log();
console.log("Dup GROUPS that have at least one post-cutoff row: " + groupsWithPostCutoff.length);
console.log("(these are groups the cron has ADDED TO since INV-3 froze the PG side)");

// Creator distribution on post-cutoff rows specifically
const postCreatorDist = new Map();
for (const r of postCutoffDupRows) {
  const cb = r[CAT_IDX.createdBy] || "(blank)";
  postCreatorDist.set(cb, (postCreatorDist.get(cb) || 0) + 1);
}
console.log();
console.log("Creator distribution on POST-CUTOFF dup rows:");
for (const [v, n] of [...postCreatorDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + String(n).padStart(5) + "  " + v);
}

process.exit(0);
