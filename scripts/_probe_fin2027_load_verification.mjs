// scripts/_probe_fin2027_load_verification.mjs
//
// FIN-2027 W1-V · independent PG-vs-workbook load verification.
// Full two-way census + randomized 25-cell sample +
// pnl_reconciliation_exceptions verification + kpi_period_status
// verification.
//
// INDEPENDENCE RULE (governed by CC_BRIEF_FIN2027_W1V_LOAD_VERIFICATION.md
// §0): this file MUST NOT import, call, or copy any part of
// scripts/lib/pnl_load_core.mjs, scripts/load_pnl_history.mjs, or
// scripts/derive_pnl_actuals.mjs. Fresh reader.
//
//   - Period columns discovered from row 3 ("P<n>") + row 4
//     ("Actual" / "Budget") header labels, not from loader's
//     hardcoded column arithmetic.
//   - Line codes matched against the CANONICAL kpi_lines set
//     (data-driven), not by parseLineCode-style regex extraction.
//   - Account keys resolved by a structured (team, state,
//     modifier) table, not by the loader's chain of regex tests.
//   - Cell reader is a fresh implementation of the numeric /
//     formula / null trichotomy.
//
// If the workbook layout is ambiguous, this script STOPS instead
// of falling back on a loader assumption.
//
// Read-only. No writes. Counts + PASS/FAIL + labels only.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_load_verification.mjs \
//     --fy24 '<xlsx>' --fy25 '<xlsx>' --fy26 '<xlsx>'

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

// ─── CLI ─────────────────────────────────────────────────────────────
const args = { fy24: null, fy25: null, fy26: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--fy24") args.fy24 = process.argv[++i];
  else if (x === "--fy25") args.fy25 = process.argv[++i];
  else if (x === "--fy26") args.fy26 = process.argv[++i];
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
for (const key of ["fy24", "fy25", "fy26"]) {
  if (!args[key] || !existsSync(args[key])) {
    console.error(`--${key} <path> required and must exist`);
    process.exit(1);
  }
}

// ─── Independent cell reader ────────────────────────────────────────

// Numeric read - returns number if the cell holds one, null otherwise.
// Handles ExcelJS literals + formula { result } + shared-formula { result }.
// Explicit zero is a number, not null. This is a fresh implementation.
function cellNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return null;
  if (typeof v === "object") {
    const r = v.result;
    if (r === null || r === undefined) {
      if (v.formula || v.sharedFormula) return null;
      return null;
    }
    if (typeof r === "number") return r;
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

function cellText(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result !== undefined && v.result !== null) return String(v.result);
    if (v.text !== undefined && v.text !== null) return String(v.text);
  }
  return String(v);
}

// ─── Independent account resolver (structured, not regex chain) ────

// Data-driven mapping. Each row: canonical account_key + the
// tokens that must all appear in the workbook's row-1 title. The
// resolver DOES NOT use the loader's if-else regex chain.
const KNOWN_ACCOUNTS = [
  // Cincinnati Reds affiliates - two states resolve by city+state token
  { key: "CIN - AZ",    team: "Cincinnati Reds",     state: "AZ" },
  { key: "CIN - OH",    team: "Cincinnati Reds",     state: "OH" },
  { key: "CIN - KY",    team: "Louisville Bats",     state: "KY" },
  // Cardinals affiliates
  { key: "STL - FL",    team: "St. Louis Cardinals", state: "FL" },
  { key: "STL - MO",    team: "St. Louis Cardinals", state: "MO" },
  // Blue Jays affiliates
  { key: "TBJ - FL",    team: "Toronto Blue Jays",   state: "FL" },
  { key: "TBJ - NY",    team: "Toronto Blue Jays",   state: "NY" },
  // Rays
  { key: "TBR - FL",    team: "Tampa Bay Rays",      state: "FL" },
  // Rangers - three variants share state
  { key: "TXR - AZ",    team: "Texas Rangers",       state: "AZ" },
  { key: "TXR - TX - V", team: "Texas Rangers",      state: "TX", visitor: true },
  { key: "TXR - TX - H", team: "Texas Rangers",      state: "TX", visitor: false },
];

// Resolve the row-1 title to an account_key. First extract the
// 2-letter state code from the row-1 string (after a comma; the
// workbook consistently formats "..., XX"). Then match against
// KNOWN_ACCOUNTS by (team, state), plus a visitor/home tiebreak
// on the Texas Rangers Arlington TX pair.
function resolveAccountFromRow1(row1) {
  if (typeof row1 !== "string" || row1.trim().length === 0) return null;
  // State token = last uppercase 2-letter after a comma.
  const stateM = row1.match(/,\s*([A-Z]{2})\b/);
  if (!stateM) return null;
  const state = stateM[1];
  const isVisitorTab = /\bVISTOR\b|\bVisitor\b|-\s*V\s*-/i.test(row1);
  const isHomeTab = /\bHome\b|-\s*H\s*-/i.test(row1);
  for (const acct of KNOWN_ACCOUNTS) {
    if (acct.state !== state) continue;
    if (!row1.includes(acct.team)) continue;
    // Rangers Arlington disambiguation
    if (acct.key === "TXR - TX - V") { if (isVisitorTab) return acct.key; continue; }
    if (acct.key === "TXR - TX - H") { if (isVisitorTab) continue; return acct.key; }
    return acct.key;
  }
  return null;
}

// ─── Independent period-column discovery ────────────────────────────

// Walk cols 1..300 of a worksheet; find every column whose row-3
// label matches /^P(\d+)$/. Classify by row-4:
//   - Date object (or empty date-shaped text) -> plan-band budget
//     (this is the FY plan spread by period; cols 2..14 in the
//     workbook layout, row 4 is a start date like 2024-01-01)
//   - "Budget" -> details-band budget (per-period budget label)
//   - "Actual" -> details-band actual (per-period actual)
// Both plan-band and details-band budget columns are legitimate
// "period columns" per the brief's header-discovery rule. The
// loader (which the verifier does not import) reads plan-band as
// its budget source; the details-band is a second, explicitly-
// labeled workbook budget. The verifier reads BOTH and matches PG
// against EITHER, staying independent while acknowledging both
// workbook representations of period budget. If they differ per
// cell, that is a WORKBOOK-INTERNAL drift and is surfaced as its
// own finding.
function discoverPeriodColumns(ws) {
  const map = new Map();
  for (let c = 1; c <= 300; c += 1) {
    const r3Cell = ws.getRow(3).getCell(c);
    const r4Cell = ws.getRow(4).getCell(c);
    const r3 = cellText(r3Cell).trim();
    const r4Text = cellText(r4Cell).trim();
    const m = r3.match(/^P(\d+)$/);
    if (!m) continue;
    const p = Number(m[1]);
    if (!Number.isInteger(p) || p < 1 || p > 13) continue;
    let entry = map.get(p) || { actualCol: null, budgetColDetails: null, budgetColPlan: null };
    // Row-4 label classifies the P<n> column:
    //   "Actual"  -> details-band actual
    //   "Budget"  -> details-band budget
    //   "∆" or "" -> variance / spacer (ignore)
    //   anything else (date, date-string) -> plan-band budget
    // The plan-band appears once per period in the FY plan band
    // (cols 2..14 in the workbook layout); details-band appears in
    // the per-period bands starting at col 17.
    if (r4Text === "Actual") { if (entry.actualCol === null) entry.actualCol = c; }
    else if (r4Text === "Budget") { if (entry.budgetColDetails === null) entry.budgetColDetails = c; }
    else if (r4Text === "∆" || r4Text === "") { /* skip */ }
    else { if (entry.budgetColPlan === null) entry.budgetColPlan = c; }
    map.set(p, entry);
  }
  return map;
}

// ─── Data-driven line-code extractor ────────────────────────────────
// Match col A against the canonical kpi_lines codes as the FIRST
// token of the label. Different approach than the loader's parseLineCode
// (which uses a regex, then validates against kpi_lines). Here the
// canonical set drives the match.
function extractLineCode(colALabel, canonicalCodes) {
  if (typeof colALabel !== "string") return null;
  const t = colALabel.trim();
  if (t.length === 0) return null;
  if (/^total\b/i.test(t)) return null;
  // For each canonical code, check if the label starts with it
  // followed by whitespace (guarding against 3200 matching 3200.1
  // by requiring exact code + whitespace).
  //
  // Canonical codes are in a Set; iterate the Set is fine at n=34.
  for (const code of canonicalCodes) {
    if (t.startsWith(code + " ") || t.startsWith(code + "\t")) return code;
  }
  return null;
}

// ─── Supabase + kpi_lines catalog ───────────────────────────────────
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: catalog, error: catErr } = await supa.from("kpi_lines").select("line_code");
if (catErr) { console.error(catErr.message); process.exit(2); }
const KPI_LINES = new Set(catalog.map((r) => r.line_code));
if (KPI_LINES.size !== 34) {
  console.error(`kpi_lines size = ${KPI_LINES.size}, expected 34. STOP.`);
  process.exit(2);
}

// ─── Workbook loader (independent) ──────────────────────────────────
// Returns a fresh dictionary: (account_key, line_code, period_no) ->
//   { actual: number|null, budget: number|null }
// where null means the workbook cell is blank on that side.
async function loadWorkbook(pathToXlsx, fiscalYear, periodMax) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(pathToXlsx);
  const cells = new Map();                                  // key = "acct::code::p" -> { actual, budgetPlan, budgetDetails, ... }
  const perTabInfo = [];                                    // for diagnostic
  const foundAccounts = new Set();
  for (const ws of wb.worksheets) {
    const row1 = cellText(ws.getRow(1).getCell(1)).trim();
    const acctKey = resolveAccountFromRow1(row1);
    if (!acctKey) { perTabInfo.push({ tab: ws.name, row1, resolved: null, skipped: "non-portfolio" }); continue; }
    if (foundAccounts.has(acctKey)) { perTabInfo.push({ tab: ws.name, row1, resolved: acctKey, skipped: "duplicate" }); continue; }
    foundAccounts.add(acctKey);
    const cols = discoverPeriodColumns(ws);
    // Sanity: every period 1..periodMax must have actualCol AND at least one budget col.
    for (let p = 1; p <= periodMax; p += 1) {
      const entry = cols.get(p);
      if (!entry || !entry.actualCol || (!entry.budgetColPlan && !entry.budgetColDetails)) {
        console.error(`STOP: FY${fiscalYear} tab '${ws.name}' (acct ${acctKey}) missing column discovery for P${p}: entry=${JSON.stringify(entry)}`);
        process.exit(2);
      }
    }
    perTabInfo.push({ tab: ws.name, row1, resolved: acctKey, columns: cols });
    for (let r = 1; r <= 120; r += 1) {
      const labelRaw = ws.getRow(r).getCell(1).value;
      if (typeof labelRaw !== "string") continue;
      const code = extractLineCode(labelRaw, KPI_LINES);
      if (!code) continue;
      for (let p = 1; p <= periodMax; p += 1) {
        const c = cols.get(p);
        const a = cellNumeric(ws.getRow(r).getCell(c.actualCol));
        const bPlan = c.budgetColPlan ? cellNumeric(ws.getRow(r).getCell(c.budgetColPlan)) : null;
        const bDetails = c.budgetColDetails ? cellNumeric(ws.getRow(r).getCell(c.budgetColDetails)) : null;
        cells.set(`${acctKey}::${code}::${p}`, {
          actual: a,
          budgetPlan: bPlan,
          budgetDetails: bDetails,
          sourceRow: r,
          actualCol: c.actualCol,
          budgetColPlan: c.budgetColPlan,
          budgetColDetails: c.budgetColDetails,
          tab: ws.name,
        });
      }
    }
  }
  return { cells, perTabInfo, accounts: [...foundAccounts].sort() };
}

// ─── Fetch all pnl_actuals rows for a fiscal year (paginated) ─────
async function loadPgYear(fiscalYear, periodMin, periodMax) {
  const all = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("pnl_actuals")
      .select("account_key, fiscal_year, period_no, line_code, actual, budget")
      .eq("fiscal_year", fiscalYear)
      .gte("period_no", periodMin)
      .lte("period_no", periodMax)
      .order("account_key")
      .order("period_no")
      .order("line_code")
      .range(from, from + pageSize - 1);
    if (error) { console.error(error.message); process.exit(2); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ─── Tolerance ──────────────────────────────────────────────────────
const CENT = 0.005;                                          // <= half-cent = MATCH; anything above = MISMATCH

// Consider a cell "workbook has any populated data" if actual is
// non-null OR either budget candidate is non-null.
function wbAnyPopulated(wbCell) {
  return wbCell.actual !== null || wbCell.budgetPlan !== null || wbCell.budgetDetails !== null;
}
// PWZ: the loader-facing condition. Actual is null AND at least
// one budget candidate is non-null (matching the loader's
// semantic: it writes actual=0 whenever it saw any populated cell).
function wbIsPWZShape(wbCell) {
  return wbCell.actual === null && (wbCell.budgetPlan !== null || wbCell.budgetDetails !== null);
}

function classify(pgActual, pgBudget, wbCell) {
  const isPWZInvented = wbIsPWZShape(wbCell) && pgActual === 0;
  const isBothBlank = !wbAnyPopulated(wbCell);
  // Actual comparison
  let actualMatch = false;
  if (wbCell.actual === null) {
    if (isPWZInvented) actualMatch = true;                    // predicted class 1
    else if (isBothBlank) actualMatch = true;                 // handled by absent-row check upstream
    else actualMatch = (pgActual === 0);
  } else {
    actualMatch = Math.abs(wbCell.actual - pgActual) <= CENT;
  }
  // Budget comparison. PG budget must match EITHER plan-band or
  // details-band budget from the workbook. Both null OR PG matches
  // one -> MATCH. Otherwise MISMATCH.
  let budgetMatch = false;
  const bpNull = wbCell.budgetPlan === null;
  const bdNull = wbCell.budgetDetails === null;
  const pgBudgetNum = pgBudget === null || pgBudget === undefined ? null : Number(pgBudget);
  if (pgBudgetNum === null) {
    // PG budget is null -> we accept null if BOTH candidates are null too.
    budgetMatch = bpNull && bdNull;
  } else {
    // PG budget is a number -> match if it equals plan-band OR details-band.
    const okPlan = !bpNull && Math.abs(wbCell.budgetPlan - pgBudgetNum) <= CENT;
    const okDetails = !bdNull && Math.abs(wbCell.budgetDetails - pgBudgetNum) <= CENT;
    budgetMatch = okPlan || okDetails;
  }
  // Workbook-internal budget consistency: plan-band vs details-band.
  let bWorkbookConsistent = true;
  if (!bpNull && !bdNull) bWorkbookConsistent = Math.abs(wbCell.budgetPlan - wbCell.budgetDetails) <= CENT;
  else if (bpNull !== bdNull) bWorkbookConsistent = false;   // one populated, the other null - inconsistent
  return { actualMatch, budgetMatch, isPWZInvented, isBothBlank, bWorkbookConsistent };
}

// ─── Predicted-exception counts (from brief §3) ────────────────────
const PREDICTED = {
  fy24_pwz: 1110,
  fy25_pwz: 88,
  fy26_pwz: 839,
  fy24_exception_lines: 20,                                   // 5006.1 / 5006.3 / 5017.7 across account combos
};

// ─── Run Direction A + B census for one year ───────────────────────
async function censusYear(label, xlsxPath, fiscalYear, periodMax) {
  console.log("");
  console.log("═".repeat(80));
  console.log(`  ${label} · full two-way census (FY${fiscalYear} P1..P${periodMax})`);
  console.log("═".repeat(80));
  const wb = await loadWorkbook(xlsxPath, fiscalYear, periodMax);
  const pg = await loadPgYear(fiscalYear, 1, periodMax);
  console.log(`  workbook portfolio tabs resolved:  ${wb.accounts.length}   ${wb.accounts.join(", ")}`);
  console.log(`  workbook cells indexed (acct+line+period): ${wb.cells.size}`);
  console.log(`  pnl_actuals rows loaded:                   ${pg.length}`);
  console.log("");

  // Direction A: PG -> workbook
  let a_compared = 0;
  let a_matched = 0;
  let a_pwz_invented = 0;
  let a_actual_mismatch = 0;
  let a_budget_mismatch = 0;
  let a_missing_wb_cell = 0;
  let a_wb_budget_inconsistent = 0;
  const a_actual_mismatch_details = [];
  const a_budget_mismatch_details = [];
  const a_missing_wb_details = [];
  for (const row of pg) {
    a_compared += 1;
    const k = `${row.account_key}::${row.line_code}::${row.period_no}`;
    const wbCell = wb.cells.get(k);
    if (!wbCell) {
      a_missing_wb_cell += 1;
      a_missing_wb_details.push({ ...row });
      continue;
    }
    const cls = classify(row.actual, row.budget, wbCell);
    if (cls.isPWZInvented) a_pwz_invented += 1;
    if (!cls.bWorkbookConsistent) a_wb_budget_inconsistent += 1;
    if (cls.actualMatch && cls.budgetMatch) { a_matched += 1; continue; }
    if (!cls.actualMatch) a_actual_mismatch_details.push({ ...row, wbCell });
    if (!cls.budgetMatch) a_budget_mismatch_details.push({ ...row, wbCell });
    if (!cls.actualMatch) a_actual_mismatch += 1;
    if (!cls.budgetMatch) a_budget_mismatch += 1;
  }

  // Direction B: workbook -> PG
  const pgIndex = new Map();
  for (const row of pg) pgIndex.set(`${row.account_key}::${row.line_code}::${row.period_no}`, row);
  let b_compared = 0;
  let b_matched = 0;
  let b_pwz_invented = 0;
  let b_missing_pg_row = 0;
  let b_actual_mismatch = 0;
  let b_budget_mismatch = 0;
  let b_both_blank_correct_absence = 0;
  let b_both_blank_pg_row_present = 0;
  const b_missing_pg_details = [];
  const b_actual_mismatch_details = [];
  const b_budget_mismatch_details = [];
  const b_both_blank_pg_present_details = [];
  for (const [k, wbCell] of wb.cells) {
    const [acct, code, pStr] = k.split("::");
    const p = Number(pStr);
    const bothBlank = !wbAnyPopulated(wbCell);
    if (bothBlank) {
      // Contract-compliant absence: PG should have NO row for this cell.
      if (pgIndex.has(k)) {
        b_both_blank_pg_row_present += 1;
        b_both_blank_pg_present_details.push({ acct, code, p, pgRow: pgIndex.get(k) });
      } else {
        b_both_blank_correct_absence += 1;
      }
      continue;
    }
    b_compared += 1;
    const pgRow = pgIndex.get(k);
    if (!pgRow) {
      b_missing_pg_row += 1;
      b_missing_pg_details.push({ acct, code, p, wbCell });
      continue;
    }
    const cls = classify(pgRow.actual, pgRow.budget, wbCell);
    if (cls.isPWZInvented) b_pwz_invented += 1;
    if (cls.actualMatch && cls.budgetMatch) { b_matched += 1; continue; }
    if (!cls.actualMatch) b_actual_mismatch_details.push({ acct, code, p, pgActual: pgRow.actual, pgBudget: pgRow.budget, wbCell });
    if (!cls.budgetMatch) b_budget_mismatch_details.push({ acct, code, p, pgActual: pgRow.actual, pgBudget: pgRow.budget, wbCell });
    if (!cls.actualMatch) b_actual_mismatch += 1;
    if (!cls.budgetMatch) b_budget_mismatch += 1;
  }

  console.log(`  Direction A · PG -> workbook:`);
  console.log(`    rows compared:                     ${a_compared}`);
  console.log(`    matched (both actual + budget):    ${a_matched}`);
  console.log(`    present-with-zero-invented (F-16): ${a_pwz_invented}`);
  console.log(`    actual mismatches (non-PWZ):       ${a_actual_mismatch}`);
  console.log(`    budget mismatches:                 ${a_budget_mismatch}`);
  console.log(`    PG rows with NO workbook cell:     ${a_missing_wb_cell}`);
  console.log(`    workbook plan-vs-details budget inconsistent: ${a_wb_budget_inconsistent}`);
  console.log("");
  console.log(`  Direction B · workbook -> PG:`);
  console.log(`    cells compared (workbook non-blank): ${b_compared}`);
  console.log(`    matched:                             ${b_matched}`);
  console.log(`    present-with-zero-invented (F-16):   ${b_pwz_invented}`);
  console.log(`    actual mismatches (non-PWZ):         ${b_actual_mismatch}`);
  console.log(`    budget mismatches:                   ${b_budget_mismatch}`);
  console.log(`    workbook cells with NO PG row:       ${b_missing_pg_row}`);
  console.log(`    both-blank cells (correct absence):  ${b_both_blank_correct_absence}`);
  console.log(`    both-blank cells BUT PG row present: ${b_both_blank_pg_row_present}`);
  console.log("");

  // Unexpected findings (mismatches that fall outside the 4 predicted classes).
  const unexpectedFindings = [];
  const nonPWZActualMismatchesA = a_actual_mismatch_details.filter((d) => !wbIsPWZShape(d.wbCell));
  if (nonPWZActualMismatchesA.length > 0) unexpectedFindings.push(`Direction A: ${nonPWZActualMismatchesA.length} actual mismatches outside PWZ class`);
  if (a_budget_mismatch > 0) unexpectedFindings.push(`Direction A: ${a_budget_mismatch} budget mismatches (PG matches NEITHER plan-band nor details-band)`);
  if (a_missing_wb_cell > 0) unexpectedFindings.push(`Direction A: ${a_missing_wb_cell} PG rows with no workbook cell`);
  if (b_missing_pg_row > 0) unexpectedFindings.push(`Direction B: ${b_missing_pg_row} workbook cells with no PG row`);
  const nonPWZActualMismatchesB = b_actual_mismatch_details.filter((d) => !wbIsPWZShape(d.wbCell));
  if (nonPWZActualMismatchesB.length > 0) unexpectedFindings.push(`Direction B: ${nonPWZActualMismatchesB.length} actual mismatches outside PWZ class`);
  if (b_budget_mismatch > 0) unexpectedFindings.push(`Direction B: ${b_budget_mismatch} budget mismatches (PG matches NEITHER plan-band nor details-band)`);
  if (b_both_blank_pg_row_present > 0) unexpectedFindings.push(`Direction B: ${b_both_blank_pg_row_present} both-blank cells with PG row present`);

  if (unexpectedFindings.length > 0) {
    console.log(`  ⚠ UNEXPECTED FINDINGS (outside predicted classes):`);
    for (const f of unexpectedFindings) console.log(`    - ${f}`);
    console.log("");
    console.log(`  sample details (up to 10 per category):`);
    for (const d of nonPWZActualMismatchesA.slice(0, 10)) {
      console.log(`    A actual-mismatch  ${d.account_key} ${d.line_code} P${d.period_no}  PG.actual=${d.actual} wb.actual=${d.wbCell.actual}`);
    }
    for (const d of a_budget_mismatch_details.slice(0, 10)) {
      console.log(`    A budget-mismatch  ${d.account_key} ${d.line_code} P${d.period_no}  PG.budget=${d.budget} wb.plan=${d.wbCell.budgetPlan} wb.details=${d.wbCell.budgetDetails}`);
    }
    for (const d of a_missing_wb_details.slice(0, 10)) {
      console.log(`    A missing-wb-cell  ${d.account_key} ${d.line_code} P${d.period_no}`);
    }
    for (const d of b_missing_pg_details.slice(0, 10)) {
      console.log(`    B missing-pg-row   ${d.acct} ${d.code} P${d.p}  wb.actual=${d.wbCell.actual} wb.plan=${d.wbCell.budgetPlan} wb.details=${d.wbCell.budgetDetails}`);
    }
    for (const d of nonPWZActualMismatchesB.slice(0, 10)) {
      console.log(`    B actual-mismatch  ${d.acct} ${d.code} P${d.p}  PG.actual=${d.pgActual} wb.actual=${d.wbCell.actual}`);
    }
    for (const d of b_budget_mismatch_details.slice(0, 10)) {
      console.log(`    B budget-mismatch  ${d.acct} ${d.code} P${d.p}  PG.budget=${d.pgBudget} wb.plan=${d.wbCell.budgetPlan} wb.details=${d.wbCell.budgetDetails}`);
    }
    for (const d of b_both_blank_pg_present_details.slice(0, 10)) {
      console.log(`    B both-blank-pg-present  ${d.acct} ${d.code} P${d.p}  PG.actual=${d.pgRow.actual} PG.budget=${d.pgRow.budget}`);
    }
  } else {
    console.log(`  no unexpected findings (all mismatches fit predicted classes)`);
  }

  return {
    label, fiscalYear, periodMax,
    a_compared, a_matched, a_pwz_invented, a_actual_mismatch, a_budget_mismatch, a_missing_wb_cell, a_wb_budget_inconsistent,
    b_compared, b_matched, b_pwz_invented, b_missing_pg_row, b_actual_mismatch, b_budget_mismatch, b_both_blank_correct_absence, b_both_blank_pg_row_present,
    wb, pg,
    unexpectedFindings,
  };
}

// ─── Predicted-exception recap ─────────────────────────────────────
console.log("═".repeat(80));
console.log("  FIN-2027 W1-V · load verification");
console.log("═".repeat(80));
console.log("");
console.log("Predicted-exception classes (from CC_BRIEF_FIN2027_W1V_LOAD_VERIFICATION.md §3):");
console.log("  1. Blank actual + populated budget in workbook -> PG holds actual=0 (F-16).");
console.log(`     Predicted counts: FY2024=${PREDICTED.fy24_pwz}, FY2025=${PREDICTED.fy25_pwz}, FY2026 P1..P9=${PREDICTED.fy26_pwz}.`);
console.log("  2. Both blank in workbook -> no PG row. Contract-compliant absence.");
console.log("  3. Rounding differences at sub-cent are expected; anything above <= 0.005 is a MATCH.");
console.log("  4. FY2024 pnl_reconciliation_exceptions cover 20 (account, line) tuples on 5006.1 / 5006.3 / 5017.7.");
console.log("     These drift on the YTD-vs-sum ANCHOR, not on individual period cells.");
console.log("     Per-period comparison on those lines should still MATCH.");
console.log("");

// ─── Run all three years ────────────────────────────────────────────
const results = [];
results.push(await censusYear("FY2024", args.fy24, 2024, 13));
results.push(await censusYear("FY2025", args.fy25, 2025, 13));
results.push(await censusYear("FY2026 P1..P9", args.fy26, 2026, 9));

// ─── PWZ-count verification against predicted ─────────────────────
console.log("");
console.log("═".repeat(80));
console.log("  Present-with-zero-invented count verification (predicted vs actual)");
console.log("═".repeat(80));
console.log("");
const pwzChecks = [
  { year: "FY2024",      actual: results[0].a_pwz_invented, expected: PREDICTED.fy24_pwz },
  { year: "FY2025",      actual: results[1].a_pwz_invented, expected: PREDICTED.fy25_pwz },
  { year: "FY2026 P1..P9", actual: results[2].a_pwz_invented, expected: PREDICTED.fy26_pwz },
];
let pwzAllMatch = true;
for (const c of pwzChecks) {
  const ok = c.actual === c.expected;
  if (!ok) pwzAllMatch = false;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.year}: predicted ${c.expected}, actual ${c.actual}`);
}
console.log("");

// ─── Verify pnl_reconciliation_exceptions rows ────────────────────
console.log("═".repeat(80));
console.log("  pnl_reconciliation_exceptions verification (20 FY2024 rows)");
console.log("═".repeat(80));
console.log("");
const { data: exs, error: exsErr } = await supa.from("pnl_reconciliation_exceptions").select("*").eq("fiscal_year", 2024).order("account_key").order("line_code");
if (exsErr) { console.error(exsErr.message); process.exit(2); }
console.log(`  exception rows in DB: ${exs.length}`);

// Cross-check each exception against the workbook. anchor_a should
// equal our independent P1..P13 actual sum for that line; anchor_b
// should equal the workbook's YTD-P13 cell value.
const fy24Result = results[0];
const wb24 = fy24Result.wb;
// We need the RAW workbook YTD-P13 cell values, which discoverPeriodColumns
// does not directly expose. Re-read the workbook YTD columns by header
// discovery: row 3 = "YTD P13", row 4 = "Actual".
const wb24Xl = new ExcelJS.Workbook();
await wb24Xl.xlsx.readFile(args.fy24);
function discoverYtdP13ActualCol(ws) {
  for (let c = 1; c <= 300; c += 1) {
    const r3 = cellText(ws.getRow(3).getCell(c)).trim();
    const r4 = cellText(ws.getRow(4).getCell(c)).trim();
    if (r3 === "YTD P13" && r4 === "Actual") return c;
  }
  return null;
}
let exsChecked = 0, exsAOk = 0, exsBOk = 0;
const exsDetails = [];
for (const ex of exs) {
  exsChecked += 1;
  const tabInfo = wb24.perTabInfo.find((t) => t.resolved === ex.account_key);
  if (!tabInfo) { exsDetails.push({ ...ex, aCheck: "no tab", bCheck: "no tab" }); continue; }
  const ws = wb24Xl.getWorksheet(tabInfo.tab);
  const ytdP13Col = discoverYtdP13ActualCol(ws);
  if (!ytdP13Col) { exsDetails.push({ ...ex, aCheck: "no YTD col", bCheck: "no YTD col" }); continue; }
  // Find the row for this line_code in the tab.
  let rowNo = 0;
  for (let r = 1; r <= 120; r += 1) {
    const lbl = ws.getRow(r).getCell(1).value;
    if (typeof lbl !== "string") continue;
    if (extractLineCode(lbl, KPI_LINES) === ex.line_code) { rowNo = r; break; }
  }
  if (rowNo === 0) { exsDetails.push({ ...ex, aCheck: "no line row", bCheck: "no line row" }); continue; }
  // Sum P1..P13 actuals from the details-band cols we already have via loadWorkbook.
  let sumActual = 0;
  let anyActual = false;
  for (let p = 1; p <= 13; p += 1) {
    const cell = wb24.cells.get(`${ex.account_key}::${ex.line_code}::${p}`);
    if (cell && cell.actual !== null) { sumActual += cell.actual; anyActual = true; }
  }
  const wbYtd = cellNumeric(ws.getRow(rowNo).getCell(ytdP13Col));
  const aOk = Math.abs(Number(ex.anchor_a) - sumActual) <= 0.01;
  const bOk = Math.abs(Number(ex.anchor_b) - (wbYtd ?? 0)) <= 0.01;
  if (aOk) exsAOk += 1;
  if (bOk) exsBOk += 1;
  if (!aOk || !bOk) exsDetails.push({ acct: ex.account_key, code: ex.line_code, ex_a: ex.anchor_a, ex_b: ex.anchor_b, ind_sum: sumActual, ind_ytd: wbYtd, aOk, bOk });
}
console.log(`  anchor_a agrees with independent P1..P13 actual sum: ${exsAOk} / ${exsChecked}`);
console.log(`  anchor_b agrees with independent YTD-P13 actual cell: ${exsBOk} / ${exsChecked}`);
if (exsDetails.length > 0) {
  console.log(`  ⚠ mismatches:`);
  for (const d of exsDetails.slice(0, 20)) {
    console.log(`    ${JSON.stringify(d)}`);
  }
}
console.log("");

// ─── Verify kpi_period_status ──────────────────────────────────────
console.log("═".repeat(80));
console.log("  kpi_period_status verification");
console.log("═".repeat(80));
console.log("");
const { data: kps, error: kpsErr } = await supa
  .from("kpi_period_status")
  .select("fiscal_year, period_no, verified_by, source_ref")
  .in("fiscal_year", [2024, 2025, 2026])
  .order("fiscal_year")
  .order("period_no");
if (kpsErr) { console.error(kpsErr.message); process.exit(2); }
const kpsExpected = {
  2024: { count: 13, verifiedByPrefix: "loader:pnl_history_fy2024_" },
  2025: { count: 13, verifiedByPrefix: "loader:pnl_history_fy2025_" },
  2026: { count: 9,  verifiedByPrefix: "loader:pnl_actuals_p9_",       periodMax: 9 },
};
let kpsAllOk = true;
for (const fy of [2024, 2025, 2026]) {
  const yearRows = kps.filter((r) => r.fiscal_year === fy);
  const expected = kpsExpected[fy];
  const eligibleRows = fy === 2026
    ? yearRows.filter((r) => r.period_no <= expected.periodMax)
    : yearRows;
  const verifiedRows = eligibleRows.filter((r) => r.verified_by && r.verified_by.startsWith(expected.verifiedByPrefix));
  const ok = verifiedRows.length === expected.count;
  if (!ok) kpsAllOk = false;
  console.log(`  ${ok ? "PASS" : "FAIL"}  FY${fy}: ${verifiedRows.length} / ${expected.count} periods verified by ${expected.verifiedByPrefix}*`);
}
console.log("");

// ─── Random 25-cell sample (seeded, reproducible) ─────────────────
console.log("═".repeat(80));
console.log("  Random 25-cell sample (stratified: >=2 per account, spread across years / periods / lines)");
console.log("═".repeat(80));
console.log("");
// Seed: derive from clock, print for reproducibility. Use SHA-256 of
// the seed to build a deterministic PRNG state.
const seedInt = Date.now();
console.log(`  seed (Date.now() ms): ${seedInt}`);
console.log("");
function seedRng(seed) {
  let state = createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i >= state.length - 4) { state = createHash("sha256").update(state).digest(); i = 0; }
    const v = state.readUInt32BE(i); i += 4;
    return v / 0xffffffff;
  };
}
const rng = seedRng(seedInt);

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build a candidate list: for each year, every PG row that has a
// workbook mapping.
const candidates = [];
for (const res of results) {
  for (const pgRow of res.pg) {
    const k = `${pgRow.account_key}::${pgRow.line_code}::${pgRow.period_no}`;
    const wbCell = res.wb.cells.get(k);
    if (!wbCell) continue;
    candidates.push({
      account: pgRow.account_key,
      fiscal_year: pgRow.fiscal_year,
      period_no: pgRow.period_no,
      line_code: pgRow.line_code,
      pgActual: pgRow.actual,
      pgBudget: pgRow.budget,
      wbActual: wbCell.actual,
      wbBudgetPlan: wbCell.budgetPlan,
      wbBudgetDetails: wbCell.budgetDetails,
      tab: wbCell.tab,
      sourceRow: wbCell.sourceRow,
      actualCol: wbCell.actualCol,
      budgetColPlan: wbCell.budgetColPlan,
      budgetColDetails: wbCell.budgetColDetails,
    });
  }
}

// Stratify by account: at least 2 per account, then random fill.
const byAcct = new Map();
for (const c of candidates) {
  if (!byAcct.has(c.account)) byAcct.set(c.account, []);
  byAcct.get(c.account).push(c);
}
for (const arr of byAcct.values()) shuffleInPlace(arr, rng);
const sample = [];
for (const arr of byAcct.values()) sample.push(...arr.slice(0, 2));
// Fill to 25 with random picks from the remaining pool.
const remaining = candidates.slice();
shuffleInPlace(remaining, rng);
const sampleKeys = new Set(sample.map((c) => `${c.account}::${c.line_code}::${c.fiscal_year}::${c.period_no}`));
for (const c of remaining) {
  if (sample.length >= 25) break;
  const k = `${c.account}::${c.line_code}::${c.fiscal_year}::${c.period_no}`;
  if (sampleKeys.has(k)) continue;
  sample.push(c);
  sampleKeys.add(k);
}
sample.sort((a, b) => a.fiscal_year - b.fiscal_year || a.account.localeCompare(b.account) || a.period_no - b.period_no || a.line_code.localeCompare(b.line_code));

function excelColLabel(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

console.log("  #   acct           fy   P   line     tab                       actual_cell  wb_actual        pg_actual        act?  wb_bud_plan   wb_bud_det    pg_budget        bud?");
console.log("  --  -------------  ---  --  -------  ------------------------  -----------  ---------------  ---------------  ----  ------------  ------------  ---------------  ----");
let sampleMatches = 0;
for (let i = 0; i < sample.length; i += 1) {
  const s = sample[i];
  const cellAddr = `${s.tab}!${excelColLabel(s.actualCol)}${s.sourceRow}`;
  const aStr = s.wbActual === null ? "(blank)" : s.wbActual.toFixed(2);
  const pgAStr = s.pgActual === null ? "null" : s.pgActual.toFixed(2);
  const bPlanStr = s.wbBudgetPlan === null ? "(blank)" : s.wbBudgetPlan.toFixed(2);
  const bDetStr = s.wbBudgetDetails === null ? "(blank)" : s.wbBudgetDetails.toFixed(2);
  const pgBStr = s.pgBudget === null ? "null" : Number(s.pgBudget).toFixed(2);
  const wbCellShim = { actual: s.wbActual, budgetPlan: s.wbBudgetPlan, budgetDetails: s.wbBudgetDetails };
  const cls = classify(s.pgActual, s.pgBudget, wbCellShim);
  const actualOk = cls.actualMatch;
  const budgetOk = cls.budgetMatch;
  if (actualOk && budgetOk) sampleMatches += 1;
  console.log(`  ${String(i + 1).padStart(2)}  ${s.account.padEnd(13)}  ${s.fiscal_year}  ${String(s.period_no).padStart(2)}  ${s.line_code.padEnd(7)}  ${s.tab.slice(0, 24).padEnd(24)}  ${cellAddr.slice(0, 11).padEnd(11)}  ${aStr.padStart(15)}  ${pgAStr.padStart(15)}  ${actualOk ? "PASS" : "FAIL"}  ${bPlanStr.padStart(12)}  ${bDetStr.padStart(12)}  ${pgBStr.padStart(15)}  ${budgetOk ? "PASS" : "FAIL"}`);
}
console.log("");
console.log(`  Sample matches (both actual + budget): ${sampleMatches} / ${sample.length}`);
console.log("");

// ─── Final PASS/FAIL summary ───────────────────────────────────────
console.log("═".repeat(80));
console.log("  W1-V VERIFICATION SUMMARY");
console.log("═".repeat(80));
console.log("");
console.log(`  Predicted-exception counts:`);
for (const c of pwzChecks) {
  console.log(`    ${c.year}: ${c.actual === c.expected ? "PASS" : "FAIL"} (predicted ${c.expected}, actual ${c.actual})`);
}
console.log("");
console.log(`  Per-year census:`);
for (const r of results) {
  // "Unexpected" = mismatches outside the 4 predicted classes.
  const overallOk = r.unexpectedFindings.length === 0;
  console.log(`    ${r.label}: ${overallOk ? "PASS" : "FAIL"}  (A actual-mm=${r.a_actual_mismatch}, A budget-mm=${r.a_budget_mismatch}, A no-wb=${r.a_missing_wb_cell}, B actual-mm=${r.b_actual_mismatch}, B budget-mm=${r.b_budget_mismatch}, B no-pg=${r.b_missing_pg_row}, B blank-with-pg=${r.b_both_blank_pg_row_present})`);
}
console.log("");
console.log(`  pnl_reconciliation_exceptions: A anchor ${exsAOk}/${exsChecked}, B anchor ${exsBOk}/${exsChecked}`);
console.log(`  kpi_period_status: ${kpsAllOk ? "PASS" : "FAIL"}`);
console.log(`  25-cell random sample: ${sampleMatches}/25`);
console.log("");
const finalPass = pwzAllMatch && results.every((r) => r.unexpectedFindings.length === 0) && exsAOk === exsChecked && exsBOk === exsChecked && kpsAllOk && sampleMatches === sample.length;
console.log(finalPass ? "W1-V VERIFICATION · PASS" : "W1-V VERIFICATION · FAIL (see mismatches above)");
process.exit(finalPass ? 0 : 2);
