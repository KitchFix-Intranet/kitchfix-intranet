// scripts/probes/_probe_pnl_actuals_sentinels.mjs
//
// Overview Phase 1 sentinel probe. COMMITTED (this is a load-bearing
// regression net, not a one-off).
//
// Two assertions - both must pass for a green board.
//
//   S1  portfolio pnl_actuals 3100.1 YTD-P8 sum = $1,607,095.01
//       (Kevin's outside-data figure from Sebastian's P8 workbook,
//        per KPI_MASTER_SCOPE v4 §2 sentinels + audit #900 finding.
//        Tolerance $1.00 for rounding.)
//
//   S2  for each of the 4 fee accounts (CIN - OH, STL - FL, STL - MO,
//       TXR - TX - H), the sum of kpi_budgets 2400.1 per-period rows
//       equals the sum of workbook 2400.1 per-period BUDGET across
//       P1..P8, within $1.00.  Confirms fee-recognition schedule is
//       intact - the Q9 cross-check the audit called BLOCKED without
//       the workbook.
//
// Seeded failure case (Kevin's rule: every probe born with a seeded
// failure):
//   To see the probe fire, edit the expected-sentinel constant on
//   line 33 (SENTINEL_3100_1_YTD_P8_EXPECTED) to a wrong value like
//   1000000.00, or introduce a wrong workbook 2400.1 budget value in
//   the kpi_budgets read.  The probe will exit non-zero with a named
//   assertion.  Restore the value to make it PASS again.
//
// Usage:
//   node --env-file=.env.local scripts/probes/_probe_pnl_actuals_sentinels.mjs
//   node --env-file=.env.local scripts/probes/_probe_pnl_actuals_sentinels.mjs \
//     --workbook '~/Downloads/Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx'
//
// Exit codes:
//   0  both assertions PASS
//   1  configuration error (missing env, missing workbook)
//   2  data-side FAIL (assertion missed)

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

const SENTINEL_3100_1_YTD_P8_EXPECTED = 1607095.01;
const SENTINEL_TOLERANCE = 1.00;          // S1 tolerance (pnl_actuals carries cents; workbook to the cent).
const S2_PER_PERIOD_TOLERANCE = 1.00;     // S2 per-period tolerance. Workbook budget column is rounded to whole dollars; kpi_budgets carries cents. A drift < $1 per period is workbook rounding, not real drift.
const FISCAL_YEAR = 2026;
const LAST_PERIOD = 8;

// Fee-account tab-to-key and their 2400.1 row map (verified against
// the P8 workbook by scripts/_probe_pnl_workbook_labels.mjs 2026-08-31).
const FEE_ACCOUNT_TAB_MAP = {
  "CIN-OH":   { key: "CIN - OH",     row: 25 },
  "STL-FL":   { key: "STL - FL",     row: 25 },
  "STL-MO":   { key: "STL - MO",     row: 25 },
  "TXR-HOME": { key: "TXR - TX - H", row: 25 },
  // TXR - TX - V is a direct-sales account (§4.6, R-3, R-11); its
  // workbook 2400.1 line is $0 and it is intentionally excluded from
  // the fee-recognition assertion.  Documented, not silently dropped.
};

const DEFAULT_WORKBOOK_PATH = path.join(
  os.homedir(),
  "Downloads",
  "Budget vs Actual (SLT) (2026) P8 (8.20.26)B.xlsx",
);

// ─── CLI ────────────────────────────────────────────────────────────
const args = { workbook: DEFAULT_WORKBOOK_PATH };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--workbook")            args.workbook = process.argv[++i];
  else if (x.startsWith("--workbook=")) args.workbook = x.slice(11);
  else { console.error(`unknown arg: ${x}`); process.exit(1); }
}
const workbookPath = args.workbook.startsWith("~/")
  ? path.join(os.homedir(), args.workbook.slice(2))
  : args.workbook;
if (!existsSync(workbookPath)) {
  console.error(`workbook not found: ${workbookPath}`);
  console.error(`  the S2 fee-recognition check requires the workbook (out-of-band).`);
  console.error(`  pass --workbook <path> if it lives elsewhere.`);
  process.exit(1);
}

console.log(`_probe_pnl_actuals_sentinels`);
console.log(`  workbook: ${workbookPath}`);
console.log("");

// ─── Env ────────────────────────────────────────────────────────────
console.log(`SUPABASE_URL:              ${process.env.SUPABASE_URL              ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
if (!process.env.SUPABASE_URL) { console.error("SUPABASE_URL required"); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
console.log("");

// ─── Helpers ────────────────────────────────────────────────────────
function readNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result != null) return typeof v.result === "number" ? v.result : Number(v.result) || 0;
    if (v.formula) return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return Math.round(n * 100) / 100; }

// Column offsets (same math as derive_pnl_actuals.mjs).
function periodBudgetCol(periodNo) { return 2 + (periodNo - 1); }

// ─── S1: portfolio pnl_actuals 3100.1 YTD-P8 sum ────────────────────
console.log(`─── S1: portfolio pnl_actuals 3100.1 YTD-P${LAST_PERIOD} sum ───`);
{
  const q = await supa
    .from("pnl_actuals")
    .select("actual")
    .eq("line_code", "3100.1")
    .eq("fiscal_year", FISCAL_YEAR)
    .gte("period_no", 1)
    .lte("period_no", LAST_PERIOD);
  if (q.error) {
    console.error(`  read failed: ${q.error.message}`);
    console.error(`  this probe assumes pnl_actuals is loaded; run derive_pnl_actuals.mjs first.`);
    process.exit(2);
  }
  const sum = round2((q.data || []).reduce((s, r) => s + Number(r.actual), 0));
  const delta = round2(sum - SENTINEL_3100_1_YTD_P8_EXPECTED);
  const pass = Math.abs(delta) < SENTINEL_TOLERANCE;
  console.log(`  loaded 3100.1 YTD-P${LAST_PERIOD} sum: $${sum.toFixed(2)}`);
  console.log(`  expected outside-data:      $${SENTINEL_3100_1_YTD_P8_EXPECTED.toFixed(2)}`);
  console.log(`  delta:                      $${delta.toFixed(2)}`);
  console.log(`  status: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) {
    console.error(`  S1 FAIL: portfolio 3100.1 YTD-P${LAST_PERIOD} sum diverged from expected sentinel.`);
    console.error(`  possible causes:`);
    console.error(`   - pnl_actuals not yet loaded (run derive_pnl_actuals.mjs)`);
    console.error(`   - loader parsed a wrong Actual column offset`);
    console.error(`   - workbook column layout drifted since P8 (verify via _probe_pnl_workbook_sentinel)`);
    console.error(`   - upstream P&L number changed`);
    process.exit(2);
  }
}
console.log("");

// ─── S2: fee-account 2400.1 kpi_budgets per-period vs workbook per-period budget ───
console.log(`─── S2: fee-account 2400.1 kpi_budgets vs workbook per-period budget P1..P${LAST_PERIOD} ───`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(workbookPath);

let s2Fail = false;
for (const [tab, meta] of Object.entries(FEE_ACCOUNT_TAB_MAP)) {
  const ws = wb.getWorksheet(tab);
  if (!ws) { console.error(`  ${tab}: SHEET MISSING`); s2Fail = true; continue; }
  const workbookRow = ws.getRow(meta.row);

  // Workbook per-period budget - simple period-budget cols 2..14.
  const wbByPeriod = [];
  for (let p = 1; p <= LAST_PERIOD; p += 1) {
    wbByPeriod.push({ period_no: p, amount: round2(readNumeric(workbookRow.getCell(periodBudgetCol(p))) ?? 0) });
  }

  // kpi_budgets per-period 2400.1 for this account (P1..P8).
  const q = await supa
    .from("kpi_budgets")
    .select("period_no, amount")
    .eq("account_key", meta.key)
    .eq("line_code", "2400.1")
    .eq("fiscal_year", FISCAL_YEAR)
    .gte("period_no", 1)
    .lte("period_no", LAST_PERIOD)
    .order("period_no");
  if (q.error) {
    console.error(`  ${meta.key}: read failed: ${q.error.message}`);
    s2Fail = true;
    continue;
  }
  const kbByPeriod = new Map((q.data || []).map(r => [r.period_no, Number(r.amount)]));

  // Assert PER PERIOD, not just per sum.  The workbook budget column
  // is rounded to whole dollars; kpi_budgets carries cents.  Summing
  // 8 rounded-to-whole values against 8 rounded-to-cents values can
  // drift by a few dollars from pure rounding.  Per-period comparison
  // makes rounding-only vs real drift distinguishable.
  const perPeriodDrift = [];
  let maxAbsDelta = 0;
  for (const w of wbByPeriod) {
    const kb = round2(kbByPeriod.get(w.period_no) ?? 0);
    const d = round2(kb - w.amount);
    perPeriodDrift.push({ period_no: w.period_no, kb, wb: w.amount, delta: d });
    if (Math.abs(d) > maxAbsDelta) maxAbsDelta = Math.abs(d);
  }
  const pass = maxAbsDelta < S2_PER_PERIOD_TOLERANCE;
  const kbSum = round2([...kbByPeriod.values()].reduce((s, x) => s + x, 0));
  const wbSum = round2(wbByPeriod.reduce((s, r) => s + r.amount, 0));
  const sumDelta = round2(kbSum - wbSum);
  console.log(`  ${meta.key.padEnd(15)} kpi=$${kbSum.toFixed(2).padStart(12)}  wb=$${wbSum.toFixed(2).padStart(12)}  sum-delta=$${sumDelta.toFixed(2).padStart(7)}  max-per-period-delta=$${maxAbsDelta.toFixed(2).padStart(6)}  ${pass ? "PASS" : "FAIL"}`);
  if (!pass) {
    for (const d of perPeriodDrift) {
      if (Math.abs(d.delta) >= S2_PER_PERIOD_TOLERANCE) {
        console.log(`      P${d.period_no}: kpi=$${d.kb.toFixed(2)}  wb=$${d.wb.toFixed(2)}  delta=$${d.delta.toFixed(2)}`);
      }
    }
    s2Fail = true;
  }
}
if (s2Fail) {
  console.error(`  S2 FAIL: at least one fee-account 2400.1 recognition-schedule drift.`);
  console.error(`  possible causes:`);
  console.error(`   - kpi_budgets 2400.1 rows drifted from the workbook budget column`);
  console.error(`   - fee-account recognition-schedule renegotiated (Sebastian to confirm)`);
  console.error(`   - workbook cell offset changed (verify via _probe_pnl_workbook_labels)`);
  process.exit(2);
}
console.log("");

console.log("BOTH SENTINELS PASS");
process.exit(0);
