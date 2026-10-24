// Determine which rows in the corpus match Kevin's 30 verified pack SKUs.
// Match keys: (vendor, item_number) primary; (vendor, description head) fallback.
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5 } from "./_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;
const OQ = JSON.parse(fs.readFileSync(P5.OPEN_QUESTIONS_JSON, "utf8"));

function parseKevinWeight(text) {
  if (text == null) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, " ");
  let m = s.match(/=\s*([\d.]+)\s*lbs?\b/);
  if (m) return Number(m[1]);
  m = s.match(/(\d+)\/(\d+)\s*lb/);
  if (m) return Number(m[1]) * Number(m[2]);
  m = s.match(/\d+\s*ea\s+(\d+(?:\.\d+)?)\s*lb/);
  if (m) return Number(m[1]);
  m = s.match(/(\d+)\s*(?:ea|packs|cartons|bags|cs|case)?\s*[\/x]?\s*(\d+(?:\.\d+)?)\s*lb/);
  if (m) return Number(m[1]) * Number(m[2]);
  m = s.match(/(\d+)ea\/?(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\s*(?:ea|\/)\s*(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\/(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  return null;
}

// Build the override table.
const overrides = [];
for (const p of OQ.pack_weights) {
  const lb = parseKevinWeight(p.case_weight_lb);
  if (lb == null) continue;
  overrides.push({
    vendor: String(p.vendor || "").trim(),
    item_number: String(p.item_number || "").trim(),
    description_head: String(p.description || "").split(/[0-9\-]/).slice(0, 2).join(" ").trim().toUpperCase(),
    description: String(p.description || "").toUpperCase(),
    pack_as_printed: String(p.pack_as_printed || "").trim(),
    per_case_lb: lb,
  });
}

// Match to corpus. Key: (vendor_name normalized, item_number) OR (vendor_name, description head + pack_as_printed).
function normVendor(v) { return String(v || "").trim().toLowerCase().split(/\s+/)[0]; }

let matched = 0;
let unmatched = 0;
const matches = [];
for (const ov of overrides) {
  const hits = [];
  for (const r of AUG) {
    if (normVendor(r.vendor_name).indexOf(normVendor(ov.vendor)) < 0) continue;
    // First: exact item_number match
    if (ov.item_number && String(r.item_number || "").trim() === ov.item_number) {
      hits.push(r);
      continue;
    }
    // Fallback: description first-5-words match + pack_as_printed close match
    const rDesc = String(r.description || "").toUpperCase();
    const packSame = String(r.pack_size || "").replace(/\s+/g, "").toUpperCase() === ov.pack_as_printed.replace(/\s+/g,"").toUpperCase();
    if (packSame && ov.description_head && rDesc.startsWith(ov.description_head)) {
      hits.push(r);
    }
  }
  matches.push({
    override: ov,
    hit_rows: hits.length,
    hit_spend: hits.reduce((s,h)=>s+(Number(h.extended_price)||0),0),
    hit_ids: hits.map(h => h.id),
  });
  if (hits.length) matched++;
  else unmatched++;
}
console.log(`Overrides with at least 1 corpus hit: ${matched}/${overrides.length}`);
console.log(`Overrides that produced no corpus match: ${unmatched}`);
console.log(`Total rows covered by any Kevin-verified pack: ${matches.reduce((s,m)=>s+m.hit_rows,0)}`);
console.log(`Total spend covered: $${matches.reduce((s,m)=>s+m.hit_spend,0).toFixed(0)}`);

console.log("\nPer-override:");
for (const m of matches) {
  console.log(`  ${m.override.vendor} | ${m.override.item_number.padEnd(10)} | ${m.override.pack_as_printed.padEnd(10)} | ${m.override.per_case_lb.toString().padStart(6)} lb | -> ${m.hit_rows.toString().padStart(3)} rows / $${m.hit_spend.toFixed(0).padStart(6)} | ${m.override.description.slice(0,50)}`);
}

fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_kevin_verified_matches.json",
  JSON.stringify({ overrides, matches }, null, 2)
);
console.log("\nwrote _kevin_verified_matches.json");
