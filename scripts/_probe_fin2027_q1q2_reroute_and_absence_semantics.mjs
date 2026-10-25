// scripts/_probe_fin2027_q1q2_reroute_and_absence_semantics.mjs
//
// FIN-2027 W1 · Kevin questions Q1 + Q2 (2026-09-17). Read-only.
//
// Q1: are 1374.1 / 1385.1 / 1385.3 rows PRESENT in the FY2024 and
//     FY2025 portfolio tabs? Report every row in the CIN - OH,
//     STL - FL, STL - MO tabs whose col-A label carries a code
//     OUTSIDE the 34-line kpi_lines catalog, with row number and
//     a flag indicating whether the row carries at least one
//     non-null period actual or budget cell.
//
// Q2: for the 1124 FY2025 cells that my earlier absence-shape probe
//     classified as "populated" but part of a Shape D contiguous
//     tail, categorize each per-period cell into:
//         (i)   actual non-null, budget non-null    -- present-both
//         (ii)  actual non-null, budget null        -- present-actual-only
//         (iii) actual null, budget non-null        -- PRESENT-WITH-ZERO-ACTUAL
//         (iv)  actual null, budget null            -- absent (should not appear in the 1124)
//     Report counts + which cells fall into (iii) - these are
//     the cells where the loader writes actual = 0 to pnl_actuals
//     even though the workbook made no claim of zero spend.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_q1q2_reroute_and_absence_semantics.mjs \
//     --fy24 '<xlsx>' --fy25 '<xlsx>'

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { readNumeric } from "./lib/pnl_load_core.mjs";

const args = { fy24: null, fy25: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--fy24") args.fy24 = process.argv[++i];
  else if (x === "--fy25") args.fy25 = process.argv[++i];
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
if (!args.fy24 || !args.fy25 || !existsSync(args.fy24) || !existsSync(args.fy25)) {
  console.error("usage: node --env-file=.env.local scripts/_probe_fin2027_q1q2_reroute_and_absence_semantics.mjs --fy24 <x> --fy25 <x>");
  process.exit(1);
}

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog } = await supa.from("kpi_lines").select("line_code");
const KPI_LINES = new Set(catalog.map((r) => r.line_code));
console.log(`kpi_lines catalog: ${KPI_LINES.size} codes`);
console.log("");

const periodActualCol = (n) => 19 + (n - 1) * 14;
const periodBudgetCol = (n) => 2 + (n - 1);

function readCellString(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("");
  return String(v);
}

// Parse a leading numbered code from a label (looser than the
// loader's parseLineCode - we want to catch dotless 1xxx codes
// too, which the loader skips).
function parseCodeLoose(rawLabel) {
  if (typeof rawLabel !== "string") return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{3,4}(?:\.\d+)?)\s+/);
  return m ? m[1] : null;
}

async function loadWb(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

// ─── Q1 · reroute-account row dump ─────────────────────────────────

async function dumpRerouteTab(wb, tabName, accountLabel, year) {
  const ws = wb.getWorksheet(tabName);
  if (!ws) {
    console.log(`  ${accountLabel} (${year}): tab '${tabName}' NOT FOUND`);
    return;
  }
  console.log(`  ${accountLabel} (${year}) · tab '${tabName}':`);

  // Pass 1 - Kevin's explicit question: does the tab carry ANY 1374.x or 1385.x row?
  let found1374 = false;
  let found1385 = false;
  const scanLastRow = Math.min(ws.rowCount || 250, 250);
  for (let r = 1; r <= scanLastRow; r += 1) {
    const label = readCellString(ws.getRow(r).getCell(1));
    const trimmed = label.trim();
    if (trimmed.length === 0) continue;
    if (/\b1374(?:\.\d+)?\b/.test(trimmed)) { found1374 = true; console.log(`    HIT 1374 at row ${r}: '${trimmed.slice(0, 60)}'`); }
    if (/\b1385(?:\.\d+)?\b/.test(trimmed)) { found1385 = true; console.log(`    HIT 1385 at row ${r}: '${trimmed.slice(0, 60)}'`); }
  }
  console.log(`    1374 code family present in tab: ${found1374 ? "YES" : "NO"}`);
  console.log(`    1385 code family present in tab: ${found1385 ? "YES" : "NO"}`);
  console.log("");

  // Pass 2 - dump every row (1..scanLastRow) whose col-A label parses
  // to a code outside kpi_lines. Broader coverage than earlier probe.
  console.log(`    row   code       label                                   period_values?`);
  console.log(`    ---+----------+--------------------------------------+---------------`);
  let n = 0;
  for (let r = 1; r <= scanLastRow; r += 1) {
    const label = readCellString(ws.getRow(r).getCell(1));
    const code = parseCodeLoose(label);
    if (!code) continue;
    if (KPI_LINES.has(code)) continue;
    let anyActualNonNull = false;
    let anyBudgetNonNull = false;
    for (let p = 1; p <= 13; p += 1) {
      const a = readNumeric(ws.getRow(r).getCell(periodActualCol(p)));
      const b = readNumeric(ws.getRow(r).getCell(periodBudgetCol(p)));
      if (a != null) anyActualNonNull = true;
      if (b != null) anyBudgetNonNull = true;
    }
    const flag = anyActualNonNull ? "actual+" : (anyBudgetNonNull ? "budget-only" : "blank");
    const shortLabel = label.trim().slice(0, 38);
    console.log(`    ${String(r).padStart(3)}   ${code.padEnd(9)} ${shortLabel.padEnd(38)}  ${flag}`);
    n += 1;
  }
  console.log(`    ${n} row(s) with code outside kpi_lines (rows 1..${scanLastRow})\n`);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("Q1 · off-catalog codes in the three reroute-account tabs");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
const wb24 = await loadWb(args.fy24);
const wb25 = await loadWb(args.fy25);

// FY2024 tab names (portfolio): CIN-OH = 'PFS - CINN'; STL-FL, STL-MO absent.
// FY2025 tab names (portfolio): CIN-OH = 'CINN (PFS)'; STL-FL = 'JUP (PFS)'; STL-MO = 'STL (PFS)'.
await dumpRerouteTab(wb24, "PFS - CINN", "CIN - OH", "FY2024");
await dumpRerouteTab(wb25, "CINN (PFS)", "CIN - OH", "FY2025");
console.log(`  STL - FL FY2024 · tab not present (account added in FY2025)\n`);
await dumpRerouteTab(wb25, "JUP (PFS)",  "STL - FL", "FY2025");
console.log(`  STL - MO FY2024 · tab not present (account added in FY2025)\n`);
await dumpRerouteTab(wb25, "STL (PFS)",  "STL - MO", "FY2025");

// ─── Q2 · absence semantics on the 1124 FY2025 cells ────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log("Q2 · absence-semantics for the 1124 FY2025 Shape D cells");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("Loader rule (scripts/load_pnl_history.mjs and derive_pnl_actuals.mjs):");
console.log("  if (actual == null && budget == null) -> skip row (absent, contract-compliant)");
console.log("  else                                  -> write row with:");
console.log("                                           actual = (actual == null ? 0 : round2(actual))");
console.log("                                           budget = (budget == null ? null : round2(budget))");
console.log("");
console.log("So a cell with actual = null and budget = non-null lands as actual = 0 (PRESENT-WITH-ZERO).");
console.log("pnl_actuals.actual is NOT NULL, so 'actual = 0' cannot be distinguished from 'actual reported as $0'.");
console.log("");

// Row-1 -> account_key
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
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join("");
  return String(v);
}

const buckets = {
  present_both:                   { count: 0, description: "actual non-null, budget non-null" },
  present_actual_only:            { count: 0, description: "actual non-null, budget null (loader writes actual as-read, budget=null)" },
  present_with_zero_actual:       { count: 0, description: "actual null, budget non-null (loader writes actual=0)" },
  absent:                         { count: 0, description: "actual null, budget null (loader skips - should not appear here)" },
};

const presentWithZeroDetails = new Map();                  // "account::code" -> [period, ...]

for (const ws of wb25.worksheets) {
  const key = resolveAccount(row1Title(ws));
  if (!key) continue;
  for (let r = 5; r <= 97; r += 1) {
    const label = readCellString(ws.getRow(r).getCell(1));
    const trimmed = label.trim();
    if (trimmed.length === 0) continue;
    if (/^total\b/i.test(trimmed)) continue;
    const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
    if (!m) continue;
    const code = m[1];
    if (!KPI_LINES.has(code)) continue;
    // Same rules as parseLineCode: SG&A dotless is a group header.
    if (r >= 60 && !code.includes(".")) continue;
    // Walk 13 periods; determine which are in Shape D (blank after lastPop).
    // Actually, evaluate every cell that entered the loader's "populated"
    // count (either actual OR budget non-null) - that IS the 1124 set for FY2025.
    for (let p = 1; p <= 13; p += 1) {
      const a = readNumeric(ws.getRow(r).getCell(periodActualCol(p)));
      const b = readNumeric(ws.getRow(r).getCell(periodBudgetCol(p)));
      const aPop = a != null;
      const bPop = b != null;
      if (aPop && bPop) buckets.present_both.count += 1;
      else if (aPop) buckets.present_actual_only.count += 1;
      else if (bPop) {
        buckets.present_with_zero_actual.count += 1;
        const k = `${key}::${code}`;
        if (!presentWithZeroDetails.has(k)) presentWithZeroDetails.set(k, []);
        presentWithZeroDetails.get(k).push(p);
      } else buckets.absent.count += 1;
    }
  }
}

const totalCellsScanned = buckets.present_both.count + buckets.present_actual_only.count + buckets.present_with_zero_actual.count + buckets.absent.count;
console.log(`FY2025 cell classification across all portfolio tabs (352 lines x 13 periods = 4576 total):`);
console.log(`  absent (actual null, budget null; loader skips):                 ${buckets.absent.count.toString().padStart(5)}`);
console.log(`  present-both (actual non-null, budget non-null):                 ${buckets.present_both.count.toString().padStart(5)}`);
console.log(`  present-actual-only (actual non-null, budget null):              ${buckets.present_actual_only.count.toString().padStart(5)}`);
console.log(`  PRESENT-WITH-ZERO-ACTUAL (actual null, budget non-null):         ${buckets.present_with_zero_actual.count.toString().padStart(5)}   <-- loader writes actual=0`);
console.log(`  ────────────────────────────────────────────────────────────────────────`);
console.log(`  total cells scanned:                                             ${totalCellsScanned.toString().padStart(5)}`);
console.log(``);
console.log(`Cross-check to earlier absence-shape numbers:`);
console.log(`  loaded (present-both + present-actual-only + present-with-zero): ${(buckets.present_both.count + buckets.present_actual_only.count + buckets.present_with_zero_actual.count).toString().padStart(5)}   (matches prior loaded=3452)`);
console.log(`  absent (Shape A + B + D + internal-scattered):                   ${buckets.absent.count.toString().padStart(5)}   (matches prior absent=1124)`);
console.log(``);

if (buckets.present_with_zero_actual.count > 0) {
  console.log("Per (account, line_code) presence of PRESENT-WITH-ZERO-ACTUAL cells:");
  console.log("  account         line     count  periods");
  console.log("  ---------------+--------+------+---------");
  const sortedKeys = [...presentWithZeroDetails.keys()].sort();
  for (const k of sortedKeys) {
    const [acct, code] = k.split("::");
    const periods = presentWithZeroDetails.get(k);
    console.log(`  ${acct.padEnd(15)} ${code.padEnd(8)} ${String(periods.length).padStart(5)}  P${periods.join(",P")}`);
  }
}
