// Phase 6d probe: measure D1 / D2 / D3 / D4 potential BEFORE writing the layer.
// Read-only. Produces JSON summaries the actual layer script will consume as
// hard-coded reference values for reporting.

import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const A6 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json", "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));
const BANDS = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_q13_bands_v6b.json", "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

// Reproduce v6b effective weight / weight-set membership - we need to know
// which rows are UNRESOLVED (not in any layer) so D1/D2/D3 can target them.
const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, { lb: Number(r._effective_weight_lb) });
}
const catchReclassIdsAll = new Set([...(REC5.catch_weight_reclassified_ids || [])]);

// R5b: invoice_lb_arithmetic candidates
const invoiceLbArithIds = new Set();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const unit = String(r.unit || "").toLowerCase();
  if (unit !== "lb") continue;
  const qty = Number(r.quantity);
  const up = Number(r.unit_price);
  const ep = Number(r.extended_price);
  if (!qty || !up || !ep || qty <= 0) continue;
  const calc = qty * up;
  const tol = Math.max(1, 0.02 * ep);
  if (Math.abs(calc - ep) > tol) continue;
  invoiceLbArithIds.add(r.id);
}

const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);

function currentEffLb(r) {
  if (invoiceLbArithIds.has(r.id)) return Number(r.quantity);
  const p5 = p5RecById.get(r.id); if (p5) return p5.effective_weight_lb;
  const p4 = p4RecById.get(r.id); if (p4) return p4.effective_weight_lb;
  if (catchReclassIdsAll.has(r.id)) {
    const up = Number(r.unit_price); const ep = Number(r.extended_price);
    if (up && ep) { const impl = ep / up; if (impl > 0 && impl <= 5000) return impl; }
  }
  const r3c = rehab3cById.get(r.id);
  if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(r.parsed_weight_lb);
  if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}

function isCoreFoodCat(cat) {
  return ["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(String(cat || "").toLowerCase());
}

// Currently unresolved core-food rows
const unresolvedCore = [];
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id) && !invoiceLbArithIds.has(r.id)) continue;
  if (!isCoreFoodCat(r.category)) continue;
  const el = currentEffLb(r);
  if (el && el > 0) continue;
  unresolvedCore.push(r);
}

// -----------------------------------------------------------------------
// D1: description-based catalog borrow potential
// Build catalog by (vendor_id, description_norm) from rows that resolved via
// a CLEAN method (parsed_weight_source in CLEAN_METHODS), NOT
// invoice_over_extracted / ep_qty_up_mismatch, and have a per-case pack.
// Then check how many unresolved rows have a same-key sibling.
// -----------------------------------------------------------------------
// Only seed from source rows whose per-CASE weight is derivable. We reuse
// parsed_weight_lb / qty_used to back out totalMass_lb per case.
const descCatalog = new Map();  // key = vendor_id::description_norm -> { lb_per_case }
for (const r of rows) {
  if (!r.vendor_id) continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const src = r.parsed_weight_source;
  if (!CLEAN_METHODS.has(src)) continue;
  const pw = Number(r.parsed_weight_lb);
  const q = Number(r.qty_used);
  if (!Number.isFinite(pw) || pw <= 0) continue;
  if (!Number.isFinite(q) || q <= 0) continue;
  const perCase = pw / q;
  if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!descCatalog.has(key)) descCatalog.set(key, { lb_per_case: perCase, seed_rows: 1 });
  else descCatalog.get(key).seed_rows += 1;
}

// Also allow p5-recovered rows to serve as seeds via the p5 layer's
// per-case weight. Compute per-case = p5.effective_weight_lb / qty_used.
for (const r of rows) {
  if (!r.vendor_id) continue;
  const desc = String(r.description_norm || "").trim(); if (!desc) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const p5 = p5RecById.get(r.id); if (!p5) continue;
  const q = Number(r.qty_used) || Number(r.quantity);
  if (!q || q <= 0) continue;
  const perCase = p5.effective_weight_lb / q;
  if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!descCatalog.has(key)) descCatalog.set(key, { lb_per_case: perCase, seed_rows: 1, seeded_from: "p5" });
}

const d1Hits = [];
for (const r of unresolvedCore) {
  const desc = String(r.description_norm || "").trim();
  if (!r.vendor_id || !desc) continue;
  const key = `${r.vendor_id}::${desc}`;
  const cat = descCatalog.get(key);
  if (!cat) continue;
  const q = Number(r.qty_used) || Number(r.quantity);
  if (!q || q <= 0) continue;
  const lb = q * cat.lb_per_case;
  d1Hits.push({ id: r.id, account: r.account_label, category: r.category, ep: Number(r.extended_price) || 0, lb, lb_per_case: cat.lb_per_case });
}

const d1ByAccount = { "TBR-FL": { rows: 0, spend: 0 }, "TBJ-FL": { rows: 0, spend: 0 }, "STL-FL": { rows: 0, spend: 0 } };
for (const h of d1Hits) {
  const acct = String(h.account || "").replace(" - ", "-");
  if (!d1ByAccount[acct]) continue;
  d1ByAccount[acct].rows += 1;
  d1ByAccount[acct].spend += h.ep;
}
for (const a of Object.keys(d1ByAccount)) d1ByAccount[a].spend = Math.round(d1ByAccount[a].spend * 100) / 100;

console.log("\n===== D1 description-catalog potential =====");
console.log(`  catalog size:      ${descCatalog.size}`);
console.log(`  unresolved core:   ${unresolvedCore.length}`);
console.log(`  D1 hits total:     ${d1Hits.length}`);
for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) console.log(`     ${a}: ${d1ByAccount[a].rows} rows / $${d1ByAccount[a].spend}`);
console.log(`  Kevin target:      576 rows / $52,577`);

// -----------------------------------------------------------------------
// D2 fused-slash extension - measure candidates from pack shapes
// -----------------------------------------------------------------------
// Kevin's shapes (all currently in the suspicious/unresolved bucket):
//   Chicken: SYS CLS CHICKEN CVP BRST B/S RDM JUMBO pack "410 LB" = 4/10 LB = 40 lb/case
//   Bacon:   DAILYS BACON LAYFLAT C/C 10/14 APL GF pack "115LB" = 1/15 LB = 15 lb/case
//   Bacon:   HORMEL BACON LAYOUT APPLEWOOD 13/17 5525 pack "115 LB" = 1/15 LB
// Produce:
//   PROPACK BANANA GREEN TIP pack "140LB" = 1/40 LB = 40 lb/case
//   SYFPNAT LETTUCE ROMAINE HEART pack "412CT" = 4/12 CT
//   PACKER KIWI FRUIT FCY FRESH pack "136 CT" = 1/36 CT
//   BLUEBERRIES FRESH (Cheney) pack "012/1" = 12/1

const CATEGORY_LB_BOUNDS = {
  protein: [5, 150], poultry: [5, 100], meat: [5, 150], seafood: [3, 100],
  dairy: [3, 80], produce: [3, 100], dry_goods: [1, 200], grocery: [1, 200],
  frozen: [3, 100], beverage: [0.5, 60], other: [1, 200],
};

// Regex bank for D2
const D2_PATTERNS = [
  // "410 LB" / "410LB" style: 3-digit LB no separator - leading-1 dropped-slash IS the dominant form in this data
  { name: "3d_lb_leading_1_split_1plus2", regex: /^\s*(\d)(\d{2})\s*LB\s*$/i, unit: "LB", to_lb: (n,m)=>n*m },
  // "412CT" / "412 CT" - 3-digit CT: 1+2 split (4/12 CT)
  { name: "3d_ct_leading_1_split_1plus2", regex: /^\s*(\d)(\d{2})\s*CT\s*$/i, unit: "CT", to_lb: null },
  // "012/1" pack - zero-padded 2 or 3 digit / 1-2 digit no unit -> counts
  { name: "padded_slash_num", regex: /^\s*0*(\d+)\s*\/\s*0*(\d+)\s*$/i, unit: null, to_lb: null },
];

// Just count candidate matches so we can size the effect
const d2CandidatesByPattern = {};
for (const p of D2_PATTERNS) d2CandidatesByPattern[p.name] = { total: 0, unresolved_core: 0, by_shape: new Map() };

for (const r of rows) {
  const pack = String(r.pack_size || "").trim();
  for (const p of D2_PATTERNS) {
    const m = pack.match(p.regex);
    if (!m) continue;
    const bucket = d2CandidatesByPattern[p.name];
    bucket.total += 1;
    if (unresolvedCore.some(x => x.id === r.id)) bucket.unresolved_core += 1;
    const key = pack.toUpperCase();
    bucket.by_shape.set(key, (bucket.by_shape.get(key) || 0) + 1);
    break; // only first match
  }
}

console.log("\n===== D2 fused-slash pattern candidates =====");
for (const p of D2_PATTERNS) {
  const b = d2CandidatesByPattern[p.name];
  console.log(`  ${p.name}: total=${b.total} unresolved_core=${b.unresolved_core}`);
  const top = [...b.by_shape.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5);
  for (const [k, n] of top) console.log(`     "${k}" x ${n}`);
}

// -----------------------------------------------------------------------
// D3 estimate candidates - just enumerate which descriptions we'd hit
// -----------------------------------------------------------------------
const D3_ESTIMATES = [
  { name: "propack_banana", match: /PROPACK\s+BANANA/, vendor: /SYSCO/, lb_per_case: 40, confidence: "high", category_expect: "produce" },
  { name: "sysco_pineapple", match: /PINEAPPLE\s+CASE/, vendor: null, lb_per_case: 35, confidence: "high", category_expect: "produce" },
  { name: "propack_avocado_160", match: /PROPACK\s+AVOCADO\s+HASS\s+160\s*CT/, vendor: null, lb_per_case: 25, confidence: "high", category_expect: "produce" },
  { name: "avocado_hass_40_48", match: /AVOCADO\s+HASS\s+PREMIUM\s+40\s*\/\s*48/, vendor: null, lb_per_case: 25, confidence: "high", category_expect: "produce" },
  { name: "grapes_red_sunfresh", match: /GRAPES\s+RED/, vendor: /SUNFRESH|SUN\s?FRESH/, lb_per_case: 18, confidence: "high", category_expect: "produce" },
  { name: "strawberries_flat_8x1", match: /STRAWBERRIES\s+FLAT\s+8\s*X\s*1/, vendor: null, lb_per_case: 8, confidence: "high", category_expect: "produce" },
  { name: "lettuce_romaine_hearts_12_3", match: /LETTUCE\s+ROMAINE\s+HEART/, vendor: null, lb_per_case: 24, confidence: "medium", category_expect: "produce" },
  { name: "blueberries_flat_sunfresh", match: /BLUEBERR/, vendor: /SUNFRESH|SUN\s?FRESH/, lb_per_case: 8.4, confidence: "medium", category_expect: "produce" },
  { name: "blueberries_fresh_cheney", match: /BLUEBERR/, vendor: /CHENEY/, lb_per_case: 8.4, confidence: "medium", category_expect: "produce" },
];

const d3Hits = {};
for (const est of D3_ESTIMATES) d3Hits[est.name] = { rows: 0, spend: 0, sample: null };

for (const r of unresolvedCore) {
  const desc = String(r.description || "").toUpperCase();
  const vendor = String(r.vendor_name || "").toUpperCase();
  for (const est of D3_ESTIMATES) {
    if (!est.match.test(desc)) continue;
    if (est.vendor && !est.vendor.test(vendor)) continue;
    d3Hits[est.name].rows += 1;
    d3Hits[est.name].spend += Number(r.extended_price) || 0;
    if (!d3Hits[est.name].sample) d3Hits[est.name].sample = { id: r.id, desc: r.description, vendor: r.vendor_name, ep: r.extended_price, up: r.unit_price, qty: r.qty_used || r.quantity, cat: r.category };
    break;
  }
}

console.log("\n===== D3 estimate hits (unresolved core rows only) =====");
for (const est of D3_ESTIMATES) {
  const h = d3Hits[est.name];
  console.log(`  ${est.name}: ${h.rows} rows / $${Math.round(h.spend*100)/100}  ${h.sample ? '- ' + h.sample.desc.slice(0,50) : ''}`);
}

// -----------------------------------------------------------------------
// D4 egg regex candidates
// Must NOT match eggplant, egg noodles, egg roll.
// -----------------------------------------------------------------------
// Standard test: /\bEGG(S)?\b/ but with explicit negative lookahead for the excluded words
// Because JS regex lookahead is per-position, we use a simpler pattern with word boundary:
//   /\bEGG(S)?\b/ matches "EGGS" but ALSO matches "EGG" in "EGG NOODLES", "EGG ROLL", "EGG WHITE".
// For safety, do two-pass: match \bEGG(S)?\b, then verify it's NOT immediately followed by
// ROLL, NOODLE, PLANT (eggplant is one word so \bEGG\b won't match anyway - lets verify).

const EGG_REGEX = /\bEGGS?\b/i;
const EGG_NEG_REGEX = /\bEGG(\s+(ROLL|ROLLS|NOODLE|NOODLES))\b/i;
// Also exclude EGGPLANT (one word, but check anyway just in case OCR splits it)
function isEggRow(desc) {
  if (!desc) return false;
  const d = String(desc).toUpperCase();
  if (!EGG_REGEX.test(d)) return false;
  if (EGG_NEG_REGEX.test(d)) return false;
  if (/EGGPLANT/i.test(d)) return false;
  return true;
}

let eggByAccountByCat = {};
let eggSample = [];
let falsePositiveWatch = { "EGGPLANT": [], "EGG ROLL": [], "EGG NOODLE": [] };
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const d = String(r.description || "").toUpperCase();
  // Check exclusions for audit reporting
  if (/EGGPLANT/i.test(d)) falsePositiveWatch.EGGPLANT.push(r.description);
  if (/\bEGG\s+ROLL/i.test(d)) falsePositiveWatch["EGG ROLL"].push(r.description);
  if (/\bEGG\s+NOODLE/i.test(d)) falsePositiveWatch["EGG NOODLE"].push(r.description);
  if (!isEggRow(d)) continue;
  const acct = String(r.account_label || "").replace(" - ", "-");
  const cat = String(r.category || "").toLowerCase();
  if (!eggByAccountByCat[acct]) eggByAccountByCat[acct] = { total: 0, protein: 0, dairy: 0, dry_goods: 0, other: 0 };
  const ep = Number(r.extended_price) || 0;
  eggByAccountByCat[acct].total += ep;
  if (cat === "protein") eggByAccountByCat[acct].protein += ep;
  else if (cat === "dairy") eggByAccountByCat[acct].dairy += ep;
  else if (cat === "dry_goods") eggByAccountByCat[acct].dry_goods += ep;
  else eggByAccountByCat[acct].other += ep;
  if (eggSample.length < 20) eggSample.push({ desc: r.description, cat: r.category, ep, acct });
}
for (const a of Object.keys(eggByAccountByCat)) {
  for (const k of Object.keys(eggByAccountByCat[a])) eggByAccountByCat[a][k] = Math.round(eggByAccountByCat[a][k] * 100) / 100;
}

console.log("\n===== D4 egg reclassification =====");
console.log(`  regex: ${EGG_REGEX} (excluding EGG NOODLE/ROLL/PLANT)`);
console.log(`  false-positive watch (should be 0 hits after negation):`);
for (const k of Object.keys(falsePositiveWatch)) {
  const sample = [...new Set(falsePositiveWatch[k])].slice(0, 3);
  console.log(`     "${k}": ${falsePositiveWatch[k].length} rows containing keyword (excluded from match): ${JSON.stringify(sample)}`);
}
console.log(`  egg spend by account by cat:`);
for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) {
  const e = eggByAccountByCat[a] || {};
  console.log(`     ${a}: total=$${e.total||0}  protein=$${e.protein||0}  dairy=$${e.dairy||0}  dry_goods=$${e.dry_goods||0}  other=$${e.other||0}`);
}
console.log(`  Kevin expected: TBR total $5,344 (836+4,114+270+124); TBJ $5,842 (2,419+3,343+79); STL $6,071 (221+5,580+270)`);
console.log(`  sample egg rows:`);
for (const s of eggSample.slice(0, 10)) console.log(`     [${s.acct}][${s.cat}] $${s.ep} - ${s.desc}`);

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_probe6d.json";
fs.writeFileSync(OUT, JSON.stringify({
  d1: {
    catalog_size: descCatalog.size,
    unresolved_core: unresolvedCore.length,
    hits_total: d1Hits.length,
    by_account: d1ByAccount,
    kevin_target: { rows: 576, spend: 52577 },
  },
  d2_pattern_candidates: Object.fromEntries(Object.entries(d2CandidatesByPattern).map(([k,v]) => [k, { total: v.total, unresolved_core: v.unresolved_core, top_shapes: [...v.by_shape.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10) }])),
  d3_estimate_hits: Object.fromEntries(Object.entries(d3Hits).map(([k,v]) => [k, { rows: v.rows, spend: Math.round(v.spend*100)/100, sample: v.sample }])),
  d4_egg_spend_by_account: eggByAccountByCat,
  d4_false_positive_audit: Object.fromEntries(Object.entries(falsePositiveWatch).map(([k,v]) => [k, { count: v.length, sample: [...new Set(v)].slice(0, 5) }])),
}, null, 2));
console.log(`\nwrote ${OUT}`);
