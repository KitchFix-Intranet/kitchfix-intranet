// PR 2 live audit - Section B (portfolio budget) + Section A (weeks_in_range).
//
// Enumerates:
//   (1) members list for ALL
//   (2) kpi_budgets coverage matrix for FY2026 purchasing lines,
//       by (line_code x account_key x period_no)
//   (3) periodOf() coverage across the 34 weeks in FYTD range
//   (4) V6_ENVELOPE_ACCOUNTS (PURCHASING_ENVELOPE_EXCLUSIONS) contents
//   (5) prorate double-count check (page.js weeksInPeriod: 4 hardcoded)
//   (6) INDEPENDENT computation of what the portfolio FYTD budget should
//       equal, then diff against $516,131.51 that the board renders
//
// No mutations. Read-only.

import { createClient } from "@supabase/supabase-js";

// ---- Env preflight (per prompt: never read .env; probe via process.env) ---
const missing = [];
if (process.env.SUPABASE_URL === undefined) missing.push("SUPABASE_URL");
if (process.env.SUPABASE_SERVICE_ROLE_KEY === undefined) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (missing.length) {
  console.error("ENV PREFLIGHT FAIL: missing", missing.join(", "));
  process.exit(2);
}
console.log("ENV PREFLIGHT OK: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY present");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- Copy of periods.js primitives (no import at runtime; script self-contained) ---
const FY_START_ISO = "2025-12-29";
const MS_PER_DAY = 86400000;
const DAYS_PER_PERIOD = 28;

function parseISO(iso) {
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function periodOf(weekStartISO) {
  const d = parseISO(weekStartISO);
  const fy = parseISO(FY_START_ISO);
  if (!d || !fy) return null;
  const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
  if (p < 1 || p > 13) return null;
  return p;
}
function weekStartsInRange(rangeStartISO, rangeEndISO) {
  const rs = parseISO(rangeStartISO);
  const re = parseISO(rangeEndISO);
  const fy = parseISO(FY_START_ISO);
  if (!rs || !re || !fy || rs > re) return [];
  const rsMs = rs.getTime();
  const reMs = re.getTime();
  const fyMs = fy.getTime();
  const idxStart = Math.max(0, Math.floor((rsMs - 6 * MS_PER_DAY - fyMs) / (7 * MS_PER_DAY)));
  const out = [];
  for (let i = idxStart; ; i += 1) {
    const wStartMs = fyMs + i * 7 * MS_PER_DAY;
    if (wStartMs > reMs) break;
    const wEndMs = wStartMs + 6 * MS_PER_DAY;
    if (wEndMs >= rsMs) out.push(new Date(wStartMs).toISOString().slice(0, 10));
  }
  return out;
}

// Envelope-exclusion: named empty concept (accountModels.js:114)
const V6_ENVELOPE_ACCOUNTS = new Set([]);

// Fixed inputs for the owner-reviewed range
const START = "2025-12-29";
const END = "2026-08-24";
const TODAY = END; // per prompt spec, board rendered with today=2026-08-24
const FY = 2026;

async function main() {
  const rangeWeeks = weekStartsInRange(START, END);
  const weeksInRange = rangeWeeks.length;
  console.log("\n=== INPUT ===");
  console.log(`range: ${START} .. ${END}`);
  console.log(`weeks_in_range (computed): ${weeksInRange}`);

  // Elapsed frac
  const startD = parseISO(START);
  const endD = parseISO(END);
  const todayD = parseISO(TODAY);
  let elapsedFrac = 1.0;
  if (endD > todayD) {
    const totalDays = Math.max(1, Math.floor((endD - startD) / 86400000) + 1);
    const doneDays = Math.max(0, Math.floor((todayD - startD) / 86400000) + 1);
    elapsedFrac = Math.min(1.0, doneDays / totalDays);
  }
  console.log(`elapsed_frac (computed): ${elapsedFrac.toFixed(4)}`);

  // ---- (1) members for ALL ---
  const membersQ = await supa
    .from("accounts")
    .select("team_key, region")
    .neq("team_key", "CORP")
    .order("team_key");
  if (membersQ.error) {
    console.error("members query failed:", membersQ.error);
    process.exit(1);
  }
  const membersAll = (membersQ.data || []).map(r => r.team_key);
  console.log("\n=== (1) MEMBERS for ALL ===");
  console.log(`count: ${membersAll.length}`);
  for (const m of membersAll) console.log(`  ${m}`);

  const membersTBRFL = ["TBR - FL"];

  // ---- (2) kpi_budgets coverage matrix ---
  const budgetsQ = await supa
    .from("kpi_budgets")
    .select("account_key, line_code, period_no, amount")
    .eq("fiscal_year", FY)
    .in("account_key", membersAll)
    .neq("line_code", "3100.1")
    .neq("line_code", "3100.2");
  if (budgetsQ.error) {
    console.error("budgets query failed:", budgetsQ.error);
    process.exit(1);
  }
  const rows = budgetsQ.data || [];
  console.log("\n=== (2) kpi_budgets rows (FY2026 purchasing, ALL members) ===");
  console.log(`total rows: ${rows.length}`);

  // Group and print matrix
  // Key: line_code -> account_key -> period_no -> amount
  const byLine = new Map();
  for (const r of rows) {
    const gl = String(r.line_code);
    const acct = String(r.account_key);
    if (!byLine.has(gl)) byLine.set(gl, new Map());
    if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
    byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
  }
  const glLines = [...byLine.keys()].sort();
  console.log(`distinct line_codes with any purchasing budget: ${glLines.length}`);
  for (const gl of glLines) console.log(`  ${gl}`);

  // Coverage matrix count per (line_code x account_key), showing #periods present
  console.log("\n=== (2a) coverage matrix (# periods per line_code per account) ===");
  console.log("line_code / account / periods_present / periods_missing");
  const missingSlots = [];
  for (const gl of glLines) {
    const perLine = byLine.get(gl);
    for (const acct of membersAll) {
      const perAcct = perLine.get(acct);
      const present = perAcct ? [...perAcct.keys()].sort((a,b)=>a-b) : [];
      const missing = [];
      for (let p = 1; p <= 13; p++) if (!present.includes(p)) missing.push(p);
      if (present.length === 0) {
        // Fully absent - most likely-legitimate case (line does not apply)
        // Only report absent-fully for lines that at least one account carries
        continue;
      }
      if (missing.length > 0) {
        console.log(`  ${gl} / ${acct} / present=${present.join(",")} / missing=${missing.join(",")}`);
        for (const p of missing) missingSlots.push({ gl, acct, p });
      }
    }
  }
  if (missingSlots.length === 0) {
    console.log("  (no partial-coverage slots)");
  }

  // ---- (3) periodOf across the 34 weeks in range ---
  console.log("\n=== (3) periodOf() across weeks in range ===");
  let inFY = 0, outFY = 0;
  const outFyWeeks = [];
  for (const w of rangeWeeks) {
    const p = periodOf(w);
    if (p == null) { outFY++; outFyWeeks.push(w); }
    else inFY++;
  }
  console.log(`in-FY weeks: ${inFY}`);
  console.log(`out-of-FY weeks (periodOf==null): ${outFY}`);
  if (outFyWeeks.length) console.log(`  out-of-FY samples: ${outFyWeeks.slice(0,5).join(",")}`);

  // ---- (4) envelope-skipped accounts ---
  console.log("\n=== (4) V6_ENVELOPE_ACCOUNTS ===");
  const excluded = [...V6_ENVELOPE_ACCOUNTS];
  console.log(`envelope-excluded members: [${excluded.join(", ")}]  (empty = no accounts skipped)`);

  // ---- (5) prorate double-count check ---
  console.log("\n=== (5) prorate double-count check ===");
  console.log("route.js:410 budgetForRange uses '/ 4' (period_amount / 4 per fiscal week in range)");
  console.log("page.js:267 + :283 passes weeksInPeriod: 4 to weeklyTargets()");
  console.log("weeklyTargets uses budget/weeksInPeriod for `original` weekly target");
  console.log("BUDGET SIDE: prorated inside route.budgetForRange - that /4 is CORRECT");
  console.log("PAGE SIDE:   weeklyTargets is target = kpiBud/4 (weekly slice of the RANGE budget)");
  console.log("For FYTD 34-week range: budget.by_gl_line_code amount is FYTD-scale (34/4 weeks x per-period-amount)");
  console.log("Then weeklyTargets divides that FYTD budget by 4 to get 'weekly target'.");
  console.log("=> This makes 'weekly target' == FYTD_budget/4 instead of FYTD_budget/34.");
  console.log("   NOT a double-prorate of the BUDGET total. IS a wrong-denominator for TARGET.");

  // ---- (6) Independent portfolio FYTD budget ---
  console.log("\n=== (6) INDEPENDENT portfolio FYTD budget computation ===");
  // Method A: replicate route.budgetForRange exactly for ALL, sum every gl_line_code
  //          restricted to the 3200/3400/3500 KPI-line prefixes (that is what the
  //          board's Period card header total uses via kpiBudget()).
  function budgetForRangeRepro({ byLine, glLineCode, members, weeksLocal }) {
    const perLine = byLine.get(glLineCode);
    if (!perLine) return 0;
    let total = 0;
    for (const w of weeksLocal) {
      const p = periodOf(w);
      if (p == null) continue;
      for (const m of members) {
        if (V6_ENVELOPE_ACCOUNTS.has(m)) continue;
        const byAcct = perLine.get(m);
        if (!byAcct) continue;
        const amt = byAcct.get(p);
        if (amt == null) continue;
        total += amt / 4;
      }
    }
    return Math.round(total * 100) / 100;
  }

  const isKpiLine = (gl) => gl && (gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500"));

  // route.budgetForRange for ALL, sum over all gl_line_codes
  let allBudgetAll = 0;
  let allBudgetKpi = 0;
  const perLinePerAll = [];
  for (const gl of glLines) {
    const b = budgetForRangeRepro({ byLine, glLineCode: gl, members: membersAll, weeksLocal: rangeWeeks });
    perLinePerAll.push({ gl, amount: b });
    allBudgetAll += b;
    if (isKpiLine(gl)) allBudgetKpi += b;
  }
  console.log(`ALL / all-lines budget (route method): $${allBudgetAll.toFixed(2)}`);
  console.log(`ALL / kpi-line budget only (3200+3400+3500, board Period-card hero): $${allBudgetKpi.toFixed(2)}`);

  // TBR - FL for comparison
  let tbrBudgetAll = 0;
  let tbrBudgetKpi = 0;
  for (const gl of glLines) {
    const b = budgetForRangeRepro({ byLine, glLineCode: gl, members: membersTBRFL, weeksLocal: rangeWeeks });
    tbrBudgetAll += b;
    if (isKpiLine(gl)) tbrBudgetKpi += b;
  }
  console.log(`TBR - FL / all-lines budget: $${tbrBudgetAll.toFixed(2)}`);
  console.log(`TBR - FL / kpi-line budget only: $${tbrBudgetKpi.toFixed(2)}`);

  // Sanity: is aggregate < single member?
  console.log("\n=== (6a) MONOTONICITY CHECK ===");
  console.log(`ALL all-lines budget vs TBR - FL all-lines: $${allBudgetAll.toFixed(2)} vs $${tbrBudgetAll.toFixed(2)}`);
  console.log(`ALL kpi-only vs TBR - FL kpi-only:          $${allBudgetKpi.toFixed(2)} vs $${tbrBudgetKpi.toFixed(2)}`);
  console.log(`  (aggregate MUST be >= any single member for the same lines)`);

  // Method B: independent - sum kpi_budgets directly by (period_no in range) using full-period
  // amounts, then divide the *pro-rata days* for boundary periods when the range doesn't cover
  // a full period. In FYTD 12/29 -> 08/24, the range clean-boundaries P1..P9 (P9 ends 08/23),
  // and includes ONE day of P9's last week? Let me compute:
  // P1 start = 2025-12-29, each period = 28 days. P9 end = 2025-12-29 + 9*28 - 1 = 252 days later.
  // = 2026-09-06 - 1 day = 2026-09-05. Actually let's just compute.
  function periodStartLocal(p) {
    const fy = parseISO(FY_START_ISO);
    const dt = new Date(fy.getTime() + (p - 1) * DAYS_PER_PERIOD * MS_PER_DAY);
    return dt.toISOString().slice(0, 10);
  }
  function periodEndLocal(p) {
    const fy = parseISO(FY_START_ISO);
    const dt = new Date(fy.getTime() + (p * DAYS_PER_PERIOD - 1) * MS_PER_DAY);
    return dt.toISOString().slice(0, 10);
  }
  console.log("\n=== (6b) periods included in FYTD range (via periodOf on week_start) ===");
  const periodsHit = new Map();
  for (const w of rangeWeeks) {
    const p = periodOf(w);
    if (p == null) continue;
    periodsHit.set(p, (periodsHit.get(p) || 0) + 1);
  }
  for (const [p, n] of [...periodsHit.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log(`  P${p}: ${n} week(s) in range   [${periodStartLocal(p)} .. ${periodEndLocal(p)}]`);
  }

  // Method B: independent - sum full period_amount for every period fully contained,
  // prorate boundary periods by weeks-in-range / 4.
  let methodBAll = 0;
  let methodBKpi = 0;
  for (const gl of glLines) {
    for (const acct of membersAll) {
      if (V6_ENVELOPE_ACCOUNTS.has(acct)) continue;
      const perAcct = byLine.get(gl)?.get(acct);
      if (!perAcct) continue;
      for (const [p, weeksInThisPeriod] of periodsHit.entries()) {
        const amt = perAcct.get(p);
        if (amt == null) continue;
        const prorate = weeksInThisPeriod / 4;
        methodBAll += amt * prorate;
        if (isKpiLine(gl)) methodBKpi += amt * prorate;
      }
    }
  }
  methodBAll = Math.round(methodBAll * 100) / 100;
  methodBKpi = Math.round(methodBKpi * 100) / 100;
  console.log("\n=== (6c) Method B (period-x-weeks-in-range/4 prorate, all periods hit) ===");
  console.log(`ALL / all-lines Method B: $${methodBAll.toFixed(2)}`);
  console.log(`ALL / kpi-line Method B:  $${methodBKpi.toFixed(2)}`);
  console.log(`Method A vs B (all-lines): ${allBudgetAll.toFixed(2)} vs ${methodBAll.toFixed(2)}`);
  console.log(`Method A vs B (kpi-only):  ${allBudgetKpi.toFixed(2)} vs ${methodBKpi.toFixed(2)}`);

  // ---- (6d) Delta from board figure ---
  const BOARD_ALL_BUDGET = 516131.51;
  console.log("\n=== (6d) DELTA from board's $516,131.51 ===");
  console.log(`board ALL budget: $${BOARD_ALL_BUDGET.toFixed(2)}`);
  console.log(`route kpi-only (Method A): $${allBudgetKpi.toFixed(2)}   delta $${(allBudgetKpi - BOARD_ALL_BUDGET).toFixed(2)}`);
  console.log(`route all-lines (Method A): $${allBudgetAll.toFixed(2)}  delta $${(allBudgetAll - BOARD_ALL_BUDGET).toFixed(2)}`);
  console.log(`Method B kpi-only: $${methodBKpi.toFixed(2)}             delta $${(methodBKpi - BOARD_ALL_BUDGET).toFixed(2)}`);
  console.log(`Method B all-lines: $${methodBAll.toFixed(2)}            delta $${(methodBAll - BOARD_ALL_BUDGET).toFixed(2)}`);

  // ---- (6e) Per-account contribution to ALL kpi-only budget (Method A) ---
  console.log("\n=== (6e) per-account contribution to Method A kpi-only budget ===");
  const perAcctKpi = new Map();
  for (const gl of glLines) {
    if (!isKpiLine(gl)) continue;
    for (const acct of membersAll) {
      if (V6_ENVELOPE_ACCOUNTS.has(acct)) continue;
      let sub = 0;
      for (const w of rangeWeeks) {
        const p = periodOf(w);
        if (p == null) continue;
        const amt = byLine.get(gl)?.get(acct)?.get(p);
        if (amt == null) continue;
        sub += amt / 4;
      }
      perAcctKpi.set(acct, (perAcctKpi.get(acct) || 0) + sub);
    }
  }
  const perAcctSorted = [...perAcctKpi.entries()].sort((a,b)=>b[1]-a[1]);
  for (const [a, v] of perAcctSorted) console.log(`  ${a}: $${v.toFixed(2)}`);
  const perAcctSum = perAcctSorted.reduce((s, [,v]) => s+v, 0);
  console.log(`  SUM: $${perAcctSum.toFixed(2)}`);

  // ---- (7) Sentinel ---
  console.log("\n=== (7) SENTINEL: TBR - FL P8 3200.1 (bill.com) ===");
  const sentQ = await supa.from("purchasing_actuals")
    .select("amount")
    .eq("source", "billcom")
    .eq("excluded", false)
    .eq("account_key", "TBR - FL")
    .eq("gl_line_code", "3200.1")
    .gte("txn_date", periodStartLocal(8))
    .lte("txn_date", periodEndLocal(8));
  if (sentQ.error) {
    console.log(`sentinel query error: ${sentQ.error.message}`);
  } else {
    const sum = (sentQ.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    console.log(`sentinel sum: $${sum.toFixed(2)}  (expected $39,373.74)`);
    console.log(`sentinel line count: ${(sentQ.data || []).length}`);
  }

  // ---- (A) fiscal.weeks_in_range and elapsed_frac  ----
  console.log("\n=== A: fiscal.weeks_in_range / elapsed_frac (same for ALL and TBR-FL - range-scoped) ===");
  console.log(`  weeks_in_range: ${weeksInRange}`);
  console.log(`  elapsed_frac: ${elapsedFrac.toFixed(4)}`);
  console.log("  Note: these are computed from range dates only, not from members. Same for every account.");

  // ---- (A2) 4-vs-true consumer comparison ----
  console.log("\n=== A2: consumer trace weeksInPeriod=4 vs actual (34) ===");
  console.log(`kpiBud (kpi-only ALL budget, Method A): $${allBudgetKpi.toFixed(2)}`);
  const finishedWks = rangeWeeks.filter(w => {
    const wEnd = parseISO(w).getTime() + 6 * MS_PER_DAY;
    return wEnd < todayD.getTime();
  }).length;
  console.log(`finishedWks: ${finishedWks}`);
  console.log(`(page.js sends weeksInPeriod: 4, finishedWeeks: ${finishedWks})`);
  console.log(`weeklyTargets @ 4:  original = ${(allBudgetKpi/4).toFixed(2)},  adjusted = (budget - finishedSpend) / (4 - ${finishedWks}) = NEGATIVE denom (${4-finishedWks})`);
  console.log(`weeklyTargets @ ${weeksInRange}: original = ${(allBudgetKpi/weeksInRange).toFixed(2)},  adjusted = (budget - finishedSpend) / (${weeksInRange} - ${finishedWks}) = ${weeksInRange-finishedWks} denom`);
  console.log("(finishedSpend fills below via runtime; here we just show denominators)");
  console.log(`elapsedShape at 4 vs ${weeksInRange}: not called on the page today - chart shape uses runningWeekIdx pattern based on 4 slots`);
  console.log(`weekChart: page slices weekAmounts to first 4 weeks (page.js:277). Only 12/29-01/19 render.`);
  console.log(`period header 'week X of Y' - PeriodCard hardcodes '4 of 4' when closed and '${'${wop}'} of 4' otherwise (PeriodCard.js:74).`);
}

main().catch(e => { console.error(e); process.exit(1); });
