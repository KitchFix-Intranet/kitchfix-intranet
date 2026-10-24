// scripts/_probe_pnl_recon_db_v2.mjs
// Corrected version of _probe_pnl_recon_db.mjs. Prior audit filtered
// hourly actuals by row.period_no, but the 1,206 pre-floor rows on
// labor_actuals_latest with week_source = 'rippling_report' carry
// period_no = NULL. Number(null) = 0, which failed the "1 <= p <= 13"
// filter and dropped all 1,206 rows silently.
//
// Fix: derive period via periodOf(week_start) - same helper the salary
// query already uses. Salary reconciled across P1-P4 because it never
// touched period_no; hourly did not for the same reason.
//
// Also emit a diagnostic count: N rows with period_no NULL, their
// week_start range, and their aggregate amount. That is the anchor for
// the correction claim.

import { createClient } from "@supabase/supabase-js";
import { periodOf, periodStartISO, periodEndISO } from "../../src/app/kpi/labor/lib/periods.js";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error("env ABSENT"); process.exit(1); }
console.error("SUPABASE: PRESENT");
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const FY = 2026;

// 1) Accounts (same universe as prior audit).
const acctQ = await supa
  .from("kpi_budgets")
  .select("account_key")
  .eq("fiscal_year", FY)
  .in("line_code", ["3100.1", "3100.2"]);
if (acctQ.error) { console.error("acctQ:", acctQ.error.message); process.exit(1); }
const accounts = [...new Set((acctQ.data || []).map(r => r.account_key))].sort();
console.error(`ACCOUNTS: ${accounts.length}`);

// 2) Budgets (unchanged from prior probe).
async function loadBudgets(line_code) {
  const q = await supa.from("kpi_budgets")
    .select("account_key, period_no, amount")
    .eq("fiscal_year", FY)
    .eq("line_code", line_code)
    .in("account_key", accounts);
  if (q.error) throw new Error(`budgets ${line_code}: ${q.error.message}`);
  const map = new Map();
  for (const r of q.data || []) {
    const inner = map.get(r.account_key) || new Map();
    inner.set(Number(r.period_no), Number(r.amount));
    map.set(r.account_key, inner);
  }
  return map;
}
const budH = await loadBudgets("3100.1");
const budS = await loadBudgets("3100.2");

// 3) DIAGNOSTIC - pre-floor null-period_no rows. Verify Kevin's count.
async function nullPeriodDiag() {
  const PS = 1000;
  let from = 0;
  let nullRows = 0;
  let nullTotal = 0;
  const nullAccts = new Set();
  let minWk = null, maxWk = null;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, week_start, amount, period_no, week_source")
      .eq("fiscal_year", FY)
      .in("account_key", accounts)
      .is("period_no", null)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`nullDiag: ${q.error.message}`);
    for (const r of q.data || []) {
      nullRows += 1;
      nullTotal += Number(r.amount || 0);
      nullAccts.add(r.account_key);
      if (!minWk || r.week_start < minWk) minWk = r.week_start;
      if (!maxWk || r.week_start > maxWk) maxWk = r.week_start;
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return { rows: nullRows, total: Math.round(nullTotal * 100) / 100, accounts: nullAccts.size, weeks: { min: minWk, max: maxWk } };
}
const diag = await nullPeriodDiag();
console.error(`NULL period_no diag: ${JSON.stringify(diag)}`);

// 4) CORRECTED hourly actuals - derive period from week_start.
async function loadHourlyActualsCorrected() {
  const PS = 1000;
  const totals = new Map();  // acct -> period -> sum
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, week_start, amount")
      .eq("fiscal_year", FY)
      .in("account_key", accounts)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_actuals_latest: ${q.error.message}`);
    for (const r of q.data || []) {
      // Derive period from week_start - same helper the salary query
      // uses. Row-level period_no is unreliable (null on rippling_report
      // rows).
      const p = periodOf(r.week_start);
      if (p == null || p < 1 || p > 13) continue;
      const inner = totals.get(r.account_key) || new Map();
      inner.set(p, (inner.get(p) || 0) + Number(r.amount || 0));
      totals.set(r.account_key, inner);
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return totals;
}
const actH = await loadHourlyActualsCorrected();

// 5) Salary actuals (unchanged - already correct).
async function loadSalaryActuals() {
  const PS = 1000;
  const totals = new Map();
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_salary_actuals")
      .select("account_key, week_start, amount")
      .in("account_key", accounts)
      .gte("week_start", "2025-12-29")
      .lte("week_start", "2026-12-27")
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_salary_actuals: ${q.error.message}`);
    for (const r of q.data || []) {
      const p = periodOf(r.week_start);
      if (p == null || p < 1 || p > 13) continue;
      const inner = totals.get(r.account_key) || new Map();
      inner.set(p, (inner.get(p) || 0) + Number(r.amount || 0));
      totals.set(r.account_key, inner);
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return totals;
}
const actS = await loadSalaryActuals();

function n(v) { return v == null ? null : Math.round(v * 100) / 100; }
const out = { __diag: diag, accounts: {} };
for (const acct of accounts) {
  const perPeriod = {};
  for (let p = 1; p <= 8; p++) {
    perPeriod[`P${p}`] = {
      period_start: periodStartISO(p),
      period_end:   periodEndISO(p),
      hourly_budget: n(budH.get(acct)?.get(p) ?? null),
      hourly_actual: n(actH.get(acct)?.get(p) ?? null),
      salary_budget: n(budS.get(acct)?.get(p) ?? null),
      salary_actual: n(actS.get(acct)?.get(p) ?? null),
    };
  }
  out.accounts[acct] = perPeriod;
}
console.log(JSON.stringify(out, null, 2));
