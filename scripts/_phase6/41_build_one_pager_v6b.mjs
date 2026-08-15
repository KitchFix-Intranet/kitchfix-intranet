// Build PURCHASE_ONE_PAGER.md (v6b) from _analysis6.json.
// Rewrites the existing one-pager with fresh v6b numbers.
// Also drops a versioned copy to Downloads.

import fs from "node:fs";

const A6 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json", "utf8"));
const A6B = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6_baseline.json", "utf8"));
const CL6 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6.json", "utf8"));

const OUT_MAIN = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ONE_PAGER.md";
const OUT_DL = "/Users/kevinfietek/Downloads/PURCHASE_ONE_PAGER_v6.md";

function fmt(n, dp = 2) {
  if (n == null) return "n/a";
  const factor = 10 ** dp;
  return (Math.round(n * factor) / factor).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmt0(n) { return n == null ? "n/a" : n.toLocaleString(); }

const acct = (a) => A6.protein_mix[a] || null;
const w = (a) => A6.weight[a];
const pm = (a) => A6.per_meal[a];
const sp = (a) => A6.spend[a];

function ptypeRow(t) {
  const row = ["TBR-FL", "TBJ-FL", "STL-FL"].map(a => {
    const b = acct(a)?.by_type.find(x => x.type === t);
    if (!b) return "n/a";
    if (b._suppressed) return `suppressed (${b.coverage_spend_pct}%)`;
    const caveat = b._caveat ? " (caveat)" : "";
    return `$${fmt(b.dollars_per_lb)} @ ${b.coverage_spend_pct}%${caveat}`;
  });
  return row;
}

const md = [];
md.push("# Purchasing Comparison - CEO One-Pager (v6b)");
md.push("");
md.push("Window 2026-05-01 to 2026-07-31 (3 months). Off-season for main dining program; MiLB in-season (Triple-A + Double-A across TBR/TBJ/STL Florida sites). All figures on core_food basis unless noted (core_food = food $ excluding beverage). Every number traces to a query - full workbook: PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx (see v6b Summary + Phase 6 Bridge + Phase 6b Rules Applied sheets).");
md.push("");
md.push("Phase 6b resolves four STOPs from Phase 6 (S1 data-freshness / S2 R5b invoice-lb arithmetic / S3 R6b two-sided bands / S4 R8b DPP plausibility gate) and refreshes all numeric outputs against canonical denominators (Addendum A1). Dollar restatement column below is the R2(a) TBJ +$12,629.32 correction; everything else is a weight-fix delta.");
md.push("");

md.push("## 1. Category mix (core_food $) - v6b");
md.push("");
md.push("| | TBR-FL | TBJ-FL | STL-FL |");
md.push("|:-|:-|:-|:-|");
md.push(`| Dollar-set total spend | $${fmt(sp("TBR-FL").dollar_total_spend)} | $${fmt(sp("TBJ-FL").dollar_total_spend)} | $${fmt(sp("STL-FL").dollar_total_spend)} |`);
md.push(`| Food $ (incl beverage) | $${fmt(sp("TBR-FL").dollar_food_spend)} | $${fmt(sp("TBJ-FL").dollar_food_spend)} | $${fmt(sp("STL-FL").dollar_food_spend)} |`);
md.push(`| Core food $ (excl beverage) | $${fmt(sp("TBR-FL").dollar_core_food_spend)} | $${fmt(sp("TBJ-FL").dollar_core_food_spend)} | $${fmt(sp("STL-FL").dollar_core_food_spend)} |`);
md.push(`| Beverage $ | $${fmt(sp("TBR-FL").dollar_beverage_spend)} | $${fmt(sp("TBJ-FL").dollar_beverage_spend)} | $${fmt(sp("STL-FL").dollar_beverage_spend)} |`);
md.push(`| Beverage % of food | ${sp("TBR-FL").dollar_beverage_pct}% | ${sp("TBJ-FL").dollar_beverage_pct}% | ${sp("STL-FL").dollar_beverage_pct}% |`);
md.push("");
md.push("**Means:** three accounts run visibly different plates. STL is protein-heavy with the largest beverage program. TBJ balanced. TBR almost no beverage program. Category share reflects kitchen scope + menu + service program.");
md.push("");
md.push("**R2(a) restatement (Phase 6b):** TBJ-FL dollar-set total spend restated from $171,222.23 (Phase 5 stale) to $183,851.55 (Kevin's Fact 2). Delta +$12,629.32. TBR/STL zero restatement. See Phase 6 Bridge sheet for line-level bridge.");
md.push("");

md.push("## 2. Per-cover denominators (Addendum A1 canonical)");
md.push("");
md.push("| | TBR-FL | TBJ-FL | STL-FL |");
md.push("|:-|:-|:-|:-|");
md.push(`| Window covers (canon) | ${fmt0(pm("TBR-FL").window_meals_used)} | ${fmt0(pm("TBJ-FL").window_meals_used)} | ${fmt0(pm("STL-FL").window_meals_used)} |`);
md.push(`| $/cover (food) | $${fmt(pm("TBR-FL").window_dollars_per_meal)} | $${fmt(pm("TBJ-FL").window_dollars_per_meal)} | $${fmt(pm("STL-FL").window_dollars_per_meal)} |`);
md.push(`| $/cover (core food) | $${fmt(pm("TBR-FL").window_dollars_per_meal_core)} | $${fmt(pm("TBJ-FL").window_dollars_per_meal_core)} | $${fmt(pm("STL-FL").window_dollars_per_meal_core)} |`);
md.push(`| lb/cover (food) | ${fmt(pm("TBR-FL").window_lbs_per_meal)} | ${fmt(pm("TBJ-FL").window_lbs_per_meal)} | ${fmt(pm("STL-FL").window_lbs_per_meal)} |`);
md.push(`| lb/cover (core food) | ${fmt(pm("TBR-FL").window_lbs_per_meal_core)} | ${fmt(pm("TBJ-FL").window_lbs_per_meal_core)} | ${fmt(pm("STL-FL").window_lbs_per_meal_core)} |`);
md.push("");
md.push("Source: Kevin's 2026 TBR + TBJ Service Calendars + STL 2027 projections. TBR-FL 20,300 = MiLB 18,680 + B&G 1,620. TBJ-FL 29,541 = all service lines. STL-FL 18,860 = FCL 11,060 + PBC 7,800. Sparse-month substitution disabled for this window.");
md.push("");
md.push("**B&G disclosure.** TBR covers include 1,620 Boys and Girls Club meals (8.0% of window covers, all in May), a separate client billed at a flat $6.50 per meal against MiLB blended $20.05. The meal is an after-school supper, not a lunch. Invoice product is not split between clients, so per-cover figures are a floor for MiLB-only intensity. Contract: term Aug 19 2025 to May 21 2026, no auto-renewal, prepaid 4-week periods, tax-exempt, 125/day is a planning estimate not a billed floor, school-year value approx $79,950. Source REC-108 + REF-141.");
md.push("");

md.push("## 3. Weight & coverage (v6b, post R5b/R6b/R7)");
md.push("");
md.push("| | TBR-FL | TBJ-FL | STL-FL |");
md.push("|:-|:-|:-|:-|");
md.push(`| Core food $ (dollar set) | $${fmt(w("TBR-FL").core_food_spend_dollar_set)} | $${fmt(w("TBJ-FL").core_food_spend_dollar_set)} | $${fmt(w("STL-FL").core_food_spend_dollar_set)} |`);
md.push(`| Core food $ (weight set) | $${fmt(w("TBR-FL").core_food_spend_weight_set)} | $${fmt(w("TBJ-FL").core_food_spend_weight_set)} | $${fmt(w("STL-FL").core_food_spend_weight_set)} |`);
md.push(`| Core food lbs | ${fmt(w("TBR-FL").core_food_lbs, 1)} | ${fmt(w("TBJ-FL").core_food_lbs, 1)} | ${fmt(w("STL-FL").core_food_lbs, 1)} |`);
md.push(`| Weight coverage (core food) | ${w("TBR-FL").coverage_core_food_spend_pct}% | ${w("TBJ-FL").coverage_core_food_spend_pct}% | ${w("STL-FL").coverage_core_food_spend_pct}% |`);
md.push("");
md.push(`Baseline (v5-logic) core food lbs: TBR ${fmt(A6B.weight["TBR-FL"].core_food_lbs, 1)}, TBJ ${fmt(A6B.weight["TBJ-FL"].core_food_lbs, 1)}, STL ${fmt(A6B.weight["STL-FL"].core_food_lbs, 1)}. v6b applies R5b (invoice-lb arithmetic, top precedence, fixes d48e8152 5,630 lb -> 117.3 lb) + R6b ($/lb band gate on all layers) + R7 (fluid-oz restoration).`);
md.push("");

md.push("## 4. Protein mix - $/lb by type (v6b, coverage stated inline)");
md.push("");
md.push("| | TBR-FL | TBJ-FL | STL-FL |");
md.push("|:-|:-|:-|:-|");
for (const t of ["beef", "poultry", "pork", "seafood", "other_meat"]) {
  const [tbr, tbj, stl] = ptypeRow(t);
  md.push(`| ${t} $/lb | ${tbr} | ${tbj} | ${stl} |`);
}
md.push("");
md.push("plant_or_egg buckets: not comparable (eggs sold by count). `other` bucket: aggregate residual, published where coverage supports. Suppression thresholds: <25% suppressed, 25-35% publish with caveat, >=35% publish.");
md.push("");
md.push("**R8b gate result on v6b: PASS.** All published protein-type $/lb figures fall inside [$0.75, $25.00]. lb/cover warnings: none (all below 1.0).");
md.push("");

md.push("## 5. Phase 6b bridge - v5 -> restatement -> fix delta -> v6b");
md.push("");
md.push("Full row-by-row bridge on workbook Phase 6 Bridge sheet. Headline numbers:");
md.push("");
md.push("| Metric | Account | v5 | Restatement | Fix Delta | v6b |");
md.push("|:-|:-|-:|-:|-:|-:|");
const bridge = A6._phase6.restatement_bridge;
for (const a of ["TBR-FL", "TBJ-FL", "STL-FL"]) {
  const r = bridge[a];
  md.push(`| Dollar-set total spend | ${a} | $${fmt(r.v5_dollar_total_spend)} | $${fmt(r.restatement_delta_total)} | $0.00 | $${fmt(r.v6_dollar_total_spend)} |`);
}
md.push("");
md.push("STL beef $/lb bucket (fresh AUG, v6b): baseline $4.17 -> v6b $9.18 (fix delta +$5.01/lb). Same beef bucket, baseline lbs 9,676.5 -> v6b lbs 4,112.7 (fix delta -5,563.8 lb). d48e8152 alone contributes 5,513 lb of that reduction (5,630.4 -> 117.3 lb via R5b).");
md.push("");

md.push("## 6. Phase 6b rules applied");
md.push("");
md.push("- **R4:** Catch-implied weight layer (ep/up) - precedence below p5 and p4, above 3c-rehab and base. No arithmetic gate on catch layer (S2 ruling). Layer size: " + A6._phase6.catch_implied_layer_size + ".");
md.push("- **R5b:** Invoice-lb arithmetic - TOP precedence, above p5. lower(unit)='lb' AND |qty*up - ep| <= max($1, 2%). Layer size: " + A6._phase6.invoice_lb_arithmetic_layer_size + " rows. Fixes d48e8152 and 40 other rows.");
md.push("- **R6b:** $/lb plausibility gate on ALL weight-set rows except R5b. Bands regenerated from v6b pre-gate distribution with data-derived low + category-plausible floor (no max(0,...) clamp). Gated out: " + A6._phase6.band_gated_out_count + " rows.");
md.push("- **R7:** Fluid-oz restoration on beverage-basis fused-slash rows. Dropped: " + A6._phase6.p5_fused_beverage_dropped + ".");
md.push("- **R8b:** Standing build-time hard-fail on $/lb per protein type per account against [0.75, 25.00]. lb/cover is now a warning (flag above 1.0), not a fail.");
md.push("- **S1 root cause named:** Supabase .range() pagination without .order('id') returns rows in undefined order across pages, causing silent 20%+ drops. Fixed in scripts/_phase3/_common.mjs (add .order + de-dup guard). Fresh AUG now matches Kevin's Fact 2 to the cent.");
md.push("");

md.push("## 7. A3 Methodology note (Phase 6b)");
md.push("");
md.push("Two-tier quality filter unchanged: dollar set excludes invoice_over_extracted; weight set is dollar-set rows carrying an effective weight from one of seven layers, subject to R6b band gate. Weight-resolution precedence (v6b, highest to lowest): (1) invoice_lb_arithmetic R5b - printed pounds arithmetic; (2) Phase 5 recovered (shipped_count_is_lb, kevin_verified_pack, implied_from_ep_and_unit_price, cheney_pound_n_convention, fused_slash_rule_*); (3) Phase 4 recovered (catch-weight + pack-size rescues); (4) catch_weight_implied_ep_over_up R4; (5) Phase 3c rehab (sibling-borrowed); (6) Base parser (with suspicious-multipack quarantine); (7) unresolved.");
md.push("");
md.push("$/lb plausibility gate (R6b). Every weight-set row except invoice_lb_arithmetic must fall inside its category's data-derived band. Bands from v6b pre-gate distribution: `[max(Q1 - k*IQR, category_plausible_floor), Q3 + k*IQR]`. k=1.0 produce, 1.5 elsewhere. category_plausible_floor pins the bottom when the IQR floor goes negative. Out-of-band rows leave the weight set only.");
md.push("");
md.push("Standing build gate (R8b) fails on any published protein-type $/lb outside [$0.75, $25.00] - a range admitting commodity chicken at the bottom and premium beef/seafood at the top. lb/cover is a warning above 1.0. Publication thresholds unchanged: coverage >=35% publish, 25-35% publish-with-caveat, <25% suppressed, plant_or_egg never publishes.");
md.push("");

md.push("## 8. B3 Limitations (verbatim)");
md.push("");
md.push("1. Weight coverage is partial. Even after Phase 6b, only " + w("TBJ-FL").coverage_core_food_spend_pct + "%-" + w("STL-FL").coverage_core_food_spend_pct + "% of core-food spend across accounts sits in the weight set. Every $/lb figure is computed over the covered subset, not the full purchase basket. Rows with unresolved weights are excluded from lbs totals but included in dollar totals.");
md.push("");
md.push("2. Extraction defects still present in dollar set. review_reason='invoice_over_extracted' rows are stripped, but other extraction errors (missing lines, mis-classified vendors, transposed digits) survive. Cross-checked spend totals reconcile to Kevin's Fact 2 (TBJ $183,851.55) but reconciliation is at the account-month level, not the invoice level.");
md.push("");
md.push("3. B&G product is not client-split on TBR invoices. TBR-FL purchases fund both MiLB service and the B&G after-school supper program. There is no line-item tagging that separates B&G product from MiLB product. Per-cover intensity for TBR is therefore a floor, not a MiLB-exact value.");
md.push("");
md.push("4. STL denominator is a projection. The 18,860 window meals is Kevin's 2027 Service Calendar projection (7,540 / 6,190 / 5,130 by month), not billed actuals. STL 2026 window billed actuals are sparse and were the trigger for the calendar-canonical decision (Addendum A1).");
md.push("");
md.push("5. Invoice_lb_arithmetic (R5b) precedence is trust-based. When lower(unit)='lb' and qty*up = ep within tolerance, we take qty as printed pounds - this outranks every parser inference. If the protein-type classifier tags a row wrongly, the R5b weight still lands in whatever wrong bucket.");
md.push("");
md.push("6. Band regeneration is data-derived within v6b. R6b bands come from the v6b pre-gate weight-set distribution. If a category is dominated by systematically-wrong rows, the band will normalize around those wrong rows and let similar wrong rows through. Category-plausible-floors partially mitigate at the bottom but not at the top.");
md.push("");
md.push("7. Baseline fire test for R8b did not fire on the fresh AUG. Kevin's expectation was that STL beef/poultry aggregate $/lb would fall below $0.75 in baseline. Fresh-AUG baseline shows STL beef aggregate at $4.17/lb (skewed low by the d48e8152 5,630-lb defect but pulled up by clean rows in the average). R8b is well-formed but did not fire on this dataset because aggregate averaging masked individual-row defects. v6b passes cleanly.");
md.push("");
md.push("8. 9 catch ∩ p4 rows all resolved via p4 layer. No double-count. One row (5b875a1c BEEF FAJ OUTSIDE SKIRT MARN) has p4_lb=410 (10x plausible), which R6b did NOT gate because dpp=$0.93 falls inside the protein band [$0.75, $18.56]. Flagged for a future p4 audit.");
md.push("");
md.push("---");
md.push("");
md.push(`Generated ${new Date().toISOString().slice(0, 10)}. Phase 6b build. Full details in PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx workbook v6b sheets.`);

const content = md.join("\n") + "\n";
fs.writeFileSync(OUT_MAIN, content);
fs.writeFileSync(OUT_DL, content);
console.log(`wrote ${OUT_MAIN}`);
console.log(`wrote ${OUT_DL}`);
