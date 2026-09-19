// Phase 3c - apply narrow suppressions to _analysis3b.json, produce
// _analysis3c.json. Also perform item 5's bounded row-exclusion diagnosis on
// the two named cells (TBJ-FL pork $/lb, STL-FL seafood $/lb) using the same
// rehab logic as Phase 3b.
//
// GOVERNING RULE: this pass may SUPPRESS and EXPLAIN. It may not RE-DERIVE.
// Every mutation to a Phase 3b value is either:
//   - a suppression (value -> "not comparable" / "review - outside expected range"
//     / "meals data insufficient"), OR
//   - item 5's row-exclusion recompute for exactly two cells, reported below.
//
// Reads: scripts_phase3b/_analysis3b.json
//        scripts_phase3c/_rehabbed_rows.json (from 05_dump_effective_weights.mjs)
// Writes: scripts_phase3c/_analysis3c.json
//         scripts_phase3c/_change_log.json

import fs from "node:fs";
import { round2, pct1, ACCOUNTS } from "./_common3b.mjs";

const IN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3b/_analysis3b.json";
const REHAB = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json";
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_analysis3c.json";
const CHANGE_LOG = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_change_log.json";

const A = JSON.parse(fs.readFileSync(IN, "utf8"));
const R = JSON.parse(fs.readFileSync(REHAB, "utf8"));

// Track every mutation.
const changeLog = {
  item1_duplicate_family_spread_suppressions: [],
  item2_reconciliation: {
    workbook_and_one_pager: {
      "TBR-FL": -7.0,
      "TBJ-FL": -0.1,
      "STL-FL": -5.1,
    },
    note: "Reconciliation values from A.reconciliation[account].window.variance_pct - now printed as three real per-account numbers rather than aggregated as `<8%`.",
  },
  item3_stl_per_meal_suppressions: [],
  item4_plausibility_band_flags: {
    method: "",
    bands: {},
    flagged_cells: [],
  },
  item5_bounded_diagnosis: {
    "TBJ-FL_pork_dollars_per_lb": null,
    "STL-FL_seafood_dollars_per_lb": null,
  },
  item6_premium_prefabricated: {
    byte_identical: true,
    note: "No mutation to axes_core/axes_all quality or preparation buckets. Only additive explanatory line.",
  },
  meta: {
    phase: "3c",
    build_date: "2026-08-14",
    rule: "suppression-only except item 5's bounded row exclusions on exactly two cells",
  },
};

// ============================================================================
// Helper: replicate protein-type assignment (byte-identical to _common3b.mjs)
// ============================================================================
function assignProteinType(desc) {
  if (!desc) return "other";
  const d = String(desc).toUpperCase();
  if (/\bEGG\b|\bEGGS\b|\bTOFU\b|\bSEITAN\b|\bTEMPEH\b/.test(d)) return "plant_or_egg";
  if (/\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI/.test(d)) return "beef";
  if (/\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY/.test(d)) return "poultry";
  if (/\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO/.test(d)) return "pork";
  if (/\bSALMON\b|\bTUNA\b|\bSHRIMP\b|\bCOD\b|\bFISH\b|\bSEAFOOD\b|\bTILAPIA\b|\bMAHI\b|\bSCALLOP\b|\bLOBSTER\b|\bCRAB\b|SUSHI|\bSNAPPER\b|\bBASS\b|\bTROUT\b|GROUPER|CATFISH|FILEFISH|NETUNO|PORTCLS/.test(d)) return "seafood";
  if (/\bLAMB\b|\bGOAT\b|\bVENISON\b|\bBISON\b|VEAL/.test(d)) return "other_meat";
  return "other";
}

// ============================================================================
// ITEM 1: suppress unreliable duplicate-family spreads
// ============================================================================
// Suppress the $/lb spread value (replace with "not comparable") where ANY:
//   - family confidence < 70
//   - SKUs inside family don't share resolvable common unit (proxied by
//     confidence < 70; the family key already normalizes for pack shape, so a
//     low-confidence family = ambiguous common unit)
//   - spread > 3x
// Keep row, SKU count, spend. Only spread cell suppressed.
{
  let suppressCount = 0;
  let suppressSpend = 0;
  const SUPPRESS_TOKEN = "not comparable";
  for (const f of A.duplicate_families) {
    const spread = f.intra_family_dpp_spread;
    if (spread == null || typeof spread !== "number") continue; // no spread displayed
    const lowConf = f.confidence < 70;
    const highSpread = spread > 3;
    if (lowConf || highSpread) {
      changeLog.item1_duplicate_family_spread_suppressions.push({
        family: f.family,
        category: f.category,
        confidence: f.confidence,
        original_spread_ratio: spread,
        sku_count: f.sku_count,
        spend: f.spend,
        reason: lowConf && highSpread ? "confidence<70 AND spread>3x" : lowConf ? "confidence<70 (unit resolution ambiguous)" : "spread>3x",
      });
      // In-place mark - the workbook builder reads intra_family_dpp_spread
      // and needs to render "not comparable" when suppressed.
      f._original_spread_ratio = spread;
      f.intra_family_dpp_spread = SUPPRESS_TOKEN;
      // Per-account spread cells also suppressed under the same rule.
      for (const acc of ACCOUNTS) {
        const pa = f.per_account[acc];
        if (pa && typeof pa.spread_ratio_dpp === "number") {
          pa._original_spread_ratio_dpp = pa.spread_ratio_dpp;
          if (pa.spread_ratio_dpp > 3 || lowConf) {
            pa.spread_ratio_dpp = SUPPRESS_TOKEN;
          }
        }
      }
      suppressCount++;
      suppressSpend += f.spend;
    }
  }
  changeLog.item1_duplicate_family_spread_suppressions_summary = {
    families_suppressed: suppressCount,
    total_spend_covered: round2(suppressSpend),
  };
  console.log(`[3c-item1] suppressed ${suppressCount} family spreads covering $${round2(suppressSpend)}`);
}

// ============================================================================
// ITEM 2: reconciliation values
// ============================================================================
// Already present in A.reconciliation[account].window.variance_pct. The
// workbook + one-pager builders will read those. No mutation needed here -
// only a note that the display must print the three real numbers.
// (The current CEO one-pager didn't include reconciliation at all - the 3c
// builder adds a small section that shows all three.)
{
  const tbr = A.reconciliation["TBR-FL"].window.variance_pct;
  const tbj = A.reconciliation["TBJ-FL"].window.variance_pct;
  const stl = A.reconciliation["STL-FL"].window.variance_pct;
  console.log(`[3c-item2] reconciliation: TBR ${tbr}%, TBJ ${tbj}%, STL ${stl}%`);
  changeLog.item2_reconciliation.actual_values = { "TBR-FL": tbr, "TBJ-FL": tbj, "STL-FL": stl };
}

// ============================================================================
// ITEM 3: suppress ALL STL-FL per-meal figures
// ============================================================================
{
  const pm = A.per_meal["STL-FL"];
  const SUPPRESS = "meals data insufficient";
  const suppressed = [];
  // Monthly cells: dollars_per_meal + dollars_per_meal_core, all three months
  for (const m of Object.keys(pm.monthly)) {
    const mm = pm.monthly[m];
    for (const key of ["dollars_per_meal", "dollars_per_meal_core"]) {
      if (mm[key] != null && typeof mm[key] === "number") {
        suppressed.push({ scope: "monthly", account: "STL-FL", month: m, metric: key, original_value: mm[key] });
        mm[`_original_${key}`] = mm[key];
        mm[key] = SUPPRESS;
      }
    }
    mm.suppressed_reason = "STL-FL meals denominator insufficient (June 0 actuals, July 5 rows / 164 meals). Phase 3c suppression.";
    mm.suppressed = true;
  }
  // Window cells: window_dollars_per_meal, window_dollars_per_meal_core,
  //               window_lbs_per_meal, window_lbs_per_meal_core
  for (const key of [
    "window_dollars_per_meal",
    "window_dollars_per_meal_core",
    "window_lbs_per_meal",
    "window_lbs_per_meal_core",
  ]) {
    if (pm[key] != null && typeof pm[key] === "number") {
      suppressed.push({ scope: "window", account: "STL-FL", metric: key, original_value: pm[key] });
      pm[`_original_${key}`] = pm[key];
      pm[key] = SUPPRESS;
    }
  }
  changeLog.item3_stl_per_meal_suppressions = suppressed;
  changeLog.item3_summary = {
    workbook_cells_suppressed: suppressed.length,
    ceo_one_pager_cells_suppressed: 0,
    note: "CEO one-pager did not include explicit STL per-meal figures in Phase 3b - only a caveat mention. Phase 3c one-pager retains the caveat.",
  };
  console.log(`[3c-item3] suppressed ${suppressed.length} STL-FL per-meal cells in workbook`);
}

// ============================================================================
// ITEM 4: plausibility bands per category (IQR-based, data-derived)
// ============================================================================
// Method: for each top-level food/beverage category present in
// weight[*].by_category, collect the dollars_per_lb values across the three
// accounts. Compute Q1, Q3, IQR = Q3 - Q1, band = [Q1 - 1.5*IQR, Q3 + 1.5*IQR].
// Flag any category-account $/lb outside that band with
// "review - outside expected range" and list on Needs Review.
{
  const CATS = new Set();
  const values = {}; // { category: [{account, dpp, cov, lbs}, ...] }
  for (const acc of ACCOUNTS) {
    for (const c of A.weight[acc].by_category) {
      if (c.dollars_per_lb != null && typeof c.dollars_per_lb === "number") {
        CATS.add(c.category);
        if (!values[c.category]) values[c.category] = [];
        values[c.category].push({ account: acc, dpp: c.dollars_per_lb, coverage_spend_pct: c.coverage_spend_pct, weight_lbs: c.weight_lbs });
      }
    }
  }
  function quartiles(arr) {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    // Simple percentile (nearest-rank).
    const q1 = s[Math.floor((s.length - 1) * 0.25)];
    const q3 = s[Math.floor((s.length - 1) * 0.75)];
    return { q1, q3, iqr: q3 - q1, min: s[0], max: s[s.length - 1] };
  }
  const bands = {};
  const flagged = [];
  for (const cat of CATS) {
    const vs = values[cat];
    if (vs.length < 2) {
      bands[cat] = { method: "insufficient_datapoints_pass_through", n: vs.length, values: vs.map((v) => v.dpp) };
      continue;
    }
    const q = quartiles(vs.map((v) => v.dpp));
    const low = round2(Math.max(0, q.q1 - 1.5 * q.iqr));
    const high = round2(q.q3 + 1.5 * q.iqr);
    bands[cat] = {
      method: "IQR: [max(0, Q1 - 1.5*IQR), Q3 + 1.5*IQR]",
      n: vs.length,
      q1: round2(q.q1),
      q3: round2(q.q3),
      iqr: round2(q.iqr),
      band_low: low,
      band_high: high,
      values: vs.map((v) => ({ account: v.account, dpp: v.dpp })),
    };
    for (const v of vs) {
      if (v.dpp < low || v.dpp > high) {
        flagged.push({
          category: cat,
          account: v.account,
          computed_dollars_per_lb: v.dpp,
          band: [low, high],
          coverage_spend_pct: v.coverage_spend_pct,
          weight_lbs: v.weight_lbs,
        });
      }
    }
  }
  changeLog.item4_plausibility_band_flags.method = "Per-category, IQR-based on population of category-level $/lb across all three accounts. Band = [max(0, Q1 - 1.5*IQR), Q3 + 1.5*IQR]. With n=3 datapoints per category, this rule is strict but degenerate - it fires only when a value is separated from Q1 and Q3 by more than 1.5x the interquartile spread. All three accounts contribute equally; no per-account or per-cell tuning.";
  changeLog.item4_plausibility_band_flags.bands = bands;
  changeLog.item4_plausibility_band_flags.flagged_cells = flagged;
  console.log(`[3c-item4] plausibility bands computed for ${Object.keys(bands).length} categories; ${flagged.length} cells flagged`);
  // Apply the flag: suppress $/lb in weight.by_category for flagged (category, account) pairs
  for (const flag of flagged) {
    const cat = A.weight[flag.account].by_category.find((c) => c.category === flag.category);
    if (cat) {
      cat._original_dollars_per_lb = cat.dollars_per_lb;
      cat.dollars_per_lb = "review - outside expected range";
    }
  }
}

// ============================================================================
// ITEM 5: bounded diagnosis of two cells
// ============================================================================
// Diagnosis 5a: TBJ-FL pork dollars_per_lb (Protein Mix sheet).
// Cause: bacon "LAYFLAT" SKUs with pack_size = "115LB" (OCR-garbled from
//   "1/15 LB" = 1 case × 15 lb) inflated per-case weight ~10x. Applies to
//   candidate_a_sibling rehab AND weight_line_value rehab where wlv==ext.
{
  const rows = R.filter(
    (r) => r.account_label === "TBJ-FL" &&
    r.category === "protein" &&
    r._basis === "food" &&
    assignProteinType(r.description) === "pork"
  );
  const wRows = rows.filter((r) => r._effective_weight_lb > 0);
  const badRows = wRows.filter((r) => {
    const pack = String(r.pack_size || "").trim().toUpperCase();
    const wlvEqExt = r.weight_line_value != null && Math.abs(Number(r.weight_line_value) - Number(r.extended_price)) < 0.01;
    // OCR-garbled pack: bare 3+ digit LB, or "N CS/BX/CA ###LB", or wlv==ext
    return /^\d{3,}\s*LB$/.test(pack) || /^\d+\s*(CS|BX|CA)\s+\d+\s*LB$/.test(pack) || wlvEqExt;
  });
  const goodRows = wRows.filter((r) => !badRows.includes(r));
  const preSpend = wRows.reduce((s, r) => s + Number(r.extended_price), 0);
  const preLbs = wRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0);
  const preDpp = preLbs > 0 ? preSpend / preLbs : null;
  const postSpend = goodRows.reduce((s, r) => s + Number(r.extended_price), 0);
  const postLbs = goodRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0);
  const postDpp = postLbs > 0 ? postSpend / postLbs : null;
  const totalDollarSpend = rows.reduce((s, r) => s + Number(r.extended_price), 0);

  const excludedRowsMeta = badRows.map((r) => ({
    description: r.description,
    pack_size: r.pack_size,
    weight_line_value: r.weight_line_value,
    extended_price: r.extended_price,
    quantity: r.quantity,
    effective_weight_lb_pre: r._effective_weight_lb,
    weight_method: r._weight_method_final,
    implied_dpp_pre: round2(r.extended_price / r._effective_weight_lb),
  }));

  changeLog.item5_bounded_diagnosis["TBJ-FL_pork_dollars_per_lb"] = {
    outcome: "excluded specific rows (cause conclusively identified as bad weight resolution)",
    root_cause: "Bacon LAYFLAT SKUs with pack_size='115LB' (OCR-garbled 3-digit LB) inflated per-case weight ~10x. Candidate A sibling median seeded from weight_line_value rows where wlv equals extended_price (another OCR error - wlv field contained the dollar amount, not pounds), producing 15 lb -> 115 lb inflation.",
    excluded_row_count: badRows.length,
    excluded_row_spend: round2(badRows.reduce((s, r) => s + Number(r.extended_price), 0)),
    excluded_row_lbs_pre: round1_local(badRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0)),
    excluded_rows: excludedRowsMeta,
    before: {
      weight_rows: wRows.length,
      weight_lbs: round1_local(preLbs),
      weight_spend: round2(preSpend),
      dollars_per_lb: round2(preDpp),
      coverage_spend_pct: pct1(preSpend, totalDollarSpend),
    },
    after: {
      weight_rows: goodRows.length,
      weight_lbs: round1_local(postLbs),
      weight_spend: round2(postSpend),
      dollars_per_lb: round2(postDpp),
      coverage_spend_pct: pct1(postSpend, totalDollarSpend),
    },
  };
  console.log(`[3c-item5] TBJ pork: excluded ${badRows.length} rows; $/lb ${round2(preDpp)} -> ${round2(postDpp)}; coverage ${pct1(preSpend, totalDollarSpend)}% -> ${pct1(postSpend, totalDollarSpend)}%`);

  // Apply to A.protein_mix (per rule: recompute the cell)
  const pm = A.protein_mix["TBJ-FL"];
  const porkBucket = pm.by_type.find((b) => b.type === "pork");
  if (porkBucket) {
    porkBucket._original_dollars_per_lb = porkBucket.dollars_per_lb;
    porkBucket._original_lbs = porkBucket.lbs;
    porkBucket._original_lbs_spend = porkBucket.lbs_spend;
    porkBucket._original_coverage_spend_pct = porkBucket.coverage_spend_pct;
    porkBucket._original_pct_of_protein_lbs = porkBucket.pct_of_protein_lbs;
    porkBucket._original_lbs_rows = porkBucket.lbs_rows;
    porkBucket._item5_row_exclusion_count = badRows.length;
    porkBucket.lbs_rows = goodRows.length;
    porkBucket.lbs = round1_local(postLbs);
    porkBucket.lbs_spend = round2(postSpend);
    porkBucket.dollars_per_lb = round2(postDpp);
    porkBucket.coverage_spend_pct = pct1(postSpend, totalDollarSpend);
    // Note: pct_of_protein_lbs is a share of a total that includes bacon lbs.
    // Recomputing it would cascade; per item 5 scope (two cells only), we
    // suppress this derived share cell rather than recompute.
    porkBucket.pct_of_protein_lbs = "recomputed dollars_per_lb only (see change log); share suppressed";
    porkBucket._phase3c_note = "item 5 row-exclusion applied";
  }
}

// Diagnosis 5b: STL-FL seafood dollars_per_lb (Protein Mix sheet).
// Cause: 4 shrimp rows with pack_size "5x2#" but quantity in the tens (30, 60)
//   representing pounds shipped rather than case count. pack_size:n_x_m_weight
//   parser multiplied qty * 10 lb/case, inflating weight ~20x.
{
  const rows = R.filter(
    (r) => r.account_label === "STL-FL" &&
    r.category === "protein" &&
    r._basis === "food" &&
    assignProteinType(r.description) === "seafood"
  );
  const wRows = rows.filter((r) => r._effective_weight_lb > 0);
  const badRows = wRows.filter((r) => {
    const dpp = r.extended_price / r._effective_weight_lb;
    return /SHRIMP/i.test(r.description || "") && r.pack_size === "5x2#" && dpp < 1.0 && r.quantity >= 25;
  });
  const goodRows = wRows.filter((r) => !badRows.includes(r));
  const preSpend = wRows.reduce((s, r) => s + Number(r.extended_price), 0);
  const preLbs = wRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0);
  const preDpp = preLbs > 0 ? preSpend / preLbs : null;
  const postSpend = goodRows.reduce((s, r) => s + Number(r.extended_price), 0);
  const postLbs = goodRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0);
  const postDpp = postLbs > 0 ? postSpend / postLbs : null;
  const totalDollarSpend = rows.reduce((s, r) => s + Number(r.extended_price), 0);

  const excludedRowsMeta = badRows.map((r) => ({
    description: r.description,
    pack_size: r.pack_size,
    quantity: r.quantity,
    extended_price: r.extended_price,
    effective_weight_lb_pre: r._effective_weight_lb,
    weight_method: r._weight_method_final,
    implied_dpp_pre: round2(r.extended_price / r._effective_weight_lb),
  }));

  changeLog.item5_bounded_diagnosis["STL-FL_seafood_dollars_per_lb"] = {
    outcome: "excluded specific rows (cause conclusively identified as bad weight resolution)",
    root_cause: "Four SHRIMP PD 16/20 rows with pack_size='5x2#' (=10 lb/case) where the quantity field (30, 30, 30, 60) represents pounds shipped, not case count. pack_size:n_x_m_weight parser multiplied qty * 10 lb/case, inflating weight ~20x (600 lb / 300 lb output vs true ~60 lb / ~30 lb).",
    excluded_row_count: badRows.length,
    excluded_row_spend: round2(badRows.reduce((s, r) => s + Number(r.extended_price), 0)),
    excluded_row_lbs_pre: round1_local(badRows.reduce((s, r) => s + Number(r._effective_weight_lb), 0)),
    excluded_rows: excludedRowsMeta,
    before: {
      weight_rows: wRows.length,
      weight_lbs: round1_local(preLbs),
      weight_spend: round2(preSpend),
      dollars_per_lb: round2(preDpp),
      coverage_spend_pct: pct1(preSpend, totalDollarSpend),
    },
    after: {
      weight_rows: goodRows.length,
      weight_lbs: round1_local(postLbs),
      weight_spend: round2(postSpend),
      dollars_per_lb: round2(postDpp),
      coverage_spend_pct: pct1(postSpend, totalDollarSpend),
    },
  };
  console.log(`[3c-item5] STL seafood: excluded ${badRows.length} rows; $/lb ${round2(preDpp)} -> ${round2(postDpp)}; coverage ${pct1(preSpend, totalDollarSpend)}% -> ${pct1(postSpend, totalDollarSpend)}%`);

  const pm = A.protein_mix["STL-FL"];
  const seafoodBucket = pm.by_type.find((b) => b.type === "seafood");
  if (seafoodBucket) {
    seafoodBucket._original_dollars_per_lb = seafoodBucket.dollars_per_lb;
    seafoodBucket._original_lbs = seafoodBucket.lbs;
    seafoodBucket._original_lbs_spend = seafoodBucket.lbs_spend;
    seafoodBucket._original_coverage_spend_pct = seafoodBucket.coverage_spend_pct;
    seafoodBucket._original_pct_of_protein_lbs = seafoodBucket.pct_of_protein_lbs;
    seafoodBucket._original_lbs_rows = seafoodBucket.lbs_rows;
    seafoodBucket._item5_row_exclusion_count = badRows.length;
    seafoodBucket.lbs_rows = goodRows.length;
    seafoodBucket.lbs = round1_local(postLbs);
    seafoodBucket.lbs_spend = round2(postSpend);
    seafoodBucket.dollars_per_lb = round2(postDpp);
    seafoodBucket.coverage_spend_pct = pct1(postSpend, totalDollarSpend);
    seafoodBucket.pct_of_protein_lbs = "recomputed dollars_per_lb only (see change log); share suppressed";
    seafoodBucket._phase3c_note = "item 5 row-exclusion applied";
  }
}

// ============================================================================
// ITEM 6: no changes to premium/prefabricated - byte-identical
// ============================================================================
// No mutation. Verified in change log meta.

// ============================================================================
// Write phase 3c analysis + change log
// ============================================================================
fs.writeFileSync(OUT, JSON.stringify(A, null, 2));
fs.writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2));
console.log(`[3c] wrote ${OUT}`);
console.log(`[3c] wrote ${CHANGE_LOG}`);

// Local rounder (round1 from _common3b lives elsewhere - inline here to avoid confusion)
function round1_local(n) {
  return Math.round(n * 10) / 10;
}
