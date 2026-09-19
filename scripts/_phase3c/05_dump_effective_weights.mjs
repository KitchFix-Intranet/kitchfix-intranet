// Phase 3c helper - dump AUG rows with _effective_weight_lb populated,
// applying the same rehab logic as scripts_phase3b/20_recompute.mjs.
// This is READ-ONLY: no re-classification, no threshold tuning. Purpose is
// solely to make augmented+rehabbed rows available to the Phase 3c
// diagnosis + suppression pipeline without re-running the full recompute.
//
// Output: scripts_phase3c/_rehabbed_rows.json (rows[] with _basis,
// _effective_weight_lb, _weight_method_final, _rehab_source).

import fs from "node:fs";
import { P, ACCOUNTS, assignBasis } from "./_common3b.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));

// Assign basis (Fix 4 mapping) - byte-identical to Phase 3b step 1
for (const r of AUG.rows) {
  r._basis = assignBasis(r);
}

// Category-plausibility bounds - byte-identical to Phase 3b
const CATEGORY_LB_BOUNDS = {
  protein: [5, 150],
  poultry: [5, 100],
  meat: [5, 150],
  seafood: [3, 100],
  dairy: [3, 80],
  produce: [3, 100],
  dry_goods: [1, 200],
  grocery: [1, 200],
  frozen: [3, 100],
};
const CATEGORY_DPLB_BOUNDS = {
  protein: [1, 30],
  poultry: [1, 15],
  meat: [1, 30],
  seafood: [2, 60],
  dairy: [0.5, 25],
  produce: [0.3, 20],
  dry_goods: [0.2, 40],
  grocery: [0.2, 40],
  frozen: [1, 40],
};

const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);

// Build sibling index for Candidate A
const siblingIndex = new Map();
for (const r of AUG.rows) {
  if (!r.vendor_id || !r.item_number) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const q = Number(r.qty_used);
  const lb = Number(r.parsed_weight_lb);
  if (!q || !lb) continue;
  const key = r.vendor_id + "::" + r.item_number;
  if (!siblingIndex.has(key)) siblingIndex.set(key, []);
  siblingIndex.get(key).push(lb / q);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

for (const r of AUG.rows) {
  r._rehab_source = null;
  r._rehab_weight_lb = null;
}

// Candidate A
for (const r of AUG.rows) {
  if (r.parsed_weight_source !== "pack_size_ambiguous_multipack") continue;
  if (!r.vendor_id || !r.item_number) continue;
  const key = r.vendor_id + "::" + r.item_number;
  const sibs = siblingIndex.get(key);
  if (!sibs || sibs.length === 0) continue;
  const medLbPerQty = median(sibs);
  const q = Number(r.qty_used) || 1;
  const bounds = CATEGORY_LB_BOUNDS[r.category] || [1, 500];
  if (medLbPerQty < bounds[0] || medLbPerQty > bounds[1]) continue;
  r._rehab_source = "candidate_a_sibling";
  r._rehab_weight_lb = medLbPerQty * q;
}

// Candidate B
for (const r of AUG.rows) {
  if (r.review_reason !== "ep_qty_up_mismatch") continue;
  if (r._rehab_source) continue;
  const wlv = Number(r.weight_line_value);
  if (!Number.isFinite(wlv) || wlv <= 0) continue;
  const ep = Number(r.extended_price);
  if (!ep || ep <= 0) continue;
  const dpp = ep / wlv;
  const bounds = CATEGORY_DPLB_BOUNDS[r.category] || [0.05, 100];
  if (dpp < bounds[0] || dpp > bounds[1]) continue;
  r._rehab_source = "candidate_b_wlv";
  r._rehab_weight_lb = wlv;
}

// Effective weight
for (const r of AUG.rows) {
  if (r._rehab_weight_lb != null) {
    r._effective_weight_lb = r._rehab_weight_lb;
    r._weight_method_final = r._rehab_source;
  } else {
    r._effective_weight_lb = r.parsed_weight_lb;
    r._weight_method_final = r.parsed_weight_source;
  }
}

// Sanity gate
let sanityDropped = 0;
for (const r of AUG.rows) {
  if (r._effective_weight_lb == null || r._effective_weight_lb <= 0) continue;
  const ep = Number(r.extended_price);
  if (!ep || ep <= 0) continue;
  const implDpp = ep / r._effective_weight_lb;
  const bounds = CATEGORY_DPLB_BOUNDS[r.category];
  if (!bounds) continue;
  if (implDpp < bounds[0] * 0.5 || implDpp > bounds[1] * 2) {
    r._effective_weight_lb = null;
    r._weight_method_final = "sanity_gated_out_of_bounds";
    sanityDropped += 1;
  }
}

// Write minimal projection - only rows in DOLLAR SET, food-basis, with rehab fields
const inDollar = (r) => r.review_reason !== "invoice_over_extracted";
const out = AUG.rows.filter((r) => inDollar(r)).map((r) => ({
  id: r.id,
  account_label: r.account_label,
  invoice_date: r.invoice_date,
  month: r.month,
  vendor_id: r.vendor_id,
  vendor_name: r.vendor_name,
  description: r.description,
  item_number: r.item_number,
  category: r.category,
  quantity: r.quantity,
  qty_used: r.qty_used,
  unit_price: r.unit_price,
  extended_price: r.extended_price,
  pack_size: r.pack_size,
  weight_line_value: r.weight_line_value,
  parsed_weight_lb: r.parsed_weight_lb,
  parsed_weight_source: r.parsed_weight_source,
  review_reason: r.review_reason,
  _basis: r._basis,
  _rehab_source: r._rehab_source,
  _rehab_weight_lb: r._rehab_weight_lb,
  _effective_weight_lb: r._effective_weight_lb,
  _weight_method_final: r._weight_method_final,
}));

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json";
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`[3c-dump] wrote ${out.length} rows to ${OUT} (sanity-dropped ${sanityDropped})`);
