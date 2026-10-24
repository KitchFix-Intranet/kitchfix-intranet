// Phase 3c CEO one-pager. Reads _analysis3c.json + _change_log.json.
// Writes PURCHASE_ONE_PAGER.md (renamed from CEO_ONE_PAGER.md typo path in 3b).
//
// Phase 3c changes vs 3b:
//   - Real reconciliation numbers per account (item 2)
//   - One-line premium/prefabricated axes-are-independent note (item 6)
//   - No per-meal figures for STL (item 3 - none were in 3b either, so no removals)
//   - Every other figure byte-identical to 3b

import fs from "node:fs";

const IN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_analysis3c.json";
const CL = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_change_log.json";
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md";

const A = JSON.parse(fs.readFileSync(IN, "utf8"));
const CL3C = JSON.parse(fs.readFileSync(CL, "utf8"));
const acc = { TBR: "TBR-FL", TBJ: "TBJ-FL", STL: "STL-FL" };

function cm(a, cat) {
  return A.category_mix_headline[a].by_category[cat]?.pct_of_core_food ?? 0;
}
function bev(a) {
  return A.category_mix_headline[a].by_category.beverage.pct_of_food_total ?? 0;
}
function premCore(a) {
  return A.classification[a].axes_core.quality.buckets.find((b) => b.label === "premium")?.pct_of_food_spend ?? 0;
}
function commCore(a) {
  return A.classification[a].axes_core.quality.buckets.find((b) => b.label === "commodity")?.pct_of_food_spend ?? 0;
}
function orders(a) {
  return A.order_cadence[a];
}
function pareto(a) {
  return A.pareto[a];
}
function vendor(a) {
  return A.vendor_concentration[a];
}
function reconPct(a) {
  const v = A.reconciliation[a].window.variance_pct;
  // Preserve the one decimal place (e.g., -7.0% not -7%)
  return v.toFixed(1);
}

const doc = `# Purchasing Comparison - CEO One-Pager

Window 2026-05-01 to 2026-07-31 (3 months). Off-season for main dining program; MiLB in-season (Triple-A + Double-A across TBR/TBJ/STL Florida sites). All figures on core_food basis unless noted (core_food = food $ excluding beverage). Every number traces to a query - full workbook: PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx.

## 1. Category mix (core_food $) - LEAD FINDING

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| Core food $ | $${A.category_mix_headline[acc.TBR].core_food_spend.toLocaleString()} | $${A.category_mix_headline[acc.TBJ].core_food_spend.toLocaleString()} | $${A.category_mix_headline[acc.STL].core_food_spend.toLocaleString()} |
| protein % core | ${cm(acc.TBR, "protein")}% | ${cm(acc.TBJ, "protein")}% | **${cm(acc.STL, "protein")}%** |
| produce % core | ${cm(acc.TBR, "produce")}% | ${cm(acc.TBJ, "produce")}% | ${cm(acc.STL, "produce")}% |
| dairy % core | ${cm(acc.TBR, "dairy")}% | ${cm(acc.TBJ, "dairy")}% | ${cm(acc.STL, "dairy")}% |
| dry_goods % core | ${cm(acc.TBR, "dry_goods")}% | ${cm(acc.TBJ, "dry_goods")}% | ${cm(acc.STL, "dry_goods")}% |
| beverage % of food | ${bev(acc.TBR)}% | ${bev(acc.TBJ)}% | **${bev(acc.STL)}%** |

**Means:** three accounts run visibly different plates. STL is protein-heavy (${cm(acc.STL, "protein")}%) with the largest beverage program (${bev(acc.STL)}%). TBJ most balanced. TBR protein-heavy (${cm(acc.TBR, "protein")}%), almost no beverage program. Category share reflects kitchen scope + menu + service program.

**Does NOT prove:** whether any mix is right for its service program. Whether protein-heavy = expensive-per-meal (STL per-meal figures suppressed in Phase 3c - meals denominator is insufficient).

## 2. Beverage is scope, not purchasing choice

STL beverage = $${A.category_mix_headline[acc.STL].beverage_spend.toLocaleString()} (${bev(acc.STL)}% of food); TBR $${A.category_mix_headline[acc.TBR].beverage_spend.toLocaleString()} (${bev(acc.TBR)}%). Phase 3 counted bottled water in the premium-food signal - Phase 3b moves branded beverages to neutral.

**Means:** treat as scope question (does the account run a full-service beverage program?). Do NOT roll into "STL buys premium food."

**Does NOT prove:** margin. This is spend to vendors, not revenue.

## 3. Premium share on core_food (beverages excluded)

Premium % of core_food $ (LLM classifier, >= 70 conf): TBR **${premCore(acc.TBR)}%**, TBJ **${premCore(acc.TBJ)}%**, STL **${premCore(acc.STL)}%**. Commodity: TBR ${commCore(acc.TBR)}%, TBJ ${commCore(acc.TBJ)}%, STL ${commCore(acc.STL)}%.

**Means:** STL still runs materially higher premium share on food-only basis (${premCore(acc.STL)}% vs ~${premCore(acc.TBR)}% for TBR/TBJ - ~${(premCore(acc.STL) / premCore(acc.TBR)).toFixed(1)}x). Phase 3 called this 2.4x; that was ~half beverage artifact. The real core-food gap is ~${(premCore(acc.STL) / premCore(acc.TBR)).toFixed(1)}x.

**Note on axes (Phase 3c item 6):** Quality and preparation are independent axes; an item can be both premium and prefabricated (a pre-portioned Choice steak is both). Present the observation; do not interpret it.

**Does NOT prove:** whether STL should be premium (menu positioning). ${A.classification[acc.STL].axes_core.quality.below_confidence_pct}% of STL core_food is <70-confidence, excluded from headline (Needs Review sheet).

## 4. Operational shape - cadence + concentration

| | TBR-FL | TBJ-FL | STL-FL |
|:-|:-|:-|:-|
| Invoices/window | ${orders(acc.TBR).invoices_in_window} | ${orders(acc.TBJ).invoices_in_window} | ${orders(acc.STL).invoices_in_window} |
| Deliveries/week | ${orders(acc.TBR).deliveries_per_week} | ${orders(acc.TBJ).deliveries_per_week} | ${orders(acc.STL).deliveries_per_week} |
| Avg order value | $${orders(acc.TBR).avg_order_value.toLocaleString()} | $${orders(acc.TBJ).avg_order_value.toLocaleString()} | $${orders(acc.STL).avg_order_value.toLocaleString()} |
| Top-3 vendor share | ${vendor(acc.TBR).top3_share_pct}% | ${vendor(acc.TBJ).top3_share_pct}% | ${vendor(acc.STL).top3_share_pct}% |
| Top-20 SKU share | ${pareto(acc.TBR).top20_share_pct}% | ${pareto(acc.TBJ).top20_share_pct}% | ${pareto(acc.STL).top20_share_pct}% |

**Means:** TBR orders most-frequent + smallest (~${orders(acc.TBR).deliveries_per_week}/wk at $${orders(acc.TBR).avg_order_value.toLocaleString()}). STL/TBJ order 2x the value. Top-3 vendors = ${Math.min(vendor(acc.TBJ).top3_share_pct, vendor(acc.STL).top3_share_pct).toFixed(0)}-${Math.max(vendor(acc.TBR).top3_share_pct, vendor(acc.TBJ).top3_share_pct, vendor(acc.STL).top3_share_pct).toFixed(0)}% everywhere - little maverick spend to attack.

**Does NOT prove:** whether small-frequent costs more (delivery fees, minimums). No fee data.

## 5. Same-SKU price variance across accounts

${A.price_variance.length} SKUs bought at >1 account with >15% spread. Top: **${A.price_variance[0].description.slice(0, 45)}** ${A.price_variance[0].spread_ratio}x spread ($${A.price_variance[0].dollars_at_stake.toLocaleString()} at stake); **${A.price_variance[1].description.slice(0, 45)}** ${A.price_variance[1].spread_ratio}x ($${A.price_variance[1].dollars_at_stake.toLocaleString()}); **${A.price_variance[2].description.slice(0, 45)}** ${A.price_variance[2].spread_ratio}x ($${A.price_variance[2].dollars_at_stake.toLocaleString()}). Top-5 aggregate at-stake: ~$${A.price_variance.slice(0, 5).reduce((s, x) => s + x.dollars_at_stake, 0).toLocaleString()} - contract-negotiation targets. Full ranked list on Price Variance sheet.

**Means:** candidate lift-and-shift savings.

**Does NOT prove:** whether pack size/grade actually matches (some spread is real product difference). At-stake = if-all-lined-up ceiling, not a promise.

## 6. Reconciliation - line-item vs invoice header (Phase 3c item 2)

Per-account window variance (DOLLAR SET line-item sum vs invoice header sum): **TBR-FL ${reconPct(acc.TBR)}%**, **TBJ-FL ${reconPct(acc.TBJ)}%**, **STL-FL ${reconPct(acc.STL)}%**. Per-month breakdown on the workbook Reconciliation sheet.

## Phase 3b fix log

- **Fix 4** (category leakage): $${A.fix4_impact[acc.STL].moved_food_to_nonfood_spend.toLocaleString()} cleaning/smallwares moved out of STL food; beverages split (STL $${A.fix4_impact[acc.STL].beverage_split_out_spend.toLocaleString()}, TBJ $${A.fix4_impact[acc.TBJ].beverage_split_out_spend.toLocaleString()}, TBR $${A.fix4_impact[acc.TBR].beverage_split_out_spend.toLocaleString()}).
- **Fix 5** (TBR protein rehab): applied. Weight coverage 9.8% -> ${A.fix5_result.tbr_protein_weight_set_coverage_rows_pct}% (rows) / ${A.fix5_result.tbr_protein_weight_set_coverage_spend_pct}% (spend). $/lb by protein type now reportable.
- **Fix 2** (meals denominator): ${A.suppressions.length} monthly cells suppressed. Projections used for sparse-actual months, labeled honestly.

## Phase 3c final tightening

- **Item 1:** ${CL3C.item1_duplicate_family_spread_suppressions_summary.families_suppressed} unreliable Duplicate Family spread values replaced with "not comparable" (family confidence < 70 OR spread > 3x). Spend covered: $${CL3C.item1_duplicate_family_spread_suppressions_summary.total_spend_covered.toLocaleString()}.
- **Item 2:** Reconciliation now shown as three real per-account variances (section 6), not an aggregated bound.
- **Item 3:** All STL-FL per-meal cells suppressed - "meals data insufficient" (STL June 0 actuals, July 5 rows / 164 meals). TBR + TBJ per-meal figures unchanged.
- **Item 4:** ${CL3C.item4_plausibility_band_flags.flagged_cells.length} category $/lb cells outside per-category IQR-based band flagged "review - outside expected range". Bands + method on workbook Methodology sheet.
- **Item 5:** TBJ-FL pork $/lb and STL-FL seafood $/lb recomputed after excluding rows conclusively identified as bad weight resolution (bacon OCR pack-size garble + shrimp qty-as-lb mislabeling). See Phase 3c Change Log sheet for exact rows + before/after.
- **Item 6:** Premium and prefabricated axes are independent - byte-identical to Phase 3b; one-line neutral explanation added in section 3.
`;

fs.writeFileSync(OUT, doc);
console.log("[3c-ceo] wrote", OUT);
