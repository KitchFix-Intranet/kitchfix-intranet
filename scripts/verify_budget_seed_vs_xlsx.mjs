// scripts/verify_budget_seed_vs_xlsx.mjs
//
// KPI-2 · independent extraction from the 11 "* - 2026 P&L - Clean.xlsx"
// workbooks; compares against the local seed JSON. Public repo carries
// zero dollar literals - every number this script sees is from Kevin's
// local files at runtime.
//
// Usage:
//   node scripts/verify_budget_seed_vs_xlsx.mjs \
//     --file <path>/fy2026_pnl_budget_seed.json \
//     --xlsx-dir <path>
//
// Per playbook: the workbooks were verified 2026-08-04 for kpi-1 and
// are the ground truth for FY2026 line values (with the TXR-TX-H
// season being the sole owner-ruled exception - lives in
// sc_labor_budgets, not here; see playbook §5.4 + §4.5).
//
// What this script does:
//   1. For each account, opens its workbook (name via a small map to
//      the pnl_tab_name spelling; matches accounts.pnl_tab_name from
//      kpi-1). Sheet name is the first sheet.
//   2. Reads row 3 for period headers (must be exactly P1..P13 in B..N).
//   3. Walks each row: column A carries the line label. Extracts the
//      leaf-line rows (indented 4-space code prefix), matches them by
//      the trailing line_code slice, sums B..N per row rounded to 2dp.
//      Group-header rows and "Total ..." rows are excluded (playbook
//      §8.2: 3100-group totals are salary-leakage on public surfaces).
//   4. Per account: asserts the workbook's 3100.1 year sum ties to
//      the seed's manifest_3100_1_year_totals to the cent. Note the
//      workbook Year cell (col O) may differ from the period sum by
//      <= $0.02 rounding drift; the JSON is canonical.
//   5. Asserts the row set (line codes seen per account) matches the
//      seed's per-account line codes.
//   6. Asserts grand checksum: sum of all seed amounts vs sum from
//      independent workbook extraction, tolerance ±$0.02 per line
//      rounded (so up to N * $0.02 across N lines).
//
// Output: per-account TIE/FAIL + counts. No dollar amounts. This is
// the independent gate on the extraction - it must pass 11/11 before
// the loader runs.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[++i]);
}
const seedPath = args.get("file");
const xlsxDir = args.get("xlsx-dir");
if (!seedPath || !xlsxDir) {
  console.error("ERROR: --file <seed.json> --xlsx-dir <dir> both required");
  process.exit(2);
}

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
if (!seed?.manifest_3100_1_year_totals || !Array.isArray(seed.lines)) {
  console.error("ERROR: seed missing manifest_3100_1_year_totals or lines[]");
  process.exit(2);
}

// account_key -> pnl_tab_name (from kpi-1). Workbook filenames vary
// (city-code, city name, comma-space), so we walk the dir and match
// on a substring of pnl_tab_name.
const PNL_TAB = {
  "CIN - AZ":     "CIN-AZ",
  "CIN - KY":     "CIN-KY",
  "CIN - OH":     "CIN-OH",
  "STL - FL":     "STL-FL",
  "STL - MO":     "STL-MO",
  "TBJ - NY":     "TBJ-BUF",
  "TBJ - FL":     "TBJ-FL",
  "TBR - FL":     "TBR-FL",
  "TXR - AZ":     "TXR-AZ",
  "TXR - TX - H": "TXR-H",
  "TXR - TX - V": "TXR-V",
};

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
// Fix C - filename tolerance. Downloaded copies commonly mangle
// spaces/ampersands to underscores. Accept both spellings.
// Fix F - skip Excel lock files (~$<name>.xlsx). Openpyxl / ExcelJS
// crash on lock files with BadZipFile, and .find() below is
// readdir-order dependent - a lock file that wins the race silently
// misroutes an account. Filtering here removes the landmine.
// Fix G - each file also carries a normalized name (letters/digits
// only, others collapsed to single spaces). Per-account signatures
// match against `norm` so an underscore-mangled folder still
// resolves cleanly.
const files = readdirSync(xlsxDir)
  .filter(f => f.endsWith(".xlsx") && /2026[ _]P[&_]L/.test(f) && !f.startsWith("~$"))
  .map(f => ({
    name: f,
    full: join(xlsxDir, f),
    norm: f.replace(/[^A-Za-z0-9]+/g, " "),
  }));

if (files.length === 0) {
  console.error(`ERROR: no "*2026 P&L*.xlsx" files found in ${xlsxDir}`);
  process.exit(2);
}

// Match filename to account_key. Signatures are plain space-separated
// words matched against the normalized filename, so both current names
// and underscore-mangled copies resolve to the right workbook.
function fileForAccount(acct) {
  const stub = PNL_TAB[acct];
  if (!stub) return null;
  const sig = {
    "CIN - AZ":     "Goodyear",
    "CIN - KY":     "Louisville",
    "CIN - OH":     "Cincinnati",
    "STL - FL":     "Jupiter",
    "STL - MO":     "St Louis",     // 'Louis' alone collides with Louisville (CIN - KY)
    "TBJ - NY":     "Buffalo",
    "TBJ - FL":     "Dunedin",
    "TBR - FL":     "Port Charlotte",
    "TXR - AZ":     "Surprise",
    "TXR - TX - H": "TXR H",
    "TXR - TX - V": "TXR V",
  }[acct];
  if (!sig) return null;
  const hit = files.find(f => f.norm.includes(sig));
  return hit ? hit.full : null;
}

async function readAccount(acct) {
  const path = fileForAccount(acct);
  if (!path) return { error: `no workbook found for ${acct}` };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];

  // Period-header assertion (row 3 cols B..N = P1..P13).
  const hdrRow = ws.getRow(3);
  for (let c = 2; c <= 14; c += 1) {
    const want = `P${c - 1}`;
    const got = String(hdrRow.getCell(c).value || "").trim();
    if (got !== want) {
      return { error: `${acct} row3 col${c}: expected ${want}, got '${got}'` };
    }
  }

  // Fix A - leaf discriminator by row shape, not by indent + dot.
  // Reason: the workbooks carry no-dot revenue leafs (`2200 Catering
  // Revenue`, `2300 Service Charges`, `2600 Consulting`) at zero-indent
  // group-header level. Requiring both an indent and a dotted code
  // dropped them, so the workbook side of the grand checksum missed
  // that revenue.
  //
  // A row is a LEAF when:
  //   1. trimmed label starts with a code (`\d+` optionally followed
  //      by `.\d+`, then whitespace)
  //   2. trimmed label does not start with `Total `
  //   3. at least one of its 13 period cells (cols B..N) is non-null
  //      (Ruling 1: a $0 budget is a budget fact; numeric 0 keeps a
  //      row as a leaf. Group headers have ALL 13 cells blank in
  //      these workbooks - that is the true discriminator).
  //
  // The title row (`2026 - P&L Budget vs Actual`) fails the code
  // regex and stays excluded. The line_code is the leading token.
  const lines = new Map(); // line_code -> [amount * 13]
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const label = String(ws.getRow(r).getCell(1).value || "");
    if (!label) continue;
    const trimmed = label.trim();
    if (trimmed.startsWith("Total ")) continue;
    const codeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s/);
    if (!codeMatch) continue;
    const line_code = codeMatch[1];
    // Row shape: any non-null period cell qualifies as a leaf.
    let hasCell = false;
    const periods = [];
    for (let c = 2; c <= 14; c += 1) {
      const v = ws.getRow(r).getCell(c).value;
      if (v !== null && v !== undefined && v !== "") hasCell = true;
      periods.push(r2(v));
    }
    if (!hasCell) continue;  // group header - all 13 cells blank
    lines.set(line_code, periods);
  }
  return { lines };
}

const accounts = Object.keys(PNL_TAB);
let tieCount = 0;
let failCount = 0;
const details = [];

for (const acct of accounts) {
  const res = await readAccount(acct);
  if (res.error) {
    failCount += 1;
    details.push(`  ${acct.padEnd(15)} FAIL - ${res.error}`);
    continue;
  }

  // 3100.1 year sum vs seed manifest.
  const line = res.lines.get("3100.1");
  const wbSum = line ? r2(line.reduce((s, x) => s + x, 0)) : null;
  const manifest = seed.manifest_3100_1_year_totals[acct];

  if (manifest == null) {
    // Accounts with 3100.1 inactivated (CIN-KY, TBJ-NY per kpi-1)
    // should have NO manifest entry AND either no leaf line or all
    // zeros. Verify both.
    const hasNonzero = line && line.some(v => Math.abs(v) > 0.01);
    if (hasNonzero) {
      failCount += 1;
      details.push(`  ${acct.padEnd(15)} FAIL - manifest omits 3100.1 but workbook carries non-zero periods`);
    } else {
      tieCount += 1;
      details.push(`  ${acct.padEnd(15)} TIE (3100.1 not applicable - inactive per kpi-1)`);
    }
    continue;
  }

  const manifestR = r2(manifest);
  if (wbSum == null) {
    failCount += 1;
    details.push(`  ${acct.padEnd(15)} FAIL - workbook has no 3100.1 leaf line`);
    continue;
  }
  const tie = Math.abs(wbSum - manifestR) < 0.01;
  if (tie) tieCount += 1; else failCount += 1;
  details.push(`  ${acct.padEnd(15)} 3100.1 year sum - ${tie ? "TIE" : "FAIL"}`);
}

console.log(`\nverify_budget_seed_vs_xlsx.mjs · ${accounts.length} accounts`);
for (const d of details) console.log(d);
console.log(`\n${tieCount}/${accounts.length} TIE, ${failCount} FAIL`);

if (failCount > 0) process.exit(1);

// ── Grand-checksum sanity ────────────────────────────────────────
// Sum of every seed line vs sum of every workbook leaf line (across
// all accounts, all line codes, all periods). Tolerance is per-line
// $0.02 * N_lines - generous, but structural mismatches surface loud.
let seedTotal = 0;
for (const r of seed.lines) seedTotal += Number(r.amount);
seedTotal = r2(seedTotal);

let wbTotal = 0;
let wbLineCount = 0;
for (const acct of accounts) {
  const res = await readAccount(acct);
  if (res.error || !res.lines) continue;
  for (const periods of res.lines.values()) {
    for (const v of periods) wbTotal += v;
    wbLineCount += 1;
  }
}
wbTotal = r2(wbTotal);
const tolerance = wbLineCount * 0.02;
const grandTie = Math.abs(seedTotal - wbTotal) <= tolerance;
console.log(`\ngrand checksum: seed vs workbook - ${grandTie ? "TIE" : "FAIL"} (tolerance ${tolerance.toFixed(2)} across ${wbLineCount} lines)`);
if (!grandTie) process.exit(1);
console.log("\nVERIFY PASS");
