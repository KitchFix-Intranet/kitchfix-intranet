// src/lib/kpi/overview/billback.js
//
// PR-billback-1 (Kevin ruling 2026-10-09). Billed-back-to-club surface
// for management-fee accounts on multi-period (Current Year) ranges.
//
// Pure finance core. The resolver calls buildBillback once per request
// when the gate passes (revenue_model === "management_fee" AND the
// range is multi-period). On single-period and non-MF accounts, the
// resolver ships billback: null and the client renders nothing.
//
// Allocation rule (pin exactly):
//   1. annual_goal from kpi_billback_goals; null -> block ships without
//      numbers, UI shows a quiet "no goal set" state.
//   2. per_period_projected_meals: sc_daily_revenue.projected_count,
//      bucketed into fiscal periods via periodOf. is_non_revenue filter
//      matches loadScDailyRevenue (§5.10).
//   3. goaled_periods: periods with projected_meals > 0.
//      first_goal_period = earliest. Off-season (0 meals) rows carry
//      goal: null, state: "off_season".
//   4. per_period_goal = annual_goal * (period_meals / sum_fy_meals).
//      Sum of per-period goals across goaled periods = annual_goal.
//   5. per_period_actual = sum of reimbursable actuals for the period.
//      Reimbursable = gl_bucket === "reimbursable" (deriveGlBucket on
//      "13"-prefixed codes). Reuses the exact split paginateActuals
//      runs: pre-cutover -> purchasing_actuals (all sources); post-
//      cutover (CAPTURE_CUTOVER_ISO) -> purchasing_actuals rippling_
//      spend lane + invoice_submissions.gl_breakdown.
//   6. Pre-season fold: reimbursable actuals in periods p < first_
//      goal_period are added into first_goal_period's actual. The
//      earlier periods are NOT emitted. STL - FL has goals from P1
//      so nothing folds; STL - MO + CIN - OH fold P1-P3 into P4.
//   7. YTD sums through through_period (last R-93-settled period in
//      the fiscal year). Running / future periods appear in periods[]
//      but do NOT contribute to ytd.{actual_to_date, goal_to_date}.
//      Matches derivePeriodSpendSettled rule the board uses.
//   8. tone: over / under / on / na. Client maps tone -> color (amber
//      for over; billed-back is club pass-through, so over is "notable"
//      not a loss - amber, not red).
//   9. breakdown: aggregate reimbursable actuals by gl_codes.name
//      (strip leading "{account_key} " prefix for display). Strays:
//      bare parent codes (no matching gl_codes row) + cross-account
//      codes (matching row but account_key != this account). Strays
//      stay in periods[].actual + YTD - they are real spend; the
//      breakdown row just names the cleanup.

import { periodStartISO, periodEndISO, periodOf } from "@/app/kpi/labor/lib/periods.js";
import { derivePeriodSpendSettled } from "@/lib/kpi/overview/pnl-loader.js";

const CAPTURE_CUTOVER_ISO = "2026-09-07";
const PAGE = 1000;
const IN_CHUNK = 100;

function deriveGlBucket(code) {
  const s = String(code || "");
  if (!s) return null;
  const two = s.slice(0, 2);
  if (two === "32" || two === "34" || two === "35") return "pl_cogs";
  if (two === "13") return "reimbursable";
  if (s.charAt(0) === "5") return "sga";
  return "other";
}

function isoBefore(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchAllPaginated(builderFn) {
  let from = 0;
  const out = [];
  while (true) {
    const q = await builderFn(from, from + PAGE - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadBillbackGoal(supa, accountKey, fiscalYear) {
  const q = await supa
    .from("kpi_billback_goals")
    .select("annual_goal")
    .eq("account_key", accountKey)
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();
  if (q.error) throw new Error(`kpi_billback_goals: ${q.error.message}`);
  return q.data?.annual_goal != null ? Number(q.data.annual_goal) : null;
}

async function loadProjectedMealsByPeriod(supa, accountKey, fyStart, fyEnd) {
  const rows = await fetchAllPaginated((lo, hi) => supa
    .from("sc_daily_revenue")
    .select("service_date, projected_count, is_non_revenue")
    .eq("account_key", accountKey)
    .gte("service_date", fyStart)
    .lte("service_date", fyEnd)
    .not("is_non_revenue", "is", true)
    .order("service_date")
    .range(lo, hi));
  const byP = new Map();
  for (const r of rows) {
    const p = periodOf(r.service_date);
    if (p == null) continue;
    const n = Number(r.projected_count || 0);
    if (n === 0) continue;
    byP.set(p, (byP.get(p) || 0) + n);
  }
  return byP;
}

// Reimbursable actuals, R-147 cutover split. Three MF accounts in scope
// here are all capture-eligible (NOT in the excluded set), so for them
// the post-cutover bill lane is invoice_submissions.gl_breakdown. The
// shape returned is period -> [{code, amount}] so the caller can both
// (a) sum per-period actuals and (b) build the breakdown + strays by
// walking the (code, amount) list.
async function loadReimbursableActualsByPeriod(supa, accountKey, fyStart, fyEnd) {
  const preEnd = fyEnd < CAPTURE_CUTOVER_ISO ? fyEnd : isoBefore(CAPTURE_CUTOVER_ISO, 1);
  const postStart = fyStart > CAPTURE_CUTOVER_ISO ? fyStart : CAPTURE_CUTOVER_ISO;

  // Pre-cutover: all purchasing_actuals sources.
  let preRows = [];
  if (fyStart <= preEnd) {
    preRows = await fetchAllPaginated((lo, hi) => supa
      .from("purchasing_actuals")
      .select("txn_date, gl_line_code, amount")
      .eq("account_key", accountKey)
      .eq("excluded", false)
      .gte("txn_date", fyStart)
      .lte("txn_date", preEnd)
      .order("txn_date")
      .range(lo, hi));
  }

  // Post-cutover card lane: purchasing_actuals.source = rippling_spend.
  let cardRows = [];
  if (postStart <= fyEnd) {
    cardRows = await fetchAllPaginated((lo, hi) => supa
      .from("purchasing_actuals")
      .select("txn_date, gl_line_code, amount")
      .eq("account_key", accountKey)
      .eq("excluded", false)
      .eq("source", "rippling_spend")
      .gte("txn_date", postStart)
      .lte("txn_date", fyEnd)
      .order("txn_date")
      .range(lo, hi));
  }

  // Post-cutover bill lane: invoice_submissions.gl_breakdown.
  let invRows = [];
  if (postStart <= fyEnd) {
    invRows = await fetchAllPaginated((lo, hi) => supa
      .from("invoice_submissions")
      .select("gl_breakdown, submitted_at")
      .eq("account_key", accountKey)
      .gte("submitted_at", postStart)
      .lte("submitted_at", fyEnd)
      .order("submitted_at")
      .range(lo, hi));
  }

  const byP = new Map();
  const push = (p, code, amt) => {
    if (p == null) return;
    const n = Number(amt || 0);
    if (!n) return;
    if (!byP.has(p)) byP.set(p, []);
    byP.get(p).push({ code: String(code || ""), amount: n });
  };
  for (const r of preRows) {
    if (deriveGlBucket(r.gl_line_code) !== "reimbursable") continue;
    push(periodOf(r.txn_date), r.gl_line_code, r.amount);
  }
  for (const r of cardRows) {
    if (deriveGlBucket(r.gl_line_code) !== "reimbursable") continue;
    push(periodOf(r.txn_date), r.gl_line_code, r.amount);
  }
  for (const r of invRows) {
    const items = Array.isArray(r.gl_breakdown) ? r.gl_breakdown : [];
    for (const it of items) {
      const code = it.gl_line_code || it.code;
      if (deriveGlBucket(code) !== "reimbursable") continue;
      push(periodOf(r.submitted_at), code, it.amount);
    }
  }
  return byP;
}

async function loadReimbursableGlCodes(supa, accountKey) {
  const rows = await fetchAllPaginated((lo, hi) => supa
    .from("gl_codes")
    .select("account_key, code, name")
    .eq("account_key", accountKey)
    .like("code", "13%")
    .range(lo, hi));
  const m = new Map();
  for (const r of rows) m.set(String(r.code), { name: r.name || null, account_key: r.account_key });
  return m;
}

function stripAccountPrefix(name, accountKey) {
  if (!name) return "Uncoded";
  const pfx = accountKey + " ";
  return name.startsWith(pfx) ? name.slice(pfx.length) : name;
}

/**
 * Build the billback payload block. Returns null when the gate fails
 * (non-MF account or single-period range). The resolver should pass
 * through isManagementFee / isMultiPeriod computed from
 * (data.revenue_model === "management_fee") and (rng.kind !== "period").
 */
export async function buildBillback({
  supa,
  accountKey,
  isManagementFee,
  isMultiPeriod,
  todayISO,
  periodStatus,            // Map<period_no, {verified_at, closed_at}>
  fiscalYear,
}) {
  if (!isManagementFee || !isMultiPeriod) return null;

  const fyStart = periodStartISO(1);
  const fyEnd = periodEndISO(13);

  const [annualGoal, projByP, reimbByP, glCodes] = await Promise.all([
    loadBillbackGoal(supa, accountKey, fiscalYear),
    loadProjectedMealsByPeriod(supa, accountKey, fyStart, fyEnd),
    loadReimbursableActualsByPeriod(supa, accountKey, fyStart, fyEnd),
    loadReimbursableGlCodes(supa, accountKey),
  ]);

  const goaledPeriods = [...projByP.entries()]
    .filter(([, n]) => n > 0)
    .map(([p]) => p)
    .sort((a, b) => a - b);
  const firstGoalPeriod = goaledPeriods[0] || null;
  const totalFyMeals = goaledPeriods.reduce((s, p) => s + (projByP.get(p) || 0), 0);

  // through_period: last R-93-settled period in the FY. Open / planned
  // periods are never settled; verified periods are trivially settled;
  // closed_awaiting with the R-93 8-day boundary cleared is settled.
  let throughPeriod = null;
  for (let p = 13; p >= 1; p--) {
    if (derivePeriodSpendSettled({
      periodNo: p,
      todayISO,
      periodStatusRow: (periodStatus && periodStatus.get(p)) || null,
    })) { throughPeriod = p; break; }
  }

  // Pre-season fold: sum actuals from p < first_goal_period and add to
  // first_goal_period's actual. The earlier periods never appear in
  // periods[]. STL - FL first_goal_period=1 so nothing folds.
  let preSeasonActual = 0;
  if (firstGoalPeriod) {
    for (let p = 1; p < firstGoalPeriod; p++) {
      for (const it of (reimbByP.get(p) || [])) preSeasonActual += it.amount;
    }
  }

  const periodsOut = [];
  for (let p = firstGoalPeriod || 1; p <= 13; p++) {
    const periodMeals = projByP.get(p) || 0;
    const isGoaled = periodMeals > 0;
    const goal = (annualGoal != null && isGoaled && totalFyMeals > 0)
      ? annualGoal * (periodMeals / totalFyMeals)
      : null;
    const items = reimbByP.get(p) || [];
    let actualRaw = 0;
    for (const it of items) actualRaw += it.amount;
    const actual = (p === firstGoalPeriod) ? actualRaw + preSeasonActual : actualRaw;

    const pStart = periodStartISO(p);
    const pEnd = periodEndISO(p);
    const calendarState = pEnd < todayISO ? "closed"
      : (pStart <= todayISO && todayISO <= pEnd) ? "in_progress"
      : "not_started";
    const state = isGoaled ? calendarState : "off_season";

    let tone = "na"; let delta = null; let pct = null;
    if (goal != null) {
      delta = actual - goal;
      pct = goal > 0 ? (actual / goal) * 100 : null;
      tone = actual > goal ? "over" : actual < goal ? "under" : "on";
    }
    periodsOut.push({ period_no: p, goal, actual, tone, delta, pct, state });
  }

  // YTD: sum goal + actual for periods <= throughPeriod. Later periods
  // appear in periods[] but do not contribute to YTD.
  let goalToDate = 0, actualToDate = 0;
  for (const r of periodsOut) {
    if (throughPeriod != null && r.period_no <= throughPeriod) {
      if (r.goal != null) goalToDate += r.goal;
      actualToDate += r.actual;
    }
  }
  const ytdDelta = actualToDate - goalToDate;
  const ytdTone = ytdDelta > 0 ? "over" : ytdDelta < 0 ? "under" : "on";
  const pctOfGoalToDate = goalToDate > 0 ? (actualToDate / goalToDate) * 100 : null;
  const pctOfAnnual = annualGoal && annualGoal > 0 ? (actualToDate / annualGoal) * 100 : null;
  const goalRemaining = annualGoal != null ? annualGoal - goalToDate : null;

  // Breakdown: aggregate every reimbursable actual (across all periods)
  // by gl_codes.name with the "{account_key} " prefix stripped. Strays
  // = codes with no gl_codes row OR gl_codes row with different
  // account_key.
  const byLabel = new Map();
  let strays = 0;
  for (const items of reimbByP.values()) {
    for (const it of items) {
      const row = glCodes.get(it.code);
      if (!row || !row.name) { strays += it.amount; continue; }
      if (row.account_key !== accountKey) { strays += it.amount; continue; }
      const label = stripAccountPrefix(row.name, accountKey);
      byLabel.set(label, (byLabel.get(label) || 0) + it.amount);
    }
  }
  const breakdown = [...byLabel.entries()]
    .map(([label, amount]) => ({ label, amount, stray: false }))
    .sort((a, b) => b.amount - a.amount);
  if (strays > 0.005) {
    breakdown.push({ label: "Uncoded / strays", amount: strays, stray: true });
  }

  return {
    annual_goal: annualGoal,
    fiscal_year: fiscalYear,
    first_goal_period: firstGoalPeriod,
    through_period: throughPeriod,
    periods: periodsOut,
    ytd: {
      goal_to_date: goalToDate,
      actual_to_date: actualToDate,
      delta: ytdDelta,
      tone: ytdTone,
      pct_of_goal_to_date: pctOfGoalToDate,
      pct_of_annual: pctOfAnnual,
      goal_remaining: goalRemaining,
    },
    breakdown,
    strays_amount: strays,
  };
}
