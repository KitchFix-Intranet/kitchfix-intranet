// Regenerate Q13 bands from live post-fix data per R6b:
// - band_low = Q1 - k*IQR (no max(0,...) clamp)
// - If band_low < 0, floor at category-plausible minimum ($0.15/lb for protein
//   is not a real price, so the floor pins to a reasonable minimum per category).
// - band_high = Q3 + k*IQR (unchanged)
//
// Data population: the v6b weight set BEFORE band gating. That means:
//   - apply R5b invoice_lb_arithmetic
//   - apply p5 -> p4 -> catch-implied -> 3c-rehab -> base-parser precedence
//   - apply R7 (fluid-oz restoration; drops beverage fused-slash rows)
//   - EXCLUDE rows with review_reason='invoice_over_extracted'
//   - INCLUDE ep_qty_up_mismatch rows if catchAdmitted or R5b arithmetic
//   - EXCLUDE rows with no effective weight
//
// Write _q13_bands_v6b.json in scripts/_phase6/.
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, quantile, round2 } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";

// Category-plausible minimum $/lb - used when Q1 - k*IQR goes negative.
// Kevin: "a protein row at $0.15/lb is not a real price".
// These are floor prices; any dollar-per-pound below them signals a weight
// defect. Kept intentionally conservative (below commercial commodity prices).
const CAT_MIN_DPP = {
  protein: 0.75,      // commodity chicken bottom
  poultry: 0.75,
  seafood: 1.50,      // frozen basa/tilapia bottom
  meat: 0.75,
  dairy: 0.50,        // bulk milk/butter
  produce: 0.20,      // bulk potatoes/onions
  dry_goods: 0.15,    // flour/sugar/salt
  grocery: 0.15,
  frozen: 0.75,
  beverage: 0.05,     // bulk juice/water
  packaging: 0.10,
  cleaning: 0.10,
  supplies: 0.10,
  smallwares: 0.10,
  other: 0.10,
};
const DEFAULT_MIN_DPP = 0.10;

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));
const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, { lb: Number(r._effective_weight_lb) });
}
const catchReclassIdsAll = new Set(REC5.catch_weight_reclassified_ids || []);

// R5b invoice_lb_arithmetic layer
const invoiceLbArithById = new Map();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const unit = String(r.unit || "").toLowerCase();
  if (unit !== "lb") continue;
  const qty = Number(r.quantity), up = Number(r.unit_price), ep = Number(r.extended_price);
  if (!qty || !up || !ep || qty <= 0) continue;
  if (Math.abs(qty * up - ep) > Math.max(1, 0.02 * ep)) continue;
  invoiceLbArithById.set(r.id, qty);
}

// R7: p5 fused-slash beverage dropped
function assignBasis(row) {
  const cat = String(row.category || "").toLowerCase();
  if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(cat)) return "non_food";
  if (["beverage"].includes(cat)) return "beverage";
  if (["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(cat)) return "food";
  return "unknown";
}
const p5FusedBeverageDropped = new Set();
for (const rec of REC5.recovered) {
  const r = rowsById.get(rec.id); if (!r) continue;
  if (assignBasis(r) !== "beverage") continue;
  if (String(rec.source || "").startsWith("fused_slash_rule")) p5FusedBeverageDropped.add(rec.id);
}

// Catch admit (no arith gate per S2 ruling; ep/up in-range only)
const catchAdmitted = new Set();
for (const id of catchReclassIdsAll) {
  const r = rowsById.get(id); if (!r) continue;
  const up = Number(r.unit_price), ep = Number(r.extended_price);
  if (!up || !ep) continue;
  const implied = ep / up;
  if (!Number.isFinite(implied) || implied <= 0 || implied > 5000) continue;
  catchAdmitted.add(id);
}

function effectiveLb(row) {
  const inv = invoiceLbArithById.get(row.id);
  if (inv) return inv;
  const p5 = p5RecById.get(row.id);
  if (p5 && !p5FusedBeverageDropped.has(row.id)) return p5.effective_weight_lb;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.effective_weight_lb;
  if (catchAdmitted.has(row.id)) {
    const r = rowsById.get(row.id);
    const up = Number(r.unit_price), ep = Number(r.extended_price);
    if (up && ep) return ep / up;
  }
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(row.parsed_weight_lb);
  if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}

// Build weight set (pre-band-gate) and compute per-category $/lb distribution
const perCat = {};
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const rr = r.review_reason;
  const isInvArith = invoiceLbArithById.has(r.id);
  if (rr === "ep_qty_up_mismatch" && !catchAdmitted.has(r.id) && !isInvArith) continue;
  const eff = effectiveLb(r);
  if (!eff || eff <= 0) continue;
  const ep = Number(r.extended_price) || 0;
  if (!ep) continue;
  const dpp = ep / eff;
  const cat = String(r.category || "other").toLowerCase();
  if (!perCat[cat]) perCat[cat] = [];
  perCat[cat].push(dpp);
}

// Compute bands per Kevin's rule
const K = 1.5;
const K_PRODUCE = 1.0;
const OUT = {};
for (const [cat, dpps] of Object.entries(perCat)) {
  if (dpps.length < 5) {
    OUT[cat] = { n: dpps.length, note: "insufficient_data (<5 rows)" };
    continue;
  }
  const q1 = quantile(dpps, 0.25);
  const q3 = quantile(dpps, 0.75);
  const iqr = q3 - q1;
  const med = quantile(dpps, 0.5);
  const k = cat === "produce" ? K_PRODUCE : K;
  const rawLow = q1 - k * iqr;
  const catMin = CAT_MIN_DPP[cat] != null ? CAT_MIN_DPP[cat] : DEFAULT_MIN_DPP;
  const bandLow = rawLow < 0 ? catMin : Math.max(rawLow, catMin);
  const bandLowSource = rawLow < 0 ? "category_plausible_floor" : (rawLow < catMin ? "category_plausible_floor" : "iqr_derived");
  const bandHigh = q3 + k * iqr;
  OUT[cat] = {
    n: dpps.length,
    q1: round2(q1),
    q3: round2(q3),
    iqr: round2(iqr),
    band_multiplier: k,
    raw_low_iqr: round2(rawLow),
    category_plausible_floor: catMin,
    band_low: round2(bandLow),
    band_low_source: bandLowSource,
    band_high: round2(bandHigh),
    median: round2(med),
    method: `[max(Q1 - ${k}*IQR, category_plausible_floor=${catMin}), Q3 + ${k}*IQR] from ${dpps.length} v6b PRE-GATE weight-set rows`,
  };
}

fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_q13_bands_v6b.json",
  JSON.stringify(OUT, null, 2)
);
console.log("wrote _q13_bands_v6b.json\n");

for (const [cat, b] of Object.entries(OUT).sort((a,b) => (b[1].n||0) - (a[1].n||0))) {
  if (b.note) { console.log(`  ${cat.padEnd(12)} n=${b.n}  ${b.note}`); continue; }
  console.log(`  ${cat.padEnd(12)} n=${String(b.n).padStart(4)}  q1=${b.q1}  q3=${b.q3}  raw_low=${b.raw_low_iqr}  band=[${b.band_low}, ${b.band_high}]  (${b.band_low_source})`);
}
