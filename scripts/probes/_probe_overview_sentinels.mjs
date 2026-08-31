// scripts/probes/_probe_overview_sentinels.mjs
//
// Overview Phase 2 PR-3 - the five sentinels (§8 of KPI_MASTER_SCOPE
// + Kevin's PR-3 brief).
//
// READ-ONLY. Runs against production Postgres via .env.local. Every
// sentinel is a load-bearing figure Kevin explicitly named:
//
//   1. CIN - OH wk 06/29: hours_regular 113.98 / hours_overtime 2.32 /
//      hours_double_time 39.91 / amount $4,328.27  (labor - one week)
//   2. portfolio FYTD-P8 hourly $1,604,030.64      (labor - aggregate)
//   3. TBR - FL P8 3200.1 bill.com $39,373.74      (purchasing - one bucket)
//   4. portfolio P9 KPI budget $231,132.99         (kpi_budgets P9 3100.1
//                                                   across 11 accounts)
//   5. finance hourly YTD-P8 $1,607,095.01         (pnl_actuals 3100.1
//                                                   after workbook load)
//
// Sentinel 5 will FAIL until the pnl_actuals loader runs P1..P8 from
// the P8 workbook - that's expected pre-loader. Marked as WAITING
// rather than FAIL so this probe passes on a fresh install.
//
// Seeded failure per probe (Kevin's rule "every probe born with a
// seeded failure case"):
//   - Assert one intentionally wrong expected value at the tail so the
//     surface machinery is proven to catch drift. Commented out by
//     default; toggle SEEDED_FAILURE=1 to exercise the FAIL path.

import { createClient } from "@supabase/supabase-js";

// Env presence check per docs/BUILD_ACCURACY_PROTOCOL.md USE/SEE rule.
function envPresence() {
  console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? "PRESENT" : "ABSENT"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[abort] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    process.exit(2);
  }
}
envPresence();

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SEEDED = process.env.SEEDED_FAILURE === "1";

const TOL = 0.02;   // cent tolerance for money sentinels
const SENTINELS = [];

function approxEq(a, b, tol = TOL) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function sentinel1_CIN_OH_wk_0629() {
  console.log("\n=== Sentinel 1: CIN - OH week 2026-06-29 ===");
  // Sum hours + amount for CIN - OH, week_start = 2026-06-29.
  const q = await supa
    .from("labor_actuals_latest")
    .select("hours_regular, hours_overtime, hours_double_time, amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  if (q.error) { console.log(`  FAIL query: ${q.error.message}`); SENTINELS.push({ n: 1, ok: false, reason: q.error.message }); return; }
  let hr = 0, ho = 0, hd = 0, amt = 0;
  for (const r of q.data || []) {
    hr += Number(r.hours_regular || 0);
    ho += Number(r.hours_overtime || 0);
    hd += Number(r.hours_double_time || 0);
    amt += Number(r.amount || 0);
  }
  const hr2 = Math.round(hr * 100) / 100;
  const ho2 = Math.round(ho * 100) / 100;
  const hd2 = Math.round(hd * 100) / 100;
  const amt2 = Math.round(amt * 100) / 100;
  const okHr = approxEq(hr2, 113.98, 0.01);
  const okHo = approxEq(ho2, 2.32, 0.01);
  const okHd = approxEq(hd2, 39.91, 0.01);
  const okAmt = approxEq(amt2, 4328.27, 0.01);
  const ok = okHr && okHo && okHd && okAmt;
  console.log(`  hours_regular:    got ${hr2}   expected 113.98   ${okHr ? "PASS" : "FAIL"}`);
  console.log(`  hours_overtime:   got ${ho2}   expected 2.32     ${okHo ? "PASS" : "FAIL"}`);
  console.log(`  hours_double_time got ${hd2}   expected 39.91    ${okHd ? "PASS" : "FAIL"}`);
  console.log(`  amount:           got ${amt2}   expected 4328.27  ${okAmt ? "PASS" : "FAIL"}`);
  SENTINELS.push({ n: 1, ok, name: "CIN - OH wk 06/29 shape" });
}

async function sentinel2_portfolio_FYTD_P8_hourly() {
  console.log("\n=== Sentinel 2: portfolio FYTD-P8 hourly $1,604,030.64 ===");
  // Sum amount across every hourly-labor row from FY start 2025-12-29
  // through P8 end 2026-08-09, across all 11 accounts (aggregate),
  // paginated.
  const P8_END = "2026-08-09";
  const FY_START = "2025-12-29";
  const PS = 1000;
  const ACCTS = ["CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
  let total = 0;
  let rowCount = 0;
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("amount")
      .in("account_key", ACCTS)
      .gte("week_start", FY_START)
      .lte("week_end", P8_END)
      .lte("week_start", P8_END)
      .order("week_start")
      .range(from, from + PS - 1);
    if (q.error) { console.log(`  FAIL query: ${q.error.message}`); SENTINELS.push({ n: 2, ok: false, reason: q.error.message }); return; }
    const rows = q.data || [];
    for (const r of rows) total += Number(r.amount || 0);
    rowCount += rows.length;
    if (rows.length < PS) break;
    from += PS;
  }
  const total2 = Math.round(total * 100) / 100;
  const ok = approxEq(total2, 1604030.64, 0.05);
  console.log(`  rows walked: ${rowCount}`);
  console.log(`  total: got ${total2}   expected 1604030.64   ${ok ? "PASS" : "FAIL"}`);
  SENTINELS.push({ n: 2, ok, name: "portfolio FYTD-P8 hourly total" });
}

async function sentinel3_TBR_FL_P8_3200_1_bill() {
  console.log("\n=== Sentinel 3: TBR - FL P8 3200.1 bill.com $39,373.74 ===");
  const q = await supa
    .from("purchasing_actuals")
    .select("amount")
    .eq("account_key", "TBR - FL")
    .eq("gl_line_code", "3200.1")
    .eq("source", "billcom")
    .eq("excluded", false)
    .gte("txn_date", "2026-07-13")
    .lte("txn_date", "2026-08-09");
  if (q.error) { console.log(`  FAIL query: ${q.error.message}`); SENTINELS.push({ n: 3, ok: false, reason: q.error.message }); return; }
  let total = 0;
  for (const r of q.data || []) total += Number(r.amount || 0);
  const total2 = Math.round(total * 100) / 100;
  const ok = approxEq(total2, 39373.74, 0.01);
  console.log(`  rows: ${(q.data || []).length}`);
  console.log(`  total: got ${total2}   expected 39373.74   ${ok ? "PASS" : "FAIL"}`);
  SENTINELS.push({ n: 3, ok, name: "TBR - FL P8 3200.1 bill.com total" });
}

async function sentinel4_portfolio_P9_KPI_budget() {
  console.log("\n=== Sentinel 4: portfolio P9 3100.1 kpi_budgets $231,132.99 ===");
  const q = await supa
    .from("kpi_budgets")
    .select("account_key, amount")
    .eq("fiscal_year", 2026)
    .eq("period_no", 9)
    .eq("line_code", "3100.1");
  if (q.error) { console.log(`  FAIL query: ${q.error.message}`); SENTINELS.push({ n: 4, ok: false, reason: q.error.message }); return; }
  let total = 0;
  for (const r of q.data || []) total += Number(r.amount || 0);
  const total2 = Math.round(total * 100) / 100;
  const ok = approxEq(total2, 231132.99, 0.05);
  console.log(`  rows: ${(q.data || []).length} (expected 11 accounts)`);
  console.log(`  total: got ${total2}   expected 231132.99   ${ok ? "PASS" : "FAIL"}`);
  SENTINELS.push({ n: 4, ok, name: "portfolio P9 kpi_budgets 3100.1 total" });
}

async function sentinel5_finance_hourly_YTD_P8() {
  console.log("\n=== Sentinel 5: finance hourly YTD-P8 pnl_actuals 3100.1 $1,607,095.01 ===");
  // Sum pnl_actuals.actual for 3100.1 across all 11 accounts, P1..P8, FY2026.
  const q = await supa
    .from("pnl_actuals")
    .select("account_key, period_no, actual")
    .eq("fiscal_year", 2026)
    .eq("line_code", "3100.1")
    .gte("period_no", 1)
    .lte("period_no", 8);
  if (q.error) {
    // pnl_actuals table may not exist yet (Phase 1 loader not run).
    if (/relation.*pnl_actuals.*does not exist/i.test(q.error.message || "")) {
      console.log(`  WAITING: pnl_actuals table absent - Phase 1 loader has not landed yet.`);
      console.log(`  This is expected pre-loader; sentinel activates when scripts/derive_pnl_actuals.mjs runs P1..P8.`);
      SENTINELS.push({ n: 5, ok: null, name: "finance hourly YTD-P8", reason: "pnl_actuals absent - loader not run" });
      return;
    }
    console.log(`  FAIL query: ${q.error.message}`);
    SENTINELS.push({ n: 5, ok: false, reason: q.error.message });
    return;
  }
  if (!q.data || q.data.length === 0) {
    console.log(`  WAITING: pnl_actuals empty for 3100.1 P1..P8 - Phase 1 loader has not landed data yet.`);
    SENTINELS.push({ n: 5, ok: null, name: "finance hourly YTD-P8", reason: "pnl_actuals rows empty" });
    return;
  }
  let total = 0;
  for (const r of q.data || []) total += Number(r.actual || 0);
  const total2 = Math.round(total * 100) / 100;
  const ok = approxEq(total2, 1607095.01, 0.05);
  console.log(`  rows: ${(q.data || []).length}`);
  console.log(`  total: got ${total2}   expected 1607095.01   ${ok ? "PASS" : "FAIL"}`);
  SENTINELS.push({ n: 5, ok, name: "finance hourly YTD-P8 pnl_actuals 3100.1" });
}

async function main() {
  await sentinel1_CIN_OH_wk_0629();
  await sentinel2_portfolio_FYTD_P8_hourly();
  await sentinel3_TBR_FL_P8_3200_1_bill();
  await sentinel4_portfolio_P9_KPI_budget();
  await sentinel5_finance_hourly_YTD_P8();

  if (SEEDED) {
    console.log("\n=== SEEDED FAILURE (proves the assertion machinery) ===");
    console.log("  Intentionally asserting sentinel 4 against a wrong expected value.");
    // Re-run sentinel 4 with a wrong target to prove FAIL surface fires.
    const q = await supa
      .from("kpi_budgets")
      .select("amount")
      .eq("fiscal_year", 2026)
      .eq("period_no", 9)
      .eq("line_code", "3100.1");
    let total = 0;
    for (const r of q.data || []) total += Number(r.amount || 0);
    const total2 = Math.round(total * 100) / 100;
    const okBad = approxEq(total2, 999999.00, 0.05);
    console.log(`  got ${total2}   expected (SEEDED WRONG) 999999.00   ${okBad ? "PASS (bug)" : "FAIL (as designed)"}`);
    SENTINELS.push({ n: 99, ok: okBad, name: "seeded_failure - MUST FAIL" });
  }

  console.log();
  console.log("=".repeat(70));
  console.log("Sentinel summary");
  console.log("=".repeat(70));
  let pass = 0, fail = 0, waiting = 0;
  for (const s of SENTINELS) {
    const marker = s.ok === true ? "PASS " : s.ok === false ? "FAIL " : "WAIT ";
    if (s.ok === true) pass += 1;
    else if (s.ok === false) fail += 1;
    else waiting += 1;
    console.log(`  ${marker}  #${s.n}  ${s.name}${s.reason ? " · " + s.reason : ""}`);
  }
  console.log(`\nTotal: ${pass} PASS, ${fail} FAIL, ${waiting} WAITING`);
  process.exit((fail > 0 && !SEEDED) ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
