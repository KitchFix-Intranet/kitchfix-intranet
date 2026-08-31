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
// Coverage check: do arithmetic_fail rows carrying a suggestedMatchId
// have the catalog detail data populated (unit, lastPrice, primaryVendor)?
// If 100% (or close), extend the dropdown to render on those rows too.
// If a meaningful chunk are blank, stop and surface.
import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Read review_queue from Sheets to get the actual live arithmetic_fail rows
// (same source the dashboard reads).
const rqData = await readSheetSA(SHEET_IDS.INVENTORY, "review_queue");
const arith = [];
for (const r of rqData.rows || []) {
  const status = String(r[9] || "").trim().toLowerCase();
  if (status && status !== "pending") continue;
  if (String(r[13] || "").trim() !== "arithmetic_fail") continue;
  arith.push(r);
}
console.log("Total pending arithmetic_fail rows: " + arith.length);

const arithWithMatchId = arith.filter((r) => String(r[6] || "").trim());
console.log("With a suggestedMatchId set:        " + arithWithMatchId.length);

const matchIds = [...new Set(arithWithMatchId.map((r) => String(r[6] || "").trim()))];
console.log("Distinct catalog itemIds suggested:  " + matchIds.length);

// Coverage in item_catalog (Sheets-canonical).
const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const CAT_IDX = { itemId: 0, name: 2, category: 3, unit: 4, primaryVendor: 6, lastPrice: 7, lastPriceDate: 8, lastPriceVendor: 9 };
const wanted = new Set(matchIds);
const matches = (catData.rows || []).filter((r) => wanted.has(String(r[CAT_IDX.itemId] || "").trim()));
console.log("Catalog rows found for those IDs:    " + matches.length);

const populated = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const total = matches.length;
console.log();
console.log("Field coverage across the " + total + " catalog items that are suggested matches on arithmetic_fail rows:");
const keys = ["unit", "category", "primaryVendor", "lastPrice", "lastPriceDate", "lastPriceVendor"];
for (const k of keys) {
  const n = matches.filter((r) => populated(r[CAT_IDX[k]])).length;
  const pct = total > 0 ? ((n / total) * 100).toFixed(0) : "0";
  console.log("  " + k.padEnd(16) + " " + String(n).padStart(3) + "/" + total + "  (" + pct + "%)");
}

// Show a few sample rows so we can eye-verify (looking for the catch-weight
// beef ones where the operator most needs the unit-mismatch warning).
console.log();
console.log("Sample of 8 catalog items suggested on arithmetic_fail rows:");
for (const r of matches.slice(0, 8)) {
  console.log("  \"" + (r[CAT_IDX.name] || "").slice(0, 42).padEnd(42) +
    "\" | unit=" + String(r[CAT_IDX.unit] || "").padEnd(8) +
    " | $" + (r[CAT_IDX.lastPrice] || "—") +
    " on " + (r[CAT_IDX.lastPriceDate] || "—") +
    " via " + (r[CAT_IDX.lastPriceVendor] || "—"));
}

process.exit(0);
