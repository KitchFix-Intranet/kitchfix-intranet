#!/usr/bin/env node
// FIN-2027 W5 · CORP load and net income · staged loader.
//
// Authorization: Kevin's rulings R-22 through R-31 (brief 2026-09-23).
// Binding rules 8b + 8c: accounts before pnl_actuals; report row
// counts per stage against estimate before starting the next stage.
//
// Usage:
//   node --env-file=.env.local scripts/fin2027_w5_load.mjs \
//        --stage=<0|1|1b|2|3> \
//        [--execute]        # default is dry-run
//        [--year=<2024|2025|2026>]  # narrows Stage 2 / Stage 3
//        [--sheet=<name>]           # narrows Stage 3 to one sheet
//
// Dry-run prints every row and reports counts + control totals.
// --execute performs the writes in batches, using ON CONFLICT to be
// idempotent. Every row's `source_ref` traces to the workbook cell.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { homedir } from "node:os";

// ── args
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  }
  return [a, true];
}));
const stage = String(args.stage || "");
const execute = !!args.execute;
const yearFilter = args.year ? Number(args.year) : null;
const sheetFilter = args.sheet || null;

if (!stage) {
  console.error("usage: --stage=<0|1|1b|2|3> [--execute] [--year=YYYY] [--sheet=NAME]");
  process.exit(2);
}

// ── env
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: ABSENT");
  process.exit(1);
}
const s = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── workbook paths (Kevin's local client-financial files - never in the repo).
// Override any of these via env: FIN2027_W5_FY{24,25,26}_XLSX=/path/to.xlsx
const FY24_PATH = process.env.FIN2027_W5_FY24_XLSX
  || path.join(homedir(), "Documents", "KitchFix", "Finance", "Past Finance", "P&L's", "Budget vs Actual (2024) P13 (2.03.25) SLT (2).xlsx");
const FY25_PATH = process.env.FIN2027_W5_FY25_XLSX
  || path.join(homedir(), "Downloads", "Budget vs Actual (2025) (SLT) P13 (01.21.26).xlsx");
const FY26_PATH = process.env.FIN2027_W5_FY26_XLSX
  || path.join(homedir(), "Downloads", "Budget vs Actual (SLT) (2026) P9 (9.15.26) (1).xlsx");
const FY_BOOK = new Map([[2024, FY24_PATH], [2025, FY25_PATH], [2026, FY26_PATH]]);

// ── Python helper to read xlsx (openpyxl is 3.1.5, verified)
// Uses a temp python script so we avoid embedding openpyxl in JS. Reads
// cached values only (data_only=True).
function pyxl(pathToXlsx, sheetName, cellRefs) {
  // cellRefs is [{col:int, row:int}, ...] with 1-based coords
  const argsPy = JSON.stringify({ path: pathToXlsx, sheet: sheetName, cells: cellRefs });
  const script = `
import json, sys
import openpyxl
args = json.loads(sys.stdin.read())
wb = openpyxl.load_workbook(args["path"], data_only=True)
sh = wb[args["sheet"]]
out = []
for c in args["cells"]:
    v = sh.cell(row=c["row"], column=c["col"]).value
    out.append(v)
print(json.dumps(out, default=str))
`;
  const raw = execFileSync("python3", ["-c", script], { input: argsPy, maxBuffer: 32 * 1024 * 1024 }).toString();
  return JSON.parse(raw);
}

// Read entire sheet as a 2D array (rows × cols), first 200 rows and 250 cols.
function readSheet(pathToXlsx, sheetName) {
  const argsPy = JSON.stringify({ path: pathToXlsx, sheet: sheetName });
  const script = `
import json, sys
import openpyxl
args = json.loads(sys.stdin.read())
wb = openpyxl.load_workbook(args["path"], data_only=True)
sh = wb[args["sheet"]]
grid = []
mr = min(200, sh.max_row)
mc = min(250, sh.max_column)
for r in range(1, mr + 1):
    row = []
    for c in range(1, mc + 1):
        row.append(sh.cell(row=r, column=c).value)
    grid.append(row)
print(json.dumps({"max_row": mr, "max_col": mc, "grid": grid}, default=str))
`;
  const raw = execFileSync("python3", ["-c", script], { input: argsPy, maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(raw);
}

// ── constants
const PERIODS = 13;
// Per Kevin's brief: locate by header, not by hardcoded column.
// The period-actual column N is at (row-3 P_N header + row-4 'Actual').
// Every workbook we care about uses: P_N actual at col = 19 + (N-1)*14
// (verified across FY2024, FY2025, FY2026), YTD P_N Actual at col = 138
// for N=9 and col = 194 for N=13. But loader confirms structure by
// reading row 3/4 headers before trusting these offsets.

function resolvePeriodColumns(grid) {
  // Returns { periodActual: [col_for_P1, ..., col_for_P13] }, 1-based.
  // Row 3 marks period blocks ("P1", "P2", ..., "P13"); row 4 marks
  // sub-columns ("Actual" comes 2 cols after the P_N Budget marker).
  const row3 = grid[2] || [];
  const row4 = grid[3] || [];
  const periodActual = new Array(PERIODS + 1).fill(null);
  for (let c = 1; c < row3.length; c += 1) {
    const h = row3[c];
    if (typeof h === "string") {
      const m = h.match(/^P(\d{1,2})$/);
      if (m) {
        const n = Number(m[1]);
        // Actual sub-column is 2 cols to the right of the Budget
        // marker for P_N; row 4 at c+2 must equal "Actual".
        const sub = row4[c + 2];
        if (typeof sub === "string" && sub.trim() === "Actual") {
          periodActual[n] = c + 3; // 1-based
        }
      }
    }
  }
  return periodActual;
}

// Sheet parser · returns { code -> { label, values: [P1..P13] actuals } }
// A row is a LEAF if its col-A first token matches a code in kpi_lines
// AND the row is not a "Total X" aggregate. Indent is NOT a reliable
// marker: CORP sheets carry 5013.5 at indent=0, and CHI/1731 carry
// bare-code leaves 2800 and 5001 at indent=0.
function parseSheet(grid, periodCols, knownCodes) {
  const leaves = new Map();
  for (let r = 0; r < grid.length; r += 1) {
    const raw = grid[r]?.[0];
    if (typeof raw !== "string") continue;
    const stripped = raw.trim();
    if (!stripped) continue;
    const first = stripped.split(/\s+/)[0];
    // code shape: digits or digits.digits
    if (!/^\d+(\.\d+)?$/.test(first)) continue;
    // total rows (start with "Total") are aggregates
    if (/^total\b/i.test(stripped)) continue;
    // only load codes that exist in kpi_lines
    if (!knownCodes.has(first)) continue;
    const label = stripped.slice(first.length).trim();
    const vals = new Array(PERIODS + 1).fill(null);
    for (let n = 1; n <= PERIODS; n += 1) {
      const col = periodCols[n];
      if (col == null) continue;
      const v = grid[r]?.[col - 1];
      vals[n] = typeof v === "number" ? v : null;
    }
    leaves.set(first, { code: first, label, row: r + 1, values: vals });
  }
  return leaves;
}

// ── batch inserter with reporting
async function insertBatch(table, rows, conflict) {
  if (rows.length === 0) return { inserted: 0, error: null };
  if (!execute) {
    return { inserted: 0, error: null, previewed: rows.length };
  }
  const q = await s.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: false });
  return { inserted: rows.length, error: q.error };
}

// ══════════════════════════════════════════════════════════════════
// STAGE 0 · accounts rows
// ══════════════════════════════════════════════════════════════════
async function stage0() {
  console.log("=== Stage 0 · accounts ===");
  const rows = [
    {
      team_key: "CIN - FL",
      name: "Daytona Tortugas",
      level: "A",
      city: "Daytona",
      state: "FL",
      season: "2026",
      active: false,
      region: "West",       // matches other CIN affiliates
      pnl_tab_name: "DTOR",
      billing_model: null,
      has_homestand_schedule: false,
      has_schedule_overlay: false,
    },
    {
      team_key: "CHI - IL",
      name: "KitchFix Chicago",
      level: "DTC",
      city: "Chicago",
      state: "IL",
      season: "2026",
      active: false,
      region: "East",       // R-33 (Kevin ruling 2026-09-23); owner call, not geography
      pnl_tab_name: "CHI",
      billing_model: null,
      has_homestand_schedule: false,
      has_schedule_overlay: false,
    },
  ];
  console.log(`  ${rows.length} rows proposed:`);
  for (const r of rows) {
    console.log(`    ${r.team_key.padEnd(10)}  name=${JSON.stringify(r.name)}  level=${r.level}  active=${r.active}  pnl_tab_name=${r.pnl_tab_name}`);
  }
  const res = await insertBatch("accounts", rows, "team_key");
  if (res.error) {
    console.error(`  WRITE FAILED: ${res.error.message}`);
    process.exit(3);
  }
  if (execute) console.log(`  ✓ wrote ${res.inserted} rows`);
  else console.log(`  (dry-run) would write ${res.previewed} rows · re-run with --execute to insert`);
  return rows.length;
}

// ══════════════════════════════════════════════════════════════════
// STAGE 1 · kpi_lines SG&A additions (21 codes)
// ══════════════════════════════════════════════════════════════════
const STAGE1_LINES = [
  // 19 from Kevin's brief:
  ["5004.1", "sga", "Owner Wages"],
  ["5004.2", "sga", "Finance & Accounting Wages"],
  ["5004.4", "sga", "Marketing Wages"],
  ["5004.6", "sga", "General Wages"],
  ["5004.7", "sga", "Operations Wages"],
  ["5006.2", "sga", "Sales Travel"],
  ["5006.4", "sga", "Sales Function Event"],
  ["5011.1", "sga", "General Liability Insurance"],
  ["5012.4", "sga", "Dues & Subscriptions"],
  ["5012.6", "sga", "Office Supplies"],
  ["5013.5", "sga", "Relocation Storage"],
  ["5016.1", "sga", "Accounting Fees"],
  ["5016.2", "sga", "Legal Fees"],
  ["5016.4", "sga", "Payroll Fees"],
  ["5016.5", "sga", "Interest Expense"],
  ["5017.1", "sga", "Medical/Dental/Vision"],
  ["5017.2", "sga", "Training"],
  ["5017.4", "sga", "Recruiting"],
  ["5017.6", "sga", "Charitable Contributions"],
  // + R-23 and R-25:
  ["5004.0", "sga", "Corporate Wages (undifferentiated)"],
  ["5000.0", "sga", "Corporate SG&A (undifferentiated)"],
];

// ══════════════════════════════════════════════════════════════════
// STAGE 1b · kpi_lines Chicago (22 codes)
// ══════════════════════════════════════════════════════════════════
const STAGE1B_LINES = [
  ["2000.1", "revenue", "Kitchfix.com Meal Sales"],
  ["2000.3", "revenue", "Third Party Meal Revenue"],
  ["2200.2", "revenue", "Contract Catering"],
  ["2200.3", "revenue", "Corporate Catering"],
  ["2200.4", "revenue", "Visiting Baseball"],
  ["2200.5", "revenue", "Other Sports"],
  ["2200.6", "revenue", "Non Tax Revenue"],
  ["2500.1", "revenue", "General Discounts"],
  ["2500.2", "revenue", "Refunds"],
  ["2500.3", "revenue", "Investor"],
  ["2500.4", "revenue", "Staff Discounts"],
  ["2800",   "revenue", "Delivery Revenue"],
  ["3300.1", "cogs",    "Delivery Hourly Wages"],
  ["3300.2", "cogs",    "Delivery Fines & Penalties"],
  ["3400.3", "cogs",    "Commissary Labels & Printing"],
  ["3400.4", "cogs",    "Warehousing"],
  ["3500.6", "cogs",    "Vehicle Depreciation"],
  ["5001",   "sga",     "Traditional Marketing"],
  ["5002.4", "sga",     "Website"],
  ["5004.5", "sga",     "Customer Service Wages"],
  ["5013.3", "sga",     "Printer Lease"],
  ["5013.4", "sga",     "Parking Lease"],
];

async function stageKpiLines(rows, label, expected) {
  console.log(`=== Stage ${label} · kpi_lines · ${rows.length} rows proposed (expect ${expected}) ===`);

  // Load current max sort_order
  const cur = await s.from("kpi_lines").select("line_code, sort_order").order("sort_order", { ascending: false }).limit(1);
  if (cur.error) { console.error(cur.error); process.exit(3); }
  let nextSort = (cur.data?.[0]?.sort_order ?? 340) + 10;

  const insert = rows.map(([code, section, name]) => {
    const row = { line_code: code, section, line_name: name, sort_order: nextSort };
    nextSort += 10;
    return row;
  });

  // Existence check · dry-run only prints what's new
  const existing = await s.from("kpi_lines").select("line_code").in("line_code", insert.map(r => r.line_code));
  if (existing.error) { console.error(existing.error); process.exit(3); }
  const already = new Set((existing.data || []).map(r => r.line_code));
  const toInsert = insert.filter(r => !already.has(r.line_code));
  const skipped  = insert.filter(r =>  already.has(r.line_code));

  for (const r of toInsert) {
    console.log(`   NEW  ${r.line_code.padEnd(8)} ${r.section.padEnd(8)} ${r.line_name}  (sort_order=${r.sort_order})`);
  }
  for (const r of skipped) {
    console.log(`   SKIP ${r.line_code.padEnd(8)} already exists in kpi_lines`);
  }

  if (toInsert.length !== expected) {
    console.log(`   ⚠ count mismatch: ${toInsert.length} new (expected ${expected})`);
  }

  const res = await insertBatch("kpi_lines", toInsert, "line_code");
  if (res.error) {
    console.error(`  WRITE FAILED: ${res.error.message}`);
    process.exit(3);
  }
  if (execute) console.log(`  ✓ wrote ${res.inserted} rows`);
  else console.log(`  (dry-run) would write ${res.previewed} rows · re-run with --execute`);
  return toInsert.length;
}

// ══════════════════════════════════════════════════════════════════
// Shared: load & parse a sheet, return period-actual values per leaf
// ══════════════════════════════════════════════════════════════════
async function loadKnownCodes() {
  const q = await s.from("kpi_lines").select("line_code");
  if (q.error) throw q.error;
  return new Set(q.data.map(r => r.line_code));
}

function loadSheetLeaves(year, sheetName, knownCodes) {
  const p = FY_BOOK.get(year);
  const g = readSheet(p, sheetName);
  const periodCols = resolvePeriodColumns(g.grid);
  const activePeriods = periodCols.map((c, i) => c ? i : null).filter(i => i != null);
  const leaves = parseSheet(g.grid, periodCols, knownCodes);
  return { grid: g.grid, periodCols, activePeriods, leaves, sheetPath: p };
}

// Build pnl_actuals rows for a (year, sheet, account_key)
// One row per (line_code, period_no) where actual is a real number.
function buildActualsRows({ year, sheetName, accountKey, leaves, periodCols, sheetPath }) {
  const bookBase = path.basename(sheetPath);
  const rows = [];
  const codeCounts = { total: 0, nonZero: 0 };
  const nowIso = new Date().toISOString();
  for (const [code, leaf] of leaves) {
    for (let n = 1; n <= PERIODS; n += 1) {
      const v = leaf.values[n];
      const col = periodCols[n];
      if (col == null) continue;
      if (v == null) continue;
      codeCounts.total += 1;
      if (v !== 0) codeCounts.nonZero += 1;
      rows.push({
        account_key: accountKey,
        fiscal_year: year,
        period_no: n,
        line_code: code,
        budget: 0,     // Kevin's brief: load actuals only; budget stays as-is
        actual: Math.round(Number(v) * 100) / 100,
        source_ref: `${bookBase}#${sheetName}!row${leaf.row}col${col}(P${n} Actual)`,
        verified_at: "2026-09-23T00:00:00+00:00",
        verified_by: "loader:fin2027_w5_2026-09-23",
      });
    }
  }
  return { rows, codeCounts };
}

// ══════════════════════════════════════════════════════════════════
// STAGE 2 · CORP load
// ══════════════════════════════════════════════════════════════════
async function stage2(yr) {
  if (yr && ![2024, 2025, 2026].includes(yr)) throw new Error("year must be 2024, 2025, or 2026");
  const years = yr ? [yr] : [2024, 2025, 2026];
  let totalRows = 0;
  for (const year of years) {
    console.log(`\n=== Stage 2 · CORP · FY${year} ===`);
    let rows = [];
    if (year === 2024) {
      // R-25: single lump per period to line 5000.0 on Kitchfix Total row 65
      const g = readSheet(FY_BOOK.get(2024), "Kitchfix Total");
      const periodCols = resolvePeriodColumns(g.grid);
      const corpRow = 65; // Kitchfix Total row 65 = 'CORP' (verified 2026-09-23)
      const bookBase = path.basename(FY_BOOK.get(2024));
      for (let n = 1; n <= PERIODS; n += 1) {
        const col = periodCols[n];
        if (col == null) continue;
        const v = g.grid[corpRow - 1]?.[col - 1];
        if (v == null) continue;
        rows.push({
          account_key: "CORP",
          fiscal_year: 2024,
          period_no: n,
          line_code: "5000.0",
          budget: 0,
          actual: Math.round(Number(v) * 100) / 100,
          source_ref: `${bookBase}#Kitchfix Total!row65col${col}(P${n} Actual)`,
          verified_at: "2026-09-23T00:00:00+00:00",
          verified_by: "loader:fin2027_w5_2026-09-23",
        });
      }
    } else {
      // FY2025, FY2026: full CORP sheet, leaf-level
      const knownCodes = await loadKnownCodes();
      const { leaves, periodCols, sheetPath } = loadSheetLeaves(year, "CORP", knownCodes);
      // Add 5004 Wages as a leaf under code 5004.0 (per R-23):
      // FY2025 row 5 col A = '5004 Wages' with no children; FY2026 same.
      // We parse it as a group row (indent 0), so it's not in `leaves`.
      // Extract its per-period actuals from Kitchfix Total row 80 chain,
      // or from CORP sheet row 5 directly for FY2026 (hard-typed), and
      // sum-per-period for FY2025 (R-24: per-period, not YTD cumulative).
      const p = FY_BOOK.get(year);
      const gCorp = readSheet(p, "CORP");
      const corpPeriodCols = resolvePeriodColumns(gCorp.grid);
      const bookBase = path.basename(p);
      const wagesRow = 5; // CORP sheet row 5 = '5004 Wages' both years
      const wagesRowLabel = gCorp.grid[wagesRow - 1]?.[0];
      if (typeof wagesRowLabel !== "string" || !wagesRowLabel.startsWith("5004")) {
        throw new Error(`FY${year} CORP row ${wagesRow} col A is ${JSON.stringify(wagesRowLabel)} - expected '5004 Wages'`);
      }
      // Verify each per-period cell is a plain number (not #REF!). R-24
      // says per-period actuals are intact; YTD column is the broken
      // one and we don't touch it.
      for (let n = 1; n <= PERIODS; n += 1) {
        const col = corpPeriodCols[n];
        if (col == null) continue;
        const v = gCorp.grid[wagesRow - 1]?.[col - 1];
        if (v == null) continue;
        if (typeof v === "string" && v.startsWith("#")) {
          console.log(`   FY${year} 5004 Wages P${n} col ${col}: SKIP (${v})`);
          continue;
        }
        if (typeof v !== "number") {
          console.log(`   FY${year} 5004 Wages P${n} col ${col}: SKIP (non-numeric: ${JSON.stringify(v)})`);
          continue;
        }
        rows.push({
          account_key: "CORP",
          fiscal_year: year,
          period_no: n,
          line_code: "5004.0",
          budget: 0,
          actual: Math.round(Number(v) * 100) / 100,
          source_ref: `${bookBase}#CORP!row${wagesRow}col${col}(P${n} Actual · R-24 per-period)`,
          verified_at: "2026-09-23T00:00:00+00:00",
          verified_by: "loader:fin2027_w5_2026-09-23",
        });
      }
      // Then the leaves parsed as normal (indent > 0)
      const built = buildActualsRows({ year, sheetName: "CORP", accountKey: "CORP", leaves, periodCols, sheetPath });
      rows = rows.concat(built.rows);
    }

    // Control total: sum of every row's actual (per year, CORP)
    const total = rows.reduce((s, r) => s + Number(r.actual), 0);
    console.log(`   FY${year} CORP rows: ${rows.length}   sum(actual) = ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const distinctCodes = new Set(rows.map(r => r.line_code));
    console.log(`   distinct line_codes: ${distinctCodes.size}  [${[...distinctCodes].sort().join(", ")}]`);

    if (execute) {
      // Chunk inserts at 500 rows
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const r = await s.from("pnl_actuals")
          .upsert(batch, { onConflict: "account_key,fiscal_year,period_no,line_code", ignoreDuplicates: false });
        if (r.error) { console.error(`FY${year} batch ${i}: ${r.error.message}`); process.exit(3); }
        inserted += batch.length;
      }
      console.log(`  ✓ FY${year} CORP wrote ${inserted} rows`);
      totalRows += inserted;
    } else {
      console.log(`  (dry-run) would write ${rows.length} rows`);
      totalRows += rows.length;
    }
  }
  return totalRows;
}

// ══════════════════════════════════════════════════════════════════
// STAGE 3 · site loads (1731 → CHI - IL, CHI → CHI - IL, DTOR → CIN - FL)
// ══════════════════════════════════════════════════════════════════
const STAGE3_SHEETS = [
  { year: 2024, sheet: "1731",        accountKey: "CHI - IL" },
  { year: 2025, sheet: "CHI",         accountKey: "CHI - IL" },
  { year: 2025, sheet: "DTOR (PFS)",  accountKey: "CIN - FL" },
];

async function stage3(yr, sf) {
  const targets = STAGE3_SHEETS.filter(t =>
    (!yr || t.year === yr) && (!sf || t.sheet === sf)
  );
  if (targets.length === 0) { console.log("no targets match filters"); return 0; }
  const knownCodes = await loadKnownCodes();
  let totalRows = 0;
  for (const t of targets) {
    console.log(`\n=== Stage 3 · FY${t.year} · sheet ${JSON.stringify(t.sheet)} → account_key ${t.accountKey} ===`);
    const { leaves, periodCols, sheetPath } = loadSheetLeaves(t.year, t.sheet, knownCodes);
    const built = buildActualsRows({ year: t.year, sheetName: t.sheet, accountKey: t.accountKey, leaves, periodCols, sheetPath });

    // Section-level breakdown for the control totals
    const kl = await s.from("kpi_lines").select("line_code, section");
    if (kl.error) { console.error(kl.error); process.exit(3); }
    const sectionOf = new Map(kl.data.map(r => [r.line_code, r.section]));
    const sums = { revenue: 0, cogs: 0, sga: 0, unknown: 0 };
    const unknownCodes = new Set();
    for (const r of built.rows) {
      const sec = sectionOf.get(r.line_code) || "unknown";
      sums[sec] = (sums[sec] || 0) + Number(r.actual);
      if (sec === "unknown") unknownCodes.add(r.line_code);
    }
    const p13 = built.rows.filter(r => r.period_no === 13).length;
    const p9  = built.rows.filter(r => r.period_no === 9).length;
    console.log(`   rows: ${built.rows.length}   distinct codes: ${leaves.size}   periods present: ${new Set(built.rows.map(r=>r.period_no)).size}`);
    console.log(`   sum revenue: ${sums.revenue.toFixed(2)}   cogs: ${sums.cogs.toFixed(2)}   sga: ${sums.sga.toFixed(2)}   unknown: ${sums.unknown.toFixed(2)}`);
    console.log(`   CM (rev - cogs - sga) = ${(sums.revenue - sums.cogs - sums.sga).toFixed(2)}`);
    if (unknownCodes.size > 0) {
      console.log(`   ⚠ unknown line codes (not in kpi_lines): ${[...unknownCodes].sort().join(", ")}`);
    }

    if (execute) {
      let inserted = 0;
      for (let i = 0; i < built.rows.length; i += 500) {
        const batch = built.rows.slice(i, i + 500);
        const r = await s.from("pnl_actuals")
          .upsert(batch, { onConflict: "account_key,fiscal_year,period_no,line_code", ignoreDuplicates: false });
        if (r.error) { console.error(`FY${t.year} ${t.sheet} batch ${i}: ${r.error.message}`); process.exit(3); }
        inserted += batch.length;
      }
      console.log(`  ✓ FY${t.year} ${t.sheet} wrote ${inserted} rows`);
      totalRows += inserted;
    } else {
      console.log(`  (dry-run) would write ${built.rows.length} rows`);
      totalRows += built.rows.length;
    }
  }
  return totalRows;
}

// ── Dispatch
if (stage === "0") await stage0();
else if (stage === "1") await stageKpiLines(STAGE1_LINES, "1", STAGE1_LINES.length);
else if (stage === "1b") await stageKpiLines(STAGE1B_LINES, "1b", STAGE1B_LINES.length);
else if (stage === "2") await stage2(yearFilter);
else if (stage === "3") await stage3(yearFilter, sheetFilter);
else {
  console.error(`unknown stage: ${stage}`);
  process.exit(2);
}
