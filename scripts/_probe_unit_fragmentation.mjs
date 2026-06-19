// Discovery: distinct unit strings across the inventory data + clustering.
// Read-only. No data touched.
import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. PG ai_line_items - paginate at 1000/page (PostgREST default cap)
const aliCounts = new Map();
let from = 0;
const PAGE = 1000;
let total = 0;
for (;;) {
  const { data, error } = await supa.from("ai_line_items")
    .select("unit")
    .eq("is_historical", false)
    .range(from, from + PAGE - 1);
  if (error) { console.error("PG error:", error.message); break; }
  if (!data || data.length === 0) break;
  for (const r of data) {
    const u = (r.unit === null || r.unit === undefined) ? "(null)" : String(r.unit);
    aliCounts.set(u, (aliCounts.get(u) || 0) + 1);
  }
  total += data.length;
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log("PG ai_line_items rows sampled: " + total);
console.log("Distinct unit strings (PG ai_line_items): " + aliCounts.size);

// 2. Sheets ai_line_items - per-account tabs
const ACCOUNTS = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V", "TXR - AZ", "TBJ - FL", "STL - FL", "TBR - FL", "CIN - AZ"];
const sheetsAliCounts = new Map();
let sheetsAliTotal = 0;
for (const acct of ACCOUNTS) {
  try {
    const d = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, acct);
    for (const r of d.rows || []) {
      const u = String(r[9] || "").trim() || "(blank)";  // col J = unit
      sheetsAliCounts.set(u, (sheetsAliCounts.get(u) || 0) + 1);
      sheetsAliTotal++;
    }
  } catch { /* tab might not exist */ }
}
console.log("Sheets ai_line_items rows sampled: " + sheetsAliTotal + " across " + ACCOUNTS.length + " accounts");
console.log("Distinct unit strings (Sheets ai_line_items): " + sheetsAliCounts.size);

// 3. Sheets item_catalog
const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const catCounts = new Map();
for (const r of catData.rows || []) {
  const u = String(r[4] || "").trim() || "(blank)";  // col E = unit
  catCounts.set(u, (catCounts.get(u) || 0) + 1);
}
console.log("Sheets item_catalog rows sampled: " + (catData.rows || []).length);
console.log("Distinct unit strings (Sheets item_catalog): " + catCounts.size);

// 4. Combine all three
const all = new Map();
const sourceOf = new Map(); // u -> Set<'pg-ali', 'sheets-ali', 'catalog'>
function track(map, u, n, source) {
  all.set(u, (all.get(u) || 0) + n);
  if (!sourceOf.has(u)) sourceOf.set(u, new Set());
  sourceOf.get(u).add(source);
}
for (const [u, n] of aliCounts)       track(all, u, n, "pg-ali");
for (const [u, n] of sheetsAliCounts) track(all, u, n, "sheets-ali");
for (const [u, n] of catCounts)       track(all, u, n, "catalog");

// 5. Cluster
function normalize(u) { return String(u).trim().toLowerCase().replace(/\.$/, ""); }
function clusterFor(u) {
  const n = normalize(u);
  if (/^(lb|lbs|pound|pounds|#|lb\.?|lbs\.?)$/.test(n)) return "lb";
  if (n === "#") return "lb";
  if (/^(case|cs|cases)$/.test(n)) return "case";
  if (/^(each|ea|ct|count|cnt)$/.test(n)) return "each";
  if (/^(box|bx|boxes)$/.test(n)) return "box";
  if (/^(bag|bg|bags)$/.test(n)) return "bag";
  if (/^(pack|pk|packs)$/.test(n)) return "pack";
  if (/^(gallon|gal|gallons|gl)$/.test(n)) return "gallon";
  if (/^(oz|ounce|ounces|fl oz|floz|fz|foz)$/.test(n)) return "oz";
  if (/^(bottle|btl|bot|bottles)$/.test(n)) return "bottle";
  if (/^(dozen|dz|doz|dozens)$/.test(n)) return "dozen";
  if (/^(can|cans|cn)$/.test(n)) return "can";
  if (/^(tray|trays|tr)$/.test(n)) return "tray";
  if (/^(kg|kilo|kilos|kgs|kilogram|kilograms)$/.test(n)) return "kg";
  if (/^(jar|jars|jr)$/.test(n)) return "jar";
  if (/^(tube|tubes|tb)$/.test(n)) return "tube";
  if (/^(roll|rolls|rl)$/.test(n)) return "roll";
  if (/^(bunch|bunches|bn|bnch)$/.test(n)) return "bunch";
  if (/^(head|heads|hd)$/.test(n)) return "head";
  if (/^(pail|pails)$/.test(n)) return "pail";
  if (/^(drum|drums)$/.test(n)) return "drum";
  if (/^(tote|totes)$/.test(n)) return "tote";
  if (/^(liter|liters|l|ltr)$/.test(n)) return "liter";
  if (/^(gram|grams|g|gr)$/.test(n)) return "gram";
  return null;
}

const byCluster = new Map();
const unclustered = [];
for (const [u, n] of all) {
  const c = clusterFor(u);
  if (c) {
    if (!byCluster.has(c)) byCluster.set(c, []);
    byCluster.get(c).push({ raw: u, count: n, sources: [...sourceOf.get(u)] });
  } else {
    unclustered.push({ raw: u, count: n, sources: [...sourceOf.get(u)] });
  }
}

// 6. Report
console.log();
console.log("============================================================");
console.log("CLUSTERED VARIANTS (proposed canonical <- raw variants seen)");
console.log("============================================================");
const clusterOrder = [...byCluster.entries()]
  .map(([c, vs]) => ({ c, total: vs.reduce((a, b) => a + b.count, 0), vs }))
  .sort((a, b) => b.total - a.total);
for (const { c, total, vs } of clusterOrder) {
  console.log("\n" + c.toUpperCase() + "  (total " + total + " uses across " + vs.length + " variants)");
  for (const v of vs.sort((a, b) => b.count - a.count)) {
    console.log("    " + String(v.count).padStart(6) + "  \"" + v.raw + "\"   [" + v.sources.join(", ") + "]");
  }
}

console.log();
console.log("============================================================");
console.log("UNCLUSTERED / EDGE CASES");
console.log("============================================================");
const sorted = unclustered.sort((a, b) => b.count - a.count);
const freq = sorted.filter((x) => x.count >= 5);
const rare = sorted.filter((x) => x.count < 5);
console.log("\nFrequent unclustered (>=5 uses):");
if (freq.length === 0) console.log("  (none)");
for (const v of freq) console.log("    " + String(v.count).padStart(6) + "  \"" + v.raw + "\"   [" + v.sources.join(", ") + "]");
console.log("\nRare unclustered (1-4 uses) - likely typos/garbage:");
if (rare.length === 0) console.log("  (none)");
for (const v of rare) console.log("    " + String(v.count).padStart(6) + "  \"" + v.raw + "\"   [" + v.sources.join(", ") + "]");

console.log();
console.log("============================================================");
console.log("TOTALS");
console.log("============================================================");
console.log("Distinct unit strings total: " + all.size);
console.log("In a recognized cluster:     " + [...byCluster.values()].reduce((a, v) => a + v.length, 0));
console.log("Unclustered:                  " + unclustered.length);

process.exit(0);
