// src/lib/labor/dailyRangeBody.js
//
// PR-3a - business function that builds the daily-source response
// body. Extracted from route.js so the probe can call it directly
// against a real service_role Supabase client (no HTTP, no auth
// session). The route wraps the return value in NextResponse.json().
//
// Contract:
//   Returns { body } on success or { error } on failure.
//   `body` is the JSON-serializable payload the route sends.
//   `error` is { status, payload } for the caller to translate.

import { buildWeekBudgets } from "../../app/kpi/labor/lib/board.js";
import { loadSalaryActuals } from "./salaryBoard.js";
import { proRateBudget } from "./budgetProRate.js";
import { salaryProRate } from "./salaryProRate.js";
import { fetchAllOffset } from "../rippling/paginate.js";

const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
const MS_PER_DAY = 86400000;

function safeErr(scope, err) {
  return { status: 500, payload: { error: "server_error", scope } };
}

export async function buildDailyRangeBody(ctx) {
  const {
    supa, account, start, end,
    caller, landing_account, preview_account,
    accounts_directory, regional_directors_display,
    freshness,
    rangeSource,
    dailyFloorISO,
    salary_available,
    includeSalary,
    resolveWorkerMeta,
  } = ctx;

  // 1. Resolve members.
  let members;
  if (V6_PSEUDO_KEYS.has(account)) {
    let memberQ;
    if (account === "ALL") {
      memberQ = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
    } else {
      const regionValue = account === "EAST" ? "East" : "West";
      memberQ = await supa.from("accounts").select("team_key").neq("team_key", "CORP").eq("region", regionValue).order("team_key");
    }
    if (memberQ.error) return { error: safeErr("v6_members_daily", memberQ.error) };
    members = (memberQ.data || []).map(r => r.team_key);
  } else {
    members = [account];
  }

  // 2. Fetch daily rows for the range + members.
  // 2026-08-28 pagination sweep: paginated via fetchAllOffset. Members
  // (up to 11 for portfolio ALL) x workers x days x lines can exceed
  // 1000 on wider daily-branch windows; prior bare select truncated.
  let dailyRows;
  try {
    dailyRows = await fetchAllOffset(supa, "labor_actuals_daily",
      "account_key, worker_id, work_date, line_code, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, segment_count",
      [
        (q) => q.in("account_key", members),
        (q) => q.gte("work_date", start),
        (q) => q.lte("work_date", end),
      ]);
  } catch (e) {
    return { error: safeErr("labor_actuals_daily", { message: e.message }) };
  }

  // 3. Aggregate per (worker, line) - integer-cent accumulator so
  //    no FP-summation artifact on cross-grain sums.
  const bucketByKey = new Map();
  for (const r of dailyRows) {
    const k = `${r.account_key}|${r.worker_id}|${r.line_code}`;
    const cur = bucketByKey.get(k) || {
      account_key: r.account_key, worker_id: r.worker_id, line_code: r.line_code,
      hoursRegularX100: 0, hoursOvertimeX100: 0, hoursDoubleTimeX100: 0, hoursPremiumOtherX100: 0,
      dollarsRegularX10000: 0, dollarsOvertimeX10000: 0, dollarsDoubleTimeX10000: 0, dollarsPremiumOtherX10000: 0,
      amountX10000: 0, segment_count: 0, day_count: 0,
    };
    cur.hoursRegularX100       += Math.round(Number(r.hours_regular || 0) * 100);
    cur.hoursOvertimeX100      += Math.round(Number(r.hours_overtime || 0) * 100);
    cur.hoursDoubleTimeX100    += Math.round(Number(r.hours_double_time || 0) * 100);
    cur.hoursPremiumOtherX100  += Math.round(Number(r.hours_premium_other || 0) * 100);
    cur.dollarsRegularX10000       += Math.round(Number(r.dollars_regular || 0) * 10000);
    cur.dollarsOvertimeX10000      += Math.round(Number(r.dollars_overtime || 0) * 10000);
    cur.dollarsDoubleTimeX10000    += Math.round(Number(r.dollars_double_time || 0) * 10000);
    cur.dollarsPremiumOtherX10000  += Math.round(Number(r.dollars_premium_other || 0) * 10000);
    cur.amountX10000                += Math.round(Number(r.amount || 0) * 10000);
    cur.segment_count += Number(r.segment_count || 0);
    cur.day_count++;
    bucketByKey.set(k, cur);
  }
  const actualsRange = [...bucketByKey.values()].map(b => ({
    account_key: b.account_key,
    worker_id:   b.worker_id,
    line_code:   b.line_code,
    hours_regular:         b.hoursRegularX100 / 100,
    hours_overtime:        b.hoursOvertimeX100 / 100,
    hours_double_time:     b.hoursDoubleTimeX100 / 100,
    hours_premium_other:   b.hoursPremiumOtherX100 / 100,
    dollars_regular:       b.dollarsRegularX10000 / 10000,
    dollars_overtime:      b.dollarsOvertimeX10000 / 10000,
    dollars_double_time:   b.dollarsDoubleTimeX10000 / 10000,
    dollars_premium_other: b.dollarsPremiumOtherX10000 / 10000,
    amount:                b.amountX10000 / 10000,
    segment_count: b.segment_count,
    day_count:     b.day_count,
  }));

  // 4. Pro-rated budget.
  const budgetPeriodsQ = await supa.from("kpi_budgets")
    .select("account_key, period_no, amount")
    .in("account_key", members)
    .eq("line_code", "3100.1")
    .eq("fiscal_year", 2026);
  if (budgetPeriodsQ.error) return { error: safeErr("kpi_budgets_daily", budgetPeriodsQ.error) };
  const perAccountBudgets = new Map();
  for (const b of (budgetPeriodsQ.data || [])) {
    const inner = perAccountBudgets.get(b.account_key) || new Map();
    inner.set(Number(b.period_no), Number(b.amount) || 0);
    perAccountBudgets.set(b.account_key, inner);
  }
  const periodsInRange = new Set();
  for (const m of members) {
    const inner = perAccountBudgets.get(m) || new Map();
    for (const [pn] of inner) periodsInRange.add(pn);
  }
  const budgetPeriodsForRange = [];
  for (const pn of [...periodsInRange].sort((a, b) => a - b)) {
    let total = 0;
    for (const m of members) {
      const inner = perAccountBudgets.get(m) || new Map();
      total += inner.get(pn) || 0;
    }
    budgetPeriodsForRange.push({ period_no: pn, amount: total, source: "pnl", basis: "pnl", superseded: false });
  }
  const weekBudgets = buildWeekBudgets({ start, end, budget_periods: budgetPeriodsForRange });
  const budgetProrate = proRateBudget({ startISO: start, endISO: end, weekBudgets });

  // 5. Salary path - PR-3a. Load per-worker-per-week salary rows for
  //    any week overlapping the range, pro-rate via salaryProRate
  //    (integer-cent LRM), merge as salaried=true rows into the
  //    per-worker aggregate.
  const salaryWindowStart = new Date(new Date(`${start}T00:00:00.000Z`).getTime() - 6 * MS_PER_DAY).toISOString().slice(0, 10);
  let salaryProrate = null;
  let salaryRowsPerWorker = [];
  if (includeSalary) {
    const salQ = await loadSalaryActuals(supa, members, salaryWindowStart, end);
    if (salQ.error) return { error: safeErr("labor_salary_actuals_daily", salQ.error) };
    salaryProrate = salaryProRate({ startISO: start, endISO: end, salaryRows: salQ.rows });
    salaryRowsPerWorker = salaryProrate.workers;
  }

  // 6. Merge salary into actuals_range (mirrors weekly withSalary shape).
  const actualsRangeWithSalary = [...actualsRange];
  for (const w of salaryRowsPerWorker) {
    actualsRangeWithSalary.push({
      account_key: w.account_key,
      worker_id:   w.worker_id,
      line_code:   "3100.2",
      hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      dollars_regular: w.slice, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      amount: w.slice,
      segment_count: 0, day_count: 0,
      salaried: true,
      weeks_touched: w.weeks_touched,
      days_in_range: w.days_in_range,
    });
  }

  // 7. Salary summary.
  const salarySummary = salaryProrate ? {
    workers: salaryProrate.workers.length,
    weeks:   salaryProrate.overlapped_weeks,
    days:    salaryProrate.overlapped_days,
    amount:  salaryProrate.total,
  } : null;

  // 8. Worker meta - hourly + salary combined.
  const workerIds = [...new Set(actualsRangeWithSalary.map(r => r.worker_id))];
  const { workerMeta } = await resolveWorkerMeta(supa, workerIds);

  return {
    body: {
      ok: true,
      filters: { account, start, end },
      source: "daily",
      range: {
        span_days: rangeSource.spanDays,
        is_partial_week: rangeSource.isPartialWeek,
        daily_floor: dailyFloorISO,
      },
      actuals_range: actualsRangeWithSalary,
      actuals_daily: dailyRows,
      budget_prorate: budgetProrate,
      salary_prorate: salaryProrate,
      salary_summary: salarySummary,
      salary_included: includeSalary === true,
      workers: workerMeta,
      members,
      landing_account,
      preview_account,
      accounts_directory,
      regional_directors_display,
      salary_available,
      derive_freshness: freshness,
    },
  };
}
