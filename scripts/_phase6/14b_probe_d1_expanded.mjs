// D1 expanded probe: try broader seed sources to reach Kevin's 576/$52,577 target.
// Test variations:
//   A. CLEAN_METHODS only (current probe): 274 hits
//   B. CLEAN_METHODS + p5 + p4 + rehab_3c + catch + invoice_lb_arith
//   C. Same as B but include p4 recovered rows as seeds
//   D. B, plus description-only (no vendor) fallback
//   E. B, plus normalized-description that strips trailing tokens (item numbers, size)

import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json", "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

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

function isCoreFoodCat(cat) {
  return ["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(String(cat || "").toLowerCase());
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

const unresolvedCore = [];
for (const r of rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id) && !invoiceLbArithIds.has(r.id)) continue;
  if (!isCoreFoodCat(r.category)) continue;
  const el = currentEffLb(r);
  if (el && el > 0) continue;
  unresolvedCore.push(r);
}

console.log(`unresolved core rows: ${unresolvedCore.length}`);

// Build multiple catalogs and measure
function buildCatalog(strategy) {
  // strategy: { includeP5, includeP4, includeRehab, includeCatch, includeInvArith, includeBase, key: "vendor_desc"|"desc_only" }
  const cat = new Map();
  for (const r of rows) {
    if (r.review_reason === "invoice_over_extracted") continue;
    if (r.review_reason === "ep_qty_up_mismatch") continue;
    const desc = String(r.description_norm || "").trim();
    if (!desc) continue;
    if (strategy.key === "vendor_desc" && !r.vendor_id) continue;

    let perCase = null;
    // Try each layer that's enabled
    if (strategy.includeBase && CLEAN_METHODS.has(r.parsed_weight_source)) {
      const pw = Number(r.parsed_weight_lb);
      const q = Number(r.qty_used);
      if (Number.isFinite(pw) && pw > 0 && Number.isFinite(q) && q > 0) perCase = pw / q;
    }
    if (perCase == null && strategy.includeP5) {
      const p5 = p5RecById.get(r.id);
      if (p5) {
        const q = Number(r.qty_used) || Number(r.quantity);
        if (q > 0) perCase = p5.effective_weight_lb / q;
      }
    }
    if (perCase == null && strategy.includeP4) {
      const p4 = p4RecById.get(r.id);
      if (p4) {
        const q = Number(r.qty_used) || Number(r.quantity);
        if (q > 0) perCase = p4.effective_weight_lb / q;
      }
    }
    if (perCase == null && strategy.includeRehab) {
      const r3c = rehab3cById.get(r.id);
      if (r3c && r3c.lb > 0) {
        const q = Number(r.qty_used) || Number(r.quantity);
        if (q > 0) perCase = r3c.lb / q;
      }
    }
    if (perCase == null && strategy.includeCatch && catchReclassIdsAll.has(r.id)) {
      const up = Number(r.unit_price); const ep = Number(r.extended_price);
      if (up && ep) { const impl = ep / up; if (impl > 0 && impl <= 5000) {
        const q = Number(r.qty_used) || Number(r.quantity);
        if (q > 0) perCase = impl / q;
      } }
    }
    if (perCase == null && strategy.includeInvArith && invoiceLbArithIds.has(r.id)) {
      const q = Number(r.quantity);
      if (q > 0) perCase = 1; // invoice_lb: weight = qty, so per unit qty = 1 lb - not a case weight!
    }
    if (perCase == null) continue;
    if (!Number.isFinite(perCase) || perCase <= 0 || perCase > 500) continue;

    const key = strategy.key === "vendor_desc" ? `${r.vendor_id}::${desc}` : desc;
    if (!cat.has(key)) cat.set(key, { lb_per_case: perCase, seed_rows: 1 });
    else cat.get(key).seed_rows += 1;
  }
  return cat;
}

function measure(cat, keyMode) {
  const hits = [];
  const seenIds = new Set();
  for (const r of unresolvedCore) {
    const desc = String(r.description_norm || "").trim();
    if (!desc) continue;
    if (keyMode === "vendor_desc" && !r.vendor_id) continue;
    const key = keyMode === "vendor_desc" ? `${r.vendor_id}::${desc}` : desc;
    const c = cat.get(key);
    if (!c) continue;
    const q = Number(r.qty_used) || Number(r.quantity);
    if (!q || q <= 0) continue;
    const lb = q * c.lb_per_case;
    hits.push({ id: r.id, ep: Number(r.extended_price) || 0, lb, acct: String(r.account_label || "").replace(" - ", "-") });
  }
  const byAcct = { "TBR-FL": { rows: 0, spend: 0 }, "TBJ-FL": { rows: 0, spend: 0 }, "STL-FL": { rows: 0, spend: 0 } };
  for (const h of hits) { if (byAcct[h.acct]) { byAcct[h.acct].rows++; byAcct[h.acct].spend += h.ep; } }
  for (const a of Object.keys(byAcct)) byAcct[a].spend = Math.round(byAcct[a].spend * 100) / 100;
  return { total: hits.length, byAcct, catalog_size: cat.size };
}

const strategies = [
  { name: "A. CLEAN only, vendor_desc key",
    conf: { includeBase: true, key: "vendor_desc" } },
  { name: "B. CLEAN + p5, vendor_desc key",
    conf: { includeBase: true, includeP5: true, key: "vendor_desc" } },
  { name: "C. CLEAN + p5 + p4, vendor_desc key",
    conf: { includeBase: true, includeP5: true, includeP4: true, key: "vendor_desc" } },
  { name: "D. CLEAN + p5 + p4 + rehab, vendor_desc key",
    conf: { includeBase: true, includeP5: true, includeP4: true, includeRehab: true, key: "vendor_desc" } },
  { name: "E. CLEAN + p5 + p4 + rehab + catch, vendor_desc key",
    conf: { includeBase: true, includeP5: true, includeP4: true, includeRehab: true, includeCatch: true, key: "vendor_desc" } },
  { name: "F. CLEAN only, desc_only key",
    conf: { includeBase: true, key: "desc_only" } },
  { name: "G. All layers, desc_only key",
    conf: { includeBase: true, includeP5: true, includeP4: true, includeRehab: true, includeCatch: true, key: "desc_only" } },
];

for (const s of strategies) {
  const cat = buildCatalog(s.conf);
  const m = measure(cat, s.conf.key);
  console.log(`\n${s.name}:`);
  console.log(`  catalog=${m.catalog_size}  hits=${m.total}  spend=$${m.byAcct["TBR-FL"].spend + m.byAcct["TBJ-FL"].spend + m.byAcct["STL-FL"].spend}`);
  for (const a of ["TBR-FL","TBJ-FL","STL-FL"]) console.log(`     ${a}: ${m.byAcct[a].rows} rows / $${m.byAcct[a].spend}`);
}
console.log(`\nKevin target: 576 rows / $52,577 (TBR $14,342; TBJ $20,189; STL $18,047)`);
