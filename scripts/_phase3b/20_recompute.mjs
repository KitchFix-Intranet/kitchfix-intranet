// Phase 3b main recompute. Reads Phase 3 caches, applies fixes 2-6 + scrub
// findings, writes _analysis3b.json for the workbook builder.
//
// Read-only on all DB tables. Reads:
//   scripts_phase3/_augmented.json
//   scripts_phase3/_meals.json
//   item_classifications.json (already patched by 10_reclassify_beverages.mjs)
//
// Writes:
//   scripts_phase3b/_analysis3b.json

import fs from "node:fs";
import {
  P,
  ACCOUNTS,
  MONTHS,
  CONFIDENCE_THRESHOLD,
  sumBy,
  round1,
  round2,
  pct1,
  loadAll,
  assignBasis,
  isConsumerBeverage,
  assignProteinType,
  assignFamily,
} from "./_common3b.mjs";

const { AUG, MEALS, CLS } = loadAll();

// ============================================================================
// STEP 1: apply Fix 4 (category basis) + Fix 1 (beverage separation) to rows.
// ============================================================================

for (const r of AUG.rows) {
  r._basis = assignBasis(r); // "food" | "beverage" | "non_food" | "unknown"
}

// ============================================================================
// STEP 2: apply Fix 5 (TBR-FL protein rehab) - Candidates A + B, gated.
// ============================================================================
//
// Candidate A: pack_size_ambiguous_multipack rows where the same
//   (vendor_id, item_number) SKU appears elsewhere in the dataset with a
//   clean parsed_weight. Use the sibling's lb-per-qty to compute the
//   ambiguous row's weight. Sanity-gate: expected LB/case must fall in
//   category-plausibility bounds (protein: 5-150 lb/case; produce: 5-100;
//   dairy: 3-80; dry_goods: 5-200).
//
// Candidate B: ep_qty_up_mismatch rows that have weight_line_value (vendor's
//   printed catch weight). The EP-vs-UP*Q mismatch is a catch-weight artifact
//   (unit_price is per-lb, quantity is per-case, extended_price is total-$).
//   The weight_line_value is the vendor's printed pounds shipped -
//   trustworthy. Sanity gate: implied $/lb from EP/wlv must be in category
//   plausibility bounds (protein: $1-25/lb; produce: $0.5-15/lb; dairy:
//   $0.5-15/lb; dry_goods: $0.3-30/lb; seafood: $2-40/lb).
//

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

// Build sibling index: (vendor_id, item_number) -> median lb-per-qty from clean rows
const CLEAN_METHODS = new Set([
  "pack_size:n_x_m_weight",
  "pack_size:single_weight",
  "weight_line_value",
  "catalog_lookup:n_x_m_weight",
  "catalog_lookup:single_weight",
  "description:n_x_m_weight",
  "description:single_weight",
]);
const siblingIndex = new Map();
for (const r of AUG.rows) {
  if (!r.vendor_id || !r.item_number) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue; // only clean-no-flag rows seed
  const q = Number(r.qty_used);
  const lb = Number(r.parsed_weight_lb);
  if (!q || !lb) continue;
  const key = r.vendor_id + "::" + r.item_number;
  if (!siblingIndex.has(key)) siblingIndex.set(key, []);
  siblingIndex.get(key).push(lb / q);
}

// Also build $/lb sibling index for Candidate B category-plausibility check.
// Not currently used as a gate, but computed for diagnostics.
const dppSiblingIndex = new Map();
for (const r of AUG.rows) {
  if (!r.vendor_id || !r.item_number) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const lb = Number(r.parsed_weight_lb);
  const ep = Number(r.extended_price);
  if (!lb || !ep || lb <= 0) continue;
  const key = r.vendor_id + "::" + r.item_number;
  if (!dppSiblingIndex.has(key)) dppSiblingIndex.set(key, []);
  dppSiblingIndex.get(key).push(ep / lb);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// Diagnosis stats
const diag = {
  candidate_a: { attempted: 0, applied: 0, bounds_rejected: 0, no_sibling: 0, by_account: {} },
  candidate_b: { attempted: 0, applied: 0, bounds_rejected: 0, no_wlv: 0, by_account: {} },
};
for (const a of ACCOUNTS) {
  diag.candidate_a.by_account[a] = { applied: 0, spend: 0, rejected: 0 };
  diag.candidate_b.by_account[a] = { applied: 0, spend: 0, rejected: 0 };
}

// Apply candidates. Do NOT overwrite parsed_weight_lb - use new fields so we
// can trace which method produced the weight.
for (const r of AUG.rows) {
  r._rehab_source = null;
  r._rehab_weight_lb = null;
}

// Candidate A - amb multipack + sibling
for (const r of AUG.rows) {
  if (r.parsed_weight_source !== "pack_size_ambiguous_multipack") continue;
  diag.candidate_a.attempted += 1;
  if (!r.vendor_id || !r.item_number) {
    diag.candidate_a.no_sibling += 1;
    continue;
  }
  const key = r.vendor_id + "::" + r.item_number;
  const sibs = siblingIndex.get(key);
  if (!sibs || sibs.length === 0) {
    diag.candidate_a.no_sibling += 1;
    continue;
  }
  const medLbPerQty = median(sibs);
  const q = Number(r.qty_used) || 1;
  const expectedLb = medLbPerQty * q;
  // Category-plausibility check on lb/case (medLbPerQty, not total)
  const bounds = CATEGORY_LB_BOUNDS[r.category] || [1, 500];
  if (medLbPerQty < bounds[0] || medLbPerQty > bounds[1]) {
    diag.candidate_a.bounds_rejected += 1;
    if (r.account_label) diag.candidate_a.by_account[r.account_label].rejected += 1;
    continue;
  }
  r._rehab_source = "candidate_a_sibling";
  r._rehab_weight_lb = expectedLb;
  diag.candidate_a.applied += 1;
  if (r.account_label) {
    diag.candidate_a.by_account[r.account_label].applied += 1;
    diag.candidate_a.by_account[r.account_label].spend += Number(r.extended_price) || 0;
  }
}

// Candidate B - ep_qty_up_mismatch + weight_line_value
for (const r of AUG.rows) {
  if (r.review_reason !== "ep_qty_up_mismatch") continue;
  if (r._rehab_source) continue; // already rehabbed
  diag.candidate_b.attempted += 1;
  const wlv = Number(r.weight_line_value);
  if (!Number.isFinite(wlv) || wlv <= 0) {
    diag.candidate_b.no_wlv += 1;
    continue;
  }
  const ep = Number(r.extended_price);
  if (!ep || ep <= 0) {
    diag.candidate_b.no_wlv += 1;
    continue;
  }
  const dpp = ep / wlv;
  const bounds = CATEGORY_DPLB_BOUNDS[r.category] || [0.05, 100];
  if (dpp < bounds[0] || dpp > bounds[1]) {
    diag.candidate_b.bounds_rejected += 1;
    if (r.account_label) diag.candidate_b.by_account[r.account_label].rejected += 1;
    continue;
  }
  r._rehab_source = "candidate_b_wlv";
  r._rehab_weight_lb = wlv;
  diag.candidate_b.applied += 1;
  if (r.account_label) {
    diag.candidate_b.by_account[r.account_label].applied += 1;
    diag.candidate_b.by_account[r.account_label].spend += Number(r.extended_price) || 0;
  }
}

// Effective weight used for WEIGHT SET analysis
for (const r of AUG.rows) {
  if (r._rehab_weight_lb != null) {
    r._effective_weight_lb = r._rehab_weight_lb;
    r._weight_method_final = r._rehab_source;
  } else {
    r._effective_weight_lb = r.parsed_weight_lb;
    r._weight_method_final = r.parsed_weight_source;
  }
}

// Additional Phase 3b sanity gate: suppress rows where the implied $/lb is
// outside category plausibility bounds. Catches cases like a catch-weight line
// where `shipped_count` is actually the shipped weight (in lb) not the case
// count - the parser then multiplies weight-lb by pack_size-lb-per-case and
// produces a nonsense 5,000+ lb figure. Documented separately in Needs Review.
let sanityDropped = 0;
let sanityDroppedSpend = 0;
const sanityDropRows = [];
for (const r of AUG.rows) {
  if (r._effective_weight_lb == null || r._effective_weight_lb <= 0) continue;
  const ep = Number(r.extended_price);
  if (!ep || ep <= 0) continue;
  const implDpp = ep / r._effective_weight_lb;
  const bounds = CATEGORY_DPLB_BOUNDS[r.category];
  if (!bounds) continue; // no category bounds -> pass through
  if (implDpp < bounds[0] * 0.5 || implDpp > bounds[1] * 2) {
    // Suspicious. Drop from WEIGHT SET (do NOT clobber DOLLAR SET).
    sanityDropRows.push({
      account: r.account_label,
      description: r.description,
      category: r.category,
      pack_size: r.pack_size,
      qty_used: r.qty_used,
      extended_price: ep,
      effective_weight_lb: r._effective_weight_lb,
      implied_dpp: round2(implDpp),
      bounds: bounds,
      method: r._weight_method_final,
    });
    r._effective_weight_lb = null;
    r._weight_method_final = "sanity_gated_out_of_bounds";
    sanityDropped += 1;
    sanityDroppedSpend += ep;
  }
}
console.log(`[3b-sanity] dropped ${sanityDropped} rows from WEIGHT SET (${round2(sanityDroppedSpend)}) - implied $/lb out of category bounds`);

// Decision gate: did TBR protein coverage clear ~25%?
const tbrProtDollar = AUG.rows.filter(
  (r) => r.account_label === "TBR-FL" && r.category === "protein" && r._basis !== "non_food" && r.review_reason !== "invoice_over_extracted"
);
const tbrProtDollarSpend = sumBy(tbrProtDollar, (r) => r.extended_price);
// Weight set (post-rehab): rows with effective weight AND not in dollar-set-exclusion
const tbrProtWeightPost = tbrProtDollar.filter((r) => r._effective_weight_lb != null && r._effective_weight_lb > 0);
const tbrProtWeightSpend = sumBy(tbrProtWeightPost, (r) => r.extended_price);
const tbrProtWeightPostCovRows = tbrProtWeightPost.length / tbrProtDollar.length;
const tbrProtWeightPostCovSpend = tbrProtWeightSpend / (tbrProtDollarSpend || 1);
const tbrProtRehabPasses = tbrProtWeightPostCovRows >= 0.25 || tbrProtWeightPostCovSpend >= 0.25;

const fix5Result = {
  tbr_protein_dollar_set_rows: tbrProtDollar.length,
  tbr_protein_dollar_set_spend: round2(tbrProtDollarSpend),
  tbr_protein_weight_set_rows_pre: AUG.rows.filter((r) => r.account_label === "TBR-FL" && r.category === "protein" && r.parsed_weight_lb != null && r.review_reason !== "invoice_over_extracted" && r.review_reason !== "ep_qty_up_mismatch" && r.parsed_weight_source !== "pack_size_ambiguous_multipack" && !["unresolved", "volume_excluded"].includes(r.parsed_weight_source)).length,
  tbr_protein_weight_set_rows_post: tbrProtWeightPost.length,
  tbr_protein_weight_set_coverage_rows_pct: round2(tbrProtWeightPostCovRows * 100),
  tbr_protein_weight_set_coverage_spend_pct: round2(tbrProtWeightPostCovSpend * 100),
  tbr_protein_rehab_gate_passed: tbrProtRehabPasses,
  rehab_applied: tbrProtRehabPasses,
  diagnosis: diag,
  decision_note: tbrProtRehabPasses
    ? "Rehab APPLIED. Both candidates cleared 25% coverage threshold. TBR protein $/lb now reportable."
    : "Rehab HELD. Neither candidate cleared threshold. TBR protein $/lb marked UNREPORTABLE.",
};

// ============================================================================
// STEP 3: WEIGHT SET filter (Phase 3b, post-rehab).
// ============================================================================

function inDollar(r) {
  return r.review_reason !== "invoice_over_extracted";
}
function inWeightPhase3b(r) {
  if (r.review_reason === "invoice_over_extracted") return false;
  // Post-rehab: if row has an effective weight (from parser OR rehab), it counts.
  if (r._effective_weight_lb == null || r._effective_weight_lb <= 0) return false;
  // Preserve volume_excluded suppression
  if (r.parsed_weight_source === "volume_excluded") return false;
  return true;
}

// ============================================================================
// STEP 4: per-account spend rollups (Fix 4 + Fix 1)
// ============================================================================

const perAccount = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows.filter((r) => r.account_label === acct);
  const dollar = rows.filter(inDollar);
  const food_all = dollar.filter((r) => r._basis === "food" || r._basis === "beverage"); // food including beverages
  const core_food = dollar.filter((r) => r._basis === "food"); // core food (excl beverage)
  const beverage = dollar.filter((r) => r._basis === "beverage");
  const nonfood = dollar.filter((r) => r._basis === "non_food");
  const unknown = dollar.filter((r) => r._basis === "unknown");

  const byMonth = {};
  for (const m of MONTHS) {
    const dm = dollar.filter((r) => r.month === m);
    byMonth[m] = {
      total_rows: dm.length,
      total_spend: round2(sumBy(dm, (r) => r.extended_price)),
      food_spend: round2(sumBy(dm.filter((r) => r._basis === "food" || r._basis === "beverage"), (r) => r.extended_price)),
      core_food_spend: round2(sumBy(dm.filter((r) => r._basis === "food"), (r) => r.extended_price)),
      beverage_spend: round2(sumBy(dm.filter((r) => r._basis === "beverage"), (r) => r.extended_price)),
      non_food_spend: round2(sumBy(dm.filter((r) => r._basis === "non_food"), (r) => r.extended_price)),
      unknown_spend: round2(sumBy(dm.filter((r) => r._basis === "unknown"), (r) => r.extended_price)),
    };
  }

  perAccount[acct] = {
    account: acct,
    dollar_all_rows: dollar.length,
    dollar_total_spend: round2(sumBy(dollar, (r) => r.extended_price)),
    dollar_food_spend: round2(sumBy(food_all, (r) => r.extended_price)),
    dollar_core_food_spend: round2(sumBy(core_food, (r) => r.extended_price)),
    dollar_beverage_spend: round2(sumBy(beverage, (r) => r.extended_price)),
    dollar_nonfood_spend: round2(sumBy(nonfood, (r) => r.extended_price)),
    dollar_unknown_spend: round2(sumBy(unknown, (r) => r.extended_price)),
    dollar_food_pct: pct1(sumBy(food_all, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_core_food_pct: pct1(sumBy(core_food, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_beverage_pct: pct1(sumBy(beverage, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_nonfood_pct: pct1(sumBy(nonfood, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_unknown_pct: pct1(sumBy(unknown, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    by_month: byMonth,
    // Category share of core_food $ - Fix 1 additive.
    category_mix_core_food: computeCategoryMix(core_food),
    // Category share of food $ (includes beverage) - reference.
    category_mix_food: computeCategoryMix(food_all),
    // Categories total (all rows, for the category-totals sheet)
    by_category_all: computeCategoryBreakdownAll(dollar),
    top_vendors: computeTopVendors(dollar, 10),
    top_items_by_spend: computeTopItems(dollar, "spend", 25),
    top_items_by_frequency: computeTopItems(dollar, "frequency", 25),
    recurring_items: computeRecurringItems(core_food),
  };
}

function computeCategoryMix(rows) {
  const cats = {};
  for (const r of rows) {
    const c = r.category || "(uncategorized)";
    if (!cats[c]) cats[c] = { rows: 0, spend: 0 };
    cats[c].rows += 1;
    cats[c].spend += Number(r.extended_price) || 0;
  }
  const total = Object.values(cats).reduce((s, x) => s + x.spend, 0);
  return Object.entries(cats)
    .map(([category, v]) => ({
      category,
      rows: v.rows,
      spend: round2(v.spend),
      pct_of_scope: pct1(v.spend, total),
    }))
    .sort((a, b) => b.spend - a.spend);
}
function computeCategoryBreakdownAll(rows) {
  return computeCategoryMix(rows);
}
function computeTopVendors(rows, n) {
  const v = {};
  for (const r of rows) {
    const key = r.vendor_name || "(no vendor)";
    if (!v[key]) v[key] = { spend: 0, rows: 0, vendor_id: r.vendor_id };
    v[key].spend += Number(r.extended_price) || 0;
    v[key].rows += 1;
  }
  const total = Object.values(v).reduce((s, x) => s + x.spend, 0);
  return Object.entries(v)
    .map(([name, obj]) => ({ vendor: name, vendor_id: obj.vendor_id, spend: round2(obj.spend), rows: obj.rows, pct: pct1(obj.spend, total) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, n);
}
function computeTopItems(rows, mode, n) {
  const m = {};
  for (const r of rows) {
    const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
    if (!m[key]) m[key] = { description: r.description, vendor_id: r.vendor_id, vendor_name: r.vendor_name, category: r.category, spend: 0, rows: 0, qty: 0, unit: r.unit };
    m[key].spend += Number(r.extended_price) || 0;
    m[key].rows += 1;
    m[key].qty += Number(r.qty_used) || 0;
  }
  const arr = Object.values(m).map((x) => ({ ...x, spend: round2(x.spend), qty: round2(x.qty) }));
  arr.sort((a, b) => (mode === "spend" ? b.spend - a.spend : b.rows - a.rows));
  return arr.slice(0, n);
}
function computeRecurringItems(rows) {
  const m = {};
  for (const r of rows) {
    const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
    if (!m[key]) m[key] = { description: r.description, vendor_id: r.vendor_id, vendor_name: r.vendor_name, category: r.category, orders: 0, spend: 0, qty: 0, unit_prices: [] };
    m[key].orders += 1;
    m[key].spend += Number(r.extended_price) || 0;
    m[key].qty += Number(r.qty_used) || 0;
    const up = Number(r.unit_price);
    if (up > 0) m[key].unit_prices.push(up);
  }
  const arr = [];
  for (const v of Object.values(m)) {
    if (v.orders < 3) continue;
    const mean = v.unit_prices.reduce((s, x) => s + x, 0) / (v.unit_prices.length || 1);
    const variance = v.unit_prices.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.unit_prices.length || 1);
    const std = Math.sqrt(variance);
    const cv = mean ? std / mean : 0;
    arr.push({
      description: v.description,
      vendor_id: v.vendor_id,
      vendor_name: v.vendor_name,
      category: v.category,
      orders: v.orders,
      spend: round2(v.spend),
      avg_order_spend: round2(v.spend / v.orders),
      mean_unit_price: round2(mean),
      std_unit_price: round2(std),
      cv_unit_price: Math.round(cv * 1000) / 1000,
    });
  }
  arr.sort((a, b) => b.spend - a.spend);
  return arr;
}

// ============================================================================
// STEP 5: WEIGHT rollup (Phase 3b post-rehab)
// ============================================================================

const weightPerAccount = {};
for (const acct of ACCOUNTS) {
  const all = AUG.rows.filter((r) => r.account_label === acct);
  const dollar = all.filter(inDollar);
  const dollarFood = dollar.filter((r) => r._basis === "food" || r._basis === "beverage");
  const dollarCore = dollar.filter((r) => r._basis === "food");
  const weight = all.filter(inWeightPhase3b);
  const weightFood = weight.filter((r) => r._basis === "food" || r._basis === "beverage");
  const weightCore = weight.filter((r) => r._basis === "food");

  const foodLbs = sumBy(weightFood, (r) => r._effective_weight_lb);
  const coreLbs = sumBy(weightCore, (r) => r._effective_weight_lb);
  const dollarFoodSpend = sumBy(dollarFood, (r) => r.extended_price);
  const dollarCoreSpend = sumBy(dollarCore, (r) => r.extended_price);
  const weightFoodSpend = sumBy(weightFood, (r) => r.extended_price);
  const weightCoreSpend = sumBy(weightCore, (r) => r.extended_price);
  const coverageFoodPct = pct1(weightFoodSpend, dollarFoodSpend);
  const coverageCorePct = pct1(weightCoreSpend, dollarCoreSpend);

  const byCat = {};
  for (const r of weightFood) {
    const c = r.category || "(uncategorized)";
    if (!byCat[c]) byCat[c] = { lbs: 0, spend: 0, rows: 0 };
    byCat[c].lbs += Number(r._effective_weight_lb) || 0;
    byCat[c].spend += Number(r.extended_price) || 0;
    byCat[c].rows += 1;
  }
  const dollarFoodByCat = {};
  for (const r of dollarFood) {
    const c = r.category || "(uncategorized)";
    if (!dollarFoodByCat[c]) dollarFoodByCat[c] = { spend: 0, rows: 0 };
    dollarFoodByCat[c].spend += Number(r.extended_price) || 0;
    dollarFoodByCat[c].rows += 1;
  }
  const byCategoryArr = Object.entries(byCat)
    .map(([category, v]) => {
      const df = dollarFoodByCat[category] || { spend: 0, rows: 0 };
      return {
        category,
        food_rows_dollar_set: df.rows,
        food_rows_weight_set: v.rows,
        food_spend_dollar_set: round2(df.spend),
        food_spend_weight_set: round2(v.spend),
        coverage_rows_pct: pct1(v.rows, df.rows),
        coverage_spend_pct: pct1(v.spend, df.spend),
        weight_lbs: round1(v.lbs),
        dollars_per_lb: v.lbs ? round2(v.spend / v.lbs) : null,
      };
    })
    .sort((a, b) => b.food_spend_weight_set - a.food_spend_weight_set);

  weightPerAccount[acct] = {
    account: acct,
    food_lbs: round1(foodLbs),
    core_food_lbs: round1(coreLbs),
    coverage_food_spend_pct: coverageFoodPct,
    coverage_core_food_spend_pct: coverageCorePct,
    food_spend_dollar_set: round2(dollarFoodSpend),
    food_spend_weight_set: round2(weightFoodSpend),
    core_food_spend_dollar_set: round2(dollarCoreSpend),
    core_food_spend_weight_set: round2(weightCoreSpend),
    dollars_per_lb_overall: foodLbs ? round2(weightFoodSpend / foodLbs) : null,
    dollars_per_lb_core: coreLbs ? round2(weightCoreSpend / coreLbs) : null,
    by_category: byCategoryArr,
  };
}

// ============================================================================
// STEP 6: classification recompute with beverage patches + core_food basis
// ============================================================================

const classifiedItems = CLS.items || {};
for (const r of AUG.rows) {
  const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
  r._cls = classifiedItems[key] || null;
}

const clsPerAccount = {};
for (const acct of ACCOUNTS) {
  const rowsAll = AUG.rows
    .filter((r) => r.account_label === acct)
    .filter(inDollar)
    .filter((r) => r._basis === "food" || r._basis === "beverage");
  const rowsCore = rowsAll.filter((r) => r._basis === "food");

  const buckets = { all: {}, core: {} };
  for (const [scope, rows] of [["all", rowsAll], ["core", rowsCore]]) {
    const totalSpend = sumBy(rows, (r) => r.extended_price);
    const perAxis = {};
    for (const axis of ["quality", "preparation", "storage"]) {
      const b = {};
      let belowConfSpend = 0, belowConfRows = 0;
      let missingClsSpend = 0, missingClsRows = 0;
      for (const r of rows) {
        if (!r._cls) {
          missingClsSpend += Number(r.extended_price) || 0;
          missingClsRows += 1;
          continue;
        }
        const conf = Number(r._cls[`${axis}_confidence`]);
        const label = r._cls[`${axis}_axis`];
        if (!label || conf < CONFIDENCE_THRESHOLD) {
          belowConfSpend += Number(r.extended_price) || 0;
          belowConfRows += 1;
          continue;
        }
        if (!b[label]) b[label] = { spend: 0, rows: 0 };
        b[label].spend += Number(r.extended_price) || 0;
        b[label].rows += 1;
      }
      const rendered = Object.entries(b).map(([label, v]) => ({
        label,
        rows: v.rows,
        spend: round2(v.spend),
        pct_of_food_spend: pct1(v.spend, totalSpend),
      }));
      perAxis[axis] = {
        buckets: rendered,
        below_confidence_rows: belowConfRows,
        below_confidence_spend: round2(belowConfSpend),
        below_confidence_pct: pct1(belowConfSpend, totalSpend),
        missing_cls_rows: missingClsRows,
        missing_cls_spend: round2(missingClsSpend),
        missing_cls_pct: pct1(missingClsSpend, totalSpend),
      };
    }
    buckets[scope] = perAxis;
  }
  clsPerAccount[acct] = {
    food_spend: round2(sumBy(rowsAll, (r) => r.extended_price)),
    core_food_spend: round2(sumBy(rowsCore, (r) => r.extended_price)),
    food_rows: rowsAll.length,
    core_food_rows: rowsCore.length,
    axes_all: buckets.all,
    axes_core: buckets.core,
  };
}

// Inter-axis sanity: both premium AND prefabricated (>=70 conf on both)
const interAxis = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows
    .filter((r) => r.account_label === acct)
    .filter(inDollar)
    .filter((r) => r._basis === "food") // core_food only
    .filter((r) => r._cls);
  const both = rows.filter(
    (r) =>
      r._cls.quality_axis === "premium" &&
      r._cls.preparation_axis === "prefabricated" &&
      r._cls.quality_confidence >= CONFIDENCE_THRESHOLD &&
      r._cls.preparation_confidence >= CONFIDENCE_THRESHOLD
  );
  interAxis[acct] = {
    count: both.length,
    spend: round2(sumBy(both, (r) => r.extended_price)),
    examples: both.slice(0, 5).map((r) => ({ description: r.description, vendor_name: r.vendor_name, spend: r.extended_price })),
  };
}

// ============================================================================
// STEP 7: Fix 3 - Shared Basket unit normalization
// ============================================================================
//
// Match key = (vendor_id, item_number). Dedup by that identity across accounts.
// For each match: report per-account spend + orders + $/lb (if effective weight
// available AND coverage >= 60% by row) else $/pack with pack_size explicit.
// Only include SKUs present in ALL 3 accounts.

const skuIndex = {}; // key -> { per_account: { acct: { spend, orders, lbs, lbs_rows, packSizes } }, description, vendor_name }
for (const r of AUG.rows) {
  if (!inDollar(r)) continue;
  if (r._basis !== "food") continue; // core_food only for basket
  if (!r.vendor_id || !r.item_number) continue;
  const key = r.vendor_id + "::" + r.item_number;
  if (!skuIndex[key]) {
    skuIndex[key] = {
      vendor_id: r.vendor_id,
      item_number: r.item_number,
      vendor_name: r.vendor_name,
      description: r.description,
      category: r.category,
      per_account: {},
    };
  }
  const acct = r.account_label;
  const pa = skuIndex[key].per_account;
  if (!pa[acct]) pa[acct] = { spend: 0, orders: 0, lbs: 0, lbs_rows: 0, unit_prices: [], pack_sizes: new Set() };
  pa[acct].spend += Number(r.extended_price) || 0;
  pa[acct].orders += 1;
  if (Number(r.unit_price) > 0) pa[acct].unit_prices.push(Number(r.unit_price));
  if (r._effective_weight_lb && r._effective_weight_lb > 0) {
    pa[acct].lbs += Number(r._effective_weight_lb) || 0;
    pa[acct].lbs_rows += 1;
  }
  if (r.pack_size) pa[acct].pack_sizes.add(String(r.pack_size));
}

// Build shared basket rows: present in all three accounts
const sharedBasket = [];
for (const [key, obj] of Object.entries(skuIndex)) {
  const accts = Object.keys(obj.per_account);
  if (accts.length < ACCOUNTS.length) continue;
  const perOut = {};
  let anyLbs = 0;
  for (const a of ACCOUNTS) {
    const pa = obj.per_account[a];
    const dpp = pa.lbs > 0 ? round2(pa.spend / pa.lbs) : null;
    const meanUp = pa.unit_prices.length ? round2(pa.unit_prices.reduce((s, x) => s + x, 0) / pa.unit_prices.length) : null;
    perOut[a] = {
      spend: round2(pa.spend),
      orders: pa.orders,
      lbs: round1(pa.lbs),
      lbs_rows: pa.lbs_rows,
      dollars_per_lb: dpp,
      mean_unit_price: meanUp,
      pack_sizes: [...pa.pack_sizes].sort().join(" | "),
      lbs_coverage_rows_pct: pct1(pa.lbs_rows, pa.orders),
    };
    anyLbs += pa.lbs;
  }
  const totalSpend = round2(ACCOUNTS.reduce((s, a) => s + (obj.per_account[a]?.spend || 0), 0));
  // Normalization mode: $/lb only if ALL 3 accounts have >= 50% row-level lb coverage AND at least 1 lb resolved each.
  const allCoverageOk = ACCOUNTS.every((a) => perOut[a].lbs_coverage_rows_pct >= 50 && perOut[a].lbs > 0);
  const mode = allCoverageOk ? "dollars_per_lb" : "dollars_per_order";
  // For dollars_per_order fallback we do NOT publish a "mean $/unit" - too unit-fragmented.
  // We DO publish spend + orders + pack_sizes explicitly per-account.
  const spread = allCoverageOk
    ? round2(Math.max(...ACCOUNTS.map((a) => perOut[a].dollars_per_lb)) / Math.min(...ACCOUNTS.map((a) => perOut[a].dollars_per_lb)))
    : null;
  sharedBasket.push({
    vendor_id: obj.vendor_id,
    item_number: obj.item_number,
    vendor_name: obj.vendor_name,
    description: obj.description,
    category: obj.category,
    total_spend: totalSpend,
    mode,
    normalization_mode_reason: allCoverageOk ? "" : "Insufficient lb coverage in one or more accounts - reporting $/order + pack_size only",
    spread_ratio_dpp: spread,
    per_account: perOut,
  });
}
sharedBasket.sort((a, b) => b.total_spend - a.total_spend);

// ============================================================================
// STEP 8: Fix 2 - Monthly denominator overhaul
// ============================================================================
//
// - Use projections for months where actuals are missing OR sparse (rows <
//   50% of month days). Substituted cells stay labeled `projected`.
// - Every monthly cell shows meals_used + meals_source.
// - Suppress cells where computed $/meal > 3x that account's window average.
//   Log every suppression to Needs Review.

const perAcctMeals = MEALS.per_account;

const perMealTable = {};
const suppressions = [];
for (const acct of ACCOUNTS) {
  const md = perAcctMeals[acct];
  const spend = perAccount[acct];
  const wt = weightPerAccount[acct];

  // Phase 3b: for sparse-actual months, use projections not actuals.
  const monthlyMealsResolved = {};
  for (const m of MONTHS) {
    const mm = md.monthly[m];
    let used = mm.used;
    let source = mm.source;
    if (mm.source === "actual_sparse") {
      if (mm.projected_substitute && mm.projected_substitute > 0) {
        used = mm.projected_substitute;
        source = "projected"; // labeled honestly as projected
      }
    }
    monthlyMealsResolved[m] = { used, source, original_source: mm.source, actual_meals: mm.actual_meals, actual_rows: mm.actual_rows, projected_meals: mm.projected_meals };
  }

  // Window average = window food $ / window meals used (post-resolution)
  const windowMeals = MONTHS.reduce((s, m) => s + (monthlyMealsResolved[m].used || 0), 0);
  const windowFood = spend.dollar_food_spend;
  const windowCoreFood = spend.dollar_core_food_spend;
  const windowAvgDpm = windowMeals ? windowFood / windowMeals : null;
  const windowAvgDpmCore = windowMeals ? windowCoreFood / windowMeals : null;

  const monthly = {};
  for (const m of MONTHS) {
    const mSpend = spend.by_month[m];
    const mm = monthlyMealsResolved[m];
    const dpm = mm.used ? mSpend.food_spend / mm.used : null;
    const dpmCore = mm.used ? mSpend.core_food_spend / mm.used : null;
    let suppressed = false;
    let suppressedReason = "";
    if (dpm != null && windowAvgDpm != null && windowAvgDpm > 0 && dpm > 3 * windowAvgDpm) {
      suppressed = true;
      suppressedReason = `computed food $/meal $${dpm.toFixed(2)} > 3x window avg $${windowAvgDpm.toFixed(2)}`;
      suppressions.push({ account: acct, month: m, computed_dpm: round2(dpm), window_avg_dpm: round2(windowAvgDpm), meals_used: mm.used, source: mm.source, reason: suppressedReason });
    }
    monthly[m] = {
      food_spend: mSpend.food_spend,
      core_food_spend: mSpend.core_food_spend,
      beverage_spend: mSpend.beverage_spend,
      meals_used: mm.used,
      meals_source: mm.source,
      dollars_per_meal: suppressed ? null : (dpm != null ? round2(dpm) : null),
      dollars_per_meal_core: suppressed ? null : (dpmCore != null ? round2(dpmCore) : null),
      suppressed,
      suppressed_reason: suppressedReason,
    };
  }
  perMealTable[acct] = {
    account: acct,
    monthly,
    window_food_spend: spend.dollar_food_spend,
    window_core_food_spend: spend.dollar_core_food_spend,
    window_beverage_spend: spend.dollar_beverage_spend,
    window_meals_used: windowMeals,
    window_meals_source_note: "Sparse-actual months substituted with projections (labeled per-month).",
    window_dollars_per_meal: windowAvgDpm != null ? round2(windowAvgDpm) : null,
    window_dollars_per_meal_core: windowAvgDpmCore != null ? round2(windowAvgDpmCore) : null,
    window_food_lbs: wt.food_lbs,
    window_core_food_lbs: wt.core_food_lbs,
    window_lbs_per_meal: windowMeals && wt.food_lbs ? round2(wt.food_lbs / windowMeals) : null,
    window_lbs_per_meal_core: windowMeals && wt.core_food_lbs ? round2(wt.core_food_lbs / windowMeals) : null,
    window_lbs_coverage_pct: wt.coverage_food_spend_pct,
    window_lbs_coverage_core_pct: wt.coverage_core_food_spend_pct,
  };
}

// ============================================================================
// STEP 9: Reconciliation (mostly unchanged, just recompute with basis)
// ============================================================================

const reconciliation = {};
const headers = AUG.headers;
for (const acct of ACCOUNTS) {
  const monthly = {};
  for (const m of MONTHS) {
    const rows = AUG.rows.filter((r) => r.account_label === acct && r.month === m).filter(inDollar);
    const liSum = round2(sumBy(rows, (r) => r.extended_price));
    const acctMonthUuids = new Set(AUG.rows.filter((r) => r.account_label === acct && r.month === m).map((r) => r.invoice_uuid));
    const hdrInScope = headers.filter((h) => acctMonthUuids.has(h.id) && h.status !== "corrected" && h.status !== "deleted");
    const hdrTotal = round2(sumBy(hdrInScope, (h) => h.total_amount));
    let glFood = 0;
    for (const h of hdrInScope) {
      const glb = h.gl_breakdown;
      if (Array.isArray(glb)) {
        for (const g of glb) {
          const t = `${g.name || ""} ${g.code || ""}`;
          if (/FOOD|COGS|RESALE|COST OF (GOODS|SALES)/i.test(t)) {
            glFood += Number(g.amount) || 0;
          }
        }
      }
    }
    monthly[m] = {
      line_item_sum: liSum,
      header_sum: hdrTotal,
      gl_food_sum: round2(glFood),
      variance_dollars: round2(liSum - hdrTotal),
      variance_pct: hdrTotal ? Math.round(((liSum - hdrTotal) / hdrTotal) * 1000) / 10 : null,
      invoice_count: hdrInScope.length,
      line_row_count: rows.length,
    };
  }
  const liSumW = MONTHS.reduce((s, m) => s + monthly[m].line_item_sum, 0);
  const hdrSumW = MONTHS.reduce((s, m) => s + monthly[m].header_sum, 0);
  const glSumW = MONTHS.reduce((s, m) => s + monthly[m].gl_food_sum, 0);
  reconciliation[acct] = {
    monthly,
    window: {
      line_item_sum: round2(liSumW),
      header_sum: round2(hdrSumW),
      gl_food_sum: round2(glSumW),
      variance_dollars: round2(liSumW - hdrSumW),
      variance_pct: hdrSumW ? Math.round(((liSumW - hdrSumW) / hdrSumW) * 1000) / 10 : null,
    },
  };
}

// ============================================================================
// STEP 10: Fix 6 - Protein Mix sheet
// ============================================================================

const proteinMix = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows.filter((r) => r.account_label === acct && r._basis === "food" && r.category === "protein").filter(inDollar);
  const totalSpend = sumBy(rows, (r) => r.extended_price);
  const totalLbs = sumBy(rows.filter((r) => r._effective_weight_lb && r._effective_weight_lb > 0), (r) => r._effective_weight_lb);
  const lbsCoverageSpendPct = pct1(sumBy(rows.filter((r) => r._effective_weight_lb && r._effective_weight_lb > 0), (r) => r.extended_price), totalSpend);
  const buckets = {};
  for (const r of rows) {
    const t = assignProteinType(r.description);
    if (!buckets[t]) buckets[t] = { rows: 0, spend: 0, lbs: 0, lbs_rows: 0, lbs_spend: 0 };
    buckets[t].rows += 1;
    buckets[t].spend += Number(r.extended_price) || 0;
    if (r._effective_weight_lb && r._effective_weight_lb > 0) {
      buckets[t].lbs += Number(r._effective_weight_lb) || 0;
      buckets[t].lbs_rows += 1;
      buckets[t].lbs_spend += Number(r.extended_price) || 0;
    }
  }
  const arr = Object.entries(buckets).map(([type, v]) => ({
    type,
    rows: v.rows,
    spend: round2(v.spend),
    pct_of_protein_spend: pct1(v.spend, totalSpend),
    lbs_rows: v.lbs_rows,
    lbs: round1(v.lbs),
    lbs_spend: round2(v.lbs_spend),
    coverage_spend_pct: pct1(v.lbs_spend, v.spend),
    dollars_per_lb: v.lbs > 0 ? round2(v.lbs_spend / v.lbs) : null,
    pct_of_protein_lbs: v.lbs > 0 && totalLbs > 0 ? pct1(v.lbs, totalLbs) : null,
  })).sort((a, b) => b.spend - a.spend);
  proteinMix[acct] = {
    account: acct,
    total_protein_spend: round2(totalSpend),
    total_protein_lbs: round1(totalLbs),
    lbs_coverage_spend_pct: lbsCoverageSpendPct,
    by_type: arr,
  };
}

// ============================================================================
// STEP 11: Fix 6 - Duplicate Item Families sheet
// ============================================================================

const families = {};
for (const r of AUG.rows) {
  if (!inDollar(r)) continue;
  if (r._basis !== "food") continue;
  const { family, confidence } = assignFamily(r.description, r.category);
  if (!families[family]) families[family] = { family, confidence, category: r.category, per_account: {}, skus: new Set(), storage_labels: new Set(), rows: 0, spend: 0 };
  const acct = r.account_label;
  if (!families[family].per_account[acct]) families[family].per_account[acct] = { skus: new Set(), spend: 0, rows: 0, lbs: 0, dpp_samples: [] };
  const pa = families[family].per_account[acct];
  const skuKey = (r.vendor_id || "NO-VENDOR") + "::" + (r.item_number || "NO-ITEM") + "::" + (r.description || "").trim();
  pa.skus.add(skuKey);
  families[family].skus.add(skuKey);
  pa.spend += Number(r.extended_price) || 0;
  pa.rows += 1;
  if (r._effective_weight_lb && r._effective_weight_lb > 0) {
    pa.lbs += Number(r._effective_weight_lb) || 0;
    const dpp = r.extended_price / r._effective_weight_lb;
    if (dpp > 0 && dpp < 200) pa.dpp_samples.push(dpp);
  }
  families[family].rows += 1;
  families[family].spend += Number(r.extended_price) || 0;
  // Track storage labels for "fresh AND frozen both present" flag
  if (r._cls?.storage_axis) families[family].storage_labels.add(r._cls.storage_axis);
}

const familyArr = Object.values(families)
  .filter((f) => f.skus.size >= 2) // families with only 1 SKU are not "duplicate families"
  .map((f) => {
    const perOut = {};
    for (const a of ACCOUNTS) {
      const pa = f.per_account[a];
      if (!pa) { perOut[a] = { sku_count: 0, spend: 0, rows: 0, lbs: 0, dollars_per_lb: null, spread_ratio_dpp: null }; continue; }
      const dpp = pa.lbs > 0 ? pa.spend / pa.lbs : null;
      const dppSamples = pa.dpp_samples;
      let spread = null;
      if (dppSamples.length >= 2) {
        const mn = Math.min(...dppSamples);
        const mx = Math.max(...dppSamples);
        spread = mn > 0 ? round2(mx / mn) : null;
      }
      perOut[a] = {
        sku_count: pa.skus.size,
        spend: round2(pa.spend),
        rows: pa.rows,
        lbs: round1(pa.lbs),
        dollars_per_lb: dpp != null ? round2(dpp) : null,
        spread_ratio_dpp: spread,
      };
    }
    // Overall intra-family $/lb spread across ALL accounts combined
    const allSamples = ACCOUNTS.flatMap((a) => f.per_account[a]?.dpp_samples || []);
    let intraFamilySpread = null;
    if (allSamples.length >= 3) {
      const mn = Math.min(...allSamples);
      const mx = Math.max(...allSamples);
      intraFamilySpread = mn > 0 ? round2(mx / mn) : null;
    }
    const freshAndFrozen = f.storage_labels.has("fresh") && f.storage_labels.has("frozen");
    return {
      family: f.family,
      confidence: f.confidence,
      category: f.category,
      sku_count: f.skus.size,
      rows: f.rows,
      spend: round2(f.spend),
      accounts_present: ACCOUNTS.filter((a) => (f.per_account[a]?.rows || 0) > 0).length,
      intra_family_dpp_spread: intraFamilySpread,
      fresh_and_frozen_flag: freshAndFrozen,
      per_account: perOut,
    };
  })
  .sort((a, b) => b.sku_count - a.sku_count);

// ============================================================================
// STEP 12: Scrub - additional CEO-worthy findings
// ============================================================================

// (a) Category mix by account, on core_food basis (protein / produce / dairy / dry_goods / beverage)
// Beverage share reported alongside as a separate finding.
const CATS_OF_INTEREST = ["protein", "produce", "dairy", "dry_goods", "beverage"];
const categoryMixHeadline = {};
for (const acct of ACCOUNTS) {
  const dollar = AUG.rows.filter((r) => r.account_label === acct && inDollar(r));
  const coreFood = dollar.filter((r) => r._basis === "food");
  const coreFoodSpend = sumBy(coreFood, (r) => r.extended_price);
  const beverageSpend = sumBy(dollar.filter((r) => r._basis === "beverage"), (r) => r.extended_price);
  const perCat = {};
  for (const c of CATS_OF_INTEREST) {
    if (c === "beverage") {
      // beverage is expressed as % of food (core_food + beverage)
      const foodPlusBev = coreFoodSpend + beverageSpend;
      perCat[c] = {
        spend: round2(beverageSpend),
        pct_of_core_food: pct1(beverageSpend, coreFoodSpend),
        pct_of_food_total: pct1(beverageSpend, foodPlusBev),
      };
    } else {
      const rows = coreFood.filter((r) => r.category === c);
      const sp = sumBy(rows, (r) => r.extended_price);
      perCat[c] = {
        spend: round2(sp),
        pct_of_core_food: pct1(sp, coreFoodSpend),
        rows: rows.length,
      };
    }
  }
  // "Other food" bucket for any core_food not in the top-5
  const other = coreFood.filter((r) => !CATS_OF_INTEREST.includes(r.category));
  perCat.other_food = {
    spend: round2(sumBy(other, (r) => r.extended_price)),
    pct_of_core_food: pct1(sumBy(other, (r) => r.extended_price), coreFoodSpend),
    rows: other.length,
  };
  categoryMixHeadline[acct] = {
    account: acct,
    core_food_spend: round2(coreFoodSpend),
    beverage_spend: round2(beverageSpend),
    by_category: perCat,
  };
}

// (b) Cross-account price variance on same (vendor_id, item_number)
const priceVariance = [];
for (const [key, obj] of Object.entries(skuIndex)) {
  const accts = Object.keys(obj.per_account);
  if (accts.length < 2) continue;
  // Compute mean unit price per account
  const prices = {};
  for (const a of accts) {
    const pa = obj.per_account[a];
    if (pa.unit_prices.length === 0) continue;
    prices[a] = pa.unit_prices.reduce((s, x) => s + x, 0) / pa.unit_prices.length;
  }
  const priceVals = Object.values(prices).filter((x) => x > 0);
  if (priceVals.length < 2) continue;
  const mn = Math.min(...priceVals);
  const mx = Math.max(...priceVals);
  const spread = mn > 0 ? mx / mn : null;
  if (spread == null || spread < 1.15) continue; // >15% spread
  const totalSpend = ACCOUNTS.reduce((s, a) => s + (obj.per_account[a]?.spend || 0), 0);
  priceVariance.push({
    vendor_id: obj.vendor_id,
    item_number: obj.item_number,
    vendor_name: obj.vendor_name,
    description: obj.description,
    category: obj.category,
    total_spend: round2(totalSpend),
    accounts_present: accts.length,
    per_account_price: Object.fromEntries(Object.entries(prices).map(([a, p]) => [a, round2(p)])),
    spread_ratio: round2(spread),
    dollars_at_stake: round2(totalSpend * (1 - mn / mx)),
  });
}
priceVariance.sort((a, b) => b.dollars_at_stake - a.dollars_at_stake);

// (c) Intra-window price drift (same SKU price May -> July, >10% change)
const priceDrift = [];
for (const [key, obj] of Object.entries(skuIndex)) {
  for (const a of Object.keys(obj.per_account)) {
    // Build monthly price map per account
    const rowsThisSku = AUG.rows.filter((r) => (r.vendor_id || "NO-VENDOR") === obj.vendor_id && r.item_number === obj.item_number && r.account_label === a && inDollar(r));
    const perMonth = {};
    for (const m of MONTHS) {
      const rs = rowsThisSku.filter((r) => r.month === m && r.unit_price > 0);
      if (rs.length === 0) continue;
      perMonth[m] = rs.reduce((s, r) => s + Number(r.unit_price), 0) / rs.length;
    }
    const monthsPresent = Object.keys(perMonth);
    if (monthsPresent.length < 2) continue;
    const first = perMonth[monthsPresent[0]];
    const last = perMonth[monthsPresent[monthsPresent.length - 1]];
    if (!first || !last) continue;
    const drift = (last - first) / first;
    if (Math.abs(drift) < 0.10) continue;
    priceDrift.push({
      vendor_id: obj.vendor_id,
      item_number: obj.item_number,
      vendor_name: obj.vendor_name,
      description: obj.description,
      account: a,
      category: obj.category,
      first_month: monthsPresent[0],
      first_price: round2(first),
      last_month: monthsPresent[monthsPresent.length - 1],
      last_price: round2(last),
      pct_change: round1(drift * 100),
      months_seen: monthsPresent.join(","),
    });
  }
}
priceDrift.sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change));

// (d) Vendor concentration + maverick spend
// For each account, top-3 vendors then everything else = maverick
const vendorConcentration = {};
for (const acct of ACCOUNTS) {
  const dollar = AUG.rows.filter((r) => r.account_label === acct).filter(inDollar);
  const total = sumBy(dollar, (r) => r.extended_price);
  const byVend = {};
  for (const r of dollar) {
    const k = r.vendor_name || "(no vendor)";
    if (!byVend[k]) byVend[k] = { spend: 0, rows: 0 };
    byVend[k].spend += Number(r.extended_price) || 0;
    byVend[k].rows += 1;
  }
  const arr = Object.entries(byVend).map(([v, o]) => ({ vendor: v, spend: o.spend, rows: o.rows, pct: pct1(o.spend, total) })).sort((a, b) => b.spend - a.spend);
  const top3 = arr.slice(0, 3);
  const top3Pct = top3.reduce((s, x) => s + x.pct, 0);
  const maverickTotal = total - top3.reduce((s, x) => s + x.spend, 0);
  // Detail: what maverick vendors buy (top items)
  const top3Names = new Set(top3.map((x) => x.vendor));
  const maverickRows = dollar.filter((r) => !top3Names.has(r.vendor_name || "(no vendor)"));
  const maverickByItem = {};
  for (const r of maverickRows) {
    const k = (r.vendor_name || "?") + " | " + (r.description || "");
    if (!maverickByItem[k]) maverickByItem[k] = { spend: 0, rows: 0, vendor: r.vendor_name, description: r.description, category: r.category };
    maverickByItem[k].spend += Number(r.extended_price) || 0;
    maverickByItem[k].rows += 1;
  }
  const maverickTop = Object.values(maverickByItem).sort((a, b) => b.spend - a.spend).slice(0, 15).map((x) => ({ ...x, spend: round2(x.spend) }));
  vendorConcentration[acct] = {
    account: acct,
    total_spend: round2(total),
    top3_vendors: top3.map((x) => ({ ...x, spend: round2(x.spend) })),
    top3_share_pct: round1(top3Pct),
    maverick_spend: round2(maverickTotal),
    maverick_share_pct: pct1(maverickTotal, total),
    maverick_top_items: maverickTop,
  };
}

// (e) Pareto - what share of spend sits in top 20 items per account
const pareto = {};
for (const acct of ACCOUNTS) {
  const dollar = AUG.rows.filter((r) => r.account_label === acct).filter(inDollar);
  const total = sumBy(dollar, (r) => r.extended_price);
  const byItem = {};
  for (const r of dollar) {
    const k = (r.vendor_id || "NO-VENDOR") + "::" + (r.description || "").trim();
    if (!byItem[k]) byItem[k] = { spend: 0, description: r.description, vendor_name: r.vendor_name };
    byItem[k].spend += Number(r.extended_price) || 0;
  }
  const arr = Object.values(byItem).sort((a, b) => b.spend - a.spend);
  const top20Spend = arr.slice(0, 20).reduce((s, x) => s + x.spend, 0);
  const top50Spend = arr.slice(0, 50).reduce((s, x) => s + x.spend, 0);
  const distinctItems = arr.length;
  pareto[acct] = {
    account: acct,
    total_spend: round2(total),
    distinct_items: distinctItems,
    top20_spend: round2(top20Spend),
    top20_share_pct: pct1(top20Spend, total),
    top50_spend: round2(top50Spend),
    top50_share_pct: pct1(top50Spend, total),
  };
}

// (f) Order cadence: deliveries per week + avg order value per account
const orderCadence = {};
for (const acct of ACCOUNTS) {
  const dollar = AUG.rows.filter((r) => r.account_label === acct).filter(inDollar);
  const invUuids = new Set(dollar.map((r) => r.invoice_uuid));
  const totalSpend = sumBy(dollar, (r) => r.extended_price);
  // Window = 3 months = ~13 weeks
  const windowWeeks = 92 / 7;
  const invSums = {};
  for (const r of dollar) {
    if (!r.invoice_uuid) continue;
    if (!invSums[r.invoice_uuid]) invSums[r.invoice_uuid] = 0;
    invSums[r.invoice_uuid] += Number(r.extended_price) || 0;
  }
  const invValues = Object.values(invSums);
  const avgOrderValue = invValues.length ? invValues.reduce((s, x) => s + x, 0) / invValues.length : 0;
  orderCadence[acct] = {
    account: acct,
    invoices_in_window: invUuids.size,
    total_spend: round2(totalSpend),
    deliveries_per_week: round2(invUuids.size / windowWeeks),
    avg_order_value: round2(avgOrderValue),
  };
}

// (g) Items unique to one account (present in one account only, by spend)
const uniqueByAccount = {};
for (const acct of ACCOUNTS) uniqueByAccount[acct] = [];
for (const [key, obj] of Object.entries(skuIndex)) {
  const accts = Object.keys(obj.per_account);
  if (accts.length === 1) {
    const a = accts[0];
    const pa = obj.per_account[a];
    if (pa.spend >= 250) {
      uniqueByAccount[a].push({
        description: obj.description,
        vendor_name: obj.vendor_name,
        category: obj.category,
        spend: round2(pa.spend),
        orders: pa.orders,
      });
    }
  }
}
for (const a of ACCOUNTS) uniqueByAccount[a].sort((x, y) => y.spend - x.spend);

// ============================================================================
// STEP 13: Item Master + Needs Review (basically unchanged, but with 3b basis + rehab tags)
// ============================================================================

const itemMaster = [];
const pairMap = new Map();
for (const r of AUG.rows.filter(inDollar)) {
  const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
  if (!key.endsWith("::")) {
    if (!pairMap.has(key)) pairMap.set(key, { rows: 0, spend: 0, first: r, examples: [] });
    const obj = pairMap.get(key);
    obj.rows += 1;
    obj.spend += Number(r.extended_price) || 0;
    if (obj.examples.length < 3) obj.examples.push(r);
  }
}
for (const [key, obj] of pairMap) {
  const c = classifiedItems[key] || null;
  const r = obj.first;
  itemMaster.push({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    description: r.description,
    category: r.category,
    basis: r._basis,
    accounts: [...new Set(
      [...AUG.rows.filter((x) => (x.vendor_id || "NO-VENDOR") + "::" + (x.description || "").trim() === key).map((x) => x.account_label)]
    )].join(", "),
    order_count: obj.rows,
    total_spend: round2(obj.spend),
    quality_axis: c?.quality_axis || null,
    quality_confidence: c?.quality_confidence ?? null,
    quality_reason: c?.quality_reason || "",
    preparation_axis: c?.preparation_axis || null,
    preparation_confidence: c?.preparation_confidence ?? null,
    preparation_reason: c?.preparation_reason || "",
    storage_axis: c?.storage_axis || null,
    storage_confidence: c?.storage_confidence ?? null,
    storage_reason: c?.storage_reason || "",
    beverage_reclassified: !!c?._phase3b_beverage_forced,
    classified: !!c,
  });
}
itemMaster.sort((a, b) => b.total_spend - a.total_spend);

// Needs Review: include suppressions from Fix 2, and item family sub-70 conf entries
const needsReviewItems = [];
for (const it of itemMaster) {
  if (!it.classified) { needsReviewItems.push({ ...it, reason: "not_classified" }); continue; }
  const low = [];
  if (it.quality_confidence < CONFIDENCE_THRESHOLD) low.push(`quality<${CONFIDENCE_THRESHOLD}`);
  if (it.preparation_confidence < CONFIDENCE_THRESHOLD) low.push(`prep<${CONFIDENCE_THRESHOLD}`);
  if (it.storage_confidence < CONFIDENCE_THRESHOLD) low.push(`storage<${CONFIDENCE_THRESHOLD}`);
  if (low.length) needsReviewItems.push({ ...it, reason: low.join(",") });
}

const excludedRows = AUG.rows.filter((r) => r.review_reason === "invoice_over_extracted");
const excludedRowsMismatchLeft = AUG.rows.filter((r) => r.review_reason === "ep_qty_up_mismatch" && !r._rehab_source);
const excludedRowsMismatchRehabbed = AUG.rows.filter((r) => r.review_reason === "ep_qty_up_mismatch" && r._rehab_source === "candidate_b_wlv");
const ambiguousPackRowsLeft = AUG.rows.filter((r) => r.parsed_weight_source === "pack_size_ambiguous_multipack" && !r._rehab_source);
const ambiguousPackRowsRehabbed = AUG.rows.filter((r) => r.parsed_weight_source === "pack_size_ambiguous_multipack" && r._rehab_source === "candidate_a_sibling");
const sanityGatedRows = AUG.rows.filter((r) => r._weight_method_final === "sanity_gated_out_of_bounds");

// Fix 4 impact per account: what dollars moved from food -> non-food
const fix4Impact = {};
for (const acct of ACCOUNTS) {
  const dollar = AUG.rows.filter((r) => r.account_label === acct && inDollar(r));
  // Phase 3 verdict (from AUG row is_food) vs Phase 3b basis
  const movedToNonFood = dollar.filter((r) => r.is_food === true && r._basis === "non_food");
  const movedToBeverage = dollar.filter((r) => r._basis === "beverage");
  const stillFood = dollar.filter((r) => r._basis === "food");
  fix4Impact[acct] = {
    account: acct,
    moved_food_to_nonfood_rows: movedToNonFood.length,
    moved_food_to_nonfood_spend: round2(sumBy(movedToNonFood, (r) => r.extended_price)),
    moved_food_to_nonfood_categories: [...new Set(movedToNonFood.map((r) => r.category))].join(", "),
    beverage_split_out_rows: movedToBeverage.length,
    beverage_split_out_spend: round2(sumBy(movedToBeverage, (r) => r.extended_price)),
    core_food_rows: stillFood.length,
    core_food_spend: round2(sumBy(stillFood, (r) => r.extended_price)),
  };
}

// ============================================================================
// STEP 14: emit _analysis3b.json
// ============================================================================

const out = {
  window_label: AUG.window_label,
  window_start: AUG.window_start,
  window_end: AUG.window_end,
  drift_recovered_rows: AUG.drift_recovered,
  orphan_excluded_rows: AUG.orphan_excluded,
  total_live_rows: AUG.row_count,
  classified_items: Object.keys(classifiedItems).length,
  distinct_pairs_to_classify: pairMap.size,
  classification_coverage_pct: pct1(Object.keys(classifiedItems).length, pairMap.size),
  spend: perAccount,
  weight: weightPerAccount,
  classification: clsPerAccount,
  inter_axis_prefab_premium: interAxis,
  shared_basket: sharedBasket,
  meals: perAcctMeals,
  per_meal: perMealTable,
  reconciliation,
  item_master: itemMaster,
  needs_review: needsReviewItems,
  suppressions,
  fix4_impact: fix4Impact,
  fix5_result: fix5Result,
  category_mix_headline: categoryMixHeadline,
  protein_mix: proteinMix,
  duplicate_families: familyArr,
  price_variance: priceVariance,
  price_drift: priceDrift,
  vendor_concentration: vendorConcentration,
  pareto,
  order_cadence: orderCadence,
  unique_by_account: uniqueByAccount,
  excluded_rows: {
    invoice_over_extracted: {
      count: excludedRows.length,
      spend: round2(sumBy(excludedRows, (r) => r.extended_price)),
    },
    ep_qty_up_mismatch_still_excluded: {
      count: excludedRowsMismatchLeft.length,
      spend: round2(sumBy(excludedRowsMismatchLeft, (r) => r.extended_price)),
    },
    ep_qty_up_mismatch_rehabbed: {
      count: excludedRowsMismatchRehabbed.length,
      spend: round2(sumBy(excludedRowsMismatchRehabbed, (r) => r.extended_price)),
    },
    pack_size_ambiguous_multipack_still_excluded: {
      count: ambiguousPackRowsLeft.length,
      spend: round2(sumBy(ambiguousPackRowsLeft, (r) => r.extended_price)),
    },
    pack_size_ambiguous_multipack_rehabbed: {
      count: ambiguousPackRowsRehabbed.length,
      spend: round2(sumBy(ambiguousPackRowsRehabbed, (r) => r.extended_price)),
    },
    sanity_gated_out_of_bounds: {
      count: sanityGatedRows.length,
      spend: round2(sumBy(sanityGatedRows, (r) => r.extended_price)),
      note: "Rows where implied $/lb (extended_price / effective_weight_lb) fell outside 0.5x-2x the category-plausibility bounds. Excluded from WEIGHT SET; still in DOLLAR SET.",
      samples: sanityDropRows.slice(0, 10),
    },
  },
};

fs.writeFileSync(P.ANALYSIS_3B, JSON.stringify(out, null, 2));
console.log("[3b-recompute] wrote _analysis3b.json");
console.log("  suppressed monthly cells:", suppressions.length);
console.log("  duplicate families detected:", familyArr.length);
console.log("  shared basket (SKUs common to all 3):", sharedBasket.length);
console.log("  price variance flagged (>15% spread):", priceVariance.length);
console.log("  price drift flagged (>10% May->Jul):", priceDrift.length);
console.log();
console.log("  Fix 4 impact:");
for (const a of ACCOUNTS) {
  const f = fix4Impact[a];
  console.log(`    [${a}] moved ${f.moved_food_to_nonfood_rows} rows / $${f.moved_food_to_nonfood_spend} to non-food (${f.moved_food_to_nonfood_categories}); beverage split $${f.beverage_split_out_spend}`);
}
console.log();
console.log("  Fix 5 result:", fix5Result.decision_note);
console.log(`    TBR protein WEIGHT SET pre=${fix5Result.tbr_protein_weight_set_rows_pre} post=${fix5Result.tbr_protein_weight_set_rows_post} (${fix5Result.tbr_protein_weight_set_coverage_rows_pct}% rows, ${fix5Result.tbr_protein_weight_set_coverage_spend_pct}% spend)`);
console.log(`    Candidate A applied ${diag.candidate_a.applied}/${diag.candidate_a.attempted} (${diag.candidate_a.no_sibling} no sibling, ${diag.candidate_a.bounds_rejected} bounds-rejected)`);
console.log(`    Candidate B applied ${diag.candidate_b.applied}/${diag.candidate_b.attempted} (${diag.candidate_b.no_wlv} no wlv, ${diag.candidate_b.bounds_rejected} bounds-rejected)`);
console.log();
console.log("  Category mix (core_food) headline:");
for (const a of ACCOUNTS) {
  const cm = categoryMixHeadline[a];
  const rowStr = CATS_OF_INTEREST.filter((c) => c !== "beverage").map((c) => `${c}=${cm.by_category[c].pct_of_core_food}%`).join("  ");
  const bev = cm.by_category.beverage;
  console.log(`    [${a}] core_food=$${cm.core_food_spend}  ${rowStr}  beverage=${bev.pct_of_food_total}% of food $`);
}
