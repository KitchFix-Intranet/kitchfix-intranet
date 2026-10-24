// Phase 5 recompute: layer Phase 5 recoveries + reclassifications onto
// Phase 4 analysis; enforce publication threshold at 25% (with caveat between
// 25% and 35%); apply STL-FL projected meals denominator (Q6); measure Q11
// over-extraction distribution + Q13 sanity bands + prepare Q17 top-item
// reclass + Q21 fresh/frozen sample.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, ACCOUNTS, MONTHS, assignProteinType, round1, round2, pct1, quantile, median, CATEGORY_LB_BOUNDS } from "./_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const A4 = JSON.parse(fs.readFileSync(P.P4_ANALYSIS, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

// Phase 3c rehabbed-rows map: id -> _effective_weight_lb (this preserves the
// Phase 3b Candidate A/B rehab lifts that don't otherwise appear in parsed_weight_lb).
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, {
    lb: Number(r._effective_weight_lb),
    method: r._weight_method_final,
    rehab_source: r._rehab_source,
  });
}

// Deep clone A4
const A5 = JSON.parse(JSON.stringify(A4));

const change_log = {
  meta: {
    phase: "5",
    build_date: new Date().toISOString().slice(0, 10),
    rule: "Kevin's answers + analyst decisions applied; publication threshold=25% with caveat 25-35%; STL projected meals denominator",
    publication_threshold_pct: P5.PUBLICATION_THRESHOLD_PCT,
    caveat_band: [P5.PUBLICATION_CAVEAT_LOW_PCT, P5.PUBLICATION_CAVEAT_HIGH_PCT],
  },
  steps_applied: REC5.meta.step_stats,
  fused_ambiguous_skipped_count: REC5.meta.fused_ambiguous_skipped_count,
  catch_weight_reclassified_count: REC5.meta.catch_weight_reclassified_count,
  beverage_reclassified_count: REC5.meta.beverage_reclassified_count,
  beverage_unresolved: REC5.meta.beverage_unresolved_flagged,
  protein_mix_updates: [],
  weight_coverage_updates: [],
  per_meal_updates: [],
  cells_cleared_25pct: [],
  cells_with_caveat_25_35: [],
  cells_suppressed_below_25pct: [],
  dollar_invariance_check: null,
};

// -----------------------------------------------------------------------
// Build Phase 5 effective-weight map (row.id -> new lbs)
// Phase 5 adds recovered rows on TOP of the Phase 4 recovery layer.
// -----------------------------------------------------------------------
const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));

// Load phase-4 recovered ids to avoid double counting
const P4_REC_JSON = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const p4RecById = new Map(P4_REC_JSON.recovered.map(r => [r.id, r]));

// A row's "effective_lb" comes from (in order):
//   1. Phase 5 recovery (p5RecById)
//   2. Phase 4 recovery (p4RecById)
//   3. Phase 3c rehab layer (_effective_weight_lb from Candidate A/B rehab -
//      preserves the Phase 3b TBR-protein coverage lift)
//   4. Existing parsed_weight_lb from augmented pipeline
//   5. else null (unresolved)
function effectiveLb(row) {
  const p5 = p5RecById.get(row.id);
  if (p5) return p5.effective_weight_lb;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.effective_weight_lb;
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(row.parsed_weight_lb);
  if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}

function effectiveSource(row) {
  const p5 = p5RecById.get(row.id);
  if (p5) return p5.source;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.tag;
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.method || "phase3c_rehab";
  return row.parsed_weight_source;
}

// -----------------------------------------------------------------------
// Step 3 side-effect: rows reclassified as catch_weight go INTO the WEIGHT
// SET now if they also have an effective weight. Store the ID set for use
// during recompute.
// -----------------------------------------------------------------------
const catchReclassIds = new Set(REC5.catch_weight_reclassified_ids || []);

// -----------------------------------------------------------------------
// Recompute WEIGHT SET / protein_mix from scratch using effective weights.
//
// The Phase 4 pipeline computed these using Phase 3c-era exclusions.
// For Phase 5, we rebuild fresh:
//   - DOLLAR SET = same as Phase 4 (never change)
//   - WEIGHT SET = row is in DOLLAR SET AND has effective_lb AND
//     (review_reason != 'ep_qty_up_mismatch' OR id in catchReclassIds)
//     AND category-plausibility pass on $/lb
// -----------------------------------------------------------------------

function inWeightSet(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  const rr = row.review_reason;
  if (rr === "ep_qty_up_mismatch" && !catchReclassIds.has(row.id)) return false;
  const eff = effectiveLb(row);
  if (!eff || eff <= 0) return false;
  return true;
}

function normAcct(a) { return (a || "").replace(" - ", "-"); }

// -----------------------------------------------------------------------
// Recompute protein_mix
// -----------------------------------------------------------------------
const proteinMix = {};
for (const acct of ACCOUNTS) {
  proteinMix[acct] = { account: acct, total_protein_spend: 0, total_protein_lbs: 0, by_type: [] };
}

// Build map: (account, protein_type) -> { rows_dollar, spend_dollar, rows_weight, spend_weight, lbs }
const bucketMap = {};
for (const r of rows) {
  const acct = normAcct(r.account_label);
  const cat = String(r.category || "").toLowerCase();
  if (cat !== "protein") continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  const t = assignProteinType(r.description);
  const key = `${acct}::${t}`;
  if (!bucketMap[key]) bucketMap[key] = { rows: 0, spend: 0, lbs_rows: 0, lbs: 0, lbs_spend: 0 };
  bucketMap[key].rows++;
  bucketMap[key].spend += Number(r.extended_price) || 0;
  if (inWeightSet(r)) {
    bucketMap[key].lbs_rows++;
    bucketMap[key].lbs += effectiveLb(r);
    bucketMap[key].lbs_spend += Number(r.extended_price) || 0;
  }
}

for (const acct of ACCOUNTS) {
  const pm = proteinMix[acct];
  const buckets = ["beef", "poultry", "pork", "seafood", "plant_or_egg", "other_meat", "other"];
  for (const t of buckets) {
    const b = bucketMap[`${acct}::${t}`];
    if (!b || b.rows === 0) continue;
    const dpp = b.lbs > 0 ? round2(b.lbs_spend / b.lbs) : null;
    const covPct = pct1(b.lbs_spend, b.spend);
    const bucket = {
      type: t,
      rows: b.rows,
      spend: round2(b.spend),
      lbs_rows: b.lbs_rows,
      lbs: round1(b.lbs),
      lbs_spend: round2(b.lbs_spend),
      coverage_spend_pct: covPct,
      dollars_per_lb: dpp,
    };
    // Publication decision
    if (t === "plant_or_egg") {
      bucket._publication = "not comparable (plant_or_egg mixed count/weight)";
      bucket._suppressed = true;
    } else if (covPct < P5.PUBLICATION_THRESHOLD_PCT) {
      bucket._publication = `suppressed (${covPct}% below 25% threshold)`;
      bucket._suppressed = true;
      change_log.cells_suppressed_below_25pct.push({ account: acct, cell: `protein_mix.${t}.dollars_per_lb`, coverage_pct: covPct });
    } else if (covPct < P5.PUBLICATION_CAVEAT_HIGH_PCT) {
      bucket._publication = `publish with caveat (${covPct}% coverage, between 25% and 35%)`;
      bucket._caveat = true;
      change_log.cells_with_caveat_25_35.push({ account: acct, cell: `protein_mix.${t}.dollars_per_lb`, coverage_pct: covPct, dollars_per_lb: dpp });
    } else {
      bucket._publication = "publish";
      change_log.cells_cleared_25pct.push({ account: acct, cell: `protein_mix.${t}.dollars_per_lb`, coverage_pct: covPct, dollars_per_lb: dpp });
    }
    pm.by_type.push(bucket);
    pm.total_protein_spend += b.spend;
    pm.total_protein_lbs += b.lbs;
  }
  pm.total_protein_spend = round2(pm.total_protein_spend);
  pm.total_protein_lbs = round1(pm.total_protein_lbs);
  const totLbsSpend = pm.by_type.reduce((s, b) => s + b.lbs_spend, 0);
  pm.lbs_coverage_spend_pct = pct1(totLbsSpend, pm.total_protein_spend);
  // pct_of_protein_lbs
  for (const b of pm.by_type) {
    b.pct_of_protein_spend = pct1(b.spend, pm.total_protein_spend);
    b.pct_of_protein_lbs = pm.total_protein_lbs > 0 ? pct1(b.lbs, pm.total_protein_lbs) : null;
  }
}

// Also record before/after
for (const acct of ACCOUNTS) {
  const before = A4.protein_mix[acct];
  const after = proteinMix[acct];
  for (const b of after.by_type) {
    const b4 = before?.by_type?.find(x => x.type === b.type);
    if (!b4) continue;
    change_log.protein_mix_updates.push({
      account: acct,
      type: b.type,
      before: {
        lbs: b4.lbs, coverage_spend_pct: b4.coverage_spend_pct, dollars_per_lb: b4.dollars_per_lb,
      },
      after: {
        lbs: b.lbs, coverage_spend_pct: b.coverage_spend_pct, dollars_per_lb: b.dollars_per_lb,
      },
      publication_status: b._publication,
    });
  }
}
A5.protein_mix = proteinMix;

// -----------------------------------------------------------------------
// Recompute Weight & Coverage (per-account overall + per-category)
// -----------------------------------------------------------------------
function assignBasis(row) {
  const cat = String(row.category || "").toLowerCase();
  if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(cat)) return "non_food";
  if (["beverage"].includes(cat)) return "beverage";
  if (["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(cat)) return "food";
  return "unknown";
}

const weight = {};
for (const acct of ACCOUNTS) {
  weight[acct] = {
    account: acct,
    food_spend_dollar_set: 0,
    core_food_spend_dollar_set: 0,
    food_spend_weight_set: 0,
    core_food_spend_weight_set: 0,
    food_lbs: 0,
    core_food_lbs: 0,
    food_rows_dollar_set: 0,
    food_rows_weight_set: 0,
    by_category: {},
  };
}

for (const r of rows) {
  const acct = normAcct(r.account_label);
  if (!weight[acct]) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  const basis = assignBasis(r);
  if (basis === "non_food" || basis === "unknown") continue;
  const cat = String(r.category || "").toLowerCase();
  const ep = Number(r.extended_price) || 0;
  weight[acct].food_spend_dollar_set += ep;
  weight[acct].food_rows_dollar_set++;
  if (basis === "food") {
    weight[acct].core_food_spend_dollar_set += ep;
  }
  weight[acct].by_category[cat] = weight[acct].by_category[cat] || {
    category: cat, food_rows_dollar_set: 0, food_spend_dollar_set: 0,
    food_rows_weight_set: 0, food_spend_weight_set: 0, weight_lbs: 0,
  };
  weight[acct].by_category[cat].food_rows_dollar_set++;
  weight[acct].by_category[cat].food_spend_dollar_set += ep;
  if (inWeightSet(r)) {
    const el = effectiveLb(r);
    weight[acct].food_lbs += el;
    weight[acct].food_spend_weight_set += ep;
    weight[acct].food_rows_weight_set++;
    weight[acct].by_category[cat].food_rows_weight_set++;
    weight[acct].by_category[cat].food_spend_weight_set += ep;
    weight[acct].by_category[cat].weight_lbs += el;
    if (basis === "food") {
      weight[acct].core_food_lbs += el;
      weight[acct].core_food_spend_weight_set += ep;
    }
  }
}
for (const acct of ACCOUNTS) {
  const w = weight[acct];
  w.food_spend_dollar_set = round2(w.food_spend_dollar_set);
  w.core_food_spend_dollar_set = round2(w.core_food_spend_dollar_set);
  w.food_spend_weight_set = round2(w.food_spend_weight_set);
  w.core_food_spend_weight_set = round2(w.core_food_spend_weight_set);
  w.food_lbs = round1(w.food_lbs);
  w.core_food_lbs = round1(w.core_food_lbs);
  w.coverage_food_spend_pct = pct1(w.food_spend_weight_set, w.food_spend_dollar_set);
  w.coverage_core_food_spend_pct = pct1(w.core_food_spend_weight_set, w.core_food_spend_dollar_set);
  const byCat = [];
  for (const c of Object.values(w.by_category)) {
    c.food_spend_dollar_set = round2(c.food_spend_dollar_set);
    c.food_spend_weight_set = round2(c.food_spend_weight_set);
    c.weight_lbs = round1(c.weight_lbs);
    c.coverage_spend_pct = pct1(c.food_spend_weight_set, c.food_spend_dollar_set);
    c.coverage_rows_pct = pct1(c.food_rows_weight_set, c.food_rows_dollar_set);
    c.dollars_per_lb = c.weight_lbs > 0 ? round2(c.food_spend_weight_set / c.weight_lbs) : null;
    // Publication decision on per-category dpp
    if (c.coverage_spend_pct < P5.PUBLICATION_THRESHOLD_PCT) {
      c._publication = `suppressed (${c.coverage_spend_pct}% below 25%)`;
      c._suppressed = true;
    } else if (c.coverage_spend_pct < P5.PUBLICATION_CAVEAT_HIGH_PCT) {
      c._publication = `publish with caveat (${c.coverage_spend_pct}% coverage)`;
      c._caveat = true;
    } else {
      c._publication = "publish";
    }
    byCat.push(c);
  }
  byCat.sort((a,b) => b.food_spend_dollar_set - a.food_spend_dollar_set);
  w.by_category = byCat;
}
A5.weight = weight;

for (const acct of ACCOUNTS) {
  const w4 = A4.weight[acct];
  const w5 = A5.weight[acct];
  change_log.weight_coverage_updates.push({
    account: acct,
    before: {
      food_lbs: w4.food_lbs, food_spend_weight_set: w4.food_spend_weight_set,
      coverage_food_spend_pct: w4.coverage_food_spend_pct,
      coverage_core_food_spend_pct: w4.coverage_core_food_spend_pct,
    },
    after: {
      food_lbs: w5.food_lbs, food_spend_weight_set: w5.food_spend_weight_set,
      coverage_food_spend_pct: w5.coverage_food_spend_pct,
      coverage_core_food_spend_pct: w5.coverage_core_food_spend_pct,
    },
  });
}

// -----------------------------------------------------------------------
// Q6: STL-FL uses projected meals denominator: 7,540 / 6,190 / 5,130 = 18,860
// -----------------------------------------------------------------------
const STL_PROJ_2027 = {
  "2026-05": 7540,
  "2026-06": 6190,
  "2026-07": 5130,
};
const STL_PROJ_TOTAL = 18860;
// Reshape per_meal for STL-FL entirely
if (!A5.per_meal["STL-FL"]) A5.per_meal["STL-FL"] = { account: "STL-FL", monthly: {} };
const smSTL = A5.per_meal["STL-FL"];
smSTL.window_meals_used = STL_PROJ_TOTAL;
smSTL.window_meals_source = "projected_2027_service_calendar";
smSTL.window_meals_note = "Kevin: STL uses 2027 service-calendar projections (7,540 / 6,190 / 5,130 May/Jun/Jul)";
// Pull STL food spend from the (unchanged) spend structure.
const stlFoodSpend = A5.spend?.["STL-FL"]?.dollar_food_spend ?? A4.spend?.["STL-FL"]?.dollar_food_spend;
const stlCoreFoodSpend = A5.weight["STL-FL"].core_food_spend_dollar_set;
if (stlFoodSpend && STL_PROJ_TOTAL) smSTL.window_dollars_per_meal = round2(stlFoodSpend / STL_PROJ_TOTAL);
if (stlCoreFoodSpend && STL_PROJ_TOTAL) smSTL.window_dollars_per_meal_core = round2(stlCoreFoodSpend / STL_PROJ_TOTAL);
smSTL.window_food_lbs = A5.weight["STL-FL"].food_lbs;
smSTL.window_core_food_lbs = A5.weight["STL-FL"].core_food_lbs;
smSTL.window_lbs_per_meal = STL_PROJ_TOTAL ? round2(A5.weight["STL-FL"].food_lbs / STL_PROJ_TOTAL) : null;
smSTL.window_lbs_per_meal_core = STL_PROJ_TOTAL ? round2(A5.weight["STL-FL"].core_food_lbs / STL_PROJ_TOTAL) : null;
smSTL.window_lbs_coverage_pct = A5.weight["STL-FL"].coverage_food_spend_pct;
smSTL.window_lbs_coverage_core_pct = A5.weight["STL-FL"].coverage_core_food_spend_pct;
change_log.per_meal_updates.push({
  account: "STL-FL",
  change: "swap actual/mixed meals denominator for 2027-projected 18,860 (per Kevin Q6)",
  window_meals_used: STL_PROJ_TOTAL,
  window_dollars_per_meal: smSTL.window_dollars_per_meal,
  window_lbs_per_meal: smSTL.window_lbs_per_meal,
});

// Also update TBR-FL, TBJ-FL per_meal lbs since coverage changed
for (const acct of ["TBR-FL", "TBJ-FL"]) {
  const pm = A5.per_meal[acct];
  if (!pm || !pm.window_meals_used) continue;
  const w = A5.weight[acct];
  pm.window_food_lbs = w.food_lbs;
  pm.window_core_food_lbs = w.core_food_lbs;
  pm.window_lbs_per_meal = round2(w.food_lbs / pm.window_meals_used);
  pm.window_lbs_per_meal_core = round2(w.core_food_lbs / pm.window_meals_used);
  pm.window_lbs_coverage_pct = w.coverage_food_spend_pct;
  pm.window_lbs_coverage_core_pct = w.coverage_core_food_spend_pct;
}

// -----------------------------------------------------------------------
// Q11: measured over-extraction distribution (post-fix)
// After Step 3, catch-weight-signal rows are removed from ep_qty_up_mismatch.
// Now recompute per-invoice: sum(li_ep) / header_ep. Report distribution.
// -----------------------------------------------------------------------
console.log("\n===== Q11: measured over-extraction distribution =====");
// Build per-invoice: sum ep of NON-orphan-corrected rows (which are already filtered)
const invSums = {};
for (const r of rows) {
  const inv = r.invoice_uuid; if (!inv) continue;
  invSums[inv] = invSums[inv] || 0;
  invSums[inv] += Number(r.extended_price) || 0;
}
// header sums are in AUG.headers - use total_amount
const hdrById = new Map((AUG.headers || []).map(h => [h.id, h]));
const ratios = [];
for (const [inv, liSum] of Object.entries(invSums)) {
  const h = hdrById.get(inv);
  const hSum = h ? Number(h.total_amount || 0) : 0;
  if (!hSum || hSum < 100) continue;
  const ratio = liSum / hSum;
  ratios.push({ inv, li: round2(liSum), hdr: round2(hSum), ratio: Math.round(ratio * 100) / 100 });
}
ratios.sort((a,b) => b.ratio - a.ratio);
// Distribution
const rr = ratios.map(x => x.ratio);
const q25 = quantile(rr, 0.25), q50 = quantile(rr, 0.50), q75 = quantile(rr, 0.75), q90 = quantile(rr, 0.90), q95 = quantile(rr, 0.95), q99 = quantile(rr, 0.99);
const above115 = ratios.filter(r => r.ratio > 1.15).length;
const above120 = ratios.filter(r => r.ratio > 1.20).length;
const above130 = ratios.filter(r => r.ratio > 1.30).length;
const above150 = ratios.filter(r => r.ratio > 1.50).length;
const overExtractionDist = {
  invoices_scored: ratios.length,
  quantiles: { q25, q50, q75, q90, q95, q99 },
  above_thresholds: { "1.15x": above115, "1.20x": above120, "1.30x": above130, "1.50x": above150 },
  top10_over: ratios.slice(0, 10),
};
console.log(`  invoices scored=${ratios.length}`);
console.log(`  quantiles: q25=${q25?.toFixed(2)} q50=${q50?.toFixed(2)} q75=${q75?.toFixed(2)} q90=${q90?.toFixed(2)} q95=${q95?.toFixed(2)} q99=${q99?.toFixed(2)}`);
console.log(`  invoices above 1.15x=${above115}  1.20x=${above120}  1.30x=${above130}  1.50x=${above150}`);
// Recommendation: pick threshold at ~q95 rounded up to nearest 0.05
let recQ11 = q95 || 1.20;
recQ11 = Math.ceil(recQ11 * 20) / 20;  // round up to nearest 0.05
overExtractionDist.recommended_threshold = recQ11;
console.log(`  recommended threshold from q95 (rounded up 0.05): ${recQ11.toFixed(2)}x`);
fs.writeFileSync(P5.Q11_DIST, JSON.stringify(overExtractionDist, null, 2));

// -----------------------------------------------------------------------
// Q13: measured $/lb sanity bands per category (post-fix coverage)
// Method: for each category, gather per-row implied $/lb from WEIGHT SET,
// compute Q1/Q3/IQR/wider band. Return bands with method note.
// -----------------------------------------------------------------------
console.log("\n===== Q13: measured $/lb sanity bands per category =====");
const bandsByCat = {};
for (const r of rows) {
  if (!inWeightSet(r)) continue;
  const el = effectiveLb(r);
  if (!el || el <= 0) continue;
  const ep = Number(r.extended_price) || 0; if (!ep) continue;
  const cat = String(r.category || "").toLowerCase();
  const dpp = ep / el;
  bandsByCat[cat] = bandsByCat[cat] || [];
  bandsByCat[cat].push(dpp);
}
const q13 = {};
for (const [cat, arr] of Object.entries(bandsByCat)) {
  if (arr.length < 5) { q13[cat] = { n: arr.length, note: "insufficient_data (<5 rows)" }; continue; }
  const q1 = quantile(arr, 0.25);
  const q3 = quantile(arr, 0.75);
  const iqr = q3 - q1;
  // Kevin's steer: seafood wider, produce narrower.
  // General rule: IQR-based. seafood use 2.5x IQR, produce use 1.0x IQR, else 1.5x.
  let mult = 1.5;
  if (cat === "seafood") mult = 2.5;
  else if (cat === "produce") mult = 1.0;
  const low = Math.max(0, q1 - mult * iqr);
  const high = q3 + mult * iqr;
  q13[cat] = {
    n: arr.length,
    q1: round2(q1), q3: round2(q3), iqr: round2(iqr),
    band_multiplier: mult,
    band_low: round2(low), band_high: round2(high),
    median: round2(median(arr)),
    method: `[max(0, Q1 - ${mult}*IQR), Q3 + ${mult}*IQR] from ${arr.length} WEIGHT SET rows`,
  };
}
for (const [c, b] of Object.entries(q13)) {
  if (b.note) console.log(`  ${c.padEnd(12)} ${b.note}`);
  else console.log(`  ${c.padEnd(12)} n=${b.n} q1=$${b.q1} q3=$${b.q3} band=[$${b.band_low}, $${b.band_high}] med=$${b.median} (mult=${b.band_multiplier})`);
}
fs.writeFileSync(P5.Q13_BANDS, JSON.stringify(q13, null, 2));

// -----------------------------------------------------------------------
// Dollar invariance check
// -----------------------------------------------------------------------
const dollarCheck = { pass: true, issues: [] };
function checkAll(a, b, path = "") {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number") {
    if (/lbs|coverage|dollars_per_lb|dpp|weight/i.test(path)) return;
    if (/_phase4|_phase3|_phase5|_original|_item5|_note|_publication|_suppressed|_caveat|per_meal/i.test(path)) return;
    if (Math.abs(a - b) > 0.005) {
      dollarCheck.issues.push({ path, phase4: a, phase5: b });
      dollarCheck.pass = false;
    }
    return;
  }
  if (typeof a !== "object" || typeof b !== "object") return;
  if (a === null || b === null) return;
  for (const k of Object.keys(a)) {
    if (k in b) checkAll(a[k], b[k], path + "." + k);
  }
}
for (const k of ["spend", "reconciliation"]) {
  if (A4[k] && A5[k]) checkAll(A4[k], A5[k], k);
}
// protein_mix.total_protein_spend per account and per-type spend
for (const acct of Object.keys(A4.protein_mix || {})) {
  const p4 = A4.protein_mix[acct];
  const p5 = A5.protein_mix[acct];
  if (!p5) continue;
  if (Math.abs(p4.total_protein_spend - p5.total_protein_spend) > 0.005) {
    dollarCheck.issues.push({ path: `protein_mix.${acct}.total_protein_spend`, phase4: p4.total_protein_spend, phase5: p5.total_protein_spend });
    dollarCheck.pass = false;
  }
  for (const b4 of p4.by_type || []) {
    const b5 = p5.by_type.find(x => x.type === b4.type);
    if (!b5) continue;
    if (Math.abs(b4.spend - b5.spend) > 0.005) {
      dollarCheck.issues.push({ path: `protein_mix.${acct}.${b4.type}.spend`, phase4: b4.spend, phase5: b5.spend });
      dollarCheck.pass = false;
    }
  }
}
change_log.dollar_invariance_check = dollarCheck;
console.log(`\n===== DOLLAR INVARIANCE: ${dollarCheck.pass ? "PASS" : "FAIL"} (${dollarCheck.issues.length} issues) =====`);
if (!dollarCheck.pass) {
  for (const iss of dollarCheck.issues.slice(0, 10)) console.log(`  ${iss.path}: p4=${iss.phase4} p5=${iss.phase5}`);
}

// -----------------------------------------------------------------------
// Write outputs
// -----------------------------------------------------------------------
A5._phase5 = { build_date: change_log.meta.build_date, publication_threshold_pct: P5.PUBLICATION_THRESHOLD_PCT, caveat_band: change_log.meta.caveat_band };
fs.writeFileSync(P5.ANALYSIS, JSON.stringify(A5, null, 2));
fs.writeFileSync(P5.CHANGE_LOG, JSON.stringify(change_log, null, 2));
console.log(`\nwrote ${P5.ANALYSIS} + ${P5.CHANGE_LOG}`);

// -----------------------------------------------------------------------
// Print headline summary
// -----------------------------------------------------------------------
console.log(`\n===== PHASE 5 headline coverage =====`);
for (const acct of ACCOUNTS) {
  const w4 = A4.weight[acct]; const w5 = A5.weight[acct];
  console.log(`  ${acct}: food_lbs ${w4.food_lbs} -> ${w5.food_lbs} | coverage ${w4.coverage_food_spend_pct}% -> ${w5.coverage_food_spend_pct}%`);
}

console.log(`\n===== PHASE 5 protein_mix =====`);
for (const acct of ACCOUNTS) {
  const pm5 = A5.protein_mix[acct];
  console.log(`\n  ${acct}: total_protein_spend=$${pm5.total_protein_spend} total_lbs=${pm5.total_protein_lbs} cov=${pm5.lbs_coverage_spend_pct}%`);
  for (const b of pm5.by_type) {
    console.log(`     ${b.type.padEnd(14)} spend=$${b.spend.toFixed(2).padStart(9)} lbs=${(b.lbs||0).toFixed(1).padStart(7)} cov=${(b.coverage_spend_pct||0).toString().padStart(5)}% dpp=${b.dollars_per_lb} [${b._publication}]`);
  }
}

console.log(`\n===== PHASE 5 per_meal =====`);
for (const acct of ACCOUNTS) {
  const pm = A5.per_meal[acct]; if (!pm) continue;
  console.log(`  ${acct}: meals=${pm.window_meals_used} src=${pm.window_meals_source || "unchanged"} $/meal=${pm.window_dollars_per_meal} lb/meal=${pm.window_lbs_per_meal} lb-coverage=${pm.window_lbs_coverage_pct}%`);
}
