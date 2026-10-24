// scripts/_probe_fin2027_present_with_zero_census.mjs
//
// FIN-2027 W1 Stage 2 · read-only census of "present-with-zero-actual"
// cells across FY2024, FY2025, and FY2026 P9 workbooks. Reports per
// (account, period) counts of cells where:
//     workbook actual cell = null (EMPTY)
//   AND
//     workbook budget cell = non-null (populated)
//
// Loader behaviour (both scripts/derive_pnl_actuals.mjs and
// scripts/load_pnl_history.mjs) writes actual = 0 to pnl_actuals on
// those cells. Contract in docs/migrations/pnl-1-actuals-and-status.sql
// (BINDING): "absent = NOT REPORTED, never $0". Kevin ruling
// 2026-09-17: loader is inventing facts on these cells. Log-only in
// W1; fix is a KPI-lane change.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_present_with_zero_census.mjs \
//     --fy24 '<xlsx>' --fy25 '<xlsx>' --fy26 '<xlsx>' --fy26-periods 1-9

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { readNumeric, parseLineCode } from "./lib/pnl_load_core.mjs";

const args = { fy24: null, fy25: null, fy26: null, fy26Periods: "1-9" };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--fy24") args.fy24 = process.argv[++i];
  else if (x === "--fy25") args.fy25 = process.argv[++i];
  else if (x === "--fy26") args.fy26 = process.argv[++i];
  else if (x === "--fy26-periods") args.fy26Periods = process.argv[++i];
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
for (const label of ["fy24", "fy25", "fy26"]) {
  if (!args[label] || !existsSync(args[label])) {
    console.error(`--${label} <path> required and must exist`);
    process.exit(1);
  }
}

const fy26Match = args.fy26Periods.match(/^(\d+)-(\d+)$/);
if (!fy26Match) { console.error(`--fy26-periods must be like '1-9'`); process.exit(1); }
const fy26First = Number(fy26Match[1]);
const fy26Last  = Number(fy26Match[2]);

// Row-1 -> account_key resolver (matches load_pnl_history.mjs).
function resolveAccount(t) {
  const s = (t || "").trim();
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

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog } = await supa.from("kpi_lines").select("line_code");
const KPI_LINES = new Set(catalog.map((r) => r.line_code));

// Census one workbook over a given period range.
async function census(pathToXlsx, fiscalYear, periodFirst, periodLast) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(pathToXlsx);
  // (account, period) -> count of present-with-zero cells
  const byAcctPeriod = new Map();
  // (account, line, period) -> 1 (for the by-line list)
  const cells = [];
  let totalPresent = 0;
  let totalPresentWithZero = 0;
  let totalPresentActualOnly = 0;
  let totalPresentBoth = 0;
  let totalAbsent = 0;
  const foundAccounts = new Set();
  for (const ws of wb.worksheets) {
    const acct = resolveAccount(row1Title(ws));
    if (!acct || foundAccounts.has(acct)) continue;
    foundAccounts.add(acct);
    for (let r = 5; r <= 97; r += 1) {
      const label = ws.getRow(r).getCell(1).value;
      const parsed = parseLineCode(label, r);
      if (!parsed) continue;
      if (!KPI_LINES.has(parsed.code)) continue;
      for (let p = periodFirst; p <= periodLast; p += 1) {
        const a = readNumeric(ws.getRow(r).getCell(periodActualCol(p)));
        const b = readNumeric(ws.getRow(r).getCell(periodBudgetCol(p)));
        const aPop = a != null;
        const bPop = b != null;
        if (aPop && bPop) totalPresentBoth += 1;
        else if (aPop) totalPresentActualOnly += 1;
        else if (bPop) {
          totalPresentWithZero += 1;
          const k = `${acct}::${p}`;
          byAcctPeriod.set(k, (byAcctPeriod.get(k) || 0) + 1);
          cells.push({ account: acct, code: parsed.code, period: p });
        } else totalAbsent += 1;
        if (aPop || bPop) totalPresent += 1;
      }
    }
  }
  return { fiscalYear, periodFirst, periodLast, byAcctPeriod, cells, totalPresent, totalPresentWithZero, totalPresentActualOnly, totalPresentBoth, totalAbsent, accounts: [...foundAccounts].sort() };
}

function printCensus(res) {
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`FY${res.fiscalYear} · P${res.periodFirst}..P${res.periodLast} · present-with-zero-actual census`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  const expected = res.accounts.length * 32 * (res.periodLast - res.periodFirst + 1);
  console.log(`  accounts:                  ${res.accounts.length}`);
  console.log(`  cells scanned (approx):    ${expected}   (~32 lines × ${res.periodLast - res.periodFirst + 1} periods × ${res.accounts.length} accounts)`);
  console.log(`  present-both:              ${res.totalPresentBoth}`);
  console.log(`  present-actual-only:       ${res.totalPresentActualOnly}`);
  console.log(`  PRESENT-WITH-ZERO-ACTUAL:  ${res.totalPresentWithZero}   <-- loader writes actual=0`);
  console.log(`  absent (both null):        ${res.totalAbsent}`);
  console.log(``);
  if (res.totalPresentWithZero === 0) {
    console.log(`  (no present-with-zero cells in this year - loader wrote no invented zeros)`);
    console.log("");
    return;
  }
  console.log(`  Per (account, period) count:`);
  const header = "  account         " + Array.from({ length: res.periodLast - res.periodFirst + 1 }, (_, i) => `P${String(res.periodFirst + i).padStart(2)}`).join(" ").padStart(4) + "  total";
  console.log(header);
  console.log("  ---------------+" + "-".repeat(header.length - 18));
  for (const acct of res.accounts) {
    const row = [];
    let total = 0;
    for (let p = res.periodFirst; p <= res.periodLast; p += 1) {
      const c = res.byAcctPeriod.get(`${acct}::${p}`) || 0;
      total += c;
      row.push(c === 0 ? "." : String(c));
    }
    if (total === 0) continue;
    console.log(`  ${acct.padEnd(15)} ${row.map((s) => s.padStart(3)).join(" ")}    ${total}`);
  }
  console.log("");
  console.log(`  Per (account, line, period) list:`);
  const byAcctLine = new Map();
  for (const c of res.cells) {
    const k = `${c.account}::${c.code}`;
    if (!byAcctLine.has(k)) byAcctLine.set(k, []);
    byAcctLine.get(k).push(c.period);
  }
  const sortedKeys = [...byAcctLine.keys()].sort();
  for (const k of sortedKeys) {
    const [acct, code] = k.split("::");
    const ps = byAcctLine.get(k);
    console.log(`    ${acct.padEnd(15)} ${code.padEnd(8)} ${String(ps.length).padStart(3)}  P${ps.join(",P")}`);
  }
  console.log("");
}

const r24 = await census(args.fy24, 2024, 1, 13);
const r25 = await census(args.fy25, 2025, 1, 13);
const r26 = await census(args.fy26, 2026, fy26First, fy26Last);

printCensus(r24);
printCensus(r25);
printCensus(r26);

console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`Grand totals across all three years:`);
console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`  FY2024 P1..P13    · present-with-zero: ${r24.totalPresentWithZero}`);
console.log(`  FY2025 P1..P13    · present-with-zero: ${r25.totalPresentWithZero}`);
console.log(`  FY2026 P${fy26First}..P${fy26Last}     · present-with-zero: ${r26.totalPresentWithZero}   <-- LIVE KPI board`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  Total across three years (loader-invented zeros): ${r24.totalPresentWithZero + r25.totalPresentWithZero + r26.totalPresentWithZero}`);
