// ════════════════════════════════════════════════════════════════════════════
// PROBE: Shadow-mode diagnostic - is weightLineValue populated in ai_line_items?
//
// READ-ONLY. No DB or Sheets writes.
//
// Tonight's first shadow run returned would-recover=0 with 47 residual lines
// (36 BEK + Cheney). The question: are those held lines OLD (pre-PR-#133) or
// NEW (post-#133, meaning the writer/reader chain is broken)?
//
// This probe reads recent ai_line_items rows for BEK + Cheney accounts and
// reports whether Stage A cols (col V = weightLineValue, col S = shippedCount)
// are populated, split by row timestamp against PR #133's merge time
// (2026-06-09 20:31:36 UTC).
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_shadow_diagnostic.mjs
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";

const PR133_MERGE_UTC = new Date("2026-06-09T20:31:36Z").getTime();

// ai_line_items column indices (matches both writer dataStore/invoice.js and
// reader cron index.js):
const COL = {
  invoiceUuid: 0,
  timestamp:   1,
  account:     2,
  vendor:      3,
  invoiceNum:  4,
  invoiceDate: 5,
  lineNum:     6,
  description: 7,
  quantity:    8,
  unit:        9,
  unitPrice:  10,
  amount:     11,   // extendedPrice
  category:   12,
  itemNumber: 15,   // P
  packSize:   16,   // Q
  ordered:    17,   // R
  shipped:    18,   // S
  uomRaw:     19,   // T
  amountRaw:  20,   // U
  weightLine: 21,   // V - THE KEY FIELD
  catchMarker:22,   // W
};

const ACCOUNTS = ["TXR - TX - H", "STL - FL"];   // BEK + Cheney from tonight's residual

console.log("=".repeat(100));
console.log("SHADOW DIAGNOSTIC: weightLineValue population in ai_line_items");
console.log(`PR #133 merged: 2026-06-09 20:31:36 UTC (${PR133_MERGE_UTC})`);
console.log("=".repeat(100));
console.log("");

for (const account of ACCOUNTS) {
  console.log(`\n--- Account: ${account} ---`);
  const rows = await safeRead(SHEET_IDS.AI_LINE_ITEMS, account);
  // safeRead returns { rows } or array depending on the codepath; normalize:
  const arr = Array.isArray(rows) ? rows : (rows?.rows || []);
  console.log(`Total rows: ${arr.length}`);

  // Parse timestamp + bucket by pre/post-merge. Sort by timestamp desc so
  // we see the newest extractions first.
  const enriched = arr
    .map((r, i) => ({
      idx: i,
      ts: r[COL.timestamp] || "",
      tsMs: Date.parse(r[COL.timestamp]) || 0,
      uuid: (r[COL.invoiceUuid] || "").slice(0, 8),
      vendor: r[COL.vendor] || "",
      invoiceNum: r[COL.invoiceNum] || "",
      desc: (r[COL.description] || "").slice(0, 35),
      q: r[COL.quantity] || "",
      unitPrice: r[COL.unitPrice] || "",
      amount: r[COL.amount] || "",
      shipped: r[COL.shipped] || "",
      weightLine: r[COL.weightLine] || "",
      catchMarker: r[COL.catchMarker] || "",
    }))
    .filter((r) => r.tsMs > 0)
    .sort((a, b) => b.tsMs - a.tsMs);

  const postMerge = enriched.filter((r) => r.tsMs >= PR133_MERGE_UTC);
  const preMerge  = enriched.filter((r) => r.tsMs <  PR133_MERGE_UTC);

  console.log(`Post-#133 (>= 2026-06-09 20:31 UTC): ${postMerge.length} rows`);
  console.log(`Pre-#133  (<  2026-06-09 20:31 UTC): ${preMerge.length} rows`);

  // Of the post-merge rows: how many have a non-empty weightLineValue?
  const postPopulated = postMerge.filter((r) => r.weightLine !== "" && r.weightLine != null);
  const postPopulatedShipped = postMerge.filter((r) => r.shipped !== "" && r.shipped != null);
  console.log("");
  console.log(`POST-#133 fill rates (any row, not just catch-weight):`);
  console.log(`  weightLineValue populated: ${postPopulated.length}/${postMerge.length} (${postMerge.length ? (postPopulated.length / postMerge.length * 100).toFixed(1) : 0}%)`);
  console.log(`  shippedCount populated:    ${postPopulatedShipped.length}/${postMerge.length} (${postMerge.length ? (postPopulatedShipped.length / postMerge.length * 100).toFixed(1) : 0}%)`);

  // PRE-merge sanity
  const prePopulated = preMerge.filter((r) => r.weightLine !== "" && r.weightLine != null);
  console.log(`PRE-#133 weightLineValue populated: ${prePopulated.length}/${preMerge.length} (expected 0 - pre-Stage-A prompt didn't write it)`);

  // Show the 10 most recent rows so we can eyeball
  console.log("");
  console.log(`10 most recent rows for ${account}:`);
  console.log(`  ${"timestamp".padEnd(24)} ${"uuid8".padEnd(8)} ${"vendor".padEnd(16)} ${"desc".padEnd(35)} ${"q".padEnd(6)} ${"shp".padEnd(7)} ${"weight".padEnd(7)} marker`);
  for (const r of enriched.slice(0, 10)) {
    const marker = r.tsMs >= PR133_MERGE_UTC ? "[POST]" : "[pre] ";
    const ts = r.ts.slice(0, 24);
    console.log(`  ${ts.padEnd(24)} ${r.uuid.padEnd(8)} ${r.vendor.slice(0, 16).padEnd(16)} ${r.desc.padEnd(35)} ${String(r.q).slice(0,6).padEnd(6)} ${String(r.shipped).slice(0,7).padEnd(7)} ${String(r.weightLine).slice(0,7).padEnd(7)} ${r.catchMarker || "-"} ${marker}`);
  }

  // If there are post-merge rows, show a few specifically to see if weight is captured on catch-weight-shape lines
  if (postMerge.length > 0) {
    const beefyPost = postMerge.filter((r) => /beef|chicken|pork|fish|salmon|lamb|shrimp|tuna/i.test(r.desc));
    console.log("");
    console.log(`POST-merge protein-shaped rows (catch-weight candidates) - showing up to 8:`);
    if (beefyPost.length === 0) {
      console.log(`  (none found - no protein-keyword rows submitted after PR #133 merge)`);
    } else {
      for (const r of beefyPost.slice(0, 8)) {
        const hasW = r.weightLine !== "" && r.weightLine != null;
        console.log(`  ${r.ts.slice(0,24)} ${r.vendor.slice(0,16).padEnd(16)} "${r.desc.padEnd(35)}" q=${String(r.q).padEnd(5)} shp=${String(r.shipped).padEnd(6)} weight=${String(r.weightLine).padEnd(7)} ${hasW ? "✓ weight populated" : "✗ weight EMPTY"}`);
      }
    }
  }
}

console.log("");
console.log("=".repeat(100));
console.log("INTERPRETATION:");
console.log("  IF post-merge protein-shaped rows have weight populated -> writer is working,");
console.log("     tonight's residual=47 was just backlog (pre-merge invoices). Benign. Wait for");
console.log("     new catch-weight invoices.");
console.log("  IF post-merge protein-shaped rows show weight EMPTY -> writer or prompt is not");
console.log("     populating the field. Need to investigate the live extraction pipeline.");
console.log("  IF no post-merge rows exist at all -> no new invoices submitted since PR #133 merge.");
console.log("     Tonight's residual=47 is 100% backlog by definition. Wait for new invoices.");
console.log("=".repeat(100));
