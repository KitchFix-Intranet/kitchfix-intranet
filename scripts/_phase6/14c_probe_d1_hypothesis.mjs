// D1 hypothesis probe: Kevin says "CB and GFS leave item_number null, so their rows never
// match". His 576/$52,577 might specifically be:
//  (a) unresolved core rows on vendors CB/GFS/generally where item_number is null
//  (b) with a same-desc sibling elsewhere in the dataset
// Or it could be measuring ALL rows (not just currently-unresolved-after-v6b) where
// item_number is null but description exists in a same-vendor sibling.

import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json", "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));

const rows = AUG.rows;
const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, { lb: Number(r._effective_weight_lb) });
}
const catchReclassIdsAll = new Set([...(REC5.catch_weight_reclassified_ids || [])]);
const invoiceLbArithIds = new Set();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const unit = String(r.unit || "").toLowerCase(); if (unit !== "lb") continue;
  const qty = Number(r.quantity); const up = Number(r.unit_price); const ep = Number(r.extended_price);
  if (!qty || !up || !ep || qty <= 0) continue;
  const calc = qty * up; const tol = Math.max(1, 0.02 * ep);
  if (Math.abs(calc - ep) > tol) continue;
  invoiceLbArithIds.add(r.id);
}

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

// H1: All rows unresolved BEFORE the item_number catalog fires + item_number is null + description matches a sibling
// H2: All rows in dollar-set (not just unresolved) where item_number is null but description matches a sibling
// H3: Cheney/GFS only

const cbGfsIds = new Set();
let cbGfsSample = [];
const vendorNameCounts = {};
for (const r of rows) {
  const vn = String(r.vendor_name || "").toUpperCase();
  vendorNameCounts[vn] = (vendorNameCounts[vn] || 0) + 1;
  if (/CHENEY|GORDON\s*FOOD|GFS/.test(vn)) {
    cbGfsIds.add(r.id);
    if (cbGfsSample.length < 3) cbGfsSample.push(vn);
  }
}
console.log(`CB/GFS rows: ${cbGfsIds.size}  sample vendor names:`, cbGfsSample);

// How many rows have item_number null?
let nullItemNumTotal = 0;
let nullItemNumCore = 0;
let nullItemNumCoreUnresolved = 0;
let nullItemNumCoreUnresolvedCbGfs = 0;
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (!r.item_number) {
    nullItemNumTotal++;
    if (isCoreFoodCat(r.category)) {
      nullItemNumCore++;
      const el = currentEffLb(r);
      if (!el || el <= 0) {
        nullItemNumCoreUnresolved++;
        if (cbGfsIds.has(r.id)) nullItemNumCoreUnresolvedCbGfs++;
      }
    }
  }
}
console.log(`item_number null: total=${nullItemNumTotal} core=${nullItemNumCore} core+unresolved=${nullItemNumCoreUnresolved} core+unresolved+CB/GFS=${nullItemNumCoreUnresolvedCbGfs}`);

// Now: from these null-item_num unresolved rows, how many have a sibling with SAME description that DID resolve?
// This directly tests Kevin's hypothesis - his 576 might be all these rows.

// Build catalog from resolved rows keyed on vendor::desc
const catalog = new Map();
const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight", "pack_size:single_weight", "weight_line_value",
  "catalog_lookup:n_x_m_weight", "catalog_lookup:single_weight",
  "description:n_x_m_weight", "description:single_weight",
]);
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc || !r.vendor_id) continue;
  let perCase = null;
  // Try any layer that produced weight
  const el = currentEffLb(r);
  if (el && el > 0) {
    const q = Number(r.qty_used) || Number(r.quantity);
    if (q > 0) perCase = el / q;
  }
  if (perCase == null || !Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!catalog.has(key)) catalog.set(key, { lb_per_case: perCase, seed_rows: 1 });
  else catalog.get(key).seed_rows += 1;
}

const hits = [];
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (!isCoreFoodCat(r.category)) continue;
  const el = currentEffLb(r);
  if (el && el > 0) continue;
  // Match a sibling
  const desc = String(r.description_norm || "").trim();
  if (!desc || !r.vendor_id) continue;
  const key = `${r.vendor_id}::${desc}`;
  const c = catalog.get(key);
  if (!c) continue;
  const q = Number(r.qty_used) || Number(r.quantity);
  if (!q || q <= 0) continue;
  hits.push({ id: r.id, ep: Number(r.extended_price) || 0, acct: String(r.account_label || "").replace(" - ", "-") });
}
const acctSums = { "TBR-FL": {rows:0,spend:0}, "TBJ-FL": {rows:0,spend:0}, "STL-FL": {rows:0,spend:0} };
for (const h of hits) { if (acctSums[h.acct]) { acctSums[h.acct].rows++; acctSums[h.acct].spend += h.ep; } }
for (const a of Object.keys(acctSums)) acctSums[a].spend = Math.round(acctSums[a].spend*100)/100;
console.log(`\nH1: all-layers as seeds, all unresolved core:`);
console.log(`  hits=${hits.length}  total_spend=$${(acctSums["TBR-FL"].spend+acctSums["TBJ-FL"].spend+acctSums["STL-FL"].spend).toFixed(2)}`);
for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) console.log(`     ${a}: ${acctSums[a].rows} rows / $${acctSums[a].spend}`);

// Maybe Kevin measured against the FULL dollar-set (not restricted to currently-unresolved)?
// i.e. every core-food row that could match a description-sibling, regardless of whether it's already resolved
const allHits = [];
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (!isCoreFoodCat(r.category)) continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc || !r.vendor_id) continue;
  const key = `${r.vendor_id}::${desc}`;
  const c = catalog.get(key);
  if (!c) continue;
  const q = Number(r.qty_used) || Number(r.quantity);
  if (!q || q <= 0) continue;
  allHits.push({ id: r.id, ep: Number(r.extended_price) || 0, acct: String(r.account_label || "").replace(" - ", "-") });
}
console.log(`\nH2: all-layers as seeds, ALL core rows (not just unresolved):`);
console.log(`  hits=${allHits.length}`);

// Let me also try: catalog seeded from CLEAN_METHODS only, checking ALL core rows (not just unresolved)
const catalogClean = new Map();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc || !r.vendor_id) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  const pw = Number(r.parsed_weight_lb);
  const q = Number(r.qty_used);
  if (!Number.isFinite(pw) || pw <= 0) continue;
  if (!Number.isFinite(q) || q <= 0) continue;
  const perCase = pw / q;
  if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!catalogClean.has(key)) catalogClean.set(key, { lb_per_case: perCase });
}
// Count total dollar-set rows where description matches (irrespective of current resolution)
const catchAll = { rows: 0, spend: 0, byAcct: { "TBR-FL":{rows:0,spend:0}, "TBJ-FL":{rows:0,spend:0}, "STL-FL":{rows:0,spend:0} } };
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (!isCoreFoodCat(r.category)) continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc || !r.vendor_id) continue;
  const key = `${r.vendor_id}::${desc}`;
  if (!catalogClean.has(key)) continue;
  catchAll.rows++;
  catchAll.spend += Number(r.extended_price) || 0;
  const acct = String(r.account_label || "").replace(" - ", "-");
  if (catchAll.byAcct[acct]) { catchAll.byAcct[acct].rows++; catchAll.byAcct[acct].spend += Number(r.extended_price) || 0; }
}
console.log(`\nH3: catalog seeded CLEAN only + ALL core-food rows with a match (not just unresolved):`);
console.log(`  hits=${catchAll.rows}  spend=$${catchAll.spend.toFixed(2)}`);
for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) console.log(`     ${a}: ${catchAll.byAcct[a].rows} rows / $${Math.round(catchAll.byAcct[a].spend*100)/100}`);

// H4: no vendor filter - just description
const catalogDescOnly = new Map();
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  const pw = Number(r.parsed_weight_lb);
  const q = Number(r.qty_used);
  if (!Number.isFinite(pw) || pw <= 0 || !Number.isFinite(q) || q <= 0) continue;
  const perCase = pw / q;
  if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;
  if (!catalogDescOnly.has(desc)) catalogDescOnly.set(desc, { lb_per_case: perCase });
}
// Measure against unresolved core
let h4hits = { rows: 0, spend: 0, byAcct: { "TBR-FL":{rows:0,spend:0}, "TBJ-FL":{rows:0,spend:0}, "STL-FL":{rows:0,spend:0} } };
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id) && !invoiceLbArithIds.has(r.id)) continue;
  if (!isCoreFoodCat(r.category)) continue;
  const el = currentEffLb(r);
  if (el && el > 0) continue;
  const desc = String(r.description_norm || "").trim();
  if (!desc) continue;
  if (!catalogDescOnly.has(desc)) continue;
  h4hits.rows++;
  h4hits.spend += Number(r.extended_price) || 0;
  const acct = String(r.account_label || "").replace(" - ", "-");
  if (h4hits.byAcct[acct]) { h4hits.byAcct[acct].rows++; h4hits.byAcct[acct].spend += Number(r.extended_price) || 0; }
}
console.log(`\nH4: catalog description-only (no vendor), CLEAN seeds, unresolved core targets:`);
console.log(`  hits=${h4hits.rows}  spend=$${h4hits.spend.toFixed(2)}`);
for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) console.log(`     ${a}: ${h4hits.byAcct[a].rows} rows / $${Math.round(h4hits.byAcct[a].spend*100)/100}`);

console.log(`\nKevin target: 576 rows / $52,577 (TBR $14,342; TBJ $20,189; STL $18,047)`);
