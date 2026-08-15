// Phase 6d workbook build: overlay v6d values onto the existing v6b workbook
// and add the new v6d sheets. Preserves all v6b sheets; adds:
//   - "v6d Summary"
//   - "v6d Category Rollup"           <- the D5 rollup Kevin requested
//   - "v6d Protein Mix"
//   - "v6d Weight & Coverage"
//   - "v6d D-Layer Change Log"
//   - "v6d Rules Applied"             <- D1/D2/D3/D4 governance summary
//
// Drops _v6d.xlsx copy to Downloads.

import fs from "node:fs";
import ExcelJS from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/node_modules/exceljs/excel.js";

const PATHS = {
  WB: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx",
  A6D: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6d.json",
  CL6D: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6d.json",
  A6: "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json",
  DOWNLOADS_V6D: "/Users/kevinfietek/Downloads/PURCHASE_ANALYSIS_2026_MAY_JUL_v6d.xlsx",
};

const A6D = JSON.parse(fs.readFileSync(PATHS.A6D, "utf8"));
const CL6D = JSON.parse(fs.readFileSync(PATHS.CL6D, "utf8"));
const A6 = JSON.parse(fs.readFileSync(PATHS.A6, "utf8"));

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264653" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9C46A" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
const CAVEAT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3B0" } };
const SUPPRESSED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEE7B7B" } };
const D1_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB3E5FC" } };
const D2_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC5E1A5" } };
const D3_FILL_HI = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC80" } };
const D3_FILL_MED = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFAB91" } };
const D4_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1C4E9" } };

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

const V6D_SHEETS = ["v6d Summary", "v6d Category Rollup", "v6d Protein Mix", "v6d Weight & Coverage", "v6d D-Layer Change Log", "v6d Rules Applied"];
for (const name of V6D_SHEETS) { const s = wb.getWorksheet(name); if (s) wb.removeWorksheet(s.id); }

const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];

// -----------------------------------------------------------------------
// v6d Summary
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d Summary", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [46, 20, 20, 20, 20]);
  s.addRow(["Phase 6d - D1/D2/D3/D4/D5 - Headline", ...ACCOUNTS, "Total"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];

  const p6d = A6D._phase6d;
  const d1a = p6d.d1.hits_by_account;
  const d2a = p6d.d2.hits_by_account;
  const d3a = p6d.d3.hits_by_account;

  const rows = [
    ["Core-food coverage (v6b baseline)", ...ACCOUNTS.map(a => A6.weight[a].coverage_core_food_spend_pct), null],
    ["Core-food coverage (v6d final)", ...ACCOUNTS.map(a => A6D.weight[a].coverage_core_food_spend_pct), null],
    ["Core-food lbs (v6b baseline)", ...ACCOUNTS.map(a => A6.weight[a].core_food_lbs), null],
    ["Core-food lbs (v6d final)", ...ACCOUNTS.map(a => A6D.weight[a].core_food_lbs), null],
    ["", null, null, null, null],
    ["D1 borrow rows added", ...ACCOUNTS.map(a => d1a[a].rows), Object.values(d1a).reduce((s,x)=>s+x.rows,0)],
    ["D1 borrow spend added ($)", ...ACCOUNTS.map(a => d1a[a].spend), Math.round(Object.values(d1a).reduce((s,x)=>s+x.spend,0)*100)/100],
    ["D2 fused-slash rows added", ...ACCOUNTS.map(a => d2a[a].rows), Object.values(d2a).reduce((s,x)=>s+x.rows,0)],
    ["D2 fused-slash spend added ($)", ...ACCOUNTS.map(a => d2a[a].spend), Math.round(Object.values(d2a).reduce((s,x)=>s+x.spend,0)*100)/100],
    ["D3 estimate rows added", ...ACCOUNTS.map(a => d3a[a].rows), Object.values(d3a).reduce((s,x)=>s+x.rows,0)],
    ["D3 estimate spend added ($)", ...ACCOUNTS.map(a => d3a[a].spend), Math.round(Object.values(d3a).reduce((s,x)=>s+x.spend,0)*100)/100],
    ["D3 estimate lbs added", ...ACCOUNTS.map(a => d3a[a].lbs), Math.round(Object.values(d3a).reduce((s,x)=>s+x.lbs,0)*10)/10],
    ["D3 estimate share of weight lbs (%)", ...ACCOUNTS.map(a => A6D.weight[a].food_lbs ? Math.round((d3a[a].lbs / A6D.weight[a].food_lbs) * 1000) / 10 : 0), null],
    ["", null, null, null, null],
    ["D4 egg rows reclassified to dairy", ...ACCOUNTS.map(a => null), p6d.d4.egg_row_count],
    ["D4 egg $ - was protein (v6b)", ...ACCOUNTS.map(a => p6d.d4.egg_spend_by_account_by_orig_cat[a]?.protein || 0), null],
    ["D4 egg $ - was dairy already (v6b)", ...ACCOUNTS.map(a => p6d.d4.egg_spend_by_account_by_orig_cat[a]?.dairy || 0), null],
    ["D4 egg $ - was dry_goods (v6b)", ...ACCOUNTS.map(a => p6d.d4.egg_spend_by_account_by_orig_cat[a]?.dry_goods || 0), null],
    ["", null, null, null, null],
    ["Dollar invariance", p6d.dollar_invariance.pass ? "PASS" : "FAIL", null, null, null],
    ["R8b band breaches", p6d.r8b_breaches.length, null, null, null],
  ];
  for (const r of rows) s.addRow(r);

  // Formatting
  const applyRowFmt = (rowIdx, fmt) => { for (let c = 2; c <= 4; c++) s.getCell(rowIdx, c).numFmt = fmt; };
  applyRowFmt(2, pct); applyRowFmt(3, pct);
  applyRowFmt(4, num); applyRowFmt(5, num);
  applyRowFmt(7, num0); applyRowFmt(8, money);
  applyRowFmt(9, num0); applyRowFmt(10, money);
  applyRowFmt(11, num0); applyRowFmt(12, money); applyRowFmt(13, num); applyRowFmt(14, pct);
  applyRowFmt(17, money); applyRowFmt(18, money); applyRowFmt(19, money);
  s.getCell(16, 5).numFmt = num0;
  s.addRow([]);
  const note = s.addRow([`Phase 6d applied to v6b (${p6d.build_date}). D1 = description-catalog borrow (tag catalog_lookup:description_match). D2 = fused-slash extension for 3-digit LB shapes. D3 = standard-case estimates (tag estimated_standard_case). D4 = egg reclassification to dairy (regex ${p6d.d4.egg_regex_positive}, excluding ${p6d.d4.egg_regex_negative} and EGGPLANT). D5 = category rollup on the v6d Category Rollup sheet. Invariance: every dollar figure identical to v6b except D4 category movement.`]);
  note.getCell(1).font = { italic: true };
  note.getCell(1).alignment = { wrapText: true };
  note.height = 80;
  s.mergeCells(note.number, 1, note.number, 5);
}

// -----------------------------------------------------------------------
// v6d Category Rollup - D5
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d Category Rollup", { properties: { tabColor: { argb: "FFF4A261" } } });
  setWidths(s, [12, 44, 14, 14, 14, 14, 14, 14, 14]);
  s.addRow(["Account", "Line", "Spend ($)", "Share of Total Food (%)", "Share of Invoice (%)", "$/Cover", "Weight lbs", "Lbs Coverage %", "$/lb"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  for (const acct of ACCOUNTS) {
    const R = A6D.rollup[acct];
    const headerRow = s.addRow([acct, `Canonical covers ${R.canonical_meals}  |  Total invoice ${R.total_invoice_spend}`]);
    headerRow.getCell(2).font = { bold: true };
    headerRow.fill = SUBHEADER_FILL;
    for (const L of R.lines) {
      const indentStr = " ".repeat(L.indent * 4);
      const row = s.addRow([acct, indentStr + L.line + (L.note ? "  (" + L.note + ")" : ""), L.spend, L.pct_of_total_food, L.pct_of_total_invoice, L.dollars_per_cover, L.lbs, L.lbs_coverage_pct, L.dollars_per_lb]);
      row.getCell(3).numFmt = money;
      row.getCell(4).numFmt = pct; row.getCell(5).numFmt = pct;
      row.getCell(6).numFmt = money;
      row.getCell(7).numFmt = num; row.getCell(8).numFmt = pct;
      row.getCell(9).numFmt = money;
      if (L.is_total) { row.font = { bold: true }; row.fill = TOTAL_FILL; }
    }
    s.addRow([]);
  }
  const noteRow = s.addRow([]);
  s.addRow(["Beverages sit inside Total food but outside core food. Rows are in canonical order: Total food (Protein / Dairy / Produce / Dry goods / Beverages), Other/fees, Non-food. $/lb only shown where a weight exists."]);
  s.getRow(s.rowCount).getCell(1).font = { italic: true };
  s.mergeCells(s.rowCount, 1, s.rowCount, 9);
}

// -----------------------------------------------------------------------
// v6d Protein Mix
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d Protein Mix", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [12, 16, 8, 12, 8, 12, 14, 12, 14, 30]);
  s.addRow(["Account", "Protein Type", "Rows", "Spend ($)", "Wt Rows", "Lbs", "Weight Spend ($)", "Coverage %", "$/lb", "Publication"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  for (const acct of ACCOUNTS) {
    const pm = A6D.protein_mix[acct];
    for (const b of pm.by_type) {
      const row = s.addRow([acct, b.type, b.rows, b.spend, b.lbs_rows, b.lbs, b.lbs_spend, b.coverage_spend_pct, b.dollars_per_lb, b._publication]);
      row.getCell(4).numFmt = money;
      row.getCell(6).numFmt = num;
      row.getCell(7).numFmt = money;
      row.getCell(8).numFmt = pct;
      row.getCell(9).numFmt = money;
      if (b._suppressed) row.eachCell(c => c.fill = SUPPRESSED_FILL);
      else if (b._caveat) row.eachCell(c => c.fill = CAVEAT_FILL);
    }
    s.addRow([]);
  }
}

// -----------------------------------------------------------------------
// v6d Weight & Coverage
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d Weight & Coverage", { properties: { tabColor: { argb: "FF2A9D8F" } } });
  setWidths(s, [12, 14, 10, 14, 10, 14, 12, 14, 12, 22]);
  s.addRow(["Account", "Category", "$-Set Rows", "$-Set Spend ($)", "Wt Rows", "Wt Spend ($)", "Weight Lbs", "Coverage %", "$/lb", "Publication"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  for (const acct of ACCOUNTS) {
    const w = A6D.weight[acct];
    for (const c of w.by_category) {
      const row = s.addRow([acct, c.category, c.food_rows_dollar_set, c.food_spend_dollar_set, c.food_rows_weight_set, c.food_spend_weight_set, c.weight_lbs, c.coverage_spend_pct, c.dollars_per_lb, c._publication]);
      row.getCell(4).numFmt = money;
      row.getCell(6).numFmt = money;
      row.getCell(7).numFmt = num;
      row.getCell(8).numFmt = pct;
      row.getCell(9).numFmt = money;
    }
    const totRow = s.addRow([acct, "TOTAL FOOD", w.food_rows_dollar_set, w.food_spend_dollar_set, w.food_rows_weight_set, w.food_spend_weight_set, w.food_lbs, w.coverage_food_spend_pct, w.food_lbs > 0 ? Math.round(w.food_spend_weight_set / w.food_lbs * 100) / 100 : null, "publish (aggregate)"]);
    totRow.font = { bold: true }; totRow.fill = TOTAL_FILL;
    totRow.getCell(4).numFmt = money; totRow.getCell(6).numFmt = money;
    totRow.getCell(7).numFmt = num; totRow.getCell(8).numFmt = pct; totRow.getCell(9).numFmt = money;
    s.addRow([]);
  }
}

// -----------------------------------------------------------------------
// v6d D-Layer Change Log
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d D-Layer Change Log", { properties: { tabColor: { argb: "FFE9C46A" } } });
  setWidths(s, [40, 10, 14, 22, 12, 22, 12, 12, 32, 20]);
  s.addRow(["Row ID", "Account", "Category", "v6d Source", "Layer", "v6b Source", "v6b Lb", "v6d Lb", "Description", "Vendor"]);
  styleHeader(s.getRow(1));
  s.views = [{ state: "frozen", ySplit: 1 }];
  const entries = CL6D.d_layer_change_log.slice();
  entries.sort((a, b) => (b.ep || 0) - (a.ep || 0));
  for (const e of entries) {
    const row = s.addRow([e.id, e.account, e.category, e.v6d_source, e.v6d_layer, e.v6b_source, e.v6b_lb, e.v6d_lb, e.description, e.vendor]);
    row.getCell(7).numFmt = num; row.getCell(8).numFmt = num;
    if (e.v6d_layer === "d1") row.eachCell(c => c.fill = D1_FILL);
    else if (e.v6d_layer === "d2") row.eachCell(c => c.fill = D2_FILL);
    else if (e.v6d_layer === "d3") row.eachCell(c => c.fill = D3_FILL_HI);
    if (e.d4_egg) row.getCell(3).fill = D4_FILL;
  }
}

// -----------------------------------------------------------------------
// v6d Rules Applied
// -----------------------------------------------------------------------
{
  const s = wb.addWorksheet("v6d Rules Applied", { properties: { tabColor: { argb: "FF264653" } } });
  setWidths(s, [12, 90]);
  const rules = [
    ["Rule ID", "Description"],
    ["D1", `Description-catalog borrow. Key vendor_id::description_norm (trimmed uppercase). Seeded from rows with parsed_weight_source in CLEAN_METHODS (pack_size / weight_line_value / catalog_lookup / description) and NOT invoice_over_extracted / ep_qty_up_mismatch. Precedence BELOW every evidence layer. Tag catalog_lookup:description_match. Catalog size ${A6D._phase6d.d1.catalog_size}; hits ${A6D._phase6d.d1.hits}; band-drop ${A6D._phase6d.d1.drops}. ${A6D._phase6d.d1.shortfall_note}`],
    ["D2", `Fused-slash extension for 3-digit LB pack shapes (410 LB / 115 LB / 140 LB etc). Bypasses isSuspiciousPackSize quarantine; passes shape to resolveFusedSlash (existing 3-digit rule tests both 1+2 and 2+1 splits and picks by category plausibility). Precedence BELOW D1. Hits ${A6D._phase6d.d2.hits}, band-drop ${A6D._phase6d.d2.drops}. Kevin: HORMEL BACON 5525 same UP $62.99 appears both '115 LB' and '1/15 LB' - proof the leading-1 3-digit form IS the dropped-slash form. 3-digit CT shapes (412 CT, 136 CT) deliberately NOT resolved to weight (count, not mass). KIWI (136 CT) permanently excluded per Kevin.`],
    ["D3", `Standard-case produce estimates. Tag estimated_standard_case with confidence tier (high | medium) on each row. Precedence BELOW D1 and D2. Each estimate lands only when the resulting $/lb falls inside the v6b R6b band for the row's category; out-of-band = dropped. Switchable off via --no-estimates flag. Hits ${A6D._phase6d.d3.hits}, band-drop ${A6D._phase6d.d3.drops}. High confidence: propack_banana / sysco_pineapple / propack_avocado_160 / avocado_hass_40_48 / grapes_red_sunfresh / strawberries_flat_8x1. Medium: lettuce_romaine_hearts / blueberries_flat_sunfresh / blueberries_fresh_cheney. Kevin: KIWI excluded (could not land a case weight producing a plausible price).`],
    ["D4", `Egg reclassification to dairy. Description-level match ${A6D._phase6d.d4.egg_regex_positive} with explicit exclusion of ${A6D._phase6d.d4.egg_regex_negative} and EGGPLANT. Row count ${A6D._phase6d.d4.egg_row_count}. Eggs are sold by count and stay OUT of the weight set (they cannot be converted to pounds). Dairy weight coverage will fall as a result - that is correct and reported, not compensated for. plant_or_egg protein bucket status per account is in _phase6d.d4.plant_or_egg_consequences. Total core food unchanged.`],
    ["D5", `Category rollup for the report. Per-account rollup on dollar set in canonical order: Total food (Protein / Dairy / Produce / Dry goods / Beverages), Other/fees, Non-food. Each line: spend, share of total food, share of invoice, $/cover, weight lbs, coverage %, $/lb. Beverages sit inside Total food but outside core food. Same rollup emitted on v6d Category Rollup sheet.`],
    ["Precedence", "Full weight-set precedence in v6d (top -> bottom): invoice_lb_arithmetic (R5b) > p5 > p4 > catch_implied > phase3c_rehab > base parser > D1 catalog_lookup:description_match > D2 fused_slash_rule_3d_* > D3 estimated_standard_case. R6b band gate remains in force on all layers except invoice_lb_arithmetic; D1/D2/D3 hits additionally undergo their own band check."],
    ["Invariance", `Every account, category, and per-cover dollar figure is identical to v6b except where D4 relocates egg dollars from protein / dry_goods to dairy. Invariance check ${A6D._phase6d.dollar_invariance.pass ? "PASS" : "FAIL"} (issues: ${A6D._phase6d.dollar_invariance.issues.length}).`],
    ["R8b", `All published protein-type $/lb inside [0.75, 25.00]. Breach count ${A6D._phase6d.r8b_breaches.length}.`],
    ["Switchability test", "Re-run with --no-estimates flag reproduces D1+D2-only state (D3 hits = 0). Confirms estimate layer is separable and switchable off."],
  ];
  for (const r of rules) {
    const row = s.addRow(r);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true };
    row.height = 60;
  }
  styleHeader(s.getRow(1));
}

await wb.xlsx.writeFile(PATHS.WB);
console.log(`wrote ${PATHS.WB}`);
await wb.xlsx.writeFile(PATHS.DOWNLOADS_V6D);
console.log(`wrote ${PATHS.DOWNLOADS_V6D}`);
