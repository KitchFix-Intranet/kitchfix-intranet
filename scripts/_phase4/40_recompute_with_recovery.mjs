// Phase 4 - recompute protein_mix + weight coverage tables with recovered rows.
//
// Approach: overlay recovered_rows onto Phase 3c analysis. This is scoped to
// weight-related cells only (weight, protein_mix, per_meal.lbs_per_meal).
// Dollar figures are NOT touched. Categories that saw NO recovered rows are
// byte-identical to Phase 3c.
//
// Application:
//   1. Load Phase 3c _analysis3c.json.
//   2. Load _recovered_rows.json.
//   3. For each recovered row: augment the protein_mix cell for its
//      (account, protein_type), and augment the weight coverage table.
//   4. Apply the 35% publication threshold - if coverage_spend_pct < 35%,
//      mark the cell as suppressed (leave the underlying numbers so the
//      workbook can render them under "review" but not publish $/lb).
//   5. Record every mutation in _change_log4.json.
//
// Special handling: TBJ-FL pork - Phase 3c EXCLUDED 16 bacon rows. Path B
// recovered 8 of those. The Phase 3c "post" bucket must add these 8 back to
// the pork bucket (both lbs and coverage_spend_pct sides).

import fs from "node:fs";
import { P, PUBLICATION_THRESHOLD_PCT, assignProteinType, loadAugmented, round1, round2, pct1, sumBy, inDollar } from "./_common4.mjs";

const A3C = JSON.parse(fs.readFileSync(P.ANALYSIS_3C, "utf8"));
const CL3C = JSON.parse(fs.readFileSync(P.CHANGE_LOG_3C, "utf8"));
const REC = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const AUG = loadAugmented();
const AUG_BY_ID = new Map(AUG.rows.map((r) => [r.id, r]));

// Deep clone to avoid mutating the on-disk file
const A4 = JSON.parse(JSON.stringify(A3C));

const change_log = {
  meta: {
    phase: "4",
    build_date: "2026-08-14",
    rule: "recovery-only (no re-classification, no threshold tuning, no dollar changes)",
    publication_threshold_pct: PUBLICATION_THRESHOLD_PCT,
  },
  path_a: {},
  path_b: {},
  path_c: {},
  protein_mix_updates: [],
  weight_coverage_updates: [],
  per_meal_updates: [],
  suppressions_from_35pct_threshold: [],
  cells_cleared_35pct: [],
  restored_cells_from_phase3c_bacon: {},
};

// -----------------------------------------------------------------------
// Group recovered rows by account + protein_type
// -----------------------------------------------------------------------
const recByAcctType = {};
for (const r of REC.recovered) {
  const row = AUG_BY_ID.get(r.id);
  if (!row) continue;
  const acct = row.account_label;
  const cat = String(row.category || "").toLowerCase();
  if (cat !== "protein") {
    // still count in weight coverage totals though
    continue;
  }
  const t = assignProteinType(row.description);
  const key = `${acct}::${t}`;
  if (!recByAcctType[key]) recByAcctType[key] = { rows: 0, spend: 0, lbs: 0, row_details: [] };
  recByAcctType[key].rows += 1;
  recByAcctType[key].spend += Number(r.ep);
  recByAcctType[key].lbs += Number(r.effective_weight_lb);
  recByAcctType[key].row_details.push({ id: r.id, tag: r.tag, path: r.path, effective_weight_lb: r.effective_weight_lb, ep: r.ep });
}

// -----------------------------------------------------------------------
// Path B special case: TBJ-FL pork bacon restoration
// -----------------------------------------------------------------------
// Phase 3c excluded 16 bacon rows from TBJ-FL pork. Path B recovered N of them.
// The Phase 3c post-cell for pork should now ADD BACK the recovered bacon rows.
//
// Phase 3c's item5 recompute set pork to:
//   lbs_rows=11, lbs=370.1, lbs_spend=$1,053.49, coverage_spend_pct=17.8%
// (after excluding all 16 bacon rows).
// Path B recovery adds back only the CONFIRMED-legible bacon rows. We compute:
//   - recovered bacon rows in TBJ pork = those Path B rows with row.category=protein AND assignProteinType(desc)=='pork' AND account=TBJ-FL AND source is bacon (LAYFLAT).
//   - The recovered rows are already in recByAcctType["TBJ-FL::pork"] so no
//     extra handling needed for the bacon rows themselves.
// The overlay logic below (per-bucket add) correctly adds their lbs + spend.

// -----------------------------------------------------------------------
// Apply overlay to protein_mix
// -----------------------------------------------------------------------
for (const acct of Object.keys(A4.protein_mix)) {
  const pm = A4.protein_mix[acct];
  const totalDollarSpend = pm.total_protein_spend;
  let addedLbs = 0;
  let addedLbsRows = 0;
  for (const bucket of pm.by_type) {
    const key = `${acct}::${bucket.type}`;
    const rec = recByAcctType[key];
    if (!rec) continue;
    // Phase 3c may have set _original_* fields. Add to current (post-3c) values.
    const preLbs = Number(bucket.lbs) || 0;
    const preLbsRows = Number(bucket.lbs_rows) || 0;
    const preLbsSpend = Number(bucket.lbs_spend) || 0;
    const postLbs = round1(preLbs + rec.lbs);
    const postLbsRows = preLbsRows + rec.rows;
    const postLbsSpend = round2(preLbsSpend + rec.spend);
    const postCovPct = pct1(postLbsSpend, bucket.spend);
    const postDpp = postLbs > 0 ? round2(postLbsSpend / postLbs) : null;
    change_log.protein_mix_updates.push({
      account: acct,
      type: bucket.type,
      before: {
        lbs_rows: preLbsRows, lbs: preLbs, lbs_spend: preLbsSpend,
        coverage_spend_pct: bucket.coverage_spend_pct, dollars_per_lb: bucket.dollars_per_lb,
      },
      recovered: { rows: rec.rows, spend: round2(rec.spend), lbs: round1(rec.lbs), row_details: rec.row_details },
      after: {
        lbs_rows: postLbsRows, lbs: postLbs, lbs_spend: postLbsSpend,
        coverage_spend_pct: postCovPct, dollars_per_lb: postDpp,
      },
    });
    bucket._phase4_recovered_lbs = round1(rec.lbs);
    bucket._phase4_recovered_lbs_spend = round2(rec.spend);
    bucket._phase4_recovered_rows = rec.rows;
    bucket._phase4_before = {
      lbs_rows: preLbsRows,
      lbs: preLbs,
      lbs_spend: preLbsSpend,
      coverage_spend_pct: bucket.coverage_spend_pct,
      dollars_per_lb: bucket.dollars_per_lb,
    };
    bucket.lbs_rows = postLbsRows;
    bucket.lbs = postLbs;
    bucket.lbs_spend = postLbsSpend;
    bucket.coverage_spend_pct = postCovPct;
    bucket.dollars_per_lb = postDpp;
    addedLbs += rec.lbs;
    addedLbsRows += rec.rows;
    // If the previous state was suppressed, and post-recovery coverage >= threshold, mark cell as CLEARED
    if (postCovPct >= PUBLICATION_THRESHOLD_PCT) {
      change_log.cells_cleared_35pct.push({
        account: acct, cell: `protein_mix.${bucket.type}.dollars_per_lb`,
        before_pct: change_log.protein_mix_updates[change_log.protein_mix_updates.length - 1].before.coverage_spend_pct,
        after_pct: postCovPct,
      });
    }
  }
  // Update account-level totals
  const preTotalLbs = pm.total_protein_lbs;
  const preLbsCovPct = pm.lbs_coverage_spend_pct;
  pm.total_protein_lbs = round1(preTotalLbs + addedLbs);
  const totalLbsSpend = pm.by_type.reduce((s, b) => s + Number(b.lbs_spend || 0), 0);
  pm.lbs_coverage_spend_pct = pct1(totalLbsSpend, pm.total_protein_spend);
  pm._phase4_added_lbs = round1(addedLbs);
  pm._phase4_added_rows = addedLbsRows;
  pm._phase4_before_total_lbs = preTotalLbs;
  pm._phase4_before_lbs_coverage = preLbsCovPct;
}

// -----------------------------------------------------------------------
// Apply 35% publication threshold on protein_mix cells
// -----------------------------------------------------------------------
for (const acct of Object.keys(A4.protein_mix)) {
  const pm = A4.protein_mix[acct];
  for (const b of pm.by_type) {
    if (b.type === "plant_or_egg") {
      // Path D: plant_or_egg is a category that will NOT resolve to lbs (eggs sold by count).
      // Explicitly mark suppressed for coverage purpose (not below-threshold).
      b._phase4_dpp_suppression_reason = "plant_or_egg category - eggs sold by count, not weight; excluded from lbs-per-meal denominators";
      b._phase4_suppressed = true;
      b._phase4_pub_dollars_per_lb = "not comparable (plant_or_egg - sold by count)";
      continue;
    }
    if (b.coverage_spend_pct < PUBLICATION_THRESHOLD_PCT) {
      b._phase4_dpp_suppression_reason = `coverage ${b.coverage_spend_pct}% < 35% publication threshold`;
      b._phase4_suppressed = true;
      b._phase4_pub_dollars_per_lb = `suppressed - ${b.coverage_spend_pct}% coverage below 35% publication threshold`;
      change_log.suppressions_from_35pct_threshold.push({
        account: acct,
        cell: `protein_mix.${b.type}.dollars_per_lb`,
        coverage_spend_pct: b.coverage_spend_pct,
        dollars_per_lb_would_have_been: b.dollars_per_lb,
      });
    } else {
      b._phase4_pub_dollars_per_lb = b.dollars_per_lb;
      b._phase4_suppressed = false;
    }
  }
}

// -----------------------------------------------------------------------
// Update weight coverage table (Weight & Coverage sheet)
// -----------------------------------------------------------------------
for (const acct of Object.keys(A4.weight)) {
  const w = A4.weight[acct];
  // Add recovered rows to overall coverage
  let addedFoodLbs = 0;
  let addedCoreFoodLbs = 0;
  let addedFoodSpend = 0;
  let addedCoreFoodSpend = 0;
  let recRows = 0;
  for (const r of REC.recovered) {
    const row = AUG_BY_ID.get(r.id);
    if (!row) continue;
    if (row.account_label !== acct) continue;
    // Match Phase 3b assignBasis: only 'food' basis. Recovery ignores non-food.
    // Recovery-only rows are all in food-based buckets (bacon/protein/seafood/pork/beef/poultry/pep etc)
    // For weight coverage, we count in food_spend + core_food_spend.
    const cat = String(row.category || "").toLowerCase();
    if (["cleaning","chemical","chemicals","supplies","packaging","smallwares","linen","uniform"].includes(cat)) continue;
    const isFood = cat === "protein" || cat === "poultry" || cat === "meat" || cat === "seafood" || cat === "dairy" || cat === "dry_goods" || cat === "grocery" || cat === "produce" || cat === "frozen" || cat === "snacks";
    const isBev = cat === "beverage";
    if (isFood) {
      addedFoodLbs += r.effective_weight_lb;
      addedCoreFoodLbs += r.effective_weight_lb;
      addedFoodSpend += r.ep;
      addedCoreFoodSpend += r.ep;
      recRows += 1;
    } else if (isBev) {
      addedFoodLbs += r.effective_weight_lb;
      addedFoodSpend += r.ep;
      recRows += 1;
    }
  }
  const preFoodLbs = w.food_lbs || 0;
  const preFoodSpendWs = w.food_spend_weight_set || 0;
  const preCovFoodSpend = w.coverage_food_spend_pct;
  const foodSpendTotal = w.food_spend_dollar_set;
  const postFoodLbs = round1(preFoodLbs + addedFoodLbs);
  const postFoodSpendWs = round2(preFoodSpendWs + addedFoodSpend);
  const postCovFoodPct = pct1(postFoodSpendWs, foodSpendTotal);
  w._phase4_before = {
    food_lbs: preFoodLbs,
    food_spend_weight_set: preFoodSpendWs,
    coverage_food_spend_pct: preCovFoodSpend,
  };
  w._phase4_added_rows = recRows;
  w._phase4_added_food_lbs = round1(addedFoodLbs);
  w._phase4_added_food_spend = round2(addedFoodSpend);
  w.food_lbs = postFoodLbs;
  w.food_spend_weight_set = postFoodSpendWs;
  w.coverage_food_spend_pct = postCovFoodPct;

  // core_food equivalents
  const preCoreLbs = w.core_food_lbs || 0;
  const preCoreSpendWs = w.core_food_spend_weight_set || 0;
  const coreFoodSpendTotal = w.core_food_spend_dollar_set;
  const postCoreLbs = round1(preCoreLbs + addedCoreFoodLbs);
  const postCoreSpendWs = round2(preCoreSpendWs + addedCoreFoodSpend);
  const postCovCoreFoodPct = pct1(postCoreSpendWs, coreFoodSpendTotal);
  w.core_food_lbs = postCoreLbs;
  w.core_food_spend_weight_set = postCoreSpendWs;
  w.coverage_core_food_spend_pct = postCovCoreFoodPct;

  // Per-category food coverage add.
  for (const cat of w.by_category) {
    const catName = String(cat.category || "").toLowerCase();
    let catAddLbs = 0;
    let catAddSpend = 0;
    let catAddRows = 0;
    for (const r of REC.recovered) {
      const row = AUG_BY_ID.get(r.id);
      if (!row || row.account_label !== acct) continue;
      const rcat = String(row.category || "").toLowerCase();
      if (rcat === catName) {
        catAddLbs += r.effective_weight_lb;
        catAddSpend += r.ep;
        catAddRows += 1;
      }
    }
    if (catAddRows > 0) {
      cat._phase4_added_lbs = round1(catAddLbs);
      cat._phase4_added_spend = round2(catAddSpend);
      cat._phase4_added_rows = catAddRows;
      cat._phase4_before = {
        weight_lbs: cat.weight_lbs,
        dollars_per_lb: cat.dollars_per_lb,
        coverage_spend_pct: cat.coverage_spend_pct,
        food_spend_weight_set: cat.food_spend_weight_set,
        food_rows_weight_set: cat.food_rows_weight_set,
      };
      const newLbs = round1((cat.weight_lbs || 0) + catAddLbs);
      const newSpendWs = round2((cat.food_spend_weight_set || 0) + catAddSpend);
      const newRowsWs = (cat.food_rows_weight_set || 0) + catAddRows;
      cat.weight_lbs = newLbs;
      cat.food_spend_weight_set = newSpendWs;
      cat.food_rows_weight_set = newRowsWs;
      cat.coverage_spend_pct = pct1(newSpendWs, cat.food_spend_dollar_set);
      cat.coverage_rows_pct = pct1(newRowsWs, cat.food_rows_dollar_set);
      cat.dollars_per_lb = newLbs > 0 ? round2(newSpendWs / newLbs) : null;
    }
  }
  change_log.weight_coverage_updates.push({
    account: acct,
    added_rows: recRows,
    added_food_lbs: round1(addedFoodLbs),
    added_food_spend: round2(addedFoodSpend),
    before_coverage_food_spend_pct: preCovFoodSpend,
    after_coverage_food_spend_pct: postCovFoodPct,
    before_coverage_core_food_spend_pct: A3C.weight[acct].coverage_core_food_spend_pct,
    after_coverage_core_food_spend_pct: postCovCoreFoodPct,
  });
}

// -----------------------------------------------------------------------
// Update per-meal.lbs_per_meal for the two non-STL accounts
// -----------------------------------------------------------------------
// STL is suppressed by Phase 3c item 3 already. TBR + TBJ per-meal lbs may
// shift with recovered lbs (their weight coverage improved).
for (const acct of ["TBR-FL", "TBJ-FL"]) {
  const pm = A4.per_meal[acct];
  if (!pm) continue;
  const w = A4.weight[acct];
  const meals = pm.window_meals_used;
  if (meals && w.food_lbs) {
    pm._phase4_before_lbs_per_meal = pm.window_lbs_per_meal;
    pm._phase4_before_lbs_per_meal_core = pm.window_lbs_per_meal_core;
    pm.window_food_lbs = w.food_lbs;
    pm.window_core_food_lbs = w.core_food_lbs;
    pm.window_lbs_per_meal = round2(w.food_lbs / meals);
    pm.window_lbs_per_meal_core = w.core_food_lbs ? round2(w.core_food_lbs / meals) : null;
    pm.window_lbs_coverage_pct = w.coverage_food_spend_pct;
    pm.window_lbs_coverage_core_pct = w.coverage_core_food_spend_pct;
    change_log.per_meal_updates.push({
      account: acct,
      before_lbs_per_meal: pm._phase4_before_lbs_per_meal,
      after_lbs_per_meal: pm.window_lbs_per_meal,
      before_lbs_per_meal_core: pm._phase4_before_lbs_per_meal_core,
      after_lbs_per_meal_core: pm.window_lbs_per_meal_core,
    });
  }
}

// -----------------------------------------------------------------------
// Update item_master with parsed_weight_source tags for recovered rows
// -----------------------------------------------------------------------
if (A4.item_master) {
  // item_master is a distinct-SKU aggregation; add a p4_recovery tag when the SKU
  // has recovered rows.
  const recoveredSkuKeys = new Map(); // vendor_id::item_number OR vendor_id::desc -> {tag, path, rows_recovered}
  for (const r of REC.recovered) {
    const row = AUG_BY_ID.get(r.id);
    if (!row) continue;
    const key = row.vendor_id + "::" + (row.item_number || row.description);
    if (!recoveredSkuKeys.has(key)) recoveredSkuKeys.set(key, { tag: r.tag, path: r.path, rows_recovered: 0 });
    recoveredSkuKeys.get(key).rows_recovered += 1;
  }
  for (const it of A4.item_master) {
    const key = it.vendor_id + "::" + (it.item_number || it.description);
    const rec = recoveredSkuKeys.get(key);
    if (rec) {
      it._phase4_recovery_tag = rec.tag;
      it._phase4_recovery_path = rec.path;
      it._phase4_recovery_rows = rec.rows_recovered;
    }
  }
}

// -----------------------------------------------------------------------
// Dollar-figure invariance check
// -----------------------------------------------------------------------
const dollarCheck = { pass: true, issues: [] };
function checkAll(a, b, path = "") {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number") {
    // Only allow diff in lbs/coverage/dpp fields (weight-related)
    if (/lbs|coverage|dollars_per_lb|dpp|weight/i.test(path)) return;
    // ALSO skip suppression/status fields
    if (/_phase4|_phase3|_original|_item5|_note/i.test(path)) return;
    if (Math.abs(a - b) > 0.005) {
      dollarCheck.issues.push({ path, phase3c: a, phase4: b });
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
// Check dollar-related keys on top-level structures
for (const k of ["spend", "reconciliation"]) {
  if (A3C[k] && A4[k]) checkAll(A3C[k], A4[k], k);
}
for (const acct of Object.keys(A3C.protein_mix || {})) {
  const p3 = A3C.protein_mix[acct];
  const p4 = A4.protein_mix[acct];
  if (Math.abs(p3.total_protein_spend - p4.total_protein_spend) > 0.005) {
    dollarCheck.issues.push({ path: `protein_mix.${acct}.total_protein_spend`, phase3c: p3.total_protein_spend, phase4: p4.total_protein_spend });
    dollarCheck.pass = false;
  }
  for (const b3 of p3.by_type) {
    const b4 = p4.by_type.find((x) => x.type === b3.type);
    if (!b4) continue;
    if (Math.abs(b3.spend - b4.spend) > 0.005) {
      dollarCheck.issues.push({ path: `protein_mix.${acct}.${b3.type}.spend`, phase3c: b3.spend, phase4: b4.spend });
      dollarCheck.pass = false;
    }
  }
}
change_log.dollar_invariance_check = dollarCheck;

// -----------------------------------------------------------------------
// Write out
// -----------------------------------------------------------------------
A4._phase4 = { build_date: "2026-08-14", publication_threshold_pct: PUBLICATION_THRESHOLD_PCT };
fs.writeFileSync(P.P4_ANALYSIS, JSON.stringify(A4, null, 2));
fs.writeFileSync(P.P4_CHANGE_LOG, JSON.stringify(change_log, null, 2));

console.log(`[4-recompute] dollar-invariance check: ${dollarCheck.pass ? "PASS" : "FAIL"} (${dollarCheck.issues.length} issues)`);
console.log(`[4-recompute] protein_mix updates: ${change_log.protein_mix_updates.length}`);
console.log(`[4-recompute] weight_coverage updates: ${change_log.weight_coverage_updates.length}`);
console.log(`[4-recompute] per_meal updates: ${change_log.per_meal_updates.length}`);
console.log(`[4-recompute] cells cleared 35% threshold: ${change_log.cells_cleared_35pct.length}`);
console.log(`[4-recompute] cells suppressed by 35% threshold: ${change_log.suppressions_from_35pct_threshold.length}`);
console.log(`[4-recompute] wrote ${P.P4_ANALYSIS} + ${P.P4_CHANGE_LOG}`);
if (!dollarCheck.pass) {
  console.log(`[4-recompute] FAIL DOLLAR-INVARIANCE:`);
  for (const iss of dollarCheck.issues.slice(0, 10)) console.log(`   ${iss.path}: 3c=${iss.phase3c} 4=${iss.phase4}`);
}

// Summary printout
console.log(`\n===== PHASE 4 protein_mix outcomes =====`);
for (const acct of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const pm = A4.protein_mix[acct];
  console.log(`\n  ${acct}: total_protein_spend=$${pm.total_protein_spend} total_lbs=${pm.total_protein_lbs} coverage=${pm.lbs_coverage_spend_pct}% (was ${pm._phase4_before_lbs_coverage}%)`);
  for (const b of pm.by_type) {
    const before3c = b._phase4_before ? `pre-P4: cov=${b._phase4_before.coverage_spend_pct}% dpp=${b._phase4_before.dollars_per_lb}` : "";
    const status = b._phase4_suppressed ? `SUPPRESSED (${b._phase4_dpp_suppression_reason})` : "PUBLISH";
    console.log(`     ${b.type.padEnd(14)} spend=$${b.spend.toFixed(2).padStart(9)} lbs=${(b.lbs||0).toFixed(1).padStart(7)} cov=${(b.coverage_spend_pct||0).toString().padStart(5)}% dpp=${b.dollars_per_lb} [${status}] ${before3c}`);
  }
}
