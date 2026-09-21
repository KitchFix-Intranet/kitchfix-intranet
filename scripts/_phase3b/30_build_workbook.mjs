// Build the corrected Phase 3b workbook. Overwrites the existing xlsx.
//
// Sheets (order):
//   1. Summary                       (rewritten - category mix leads)
//   2. Methodology                   (updated with 3b fix log)
//   3. Account Comparison            (core_food + food side-by-side, meals honestly labeled)
//   4. Category Mix (NEW-3b)         (protein/produce/dairy/dry-goods/beverage share)
//   5. Category Totals               (all categories, corrected mapping)
//   6. Premium vs Commodity          (core_food + food both bases)
//   7. Prefabricated vs Scratch      (core_food + food both bases)
//   8. Frozen vs Fresh               (core_food + food both bases)
//   9. Weight & Coverage             (post Fix 5 rehab, coverage stated)
//  10. Protein Mix (NEW-3b Fix 6)
//  11. Duplicate Item Families (NEW-3b Fix 6)
//  12. Top Items
//  13. Shared Basket                 (rewritten - $/lb primary, $/order fallback with pack_sizes)
//  14. Price Variance (NEW-3b scrub) - same SKU, different price across accounts
//  15. Price Drift (NEW-3b scrub)    - same SKU, May->Jul price change
//  16. Vendor Concentration (NEW-3b scrub)
//  17. Pareto (NEW-3b scrub)
//  18. Order Cadence (NEW-3b scrub)
//  19. Unique-to-account (NEW-3b scrub)
//  20. Item Master
//  21. Needs Review                  (adds suppressions)
//  22. Reconciliation
//  23. Fix Log (NEW-3b)              - what changed in this pass, dollar impact per account

import fs from "node:fs";
import ExcelJS from "exceljs";
import { P, ACCOUNTS, MONTHS } from "./_common3b.mjs";

const A = JSON.parse(fs.readFileSync(P.ANALYSIS_3B, "utf8"));

const wb = new ExcelJS.Workbook();
wb.creator = "Phase 3b purchasing analysis - fix pass";
wb.created = new Date();

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264653" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9C46A" } };
const SUBHEADER_FONT = { bold: true };
const PROJECTED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4E37E" } };
const SUPPRESSED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEE7B7B" } };
const SPARSE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B78E" } };
const CORE_FOOD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F0E0" } };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  row.height = 22;
}

function setColWidths(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function freezeHeaders(sheet, headerRowCount = 1) {
  sheet.views = [{ state: "frozen", xSplit: 0, ySplit: headerRowCount }];
}

// ============================================================================
// Sheet 1: Summary - category mix LEADS
// ============================================================================
{
  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 60;
  s.getColumn(2).width = 20;
  s.getColumn(3).width = 20;
  s.getColumn(4).width = 20;
  s.getColumn(5).width = 20;

  let r = 1;
  s.getCell(r++, 1).value = "Purchasing Comparison Analysis - Phase 3b (defect-fix pass)";
  s.getCell(r - 1, 1).font = { bold: true, size: 14 };
  s.getCell(r++, 1).value = `Window: ${A.window_label}`;
  s.getCell(r++, 1).value = "Scope: three months. Off-season overall for the main dining program; MiLB is in-season.";
  s.getCell(r++, 1).value = "Every figure is labeled DOLLAR SET or WEIGHT SET (see Methodology) AND food / core_food (excluding beverage) / all-lines basis.";
  s.getCell(r++, 1).value = "Do NOT extrapolate to annual - three-month window only. Do NOT extrapolate STL to a full-service kitchen either - the MiLB profile is different from a main-account.";
  r++;

  // LEAD FINDING: category mix
  s.getCell(r, 1).value = "Category mix by account (core_food $ basis - defensible, needs neither weight parser nor meals denominator)";
  s.getRow(r).font = { bold: true, size: 12 };
  r++;
  const cmHdr = s.getRow(r);
  cmHdr.values = ["Category", ...ACCOUNTS];
  styleHeaderRow(cmHdr);
  r++;
  const catsShown = ["protein", "produce", "dairy", "dry_goods", "other_food"];
  for (const cat of catsShown) {
    const row = s.getRow(r);
    row.getCell(1).value = `${cat} % of core_food $`;
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const cm = A.category_mix_headline[ACCOUNTS[i]];
      const v = cm.by_category[cat]?.pct_of_core_food || 0;
      const cell = row.getCell(2 + i);
      cell.value = v;
      cell.numFmt = '0.0"%"';
      cell.alignment = { horizontal: "right" };
      cell.fill = CORE_FOOD_FILL;
    }
    r++;
  }
  const cfRow = s.getRow(r);
  cfRow.getCell(1).value = "Core food $ (denominator)";
  cfRow.getCell(1).font = { bold: true };
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const cm = A.category_mix_headline[ACCOUNTS[i]];
    const cell = cfRow.getCell(2 + i);
    cell.value = cm.core_food_spend;
    cell.numFmt = "$#,##0.00";
    cell.alignment = { horizontal: "right" };
    cell.font = { bold: true };
  }
  r += 2;

  // Beverage separately (was the 2.4x premium artifact source)
  s.getCell(r, 1).value = "Beverage as a separate finding (% of food $ = core_food + beverage)";
  s.getRow(r).font = { bold: true };
  r++;
  const bvHdr = s.getRow(r);
  bvHdr.values = ["Metric", ...ACCOUNTS];
  styleHeaderRow(bvHdr);
  r++;
  {
    const row = s.getRow(r);
    row.getCell(1).value = "Beverage $ (window)";
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const cm = A.category_mix_headline[ACCOUNTS[i]];
      const cell = row.getCell(2 + i);
      cell.value = cm.beverage_spend;
      cell.numFmt = "$#,##0.00";
      cell.alignment = { horizontal: "right" };
    }
    r++;
  }
  {
    const row = s.getRow(r);
    row.getCell(1).value = "Beverage % of food total";
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const cm = A.category_mix_headline[ACCOUNTS[i]];
      const cell = row.getCell(2 + i);
      cell.value = cm.by_category.beverage.pct_of_food_total;
      cell.numFmt = '0.0"%"';
      cell.alignment = { horizontal: "right" };
    }
    r++;
  }
  r++;

  // Second finding: premium/commodity on BOTH bases side by side
  s.getCell(r, 1).value = "Premium vs commodity share (quality axis, core_food basis primary; food basis for reference)";
  s.getRow(r).font = { bold: true, size: 12 };
  r++;
  const pqHdr = s.getRow(r);
  pqHdr.values = ["Metric", ...ACCOUNTS];
  styleHeaderRow(pqHdr);
  r++;
  const premiumMetrics = [
    ["premium % of core_food $", (a) => bucketPct(A.classification[a].axes_core.quality.buckets, "premium"), "core"],
    ["premium % of food $ (incl beverage)", (a) => bucketPct(A.classification[a].axes_all.quality.buckets, "premium"), "all"],
    ["commodity % of core_food $", (a) => bucketPct(A.classification[a].axes_core.quality.buckets, "commodity"), "core"],
    ["commodity % of food $ (incl beverage)", (a) => bucketPct(A.classification[a].axes_all.quality.buckets, "commodity"), "all"],
    ["neutral % of core_food $", (a) => bucketPct(A.classification[a].axes_core.quality.buckets, "neutral"), "core"],
    ["below-70-confidence % of core_food $", (a) => A.classification[a].axes_core.quality.below_confidence_pct, "core"],
  ];
  for (const [label, fn, basis] of premiumMetrics) {
    const row = s.getRow(r);
    row.getCell(1).value = label;
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const cell = row.getCell(2 + i);
      cell.value = fn(ACCOUNTS[i]);
      cell.numFmt = '0.0"%"';
      cell.alignment = { horizontal: "right" };
      if (basis === "core") cell.fill = CORE_FOOD_FILL;
    }
    r++;
  }
  r += 2;

  // Row-set summary
  s.getCell(r, 1).value = "Row-set summary";
  s.getRow(r).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Total live rows in window";
  s.getCell(r, 2).value = A.total_live_rows;
  r++;
  s.getCell(r, 1).value = "DOLLAR SET excluded: review_reason='invoice_over_extracted'";
  s.getCell(r, 2).value = A.excluded_rows.invoice_over_extracted.count;
  s.getCell(r, 3).value = A.excluded_rows.invoice_over_extracted.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  s.getCell(r, 1).value = "WEIGHT SET rehab: ep_qty_up_mismatch rows with weight_line_value (Candidate B)";
  s.getCell(r, 2).value = A.excluded_rows.ep_qty_up_mismatch_rehabbed.count;
  s.getCell(r, 3).value = A.excluded_rows.ep_qty_up_mismatch_rehabbed.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  s.getCell(r, 1).value = "WEIGHT SET rehab: pack_size_ambiguous_multipack disambiguated via sibling SKU (Candidate A)";
  s.getCell(r, 2).value = A.excluded_rows.pack_size_ambiguous_multipack_rehabbed.count;
  s.getCell(r, 3).value = A.excluded_rows.pack_size_ambiguous_multipack_rehabbed.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  s.getCell(r, 1).value = "WEIGHT SET still excluded (unresolved / no sibling / no wlv)";
  s.getCell(r, 2).value = A.excluded_rows.ep_qty_up_mismatch_still_excluded.count + A.excluded_rows.pack_size_ambiguous_multipack_still_excluded.count;
  s.getCell(r, 3).value = A.excluded_rows.ep_qty_up_mismatch_still_excluded.spend + A.excluded_rows.pack_size_ambiguous_multipack_still_excluded.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  r++;

  s.getCell(r++, 1).value = "Legend on cells: green = core_food basis (excluding beverages); yellow = projected meal denominator; orange = actuals-sparse (also projected); red = suppressed cell.";
  s.getCell(r++, 1).value = "";
  s.getCell(r++, 1).value = "What this workbook CAN answer:";
  s.getCell(r - 1, 1).font = { bold: true };
  s.getCell(r++, 1).value = "  - Category mix by account (core_food basis) - the most defensible finding";
  s.getCell(r++, 1).value = "  - Beverage share as a distinct scope-difference finding";
  s.getCell(r++, 1).value = "  - Premium/commodity share on core_food (subject to LLM confidence caveats, beverages now excluded from the signal)";
  s.getCell(r++, 1).value = "  - $/meal normalized with honest meal-source labels; suppressed when computed > 3x window avg";
  s.getCell(r++, 1).value = "  - Protein type mix + $/lb by type, coverage stated";
  s.getCell(r++, 1).value = "  - Same-SKU price variance across accounts, and intra-window drift";
  r++;
  s.getCell(r++, 1).value = "What it CANNOT answer:";
  s.getCell(r - 1, 1).font = { bold: true };
  s.getCell(r++, 1).value = "  - Annual spend (three-month window)";
  s.getCell(r++, 1).value = "  - Precise dollar totals on invoice_over_extracted-flagged invoices (excluded)";
  s.getCell(r++, 1).value = "  - Pounds on volume-only lines or lines with unresolved packs (even after rehab, ~40% remain unresolved)";
  s.getCell(r++, 1).value = "  - Confidence on quality/prep/storage axis where the LLM returned < 70 (see Needs Review)";
  s.getCell(r++, 1).value = "  - Whether operator behavior is 'right' or 'wrong' - this is a comparison, not a verdict";

  freezeHeaders(s, 6);
}

function bucketPct(buckets, label) {
  const b = buckets.find((x) => x.label === label);
  return b ? b.pct_of_food_spend : 0;
}

// ============================================================================
// Sheet 2: Methodology
// ============================================================================
{
  const s = wb.addWorksheet("Methodology");
  s.getColumn(1).width = 90;
  s.getColumn(2).width = 30;

  let r = 1;
  s.getCell(r++, 1).value = "Methodology - Phase 3b";
  s.getCell(r - 1, 1).font = { bold: true, size: 14 };
  s.getCell(r++, 1).value = `Window: ${A.window_label}`;
  s.getCell(r++, 1).value = "Phase 3b amends Phase 3 to correct six analytical defects. Original file: PURCHASE_ANALYSIS_PHASE3.md.";
  r++;

  s.getCell(r++, 1).value = "Phase 3b fixes applied:";
  s.getRow(r - 1).font = { bold: true };
  const fixes = [
    ["Fix 1", "Beverage classification: any row with category='beverage' or matching a strong beverage description (BOTTLED WATER, SODA, GATORADE, RED BULL, COCONUT WATER/MILK, COLD BREW, KEG) has quality_axis forced to neutral. Bottled water/branded soda/energy drinks are never 'premium' in food-quality sense. Culinary exceptions (marsala, cooking wine) preserved."],
    ["Fix 1 (adjacent)", "Introduced core_food basis = food $ excluding beverage $. All headline figures reported both ways where the difference matters."],
    ["Fix 2", "Monthly meals denominator: sparse-actual months (< 50% of month days) now use projections (labeled 'projected' orange/yellow). Cells where computed $/meal exceeds 3x window average are suppressed (red) and logged on Needs Review."],
    ["Fix 3", "Shared Basket rewritten. Match key = (vendor_id, item_number) rather than description. Reports $/lb where lb coverage >= 50% in all three accounts; otherwise reports $/order + explicit pack_sizes list. Never publishes bare 'mean $/unit' across accounts."],
    ["Fix 4", "Category basis hardened. Every category explicitly assigned food/beverage/non_food/unknown. Categories cleaning, smallwares, chemical, chemicals now non_food (previously leaked into food-labeled tables via GL override). See Fix Log sheet for dollar impact per account."],
    ["Fix 5", `TBR-FL protein rehab: Candidate A (same-SKU sibling disambiguation for pack_size_ambiguous_multipack) + Candidate B (rehab ep_qty_up_mismatch rows with weight_line_value = vendor's printed catch weight). Decision gate = post-rehab coverage >= 25%. TBR protein went from 9.8% row-coverage to ${A.fix5_result.tbr_protein_weight_set_coverage_rows_pct}%. Gate: APPLIED.`],
    ["Fix 6", "Two new sheets: Protein Mix (spend + lbs share by type, per account) and Duplicate Item Families (SKU count + intra-family $/lb spread + fresh/frozen flag)."],
  ];
  for (const [label, txt] of fixes) {
    const row = s.getRow(r);
    row.getCell(1).value = `  ${label}: ${txt}`;
    row.getCell(1).alignment = { wrapText: true };
    row.height = Math.min(90, Math.max(20, Math.ceil(txt.length / 100) * 15));
    r++;
  }
  r++;

  s.getCell(r++, 1).value = "TWO-TIER quality filter (Phase 3 rule 3, still in force)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  DOLLAR SET: exclude review_reason='invoice_over_extracted'. All other rows kept.";
  s.getCell(r++, 1).value = "  WEIGHT SET (Phase 3b): rows where an effective weight was resolved. Rehab: catchweight rows with vendor-printed weight_line_value now count; pack-ambiguous rows with same-SKU sibling now count.";
  r++;

  s.getCell(r++, 1).value = "Category-to-basis mapping (Fix 4)";
  s.getRow(r - 1).font = { bold: true };
  const mappings = [
    ["food (counts in food + core_food)", "produce, protein, poultry, meat, seafood, dairy, dry_goods, grocery, frozen, snacks"],
    ["beverage (counts in food, NOT core_food)", "beverage"],
    ["non_food (never in food)", "supplies, packaging, chemical, chemicals, cleaning, smallwares, linen, uniform"],
    ["unknown (fall-through)", "other, (uncategorized), null, ''"],
  ];
  for (const [basis, cats] of mappings) {
    s.getCell(r, 1).value = `  ${basis}`;
    s.getCell(r, 2).value = cats;
    r++;
  }
  r++;

  s.getCell(r++, 1).value = "TBR-FL protein rehab diagnosis (Fix 5)";
  s.getRow(r - 1).font = { bold: true };
  const f5 = A.fix5_result;
  s.getCell(r++, 1).value = `  Pre-rehab: ${f5.tbr_protein_weight_set_rows_pre} of ${f5.tbr_protein_dollar_set_rows} TBR protein rows in WEIGHT SET (${(f5.tbr_protein_weight_set_rows_pre / f5.tbr_protein_dollar_set_rows * 100).toFixed(1)}% coverage).`;
  s.getCell(r++, 1).value = `  Candidate A (sibling disambig for pack_size_ambiguous_multipack): attempted ${f5.diagnosis.candidate_a.attempted}, applied ${f5.diagnosis.candidate_a.applied}, ${f5.diagnosis.candidate_a.no_sibling} rows had no sibling SKU, ${f5.diagnosis.candidate_a.bounds_rejected} rejected by category-plausibility bounds.`;
  s.getCell(r++, 1).value = `  Candidate B (weight_line_value rehab for ep_qty_up_mismatch): attempted ${f5.diagnosis.candidate_b.attempted}, applied ${f5.diagnosis.candidate_b.applied}, ${f5.diagnosis.candidate_b.no_wlv} rows had no vendor-printed weight, ${f5.diagnosis.candidate_b.bounds_rejected} rejected by $/lb category-plausibility.`;
  s.getCell(r++, 1).value = `  Post-rehab: ${f5.tbr_protein_weight_set_rows_post} rows (${f5.tbr_protein_weight_set_coverage_rows_pct}% row-coverage, ${f5.tbr_protein_weight_set_coverage_spend_pct}% spend-coverage).`;
  s.getCell(r++, 1).value = `  Decision: ${f5.decision_note}`;
  r++;

  s.getCell(r++, 1).value = "Meals denominator (Fix 2)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  STL-FL Jun 2026: actuals=0, use projection (yellow).";
  s.getCell(r++, 1).value = "  TBJ-FL Jul 2026 (12 rows) + STL-FL Jul 2026 (5 rows): sparse actuals substituted with projection (yellow).";
  s.getCell(r++, 1).value = "  Any monthly cell with computed $/meal > 3x window average = suppressed (red), logged on Needs Review.";
  r++;

  freezeHeaders(s, 1);
}

// ============================================================================
// Sheet 3: Account Comparison (core_food + food side by side)
// ============================================================================
{
  const s = wb.addWorksheet("Account Comparison");
  setColWidths(s, [40, 20, 20, 20, 20]);
  let r = 1;
  s.getCell(r, 1).value = "Account comparison - window totals unless noted. DOLLAR SET.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "core_food = food $ excluding beverage. Adjacent 'food' cells include beverage for reference.";
  r += 2;
  const header = s.getRow(r);
  header.values = ["Metric", ...ACCOUNTS, "Basis"];
  styleHeaderRow(header);
  r++;
  const rows = [
    ["DOLLAR SET total spend (all lines)", (a) => A.spend[a].dollar_total_spend, "currency", "DOLLAR SET"],
    ["Food spend (core_food + beverage)", (a) => A.spend[a].dollar_food_spend, "currency", "DOLLAR SET"],
    ["Core_food spend (excl beverage)", (a) => A.spend[a].dollar_core_food_spend, "currency", "DOLLAR SET core"],
    ["Beverage spend", (a) => A.spend[a].dollar_beverage_spend, "currency", "DOLLAR SET"],
    ["Non-food spend", (a) => A.spend[a].dollar_nonfood_spend, "currency", "DOLLAR SET"],
    ["Unknown-basis spend", (a) => A.spend[a].dollar_unknown_spend, "currency", "DOLLAR SET"],
    ["Food % of spend", (a) => A.spend[a].dollar_food_pct, "pct", "DOLLAR SET"],
    ["Core_food % of spend", (a) => A.spend[a].dollar_core_food_pct, "pct", "DOLLAR SET core"],
    ["Beverage % of spend", (a) => A.spend[a].dollar_beverage_pct, "pct", "DOLLAR SET"],
    ["Non-food % of spend", (a) => A.spend[a].dollar_nonfood_pct, "pct", "DOLLAR SET"],
    ["Window meals used (mixed actuals/projections)", (a) => A.per_meal[a].window_meals_used, "num", "-"],
    ["Food $ per meal (window)", (a) => A.per_meal[a].window_dollars_per_meal, "currency", "DOLLAR SET"],
    ["Core_food $ per meal (window)", (a) => A.per_meal[a].window_dollars_per_meal_core, "currency", "DOLLAR SET core"],
    ["Food lbs (WEIGHT SET, post-rehab)", (a) => A.weight[a].food_lbs, "num2", "WEIGHT SET"],
    ["Core_food lbs (WEIGHT SET, post-rehab)", (a) => A.weight[a].core_food_lbs, "num2", "WEIGHT SET core"],
    ["Weight coverage (% food $)", (a) => A.weight[a].coverage_food_spend_pct, "pct", "WEIGHT SET"],
    ["Weight coverage (% core_food $)", (a) => A.weight[a].coverage_core_food_spend_pct, "pct", "WEIGHT SET core"],
    ["Food lbs per meal (window)", (a) => A.per_meal[a].window_lbs_per_meal, "num2", "WEIGHT SET"],
    ["Core_food lbs per meal (window)", (a) => A.per_meal[a].window_lbs_per_meal_core, "num2", "WEIGHT SET core"],
    ["Overall $/lb (food, WEIGHT SET)", (a) => A.weight[a].dollars_per_lb_overall, "currency", "WEIGHT SET"],
    ["Overall $/lb (core_food, WEIGHT SET)", (a) => A.weight[a].dollars_per_lb_core, "currency", "WEIGHT SET core"],
  ];
  for (const [label, fn, kind, rowset] of rows) {
    const row = s.getRow(r);
    row.getCell(1).value = label;
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const v = fn(ACCOUNTS[i]);
      const cell = row.getCell(2 + i);
      cell.value = v;
      if (kind === "currency" && typeof v === "number") cell.numFmt = "$#,##0.00";
      if (kind === "pct" && typeof v === "number") cell.numFmt = '0.0"%"';
      if (kind === "num" && typeof v === "number") cell.numFmt = "#,##0";
      if (kind === "num2" && typeof v === "number") cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: "right" };
      if (rowset.includes("core")) cell.fill = CORE_FOOD_FILL;
    }
    row.getCell(5).value = rowset;
    r++;
  }

  // Per-month breakdown - shows meals_used + meals_source + $/meal per cell
  r += 2;
  s.getCell(r++, 1).value = "Per-month breakdown (Fix 2: every cell shows meals_used + meals_source; suppressed cells shown red)";
  s.getRow(r - 1).font = { bold: true };
  const monHdr = s.getRow(r);
  monHdr.values = ["Metric x Month", ...ACCOUNTS, "Basis"];
  styleHeaderRow(monHdr);
  r++;
  for (const m of MONTHS) {
    // 5 rows per month: food_spend, core_food_spend, meals_used (source), $/meal food, $/meal core
    for (const which of ["food_spend", "core_food_spend", "beverage_spend", "meals_used", "dollars_per_meal_food", "dollars_per_meal_core"]) {
      const row = s.getRow(r);
      let label = `${m} ${which}`;
      row.getCell(1).value = label;
      for (let i = 0; i < ACCOUNTS.length; i++) {
        const a = ACCOUNTS[i];
        const mm = A.per_meal[a].monthly[m];
        let v;
        let fmt = null;
        if (which === "food_spend") { v = mm.food_spend; fmt = "$#,##0.00"; }
        else if (which === "core_food_spend") { v = mm.core_food_spend; fmt = "$#,##0.00"; }
        else if (which === "beverage_spend") { v = mm.beverage_spend; fmt = "$#,##0.00"; }
        else if (which === "meals_used") { v = mm.meals_used != null ? `${mm.meals_used.toLocaleString()} (${mm.meals_source})` : `(${mm.meals_source})`; }
        else if (which === "dollars_per_meal_food") { v = mm.dollars_per_meal; fmt = "$#,##0.00"; }
        else if (which === "dollars_per_meal_core") { v = mm.dollars_per_meal_core; fmt = "$#,##0.00"; }
        const cell = row.getCell(2 + i);
        cell.value = v;
        if (fmt && typeof v === "number") cell.numFmt = fmt;
        cell.alignment = { horizontal: "right" };
        // Color-code cells based on meal source + suppression
        if (mm.suppressed && which.startsWith("dollars_per_meal")) {
          cell.value = "suppressed - see Needs Review";
          cell.fill = SUPPRESSED_FILL;
          cell.font = { italic: true };
          cell.alignment = { horizontal: "left" };
        } else if (mm.meals_source === "projected") {
          cell.fill = PROJECTED_FILL;
        } else if (mm.meals_source === "actual_sparse") {
          cell.fill = SPARSE_FILL;
        }
        if (which === "core_food_spend" || which === "dollars_per_meal_core") {
          if (!cell.fill?.fgColor) cell.fill = CORE_FOOD_FILL;
        }
      }
      row.getCell(5).value = which.includes("core") ? "DOLLAR SET core" : "DOLLAR SET";
      r++;
    }
    r++; // blank between months
  }
  r++;
  s.getCell(r++, 1).value = "Legend: green = core_food basis; yellow = projected meal denominator (either full-month gap or sparse-actual month); orange = actuals-sparse (also projected); red = suppressed ($/meal > 3x window avg).";
  freezeHeaders(s, 4);
}

// ============================================================================
// Sheet 4: Category Mix (NEW-3b, lead finding)
// ============================================================================
{
  const s = wb.addWorksheet("Category Mix");
  setColWidths(s, [30, 20, 16, 20, 16, 20, 16]);
  let r = 1;
  s.getCell(r, 1).value = "Category mix by account (DOLLAR SET). Core_food basis in the leftmost per-account block; food-including-beverage in the rightmost.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Category", "Core_food $", "% of core_food", "Rows", "Food $ (incl bev)", "% of food (incl bev)", "Basis"];
    styleHeaderRow(header);
    r++;
    const cm = A.category_mix_headline[acct];
    // Extract from the spend rollup for both bases
    const cats = ["protein", "produce", "dairy", "dry_goods", "other_food"];
    for (const c of cats) {
      const b = cm.by_category[c] || { spend: 0, pct_of_core_food: 0, rows: 0 };
      // Food-basis: need to compute pct of (core+bev) for the same category
      const foodPct = A.spend[acct].category_mix_food.find((x) => x.category === c)?.pct_of_scope || 0;
      const foodSpend = A.spend[acct].category_mix_food.find((x) => x.category === c)?.spend || 0;
      const row = s.getRow(r);
      row.getCell(1).value = c;
      row.getCell(2).value = b.spend;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(2).fill = CORE_FOOD_FILL;
      row.getCell(3).value = b.pct_of_core_food;
      row.getCell(3).numFmt = '0.0"%"';
      row.getCell(3).fill = CORE_FOOD_FILL;
      row.getCell(4).value = b.rows || 0;
      row.getCell(4).numFmt = "#,##0";
      row.getCell(5).value = foodSpend;
      row.getCell(5).numFmt = "$#,##0.00";
      row.getCell(6).value = foodPct;
      row.getCell(6).numFmt = '0.0"%"';
      row.getCell(7).value = "food category";
      for (let i = 2; i <= 6; i++) row.getCell(i).alignment = { horizontal: "right" };
      r++;
    }
    // Beverage row
    {
      const row = s.getRow(r);
      const b = cm.by_category.beverage;
      row.getCell(1).value = "beverage";
      row.getCell(2).value = "(not in core_food)";
      row.getCell(2).font = { italic: true };
      row.getCell(2).alignment = { horizontal: "right" };
      row.getCell(3).value = "-";
      row.getCell(3).alignment = { horizontal: "right" };
      row.getCell(4).value = 0;
      row.getCell(5).value = b.spend;
      row.getCell(5).numFmt = "$#,##0.00";
      row.getCell(6).value = b.pct_of_food_total;
      row.getCell(6).numFmt = '0.0"%"';
      row.getCell(7).value = "beverage";
      for (let i = 5; i <= 6; i++) row.getCell(i).alignment = { horizontal: "right" };
      r++;
    }
    // TOTAL row
    {
      const row = s.getRow(r);
      row.getCell(1).value = "TOTAL";
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = cm.core_food_spend;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(2).font = { bold: true };
      row.getCell(2).fill = CORE_FOOD_FILL;
      row.getCell(3).value = 100;
      row.getCell(3).numFmt = '0.0"%"';
      row.getCell(3).fill = CORE_FOOD_FILL;
      row.getCell(3).font = { bold: true };
      row.getCell(5).value = cm.core_food_spend + cm.beverage_spend;
      row.getCell(5).numFmt = "$#,##0.00";
      row.getCell(5).font = { bold: true };
      row.getCell(6).value = 100;
      row.getCell(6).numFmt = '0.0"%"';
      row.getCell(6).font = { bold: true };
      for (let i = 2; i <= 6; i++) row.getCell(i).alignment = { horizontal: "right" };
      r++;
    }
    r++;
  }
  r++;
  s.getCell(r++, 1).value = "Interpretation notes:";
  s.getCell(r - 1, 1).font = { bold: true };
  s.getCell(r++, 1).value = "  - Category mix reflects operator + program mix + kitchen scope. Does NOT itself say 'right' or 'wrong'.";
  s.getCell(r++, 1).value = "  - Beverage split is a real scope difference across accounts, not a purchasing choice per se.";
  s.getCell(r++, 1).value = "  - Protein-share differences (TBR ~45% vs STL ~52% of core_food, TBJ ~34%) invite kitchen-mix, menu-mix, and MiLB-vs-main-account conversations before conclusions.";

  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 5: Category Totals
// ============================================================================
{
  const s = wb.addWorksheet("Category Totals");
  setColWidths(s, [24, 20, 14, 14, 20, 14, 16]);
  let r = 1;
  s.getCell(r, 1).value = "Category totals per account (DOLLAR SET, all lines). Basis column shows Fix-4 category-to-basis mapping.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Category", "Spend (all)", "Rows (all)", "% of total $", "", "", "Basis"];
    styleHeaderRow(header);
    r++;
    const catsAll = A.spend[acct].by_category_all;
    for (const c of catsAll) {
      const row = s.getRow(r);
      row.getCell(1).value = c.category;
      row.getCell(2).value = c.spend;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(3).value = c.rows;
      row.getCell(3).numFmt = "#,##0";
      row.getCell(4).value = c.pct_of_scope;
      row.getCell(4).numFmt = '0.0"%"';
      // Basis lookup (crude - just runs assignBasis-like categorization)
      const basisMap = { produce: "food", protein: "food", poultry: "food", meat: "food", seafood: "food", dairy: "food", dry_goods: "food", grocery: "food", frozen: "food", snacks: "food", beverage: "beverage", supplies: "non_food", packaging: "non_food", chemical: "non_food", chemicals: "non_food", cleaning: "non_food", smallwares: "non_food", linen: "non_food", uniform: "non_food", other: "unknown", "(uncategorized)": "unknown" };
      row.getCell(7).value = basisMap[c.category] || "unknown";
      for (let ci = 2; ci <= 4; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 6-8: Premium/Prefab/Storage - on BOTH core_food + food basis
// ============================================================================
function classificationSheetTwoBasis(axisKey, sheetName, description) {
  const s = wb.addWorksheet(sheetName);
  setColWidths(s, [24, 14, 14, 20, 14, 14, 20]);
  let r = 1;
  s.getCell(r, 1).value = description;
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "DOLLAR SET. Left block = core_food basis (green). Right block = food basis (incl beverage). Under-70-confidence rows excluded from headline pct (shown as below-conf).";
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Label", "Core rows", "Core spend", "% of core_food", "Food rows", "Food spend", "% of food"];
    styleHeaderRow(header);
    r++;
    const bcCore = A.classification[acct].axes_core[axisKey];
    const bcAll = A.classification[acct].axes_all[axisKey];
    // Merge labels
    const labels = new Set([...bcCore.buckets.map((b) => b.label), ...bcAll.buckets.map((b) => b.label)]);
    for (const label of labels) {
      const bC = bcCore.buckets.find((b) => b.label === label) || { rows: 0, spend: 0, pct_of_food_spend: 0 };
      const bA = bcAll.buckets.find((b) => b.label === label) || { rows: 0, spend: 0, pct_of_food_spend: 0 };
      const row = s.getRow(r);
      row.getCell(1).value = label;
      row.getCell(2).value = bC.rows;
      row.getCell(2).numFmt = "#,##0";
      row.getCell(2).fill = CORE_FOOD_FILL;
      row.getCell(3).value = bC.spend;
      row.getCell(3).numFmt = "$#,##0.00";
      row.getCell(3).fill = CORE_FOOD_FILL;
      row.getCell(4).value = bC.pct_of_food_spend;
      row.getCell(4).numFmt = '0.0"%"';
      row.getCell(4).fill = CORE_FOOD_FILL;
      row.getCell(5).value = bA.rows;
      row.getCell(5).numFmt = "#,##0";
      row.getCell(6).value = bA.spend;
      row.getCell(6).numFmt = "$#,##0.00";
      row.getCell(7).value = bA.pct_of_food_spend;
      row.getCell(7).numFmt = '0.0"%"';
      for (let ci = 2; ci <= 7; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    // below conf
    const rBC = s.getRow(r);
    rBC.getCell(1).value = "(below-70-confidence)";
    rBC.getCell(2).value = bcCore.below_confidence_rows;
    rBC.getCell(2).numFmt = "#,##0";
    rBC.getCell(2).fill = CORE_FOOD_FILL;
    rBC.getCell(3).value = bcCore.below_confidence_spend;
    rBC.getCell(3).numFmt = "$#,##0.00";
    rBC.getCell(3).fill = CORE_FOOD_FILL;
    rBC.getCell(4).value = bcCore.below_confidence_pct;
    rBC.getCell(4).numFmt = '0.0"%"';
    rBC.getCell(4).fill = CORE_FOOD_FILL;
    rBC.getCell(5).value = bcAll.below_confidence_rows;
    rBC.getCell(5).numFmt = "#,##0";
    rBC.getCell(6).value = bcAll.below_confidence_spend;
    rBC.getCell(6).numFmt = "$#,##0.00";
    rBC.getCell(7).value = bcAll.below_confidence_pct;
    rBC.getCell(7).numFmt = '0.0"%"';
    r++;
    // TOTAL
    const rT = s.getRow(r);
    rT.getCell(1).value = "TOTAL";
    rT.getCell(1).font = { bold: true };
    rT.getCell(3).value = A.classification[acct].core_food_spend;
    rT.getCell(3).numFmt = "$#,##0.00";
    rT.getCell(3).fill = CORE_FOOD_FILL;
    rT.getCell(6).value = A.classification[acct].food_spend;
    rT.getCell(6).numFmt = "$#,##0.00";
    for (const c of [3, 6]) rT.getCell(c).font = { bold: true };
    r += 2;
  }
  if (axisKey === "quality" || axisKey === "preparation") {
    r++;
    s.getCell(r, 1).value = "Inter-axis sanity: rows flagged both 'premium' AND 'prefabricated' (>=70 conf on both, core_food basis)";
    s.getCell(r, 1).font = { bold: true };
    r++;
    const hdr = s.getRow(r);
    hdr.values = ["Account", "Rows", "Spend", "", "", "", ""];
    styleHeaderRow(hdr);
    r++;
    for (const acct of ACCOUNTS) {
      const ia = A.inter_axis_prefab_premium[acct];
      const row = s.getRow(r);
      row.getCell(1).value = acct;
      row.getCell(2).value = ia.count;
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).value = ia.spend;
      row.getCell(3).numFmt = "$#,##0.00";
      r++;
    }
  }
  freezeHeaders(s, 3);
}
classificationSheetTwoBasis("quality", "Premium vs Commodity", "Quality axis: premium / commodity / neutral (Fix 1: beverages forced neutral)");
classificationSheetTwoBasis("preparation", "Prefabricated vs Scratch", "Preparation axis: prefabricated / scratch-input / neutral");
classificationSheetTwoBasis("storage", "Frozen vs Fresh", "Storage axis: frozen / fresh / shelf-stable / unknown");

// ============================================================================
// Sheet 9: Weight & Coverage (post-rehab)
// ============================================================================
{
  const s = wb.addWorksheet("Weight & Coverage");
  setColWidths(s, [22, 12, 12, 16, 16, 12, 12, 12, 12]);
  let r = 1;
  s.getCell(r, 1).value = "Weight (WEIGHT SET, post-Fix-5 rehab) with coverage rate on same line.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Category rows filtered to core_food + beverage (per Fix 4 mapping). Non-food categories no longer appear.";
  r += 2;
  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Category", "Food $ (DOLLAR SET)", "Food $ (WEIGHT SET)", "Coverage % food $", "Coverage % food rows", "Rows (dollar)", "Rows (weight)", "Weight (lbs)", "$ per lb"];
    styleHeaderRow(header);
    r++;
    const cats = A.weight[acct].by_category;
    for (const c of cats) {
      const row = s.getRow(r);
      row.getCell(1).value = c.category;
      row.getCell(2).value = c.food_spend_dollar_set;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(3).value = c.food_spend_weight_set;
      row.getCell(3).numFmt = "$#,##0.00";
      row.getCell(4).value = c.coverage_spend_pct;
      row.getCell(4).numFmt = '0.0"%"';
      row.getCell(5).value = c.coverage_rows_pct;
      row.getCell(5).numFmt = '0.0"%"';
      row.getCell(6).value = c.food_rows_dollar_set;
      row.getCell(6).numFmt = "#,##0";
      row.getCell(7).value = c.food_rows_weight_set;
      row.getCell(7).numFmt = "#,##0";
      row.getCell(8).value = c.weight_lbs;
      row.getCell(8).numFmt = "#,##0.0";
      row.getCell(9).value = c.dollars_per_lb;
      if (c.dollars_per_lb != null) row.getCell(9).numFmt = "$#,##0.00";
      for (let ci = 2; ci <= 9; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    const t = s.getRow(r);
    t.getCell(1).value = "TOTAL";
    t.getCell(1).font = { bold: true };
    t.getCell(2).value = A.weight[acct].food_spend_dollar_set;
    t.getCell(2).numFmt = "$#,##0.00";
    t.getCell(3).value = A.weight[acct].food_spend_weight_set;
    t.getCell(3).numFmt = "$#,##0.00";
    t.getCell(4).value = A.weight[acct].coverage_food_spend_pct;
    t.getCell(4).numFmt = '0.0"%"';
    t.getCell(8).value = A.weight[acct].food_lbs;
    t.getCell(8).numFmt = "#,##0.0";
    t.getCell(9).value = A.weight[acct].dollars_per_lb_overall;
    if (A.weight[acct].dollars_per_lb_overall != null) t.getCell(9).numFmt = "$#,##0.00";
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 10: Protein Mix (NEW-3b Fix 6)
// ============================================================================
{
  const s = wb.addWorksheet("Protein Mix");
  setColWidths(s, [18, 14, 16, 14, 14, 14, 16, 14, 14]);
  let r = 1;
  s.getCell(r, 1).value = "Protein spend split by type per account. Share by dollars (all rows). Share by pounds + $/lb where WEIGHT SET coverage allows.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Untyped rows kept in 'other' bucket - not force-classified.";
  r += 2;
  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Type", "Rows", "Spend $", "% of protein $", "Weight lbs", "% of protein lbs (WEIGHT SET)", "Coverage % spend", "$/lb", "-"];
    styleHeaderRow(header);
    r++;
    const pm = A.protein_mix[acct];
    for (const b of pm.by_type) {
      const row = s.getRow(r);
      row.getCell(1).value = b.type;
      row.getCell(2).value = b.rows;
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).value = b.spend;
      row.getCell(3).numFmt = "$#,##0.00";
      row.getCell(4).value = b.pct_of_protein_spend;
      row.getCell(4).numFmt = '0.0"%"';
      row.getCell(5).value = b.lbs;
      row.getCell(5).numFmt = "#,##0.0";
      row.getCell(6).value = b.pct_of_protein_lbs != null ? b.pct_of_protein_lbs : "insufficient coverage";
      if (typeof b.pct_of_protein_lbs === "number") row.getCell(6).numFmt = '0.0"%"';
      row.getCell(7).value = b.coverage_spend_pct;
      row.getCell(7).numFmt = '0.0"%"';
      row.getCell(8).value = b.dollars_per_lb != null ? b.dollars_per_lb : "insufficient coverage";
      if (typeof b.dollars_per_lb === "number") row.getCell(8).numFmt = "$#,##0.00";
      for (let ci = 2; ci <= 8; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    const t = s.getRow(r);
    t.getCell(1).value = "TOTAL";
    t.getCell(1).font = { bold: true };
    t.getCell(3).value = pm.total_protein_spend;
    t.getCell(3).numFmt = "$#,##0.00";
    t.getCell(5).value = pm.total_protein_lbs;
    t.getCell(5).numFmt = "#,##0.0";
    t.getCell(7).value = pm.lbs_coverage_spend_pct;
    t.getCell(7).numFmt = '0.0"%"';
    for (const c of [3, 5, 7]) t.getCell(c).font = { bold: true };
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 11: Duplicate Item Families (NEW-3b Fix 6)
// ============================================================================
{
  const s = wb.addWorksheet("Duplicate Item Families");
  setColWidths(s, [40, 12, 8, 14, 14, 14, 14, 14, 14, 14, 14, 14]);
  let r = 1;
  s.getCell(r, 1).value = "Item families (grouped SKUs). Ranked by SKU count then spread. Does NOT label anything 'waste' or 'error' - surfaces the pattern; operator interprets.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Family key = normalized description tokens. Confidence < 70 items land on Needs Review.";
  r += 2;
  const header = s.getRow(r);
  header.values = ["Family", "Category", "Conf", "SKU count", "Total $", "Intra-family $/lb spread (max/min)", "Fresh+Frozen both present", ...ACCOUNTS.flatMap((a) => [`${a} SKUs`, `${a} $/lb`])];
  styleHeaderRow(header);
  r++;
  const rows = A.duplicate_families.slice(0, 200); // top 200 families to keep sheet manageable
  for (const f of rows) {
    const row = s.getRow(r);
    row.getCell(1).value = f.family;
    row.getCell(2).value = f.category;
    row.getCell(3).value = f.confidence;
    row.getCell(4).value = f.sku_count;
    row.getCell(4).numFmt = "#,##0";
    row.getCell(5).value = f.spend;
    row.getCell(5).numFmt = "$#,##0.00";
    row.getCell(6).value = f.intra_family_dpp_spread || "insufficient coverage";
    if (typeof f.intra_family_dpp_spread === "number") row.getCell(6).numFmt = "0.00\"x\"";
    row.getCell(7).value = f.fresh_and_frozen_flag ? "YES" : "";
    let col = 8;
    for (const a of ACCOUNTS) {
      const pa = f.per_account[a] || {};
      row.getCell(col++).value = pa.sku_count || 0;
      row.getCell(col++).value = pa.dollars_per_lb != null ? pa.dollars_per_lb : "";
      if (typeof pa.dollars_per_lb === "number") row.getCell(col - 1).numFmt = "$#,##0.00";
    }
    for (let ci = 3; ci <= 12; ci++) row.getCell(ci).alignment = { horizontal: "right" };
    r++;
  }
  freezeHeaders(s, 4);
}

// ============================================================================
// Sheet 12: Top Items
// ============================================================================
{
  const s = wb.addWorksheet("Top Items");
  setColWidths(s, [40, 22, 16, 12, 16, 12]);
  let r = 1;
  s.getCell(r, 1).value = "Top items per account (DOLLAR SET, all lines). Two tables per account: by spend and by frequency.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  for (const acct of ACCOUNTS) {
    for (const [mode, list] of [["SPEND", A.spend[acct].top_items_by_spend], ["FREQUENCY (order count)", A.spend[acct].top_items_by_frequency]]) {
      const sub = s.getRow(r);
      sub.values = [`${acct} - Top by ${mode}`, "", "", "", "", ""];
      sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
      sub.eachCell((c) => (c.font = SUBHEADER_FONT));
      r++;
      const header = s.getRow(r);
      header.values = ["Description", "Vendor", "Category", "Orders", "Spend", "Qty (units)"];
      styleHeaderRow(header);
      r++;
      for (const it of list) {
        const row = s.getRow(r);
        row.getCell(1).value = it.description;
        row.getCell(2).value = it.vendor_name;
        row.getCell(3).value = it.category;
        row.getCell(4).value = it.rows;
        row.getCell(4).numFmt = "#,##0";
        row.getCell(5).value = it.spend;
        row.getCell(5).numFmt = "$#,##0.00";
        row.getCell(6).value = it.qty;
        row.getCell(6).numFmt = "#,##0.00";
        r++;
      }
      r++;
    }
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 13: Shared Basket (Fix 3 - vendor_id+item_number match, $/lb primary)
// ============================================================================
{
  const s = wb.addWorksheet("Shared Basket");
  setColWidths(s, [40, 16, 12, 12, 12, 16, 12, 12, 16, 12, 12, 16, 16, 30]);
  let r = 1;
  s.getCell(r, 1).value = "Items present in all three accounts, matched on (vendor_id, item_number). Primary metric: $/lb (Fix 3). Fallback: $/order + pack_size list.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Dedup by SKU identity. Same-account rows aggregated. Where any account has <50% row-level lb coverage, mode = dollars_per_order (labeled).";
  r += 2;
  const header = s.getRow(r);
  const cols = ["Description", "Category", "Mode", "Spread ($/lb ratio)"];
  for (const a of ACCOUNTS) cols.push(`${a} orders`, `${a} $`, `${a} $/lb`, `${a} pack_sizes`);
  header.values = [...cols, "Note"];
  styleHeaderRow(header);
  r++;
  for (const item of A.shared_basket) {
    const row = s.getRow(r);
    row.getCell(1).value = item.description;
    row.getCell(2).value = item.category;
    row.getCell(3).value = item.mode;
    row.getCell(4).value = item.spread_ratio_dpp;
    if (item.spread_ratio_dpp) row.getCell(4).numFmt = "0.00\"x\"";
    let col = 5;
    for (const a of ACCOUNTS) {
      const p = item.per_account[a];
      row.getCell(col++).value = p.orders;
      row.getCell(col++).value = p.spend;
      row.getCell(col - 1).numFmt = "$#,##0.00";
      row.getCell(col++).value = p.dollars_per_lb;
      if (p.dollars_per_lb) row.getCell(col - 1).numFmt = "$#,##0.00";
      row.getCell(col++).value = p.pack_sizes;
    }
    row.getCell(col).value = item.normalization_mode_reason;
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 14: Price Variance (Scrub - same SKU different price across accounts)
// ============================================================================
{
  const s = wb.addWorksheet("Price Variance");
  setColWidths(s, [40, 16, 14, 14, 14, 14, 14, 14, 14, 16]);
  let r = 1;
  s.getCell(r, 1).value = "Same SKU (vendor_id+item_number), different mean unit price across accounts. Ranked by $ at stake.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Threshold: >15% price spread across the accounts where SKU is present.";
  r += 2;
  const header = s.getRow(r);
  header.values = ["Description", "Vendor", "Category", "Accounts present", "Total $", ...ACCOUNTS.map((a) => `${a} mean unit_price`), "Spread ratio", "$ at stake"];
  styleHeaderRow(header);
  r++;
  for (const item of A.price_variance.slice(0, 100)) {
    const row = s.getRow(r);
    row.getCell(1).value = item.description;
    row.getCell(2).value = item.vendor_name;
    row.getCell(3).value = item.category;
    row.getCell(4).value = item.accounts_present;
    row.getCell(5).value = item.total_spend;
    row.getCell(5).numFmt = "$#,##0.00";
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const v = item.per_account_price[ACCOUNTS[i]];
      row.getCell(6 + i).value = v ?? "";
      if (typeof v === "number") row.getCell(6 + i).numFmt = "$#,##0.00";
    }
    row.getCell(9).value = item.spread_ratio;
    row.getCell(9).numFmt = "0.00\"x\"";
    row.getCell(10).value = item.dollars_at_stake;
    row.getCell(10).numFmt = "$#,##0.00";
    r++;
  }
  s.getCell(r + 1, 1).value = "$ at stake = total_spend * (1 - min_price / max_price). Rough what-if if all accounts paid the lowest observed price on this SKU. Not a promise.";
  s.getCell(r + 1, 1).font = { italic: true };
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 15: Price Drift
// ============================================================================
{
  const s = wb.addWorksheet("Price Drift");
  setColWidths(s, [40, 16, 10, 14, 14, 14, 14, 14, 14, 16]);
  let r = 1;
  s.getCell(r, 1).value = "Same SKU price drift within window (>10% change from first to last month of appearance).";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = ["Description", "Vendor", "Account", "Category", "First month", "First price", "Last month", "Last price", "% change", "Months seen"];
  styleHeaderRow(header);
  r++;
  for (const item of A.price_drift.slice(0, 100)) {
    const row = s.getRow(r);
    row.getCell(1).value = item.description;
    row.getCell(2).value = item.vendor_name;
    row.getCell(3).value = item.account;
    row.getCell(4).value = item.category;
    row.getCell(5).value = item.first_month;
    row.getCell(6).value = item.first_price;
    row.getCell(6).numFmt = "$#,##0.00";
    row.getCell(7).value = item.last_month;
    row.getCell(8).value = item.last_price;
    row.getCell(8).numFmt = "$#,##0.00";
    row.getCell(9).value = item.pct_change;
    row.getCell(9).numFmt = '0.0"%"';
    row.getCell(10).value = item.months_seen;
    r++;
  }
  freezeHeaders(s, 2);
}

// ============================================================================
// Sheet 16: Vendor Concentration
// ============================================================================
{
  const s = wb.addWorksheet("Vendor Concentration");
  setColWidths(s, [30, 20, 16, 14, 20, 14]);
  let r = 1;
  s.getCell(r, 1).value = "Vendor concentration per account: top-3 vendors, then maverick spend (everything outside top-3) with top items.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  for (const acct of ACCOUNTS) {
    const vc = A.vendor_concentration[acct];
    const sub = s.getRow(r);
    sub.values = [`${acct}: total $${vc.total_spend} - top3 share ${vc.top3_share_pct}%, maverick ${vc.maverick_share_pct}% ($${vc.maverick_spend})`, "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Top-3 vendor", "Spend", "% of total", "Rows", "", ""];
    styleHeaderRow(header);
    r++;
    for (const v of vc.top3_vendors) {
      const row = s.getRow(r);
      row.getCell(1).value = v.vendor;
      row.getCell(2).value = v.spend;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(3).value = v.pct;
      row.getCell(3).numFmt = '0.0"%"';
      row.getCell(4).value = v.rows;
      row.getCell(4).numFmt = "#,##0";
      r++;
    }
    r++;
    const h2 = s.getRow(r);
    h2.values = ["Maverick top items", "Vendor", "Description", "Category", "Spend", ""];
    styleHeaderRow(h2);
    r++;
    for (const m of vc.maverick_top_items) {
      const row = s.getRow(r);
      row.getCell(2).value = m.vendor;
      row.getCell(3).value = m.description;
      row.getCell(4).value = m.category;
      row.getCell(5).value = m.spend;
      row.getCell(5).numFmt = "$#,##0.00";
      r++;
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 17: Pareto
// ============================================================================
{
  const s = wb.addWorksheet("Pareto");
  setColWidths(s, [30, 20, 20, 20, 20, 20]);
  let r = 1;
  s.getCell(r, 1).value = "Pareto: what share of spend sits in top-20 and top-50 items per account.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = ["Account", "Distinct items", "Total spend", "Top-20 $", "Top-20 share", "Top-50 share"];
  styleHeaderRow(header);
  r++;
  for (const acct of ACCOUNTS) {
    const p = A.pareto[acct];
    const row = s.getRow(r);
    row.getCell(1).value = acct;
    row.getCell(2).value = p.distinct_items;
    row.getCell(2).numFmt = "#,##0";
    row.getCell(3).value = p.total_spend;
    row.getCell(3).numFmt = "$#,##0.00";
    row.getCell(4).value = p.top20_spend;
    row.getCell(4).numFmt = "$#,##0.00";
    row.getCell(5).value = p.top20_share_pct;
    row.getCell(5).numFmt = '0.0"%"';
    row.getCell(6).value = p.top50_share_pct;
    row.getCell(6).numFmt = '0.0"%"';
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 18: Order Cadence
// ============================================================================
{
  const s = wb.addWorksheet("Order Cadence");
  setColWidths(s, [30, 18, 20, 20, 20]);
  let r = 1;
  s.getCell(r, 1).value = "Delivery cadence per account: invoices in window, deliveries/week, average order value.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = ["Account", "Invoices in window", "Total spend", "Deliveries/week", "Avg order value"];
  styleHeaderRow(header);
  r++;
  for (const acct of ACCOUNTS) {
    const o = A.order_cadence[acct];
    const row = s.getRow(r);
    row.getCell(1).value = acct;
    row.getCell(2).value = o.invoices_in_window;
    row.getCell(2).numFmt = "#,##0";
    row.getCell(3).value = o.total_spend;
    row.getCell(3).numFmt = "$#,##0.00";
    row.getCell(4).value = o.deliveries_per_week;
    row.getCell(4).numFmt = "#,##0.0";
    row.getCell(5).value = o.avg_order_value;
    row.getCell(5).numFmt = "$#,##0.00";
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 19: Unique to account
// ============================================================================
{
  const s = wb.addWorksheet("Unique Items");
  setColWidths(s, [40, 20, 14, 14, 8]);
  let r = 1;
  s.getCell(r, 1).value = "SKUs bought at ONE account only, spend >= $250. Scope-difference read.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  for (const acct of ACCOUNTS) {
    const items = A.unique_by_account[acct];
    const sub = s.getRow(r);
    sub.values = [`${acct} - ${items.length} unique items >= $250`, "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Description", "Vendor", "Category", "Spend", "Orders"];
    styleHeaderRow(header);
    r++;
    for (const it of items.slice(0, 50)) {
      const row = s.getRow(r);
      row.getCell(1).value = it.description;
      row.getCell(2).value = it.vendor_name;
      row.getCell(3).value = it.category;
      row.getCell(4).value = it.spend;
      row.getCell(4).numFmt = "$#,##0.00";
      row.getCell(5).value = it.orders;
      r++;
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 20: Item Master
// ============================================================================
{
  const s = wb.addWorksheet("Item Master");
  setColWidths(s, [40, 20, 14, 14, 22, 8, 14, 14, 8, 34, 14, 8, 34, 14, 8, 34]);
  let r = 1;
  s.getCell(r, 1).value = "Every distinct (vendor, description) pair in DOLLAR SET with three-axis classification + Fix-4 basis + beverage-reclassified flag.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = ["Description", "Vendor", "Category", "Basis", "Accounts", "Orders", "Spend", "Quality", "Q conf", "Quality reason", "Preparation", "P conf", "Preparation reason", "Storage", "S conf", "Storage reason"];
  styleHeaderRow(header);
  r++;
  for (const it of A.item_master) {
    const row = s.getRow(r);
    row.getCell(1).value = it.description;
    row.getCell(2).value = it.vendor_name;
    row.getCell(3).value = it.category;
    row.getCell(4).value = it.basis;
    row.getCell(5).value = it.accounts;
    row.getCell(6).value = it.order_count;
    row.getCell(6).numFmt = "#,##0";
    row.getCell(7).value = it.total_spend;
    row.getCell(7).numFmt = "$#,##0.00";
    row.getCell(8).value = it.quality_axis || "";
    if (it.beverage_reclassified) { row.getCell(8).font = { italic: true, color: { argb: "FF888888" } }; }
    row.getCell(9).value = it.quality_confidence ?? "";
    row.getCell(9).numFmt = "0";
    row.getCell(10).value = it.quality_reason;
    row.getCell(11).value = it.preparation_axis || "";
    row.getCell(12).value = it.preparation_confidence ?? "";
    row.getCell(12).numFmt = "0";
    row.getCell(13).value = it.preparation_reason;
    row.getCell(14).value = it.storage_axis || "";
    row.getCell(15).value = it.storage_confidence ?? "";
    row.getCell(15).numFmt = "0";
    row.getCell(16).value = it.storage_reason;
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 21: Needs Review (adds Fix 2 suppressions + Fix 5 no-rehab TBR rows)
// ============================================================================
{
  const s = wb.addWorksheet("Needs Review");
  setColWidths(s, [40, 20, 14, 22, 8, 14, 22, 22]);
  let r = 1;
  s.getCell(r, 1).value = "Needs Review sheet - all suppressed cells, below-confidence items, still-excluded weight rows.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  s.getCell(r, 1).value = "Fix 2 - suppressed monthly $/meal cells";
  s.getRow(r).font = { bold: true };
  r++;
  if (A.suppressions.length === 0) {
    s.getCell(r++, 1).value = "  (none - no cell exceeded 3x window-average threshold)";
  } else {
    const hdr = s.getRow(r);
    hdr.values = ["Account", "Month", "Computed $/meal", "Window avg", "Meals used", "Meals source", "Reason", ""];
    styleHeaderRow(hdr);
    r++;
    for (const sup of A.suppressions) {
      const row = s.getRow(r);
      row.getCell(1).value = sup.account;
      row.getCell(2).value = sup.month;
      row.getCell(3).value = sup.computed_dpm;
      row.getCell(3).numFmt = "$#,##0.00";
      row.getCell(4).value = sup.window_avg_dpm;
      row.getCell(4).numFmt = "$#,##0.00";
      row.getCell(5).value = sup.meals_used;
      row.getCell(6).value = sup.source;
      row.getCell(7).value = sup.reason;
      r++;
    }
  }
  r += 2;

  s.getCell(r, 1).value = "Row-set exclusions (row counts, post-Fix-5 rehab)";
  s.getRow(r).font = { bold: true };
  r++;
  const rExcl = s.getRow(r);
  rExcl.values = ["Reason", "Rows", "Spend", "Note", "", "", "", ""];
  styleHeaderRow(rExcl);
  r++;
  const excl = [
    ["invoice_over_extracted", A.excluded_rows.invoice_over_extracted.count, A.excluded_rows.invoice_over_extracted.spend, "Excluded from DOLLAR SET (source rejects the extraction entirely)"],
    ["ep_qty_up_mismatch REHABBED via Candidate B (weight_line_value)", A.excluded_rows.ep_qty_up_mismatch_rehabbed.count, A.excluded_rows.ep_qty_up_mismatch_rehabbed.spend, "Now INCLUDED in WEIGHT SET (vendor's printed catch weight trusted)"],
    ["ep_qty_up_mismatch still excluded", A.excluded_rows.ep_qty_up_mismatch_still_excluded.count, A.excluded_rows.ep_qty_up_mismatch_still_excluded.spend, "No usable weight_line_value; still WEIGHT SET excluded"],
    ["pack_size_ambiguous_multipack REHABBED via Candidate A (sibling)", A.excluded_rows.pack_size_ambiguous_multipack_rehabbed.count, A.excluded_rows.pack_size_ambiguous_multipack_rehabbed.spend, "Now INCLUDED in WEIGHT SET"],
    ["pack_size_ambiguous_multipack still excluded", A.excluded_rows.pack_size_ambiguous_multipack_still_excluded.count, A.excluded_rows.pack_size_ambiguous_multipack_still_excluded.spend, "No sibling SKU or category-bounds rejected"],
  ];
  for (const [reason, ct, sp, where] of excl) {
    const row = s.getRow(r);
    row.getCell(1).value = reason;
    row.getCell(2).value = ct;
    row.getCell(2).numFmt = "#,##0";
    row.getCell(3).value = sp;
    row.getCell(3).numFmt = "$#,##0.00";
    row.getCell(4).value = where;
    r++;
  }
  r += 2;

  s.getCell(r, 1).value = "Item-level low-confidence + not-classified";
  s.getRow(r).font = { bold: true };
  r++;
  const header = s.getRow(r);
  header.values = ["Description", "Vendor", "Category", "Accounts", "Orders", "Spend", "Reason", "Class labels"];
  styleHeaderRow(header);
  r++;
  for (const it of A.needs_review) {
    const row = s.getRow(r);
    row.getCell(1).value = it.description;
    row.getCell(2).value = it.vendor_name;
    row.getCell(3).value = it.category;
    row.getCell(4).value = it.accounts;
    row.getCell(5).value = it.order_count;
    row.getCell(5).numFmt = "#,##0";
    row.getCell(6).value = it.total_spend;
    row.getCell(6).numFmt = "$#,##0.00";
    row.getCell(7).value = it.reason;
    const labels = [
      it.quality_axis ? `Q=${it.quality_axis}/${it.quality_confidence}` : "",
      it.preparation_axis ? `P=${it.preparation_axis}/${it.preparation_confidence}` : "",
      it.storage_axis ? `S=${it.storage_axis}/${it.storage_confidence}` : "",
    ].filter(Boolean).join(" ");
    row.getCell(8).value = labels;
    r++;
  }
  freezeHeaders(s, 6);
}

// ============================================================================
// Sheet 22: Reconciliation
// ============================================================================
{
  const s = wb.addWorksheet("Reconciliation");
  setColWidths(s, [22, 12, 12, 16, 16, 16, 16, 12]);
  let r = 1;
  s.getCell(r, 1).value = "Reconciliation: DOLLAR SET line-item sums vs invoice_submissions.total_amount (live headers) vs GL food (from gl_breakdown).";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Month", "Invoices", "Line rows", "Line-item sum", "Header sum", "GL food sum", "LI - Header", "Variance %"];
    styleHeaderRow(header);
    r++;
    const rec = A.reconciliation[acct];
    for (const m of MONTHS) {
      const rr = rec.monthly[m];
      const row = s.getRow(r);
      row.getCell(1).value = m;
      row.getCell(2).value = rr.invoice_count;
      row.getCell(3).value = rr.line_row_count;
      row.getCell(4).value = rr.line_item_sum;
      row.getCell(4).numFmt = "$#,##0.00";
      row.getCell(5).value = rr.header_sum;
      row.getCell(5).numFmt = "$#,##0.00";
      row.getCell(6).value = rr.gl_food_sum;
      row.getCell(6).numFmt = "$#,##0.00";
      row.getCell(7).value = rr.variance_dollars;
      row.getCell(7).numFmt = "$#,##0.00";
      row.getCell(8).value = rr.variance_pct;
      row.getCell(8).numFmt = '0.0"%"';
      r++;
    }
    const t = s.getRow(r);
    t.getCell(1).value = "WINDOW";
    t.getCell(1).font = { bold: true };
    t.getCell(4).value = rec.window.line_item_sum;
    t.getCell(4).numFmt = "$#,##0.00";
    t.getCell(5).value = rec.window.header_sum;
    t.getCell(5).numFmt = "$#,##0.00";
    t.getCell(6).value = rec.window.gl_food_sum;
    t.getCell(6).numFmt = "$#,##0.00";
    t.getCell(7).value = rec.window.variance_dollars;
    t.getCell(7).numFmt = "$#,##0.00";
    t.getCell(8).value = rec.window.variance_pct;
    t.getCell(8).numFmt = '0.0"%"';
    for (const c of [4, 5, 6, 7, 8]) t.getCell(c).font = { bold: true };
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 23: Fix Log
// ============================================================================
{
  const s = wb.addWorksheet("Phase 3b Fix Log");
  setColWidths(s, [24, 40, 40, 24]);
  let r = 1;
  s.getCell(r, 1).value = "Phase 3b Fix Log - what changed vs Phase 3, dollar impact per account";
  s.getCell(r, 1).font = { bold: true, size: 14 };
  r += 2;

  s.getCell(r, 1).value = "Fix 1: beverage classification reclassified to neutral";
  s.getRow(r).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Rows patched (distinct items):";
  s.getCell(r, 2).value = "See Item Master 'Q reason' column - starts with 'Phase 3b'";
  r++;
  s.getCell(r, 1).value = "Dollar impact:";
  s.getCell(r, 2).value = "Premium % on core_food basis drops (was: STL 51.2% incl beverage. Now: see Premium sheet.)";
  r += 2;

  s.getCell(r, 1).value = "Fix 4: category-basis leakage repaired";
  s.getRow(r).font = { bold: true };
  r++;
  const hdr = s.getRow(r);
  hdr.values = ["Account", "Moved food -> non_food (rows / $)", "Beverage split out (rows / $)", "Core_food remaining (rows / $)"];
  styleHeaderRow(hdr);
  r++;
  for (const a of ACCOUNTS) {
    const f = A.fix4_impact[a];
    const row = s.getRow(r);
    row.getCell(1).value = a;
    row.getCell(2).value = `${f.moved_food_to_nonfood_rows} rows / $${f.moved_food_to_nonfood_spend} (${f.moved_food_to_nonfood_categories})`;
    row.getCell(3).value = `${f.beverage_split_out_rows} rows / $${f.beverage_split_out_spend}`;
    row.getCell(4).value = `${f.core_food_rows} rows / $${f.core_food_spend}`;
    r++;
  }
  r += 2;

  s.getCell(r, 1).value = "Fix 5: TBR-FL protein weight rehab diagnosis";
  s.getRow(r).font = { bold: true };
  r++;
  const f5 = A.fix5_result;
  s.getCell(r, 1).value = "Coverage pre-rehab:";
  s.getCell(r, 2).value = `${f5.tbr_protein_weight_set_rows_pre} of ${f5.tbr_protein_dollar_set_rows} rows (${(f5.tbr_protein_weight_set_rows_pre / f5.tbr_protein_dollar_set_rows * 100).toFixed(1)}%)`;
  r++;
  s.getCell(r, 1).value = "Coverage post-rehab:";
  s.getCell(r, 2).value = `${f5.tbr_protein_weight_set_rows_post} rows (${f5.tbr_protein_weight_set_coverage_rows_pct}% rows, ${f5.tbr_protein_weight_set_coverage_spend_pct}% spend)`;
  r++;
  s.getCell(r, 1).value = "Candidate A (sibling disambig):";
  s.getCell(r, 2).value = `applied ${f5.diagnosis.candidate_a.applied}/${f5.diagnosis.candidate_a.attempted}, ${f5.diagnosis.candidate_a.no_sibling} no sibling, ${f5.diagnosis.candidate_a.bounds_rejected} bounds-rejected`;
  r++;
  s.getCell(r, 1).value = "Candidate B (weight_line_value):";
  s.getCell(r, 2).value = `applied ${f5.diagnosis.candidate_b.applied}/${f5.diagnosis.candidate_b.attempted}, ${f5.diagnosis.candidate_b.no_wlv} no wlv, ${f5.diagnosis.candidate_b.bounds_rejected} bounds-rejected`;
  r++;
  s.getCell(r, 1).value = "Decision:";
  s.getCell(r, 2).value = f5.decision_note;
  r += 2;

  freezeHeaders(s, 1);
}

await wb.xlsx.writeFile(P.WORKBOOK);
console.log("[3b-wb] wrote", P.WORKBOOK);
