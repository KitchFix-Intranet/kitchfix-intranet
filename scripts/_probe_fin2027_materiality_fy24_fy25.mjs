// scripts/_probe_fin2027_materiality_fy24_fy25.mjs
//
// FIN-2027 W1 Stage 2 · materiality read of the FY2025
// contiguous-tail set (Shape D from _probe_fin2027_absence_shape.mjs)
// against the FY2024 workbook. For every (account, line_code) pair
// that has a contiguous tail in FY2025 AND exists in FY2024, print:
//   account, line_code, FY2024 year total, FY2025 year total,
//   FY2025 / FY2024 as percent, absolute drop.
// Sort by largest absolute drop.
//
// Year total = workbook YTD-P13 Actual (col 194). Per Kevin's ruling
// 2026-09-17, the workbook's reconciled year total is the truer
// side; loader's sum-of-periods is not used for this comparison.
//
// Kevin flag: fixed recurring costs (trash, utilities, rent, vehicle
// insurance) cannot legitimately have an operational window that
// ends mid-year. Every fixed-cost line with a large FY24->FY25 drop
// is a W4 year-over-year comparability risk.
//
// Read-only, no writes. Dollars printed to chat only - the probe
// itself carries zero dollar literals (all values read from live
// workbooks).
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_materiality_fy24_fy25.mjs \
//     --fy24 '<xlsx>' --fy25 '<xlsx>'

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { parseLineCode, readNumeric } from "./lib/pnl_load_core.mjs";

const args = { fy24: null, fy25: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--fy24") args.fy24 = process.argv[++i];
  else if (x === "--fy25") args.fy25 = process.argv[++i];
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
if (!args.fy24 || !args.fy25 || !existsSync(args.fy24) || !existsSync(args.fy25)) {
  console.error("usage: node --env-file=.env.local scripts/_probe_fin2027_materiality_fy24_fy25.mjs --fy24 '<xlsx>' --fy25 '<xlsx>'");
  process.exit(1);
}

// Row-1 -> account_key resolver (matches load_pnl_history.mjs).
function resolveAccount(t) {
  if (typeof t !== "string" || !t.trim()) return null;
  const s = t.trim();
  if (/\bVISTOR\b|\bVisitor\b/i.test(s) && /Texas Rangers.*Arlington.*TX/i.test(s)) return "TXR - TX - V";
  if (/Cincinnati Reds.*Goodyear.*AZ/i.test(s)) return "CIN - AZ";
  if (/Louisville Bats.*Louisville.*KY/i.test(s)) return "CIN - KY";
  if (/Cincinnati Reds.*Cincinnati.*OH/i.test(s)) return "CIN - OH";
  if (/St\.?\s*Louis Cardinals.*Jupiter.*FL/i.test(s)) return "STL - FL";
  if (/St\.?\s*Louis Cardinals.*St\.?\s*Louis.*MO/i.test(s)) return "STL - MO";
  if (/Toronto Blue Jays.*Dunedin.*FL/i.test(s)) return "TBJ - FL";
  if (/Toronto Blue Jays.*Buffalo.*NY/i.test(s)) return "TBJ - NY";
  if (/Tampa Bay Rays.*(Engelwood|Englewood|Port Charlotte).*FL/i.test(s)) return "TBR - FL";
  if (/Texas Rangers.*Surprise.*AZ/i.test(s)) return "TXR - AZ";
  if (/Texas Rangers.*Arlington.*TX/i.test(s)) return "TXR - TX - H";
  return null;
}
function row1Title(ws) {
  const v = ws.getRow(1).getCell(1).value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("").trim();
  return String(v).trim();
}

const periodActualCol = (n) => 19 + (n - 1) * 14;
const periodBudgetCol = (n) => 2 + (n - 1);
const YEAR_TOTAL_ACTUAL_COL = periodActualCol(13) + 7;      // 194

const SCAN_ROW_FIRST = 5;
const SCAN_ROW_LAST = 97;

// Fixed-cost lines Kevin named as red flags. These MUST recur; a
// mid-year cutoff is a W4 comparability risk.
const FIXED_COST_LINES = new Set([
  "5012.2", "5012.3",             // Scavenger, General Utilities
  "5013.1", "5013.2",             // Equipment Lease, Building Lease
  "3500.2", "3500.3", "3500.4", "3500.5",  // Vehicle costs
  "3200.1",                        // General Food (production food)
]);

// Load kpi_lines to filter dotless group headers.
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog } = await supa.from("kpi_lines").select("line_code");
const KPI_LINES = new Set(catalog.map((r) => r.line_code));

// Parse a workbook into: Map(account -> Map(line -> { yearTotalActual, lastPopulated }))
async function loadWorkbook(pathToXlsx) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(pathToXlsx);
  const byAccount = new Map();
  const foundAccounts = new Set();
  for (const ws of wb.worksheets) {
    const t = row1Title(ws);
    const key = resolveAccount(t);
    if (!key || foundAccounts.has(key)) continue;
    foundAccounts.add(key);
    const lines = new Map();
    for (let r = SCAN_ROW_FIRST; r <= SCAN_ROW_LAST; r += 1) {
      const row = ws.getRow(r);
      const rawLabel = row.getCell(1).value;
      const parsed = parseLineCode(rawLabel, r);
      if (!parsed) continue;
      if (!KPI_LINES.has(parsed.code)) continue;
      const yearTotalActual = readNumeric(row.getCell(YEAR_TOTAL_ACTUAL_COL));
      // Compute lastPopulated = last period_no with actual OR budget non-null.
      let lastPop = 0;
      for (let p = 13; p >= 1; p -= 1) {
        const a = readNumeric(row.getCell(periodActualCol(p)));
        const b = readNumeric(row.getCell(periodBudgetCol(p)));
        if (a != null || b != null) { lastPop = p; break; }
      }
      lines.set(parsed.code, {
        yearTotalActual: yearTotalActual == null ? 0 : yearTotalActual,
        lastPopulated: lastPop,
      });
    }
    byAccount.set(key, lines);
  }
  return byAccount;
}

const fy24 = await loadWorkbook(args.fy24);
const fy25 = await loadWorkbook(args.fy25);

// Identify FY2025 contiguous-tail pairs (Shape D: lastPopulated < 13).
// For each such pair, look up FY2024 (account, line).
const rows = [];
for (const [account, fy25Lines] of fy25) {
  for (const [code, fy25Info] of fy25Lines) {
    if (fy25Info.lastPopulated === 13) continue;             // fully populated - not Shape D
    if (fy25Info.lastPopulated === 0)  continue;             // whole-line-blank - Shape B (n/a here)
    // Look up FY2024.
    const fy24Lines = fy24.get(account);
    const fy24Info = fy24Lines ? fy24Lines.get(code) : null;
    const fy24Y = fy24Info ? Math.round(fy24Info.yearTotalActual * 100) / 100 : null;
    const fy25Y = Math.round(fy25Info.yearTotalActual * 100) / 100;
    const drop = fy24Y == null ? null : Math.round((fy24Y - fy25Y) * 100) / 100;
    const pct = fy24Y == null || fy24Y === 0 ? null : Math.round((100 * fy25Y / fy24Y) * 10) / 10;
    rows.push({
      account,
      code,
      fy24: fy24Y,
      fy25: fy25Y,
      drop,
      pct,
      lastPop: fy25Info.lastPopulated,
      isFixedCost: FIXED_COST_LINES.has(code),
    });
  }
}

// Sort by largest absolute drop (drop = fy24 - fy25; positive = decrease from FY24 to FY25).
rows.sort((a, b) => {
  const ad = a.drop == null ? -Infinity : a.drop;
  const bd = b.drop == null ? -Infinity : b.drop;
  return bd - ad;
});

console.log(`FY2024 -> FY2025 materiality for the FY2025 contiguous-tail set`);
console.log(`  FY2024 file: ${args.fy24.split("/").pop()}`);
console.log(`  FY2025 file: ${args.fy25.split("/").pop()}`);
console.log(`  Anchor: workbook YTD-P13 Actual (col 194); Kevin ruling 2026-09-17 - this side is the reconciled year total.`);
console.log(`  Fixed-cost flag [FX]: line is in {5012.2, 5012.3, 5013.1, 5013.2, 3500.2/3/4/5, 3200.1} (Kevin named).`);
console.log(``);
console.log(`  contiguous-tail (account, line_code) pairs in FY2025: ${rows.length}`);
console.log(`  of which FY2024 has a matching line:                  ${rows.filter((r) => r.fy24 != null).length}`);
console.log(`  of which FY2024 line is missing (no comparison):      ${rows.filter((r) => r.fy24 == null).length}`);
console.log(``);
console.log(`account         line     lastP  fy24_ytd_p13      fy25_ytd_p13      drop (fy24-fy25)  fy25/fy24  fixed`);
console.log(`---------------+--------+------+-----------------+-----------------+-----------------+----------+-----`);
for (const r of rows) {
  const fy24s = r.fy24 == null ? "n/a".padStart(15) : r.fy24.toFixed(2).padStart(15);
  const fy25s = r.fy25.toFixed(2).padStart(15);
  const drops = r.drop == null ? "n/a".padStart(15) : r.drop.toFixed(2).padStart(15);
  const pcts  = r.pct  == null ? "n/a".padStart(8)  : (r.pct.toFixed(1) + "%").padStart(8);
  const fx    = r.isFixedCost ? "[FX]" : "";
  console.log(`${r.account.padEnd(15)} ${r.code.padEnd(8)} P${String(r.lastPop).padStart(2)}   ${fy24s}   ${fy25s}   ${drops}   ${pcts}  ${fx}`);
}
console.log(``);

// Summary: per account, aggregate the drop across FIXED-COST lines only.
console.log(`─── Fixed-cost drop per account (FY2025 / FY2024, only [FX] lines with FY24 comparison) ───`);
console.log(`account         fixed_lines  sum_fy24        sum_fy25        sum_drop         sum_fy25/fy24`);
console.log(`---------------+-------------+---------------+---------------+----------------+-------------`);
const byAccount = new Map();
for (const r of rows) {
  if (!r.isFixedCost || r.fy24 == null) continue;
  const agg = byAccount.get(r.account) || { nLines: 0, fy24: 0, fy25: 0 };
  agg.nLines += 1;
  agg.fy24 += r.fy24;
  agg.fy25 += r.fy25;
  byAccount.set(r.account, agg);
}
const acctList = [...byAccount.entries()].sort((a, b) => (b[1].fy24 - b[1].fy25) - (a[1].fy24 - a[1].fy25));
for (const [acct, agg] of acctList) {
  const drop = Math.round((agg.fy24 - agg.fy25) * 100) / 100;
  const pct = agg.fy24 === 0 ? "n/a" : ((100 * agg.fy25 / agg.fy24).toFixed(1) + "%");
  console.log(`${acct.padEnd(15)} ${String(agg.nLines).padStart(11)}   ${agg.fy24.toFixed(2).padStart(13)}   ${agg.fy25.toFixed(2).padStart(13)}   ${drop.toFixed(2).padStart(14)}   ${pct.padStart(11)}`);
}
