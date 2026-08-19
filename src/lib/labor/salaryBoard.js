// src/lib/labor/salaryBoard.js
//
// Salary PR 2 · commit 2. Salary-side data loaders + a merge helper
// that folds salary into the default response WITHOUT touching the
// hourly path. The gate module (src/lib/kpi/roleGate.js) is the only authority
// for who calls in here; nothing in this module re-decides.
//
// Design posture:
//   - Two loaders, both parametric over members + range:
//       load3100_2Budgets(supa, members)               -> Map<accountKey, Map<periodNo, amount>>
//       loadSalaryActuals(supa, members, start, end)   -> array of per-worker-week rows
//   - One merge helper that takes the default response body + loaders'
//     output + the buildBoard reference + range args. Returns a NEW
//     response object with:
//       salary_included: true
//       salary_available: (mirrors the caller-provided flag)
//       salary_summary: { workers, weeks, amount }
//       salary_vacancy: [{ account_key, budget, actual, unfilled }]
//       budget_total: { periods: [...], range: number }
//       hours_basis: 'hourly_only'
//       rate_basis:  'hourly_only'
//       blended_rate_hourly: <copy of the hourly-only blended rate>
//       board:  RECOMPUTED via buildBoard on merged inputs
//       budget_periods: PATCHED so each item gains budget_hourly +
//                       budget_salary; `amount` becomes the sum
//       actuals: original + synthesized salary rows with
//                salaried: true (hours zero, coverage 'complete')
//
// Salary rows synthesised in labor_actuals shape:
//   { account_key, worker_id, week_start, week_end (Sun),
//     amount, hours_regular:0, hours_overtime:0, hours_double_time:0,
//     hours_premium_other:0, hours_without_dollars:0,
//     coverage_state:'complete', salaried:true }
// - matches sumRows() in board.js so combined-actuals math is
//   arithmetic without special-cases inside buildBoard.
//
// PII posture: worker ids flow through the shaped rows (identical to
// the hourly path) but this module never logs a name, an email, or
// a dollar figure.

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const FY2026 = 2026;

/**
 * Load 3100.2 (salary) budgets per (account, period).
 * @returns {Promise<{ byAccount: Map<string, Map<number, number>>, error?: string }>}
 */
export async function load3100_2Budgets(supa, members) {
  if (!members || members.length === 0) return { byAccount: new Map() };
  const q = await supa
    .from("kpi_budgets")
    .select("account_key, period_no, amount")
    .in("account_key", members)
    .eq("line_code", "3100.2")
    .eq("fiscal_year", FY2026);
  if (q.error) return { byAccount: new Map(), error: q.error.message };
  const byAccount = new Map();
  for (const r of q.data || []) {
    const inner = byAccount.get(r.account_key) || new Map();
    inner.set(Number(r.period_no), Number(r.amount));
    byAccount.set(r.account_key, inner);
  }
  return { byAccount };
}

/**
 * Load labor_salary_actuals in the range for the given members.
 * @returns {Promise<{ rows: any[], error?: string }>}
 */
export async function loadSalaryActuals(supa, members, start, end) {
  if (!members || members.length === 0) return { rows: [] };
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_salary_actuals")
      .select("account_key, worker_id, week_start, amount, annual_comp_at_time")
      .in("account_key", members)
      .gte("week_start", start)
      .lte("week_start", end)
      .range(from, from + PS - 1);
    if (q.error) return { rows: [], error: q.error.message };
    for (const r of q.data || []) out.push(r);
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return { rows: out };
}

// Turn a labor_salary_actuals row into a labor_actuals-shaped row so
// buildBoard's sumRows() can fold it into range/week totals without
// branching. week_end is Sunday = week_start + 6 (Mon..Sun fiscal
// week, same convention deriveActuals uses).
function shapeSalaryRow(r) {
  const wsD = new Date(`${r.week_start}T00:00:00.000Z`);
  wsD.setUTCDate(wsD.getUTCDate() + 6);
  const weekEnd = wsD.toISOString().slice(0, 10);
  return {
    account_key: r.account_key,
    worker_id: r.worker_id,
    week_label: null,
    line_code: "3100.2",
    week_start: r.week_start,
    week_end: weekEnd,
    fiscal_year: FY2026,
    period_no: null,
    week_source: "salary_derive",
    hours_regular: 0,
    hours_overtime: 0,
    hours_double_time: 0,
    hours_premium_other: 0,
    dollars_regular: r.amount,
    dollars_overtime: 0,
    dollars_double_time: 0,
    dollars_premium_other: 0,
    amount: r.amount,
    hours_without_dollars: 0,
    segment_count: 0,
    entry_count: 0,
    coverage_state: "complete",
    derived_at: null,
    source_run: "salary_derive",
    salaried: true,
  };
}

/**
 * Merge a 3100.2 budget map with an existing 3100.1 budget_periods
 * array. Returns { periods, total, hourly_by_period, salary_by_period }.
 * - periods: same shape as input items but `amount` = hourly+salary,
 *   with `budget_hourly` and `budget_salary` sub-fields carrying the
 *   individual pieces.
 * - total: the sum-of-amounts across the merged periods.
 */
export function mergeBudgetPeriods(hourlyPeriods, salaryByPeriod) {
  const combined = new Map();
  for (const p of hourlyPeriods || []) {
    combined.set(p.period_no, {
      ...p,
      budget_hourly: Number(p.amount) || 0,
      budget_salary: 0,
    });
  }
  for (const [pn, amt] of salaryByPeriod || new Map()) {
    const cur = combined.get(pn);
    if (cur) {
      cur.budget_salary = Number(amt) || 0;
      cur.amount = r2(cur.budget_hourly + cur.budget_salary);
    } else {
      combined.set(pn, {
        period_no: pn,
        amount: r2(Number(amt) || 0),
        source: "pnl",
        basis: "pnl",
        superseded: false,
        budget_hourly: 0,
        budget_salary: Number(amt) || 0,
      });
    }
  }
  const periods = [...combined.values()].sort((a, b) => a.period_no - b.period_no);
  const total = periods.reduce((s, p) => s + Number(p.amount || 0), 0);
  return { periods, total };
}

/**
 * Given the default (hourly-only) response body, build the salary-on
 * response. Recomputes board via the supplied buildBoard function.
 *
 * @param {object} body - the response body about to be sent
 * @param {object} opts
 * @param {string} opts.account
 * @param {string[]} opts.members - members list for aggregate paths
 * @param {string} opts.start
 * @param {string} opts.end
 * @param {string} opts.today
 * @param {(args: object) => object} opts.buildBoard
 * @param {object} opts.salary3100_2 - Map<accountKey, Map<period, amount>>
 * @param {any[]}  opts.salaryRows - raw labor_salary_actuals rows
 * @returns {object} a new response body with salary merged
 */
export function withSalary(body, {
  account,
  members,
  start,
  end,
  today,
  buildBoard,
  buildWeekBudgets,
  salary3100_2,
  salaryRows,
  otThresholds,
}) {
  // 1. Sum 3100.2 per-period across the members whose budget we merge.
  const salaryByPeriod = new Map();
  for (const m of members) {
    const inner = salary3100_2.get(m);
    if (!inner) continue;
    for (const [pn, amt] of inner) {
      salaryByPeriod.set(pn, (salaryByPeriod.get(pn) || 0) + Number(amt || 0));
    }
  }

  // 2. Merge hourly + salary budget_periods.
  const merged = mergeBudgetPeriods(body.budget_periods || [], salaryByPeriod);

  // 3. Merge actuals + salary rows (shaped for buildBoard).
  const hourlyActuals = body.actuals || [];
  const salaryActualsShaped = salaryRows.map(shapeSalaryRow);
  const mergedActuals = hourlyActuals.concat(salaryActualsShaped);

  // 4. Recompute board on merged inputs. D26 accounts (CIN - KY,
  //    TBJ - NY) get a real board on the salary path even though
  //    their hourly-only board returned applies:false.
  const mergedBoard = buildBoard({
    account, start, end, today,
    actuals: mergedActuals,
    budget_periods: merged.periods,
    account_state: "hourly_ok",
    ot_thresholds: otThresholds,
  });

  // 5. Salary summary counts.
  const distinctWorkers = new Set(salaryRows.map(r => r.worker_id)).size;
  const distinctWeeks = new Set(salaryRows.map(r => r.week_start)).size;
  const salaryAmount = r2(salaryRows.reduce((s, r) => s + Number(r.amount || 0), 0));
  const salary_summary = { workers: distinctWorkers, weeks: distinctWeeks, amount: salaryAmount };

  // 6. Per-account vacancy: 3100.2 budget - derived salary. Positive
  //    unfilled = open position; zero = fully staffed at that budget.
  //    Range budget = sum of period budgets that fall in the range's
  //    period span, using the same period set the merged board saw.
  const periodsInRange = new Set((mergedBoard?.period_span
    ? enumeratePeriods(mergedBoard.period_span.first, mergedBoard.period_span.last)
    : []));
  const actualByAccount = new Map();
  for (const r of salaryRows) actualByAccount.set(r.account_key, (actualByAccount.get(r.account_key) || 0) + Number(r.amount || 0));
  const salary_vacancy = members.map(m => {
    const perPeriod = salary3100_2.get(m) || new Map();
    let budget = 0;
    for (const [pn, amt] of perPeriod) {
      if (periodsInRange.size === 0 || periodsInRange.has(pn)) budget += Number(amt || 0);
    }
    const actual = actualByAccount.get(m) || 0;
    const unfilled = Math.max(0, budget - actual);
    return { account_key: m, budget: r2(budget), actual: r2(actual), unfilled: r2(unfilled) };
  }).sort((a, b) => a.account_key.localeCompare(b.account_key));

  // 7. Blended rate stays HOURLY-only. Keep the original board's
  //    avg_rate under the explicit name; downstream labels this.
  const blended_rate_hourly = body.board?.avg_rate ?? null;

  // 8. 2026-08-19 V40 BUG 2 - week_budgets on the salary path.
  //    Prior state: withSalary spread body.week_budgets unchanged
  //    (hourly-only), which put the week strip (fed from
  //    budget_periods = merged, correct) and the WeekTable (fed from
  //    week_budgets = hourly-only, wrong) into opposite verdicts
  //    on the same week - measured live at TBR-FL P8 week 07/13:
  //    strip said "▼ $759 under $12,245.74"; table said "▲ $3,424
  //    over $8,063.05". Recomputing week_budgets from merged
  //    budget_periods restores the same source both surfaces read.
  //    buildWeekBudgets is passed by the caller so this module has
  //    no direct dep on lib/board.
  const week_budgets = (typeof buildWeekBudgets === "function")
    ? buildWeekBudgets({ start, end, budget_periods: merged.periods })
    : body.week_budgets;

  return {
    ...body,
    actuals: mergedActuals,
    budget_periods: merged.periods,
    week_budgets,
    board: mergedBoard,
    salary_included: true,
    salary_summary,
    salary_vacancy,
    hours_basis: "hourly_only",
    rate_basis:  "hourly_only",
    blended_rate_hourly,
    budget_total: { periods: merged.periods, range: r2(merged.total) },
  };
}

function enumeratePeriods(first, last) {
  const out = [];
  for (let p = first; p <= last; p += 1) out.push(p);
  return out;
}
