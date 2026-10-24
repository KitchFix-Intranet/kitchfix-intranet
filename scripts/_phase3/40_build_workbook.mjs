// Build the final Excel workbook from _analysis.json.
// 13 sheets per Kevin's spec.

import fs from "node:fs";
import ExcelJS from "exceljs";

const A = JSON.parse(
  fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_analysis.json", "utf8")
);
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/PURCHASE_ANALYSIS_2026_MAY_JUL.xlsx";
const ACCOUNTS = Object.keys(A.spend);
const MONTHS = ["2026-05", "2026-06", "2026-07"];

const wb = new ExcelJS.Workbook();
wb.creator = "Phase 3 purchasing analysis";
wb.created = new Date();

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264653" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9C46A" } };
const SUBHEADER_FONT = { bold: true };
const PROJECTED_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4E37E" } };
const UNAVAIL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEE7B7B" } };
const SPARSE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B78E" } };

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

function applyCurrency(sheet, col, startRow, endRow) {
  for (let r = startRow; r <= endRow; r++) {
    const cell = sheet.getCell(r, col);
    cell.numFmt = "$#,##0.00";
    cell.alignment = { horizontal: "right" };
  }
}

function applyPercent(sheet, col, startRow, endRow) {
  // Values in analysis are already whole-number percents (e.g. 88.1). Use custom fmt.
  for (let r = startRow; r <= endRow; r++) {
    const cell = sheet.getCell(r, col);
    cell.numFmt = '0.0"%"';
    cell.alignment = { horizontal: "right" };
  }
}

function applyNumber(sheet, col, startRow, endRow, fmt = "#,##0.0") {
  for (let r = startRow; r <= endRow; r++) {
    const cell = sheet.getCell(r, col);
    cell.numFmt = fmt;
    cell.alignment = { horizontal: "right" };
  }
}

// ============================================================================
// Sheet 1: Summary
// ============================================================================
{
  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 60;
  s.getColumn(2).width = 22;
  s.getColumn(3).width = 22;
  s.getColumn(4).width = 22;
  s.getColumn(5).width = 22;

  let r = 1;
  s.getCell(r++, 1).value = "Purchasing Comparison Analysis - TBR-FL, TBJ-FL, STL-FL";
  s.getCell(r - 1, 1).font = { bold: true, size: 14 };
  s.getCell(r++, 1).value = `Window: ${A.window_label}`;
  s.getCell(r++, 1).value = "Scope: three months. Off-season overall; MiLB is in-season (Triple-A + Double-A operations across TBR/TBJ/STL Florida sites).";
  s.getCell(r++, 1).value = "Data source: ai_line_items (Postgres) with the Phase 2 packSizeParser + foodClassifier applied in-memory.";
  s.getCell(r++, 1).value = "Every figure is labeled DOLLAR SET or WEIGHT SET (see Methodology).";
  s.getCell(r++, 1).value = "Do NOT extrapolate to annual - three-month window only, off-season for the main dining program, in-season for the MiLB sub-program.";
  r++;

  s.getCell(r, 1).value = "Row-set summary";
  s.getRow(r).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Total live rows in window (post orphan-corrected exclusion)";
  s.getCell(r, 2).value = A.total_live_rows;
  r++;
  s.getCell(r, 1).value = "Orphan-corrected rows excluded (parent header status=corrected/deleted)";
  s.getCell(r, 2).value = A.orphan_excluded_rows;
  r++;
  s.getCell(r, 1).value = "Date-drift rows recovered into window via read-time normalization";
  s.getCell(r, 2).value = A.drift_recovered_rows;
  r++;
  s.getCell(r, 1).value = "DOLLAR SET excluded: review_reason='invoice_over_extracted'";
  s.getCell(r, 2).value = A.excluded_rows.invoice_over_extracted.count;
  s.getCell(r, 3).value = A.excluded_rows.invoice_over_extracted.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  s.getCell(r, 1).value = "WEIGHT SET additionally excluded: review_reason='ep_qty_up_mismatch'";
  s.getCell(r, 2).value = A.excluded_rows.ep_qty_up_mismatch.count;
  s.getCell(r, 3).value = A.excluded_rows.ep_qty_up_mismatch.spend;
  s.getCell(r, 3).numFmt = "$#,##0.00";
  r++;
  s.getCell(r, 1).value = "Classified (distinct vendor,description pairs; DOLLAR SET)";
  s.getCell(r, 2).value = `${A.classified_items} / ${A.distinct_pairs_to_classify} (${A.classification_coverage_pct}%)`;
  r++;

  r++;
  s.getCell(r, 1).value = "Headline: account comparison (window totals, DOLLAR SET)";
  s.getRow(r).font = { bold: true };
  r++;
  const headerRow = s.getRow(r);
  headerRow.values = ["Metric", ...ACCOUNTS];
  styleHeaderRow(headerRow);
  r++;
  const metrics = [
    ["DOLLAR SET total spend (all)", (acct) => A.spend[acct].dollar_total_spend, "currency"],
    ["DOLLAR SET food spend", (acct) => A.spend[acct].dollar_food_spend, "currency"],
    ["DOLLAR SET non-food spend", (acct) => A.spend[acct].dollar_nonfood_spend, "currency"],
    ["Non-food share of spend", (acct) => A.spend[acct].dollar_nonfood_pct, "pct"],
    ["Food share of spend", (acct) => A.spend[acct].dollar_food_pct, "pct"],
    ["Meals used (actuals; sparse months = actuals)", (acct) => A.per_meal[acct].window_meals_used, "num"],
    ["Meals used (projections substituted for sparse months)", (acct) => A.per_meal[acct].window_meals_used_filled, "num"],
    ["Meals denominator source", (acct) => A.per_meal[acct].window_meals_source, "text"],
    ["Food $ per meal (actuals-only, sparse months distort)", (acct) => A.per_meal[acct].window_dollars_per_meal, "currency"],
    ["Food $ per meal (projections filled for sparse)", (acct) => A.per_meal[acct].window_dollars_per_meal_filled, "currency"],
    ["Food lbs (WEIGHT SET)", (acct) => A.weight[acct].food_lbs, "num"],
    ["Weight coverage % of food $", (acct) => A.weight[acct].coverage_food_spend_pct, "pct"],
    ["Food lbs per meal (actuals-only)", (acct) => A.per_meal[acct].window_lbs_per_meal, "num2"],
    ["Food lbs per meal (projections filled)", (acct) => A.per_meal[acct].window_lbs_per_meal_filled, "num2"],
    ["$ per lb (overall food)", (acct) => A.weight[acct].dollars_per_lb_overall, "currency"],
  ];
  for (const [name, fn, kind] of metrics) {
    const row = s.getRow(r);
    row.getCell(1).value = name;
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const acct = ACCOUNTS[i];
      const v = fn(acct);
      const cell = row.getCell(2 + i);
      cell.value = v;
      if (kind === "currency" && typeof v === "number") cell.numFmt = "$#,##0.00";
      if (kind === "pct" && typeof v === "number") cell.numFmt = '0.0"%"';
      if (kind === "num" && typeof v === "number") cell.numFmt = "#,##0";
      if (kind === "num2" && typeof v === "number") cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: kind === "text" ? "left" : "right" };
      // Color meals-affected cells for window denominator status
      const isDenomSensitive = /Meals|per meal|denominator/i.test(name);
      if (isDenomSensitive) {
        const ws = A.per_meal[acct].window_meals_source;
        // For "filled" cells, mark yellow only if actual projection was used
        const isFilled = /filled/i.test(name);
        if (isFilled) {
          if (ws === "projected" || ws === "mixed" || ws === "actual_with_sparse") cell.fill = PROJECTED_FILL;
        } else {
          if (ws === "projected" || ws === "mixed") cell.fill = PROJECTED_FILL;
          else if (ws === "actual_with_sparse" || ws === "actual_sparse") cell.fill = SPARSE_FILL;
          else if (ws === "UNAVAILABLE" || ws === "partial_unavailable") cell.fill = UNAVAIL_FILL;
        }
      }
    }
    r++;
  }

  r += 2;
  s.getCell(r++, 1).value = "Legend: yellow = projections substituted or window contains a projected month; orange = actuals-with-sparse; red = UNAVAILABLE.";
  s.getCell(r++, 1).value = "";
  s.getCell(r++, 1).value = "What this workbook CAN answer:";
  s.getCell(r - 1, 1).font = { bold: true };
  s.getCell(r++, 1).value = "  - Directional food spend comparison across the three accounts for May-Jul 2026";
  s.getCell(r++, 1).value = "  - Food vs non-food composition by account";
  s.getCell(r++, 1).value = "  - Category composition by account";
  s.getCell(r++, 1).value = "  - Vendor concentration by account";
  s.getCell(r++, 1).value = "  - Premium vs commodity share (subject to classifier confidence and coverage caveats)";
  s.getCell(r++, 1).value = "  - Prefabricated vs scratch-input share (same caveats)";
  s.getCell(r++, 1).value = "  - $/meal normalization where actuals or projections are available";
  s.getCell(r++, 1).value = "  - $/lb by category where weight is resolvable (coverage varies 17-38% by account after the pack_size_ambiguous_multipack quarantine)";
  r++;
  s.getCell(r++, 1).value = "What it CANNOT answer:";
  s.getCell(r - 1, 1).font = { bold: true };
  s.getCell(r++, 1).value = "  - Annual spend (three-month window only; not extrapolated)";
  s.getCell(r++, 1).value = "  - Precise dollar totals on invoices flagged 'invoice_over_extracted' (excluded from DOLLAR SET)";
  s.getCell(r++, 1).value = "  - Pounds on volume-only lines (excluded from WEIGHT SET) or lines with unresolved packs (~54% row share)";
  s.getCell(r++, 1).value = "  - Confident classification on the <70-confidence tail (see Needs Review sheet)";
  s.getCell(r++, 1).value = "  - Reliable per-meal figures for STL-FL Jun 2026 (actuals gap; projections substituted) or TBJ/STL July (sparse actuals)";

  freezeHeaders(s, 6);
}

// ============================================================================
// Sheet 2: Methodology
// ============================================================================
{
  const s = wb.addWorksheet("Methodology");
  s.getColumn(1).width = 90;
  s.getColumn(2).width = 30;

  let r = 1;
  s.getCell(r++, 1).value = "Methodology";
  s.getCell(r - 1, 1).font = { bold: true, size: 14 };
  s.getCell(r++, 1).value = `Window: ${A.window_label}`;
  s.getCell(r++, 1).value = "Accounts: TBR-FL, TBJ-FL, STL-FL. Account keys stored as 'TBR - FL' (spaces) in ai_line_items.account_key.";
  r++;

  s.getCell(r++, 1).value = "TWO-TIER quality filter (rule 3)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  DOLLAR SET: exclude rows where review_reason='invoice_over_extracted' only. All other rows kept, including 'ep_qty_up_mismatch'.";
  s.getCell(r, 1).value = "    DOLLAR SET excluded rows";
  s.getCell(r, 2).value = A.excluded_rows.invoice_over_extracted.count;
  r++;
  s.getCell(r, 1).value = "    DOLLAR SET excluded spend";
  s.getCell(r, 2).value = A.excluded_rows.invoice_over_extracted.spend;
  s.getCell(r, 2).numFmt = "$#,##0.00";
  r++;
  s.getCell(r++, 1).value = "  WEIGHT SET: also excludes ep_qty_up_mismatch AND rows with parsed_weight_source in ('unresolved','volume_excluded','pack_size_ambiguous_multipack').";
  s.getCell(r++, 1).value = "  'pack_size_ambiguous_multipack' quarantines OCR-garbled pack strings like '410 LB' (really '4/10 LB' = 4 units of 10 lb = 40 lb, not 410 lb). Would inflate lbs ~10x if not filtered. ~522 rows quarantined this run.";
  s.getCell(r, 1).value = "    WEIGHT SET additional excluded rows (ep_qty_up_mismatch)";
  s.getCell(r, 2).value = A.excluded_rows.ep_qty_up_mismatch.count;
  r++;
  r++;

  s.getCell(r++, 1).value = "Orphan-corrected exclusion";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  All line rows whose parent invoice_submissions.status IN ('corrected','deleted') are excluded from all figures.";
  s.getCell(r, 1).value = "    Orphan-corrected rows excluded";
  s.getCell(r, 2).value = A.orphan_excluded_rows;
  r++;
  r++;

  s.getCell(r++, 1).value = "Date-drift normalization (rule 4)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  Applied at read time, not written back to source columns. Rewrites '0026-' -> '2026-', '0206-' -> '2026-', '23026-' -> '2026-', '72026-' -> '2026-'.";
  s.getCell(r, 1).value = "    Drift rows recovered into window";
  s.getCell(r, 2).value = A.drift_recovered_rows;
  r++;
  r++;

  s.getCell(r++, 1).value = "Weight resolution";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  Fallback chain (packSizeParser.resolveWeightForRow):";
  s.getCell(r++, 1).value = "    1. weight_line_value when present (vendor-printed catch-weight)";
  s.getCell(r++, 1).value = "    2. parsePackSize(pack_size) * qty";
  s.getCell(r++, 1).value = "    3. parsePackFromDescription(description) * qty";
  s.getCell(r++, 1).value = "    4. catalog_lookup by (vendor_id, item_number)";
  s.getCell(r++, 1).value = "    5. volume_excluded if UOM in (GAL, FOZ, L, ML, QT, PT)";
  s.getCell(r++, 1).value = "    6. unresolved";
  s.getCell(r++, 1).value = "  Quantity resolution: shipped_count > ordered_count > quantity (non-zero preferred).";
  r++;

  s.getCell(r++, 1).value = "Food classification";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  Signals: vendor (non-food vendor list), category (supplies/packaging/chemical/linen/uniform = non-food; produce/protein/dairy/etc = food), description (fee/service patterns force non-food), gl_breakdown on parent invoice.";
  s.getCell(r++, 1).value = "  Precedence when signals disagree: description > vendor > category > gl.";
  s.getCell(r++, 1).value = "  Unknown remains unknown (not force-classified).";
  r++;

  s.getCell(r++, 1).value = "Classification (three axes, LLM-driven, batch of 25)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  Model: claude-sonnet-4-6 (matches production intranet OCR extractor).";
  s.getCell(r++, 1).value = "  Axes: quality (premium/commodity/neutral), preparation (prefabricated/scratch-input/neutral), storage (frozen/fresh/shelf-stable/unknown).";
  s.getCell(r++, 1).value = "  Confidence: 0-100 per axis. Under 70 excluded from headline percentages, listed on Needs Review sheet.";
  s.getCell(r++, 1).value = "  Idempotency: input batches hashed; a batch already processed is skipped.";
  s.getCell(r, 1).value = "    Classification coverage (pairs classified / pairs in DOLLAR SET)";
  s.getCell(r, 2).value = `${A.classified_items} / ${A.distinct_pairs_to_classify} (${A.classification_coverage_pct}%)`;
  r++;
  r++;

  s.getCell(r++, 1).value = "Meals denominator (sc_daily_actuals; sc_daily_projections as labeled substitute)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  STL-FL Jun 2026: actuals have 0 rows -> substitute projections (labeled 'projected' in-cell, yellow fill).";
  s.getCell(r++, 1).value = "  TBJ-FL and STL-FL July 2026: actuals rows are sparse (12 and 5 rows). Labeled 'actual_sparse' in-cell (orange fill). NOT substituted per prompt (actuals present, just partial).";
  s.getCell(r++, 1).value = "  UNAVAILABLE cells: neither actuals nor projections exist. Never extrapolated.";
  r++;

  s.getCell(r++, 1).value = "Reconciliation (Reconciliation sheet)";
  s.getRow(r - 1).font = { bold: true };
  s.getCell(r++, 1).value = "  DOLLAR SET line-item sum vs invoice_submissions.total_amount (live headers only) vs GL food/COGS extracted from gl_breakdown.";
  s.getCell(r++, 1).value = "  Header set filter: status NOT IN ('corrected','deleted').";

  freezeHeaders(s, 1);
}

// ============================================================================
// Sheet 3: Account Comparison
// ============================================================================
{
  const s = wb.addWorksheet("Account Comparison");
  setColWidths(s, [40, 20, 20, 20, 20]);
  let r = 1;
  s.getCell(r, 1).value = "Account comparison (window totals unless noted). DOLLAR SET.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = ["Metric", ...ACCOUNTS, "Row set"];
  styleHeaderRow(header);
  r++;
  const rows = [
    ["Total spend (all lines)", (a) => A.spend[a].dollar_total_spend, "currency", "DOLLAR SET"],
    ["Food spend", (a) => A.spend[a].dollar_food_spend, "currency", "DOLLAR SET"],
    ["Non-food spend", (a) => A.spend[a].dollar_nonfood_spend, "currency", "DOLLAR SET"],
    ["Unknown-food spend", (a) => A.spend[a].dollar_unknown_spend, "currency", "DOLLAR SET"],
    ["Food % of spend", (a) => A.spend[a].dollar_food_pct, "pct", "DOLLAR SET"],
    ["Non-food % of spend", (a) => A.spend[a].dollar_nonfood_pct, "pct", "DOLLAR SET"],
    ["Line rows (DOLLAR SET)", (a) => A.spend[a].dollar_all_rows, "num", "DOLLAR SET"],
    ["Line rows food (DOLLAR SET)", (a) => A.spend[a].dollar_food_rows, "num", "DOLLAR SET"],
    ["Meals actuals (may include sparse-month actuals)", (a) => A.per_meal[a].window_meals_used, "num", "-"],
    ["Meals filled (projections substituted for sparse)", (a) => A.per_meal[a].window_meals_used_filled, "num", "-"],
    ["Meals source", (a) => A.per_meal[a].window_meals_source, "text", "-"],
    ["Food $ per meal (actuals)", (a) => A.per_meal[a].window_dollars_per_meal, "currency", "DOLLAR SET"],
    ["Food $ per meal (filled)", (a) => A.per_meal[a].window_dollars_per_meal_filled, "currency", "DOLLAR SET"],
    ["Food lbs", (a) => A.weight[a].food_lbs, "num2", "WEIGHT SET"],
    ["Weight coverage (% food $)", (a) => A.weight[a].coverage_food_spend_pct, "pct", "WEIGHT SET"],
    ["Weight coverage (% food rows)", (a) => A.weight[a].coverage_food_rows_pct, "pct", "WEIGHT SET"],
    ["Food lbs per meal (actuals)", (a) => A.per_meal[a].window_lbs_per_meal, "num2", "WEIGHT SET"],
    ["Food lbs per meal (filled)", (a) => A.per_meal[a].window_lbs_per_meal_filled, "num2", "WEIGHT SET"],
    ["Overall $/lb (food)", (a) => A.weight[a].dollars_per_lb_overall, "currency", "WEIGHT SET"],
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
      cell.alignment = { horizontal: kind === "text" ? "left" : "right" };
    }
    row.getCell(5).value = rowset;
    r++;
  }

  // Per-month breakdown
  r += 2;
  const monHdr = s.getRow(r);
  monHdr.values = ["Metric x Month", ...ACCOUNTS, "Row set"];
  styleHeaderRow(monHdr);
  r++;
  for (const m of MONTHS) {
    for (const which of ["food_spend", "meals_used", "meals_source", "dollars_per_meal"]) {
      const row = s.getRow(r);
      row.getCell(1).value = `${m} ${which}`;
      for (let i = 0; i < ACCOUNTS.length; i++) {
        const a = ACCOUNTS[i];
        const mm = A.per_meal[a].monthly[m];
        const spendMonth = A.spend[a].by_month[m];
        let v;
        if (which === "food_spend") v = spendMonth.food_spend;
        else if (which === "meals_used") v = mm.used;
        else if (which === "meals_source") v = mm.source;
        else if (which === "dollars_per_meal") v = mm.dollars_per_meal;
        const cell = row.getCell(2 + i);
        cell.value = v;
        if (which === "food_spend" || which === "dollars_per_meal") {
          if (typeof v === "number") cell.numFmt = "$#,##0.00";
        }
        if (which === "meals_used" && typeof v === "number") cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
        // Color-code cells whose value depends on a substituted/sparse denominator
        if (which === "meals_used" || which === "dollars_per_meal" || which === "meals_source") {
          if (mm.source === "projected") cell.fill = PROJECTED_FILL;
          else if (mm.source === "actual_sparse") cell.fill = SPARSE_FILL;
          else if (mm.source === "UNAVAILABLE") cell.fill = UNAVAIL_FILL;
        }
      }
      row.getCell(5).value = "DOLLAR SET";
      r++;
    }
  }
  // Legend
  r++;
  s.getCell(r++, 1).value = "Legend: yellow = projections substituted (STL-FL Jun 2026); orange = actuals present but sparse; red = UNAVAILABLE.";
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 4: Category Totals
// ============================================================================
{
  const s = wb.addWorksheet("Category Totals");
  setColWidths(s, [24, 20, 14, 14, 20, 14]);
  let r = 1;
  s.getCell(r, 1).value = "Category totals by account (DOLLAR SET, food-only rows unless labeled)";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Category", "Spend (food)", "Rows (food)", "% of food $", "Spend (all)", "% of total $"];
    styleHeaderRow(header);
    r++;
    const catsFood = A.spend[acct].by_category_food;
    const catsAll = A.spend[acct].by_category_all;
    const catsAllMap = new Map(catsAll.map((c) => [c.category, c]));
    for (const c of catsFood) {
      const row = s.getRow(r);
      row.getCell(1).value = c.category;
      row.getCell(2).value = c.spend;
      row.getCell(2).numFmt = "$#,##0.00";
      row.getCell(3).value = c.rows;
      row.getCell(3).numFmt = "#,##0";
      row.getCell(4).value = c.pct_of_scope;
      row.getCell(4).numFmt = '0.0"%"';
      const allC = catsAllMap.get(c.category);
      if (allC) {
        row.getCell(5).value = allC.spend;
        row.getCell(5).numFmt = "$#,##0.00";
        row.getCell(6).value = allC.pct_of_scope;
        row.getCell(6).numFmt = '0.0"%"';
      }
      for (let ci = 2; ci <= 6; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 5-7: Premium vs Commodity / Prefab vs Scratch / Frozen vs Fresh
// ============================================================================
function classificationSheet(axisKey, sheetName, description) {
  const s = wb.addWorksheet(sheetName);
  setColWidths(s, [24, 16, 16, 20, 20]);
  let r = 1;
  s.getCell(r, 1).value = description;
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "DOLLAR SET, food-only rows. Under-70-confidence rows excluded from headline pct (shown as below-conf).";
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Label", "Rows", "Spend", "% of food $", "Notes"];
    styleHeaderRow(header);
    r++;
    const bucketData = A.classification[acct].axes[axisKey];
    for (const b of bucketData.buckets) {
      const row = s.getRow(r);
      row.getCell(1).value = b.label;
      row.getCell(2).value = b.rows;
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).value = b.spend;
      row.getCell(3).numFmt = "$#,##0.00";
      row.getCell(4).value = b.pct_of_food_spend;
      row.getCell(4).numFmt = '0.0"%"';
      row.getCell(5).value = "";
      for (let ci = 2; ci <= 4; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    // Below-confidence line
    const rowBc = s.getRow(r);
    rowBc.getCell(1).value = "(below-70-confidence)";
    rowBc.getCell(2).value = bucketData.below_confidence_rows;
    rowBc.getCell(2).numFmt = "#,##0";
    rowBc.getCell(3).value = bucketData.below_confidence_spend;
    rowBc.getCell(3).numFmt = "$#,##0.00";
    rowBc.getCell(4).value = bucketData.below_confidence_pct;
    rowBc.getCell(4).numFmt = '0.0"%"';
    rowBc.getCell(5).value = "excluded from headline";
    for (let ci = 2; ci <= 4; ci++) rowBc.getCell(ci).alignment = { horizontal: "right" };
    r++;
    // Missing-cls line
    if (bucketData.missing_cls_rows > 0) {
      const rowM = s.getRow(r);
      rowM.getCell(1).value = "(not yet classified)";
      rowM.getCell(2).value = bucketData.missing_cls_rows;
      rowM.getCell(2).numFmt = "#,##0";
      rowM.getCell(3).value = bucketData.missing_cls_spend;
      rowM.getCell(3).numFmt = "$#,##0.00";
      rowM.getCell(4).value = bucketData.missing_cls_pct;
      rowM.getCell(4).numFmt = '0.0"%"';
      rowM.getCell(5).value = "not classified";
      for (let ci = 2; ci <= 4; ci++) rowM.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    // Total
    const rowT = s.getRow(r);
    rowT.getCell(1).value = "TOTAL food spend";
    rowT.getCell(1).font = { bold: true };
    rowT.getCell(3).value = A.classification[acct].food_spend;
    rowT.getCell(3).numFmt = "$#,##0.00";
    rowT.getCell(3).font = { bold: true };
    rowT.getCell(2).value = A.classification[acct].food_rows;
    rowT.getCell(2).numFmt = "#,##0";
    r += 2;
  }

  // Inter-axis sanity table for the top of quality/prep sheets
  if (axisKey === "quality" || axisKey === "preparation") {
    r++;
    s.getCell(r, 1).value = "Inter-axis sanity: rows flagged both 'premium' AND 'prefabricated' (>=70 confidence on both)";
    s.getCell(r, 1).font = { bold: true };
    r++;
    const hdr = s.getRow(r);
    hdr.values = ["Account", "Rows", "Spend", "", ""];
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
classificationSheet("quality", "Premium vs Commodity", "Quality axis: premium / commodity / neutral");
classificationSheet("preparation", "Prefabricated vs Scratch", "Preparation axis: prefabricated / scratch-input / neutral");
classificationSheet("storage", "Frozen vs Fresh", "Storage axis: frozen / fresh / shelf-stable / unknown");

// ============================================================================
// Sheet 8: Weight & Coverage
// ============================================================================
{
  const s = wb.addWorksheet("Weight & Coverage");
  setColWidths(s, [22, 12, 12, 16, 16, 12, 12, 12, 12]);
  let r = 1;
  s.getCell(r, 1).value = "Weight (WEIGHT SET, food-only) with coverage rate on same line (rule 6)";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [acct, "", "", "", "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = [
      "Category",
      "Food $ (DOLLAR SET)",
      "Food $ (WEIGHT SET)",
      "Coverage % food $",
      "Coverage % food rows",
      "Rows (dollar)",
      "Rows (weight)",
      "Weight (lbs)",
      "$ per lb",
    ];
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
    // Account subtotal line
    const t = s.getRow(r);
    t.getCell(1).value = "TOTAL";
    t.getCell(1).font = { bold: true };
    t.getCell(2).value = A.weight[acct].food_spend_dollar_set;
    t.getCell(2).numFmt = "$#,##0.00";
    t.getCell(3).value = A.weight[acct].food_spend_weight_set;
    t.getCell(3).numFmt = "$#,##0.00";
    t.getCell(4).value = A.weight[acct].coverage_food_spend_pct;
    t.getCell(4).numFmt = '0.0"%"';
    t.getCell(5).value = A.weight[acct].coverage_food_rows_pct;
    t.getCell(5).numFmt = '0.0"%"';
    t.getCell(8).value = A.weight[acct].food_lbs;
    t.getCell(8).numFmt = "#,##0.0";
    t.getCell(9).value = A.weight[acct].dollars_per_lb_overall;
    if (A.weight[acct].dollars_per_lb_overall != null) t.getCell(9).numFmt = "$#,##0.00";
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 9: Top Items (per account, by spend AND by frequency)
// ============================================================================
{
  const s = wb.addWorksheet("Top Items");
  setColWidths(s, [40, 22, 16, 12, 16, 12]);
  let r = 1;
  s.getCell(r, 1).value = "Top items per account (DOLLAR SET, food-only). Two tables per account.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;

  for (const acct of ACCOUNTS) {
    const sub = s.getRow(r);
    sub.values = [`${acct} - Top by SPEND`, "", "", "", "", ""];
    sub.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header = s.getRow(r);
    header.values = ["Description", "Vendor", "Category", "Orders", "Spend", "Qty (units)"];
    styleHeaderRow(header);
    r++;
    for (const it of A.spend[acct].top_items_by_spend) {
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
      for (let ci = 4; ci <= 6; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    r++;

    const sub2 = s.getRow(r);
    sub2.values = [`${acct} - Top by FREQUENCY (order count)`, "", "", "", "", ""];
    sub2.eachCell((c) => (c.fill = SUBHEADER_FILL));
    sub2.eachCell((c) => (c.font = SUBHEADER_FONT));
    r++;
    const header2 = s.getRow(r);
    header2.values = ["Description", "Vendor", "Category", "Orders", "Spend", "Qty (units)"];
    styleHeaderRow(header2);
    r++;
    for (const it of A.spend[acct].top_items_by_frequency) {
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
      for (let ci = 4; ci <= 6; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 10: Shared Basket
// ============================================================================
{
  const s = wb.addWorksheet("Shared Basket");
  setColWidths(s, [40, 14, 14, 14, 14, 14, 14, 14, 14, 14]);
  let r = 1;
  s.getCell(r, 1).value = "Items with the same normalized description present in all three accounts (DOLLAR SET, food-only).";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  const cols = ["Description"];
  for (const a of ACCOUNTS) cols.push(`${a} spend`, `${a} orders`, `${a} mean $/unit`);
  header.values = cols;
  styleHeaderRow(header);
  r++;

  for (const item of A.shared_basket) {
    const row = s.getRow(r);
    row.getCell(1).value = item.description;
    let col = 2;
    for (const a of ACCOUNTS) {
      const p = item.per_account[a];
      row.getCell(col).value = p.spend;
      row.getCell(col).numFmt = "$#,##0.00";
      col++;
      row.getCell(col).value = p.rows;
      row.getCell(col).numFmt = "#,##0";
      col++;
      row.getCell(col).value = p.mean_unit_price;
      row.getCell(col).numFmt = "$#,##0.00";
      col++;
    }
    for (let ci = 2; ci <= 10; ci++) row.getCell(ci).alignment = { horizontal: "right" };
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 11: Item Master
// ============================================================================
{
  const s = wb.addWorksheet("Item Master");
  setColWidths(s, [40, 20, 16, 22, 10, 14, 14, 10, 14, 14, 10, 14, 14, 10]);
  let r = 1;
  s.getCell(r, 1).value = "Every distinct (vendor, description) pair in DOLLAR SET with three-axis classification.";
  s.getCell(r, 1).font = { bold: true };
  r += 2;
  const header = s.getRow(r);
  header.values = [
    "Description",
    "Vendor",
    "Category",
    "Accounts",
    "Orders",
    "Spend",
    "Quality",
    "Q conf",
    "Q reason",
    "Preparation",
    "P conf",
    "P reason",
    "Storage",
    "S conf",
    "S reason",
  ];
  header.values = [
    "Description",
    "Vendor",
    "Category",
    "Accounts",
    "Orders",
    "Spend",
    "Quality",
    "Q conf",
    "Quality reason",
    "Preparation",
    "P conf",
    "Preparation reason",
    "Storage",
    "S conf",
    "Storage reason",
  ];
  styleHeaderRow(header);
  r++;
  setColWidths(s, [40, 20, 14, 22, 8, 14, 14, 8, 34, 14, 8, 34, 14, 8, 34]);
  for (const it of A.item_master) {
    const row = s.getRow(r);
    row.getCell(1).value = it.description;
    row.getCell(2).value = it.vendor_name;
    row.getCell(3).value = it.category;
    row.getCell(4).value = it.accounts;
    row.getCell(5).value = it.order_count;
    row.getCell(5).numFmt = "#,##0";
    row.getCell(6).value = it.total_spend;
    row.getCell(6).numFmt = "$#,##0.00";
    row.getCell(7).value = it.quality_axis || "";
    row.getCell(8).value = it.quality_confidence ?? "";
    row.getCell(8).numFmt = "0";
    row.getCell(9).value = it.quality_reason;
    row.getCell(10).value = it.preparation_axis || "";
    row.getCell(11).value = it.preparation_confidence ?? "";
    row.getCell(11).numFmt = "0";
    row.getCell(12).value = it.preparation_reason;
    row.getCell(13).value = it.storage_axis || "";
    row.getCell(14).value = it.storage_confidence ?? "";
    row.getCell(14).numFmt = "0";
    row.getCell(15).value = it.storage_reason;
    for (const ci of [5, 6, 8, 11, 14]) row.getCell(ci).alignment = { horizontal: "right" };
    r++;
  }
  freezeHeaders(s, 3);
}

// ============================================================================
// Sheet 12: Needs Review
// ============================================================================
{
  const s = wb.addWorksheet("Needs Review");
  setColWidths(s, [40, 20, 14, 22, 8, 14, 22, 22]);
  let r = 1;
  s.getCell(r, 1).value = "Items excluded from headline percentages: below-confidence-70 or not yet classified.";
  s.getCell(r, 1).font = { bold: true };
  r++;
  s.getCell(r, 1).value = "Also lists the row exclusions: invoice_over_extracted (DOLLAR SET excluded) and ep_qty_up_mismatch (WEIGHT SET excluded).";
  r += 2;

  s.getCell(r, 1).value = "Row-set exclusions (row counts, not distinct items)";
  s.getRow(r).font = { bold: true };
  r++;
  const rExcl = s.getRow(r);
  rExcl.values = ["Reason", "Rows", "Spend", "Where excluded", "", "", "", ""];
  styleHeaderRow(rExcl);
  r++;
  const excl = [
    ["invoice_over_extracted", A.excluded_rows.invoice_over_extracted.count, A.excluded_rows.invoice_over_extracted.spend, "DOLLAR SET and WEIGHT SET"],
    ["ep_qty_up_mismatch", A.excluded_rows.ep_qty_up_mismatch.count, A.excluded_rows.ep_qty_up_mismatch.spend, "WEIGHT SET only"],
    ["pack_size_ambiguous_multipack", A.excluded_rows.pack_size_ambiguous_multipack.count, A.excluded_rows.pack_size_ambiguous_multipack.spend, "WEIGHT SET only (OCR dropped inner slash, e.g. '410 LB' should be '4/10 LB')"],
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
    for (const ci of [5, 6]) row.getCell(ci).alignment = { horizontal: "right" };
    r++;
  }
  freezeHeaders(s, 6);
}

// ============================================================================
// Sheet 13: Reconciliation
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
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).value = rr.line_row_count;
      row.getCell(3).numFmt = "#,##0";
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
      for (let ci = 2; ci <= 8; ci++) row.getCell(ci).alignment = { horizontal: "right" };
      r++;
    }
    // Window subtotal
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
    for (let ci = 4; ci <= 8; ci++) {
      t.getCell(ci).font = { bold: true };
      t.getCell(ci).alignment = { horizontal: "right" };
    }
    r += 2;
  }
  freezeHeaders(s, 3);
}

// Save
await wb.xlsx.writeFile(OUT);
console.log("[wb] wrote", OUT);
