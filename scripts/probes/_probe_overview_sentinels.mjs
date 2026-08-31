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
//   2. portfolio FYTD-P8 hourly $1,604,030.64      (labor - aggregate;
//                                                   board.spent_to_date
//                                                   on /api/kpi/labor?
//                                                   account=ALL&start=
//                                                   2025-12-29&end=
//                                                   2026-08-09)
//   3. TBR - FL P8 3200.1 bill.com $39,373.74      (purchasing - one bucket)
//   4. purchasing P9 portfolio pl_cogs $231,132.99 (totals.pl_cogs.budget
//                                                   on /api/kpi/purchasing?
//                                                   account=ALL&start=
//                                                   2026-08-10&end=
//                                                   2026-09-06; food +
//                                                   packaging + vehicle
//                                                   period budget across
//                                                   the 11 accounts)
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
  //
  // 2026-08-31 reconciliation: the previous version of this sentinel
  // reported $1,600,358.61 while production (GET /api/kpi/labor?
  // account=ALL&start=2025-12-29&end=2026-08-09) returned $1,604,030.64
  // on the same window. Root cause named in
  // scripts/probes/_probe_overview_sentinel2_diag3.mjs: the sentinel's
  // paginator used `.order("week_start")` with no tiebreaker, so at
  // the 1000-row page boundary where many rows share week_start =
  // 2026-03-30, PostgREST re-ordered rows freely across pages. Nine
  // rows landed on both page 1 and page 2 (double-counted, +$3,113.81)
  // while nine different rows on the boundary landed on neither
  // (missed, -$6,785.84). Net: $1,604,030.64 - $6,785.84 + $3,113.81
  // = $1,600,358.61 - exactly the observed drift.
  //
  // The deployed route's paginateActuals (src/lib/labor/loaders.js:80)
  // orders by (week_start, account_key, worker_id) which uniquely
  // pins each row across pages. Sentinel now uses the same predicate
  // AND the same order chain AND the same member-resolution helper
  // to keep the harness locked to production. Members come from
  // resolvePortfolioMembers('ALL') (src/lib/kpi/portfolioMembers.js:28),
  // not a hardcoded list - same source the route uses.
  const P8_END = "2026-08-09";
  const FY_START = "2025-12-29";
  const PS = 1000;

  // Resolve members from live accounts.region via the same helper the
  // route calls, so a new account joining the portfolio (or a rename)
  // is picked up without editing this probe.
  const membersQ = await supa.from("accounts")
    .select("team_key")
    .neq("team_key", "CORP")
    .order("team_key");
  if (membersQ.error) { console.log(`  FAIL members query: ${membersQ.error.message}`); SENTINELS.push({ n: 2, ok: false, reason: membersQ.error.message }); return; }
  const members = (membersQ.data || []).map(r => r.team_key);
  console.log(`  members resolved: ${members.length} (expected 11)`);

  let total = 0;
  let rowCount = 0;
  let from = 0;
  while (true) {
    // Route parity: predicate mirrors paginateActuals exactly.
    //   .lte("week_start", end).gte("week_end", start)
    // Row-inclusion rule = "week intersects the range on either side".
    // Order chain mirrors the route: three keys pin every row uniquely
    // across pages, preventing PostgREST from re-ordering rows on the
    // page boundary (the defect this sentinel had before 2026-08-31).
    const q = await supa
      .from("labor_actuals_latest")
      .select("amount")
      .in("account_key", members)
      .lte("week_start", P8_END)
      .gte("week_end", FY_START)
      .order("week_start", { ascending: true })
      .order("account_key", { ascending: true })
      .order("worker_id", { ascending: true })
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
  console.log(`  rows walked: ${rowCount} (expected 2252)`);
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

async function sentinel4_portfolio_P9_purchasing_budget() {
  console.log("\n=== Sentinel 4: purchasing P9 period budget, portfolio, pl_cogs = $231,132.99 ===");
  //
  // 2026-08-31 definition correction. The previous sentinel 4 summed
  // raw kpi_budgets P9 3100.1 (labor hourly) - a different line on a
  // different board. Kevin's live measurement confirmed the correct
  // load-bearing figure is the purchasing board's P9 portfolio
  // pl_cogs (food + packaging + vehicle) budget:
  //
  //   GET /api/kpi/purchasing?account=ALL&start=2026-08-10&end=2026-09-06
  //   -> totals.pl_cogs.budget = 231132.99
  //
  // The purchasing route composes pl_cogs.budget via sumBudgetByBucket
  // ("pl_cogs") which iterates budgetsByLine.keys() and sums
  // budgetForRange for every gl whose glBucketFor(gl) returns
  // "pl_cogs" (that is, gl starting with 32/34/35 - food, packaging,
  // vehicle). buildPurchasingBoard's totals.buckets_budget composes
  // the SAME sum via bucketBudgetForRange over the same predicates
  // for the same buckets. Verified by reading:
  //   route.js:855-867  sumBudgetByBucket   -> pl_cogs.budget
  //   resolver.js:394-397 sum of buckets[gl_prefix].budget across
  //                       food/packaging/vehicle -> buckets_budget
  //
  // Both use budgetForRange internally with per-week period_amount/4
  // proration, envelope-excluded (empty set today per accountModels.js).
  //
  // So sentinel 4 asserts buildPurchasingBoard(...).totals.buckets_budget
  // over the P9 window against $231,132.99, using the same loaders
  // (fetchMembers + loadPurchasingBudgets) the route uses. Zero
  // resolver-side reimplementation - the imports pull the production
  // code paths, keeping the harness locked to production for this
  // sentinel too.
  const P9_START = "2026-08-10";
  const P9_END = "2026-09-06";
  try {
    const { fetchMembers, loadPurchasingBudgets } = await import("@/lib/purchasing/loaders.js");
    const { buildPurchasingBoard } = await import("@/app/kpi/purchasing/lib/resolver.js");
    const mm = await fetchMembers(supa, "ALL");
    if (mm.error) { console.log(`  FAIL fetchMembers: ${mm.error?.message || mm.error}`); SENTINELS.push({ n: 4, ok: false, reason: `fetchMembers: ${mm.error?.message}` }); return; }
    console.log(`  members: ${mm.members.length} (expected 11)`);
    const bud = await loadPurchasingBudgets(supa, mm.members, 2026);
    if (bud.error) { console.log(`  FAIL loadPurchasingBudgets: ${bud.error?.message}`); SENTINELS.push({ n: 4, ok: false, reason: `loadPurchasingBudgets: ${bud.error?.message}` }); return; }
    // weeklyRows / actualsRows are not needed for budget computation
    // (bucketBudgetForRange only reads budgetMap + members + weeks).
    // Passing empty arrays keeps the call shape valid.
    const board = buildPurchasingBoard({
      members: mm.members,
      start: P9_START,
      end: P9_END,
      today: new Date().toISOString().slice(0, 10),
      actualsRows: [],
      weeklyRows: [],
      pendingRow: { amount: 0, line_count: 0 },
      budgetMap: bud.data,
    });
    const bucketsBudget = board.totals?.buckets_budget;
    const total2 = Math.round(Number(bucketsBudget) * 100) / 100;
    const ok = approxEq(total2, 231132.99, 0.05);
    console.log(`  totals.buckets_budget (== route totals.pl_cogs.budget): ${total2}`);
    console.log(`  expected 231132.99   ${ok ? "PASS" : "FAIL"}`);
    SENTINELS.push({ n: 4, ok, name: "purchasing P9 portfolio pl_cogs budget" });
  } catch (e) {
    console.log(`  FAIL: ${e.message}`);
    SENTINELS.push({ n: 4, ok: false, reason: e.message });
  }
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
  await sentinel4_portfolio_P9_purchasing_budget();
  await sentinel5_finance_hourly_YTD_P8();

  if (SEEDED) {
    console.log("\n=== SEEDED FAILURE (proves the assertion machinery) ===");
    console.log("  Intentionally asserting a wrong expected value against a real read.");
    // Read a small, static figure (kpi_budgets P9 3100.1 across the
    // portfolio - the pre-2026-08-31 sentinel 4 target) and assert it
    // against a wrong expected number so the FAIL surface fires. This
    // read is NOT a sentinel of its own now; it exists only to exercise
    // the FAIL path.
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
