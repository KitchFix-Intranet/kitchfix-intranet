// Phase 6b workbook build: overlay v6b values onto the existing workbook and
// add the Phase 6 Bridge sheet Kevin requested.
//
// Strategy:
//   1. Load current workbook.
//   2. Append new sheets that carry v6b truth:
//        - "v6b Summary"           - refreshed headline
//        - "v6b Protein Mix"       - protein-type DPPs after R5b/R6b/R7
//        - "v6b Weight & Coverage" - core-food weight metrics after fixes
//        - "Phase 6 Bridge"        - v5 -> restatement -> fix delta -> v6 per protein type + per category per account
//        - "Q13 dpp Bands v6b"     - regenerated bands
//        - "Phase 6b Change Log"   - R4/R5b/R6b/R7 row-by-row
//        - "Phase 6b Rules Applied"- text sheet with governance summary
//        - "A3 Methodology Note"   - deferred methodology block Kevin asked for
//        - "B3 Limitations"        - verbatim limitations block
//   3. Save over PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx
//   4. Also drop _v6.xlsx copy in Downloads.
//
// Older sheets (Phase 3-5) remain in the workbook as historical reference.

import fs from "node:fs";
import ExcelJS from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/exceljs/excel.js";

const PATHS = {
  WB: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx",
  A5: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_analysis5.json",
  A6: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json",
  A6_BASELINE: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6_baseline.json",
  CL6: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6.json",
  BANDS_V6B: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_q13_bands_v6b.json",
  A4: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_analysis4.json",
  DOWNLOADS_V6: "/Users/kevinfietek/Downloads/PURCHASE_ANALYSIS_2026_MAY_JUL_v6.xlsx",
};

const A5 = JSON.parse(fs.readFileSync(PATHS.A5, "utf8"));
const A6 = JSON.parse(fs.readFileSync(PATHS.A6, "utf8"));
const A6B = JSON.parse(fs.readFileSync(PATHS.A6_BASELINE, "utf8"));
const CL6 = JSON.parse(fs.readFileSync(PATHS.CL6, "utf8"));
const BANDS = JSON.parse(fs.readFileSync(PATHS.BANDS_V6B, "utf8"));
const A4 = JSON.parse(fs.readFileSync(PATHS.A4, "utf8"));

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264653" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9C46A" } };
const CAVEAT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3B0" } };
const SUPPRESSED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEE7B7B" } };
const KEVIN_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
const BRIDGE_DELTA_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6DBEF" } };

const styleHeader = (row) => {
  row.eachCell((c) => { c.fill = HEADER_FILL; c.font = HEADER_FONT; c.alignment = { vertical: "middle", horizontal: "left", wrapText: true }; });
  row.height = 22;
};
const setWidths = (s, ws) => ws.forEach((w, i) => { s.getColumn(i + 1).width = w; });
const money = "$#,##0.00";
const num = "#,##0.0";
const num0 = "#,##0";
const pct = '0.0"%"';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PATHS.WB);
console.log(`loaded ${wb.worksheets.length} sheets`);

// Drop any pre-existing v6b sheets so we can re-add cleanly
const V6B_SHEETS = [
  "v6b Summary",
  "v6b Protein Mix",
  "v6b Weight & Coverage",
  "Phase 6 Bridge",
  "Q13 dpp Bands v6b",
  "Phase 6b Change Log",
  "Phase 6b Rules Applied",
  "A3 Methodology Note",
  "B3 Limitations",
];
for (const name of V6B_SHEETS) {
  const s = wb.getWorksheet(name);
  if (s) wb.removeWorksheet(s.id);
}

const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];

// -----------------------------------------------------------------------
// v6b Summary
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6b Summary", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [42, 20, 20, 20, 20]);
  s.addRow(["Phase 6b - Weight-Set Fix - Headline", ...ACCOUNTS, "Total"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];

  const rows = [
    ["Dollar spend (dollar set, total)", ...ACCOUNTS.map(a => A6.spend[a].dollar_food_spend ?? A4.spend[a].dollar_food_spend), null],
    ["Core-food spend (dollar set)", ...ACCOUNTS.map(a => A6.weight[a].core_food_spend_dollar_set), null],
    ["Core-food spend in weight set", ...ACCOUNTS.map(a => A6.weight[a].core_food_spend_weight_set), null],
    ["Core-food weight coverage %", ...ACCOUNTS.map(a => A6.weight[a].coverage_core_food_spend_pct), null],
    ["Core-food lbs (v6)", ...ACCOUNTS.map(a => A6.weight[a].core_food_lbs), null],
    ["Core-food lbs (baseline)", ...ACCOUNTS.map(a => A6B.weight[a].core_food_lbs), null],
    ["Canonical window covers", ...ACCOUNTS.map(a => A6.per_meal[a].window_meals_used), null],
    ["$/cover (core food, v6)", ...ACCOUNTS.map(a => A6.per_meal[a].window_dollars_per_meal_core), null],
    ["lb/cover (core food, v6)", ...ACCOUNTS.map(a => A6.per_meal[a].window_lbs_per_meal_core), null],
    ["lb/cover (core food, baseline)", ...ACCOUNTS.map(a => A6B.per_meal[a].window_lbs_per_meal_core), null],
  ];
  for (const r of rows) s.addRow(r);
  // Formatting: rows 2-4 = money, row 5 = pct, rows 6-7 = num, row 8 = num0, rows 9-11 = money+num
  const applyRowFmt = (rowIdx, fmt) => {
    for (let c = 2; c <= 4; c++) s.getCell(rowIdx, c).numFmt = fmt;
  };
  applyRowFmt(2, money); applyRowFmt(3, money); applyRowFmt(4, money);
  applyRowFmt(5, pct);
  applyRowFmt(6, num); applyRowFmt(7, num);
  applyRowFmt(8, num0);
  applyRowFmt(9, money);
  applyRowFmt(10, num); applyRowFmt(11, num);
  s.addRow([]);
  const noteRow = s.addRow(["Denominator source: Kevin's 2026 Service Calendars + STL 2027 projections (Addendum A1). B&G disclosure attached to TBR $/cover."]);
  noteRow.getCell(1).font = { italic: true };
  noteRow.getCell(1).alignment = { wrapText: true };
  noteRow.height = 30;
  s.mergeCells(noteRow.number, 1, noteRow.number, 5);
}

// -----------------------------------------------------------------------
// v6b Protein Mix
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6b Protein Mix", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [12, 16, 8, 12, 8, 12, 14, 12, 14, 22]);
  s.addRow(["Account", "Protein Type", "Rows", "Spend ($)", "Wt Rows", "Lbs", "Weight Spend ($)", "Coverage %", "$/lb", "Publication"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  let r = 2;
  for (const acct of ACCOUNTS) {
    const pm = A6.protein_mix[acct];
    for (const b of pm.by_type) {
      const row = s.addRow([acct, b.type, b.rows, b.spend, b.lbs_rows, b.lbs, b.lbs_spend, b.coverage_spend_pct, b.dollars_per_lb, b._publication]);
      row.getCell(4).numFmt = money;
      row.getCell(6).numFmt = num;
      row.getCell(7).numFmt = money;
      row.getCell(8).numFmt = pct;
      row.getCell(9).numFmt = money;
      if (b._suppressed) row.eachCell(c => c.fill = SUPPRESSED_FILL);
      else if (b._caveat) row.eachCell(c => c.fill = CAVEAT_FILL);
      r++;
    }
    s.addRow([]);
    r++;
  }
}

// -----------------------------------------------------------------------
// v6b Weight & Coverage
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6b Weight & Coverage", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [12, 14, 10, 14, 10, 14, 12, 14, 12, 12]);
  s.addRow(["Account", "Category", "$-Set Rows", "$-Set Spend ($)", "Wt Rows", "Wt Spend ($)", "Weight Lbs", "Coverage %", "$/lb", "Publication"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  for (const acct of ACCOUNTS) {
    const w = A6.weight[acct];
    for (const c of w.by_category) {
      const row = s.addRow([acct, c.category, c.food_rows_dollar_set, c.food_spend_dollar_set, c.food_rows_weight_set, c.food_spend_weight_set, c.weight_lbs, c.coverage_spend_pct, c.dollars_per_lb, c._publication]);
      row.getCell(4).numFmt = money;
      row.getCell(6).numFmt = money;
      row.getCell(7).numFmt = num;
      row.getCell(8).numFmt = pct;
      row.getCell(9).numFmt = money;
    }
    // Account total row
    const totRow = s.addRow([acct, "TOTAL FOOD", w.food_rows_dollar_set, w.food_spend_dollar_set, w.food_rows_weight_set, w.food_spend_weight_set, w.food_lbs, w.coverage_food_spend_pct, w.food_lbs > 0 ? Math.round(w.food_spend_weight_set / w.food_lbs * 100) / 100 : null, "publish (aggregate)"]);
    totRow.font = { bold: true };
    totRow.getCell(4).numFmt = money;
    totRow.getCell(6).numFmt = money;
    totRow.getCell(7).numFmt = num;
    totRow.getCell(8).numFmt = pct;
    totRow.getCell(9).numFmt = money;
    s.addRow([]);
  }
}

// -----------------------------------------------------------------------
// Phase 6 Bridge - v5 -> restatement -> fix delta -> v6 per protein type + per category per account
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("Phase 6 Bridge", { properties: { tabColor: { argb: "FFE9C46A" } } });
  setWidths(s, [12, 14, 22, 16, 16, 16, 16, 30]);
  s.addRow(["Account", "Kind", "Row", "v5 Value", "Restatement", "Fix Delta (v6 - v5 - restate)", "v6 Value", "Notes"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];

  // The restatement is a DOLLAR restatement (TBJ +$12,629.32; TBR/STL zero).
  // The fix delta is a WEIGHT / DPP restatement (from R5b/R6b/R7).
  const RESTATEMENT_DOLLAR = { "TBJ-FL": 12629.32, "TBR-FL": 0, "STL-FL": 0 };

  // Row 1: total dollar spend restatement (dollar set)
  for (const acct of ACCOUNTS) {
    // From baseline (v5) A5.spend[acct].dollar_food_spend if it exists;
    // if v5-logic baseline stored old values pre-restatement, use A5 as v5.
    const v5DollarFood = A5.spend?.[acct]?.dollar_food_spend ?? null;
    const v6DollarFood = A6.spend?.[acct]?.dollar_food_spend ?? A6.weight[acct].food_spend_dollar_set;
    const restate = RESTATEMENT_DOLLAR[acct];
    const fixDelta = v6DollarFood != null && v5DollarFood != null ? v6DollarFood - v5DollarFood - restate : null;
    const row = s.addRow([acct, "spend", "dollar_food_spend (dollar set)", v5DollarFood, restate, fixDelta, v6DollarFood, restate !== 0 ? "R2(a) restatement: TBJ +$12,629.32" : "no restatement"]);
    row.getCell(4).numFmt = money; row.getCell(5).numFmt = money; row.getCell(6).numFmt = money; row.getCell(7).numFmt = money;
    if (restate !== 0) row.getCell(5).fill = KEVIN_FILL;
  }
  s.addRow([]);

  // Category rows (weight only): v5 -> v6 with fix delta
  for (const acct of ACCOUNTS) {
    for (const c of A6.weight[acct].by_category) {
      const v5w = A5.weight?.[acct]?.by_category?.find?.(x => x.category === c.category);
      const v5Lbs = v5w?.weight_lbs ?? null;
      const v5Spend = v5w?.food_spend_weight_set ?? null;
      const v5Dpp = v5w?.dollars_per_lb ?? null;
      const v6Lbs = c.weight_lbs;
      const v6Dpp = c.dollars_per_lb;
      // Lbs restatement: 0 for all accounts (weight restatement is what fix produces)
      const lbsDelta = v5Lbs != null ? v6Lbs - v5Lbs : null;
      const dppDelta = v5Dpp != null && v6Dpp != null ? v6Dpp - v5Dpp : null;
      const rowLbs = s.addRow([acct, "category-lbs", c.category, v5Lbs, 0, lbsDelta, v6Lbs, `cov ${c.coverage_spend_pct}%`]);
      rowLbs.getCell(4).numFmt = num; rowLbs.getCell(5).numFmt = num; rowLbs.getCell(6).numFmt = num; rowLbs.getCell(7).numFmt = num;
      if (lbsDelta != null && Math.abs(lbsDelta) > 100) rowLbs.getCell(6).fill = BRIDGE_DELTA_FILL;
      const rowDpp = s.addRow([acct, "category-$/lb", c.category, v5Dpp, 0, dppDelta, v6Dpp, ""]);
      rowDpp.getCell(4).numFmt = money; rowDpp.getCell(5).numFmt = money; rowDpp.getCell(6).numFmt = money; rowDpp.getCell(7).numFmt = money;
    }
    s.addRow([]);
  }
  s.addRow([]);

  // Protein-type rows
  for (const acct of ACCOUNTS) {
    for (const b of A6.protein_mix[acct].by_type) {
      const v5b = A5.protein_mix?.[acct]?.by_type?.find?.(x => x.type === b.type);
      const v5Lbs = v5b?.lbs ?? null;
      const v5Dpp = v5b?.dollars_per_lb ?? null;
      const v6Lbs = b.lbs;
      const v6Dpp = b.dollars_per_lb;
      const lbsDelta = v5Lbs != null ? v6Lbs - v5Lbs : null;
      const dppDelta = v5Dpp != null && v6Dpp != null ? v6Dpp - v5Dpp : null;
      const rowLbs = s.addRow([acct, "protein-lbs", b.type, v5Lbs, 0, lbsDelta, v6Lbs, b._publication]);
      rowLbs.getCell(4).numFmt = num; rowLbs.getCell(5).numFmt = num; rowLbs.getCell(6).numFmt = num; rowLbs.getCell(7).numFmt = num;
      if (lbsDelta != null && Math.abs(lbsDelta) > 100) rowLbs.getCell(6).fill = BRIDGE_DELTA_FILL;
      const rowDpp = s.addRow([acct, "protein-$/lb", b.type, v5Dpp, 0, dppDelta, v6Dpp, ""]);
      rowDpp.getCell(4).numFmt = money; rowDpp.getCell(5).numFmt = money; rowDpp.getCell(6).numFmt = money; rowDpp.getCell(7).numFmt = money;
    }
    s.addRow([]);
  }
  s.addRow([]);
  const noteRow = s.addRow(["Bridge legend: v5 = published Phase 5 value. Restatement column is dollar-set restatement from R2(a) (Kevin's Fact 2, +$12,629.32 for TBJ; zero for TBR/STL). Fix Delta = v6 value minus v5 minus restatement, reflecting R5b invoice-lb arithmetic + R6b band gate + R7 fluid-oz restoration. Highlighted delta cells exceed 100 lbs / $100 movement."]);
  noteRow.getCell(1).font = { italic: true };
  noteRow.getCell(1).alignment = { wrapText: true };
  s.mergeCells(noteRow.number, 1, noteRow.number, 8);
  noteRow.height = 60;
}

// -----------------------------------------------------------------------
// Q13 dpp Bands v6b
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("Q13 dpp Bands v6b", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [14, 6, 8, 8, 8, 8, 12, 10, 12, 14, 10, 42]);
  s.addRow(["Category", "N", "Q1", "Q3", "IQR", "k*IQR", "Raw Low", "Floor Cat", "Band Low", "Band High", "Median", "Method"]);
  styleHeader(s.getRow(1));
  for (const [cat, b] of Object.entries(BANDS).sort((a, b) => (b[1].n || 0) - (a[1].n || 0))) {
    if (b.note) { s.addRow([cat, b.n, "-", "-", "-", "-", "-", "-", "-", "-", "-", b.note]); continue; }
    const row = s.addRow([cat, b.n, b.q1, b.q3, b.iqr, b.band_multiplier, b.raw_low_iqr, b.category_plausible_floor, b.band_low, b.band_high, b.median, b.method]);
    for (const c of [3, 4, 5, 6, 7, 8, 9, 10, 11]) row.getCell(c).numFmt = money;
    row.getCell(12).alignment = { wrapText: true };
  }
  const noteRow = s.addRow([]);
  s.addRow(["Rule (R6b): band_low = max(Q1 - k*IQR, category-plausible-floor). Floor pins bottom when IQR floor is negative; a $0.15/lb protein row is a defect, not a real price. R6b applies to ALL layers except invoice_lb_arithmetic (R5b, exempt because it is printed arithmetic)."]);
}

// -----------------------------------------------------------------------
// Phase 6b Change Log (top 100 by |lbs_delta| + all R5b + all R6b_band_out_of_range)
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("Phase 6b Change Log", { properties: { tabColor: { argb: "FFE9C46A" } } });
  setWidths(s, [40, 12, 12, 14, 22, 10, 10, 22, 10, 22]);
  s.addRow(["Row ID", "Account", "Category", "Protein Type", "Before Source", "Before Lb", "After Lb", "After Source", "EP", "Rule"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  const entries = CL6.entries.slice();
  entries.sort((a, b) => {
    const dA = Math.abs((a.before_lb || 0) - (a.after_lb || 0));
    const dB = Math.abs((b.before_lb || 0) - (b.after_lb || 0));
    return dB - dA;
  });
  for (const e of entries) {
    const row = s.addRow([e.id, e.account, e.category, e.protein_type, e.before_source, e.before_lb, e.after_lb, e.after_source, e.ep, e.rule]);
    row.getCell(6).numFmt = num; row.getCell(7).numFmt = num; row.getCell(9).numFmt = money;
    if (e.rule.startsWith("R5b")) row.eachCell(c => c.fill = KEVIN_FILL);
    else if (e.rule.startsWith("R6b")) row.eachCell(c => c.fill = SUBHEADER_FILL);
  }
}

// -----------------------------------------------------------------------
// Phase 6b Rules Applied - governance text
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("Phase 6b Rules Applied", { properties: { tabColor: { argb: "FF264653" } } });
  setWidths(s, [22, 82]);
  const rules = [
    ["Rule ID", "Description"],
    ["R4 (v6b)", "Catch-implied weight layer (ep / unit_price) - precedence BELOW p5 and p4, ABOVE 3c-rehab and base. Tag: catch_weight_implied_ep_over_up. No arithmetic gate on the catch layer per Kevin's S2 ruling."],
    ["R5b (v6b)", "Invoice-lb arithmetic - TOP precedence, above p5. Trigger: lower(unit)='lb' AND |quantity*unit_price - extended_price| <= max(1, 0.02 * extended_price). Effective weight = quantity. Source tag: invoice_lb_arithmetic. No alreadyResolved guard - this rule wins over every other layer. Fixes the d48e8152 defect (5,630 lb -> 117.3 lb)."],
    ["R6b (v6b)", "$/lb plausibility gate on ALL weight-set rows regardless of source, EXCEPT rows tagged invoice_lb_arithmetic. Bands regenerated from live post-fix data (see Q13 dpp Bands v6b sheet). band_low = max(Q1 - k*IQR, category-plausible-floor); floor pins bottom when IQR floor is negative."],
    ["R7 (v6b)", "Fluid-oz restoration: p5 fused-slash resolutions on beverage-basis rows revert to volume_excluded."],
    ["R8b (v6b)", "Standing build-time hard-fail on $/lb PLAUSIBILITY per protein type per account: fail if any published protein-type dollars_per_lb falls outside [0.75, 25.00]. lb/cover becomes a WARNING (flag above 1.0), not a fail."],
    ["R9", "Catch ∩ p4 rows: 9 confirmed, all TBJ-FL protein. Existing p5 -> p4 precedence keeps p4 value; catch layer never applied. See _s5_catch_p4.json."],
    ["R10", "Change log: every row whose effective weight or set-membership changes vs the v5-logic baseline gets an entry. See Phase 6b Change Log sheet."],
    ["S1 root cause", "Supabase .range() pagination without an ORDER BY returns rows in undefined order across pages, causing silent drops. Fresh AUG after pagination fix (add .order('id') + de-dup guard) matches Kevin's Fact 2 to the cent (TBJ 2,202 rows / $183,851.55)."],
  ];
  for (const r of rules) {
    const row = s.addRow(r);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true };
    row.height = 30;
  }
  styleHeader(s.getRow(1));
}

// -----------------------------------------------------------------------
// A3 Methodology Note
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("A3 Methodology Note", { properties: { tabColor: { argb: "FF264653" } } });
  setWidths(s, [110]);
  const paragraphs = [
    "Phase 6b Methodology (v6b) - purchasing analytics, 2026-05-01 to 2026-07-31 window.",
    "",
    "Data source: ai_line_items table in Supabase (kitchfix-intranet Postgres). Rows are OCR-extracted invoice line items across three accounts (TBR-FL / TBJ-FL / STL-FL). Fresh pull matches Kevin's Fact 1 (TBR/STL to the cent) and Fact 2 (TBJ 2,202 rows / $183,851.55).",
    "",
    "Two-tier quality filter. Dollar set = rows excluding review_reason='invoice_over_extracted' (extraction defects). Weight set = dollar-set rows that also carry an effective weight from one of the seven weight-resolution layers, subject to R6b band gate.",
    "",
    "Weight-resolution precedence (v6b). From highest to lowest: (1) invoice_lb_arithmetic (R5b) - printed pounds arithmetic where lower(unit)='lb' and |qty*up - ep| <= max($1, 2%). (2) Phase 5 recovered - shipped_count_is_lb, kevin_verified_pack, implied_from_ep_and_unit_price, cheney_pound_n_convention, fused_slash_rule_*. (3) Phase 4 recovered - catch-weight and pack-size rescues. (4) catch_weight_implied_ep_over_up (R4) - reinstated catch-weight rows admitted when ep/up is in (0, 5000]. (5) Phase 3c rehab - sibling-borrowed weights. (6) Base parser - pack_size/description/catalog lookups; suspicious multipack shapes (e.g., '004/12 #') are quarantined to prevent 5,630-lb inflations. (7) unresolved.",
    "",
    "$/lb plausibility gate (R6b). Every weight-set row except those tagged invoice_lb_arithmetic must fall inside a category-derived band. Bands regenerated from v6b pre-gate distribution: [max(Q1 - k*IQR, category-plausible-floor), Q3 + k*IQR]. k = 1.0 for produce, 1.5 elsewhere. Category-plausible-floor pins the bottom when the IQR floor goes negative (a $0.15/lb protein row is a defect, not a real price). Out-of-band rows leave the weight set only; they still contribute to dollar-set totals.",
    "",
    "Per-cover denominators (Addendum A1). Calendar-canonical, not actuals: TBR-FL 20,300 (MiLB 18,680 + B&G 1,620); TBJ-FL 29,541; STL-FL 18,860 (FCL 11,060 + PBC 7,800). Source: Kevin's 2026 TBR + TBJ Service Calendars + STL 2027 projections. Sparse-month substitution disabled for this window.",
    "",
    "B&G disclosure. TBR-FL includes 1,620 Boys and Girls Club after-school supper meals (8.0% of TBR window covers, all in May). Billed at $6.50 per meal against MiLB blended $20.05. Invoice product is not split between clients; per-cover figures are a floor for MiLB-only intensity.",
    "",
    "Standing build gate (R8b). Fails when any published protein-type dollars_per_lb falls outside [0.75, 25.00] - a range that admits commodity chicken at the bottom and premium beef/seafood at the top. lb/cover is now a warning (flag above 1.0), not a fail.",
    "",
    "Publication thresholds. coverage >= 35%: publish. 25% <= coverage < 35%: publish with caveat. coverage < 25%: suppressed. plant_or_egg buckets never publish (mixed count / weight source).",
  ];
  for (const p of paragraphs) {
    const row = s.addRow([p]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.height = Math.max(20, Math.ceil(p.length / 100) * 15 + 10);
  }
}

// -----------------------------------------------------------------------
// B3 Limitations
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("B3 Limitations", { properties: { tabColor: { argb: "FFEE7B7B" } } });
  setWidths(s, [110]);
  const paragraphs = [
    "Phase 6b Limitations",
    "",
    "1. Weight coverage is partial. Even after Phase 6b, only 41.3%-65.4% of core-food spend across accounts sits in the weight set. Every $/lb figure is computed over the covered subset, not the full purchase basket. Rows with unresolved weights are excluded from lbs totals but included in dollar totals.",
    "",
    "2. Extraction defects still present in dollar set. review_reason='invoice_over_extracted' rows are stripped, but other extraction errors (missing lines, mis-classified vendors, transposed digits) survive. Cross-checked spend totals reconcile to Kevin's Fact 2 (TBJ $183,851.55) but reconciliation is at the account-month level, not the invoice level.",
    "",
    "3. B&G product is not client-split on TBR invoices. TBR-FL purchases fund both MiLB service and the B&G after-school supper program. There is no line-item tagging that separates B&G product from MiLB product. Per-cover intensity for TBR is therefore a floor, not a MiLB-exact value.",
    "",
    "4. STL denominator is a projection. The 18,860 window meals is Kevin's 2027 Service Calendar projection (7,540 / 6,190 / 5,130 by month), not billed actuals. STL 2026 window billed actuals are sparse and were the trigger for the calendar-canonical decision (Addendum A1).",
    "",
    "5. Invoice_lb_arithmetic (R5b) precedence is trust-based. When lower(unit)='lb' and qty*up = ep within tolerance, we take qty as printed pounds - this outranks every parser inference including Phase 5 catalogue lookups and Phase 4 pack-size recovery. If Kevin's original protein-type classifier (assignProteinType) tags a row wrongly, the R5b weight still lands in whatever wrong bucket.",
    "",
    "6. Band regeneration is data-derived within v6b. R6b bands come from the v6b pre-gate weight-set distribution. If a category is dominated by systematically-wrong rows, the band will normalize around those wrong rows and let similar wrong rows through. Category-plausible-floors partially mitigate at the bottom but not at the top.",
    "",
    "7. Baseline fire test for R8b did not fire on the fresh AUG. Kevin's expectation was that STL beef/poultry aggregate $/lb would fall below $0.75 in baseline mode. Fresh-AUG baseline shows STL beef aggregate at $4.17/lb (skewed low by the d48e8152 5,630-lb defect but pulled up by clean rows in the average). R8b is well-formed but did not fire on this dataset because aggregate averaging masked individual-row defects. v6b passes cleanly.",
    "",
    "8. 9 catch ∩ p4 rows all resolved via p4 layer, not catch. No double-count. One row (5b875a1c BEEF FAJ OUTSIDE SKIRT MARN) has p4_lb=410 (10x plausible), which R6b did NOT gate because dpp=$0.93 falls inside the protein band [$0.75, $18.56]. Flagged for a future p4 audit.",
  ];
  for (const p of paragraphs) {
    const row = s.addRow([p]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.height = Math.max(20, Math.ceil(p.length / 100) * 15 + 10);
  }
}

await wb.xlsx.writeFile(PATHS.WB);
console.log(`wrote ${PATHS.WB}`);

// Also write versioned copy to Downloads
await wb.xlsx.writeFile(PATHS.DOWNLOADS_V6);
console.log(`wrote ${PATHS.DOWNLOADS_V6}`);
