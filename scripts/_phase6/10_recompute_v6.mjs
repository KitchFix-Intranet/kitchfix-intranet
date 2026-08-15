// Phase 6 recompute: v6 fix layered on top of Phase 5 pipeline.
// A clone of scripts_phase5/30_recompute.mjs with the following rules:
//   R4  Catch-implied weight layer (ep/up) - precedence BELOW p5 and p4,
//       ABOVE 3c-rehab and base. Tag: catch_weight_implied_ep_over_up.
//   R5  Q8 arithmetic gate ENFORCED at reinstatement (|up*shipped - ep| <=
//       max(1, 0.02*ep)) in addition to signal + 0 < ep/up <= 5000.
//   R6  $/lb plausibility gate on weight-set rows whose effective source is
//       base parser or a p5 step. p4 + 3c layers are EXEMPT. Out-of-band rows
//       LEAVE the weight set only (never the dollar set); logged
//       band_out_of_range.
//   R7  Fluid-oz restoration: p5 fused-slash resolutions on beverage-basis rows
//       revert to volume_excluded.
//   R8  Hard-fail gate: any account's core-food protein lbs / window covers
//       > 0.6 -> throw. Denominators: TBR/TBJ from A5.per_meal
//       window_meals_used; STL 18,860.
//   R9  (verified upstream in 04_layer_id_resolution).
//   R10 Change log: every row whose effective weight or set-membership changes
//       vs the v5-logic baseline gets an entry.
//
// --baseline flag: DISABLE R4-R7 (v5-logic mode), keep the R8 hard-fail as
// warn-only so we can prove it FIRES against the v5-logic baseline.
// Writes _analysis6.json + _change_log6.json in scripts/_phase6/.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, ACCOUNTS, MONTHS, assignProteinType, round1, round2, pct1, quantile, median, CATEGORY_LB_BOUNDS, resolveFusedSlash } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";
// Canonical denominators (Addendum A1) - REPLACE v5 per_meal.window_meals_used
// and disable the sparse-month substitution path for this window.
import { CANON, BG_DISCLOSURE, TBR_FL as TBR_CANON, TBJ_FL as TBJ_CANON, STL_FL as STL_CANON } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/kitchfix-intranet/scripts/_phase6/_denominators.mjs";

const BASELINE = process.argv.includes("--baseline");
const MODE = BASELINE ? "baseline" : "v6";
console.log(`\n===== recompute mode: ${MODE} =====\n`);

// Paths
const P6 = {
  DIR: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6",
  ANALYSIS_V6: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json",
  ANALYSIS_BASELINE: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6_baseline.json",
  CHANGE_LOG: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6.json",
  CHANGE_LOG_BASELINE: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6_baseline.json",
};

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const A4 = JSON.parse(fs.readFileSync(P.P4_ANALYSIS, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const Q13_BANDS = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q13_bands.json", "utf8"));

const rows = AUG.rows;
const rowsById = new Map(rows.map(r => [r.id, r]));

// -- Build layer maps
const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));

const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, {
    lb: Number(r._effective_weight_lb),
    method: r._weight_method_final,
    rehab_source: r._rehab_source,
  });
}

// Catch-weight reclassified ids (deduped)
const catchReclassIdsAll = new Set([...new Set(REC5.catch_weight_reclassified_ids || [])]);

// -----------------------------------------------------------------------
// R5 (v6 only): Q8 arithmetic gate at reinstatement.
// Admit only if |up*shipped - ep| <= max(1, 0.02*ep) AND signal AND
// 0 < ep/up <= 5000.
// In baseline mode we admit whatever REC5 already admitted (no additional gate).
// -----------------------------------------------------------------------
const catchAdmitted = new Set();
const catchGatedOut = [];
if (!BASELINE) {
  for (const id of catchReclassIdsAll) {
    const r = rowsById.get(id);
    if (!r) continue;
    const up = Number(r.unit_price);
    const sh = Number(r.shipped_count);
    const ep = Number(r.extended_price);
    if (!up || !ep) { catchGatedOut.push({ id, why: "missing_up_or_ep" }); continue; }
    const implied = ep / up;
    if (!Number.isFinite(implied) || implied <= 0 || implied > 5000) {
      catchGatedOut.push({ id, why: "ep_over_up_out_of_range", implied });
      continue;
    }
    // Arithmetic gate: needs shipped_count for the up*shipped_count check.
    if (!sh) {
      catchGatedOut.push({ id, why: "missing_shipped_count", up, ep, sh });
      continue;
    }
    const calc = up * sh;
    const tol = Math.max(1, ep * 0.02);
    if (Math.abs(calc - ep) > tol) {
      catchGatedOut.push({ id, why: "up_times_shipped_not_ep", up, sh, calc, ep, tol });
      continue;
    }
    catchAdmitted.add(id);
  }
} else {
  for (const id of catchReclassIdsAll) catchAdmitted.add(id);
}

// -----------------------------------------------------------------------
// R7 (v6 only): Fluid-oz restoration. p5-recovered rows on beverage-basis
// whose source is a fused-slash rule revert to volume_excluded (i.e. drop
// from the WEIGHT set). Detect via REC5.recovered[].source (fused_slash_rule_*)
// AND (beverage-basis check per assignBasis).
// -----------------------------------------------------------------------
function assignBasis(row) {
  const cat = String(row.category || "").toLowerCase();
  if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(cat)) return "non_food";
  if (["beverage"].includes(cat)) return "beverage";
  if (["protein","poultry","meat","seafood","dairy","dry_goods","grocery","produce","frozen","snacks"].includes(cat)) return "food";
  return "unknown";
}
const p5FusedBeverageDropped = new Set();
if (!BASELINE) {
  for (const rec of REC5.recovered) {
    const r = rowsById.get(rec.id); if (!r) continue;
    if (assignBasis(r) !== "beverage") continue;
    if (String(rec.source || "").startsWith("fused_slash_rule")) {
      p5FusedBeverageDropped.add(rec.id);
    }
  }
}

// -----------------------------------------------------------------------
// R4 (v6 only): Catch-implied weight layer.
// For every id in catchAdmitted, effective weight = ep/up, source =
// catch_weight_implied_ep_over_up. Precedence: BELOW p5 and p4, ABOVE 3c
// rehab and base.
// -----------------------------------------------------------------------
const catchImpliedById = new Map();
if (!BASELINE) {
  for (const id of catchAdmitted) {
    const r = rowsById.get(id); if (!r) continue;
    const up = Number(r.unit_price); const ep = Number(r.extended_price);
    if (!up || !ep) continue;
    const implied = ep / up;
    if (!Number.isFinite(implied) || implied <= 0 || implied > 5000) continue;
    catchImpliedById.set(id, {
      lb: implied,
      source: "catch_weight_implied_ep_over_up",
    });
  }
}

// -----------------------------------------------------------------------
// Effective weight resolver (with mode-aware precedence)
// baseline mode:  p5 -> p4 -> 3c-rehab -> base parser
// v6 mode:        p5 -> p4 -> catch-implied -> 3c-rehab -> base parser
//                 + R7 removes p5 fused-slash beverage rows from p5 layer
// -----------------------------------------------------------------------
function effectiveLb(row) {
  const p5 = p5RecById.get(row.id);
  if (p5 && !p5FusedBeverageDropped.has(row.id)) return p5.effective_weight_lb;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.effective_weight_lb;
  if (!BASELINE) {
    const ci = catchImpliedById.get(row.id);
    if (ci) return ci.lb;
  }
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(row.parsed_weight_lb);
  if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}

function effectiveSource(row) {
  const p5 = p5RecById.get(row.id);
  if (p5 && !p5FusedBeverageDropped.has(row.id)) return p5.source;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.tag;
  if (!BASELINE) {
    const ci = catchImpliedById.get(row.id);
    if (ci) return ci.source;
  }
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.method || "phase3c_rehab";
  return row.parsed_weight_source;
}

// -----------------------------------------------------------------------
// R6 (v6 only): $/lb plausibility gate on rows whose effective source is
// base parser or a p5 step. EXEMPT p4 and 3c layers.
// -----------------------------------------------------------------------
function isP5Source(src) {
  if (!src) return false;
  return src === "shipped_count_is_lb"
    || src === "kevin_verified_pack"
    || src === "implied_from_ep_and_unit_price"
    || src === "cheney_pound_n_convention"
    || String(src).startsWith("fused_slash_rule");
}
function isP4Source(src) {
  if (!src) return false;
  // p4 tags come from REC4.recovered[].tag - a broad set. Any id in p4RecById.
  return false; // handled by row-id membership check below
}
function isBaseParserSource(src) {
  if (!src) return true;  // no source = fallback to base
  return [
    "pack_size:n_x_m_weight",
    "pack_size:single_weight",
    "weight_line_value",
    "catalog_lookup:n_x_m_weight",
    "catalog_lookup:single_weight",
    "description:n_x_m_weight",
    "description:single_weight",
    "pack_size:range_midpoint",
    "catalog_lookup:range_midpoint",
  ].includes(src);
}

const bandGatedOut = [];  // R6 log

function inWeightSet(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  const rr = row.review_reason;
  if (rr === "ep_qty_up_mismatch" && !catchAdmitted.has(row.id)) return false;
  const eff = effectiveLb(row);
  if (!eff || eff <= 0) return false;
  if (BASELINE) return true;
  // R6 band gate for v6
  // Only apply to base parser or p5 sources - exempt p4 and 3c-rehab and catch-implied
  const inP4 = p4RecById.has(row.id);
  if (inP4) return true;
  const src = effectiveSource(row);
  const isCatchImplied = src === "catch_weight_implied_ep_over_up";
  if (isCatchImplied) return true;
  const in3c = rehab3cById.has(row.id) && String(src || "").includes("candidate_");
  if (in3c) return true;
  if (isBaseParserSource(src) || isP5Source(src)) {
    const cat = String(row.category || "").toLowerCase();
    const band = Q13_BANDS[cat];
    if (!band || band.note) return true;  // no band -> pass
    const ep = Number(row.extended_price) || 0;
    if (!ep) return true;
    const dpp = ep / eff;
    if (dpp < band.band_low || dpp > band.band_high) {
      bandGatedOut.push({
        id: row.id, account: row.account_label, category: cat,
        dpp: round2(dpp), band_low: band.band_low, band_high: band.band_high,
        source: src, ep, lbs: round1(eff),
      });
      return false;
    }
  }
  return true;
}

// -----------------------------------------------------------------------
// Baseline weight/source (v5 logic) - used for R10 change-log delta
// -----------------------------------------------------------------------
function baselineEffLb(row) {
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
function baselineEffSource(row) {
  const p5 = p5RecById.get(row.id);
  if (p5) return p5.source;
  const p4 = p4RecById.get(row.id);
  if (p4) return p4.tag;
  const r3c = rehab3cById.get(row.id);
  if (r3c && r3c.lb > 0) return r3c.method || "phase3c_rehab";
  return row.parsed_weight_source;
}
function baselineInWeightSet(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  const rr = row.review_reason;
  const inCatch = catchReclassIdsAll.has(row.id);
  if (rr === "ep_qty_up_mismatch" && !inCatch) return false;
  const eff = baselineEffLb(row);
  if (!eff || eff <= 0) return false;
  return true;
}

// -----------------------------------------------------------------------
// Recompute protein_mix
// -----------------------------------------------------------------------
function normAcct(a) { return (a || "").replace(" - ", "-"); }

const A6 = JSON.parse(JSON.stringify(A4));

const proteinMix = {};
for (const acct of ACCOUNTS) {
  proteinMix[acct] = { account: acct, total_protein_spend: 0, total_protein_lbs: 0, by_type: [] };
}

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
    if (t === "plant_or_egg") {
      bucket._publication = "not comparable (plant_or_egg mixed count/weight)";
      bucket._suppressed = true;
    } else if (covPct < P5.PUBLICATION_THRESHOLD_PCT) {
      bucket._publication = `suppressed (${covPct}% below 25% threshold)`;
      bucket._suppressed = true;
    } else if (covPct < P5.PUBLICATION_CAVEAT_HIGH_PCT) {
      bucket._publication = `publish with caveat (${covPct}% coverage, between 25% and 35%)`;
      bucket._caveat = true;
    } else {
      bucket._publication = "publish";
    }
    pm.by_type.push(bucket);
    pm.total_protein_spend += b.spend;
    pm.total_protein_lbs += b.lbs;
  }
  pm.total_protein_spend = round2(pm.total_protein_spend);
  pm.total_protein_lbs = round1(pm.total_protein_lbs);
  const totLbsSpend = pm.by_type.reduce((s, b) => s + b.lbs_spend, 0);
  pm.lbs_coverage_spend_pct = pct1(totLbsSpend, pm.total_protein_spend);
  for (const b of pm.by_type) {
    b.pct_of_protein_spend = pct1(b.spend, pm.total_protein_spend);
    b.pct_of_protein_lbs = pm.total_protein_lbs > 0 ? pct1(b.lbs, pm.total_protein_lbs) : null;
  }
}
A6.protein_mix = proteinMix;

// -----------------------------------------------------------------------
// Recompute Weight & Coverage
// -----------------------------------------------------------------------
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
  if (basis === "food") weight[acct].core_food_spend_dollar_set += ep;
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
    if (c.coverage_spend_pct < P5.PUBLICATION_THRESHOLD_PCT) c._publication = `suppressed (${c.coverage_spend_pct}% below 25%)`;
    else if (c.coverage_spend_pct < P5.PUBLICATION_CAVEAT_HIGH_PCT) c._publication = `publish with caveat (${c.coverage_spend_pct}% coverage)`;
    else c._publication = "publish";
    byCat.push(c);
  }
  byCat.sort((a,b) => b.food_spend_dollar_set - a.food_spend_dollar_set);
  w.by_category = byCat;
}
A6.weight = weight;

// -----------------------------------------------------------------------
// Per-meal (Addendum A1: canonical denominators)
// Sparse-month projection-substitution is DISABLED for this window.
// TBR/TBJ/STL now use the calendar-derived canon in _denominators.mjs.
// -----------------------------------------------------------------------
const STL_PROJ_TOTAL = STL_CANON.total; // 18,860 - unchanged from Q6
const TBR_TOTAL = TBR_CANON.total;      // 20,300 (MiLB 18,680 + B&G 1,620)
const TBJ_TOTAL = TBJ_CANON.total;      // 29,541

const perAcctCanon = {
  "TBR-FL": { total: TBR_TOTAL, monthly: TBR_CANON.monthly, source: TBR_CANON.source, components: TBR_CANON.components },
  "TBJ-FL": { total: TBJ_TOTAL, monthly: TBJ_CANON.monthly, source: TBJ_CANON.source },
  "STL-FL": { total: STL_PROJ_TOTAL, monthly: STL_CANON.monthly, source: STL_CANON.source, components: STL_CANON.components },
};

// Capture pre-canon (sparse-substituted) values for the change record
const preCanon = {};
for (const acct of ACCOUNTS) {
  const pm = A6.per_meal[acct];
  if (!pm) continue;
  preCanon[acct] = {
    window_meals_used: pm.window_meals_used,
    window_dollars_per_meal: pm.window_dollars_per_meal,
    window_dollars_per_meal_core: pm.window_dollars_per_meal_core,
    window_lbs_per_meal: pm.window_lbs_per_meal,
    window_lbs_per_meal_core: pm.window_lbs_per_meal_core,
  };
}

// Rewrite per_meal for each account against canon.
for (const acct of ACCOUNTS) {
  const canon = perAcctCanon[acct];
  if (!canon) continue;
  if (!A6.per_meal[acct]) A6.per_meal[acct] = { account: acct, monthly: {} };
  const pm = A6.per_meal[acct];
  const w = A6.weight[acct];
  const meals = canon.total;

  // window totals
  pm.window_meals_used = meals;
  pm.window_meals_source = "calendar_canonical";
  pm.window_meals_source_note = "Addendum A1: calendar-derived canon replacing sparse-substituted actuals.";
  pm.window_meals_note = canon.source;
  pm.window_meals_monthly_canon = canon.monthly;
  if (canon.components) pm.window_meals_components = canon.components;

  // dollar spend fields exist in A4/A6 spend structure; pick the food+core
  const spendA = A6.spend?.[acct] || A4.spend?.[acct] || {};
  const foodSpend = pm.window_food_spend ?? spendA.dollar_food_spend ?? null;
  const coreFoodSpend = w?.core_food_spend_dollar_set ?? spendA.dollar_core_food_spend ?? null;

  if (foodSpend && meals) pm.window_dollars_per_meal = round2(foodSpend / meals);
  if (coreFoodSpend && meals) pm.window_dollars_per_meal_core = round2(coreFoodSpend / meals);

  if (w) {
    pm.window_food_lbs = w.food_lbs;
    pm.window_core_food_lbs = w.core_food_lbs;
    pm.window_lbs_per_meal = meals ? round2(w.food_lbs / meals) : null;
    pm.window_lbs_per_meal_core = meals ? round2(w.core_food_lbs / meals) : null;
    pm.window_lbs_coverage_pct = w.coverage_food_spend_pct;
    pm.window_lbs_coverage_core_pct = w.coverage_core_food_spend_pct;
  }

  // A3: B&G disclosure on all TBR per-cover figures
  if (acct === "TBR-FL") {
    pm._bg_disclosure = BG_DISCLOSURE;
    pm._bg_component_meals = TBR_CANON.components?.bg ?? 1620;
    pm._milb_component_meals = TBR_CANON.components?.milb ?? 18680;
  }
}

// -----------------------------------------------------------------------
// R8: Standing build-time hard-fail gate
// core-food protein lbs / window covers > 0.6
// TBR/TBJ denominator = A6.per_meal[acct].window_meals_used
// STL denominator = 18,860 (Q6)
// In BASELINE mode: warn-only. In V6 mode: throw.
// -----------------------------------------------------------------------
function coreFoodProteinLbs(acct) {
  const pm = A6.protein_mix[acct];
  let s = 0;
  for (const b of pm.by_type) {
    if (b.type === "plant_or_egg" || b.type === "other") continue;
    s += b.lbs;
  }
  return round1(s);
}

const gateResult = {};
for (const acct of ACCOUNTS) {
  const denom = acct === "STL-FL" ? STL_PROJ_TOTAL : A6.per_meal[acct]?.window_meals_used;
  const lbs = coreFoodProteinLbs(acct);
  const ratio = denom ? round2(lbs / denom) : null;
  gateResult[acct] = { core_food_protein_lbs: lbs, denom, ratio, breach: ratio != null && ratio > 0.6 };
  console.log(`  [R8] ${acct}: core-food protein lbs=${lbs}  denom=${denom}  lbs/meal=${ratio}  ${gateResult[acct].breach ? "BREACH (>0.6)" : "pass"}`);
}
const gateHit = Object.values(gateResult).some(v => v.breach);
if (gateHit && BASELINE) {
  console.warn("\n[R8] baseline mode: gate would FIRE (as expected). Continuing.");
}
if (gateHit && !BASELINE) {
  console.warn("\n[R8] v6 mode: gate BREACHED. Writing outputs and diagnostics for inspection; exit-nonzero at end.");
}

// -----------------------------------------------------------------------
// R10: change log (diff v6 vs v5-logic-baseline row-by-row)
// Only computed in v6 mode.
// -----------------------------------------------------------------------
const change_log_entries = [];
if (!BASELINE) {
  for (const r of rows) {
    const beforeLb = baselineEffLb(r);
    const afterLb = effectiveLb(r);
    const beforeIn = baselineInWeightSet(r);
    const afterIn = inWeightSet(r);
    if (beforeIn === afterIn && (beforeLb ?? null) === (afterLb ?? null)) continue;
    const beforeSrc = baselineEffSource(r);
    const afterSrc = effectiveSource(r);
    // Determine rule
    let rule = "unchanged";
    if (beforeIn && !afterIn) {
      if (bandGatedOut.some(x => x.id === r.id)) rule = "R6_band_out_of_range";
      else if (p5FusedBeverageDropped.has(r.id)) rule = "R7_fluid_oz_restoration";
      else if (r.review_reason === "ep_qty_up_mismatch" && catchReclassIdsAll.has(r.id) && !catchAdmitted.has(r.id)) rule = "R5_arith_gate_failed";
      else rule = "dropped_other";
    } else if (!beforeIn && afterIn) {
      rule = catchAdmitted.has(r.id) ? "R4_catch_implied" : "added_other";
    } else if (beforeIn && afterIn && beforeLb !== afterLb) {
      rule = catchAdmitted.has(r.id) ? "R4_catch_implied_replaces_layer" : "weight_shifted_other";
    }
    change_log_entries.push({
      id: r.id,
      account: normAcct(r.account_label),
      category: r.category,
      protein_type: assignProteinType(r.description),
      before_lb: beforeLb != null ? round1(beforeLb) : null,
      before_source: beforeSrc,
      before_in_weight_set: beforeIn,
      after_lb: afterLb != null ? round1(afterLb) : null,
      after_source: afterSrc,
      after_in_weight_set: afterIn,
      rule,
      ep: Number(r.extended_price) || 0,
    });
  }
}

// R4 TBR swing check (dimensionless lbs and lbs/cover against canon)
let r4Result = null;
if (!BASELINE) {
  const tbrProteinBaseline = (() => {
    // Need baseline TBR core-food protein lbs. Recompute quickly.
    let lbs = 0;
    const seen = {};
    for (const r of rows) {
      const acct = normAcct(r.account_label);
      if (acct !== "TBR-FL") continue;
      const cat = String(r.category || "").toLowerCase();
      if (cat !== "protein") continue;
      if (r.review_reason === "invoice_over_extracted") continue;
      const t = assignProteinType(r.description);
      if (t === "plant_or_egg" || t === "other") continue;
      if (!baselineInWeightSet(r)) continue;
      lbs += baselineEffLb(r);
    }
    return round1(lbs);
  })();
  const tbrProteinV6 = coreFoodProteinLbs("TBR-FL");
  const swingPct = tbrProteinBaseline ? Math.round(((tbrProteinV6 - tbrProteinBaseline) / tbrProteinBaseline) * 1000) / 10 : null;
  const denomTBR = TBR_TOTAL;
  const lbsPerMealBaseline = denomTBR ? round2(tbrProteinBaseline / denomTBR) : null;
  const lbsPerMealV6 = denomTBR ? round2(tbrProteinV6 / denomTBR) : null;
  r4Result = {
    tbr_protein_baseline_lbs: tbrProteinBaseline,
    tbr_protein_v6_lbs: tbrProteinV6,
    swing_pct: swingPct,
    denom_canon: denomTBR,
    lbs_per_meal_baseline: lbsPerMealBaseline,
    lbs_per_meal_v6: lbsPerMealV6,
    breach_5pct: swingPct != null && Math.abs(swingPct) > 5,
  };
  console.log(`\n[R4] TBR core-food protein lbs: baseline ${tbrProteinBaseline} -> v6 ${tbrProteinV6}  swing ${swingPct}%`);
  console.log(`[R4] TBR lbs/cover against canon ${denomTBR}: baseline ${lbsPerMealBaseline} -> v6 ${lbsPerMealV6}`);
  if (swingPct != null && Math.abs(swingPct) > 5) {
    console.error(`\n[R4] STOP: TBR protein lbs swung more than 5% (${swingPct}%). Investigate before proceeding.`);
    // Do not process.exit here - continue to write outputs so operator can inspect.
  }
}

// -----------------------------------------------------------------------
// Dollar invariance check (v6 vs A4)
// -----------------------------------------------------------------------
const dollarCheck = { pass: true, issues: [] };
function checkAll(a, b, path = "") {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number") {
    if (/lbs|coverage|dollars_per_lb|dpp|weight/i.test(path)) return;
    if (/_phase4|_phase3|_phase5|_original|_item5|_note|_publication|_suppressed|_caveat|per_meal/i.test(path)) return;
    if (Math.abs(a - b) > 0.005) {
      dollarCheck.issues.push({ path, before: a, v6: b });
      dollarCheck.pass = false;
    }
    return;
  }
  if (typeof a !== "object" || typeof b !== "object") return;
  if (a === null || b === null) return;
  for (const k of Object.keys(a)) if (k in b) checkAll(a[k], b[k], path + "." + k);
}
for (const k of ["spend", "reconciliation"]) if (A4[k] && A6[k]) checkAll(A4[k], A6[k], k);

// -----------------------------------------------------------------------
// Write outputs
// -----------------------------------------------------------------------
const outPath = BASELINE ? P6.ANALYSIS_BASELINE : P6.ANALYSIS_V6;
const logPath = BASELINE ? P6.CHANGE_LOG_BASELINE : P6.CHANGE_LOG;

A6._phase6 = {
  mode: MODE,
  build_date: new Date().toISOString().slice(0, 10),
  gate_result: gateResult,
  band_gated_out_count: bandGatedOut.length,
  catch_admitted: catchAdmitted.size,
  catch_gated_out_count: catchGatedOut.length,
  p5_fused_beverage_dropped: p5FusedBeverageDropped.size,
  catch_implied_layer_size: catchImpliedById.size,
  dollar_invariance: dollarCheck,
  addendum_a1: {
    canon_denominators: {
      "TBR-FL": TBR_TOTAL,
      "TBJ-FL": TBJ_TOTAL,
      "STL-FL": STL_PROJ_TOTAL,
    },
    pre_canon_per_meal: preCanon,
    sparse_month_substitution: "disabled_for_window",
    source: "Kevin's 2026 TBR + TBJ Service Calendars + STL 2027 projections; Chat-Claude ruling",
  },
  addendum_a3: {
    bg_disclosure: BG_DISCLOSURE,
    tbr_component_meals: TBR_CANON.components,
    contract_specs_source: "kitchfix-intranet/content/documents/REF-121.mdx (BGC Contract Digest)",
  },
  r4_result: r4Result,
};
fs.writeFileSync(outPath, JSON.stringify(A6, null, 2));
fs.writeFileSync(logPath, JSON.stringify({
  meta: {
    mode: MODE,
    build_date: new Date().toISOString().slice(0, 10),
    rules_applied: BASELINE ? [] : ["R4_catch_implied", "R5_arith_gate", "R6_band_gate", "R7_fluid_oz", "R8_hard_fail_gate"],
  },
  gate_result: gateResult,
  band_gated_out: bandGatedOut,
  catch_admitted_count: catchAdmitted.size,
  catch_gated_out_count: catchGatedOut.length,
  catch_gated_out: catchGatedOut,
  p5_fused_beverage_dropped_count: p5FusedBeverageDropped.size,
  p5_fused_beverage_dropped_ids: [...p5FusedBeverageDropped],
  entries: change_log_entries,
  dollar_invariance: dollarCheck,
}, null, 2));

console.log(`\nwrote ${outPath}`);
console.log(`wrote ${logPath}`);

// -----------------------------------------------------------------------
// Headline
// -----------------------------------------------------------------------
console.log(`\n===== ${MODE} HEADLINE =====`);
for (const acct of ACCOUNTS) {
  const w = A6.weight[acct];
  const pm = A6.per_meal[acct];
  console.log(`  ${acct}: food_lbs ${w.food_lbs} core_food_lbs ${w.core_food_lbs} coverage_food ${w.coverage_food_spend_pct}% core ${w.coverage_core_food_spend_pct}%`);
  console.log(`         denom(canon)=${pm.window_meals_used}  $/meal=${pm.window_dollars_per_meal} $/meal core=${pm.window_dollars_per_meal_core}  lb/meal=${pm.window_lbs_per_meal} lb/meal core=${pm.window_lbs_per_meal_core}`);
  if (acct === "TBR-FL") console.log(`         [BG disclosure attached]`);
}
console.log(`\n===== ${MODE} PROTEIN MIX =====`);
for (const acct of ACCOUNTS) {
  const pm = A6.protein_mix[acct];
  console.log(`  ${acct}: total_lbs=${pm.total_protein_lbs}  cov=${pm.lbs_coverage_spend_pct}%`);
  for (const b of pm.by_type) {
    console.log(`     ${b.type.padEnd(14)} rows=${String(b.rows).padStart(4)} lbs_rows=${String(b.lbs_rows).padStart(4)} lbs=${(b.lbs||0).toFixed(1).padStart(8)} dpp=${b.dollars_per_lb}  cov=${(b.coverage_spend_pct||0)}%  [${b._publication}]`);
  }
}

if (gateHit && !BASELINE) process.exit(4);
