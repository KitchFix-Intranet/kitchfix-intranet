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
// Confirm catalog items carry the detail data the inline detail peek will
// display. Read from SHEETS (canonical) since Module 7 hasn't shipped.
import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// item_catalog column positions (per CAT_IDX in dataStore/inventory.js):
//   0 itemId, 1 account, 2 name, 3 category, 4 unit, 5 locationId,
//   6 primaryVendor, 7 lastPrice, 8 lastPriceDate, 9 lastPriceVendor,
//   10 ..., 11 active (TRUE/FALSE), 12 linkedToInvoice, 13 isVariety,
//   14 createdBy, 15 createdAt, ...
const CAT_IDX = {
  itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5,
  primaryVendor: 6, lastPrice: 7, lastPriceDate: 8, lastPriceVendor: 9,
  active: 11, createdBy: 14, createdAt: 15,
};

const ALIAS_IDX = { aliasId: 0, aliasText: 1, itemId: 2, vendor: 3 };

// 1) Distinct suggested matches across the pending review_queue
const { data: rq } = await supa.from("review_queue")
  .select("suggested_match_id, suggested_match_name, account, line_item_text")
  .eq("status", "pending")
  .not("suggested_match_id", "is", null)
  .neq("suggested_match_id", "");
const suggestedIds = [...new Set((rq||[]).map(r => r.suggested_match_id).filter(Boolean))];
console.log("Distinct suggestedMatchIds across pending queue: " + suggestedIds.length);

// 2) Read item_catalog from Sheets, filter to the suggested items
const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const catRows = catData.rows || [];
console.log("Total catalog rows in Sheets: " + catRows.length);

const wanted = new Set(suggestedIds);
const matches = catRows.filter(r => wanted.has(String(r[CAT_IDX.itemId]||"").trim()));
console.log("Catalog rows that ARE suggested matches: " + matches.length);

const populated = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const total = matches.length;
if (total > 0) {
  const n = (key) => matches.filter(r => populated(r[CAT_IDX[key]])).length;
  console.log();
  console.log("Coverage across the " + total + " items that are SUGGESTED MATCHES today:");
  console.log("  unit            populated: " + n("unit")          + "/" + total + "  (" + ((n("unit")/total)*100).toFixed(0) + "%)");
  console.log("  category        populated: " + n("category")      + "/" + total + "  (" + ((n("category")/total)*100).toFixed(0) + "%)");
  console.log("  primaryVendor   populated: " + n("primaryVendor") + "/" + total + "  (" + ((n("primaryVendor")/total)*100).toFixed(0) + "%)");
  console.log("  lastPrice       populated: " + n("lastPrice")     + "/" + total + "  (" + ((n("lastPrice")/total)*100).toFixed(0) + "%)");
  console.log("  lastPriceDate   populated: " + n("lastPriceDate") + "/" + total + "  (" + ((n("lastPriceDate")/total)*100).toFixed(0) + "%)");
  console.log("  lastPriceVendor populated: " + n("lastPriceVendor")+"/" + total + "  (" + ((n("lastPriceVendor")/total)*100).toFixed(0) + "%)");
}

// 3) Show the tuna one if present, plus sample of 5
const tuna = matches.filter(r => /tuna/i.test(String(r[CAT_IDX.name]||"")));
console.log();
console.log("Tuna catalog matches (if any):");
if (tuna.length === 0) console.log("  (no tuna in the suggested set today)");
else for (const r of tuna) {
  console.log("  itemId=" + r[CAT_IDX.itemId] + "  name=\"" + r[CAT_IDX.name] + "\"");
  console.log("    unit=\"" + r[CAT_IDX.unit] + "\"  category=\"" + r[CAT_IDX.category] + "\"  vendor=\"" + r[CAT_IDX.primaryVendor] + "\"");
  console.log("    lastPrice=" + r[CAT_IDX.lastPrice] + "  on " + r[CAT_IDX.lastPriceDate] + "  via " + r[CAT_IDX.lastPriceVendor]);
}

console.log();
console.log("Sample of 5 suggested-match catalog rows:");
for (const r of matches.slice(0,5)) {
  console.log("  \"" + (r[CAT_IDX.name]||"").slice(0,42) + "\" | unit=" + r[CAT_IDX.unit] + " | cat=" + r[CAT_IDX.category] + " | vend=" + r[CAT_IDX.primaryVendor] + " | $" + r[CAT_IDX.lastPrice] + " on " + r[CAT_IDX.lastPriceDate]);
}

// 4) Purchase count - how many price_history rows per item?
console.log();
console.log("Purchase-count quick-look (price_history rows per item, from Sheets):");
const phData = await readSheetSA(SHEET_IDS.INVENTORY, "price_history");
const phRows = phData.rows || [];
const phByItem = new Map();
for (const r of phRows) {
  const id = String(r[0]||"").trim();  // PRICE_COLS: itemId is col 0
  if (!id) continue;
  phByItem.set(id, (phByItem.get(id)||0) + 1);
}
let withPH = 0, countSum = 0;
for (const r of matches) {
  const c = phByItem.get(String(r[CAT_IDX.itemId]||"").trim()) || 0;
  if (c > 0) withPH++;
  countSum += c;
}
const avgCount = withPH > 0 ? (countSum / withPH).toFixed(1) : "0";
console.log("  Items with >=1 price_history row: " + withPH + "/" + total + "  (" + ((withPH/Math.max(1,total))*100).toFixed(0) + "%)");
console.log("  Avg price_history rows per item: " + avgCount);

// 5) For multi-vendor pattern: how many items have been bought from multiple vendors?
console.log();
console.log("Multi-vendor distribution (from price_history):");
const vendorsByItem = new Map();
for (const r of phRows) {
  const id = String(r[0]||"").trim();
  const v  = String(r[2]||"").trim();  // PRICE_COLS: vendor is col 2
  if (!id || !v) continue;
  if (!vendorsByItem.has(id)) vendorsByItem.set(id, new Set());
  vendorsByItem.get(id).add(v);
}
let one = 0, multi = 0;
for (const r of matches) {
  const vendors = vendorsByItem.get(String(r[CAT_IDX.itemId]||"").trim()) || new Set();
  if (vendors.size === 1) one++;
  else if (vendors.size > 1) multi++;
}
console.log("  Items bought from exactly 1 vendor: " + one);
console.log("  Items bought from 2+ vendors:       " + multi);

process.exit(0);
