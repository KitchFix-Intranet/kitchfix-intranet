// ExcelJS port of gen_pnl.py (the approved reference generator for
// the KPI P&L Overview export). Layout logic is isomorphic to the
// Python reference; the number format, fills, spacer widths, freeze
// at B5 and grid-off are all preserved verbatim. Call shape:
//
//   buildPnlWorkbook({
//     data: Map<"<account_key>|<line_code>", { b: { 1..N: number }, a: { 1..N: number } }>,
//     accounts: Array<{ account_key, pnl_tab_name, name, city, state, region }>,
//     chart: Array<{ line_code, line_name, section, group_code, sort_order }>,
//     periodCount: number,  // today = 9 (P1..P9 closed+verified)
//     periodLabel: string,  // e.g. "P1-P9" - appears in subtitle + YTD header
//     fiscalYear: number,
//     variant: "corporate" | "site_leader",
//     siteLeaderTab?: string,  // required when variant === "site_leader"
//   })  ->  Promise<Uint8Array>

import ExcelJS from "exceljs";

const GROUP_NAME = {
  "2400": "Meal Service",
  "3100": "Kitchen Labor Costs",
  "3200": "Food Costs",
  "3400": "Packaging & Supplies Costs",
  "3500": "Vehicle Costs",
  "5002": "Repair & Maintenance",
  "5004": "Wages",
  "5006": "Travel",
  "5011": "Insurance",
  "5012": "Utilities",
  "5013": "Lease Expenses",
  "5016": "Professional Fees",
  "5017": "Team Development",
};
const SECTION_NAME = { revenue: "Revenue", cogs: "Cost of Goods Sold", sga: "SG&A Expenses" };
const SECTION_ORDER = ["revenue", "cogs", "sga"];

// Rollup (corporate) tab order - matches gen_pnl.py TAB_ORDER.
const ROLLUP_TAB_ORDER = [
  "CIN-AZ", "CIN-KY", "CIN-OH", "STL-FL", "STL-MO",
  "TBJ-BUF", "TBJ-FL", "TBR-FL", "TXR-AZ", "TXR-HOME", "TXR-VISTOR",
];

const MONEY_FMT = '$#,##0;($#,##0);-';
const ARIAL = "Arial";
const HDR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
const SUB_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } };
const THIN_NAVY = { style: "thin", color: { argb: "FF1F3A5F" } };
const MEDIUM_NAVY = { style: "medium", color: { argb: "FF1F3A5F" } };

// Round-to-two helper. Rollup rows sum per-period b/a values; IEEE 754
// addition drifts on repeated adds, so the raw sum shows up in cells
// formatted "$#,##0;..." as noise (459899.93000000005). The attached
// sample stores whole-penny values; r2 gives us the same shape.
// Per-account leaf rows write raw b/a values verbatim and never drift.
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

// Excel column letter helper (1 -> A, 27 -> AA).
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ──────────────────────────────────────────────────────────────────
// Column-layout model - one Layout per sheet, identical to the
// Python Layout class. A = label; per-period [Budget, Actual, (Delta
// if show_delta), spacer]; trailing [YTD Budget, Actual, (Delta)].
// ──────────────────────────────────────────────────────────────────
function makeLayout(periodCount, showDelta) {
  const PBUD = [], PACT = [], PDEL = [], SPACER = [];
  let col = 2;
  for (let p = 0; p < periodCount; p += 1) {
    PBUD.push(col);
    PACT.push(col + 1);
    if (showDelta) { PDEL.push(col + 2); SPACER.push(col + 3); col += 4; }
    else           { PDEL.push(null);    SPACER.push(col + 2); col += 3; }
  }
  const YTD_B = col;
  const YTD_A = col + 1;
  const YTD_D = showDelta ? col + 2 : null;
  const LAST = showDelta ? YTD_D : YTD_A;
  const DATA_COLS = [];
  for (let p = 0; p < periodCount; p += 1) {
    DATA_COLS.push(PBUD[p], PACT[p]);
    if (showDelta) DATA_COLS.push(PDEL[p]);
  }
  DATA_COLS.push(YTD_B, YTD_A);
  if (showDelta) DATA_COLS.push(YTD_D);
  return { showDelta, periodCount, PBUD, PACT, PDEL, SPACER, YTD_B, YTD_A, YTD_D, LAST, DATA_COLS };
}

function lookupVal(data, acct, code, letter, p) {
  const r = data.get(`${acct}|${code}`);
  if (!r) return 0;
  return Number(r[letter]?.[p] || 0);
}

function acctHasData(data, acct, code, periodCount) {
  const r = data.get(`${acct}|${code}`);
  if (!r) return false;
  for (let p = 1; p <= periodCount; p += 1) {
    if ((Number(r.b?.[p] || 0) !== 0) || (Number(r.a?.[p] || 0) !== 0)) return true;
  }
  return false;
}

// Header fills + the merged "Pn" labels over Budget/Actual/(Δ).
function styleHeader(ws, L, periodLabel) {
  const span = L.showDelta ? 3 : 2;
  for (let cc = 1; cc <= L.LAST; cc += 1) {
    ws.getCell(3, cc).fill = HDR_FILL;
    ws.getCell(4, cc).fill = HDR_FILL;
  }
  for (let p = 1; p <= L.periodCount; p += 1) {
    const b = L.PBUD[p - 1];
    const a = L.PACT[p - 1];
    const head = ws.getCell(3, b);
    head.value = `P${p}`;
    head.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    head.alignment = { horizontal: "center" };
    ws.mergeCells(3, b, 3, b + span - 1);
    const subs = [[b, "Budget"], [a, "Actual"]];
    if (L.showDelta) subs.push([L.PDEL[p - 1], "Δ"]);
    for (const [cc, label] of subs) {
      const c = ws.getCell(4, cc);
      c.value = label;
      c.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      c.alignment = { horizontal: "center" };
    }
  }
  const ytd = ws.getCell(3, L.YTD_B);
  ytd.value = `YTD (${periodLabel})`;
  ytd.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  ytd.alignment = { horizontal: "center" };
  ws.mergeCells(3, L.YTD_B, 3, L.YTD_B + span - 1);
  const ytdSubs = [[L.YTD_B, "Budget"], [L.YTD_A, "Actual"]];
  if (L.showDelta) ytdSubs.push([L.YTD_D, "Δ"]);
  for (const [cc, label] of ytdSubs) {
    const c = ws.getCell(4, cc);
    c.value = label;
    c.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    c.alignment = { horizontal: "center" };
  }
}

function fillDelta(ws, rownum, L) {
  if (!L.showDelta) return;
  for (let p = 0; p < L.periodCount; p += 1) {
    const d = L.PDEL[p];
    const ab = colLetter(L.PACT[p]);
    const bb = colLetter(L.PBUD[p]);
    ws.getCell(rownum, d).value = { formula: `${ab}${rownum}-${bb}${rownum}` };
  }
  const ya = colLetter(L.YTD_A);
  const yb = colLetter(L.YTD_B);
  ws.getCell(rownum, L.YTD_D).value = { formula: `${ya}${rownum}-${yb}${rownum}` };
}

function fmtRow(ws, rownum, L, { bold, fill, topBorder }) {
  const labelCell = ws.getCell(rownum, 1);
  labelCell.font = { name: ARIAL, bold, size: 10 };
  for (const col of L.DATA_COLS) {
    const c = ws.getCell(rownum, col);
    c.numFmt = MONEY_FMT;
    c.font = { name: ARIAL, bold, size: 10 };
    c.alignment = { horizontal: "right" };
    if (fill) c.fill = fill;
    if (topBorder) c.border = { top: THIN_NAVY };
  }
  if (fill) labelCell.fill = fill;
  if (topBorder) labelCell.border = { top: THIN_NAVY };
}

function writeValueRow(ws, rownum, label, data, acct, code, L, { indent = 1, bold = false, fill = null, topBorder = false } = {}) {
  ws.getCell(rownum, 1).value = "    ".repeat(indent) + label;
  for (let p = 1; p <= L.periodCount; p += 1) {
    ws.getCell(rownum, L.PBUD[p - 1]).value = lookupVal(data, acct, code, "b", p);
    ws.getCell(rownum, L.PACT[p - 1]).value = lookupVal(data, acct, code, "a", p);
  }
  const bFormula = Array.from({ length: L.periodCount }, (_, i) => `${colLetter(L.PBUD[i])}${rownum}`).join("+");
  const aFormula = Array.from({ length: L.periodCount }, (_, i) => `${colLetter(L.PACT[i])}${rownum}`).join("+");
  ws.getCell(rownum, L.YTD_B).value = { formula: bFormula };
  ws.getCell(rownum, L.YTD_A).value = { formula: aFormula };
  fillDelta(ws, rownum, L);
  fmtRow(ws, rownum, L, { bold, fill, topBorder });
}

function writeSumRow(ws, rownum, label, childRows, L, { indent = 1, bold = true, fill = null, topBorder = true } = {}) {
  ws.getCell(rownum, 1).value = "    ".repeat(indent) + label;
  const sumCols = [L.YTD_B, L.YTD_A];
  for (let p = 0; p < L.periodCount; p += 1) sumCols.push(L.PBUD[p], L.PACT[p]);
  for (const col of sumCols) {
    const Lc = colLetter(col);
    const formula = childRows.length === 0
      ? null
      : childRows.map((cr) => `${Lc}${cr}`).join("+");
    if (formula) ws.getCell(rownum, col).value = { formula };
    else ws.getCell(rownum, col).value = 0;
  }
  fillDelta(ws, rownum, L);
  fmtRow(ws, rownum, L, { bold, fill, topBorder });
}

function writeFormulaRow(ws, rownum, label, rowsA, rowsB, L, { indent = 0, bold = true, fill = null, topBorder = true } = {}) {
  ws.getCell(rownum, 1).value = "    ".repeat(indent) + label;
  const cols = [L.YTD_B, L.YTD_A];
  for (let p = 0; p < L.periodCount; p += 1) cols.push(L.PBUD[p], L.PACT[p]);
  for (const col of cols) {
    const Lc = colLetter(col);
    const a = rowsA.map((r) => `${Lc}${r}`).join("+") || "0";
    const b = rowsB.map((r) => `${Lc}${r}`).join("+") || "0";
    ws.getCell(rownum, col).value = { formula: `(${a})-(${b})` };
  }
  fillDelta(ws, rownum, L);
  fmtRow(ws, rownum, L, { bold, fill, topBorder });
}

// ──────────────────────────────────────────────────────────────────
// Per-account sheet. Mirror of build_account_sheet() in gen_pnl.py.
// ──────────────────────────────────────────────────────────────────
function buildAccountSheet(wb, { data, chart, periodCount, periodLabel, acct, tab, name, city, state, showDelta }) {
  const L = makeLayout(periodCount, showDelta);
  const ws = wb.addWorksheet(tab);
  const title = `${tab}/${name} - ${city}, ${state}`;
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: ARIAL, bold: true, size: 13, color: { argb: "FF1F3A5F" } };
  ws.getCell(2, 1).value = `2026 - P&L Budget vs Actual  ·  Closed + Verified periods ${periodLabel}`;
  ws.getCell(2, 1).font = { name: ARIAL, italic: true, size: 10, color: { argb: "FF5A6472" } };
  styleHeader(ws, L, periodLabel);

  // Summary block at the top, placeholder rows 6-10.
  let r = 6;
  const sumRows = {};
  for (const key of ["rev", "cogs", "gm", "sga", "cm"]) { sumRows[key] = r; r += 1; }
  r += 1; // blank spacer

  const sectionTotal = {};
  for (const section of SECTION_ORDER) {
    let lines = chart.filter((c) => c.section === section && acctHasData(data, acct, c.line_code, periodCount));
    if (lines.length === 0) continue;
    // Section header strip.
    ws.getCell(r, 1).value = SECTION_NAME[section];
    ws.getCell(r, 1).font = { name: ARIAL, bold: true, size: 11, color: { argb: "FF1F3A5F" } };
    for (let cc = 1; cc <= L.LAST; cc += 1) ws.getCell(r, cc).fill = SUB_FILL;
    r += 1;
    const groupTotals = [];
    while (lines.length > 0) {
      const { line_code, group_code } = lines[0];
      if (group_code && GROUP_NAME[group_code]) {
        const members = lines.filter((l) => l.group_code === group_code);
        ws.getCell(r, 1).value = `${group_code} ${GROUP_NAME[group_code]}`;
        ws.getCell(r, 1).font = { name: ARIAL, size: 10 };
        r += 1;
        const leafs = [];
        for (const m of members) {
          writeValueRow(ws, r, `${m.line_code} ${m.line_name}`, data, acct, m.line_code, L, { indent: 2 });
          leafs.push(r);
          r += 1;
        }
        writeSumRow(ws, r, `Total ${group_code} ${GROUP_NAME[group_code]}`, leafs, L, { indent: 1 });
        groupTotals.push(r);
        r += 1;
        lines = lines.filter((l) => l.group_code !== group_code);
      } else {
        writeValueRow(ws, r, `${line_code} ${lines[0].line_name}`, data, acct, line_code, L, { indent: 1 });
        groupTotals.push(r);
        r += 1;
        lines.shift();
      }
    }
    writeSumRow(ws, r, `Total ${SECTION_NAME[section]}`, groupTotals, L, { indent: 0, fill: TOTAL_FILL });
    sectionTotal[section] = r;
    r += 2;
  }

  const rev = sectionTotal.revenue;
  const cogs = sectionTotal.cogs;
  const sga = sectionTotal.sga;
  const rr = (x) => (x ? [x] : []);

  ws.getCell(5, 1).value = "SUMMARY";
  ws.getCell(5, 1).font = { name: ARIAL, bold: true, size: 10, color: { argb: "FF5A6472" } };
  writeSumRow(ws, sumRows.rev, "Total Revenue", rr(rev), L, { indent: 0, fill: TOTAL_FILL });
  writeSumRow(ws, sumRows.cogs, "Total Cost of Goods Sold", rr(cogs), L, { indent: 0, fill: TOTAL_FILL });
  writeFormulaRow(ws, sumRows.gm, "Gross Margin", rr(rev), rr(cogs), L, { fill: TOTAL_FILL });
  writeSumRow(ws, sumRows.sga, "Total SG&A", rr(sga), L, { indent: 0, fill: TOTAL_FILL });
  writeFormulaRow(ws, sumRows.cm, "Contribution Margin", [sumRows.gm], rr(sga), L, { fill: TOTAL_FILL });

  ws.getColumn(1).width = 40;
  for (const col of L.DATA_COLS) ws.getColumn(col).width = 11;
  for (const col of L.SPACER) ws.getColumn(col).width = 2.5;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];
}

// ──────────────────────────────────────────────────────────────────
// Rollup (All / East / West) - one row per account, YTD only.
// Mirror of build_rollup() in gen_pnl.py.
// ──────────────────────────────────────────────────────────────────
function buildRollupSheet(wb, { data, chart, accounts, periodCount, periodLabel, tabname, title, showDelta }) {
  const ws = wb.addWorksheet(tabname);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: ARIAL, bold: true, size: 13, color: { argb: "FF1F3A5F" } };
  ws.getCell(2, 1).value = `2026 - P&L Roll-up  ·  YTD Budget vs Actual, ${periodLabel}`;
  ws.getCell(2, 1).font = { name: ARIAL, italic: true, size: 10, color: { argb: "FF5A6472" } };

  const metrics = ["Revenue", "COGS", "Gross Margin", "SG&A", "Contribution Margin"];
  const ncol = showDelta ? 3 : 2;
  const subs = showDelta ? ["Budget", "Actual", "Δ"] : ["Budget", "Actual"];

  ws.getCell(3, 1).fill = HDR_FILL;
  ws.getCell(4, 1).value = "Account";
  ws.getCell(4, 1).font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell(4, 1).fill = HDR_FILL;

  let col = 2;
  const mcol = {};
  for (const m of metrics) {
    const c = ws.getCell(3, col);
    c.value = m;
    c.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center" };
    ws.mergeCells(3, col, 3, col + ncol - 1);
    for (let k = 0; k < ncol; k += 1) {
      const sub = ws.getCell(4, col + k);
      sub.value = subs[k];
      sub.font = { name: ARIAL, bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      sub.alignment = { horizontal: "center" };
    }
    for (let cc = col; cc < col + ncol + 1; cc += 1) {
      ws.getCell(3, cc).fill = HDR_FILL;
      ws.getCell(4, cc).fill = HDR_FILL;
    }
    mcol[m] = col;
    col += ncol + 1; // budget, actual, (delta), spacer
  }
  const dataCols = metrics.flatMap((m) => Array.from({ length: ncol }, (_, k) => mcol[m] + k));
  const spacers = metrics.map((m) => mcol[m] + ncol);

  // YTD sums for a specified section by iterating the chart for codes
  // in that section and summing b/a across periods.
  const codesBy = {
    revenue: chart.filter((c) => c.section === "revenue").map((c) => c.line_code),
    cogs: chart.filter((c) => c.section === "cogs").map((c) => c.line_code),
    sga: chart.filter((c) => c.section === "sga").map((c) => c.line_code),
  };
  const ytd = (acct, codes, letter) => {
    let s = 0;
    for (const code of codes) {
      const row = data.get(`${acct}|${code}`);
      if (!row) continue;
      for (let p = 1; p <= periodCount; p += 1) s += Number(row[letter]?.[p] || 0);
    }
    return s;
  };

  let r = 5;
  const drows = [];
  for (const acct of accounts) {
    ws.getCell(r, 1).value = acct.pnl_tab_name;
    ws.getCell(r, 1).font = { name: ARIAL, size: 10 };
    const rb = ytd(acct.team_key, codesBy.revenue, "b");
    const ra = ytd(acct.team_key, codesBy.revenue, "a");
    const cb = ytd(acct.team_key, codesBy.cogs, "b");
    const ca = ytd(acct.team_key, codesBy.cogs, "a");
    const sb = ytd(acct.team_key, codesBy.sga, "b");
    const sa = ytd(acct.team_key, codesBy.sga, "a");
    const pairs = {
      "Revenue": [r2(rb), r2(ra)],
      "COGS": [r2(cb), r2(ca)],
      "Gross Margin": [r2(rb - cb), r2(ra - ca)],
      "SG&A": [r2(sb), r2(sa)],
      "Contribution Margin": [r2((rb - cb) - sb), r2((ra - ca) - sa)],
    };
    for (const m of metrics) {
      const [bv, av] = pairs[m];
      ws.getCell(r, mcol[m]).value = bv;
      ws.getCell(r, mcol[m] + 1).value = av;
      if (showDelta) {
        const aLc = colLetter(mcol[m] + 1);
        const bLc = colLetter(mcol[m]);
        ws.getCell(r, mcol[m] + 2).value = { formula: `${aLc}${r}-${bLc}${r}` };
      }
    }
    drows.push(r);
    r += 1;
  }
  // Total row.
  ws.getCell(r, 1).value = "Total";
  ws.getCell(r, 1).font = { name: ARIAL, bold: true, size: 10 };
  for (const m of metrics) {
    for (let k = 0; k < ncol; k += 1) {
      const c2 = mcol[m] + k;
      const Lc = colLetter(c2);
      if (showDelta && k === 2) {
        const aLc = colLetter(mcol[m] + 1);
        const bLc = colLetter(mcol[m]);
        ws.getCell(r, c2).value = { formula: `${aLc}${r}-${bLc}${r}` };
      } else {
        ws.getCell(r, c2).value = { formula: drows.map((d) => `${Lc}${d}`).join("+") };
      }
    }
  }
  // Total row styling (bold, medium top border, fill).
  for (const c2 of [1, ...dataCols]) {
    const cell = ws.getCell(r, c2);
    cell.font = { name: ARIAL, bold: true, size: 10 };
    cell.border = { top: MEDIUM_NAVY };
    cell.fill = TOTAL_FILL;
  }
  // Data cell formatting on account rows + total row.
  for (const rr2 of [...drows, r]) {
    for (const c2 of dataCols) {
      const cell = ws.getCell(rr2, c2);
      cell.numFmt = MONEY_FMT;
      cell.alignment = { horizontal: "right" };
      if (!cell.font || cell.font.name !== ARIAL) cell.font = { name: ARIAL, size: 10 };
    }
  }

  ws.getColumn(1).width = 14;
  for (const c2 of dataCols) ws.getColumn(c2).width = 13;
  for (const c2 of spacers) ws.getColumn(c2).width = 2.5;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];
}

// ──────────────────────────────────────────────────────────────────
// Public entry.
// ──────────────────────────────────────────────────────────────────
export async function buildPnlWorkbook({
  data,
  accounts,
  chart,
  periodCount,
  periodLabel,
  variant,
  siteLeaderTab,
}) {
  const chartSorted = [...chart].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const wb = new ExcelJS.Workbook();
  wb.creator = "kitchfix intranet - kpi/overview export";
  wb.created = new Date();

  if (variant === "site_leader") {
    const acct = accounts.find((a) => a.pnl_tab_name === siteLeaderTab);
    if (!acct) throw new Error(`site_leader tab not found: ${siteLeaderTab}`);
    buildAccountSheet(wb, {
      data, chart: chartSorted, periodCount, periodLabel,
      acct: acct.team_key, tab: acct.pnl_tab_name,
      name: acct.name, city: acct.city, state: acct.state,
      showDelta: false,
    });
  } else {
    // Corporate: All / East / West rollups, then every account tab.
    const byTab = new Map(accounts.map((a) => [a.pnl_tab_name, a]));
    buildRollupSheet(wb, { data, chart: chartSorted, accounts, periodCount, periodLabel, tabname: "All",  title: "Kitchfix - All Accounts", showDelta: true });
    buildRollupSheet(wb, { data, chart: chartSorted, accounts: accounts.filter((a) => a.region === "East"), periodCount, periodLabel, tabname: "East", title: "Kitchfix - East Region", showDelta: true });
    buildRollupSheet(wb, { data, chart: chartSorted, accounts: accounts.filter((a) => a.region === "West"), periodCount, periodLabel, tabname: "West", title: "Kitchfix - West Region", showDelta: true });
    for (const tab of ROLLUP_TAB_ORDER) {
      const acct = byTab.get(tab);
      if (!acct) continue;
      buildAccountSheet(wb, {
        data, chart: chartSorted, periodCount, periodLabel,
        acct: acct.team_key, tab: acct.pnl_tab_name,
        name: acct.name, city: acct.city, state: acct.state,
        showDelta: true,
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return buf;
}
