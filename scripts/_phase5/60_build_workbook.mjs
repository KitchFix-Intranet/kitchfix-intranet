// Phase 5 workbook build: overlay Phase 5 data onto Phase 4 workbook and
// add Phase 5 sheets. Writes over PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx.
//
// Strategy:
//   1. Read current xlsx (Phase 4 output).
//   2. Update Summary + Account Comparison + Weight & Coverage + Protein Mix
//      cells with Phase 5 values.
//   3. Append new sheets at end.
//   4. Save.

import fs from "node:fs";
import ExcelJS from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/exceljs/excel.js";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, ACCOUNTS } from "./_common5.mjs";

const WORKBOOK = P.WORKBOOK;
const A4 = JSON.parse(fs.readFileSync(P.P4_ANALYSIS, "utf8"));
const A5 = JSON.parse(fs.readFileSync(P5.ANALYSIS, "utf8"));
const CL5 = JSON.parse(fs.readFileSync(P5.CHANGE_LOG, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const OQ = JSON.parse(fs.readFileSync(P5.OPEN_QUESTIONS_JSON, "utf8"));
const FUSED = JSON.parse(fs.readFileSync(P5.FUSED_VALIDATION, "utf8"));
const Q11 = JSON.parse(fs.readFileSync(P5.Q11_DIST, "utf8"));
const Q13 = JSON.parse(fs.readFileSync(P5.Q13_BANDS, "utf8"));
const Q14 = JSON.parse(fs.readFileSync(P5.Q14_GFS, "utf8"));
const Q15 = JSON.parse(fs.readFileSync(P5.Q15_CHENEY, "utf8"));
const Q21 = JSON.parse(fs.readFileSync(P5.Q21_SAMPLE, "utf8"));
const Q17 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q17_other_reclass.json", "utf8"));
const Q12Q16 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q12_q16_verify.json", "utf8"));

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(WORKBOOK);
console.log(`loaded ${wb.worksheets.length} sheets from Phase 4 workbook`);

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264653" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const CAVEAT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3B0" } };
const SUPPRESSED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEE7B7B" } };
const KEVIN_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
const ANALYST_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E3F1" } };

function styleHeader(row) {
  row.eachCell((c) => { c.fill = HEADER_FILL; c.font = HEADER_FONT; c.alignment = { vertical: "middle", horizontal: "left", wrapText: true }; });
  row.height = 22;
}
function setColWidths(sheet, widths) {
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

// ============================================================================
// SHEET UPDATE: overwrite Protein Mix sheet with Phase 5 values
// ============================================================================
{
  // Drop existing Protein Mix, recreate at same position if possible.
  let existing = wb.getWorksheet("Protein Mix");
  if (existing) wb.removeWorksheet(existing.id);
  const s = wb.addWorksheet("Protein Mix", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [12, 15, 8, 12, 10, 12, 10, 12, 14, 14, 45]);
  const h = s.getRow(1);
  h.values = ["Account", "Type", "Rows", "Spend", "Lbs Rows", "Lbs", "Cov %", "Lbs Spend", "$/lb", "% of protein $", "Publication"];
  styleHeader(h);
  let r = 2;
  for (const acct of ACCOUNTS) {
    const pm = A5.protein_mix[acct];
    // Total row
    s.getCell(r, 1).value = acct;
    s.getCell(r, 2).value = "TOTAL protein";
    s.getCell(r, 4).value = pm.total_protein_spend;
    s.getCell(r, 4).numFmt = "$#,##0.00";
    s.getCell(r, 6).value = pm.total_protein_lbs;
    s.getCell(r, 7).value = pm.lbs_coverage_spend_pct;
    s.getCell(r, 7).numFmt = '0.0"%"';
    s.getRow(r).font = { bold: true };
    r++;
    for (const b of pm.by_type) {
      s.getCell(r, 1).value = acct;
      s.getCell(r, 2).value = b.type;
      s.getCell(r, 3).value = b.rows;
      s.getCell(r, 4).value = b.spend;
      s.getCell(r, 4).numFmt = "$#,##0.00";
      s.getCell(r, 5).value = b.lbs_rows;
      s.getCell(r, 6).value = b.lbs;
      s.getCell(r, 7).value = b.coverage_spend_pct;
      s.getCell(r, 7).numFmt = '0.0"%"';
      s.getCell(r, 8).value = b.lbs_spend;
      s.getCell(r, 8).numFmt = "$#,##0.00";
      s.getCell(r, 9).value = b.dollars_per_lb;
      if (b.dollars_per_lb != null) s.getCell(r, 9).numFmt = "$#,##0.00";
      s.getCell(r, 10).value = b.pct_of_protein_spend;
      s.getCell(r, 10).numFmt = '0.0"%"';
      s.getCell(r, 11).value = b._publication;
      if (b._suppressed) { for (let c = 1; c <= 11; c++) s.getCell(r, c).fill = SUPPRESSED_FILL; }
      else if (b._caveat) { for (let c = 1; c <= 11; c++) s.getCell(r, c).fill = CAVEAT_FILL; }
      r++;
    }
    r++;
  }
  s.getCell(r, 1).value = "Notes:";
  s.getRow(r).font = { bold: true }; r++;
  s.getCell(r, 1).value = "  Green = Kevin-supplied answer applied. Red = suppressed <25% coverage. Yellow = published with caveat 25-35% coverage.";
  r++;
  s.getCell(r, 1).value = "  plant_or_egg always marked 'not comparable' - eggs are a mix of count-based and weight-based rows.";
}

// ============================================================================
// SHEET UPDATE: Weight & Coverage - overwrite with Phase 5
// ============================================================================
{
  let existing = wb.getWorksheet("Weight & Coverage");
  if (existing) wb.removeWorksheet(existing.id);
  const s = wb.addWorksheet("Weight & Coverage", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [12, 14, 8, 14, 8, 14, 12, 10, 12, 30]);
  const h = s.getRow(1);
  h.values = ["Account", "Category", "Dollar rows", "Dollar $", "Weight rows", "Weight $", "Weight lbs", "Cov %", "$/lb", "Publication"];
  styleHeader(h);
  let r = 2;
  for (const acct of ACCOUNTS) {
    const w = A5.weight[acct];
    // Overall food
    s.getCell(r, 1).value = acct;
    s.getCell(r, 2).value = "OVERALL food";
    s.getCell(r, 3).value = w.food_rows_dollar_set;
    s.getCell(r, 4).value = w.food_spend_dollar_set;
    s.getCell(r, 4).numFmt = "$#,##0";
    s.getCell(r, 5).value = w.food_rows_weight_set;
    s.getCell(r, 6).value = w.food_spend_weight_set;
    s.getCell(r, 6).numFmt = "$#,##0";
    s.getCell(r, 7).value = w.food_lbs;
    s.getCell(r, 8).value = w.coverage_food_spend_pct;
    s.getCell(r, 8).numFmt = '0.0"%"';
    s.getCell(r, 9).value = w.food_lbs ? w.food_spend_weight_set / w.food_lbs : null;
    if (s.getCell(r, 9).value != null) s.getCell(r, 9).numFmt = "$#,##0.00";
    s.getRow(r).font = { bold: true };
    r++;
    // Core food
    s.getCell(r, 1).value = acct;
    s.getCell(r, 2).value = "OVERALL core_food (excl beverage)";
    s.getCell(r, 4).value = w.core_food_spend_dollar_set;
    s.getCell(r, 4).numFmt = "$#,##0";
    s.getCell(r, 6).value = w.core_food_spend_weight_set;
    s.getCell(r, 6).numFmt = "$#,##0";
    s.getCell(r, 7).value = w.core_food_lbs;
    s.getCell(r, 8).value = w.coverage_core_food_spend_pct;
    s.getCell(r, 8).numFmt = '0.0"%"';
    s.getRow(r).font = { italic: true };
    r++;
    for (const c of w.by_category) {
      s.getCell(r, 1).value = acct;
      s.getCell(r, 2).value = c.category;
      s.getCell(r, 3).value = c.food_rows_dollar_set;
      s.getCell(r, 4).value = c.food_spend_dollar_set;
      s.getCell(r, 4).numFmt = "$#,##0";
      s.getCell(r, 5).value = c.food_rows_weight_set;
      s.getCell(r, 6).value = c.food_spend_weight_set;
      s.getCell(r, 6).numFmt = "$#,##0";
      s.getCell(r, 7).value = c.weight_lbs;
      s.getCell(r, 8).value = c.coverage_spend_pct;
      s.getCell(r, 8).numFmt = '0.0"%"';
      s.getCell(r, 9).value = c.dollars_per_lb;
      if (c.dollars_per_lb != null) s.getCell(r, 9).numFmt = "$#,##0.00";
      s.getCell(r, 10).value = c._publication;
      if (c._suppressed) { for (let col = 1; col <= 10; col++) s.getCell(r, col).fill = SUPPRESSED_FILL; }
      else if (c._caveat) { for (let col = 1; col <= 10; col++) s.getCell(r, col).fill = CAVEAT_FILL; }
      r++;
    }
    r++;
  }
}

// ============================================================================
// SHEET UPDATE: Account Comparison - Phase 5 STL projected meals row
// ============================================================================
// (kept simple - just append a Phase 5 summary section rather than editing cells)
{
  let ws = wb.getWorksheet("Account Comparison");
  if (ws) {
    let r = ws.rowCount + 3;
    ws.getCell(r, 1).value = "PHASE 5 (2026-08-14): STL-FL uses PROJECTED 2027-service-calendar meals (Kevin Q6)";
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: "FF264653" } };
    r += 2;
    const h = ws.getRow(r);
    h.values = ["Account", "Meals (Phase 5)", "Source", "Food $/meal", "Food lbs/meal", "Lbs coverage %"];
    styleHeader(h);
    r++;
    for (const acct of ACCOUNTS) {
      const pm = A5.per_meal[acct]; if (!pm) continue;
      ws.getCell(r, 1).value = acct;
      ws.getCell(r, 2).value = pm.window_meals_used;
      ws.getCell(r, 3).value = pm.window_meals_source || "actuals (unchanged)";
      ws.getCell(r, 4).value = pm.window_dollars_per_meal;
      if (typeof pm.window_dollars_per_meal === "number") ws.getCell(r, 4).numFmt = "$#,##0.00";
      ws.getCell(r, 5).value = pm.window_lbs_per_meal;
      ws.getCell(r, 6).value = pm.window_lbs_coverage_pct;
      ws.getCell(r, 6).numFmt = '0.0"%"';
      if (acct === "STL-FL") for (let c = 1; c <= 6; c++) ws.getCell(r, c).fill = KEVIN_FILL;
      r++;
    }
  }
}

// ============================================================================
// NEW SHEET: Phase 5 Overview
// ============================================================================
{
  const s = wb.addWorksheet("Phase 5 Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [40, 20, 15, 15, 60]);
  const h = s.getRow(1);
  h.values = ["Step", "Metric", "Rows", "Spend", "Notes"];
  styleHeader(h);
  let r = 2;
  const push = (step, metric, rows, spend, notes, fill) => {
    const row = s.getRow(r);
    row.getCell(1).value = step;
    row.getCell(2).value = metric;
    row.getCell(3).value = rows;
    row.getCell(4).value = spend;
    if (typeof spend === "number") row.getCell(4).numFmt = "$#,##0";
    row.getCell(5).value = notes;
    row.getCell(5).alignment = { wrapText: true };
    if (fill) for (let c = 1; c <= 5; c++) row.getCell(c).fill = fill;
    r++;
  };
  push("Step 1 (Q9 unit=lb)", "resolved", CL5.steps_applied.step1?.rows || 0, CL5.steps_applied.step1?.spend || 0, "Kevin: up * shipped = ep; shipped is lb shipped. Validated per-row before applying.", KEVIN_FILL);
  push("Step 2 (Q2 fused-slash)", "Kevin verified", CL5.steps_applied.step2?.rows || 0, CL5.steps_applied.step2?.spend || 0, `Combined step 2a+2b - Kevin's 30 pack verifications + validated general rule. 4d 2+2, 3d 1+2 or 2+1 by category plausibility, ambiguous cases left unresolved.`, KEVIN_FILL);
  push("Step 2 fused: 4-digit", "resolved", null, null, "always 2+2 split (e.g. '1412 OZ' = 14/12 OZ = 10.5 lb)", null);
  push("Step 2 fused: 3-digit 1+2", "resolved", null, null, "e.g. '410 LB' = 4/10 LB = 40 lb. Chosen when 1+2 fits category bounds and 2+1 does not.", null);
  push("Step 2 fused: 3-digit 2+1", "resolved", null, null, "e.g. '101 LB' = 10/1 LB = 10 lb; '152 LB' = 15/2 LB = 30 lb. Chosen when 2+1 fits and 1+2 does not.", null);
  push("Step 2 fused: ambiguous_skipped", REC5.meta.fused_ambiguous_skipped_count, null, null, "3-digit strings where BOTH splits pass category-plausibility bounds. LEFT UNRESOLVED per brief rule.", null);
  push("Step 3 (Q8 catch-weight gate)", "reclassified", REC5.meta.catch_weight_reclassified_count, null, "ep_qty_up_mismatch flag removed for rows that carry a real catch-weight signal (AVG/T/WT/TOT WT in desc, unit=lb, Cheney '#' convention, or weight_line_value populated).", KEVIN_FILL);
  push("Step 4 (Q1 beverage size)", "culinary", REC5.beverage_reclass_detail.filter(x=>x.verdict==="culinary").length, null, "half-gallon+/gallon/liter -> culinary (was neutral).", KEVIN_FILL);
  push("Step 4 (Q1 beverage size)", "service", REC5.beverage_reclass_detail.filter(x=>x.verdict==="service").length, null, "8/12/16/24 oz -> service (stays neutral).", KEVIN_FILL);
  push("Step 4 (Q1 beverage size)", "unresolved", REC5.beverage_reclass_detail.filter(x=>x.verdict==="unresolved").length, null, "No size signal in desc/pack. Includes Kevin-flagged CGRVIMP apple aseptic + Cheney pineapple. LEAVE UNRESOLVED.", KEVIN_FILL);
  push("Step 5 (Q3 plant_or_egg)", "reintegrated", null, null, "Reversed Phase 4 exclusion only for rows whose pack now resolves via Step 2. Rows still count-only stay excluded.", KEVIN_FILL);
  push("Step 6 (Q4 TBJ beef implied)", "applied", CL5.steps_applied.step6?.rows || 0, CL5.steps_applied.step6?.spend || 0, "Where pack+wlv+item#=blank and up in per-lb range: implied_lb = ep/up. Kevin's 4 examples all already covered by Phase 4 Path C - net 0 new applied.", KEVIN_FILL);
  push("Step 7 (Q12 non-food verify)", "confirmed", null, null, "Category disagreement rows verified non-food. Small classifier inconsistency (10-30 rows/account not forced non-food) noted.", KEVIN_FILL);
  push("Step 8 (Q5 threshold)", "25% with caveat", null, null, "Publication threshold lowered to 25% (was 35%). Cells with coverage in [25%, 35%) published with caveat.", KEVIN_FILL);
  push("Step 9 (Q6 STL meals)", "projected", 3, null, "STL-FL: 7,540 (May) + 6,190 (Jun) + 5,130 (Jul) = 18,860 projected meals.", KEVIN_FILL);
  push("Step 10 (Q7 duplicate families)", "TBD", null, null, "Kevin: 'do whats most accurate now that pack reading is clarified'. Duplicate Item Families sheet re-evaluated in Phase 5 rerun.", KEVIN_FILL);
  push("Q15 (Cheney # convention)", `adopted (${Q15.reconcile_rate_pct?.toFixed(1)}%)`, Q15.pound_n_test.rows, null, "Self-answer test: 13/14 Cheney '#N' rows reconcile as catch-weight-lb pattern (>=80% threshold). Adopted; already covered via Step 3 (weight_line_value populated).", ANALYST_FILL);
  push("Q14 (GFS invoice reads)", `${Q14.invoices_probed} probed`, null, null, `Self-answer: GFS invoices with 'NxN CO' pack do NOT show per-line case weight. Cannot recover. Cost: $${Q14.total_cost_usd?.toFixed(3)}.`, ANALYST_FILL);
  push("Q17 (other-cat reclass)", "analyst call", Q17.reclassified_groups.length, Q17.reclassified_groups.reduce((a,b)=>a+b.spend,0), "Reclassified top 'other' groups (sorbets -> dairy, condiments -> dry_goods, fees -> non_food). Long tail stays 'other'.", ANALYST_FILL);
  push("Q11 (over-extraction threshold)", `q95 = ${Q11.quantiles.q95?.toFixed(2)}x`, Q11.invoices_scored, null, `MEASURED from data. Rounded up 0.05 recommended = ${Q11.recommended_threshold?.toFixed(2)}x. Above 1.15x=${Q11.above_thresholds["1.15x"]} invoices; above 1.20x=${Q11.above_thresholds["1.20x"]}; above 1.50x=${Q11.above_thresholds["1.50x"]}.`, ANALYST_FILL);
  push("Q13 (dpp sanity bands)", "measured", null, null, "Bands MEASURED per category. See 'Q13 Bands' sheet. seafood widened to 2.5*IQR; produce narrowed to 1*IQR; others 1.5*IQR.", ANALYST_FILL);
  push("Q21 (fresh/frozen sample)", "delivered", 30, null, "30-row stratified sample per Kevin's Q21 policy - see 'Q21 Chef Review Sample' sheet. Analyst does NOT self-validate; chef sign-off needed.", ANALYST_FILL);
  push("DOLLAR INVARIANCE CHECK", CL5.dollar_invariance_check?.pass ? "PASS" : "FAIL", CL5.dollar_invariance_check?.issues.length || 0, null, "Recomputed weight tables; dollars are unchanged from Phase 4.", CL5.dollar_invariance_check?.pass ? KEVIN_FILL : SUPPRESSED_FILL);

  // Legend
  r += 1;
  s.getCell(r++, 1).value = "Fill legend:";
  const g1 = s.getCell(r, 1); g1.value = "  Kevin-supplied answer applied"; g1.fill = KEVIN_FILL; r++;
  const g2 = s.getCell(r, 1); g2.value = "  Analyst decision (Kevin did not answer or self-answer via data)"; g2.fill = ANALYST_FILL; r++;
  const g3 = s.getCell(r, 1); g3.value = "  Suppressed (below 25% coverage or invariance fail)"; g3.fill = SUPPRESSED_FILL; r++;
  const g4 = s.getCell(r, 1); g4.value = "  Published with caveat (25-35% coverage)"; g4.fill = CAVEAT_FILL; r++;
}

// ============================================================================
// NEW SHEET: Fused-Slash Validation
// ============================================================================
{
  const s = wb.addWorksheet("Fused-Slash Validation", { views: [{ state: "frozen", ySplit: 3 }] });
  setColWidths(s, [12, 12, 45, 12, 15, 12, 15, 20, 30, 20]);
  s.getCell(1, 1).value = "Rule validation vs 30 Kevin-verified pack weights";
  s.getRow(1).font = { bold: true, size: 12 };
  s.getCell(2, 1).value = `Pass (uniquely resolved AND matches Kevin): ${FUSED.summary.pass}    Ambiguous but Kevin's answer matches one candidate: ${FUSED.summary.ambig_match}    Fail: ${FUSED.summary.fail}    Unhandled: ${FUSED.summary.unresolved}    Overall pass rate: ${FUSED.summary.pass_rate_pct}%`;
  const h = s.getRow(3);
  h.values = ["Vendor", "Item#", "Description", "Pack", "Kevin (raw)", "Kevin (lb)", "Resolver (lb)", "Status", "Source / reason", "Match?"];
  styleHeader(h);
  let r = 4;
  for (const d of FUSED.detail) {
    s.getCell(r, 1).value = d.vendor;
    s.getCell(r, 2).value = d.item;
    s.getCell(r, 3).value = d.description;
    s.getCell(r, 4).value = d.pack;
    s.getCell(r, 5).value = d.kevin_raw ?? "";
    s.getCell(r, 6).value = d.kevin_lb ?? "";
    s.getCell(r, 7).value = d.resolver_per_case_lb ?? "";
    s.getCell(r, 8).value = d.resolver_status;
    s.getCell(r, 9).value = d.resolver_source || d.resolver_reason || "";
    s.getCell(r, 10).value = String(d.match);
    if (d.match === true) for (let c = 1; c <= 10; c++) s.getCell(r, c).fill = KEVIN_FILL;
    else if (d.match === "ambiguous_but_option_matches") for (let c = 1; c <= 10; c++) s.getCell(r, c).fill = CAVEAT_FILL;
    else if (d.match === false) for (let c = 1; c <= 10; c++) s.getCell(r, c).fill = SUPPRESSED_FILL;
    r++;
  }
  r++;
  s.getCell(r, 1).value = "General 3-digit fused-slash disposition counts on full corpus:";
  s.getRow(r).font = { bold: true }; r++;
  const step2 = REC5.recovered.filter(x => x.step === 2 || x.step === "2");
  const rule4d = step2.filter(x => (x.source || "").includes("4d")).length;
  const rule3d12 = step2.filter(x => (x.source || "").includes("1plus2")).length;
  const rule3d21 = step2.filter(x => (x.source || "").includes("2plus1")).length;
  s.getCell(r++, 1).value = `  4-digit resolved (rule 4d, always 2+2): ${rule4d}`;
  s.getCell(r++, 1).value = `  3-digit 1+2 chosen: ${rule3d12}`;
  s.getCell(r++, 1).value = `  3-digit 2+1 chosen: ${rule3d21}`;
  s.getCell(r++, 1).value = `  3-digit ambiguous_skipped: ${REC5.meta.fused_ambiguous_skipped_count}`;
}

// ============================================================================
// NEW SHEET: Ambiguous Fused-Slash List
// ============================================================================
{
  const s = wb.addWorksheet("Fused Ambiguous Skipped", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [12, 22, 12, 45, 14, 10, 25, 20, 30]);
  const h = s.getRow(1);
  h.values = ["Account", "Vendor", "Item#", "Description", "Pack", "$", "Reason", "Option 1+2 (lb)", "Option 2+1 (lb)"];
  styleHeader(h);
  let r = 2;
  for (const a of REC5.fused_ambiguous_skipped) {
    s.getCell(r, 1).value = String(a.account || "").replace(" - ","-");
    s.getCell(r, 2).value = a.vendor;
    s.getCell(r, 3).value = a.item;
    s.getCell(r, 4).value = a.description;
    s.getCell(r, 5).value = a.pack;
    s.getCell(r, 6).value = a.ep;
    s.getCell(r, 6).numFmt = "$#,##0.00";
    s.getCell(r, 7).value = a.reason;
    s.getCell(r, 8).value = a.options?.one_two?.split + " -> " + a.options?.one_two?.per_case_lb + " lb";
    s.getCell(r, 9).value = a.options?.two_one?.split + " -> " + a.options?.two_one?.per_case_lb + " lb";
    r++;
  }
}

// ============================================================================
// NEW SHEET: Kevin Beverage Unsure (Q1 hold-aside)
// ============================================================================
{
  const s = wb.addWorksheet("Beverage Unresolved (Q1)", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [12, 55, 25, 15, 30]);
  const h = s.getRow(1);
  h.values = ["Account", "Description", "Pack", "Extended $", "Reason unresolved"];
  styleHeader(h);
  let r = 2;
  for (const b of REC5.beverage_unsure_list) {
    s.getCell(r, 1).value = String(b.account || "").replace(" - ","-");
    s.getCell(r, 2).value = b.description;
    s.getCell(r, 3).value = b.pack;
    s.getCell(r, 4).value = b.ep;
    s.getCell(r, 4).numFmt = "$#,##0.00";
    s.getCell(r, 5).value = b.reason;
    r++;
  }
}

// ============================================================================
// NEW SHEET: Q11 Over-Extraction Distribution
// ============================================================================
{
  const s = wb.addWorksheet("Q11 Over-Extraction Dist", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [50, 20]);
  let r = 1;
  s.getCell(r++, 1).value = "Q11: Invoice over-extraction distribution (post-Step 3 fix)";
  s.getRow(r-1).font = { bold: true, size: 12 };
  s.getCell(r++, 1).value = "Analyst decision (not Kevin): measure from data.";
  s.getCell(r++, 1).value = "";
  s.getCell(r, 1).value = "Invoices scored"; s.getCell(r, 2).value = Q11.invoices_scored; r++;
  for (const [q, v] of Object.entries(Q11.quantiles)) { s.getCell(r, 1).value = `Quantile ${q}`; s.getCell(r, 2).value = v; s.getCell(r, 2).numFmt = "0.00"; r++; }
  for (const [t, c] of Object.entries(Q11.above_thresholds)) { s.getCell(r, 1).value = `Invoices above ${t}`; s.getCell(r, 2).value = c; r++; }
  s.getCell(r, 1).value = "RECOMMENDED THRESHOLD (q95 rounded up 0.05)"; s.getCell(r, 2).value = Q11.recommended_threshold; s.getCell(r, 2).numFmt = "0.00"; s.getRow(r).font = { bold: true }; r++;
  r++;
  s.getCell(r++, 1).value = "Top 10 over-extracted invoices:";
  s.getRow(r-1).font = { bold: true };
  const hh = s.getRow(r);
  hh.values = ["Invoice UUID", "LI sum", "Header sum", "Ratio"];
  styleHeader(hh);
  r++;
  for (const x of Q11.top10_over) {
    s.getCell(r, 1).value = x.inv;
    s.getCell(r, 2).value = x.li; s.getCell(r, 2).numFmt = "$#,##0.00";
    s.getCell(r, 3).value = x.hdr; s.getCell(r, 3).numFmt = "$#,##0.00";
    s.getCell(r, 4).value = x.ratio; s.getCell(r, 4).numFmt = "0.00";
    r++;
  }
}

// ============================================================================
// NEW SHEET: Q13 Sanity Bands
// ============================================================================
{
  const s = wb.addWorksheet("Q13 dpp Bands", { views: [{ state: "frozen", ySplit: 1 }] });
  setColWidths(s, [14, 8, 12, 12, 12, 12, 12, 12, 12, 40]);
  const h = s.getRow(1);
  h.values = ["Category", "n", "Q1 $/lb", "Q3 $/lb", "IQR", "Multiplier", "Band low", "Band high", "Median", "Method"];
  styleHeader(h);
  let r = 2;
  for (const [cat, b] of Object.entries(Q13)) {
    s.getCell(r, 1).value = cat;
    s.getCell(r, 2).value = b.n;
    if (b.note) {
      s.getCell(r, 10).value = b.note;
    } else {
      s.getCell(r, 3).value = b.q1; s.getCell(r, 3).numFmt = "$#,##0.00";
      s.getCell(r, 4).value = b.q3; s.getCell(r, 4).numFmt = "$#,##0.00";
      s.getCell(r, 5).value = b.iqr; s.getCell(r, 5).numFmt = "$#,##0.00";
      s.getCell(r, 6).value = b.band_multiplier;
      s.getCell(r, 7).value = b.band_low; s.getCell(r, 7).numFmt = "$#,##0.00";
      s.getCell(r, 8).value = b.band_high; s.getCell(r, 8).numFmt = "$#,##0.00";
      s.getCell(r, 9).value = b.median; s.getCell(r, 9).numFmt = "$#,##0.00";
      s.getCell(r, 10).value = b.method;
    }
    r++;
  }
  r++;
  s.getCell(r, 1).value = "Analyst call (per Kevin's steer): seafood uses 2.5*IQR (wider), produce 1.0*IQR (narrower), others 1.5*IQR.";
  s.getRow(r).font = { italic: true };
}

// ============================================================================
// NEW SHEET: Q14 GFS Invoice Self-Answer
// ============================================================================
{
  const s = wb.addWorksheet("Q14 GFS Invoice Reads", { views: [{ state: "frozen", ySplit: 3 }] });
  setColWidths(s, [26, 18, 12, 15, 60]);
  s.getCell(1, 1).value = "Q14 Self-Answer: is total case weight visible on GFS invoice PDF?";
  s.getRow(1).font = { bold: true, size: 12 };
  s.getCell(2, 1).value = `Model: ${Q14.model}   Invoices probed: ${Q14.invoices_probed}   Total cost: $${Q14.total_cost_usd?.toFixed(3)}`;
  const h = s.getRow(3);
  h.values = ["Invoice UUID", "Invoice#", "Account", "Case-line with weight?", "Notes / raw response snippet"];
  styleHeader(h);
  let r = 4;
  for (const res of Q14.results) {
    s.getCell(r, 1).value = res.invoice_uuid;
    s.getCell(r, 2).value = res.invoice_number || "";
    s.getCell(r, 3).value = String(res.account || "").replace(" - ","-");
    if (res.parsed) {
      s.getCell(r, 4).value = res.parsed.invoice_has_case_line_with_weight ? "YES" : "NO";
      s.getCell(r, 5).value = (res.parsed.per_line || []).map(pl => `L${pl.line_index}: pack="${pl.pack_verbatim}" src=${pl.weight_source}`).join(" | ");
    } else if (res.error) {
      s.getCell(r, 4).value = "ERROR"; s.getCell(r, 5).value = res.error;
    } else {
      s.getCell(r, 5).value = res.raw;
    }
    r++;
  }
  r++;
  s.getCell(r, 1).value = "Conclusion: GFS invoices do NOT expose per-line case weight for 'NxN CO' packs. Rows remain unresolved.";
  s.getRow(r).font = { bold: true };
}

// ============================================================================
// NEW SHEET: Q15 Cheney #N Test
// ============================================================================
{
  const s = wb.addWorksheet("Q15 Cheney # Test", { views: [{ state: "frozen", ySplit: 3 }] });
  setColWidths(s, [10, 40, 10, 10, 10, 10, 15, 12]);
  s.getCell(1, 1).value = `Q15 Self-Answer: Cheney '#N' / '#' rows treat unit_price as $/lb, shipped_count as case count`;
  s.getRow(1).font = { bold: true, size: 12 };
  s.getCell(2, 1).value = `Reconcile rate: ${Q15.reconcile_rate_pct?.toFixed(1)}% of tested rows. Convention adopted: ${Q15.adopt_convention ? "YES" : "NO"}. (These rows already had wlv populated -> Step 3 catch-weight gate covers them.)`;
  const h = s.getRow(3);
  h.values = ["uom_raw", "Description", "up", "shipped", "ep", "cat", "implied wt/case lb", "in bounds?"];
  styleHeader(h);
  let r = 4;
  for (const d of Q15.pound_n_test.details.slice(0, 50)) {
    s.getCell(r, 1).value = "#N";
    s.getCell(r, 2).value = d.desc.slice(0, 60);
    s.getCell(r, 3).value = d.up; s.getCell(r, 3).numFmt = "$#,##0.00";
    s.getCell(r, 4).value = d.sh;
    s.getCell(r, 5).value = d.ep; s.getCell(r, 5).numFmt = "$#,##0.00";
    s.getCell(r, 6).value = d.cat;
    s.getCell(r, 7).value = Math.round(d.implied_weight_per_case * 100) / 100;
    s.getCell(r, 8).value = d.in_bounds ? "OK" : "REJECT";
    if (!d.in_bounds) for (let c = 1; c <= 8; c++) s.getCell(r, c).fill = SUPPRESSED_FILL;
    r++;
  }
}

// ============================================================================
// NEW SHEET: Q17 Other-Category Reclass
// ============================================================================
{
  const s = wb.addWorksheet("Q17 Other Reclass", { views: [{ state: "frozen", ySplit: 3 }] });
  setColWidths(s, [22, 55, 8, 12, 14, 14, 40]);
  s.getCell(1, 1).value = "Q17 Analyst Decision: reclassify top 'other' items into real categories; long tail stays 'other'";
  s.getRow(1).font = { bold: true, size: 12 };
  s.getCell(2, 1).value = `Original 'other' bucket: ${Q17.original_bucket.rows} rows / $${Q17.original_bucket.spend.toFixed(0)}. Reclassified: ${Q17.reclassified_groups.length} groups / $${Q17.reclassified_groups.reduce((a,b)=>a+b.spend,0).toFixed(0)}.`;
  const h = s.getRow(3);
  h.values = ["Vendor", "Description", "Rows", "Spend", "From", "To", "Reason"];
  styleHeader(h);
  let r = 4;
  for (const g of Q17.reclassified_groups) {
    s.getCell(r, 1).value = g.vendor;
    s.getCell(r, 2).value = g.description;
    s.getCell(r, 3).value = g.rows;
    s.getCell(r, 4).value = g.spend; s.getCell(r, 4).numFmt = "$#,##0.00";
    s.getCell(r, 5).value = g.from_category;
    s.getCell(r, 6).value = g.to_category;
    s.getCell(r, 7).value = g.reason;
    for (let c = 1; c <= 7; c++) s.getCell(r, c).fill = ANALYST_FILL;
    r++;
  }
  r += 2;
  s.getCell(r++, 1).value = "Top REMAINING 'other' rows (not reclassified):";
  s.getRow(r-1).font = { bold: true };
  for (const g of Q17.top_remaining) {
    s.getCell(r, 1).value = "";
    s.getCell(r, 2).value = g.description;
    s.getCell(r, 3).value = g.rows;
    s.getCell(r, 4).value = g.spend; s.getCell(r, 4).numFmt = "$#,##0.00";
    r++;
  }
}

// ============================================================================
// NEW SHEET: Q21 Chef Review Sample
// ============================================================================
{
  const s = wb.addWorksheet("Q21 Chef Review Sample", { views: [{ state: "frozen", ySplit: 3 }] });
  setColWidths(s, [10, 22, 55, 12, 15, 12, 14, 40, 15]);
  s.getCell(1, 1).value = "Q21 Chef Review Sample: fresh vs frozen storage-axis classifier - human validation needed";
  s.getRow(1).font = { bold: true, size: 12 };
  s.getCell(2, 1).value = `${Q21.method}. Chef: mark AGREE / DISAGREE / UNCERTAIN in the far-right column and add any notes.`;
  const h = s.getRow(3);
  h.values = ["Account", "Vendor", "Description", "Category", "Storage verdict", "Confidence", "Spend (window)", "Classifier reason", "CHEF: agree?"];
  styleHeader(h);
  let r = 4;
  for (const x of Q21.sample) {
    s.getCell(r, 1).value = x.sample_account;
    s.getCell(r, 2).value = x.vendor_name;
    s.getCell(r, 3).value = x.description;
    s.getCell(r, 4).value = x.category;
    s.getCell(r, 5).value = x.storage_axis;
    s.getCell(r, 6).value = x.storage_confidence;
    s.getCell(r, 7).value = x.spend; s.getCell(r, 7).numFmt = "$#,##0.00";
    s.getCell(r, 8).value = x.storage_reason;
    s.getCell(r, 9).value = "";  // to be filled by chef
    s.getCell(r, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF3E3" } };
    r++;
  }
}

// ============================================================================
// NEW SHEET: Phase 5 Change Log (mirror of the JSON)
// ============================================================================
{
  const s = wb.addWorksheet("Phase 5 Change Log");
  setColWidths(s, [110]);
  const lines = [
    "PHASE 5 CHANGE LOG",
    "",
    `Build date: ${CL5.meta.build_date}`,
    `Rule: ${CL5.meta.rule}`,
    `Publication threshold: ${CL5.meta.publication_threshold_pct}% (with caveat ${CL5.meta.caveat_band[0]}-${CL5.meta.caveat_band[1]}%)`,
    "",
    "STEPS APPLIED (Kevin's answers)",
    ...Object.entries(CL5.steps_applied || {}).map(([k, v]) => `  ${k}: ${v.rows} rows / $${v.spend?.toFixed(0)} / ${v.lbs?.toFixed(1)} lb`),
    "",
    `Fused-slash ambiguous_skipped: ${CL5.fused_ambiguous_skipped_count} rows`,
    `Catch-weight ep_qty_up_mismatch reclassified: ${CL5.catch_weight_reclassified_count} rows`,
    `Beverage rows classified by size rule: ${CL5.beverage_reclassified_count}`,
    `Beverage unresolved / Kevin-unsure held aside: ${CL5.beverage_unresolved}`,
    "",
    "PROTEIN MIX UPDATES (before -> after)",
    ...CL5.protein_mix_updates.map(u =>
      `  ${u.account} ${u.type}: cov ${u.before.coverage_spend_pct}% -> ${u.after.coverage_spend_pct}%; $/lb ${u.before.dollars_per_lb} -> ${u.after.dollars_per_lb} [${u.publication_status}]`
    ),
    "",
    "WEIGHT COVERAGE UPDATES",
    ...CL5.weight_coverage_updates.map(u =>
      `  ${u.account}: food coverage ${u.before.coverage_food_spend_pct}% -> ${u.after.coverage_food_spend_pct}%; food_lbs ${u.before.food_lbs} -> ${u.after.food_lbs}`
    ),
    "",
    "PER-MEAL UPDATES",
    ...CL5.per_meal_updates.map(u => JSON.stringify(u)),
    "",
    `CELLS CLEARED 25% publication threshold: ${CL5.cells_cleared_25pct.length}`,
    ...CL5.cells_cleared_25pct.slice(0, 20).map(c => `  ${c.account} ${c.cell}: cov ${c.coverage_pct}%, $/lb ${c.dollars_per_lb}`),
    "",
    `CELLS WITH CAVEAT (25-35% coverage): ${CL5.cells_with_caveat_25_35.length}`,
    ...CL5.cells_with_caveat_25_35.map(c => `  ${c.account} ${c.cell}: cov ${c.coverage_pct}%, $/lb ${c.dollars_per_lb}`),
    "",
    `CELLS SUPPRESSED below 25%: ${CL5.cells_suppressed_below_25pct.length}`,
    ...CL5.cells_suppressed_below_25pct.map(c => `  ${c.account} ${c.cell}: cov ${c.coverage_pct}%`),
    "",
    `DOLLAR INVARIANCE CHECK: ${CL5.dollar_invariance_check?.pass ? "PASS" : "FAIL"} (${CL5.dollar_invariance_check?.issues?.length || 0} issues)`,
    "",
    "STILL OPEN QUESTIONS (need Kevin, DO NOT guess)",
    "  Q18: printed / scanned vendor order guides for Sysco/Cheney/GFS/FreshPoint/Samuels? Decides whether vendor_catalog table is small build or real project. [HIGHEST-VALUE outstanding]",
    "  Q20: delivery-fee or minimum-order schedule anywhere? Without it, true delivered cost unanswerable.",
  ];
  for (const line of lines) {
    const row = s.addRow([line]);
    row.getCell(1).alignment = { wrapText: true };
    if (line.startsWith("PHASE") || line.startsWith("STEPS") || line.startsWith("PROTEIN") || line.startsWith("WEIGHT") || line.startsWith("PER-MEAL") || line.startsWith("CELLS") || line.startsWith("DOLLAR") || line.startsWith("STILL")) {
      row.getCell(1).font = { bold: true };
    }
  }
}

// -------- Save --------
await wb.xlsx.writeFile(WORKBOOK);
console.log(`wrote ${WORKBOOK} (${wb.worksheets.length} sheets)`);
