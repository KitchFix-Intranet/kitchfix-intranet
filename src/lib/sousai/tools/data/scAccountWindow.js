// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/scAccountWindow.js
// SousAI data tool B1: account window summary.
//
// "How is CIN-AZ tracking this month?" / "...this homestand?" / "...period?"
//
// Reads sc_daily_revenue (per-account-per-service-per-date) for finer grain
// windows, and sc_month_summary for the month view when window='month'.
// **Always returns a single summary record**, never rows - Phase E grades
// mechanically and B2 is the rows tool.
//
// Missing-price rule (Convention 6): a service with null price_effective_date
// yields $0 revenue in the view (COALESCE), indistinguishable from a real
// zero-revenue day. This tool splits rows on price_effective_date IS NULL
// and refuses to publish a revenue total when unpriced services exist,
// naming them instead. Meal counts still land - they don't depend on price.
//
// Partial-window discipline: `days_with_actuals` and `total_service_days`
// are always returned together, so a mid-window total reads as partial
// even when arithmetically correct.
//
// Account-shape awareness (2026-07-31, plan v2.65): the tool now returns
// billing_model + has_homestand_schedule so the model can name the shape.
// The classifier's fee branch (see serviceCalendar.js:292) is taken when
// `billing_model === "flat_fee" && hasHomestandData`. That branch never
// emits `overdue` or `needs-entry` - a fee-branch account with zero actuals
// is the expected shape, not outstanding work.
//
// Both halves of the predicate matter: STL-FL is flat_fee but has zero
// homestand rows (uses has_schedule_overlay instead), so it goes through
// the per-meal branch and the entry fraction there IS meaningful. Do NOT
// classify by billing_model alone.
//
// Revenue on fee-branch: declined. The contracted fee does not move with
// volume, so meals * per-meal price is a number with no meaning. The fee
// lives in REF-141 and the account's REC record, not in any queryable
// table. Same family as the missing-price rule.
//
// Provenance caveat on billing_model: all 12 accounts.updated_at land at
// 2026-05-27T16:52:35 within a millisecond (single bulk write), and
// values have since drifted from what sc-1's INSERT seeds - the column
// has no trigger that stamps updated_at on hand edits. Treat billing_model
// as an account attribute, not a freshly-verified fact.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { DIRECTORY_LOAD_DATE, partitionRevenueRows } from "./_constants.js";

const VALID_WINDOWS = ["month", "homestand", "period"];

/**
 * @param {object} args
 * @param {string} args.accountKey - e.g. "CIN - AZ"
 * @param {"month"|"homestand"|"period"} [args.window="month"]
 * @param {string} [args.asOf] - YYYY-MM-DD; defaults to today
 * @returns {Promise<object>}
 */
export async function scAccountWindow({ accountKey, window = "month", asOf } = {}) {
  if (!accountKey || typeof accountKey !== "string") {
    return errorPayload("accountKey is required (e.g. 'CIN - AZ')");
  }
  if (!VALID_WINDOWS.includes(window)) {
    return errorPayload(`window must be one of: ${VALID_WINDOWS.join(", ")}`);
  }
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return errorPayload(`asOf must be YYYY-MM-DD, got '${asOfDate}'`);
  }

  const sb = getSupabase();

  // Read the account row for shape awareness. Mirror the classifier's
  // predicate exactly (serviceCalendar.js:292): fee branch is taken when
  // billing_model === "flat_fee" AND the window actually has homestand
  // rows. The `has_homestand_schedule` flag is the necessary gate; the
  // window-level presence is validated when we compute hasHomestandData
  // below.
  const { data: acctRow, error: acctErr } = await sb
    .from("accounts")
    .select("billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (acctErr) throw new Error(`scAccountWindow: accounts fetch failed: ${acctErr.code || "?"} ${acctErr.message}`);
  const billingModel = acctRow?.billing_model || null;
  const hasHomestandScheduleFlag = !!acctRow?.has_homestand_schedule;

  // Resolve window boundaries.
  const bounds = await resolveWindowBounds(sb, accountKey, window, asOfDate);
  if (!bounds.ok) return bounds.error;

  // Fetch the daily_revenue rows for the window.
  const { data: rows, error } = await sb
    .from("sc_daily_revenue")
    .select("service_date, service_id, service_name, group_name, is_flat_fee, is_tax_free, is_non_revenue, projected_count, actual_count, has_actuals, has_projection, price_at_date, price_effective_date, projected_revenue, actual_revenue")
    .eq("account_key", accountKey)
    .gte("service_date", bounds.start_date)
    .lte("service_date", bounds.end_date);
  if (error) throw new Error(`scAccountWindow: query failed: ${error.code || "?"} ${error.message}`);

  const revenueRows = (rows || []).filter((r) => !r.is_non_revenue);
  const { priced, unpriced } = partitionRevenueRows(revenueRows);

  // Meal counts always tally regardless of price status.
  const allRows = rows || [];
  const totalProjectedMeals = allRows.reduce((s, r) => s + (Number(r.projected_count) || 0), 0);
  const totalActualMeals = allRows.reduce((s, r) => s + (r.has_actuals ? (Number(r.actual_count) || 0) : 0), 0);

  // No-service day accounting. Match the Service Calendar's rule verbatim
  // (src/lib/dataStore/serviceCalendar.js classifyDayStatus + src/app/
  // service-calendar/ServiceCalendar.js aggregateWorkspaceMetrics
  // line 216-222). Kevin's ruling 2026-07-11: a no-service day (auto or
  // manual "mark no service") drops out of BOTH the numerator and
  // denominator of "N of M entered". The state has no schema column; it
  // is encoded as every service that day set to zero (Chat's spec 2.2,
  // and matching serviceCalendar.js:2162's "mark-no-service collapse").
  //
  // Per-day reduce: hasAct=true + any non-zero actual → "entered".
  //                 hasAct=true + all zero actuals    → "no-service" (cancelled).
  //                 hasAct=false + hasProj + all zero projections → "no-service" (planned off).
  //                 else                             → needs-entry / overdue / future.
  // "Actionable" = not no-service. "Entered" = has_actuals + any non-zero.
  //
  // Without this, the tool reads a cancelled day as an unentered service
  // day, and CIN-AZ July - fully caught up per the calendar - reads back
  // as "27 of 31 with 4 days outstanding" (Kevin's 2026-07-30 finding).
  const perDay = new Map();
  for (const r of allRows) {
    const d = r.service_date;
    let s = perDay.get(d);
    if (!s) { s = { hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false }; perDay.set(d, s); }
    if (r.has_actuals) s.hasAct = true;
    if (r.has_actuals && Number(r.actual_count) > 0) s.anyNonZeroAct = true;
    if (r.has_projection) s.hasProj = true;
    if (Number(r.projected_count) > 0) s.anyNonZeroProj = true;
  }
  let actionableDays = 0;
  let enteredDays = 0;
  let noServiceDays = 0;
  for (const [, s] of perDay) {
    const isNoService =
      (s.hasAct && !s.anyNonZeroAct) ||
      (!s.hasAct && s.hasProj && !s.anyNonZeroProj);
    if (isNoService) { noServiceDays += 1; continue; }
    actionableDays += 1;
    if (s.hasAct && s.anyNonZeroAct) enteredDays += 1;
  }

  // Account-shape branch selection. Mirrors serviceCalendar.js:292 -
  // `billing_model === "flat_fee" && hasHomestandData`. The tool answers
  // at whole-window scope, so `has_homestand_schedule` (the account-level
  // gate the classifier uses to decide whether to even fetch a homestand
  // map) is the correct mirror here. That keeps STL-MO fee-branch in
  // January when no homestand rows exist in-window - the account's
  // persistent shape does not flip with the season.
  //
  // STL-FL trap: STL-FL is flat_fee but has_homestand_schedule=false
  // (it uses has_schedule_overlay instead). The classifier sends it
  // through the per-meal branch. Both halves matter - do not classify
  // by billing_model alone.
  const isFeeBranch = billingModel === "flat_fee" && hasHomestandScheduleFlag;

  // Fee-branch accounts: the calendar itself never marks these days
  // needs-entry, so entered/actionable ratio is not a completeness
  // measure. Present the raw counts (meal counts still drive staffing
  // and food cost) but do not frame low entry as outstanding work.
  const totalServiceDays = actionableDays;
  const daysWithActuals = enteredDays;
  // is_partial is boolean | null. `null` says "completeness does not apply"
  // for fee-branch accounts - the calendar never marks these days needs-
  // entry, so there is no completeness target to be partial against.
  // Returning `false` here would assert "this window is complete," a
  // different and untrue claim. A boolean that cannot express "not
  // applicable" should not be forced to answer. (Plan v2.66; same
  // correction the SC team made to the no_service spec today.)
  const isPartial = isFeeBranch ? null : daysWithActuals < totalServiceDays;

  // Revenue: two decline paths.
  //   (1) fee-branch account - the contracted fee does not move with
  //       meal counts, so meals * per-meal price is a number with no
  //       meaning. Point at REF-141 and the account's REC record.
  //   (2) unpriced services in-window (existing missing-price rule).
  let projectedRevenue = null;
  let actualRevenue = null;
  let revenueDeclineReason = null;
  const unpricedServices = [...new Set(unpriced.map((r) => `${r.service_name} (id ${r.service_id})`))];

  if (isFeeBranch) {
    revenueDeclineReason = `${accountKey} is a fee-branch account (billing_model='flat_fee' + has_homestand_schedule=true). The contracted fee does not move with meal counts, so meals * per-meal price is not the revenue figure. The fee lives in REF-141 (Billing Model Quick Reference) and the account's REC record, not in any queryable table.`;
  } else if (unpriced.length === 0) {
    projectedRevenue = priced.reduce((s, r) => s + (Number(r.projected_revenue) || 0), 0);
    actualRevenue = priced.filter((r) => r.has_actuals)
      .reduce((s, r) => s + (Number(r.actual_revenue) || 0), 0);
  } else {
    revenueDeclineReason = `${unpricedServices.length} service(s) in this window have no configured price on their service_date. A revenue total cannot be produced without those prices. Unpriced: ${unpricedServices.join(", ")}. The price_effective_date is NULL for these rows in sc_daily_revenue.`;
  }

  return {
    source: "sc_daily_revenue + accounts" + (window === "month" ? " (+ sc_month_summary spot-check)" : ""),
    scope: "current-season Service Calendar. Revenue excludes is_non_revenue services (Fun Money etc.); meal counts include all services.",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { accountKey, window, asOf: asOfDate },
    window_boundaries: { start_date: bounds.start_date, end_date: bounds.end_date, label: bounds.label },
    // Account shape - lets the prompt name the account rather than
    // encoding "flat-fee means no actuals expected" in the tool. Both
    // halves are exposed so a caller can see the STL-FL trap directly.
    account_shape: {
      billing_model: billingModel,
      has_homestand_schedule: hasHomestandScheduleFlag,
      classifier_branch: isFeeBranch ? "fee" : "per_meal",
      note: isFeeBranch
        ? "Fee branch. The Service Calendar's fee branch never marks days needs-entry or overdue - a low entry rate here is the expected shape, not outstanding work."
        : "Per-meal branch. Entry fraction is a real completeness measure; unentered days are gaps worth chasing.",
    },
    // Partial-window discipline: fraction is always visible. Counts follow
    // the Service Calendar rule - no-service days drop out of both sides.
    // For fee-branch accounts, is_partial is `null` (completeness does not
    // apply) rather than `false` (which would assert "complete").
    days_with_actuals: daysWithActuals,
    total_service_days: totalServiceDays,
    no_service_days: noServiceDays,
    is_partial: isPartial,
    meals: {
      projected: totalProjectedMeals,
      actual: totalActualMeals,
    },
    revenue: revenueDeclineReason
      ? { available: false, decline_reason: revenueDeclineReason, unpriced_services: unpricedServices, fee_branch: isFeeBranch }
      : { available: true, projected: projectedRevenue, actual: actualRevenue, variance: (actualRevenue ?? 0) - (projectedRevenue ?? 0) },
    row_count: allRows.length,
  };
}

async function resolveWindowBounds(sb, accountKey, window, asOfDate) {
  if (window === "month") {
    const d = new Date(asOfDate + "T00:00:00Z");
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    return { ok: true, start_date: start, end_date: end, label: `${start.slice(0, 7)}` };
  }
  if (window === "homestand") {
    // Find the homestand containing asOfDate for the account. If none, walk
    // to the most recent PRIOR homestand (deliberate: "this homestand" mid-
    // gap defaults to the one just finished).
    const { data: rows } = await sb.from("v_current_homestand_by_account")
      .select("homestand_id, start_date, end_date")
      .eq("account_key", accountKey);
    if (rows && rows.length > 0) {
      const hs = rows[0];
      return { ok: true, start_date: hs.start_date, end_date: hs.end_date, label: hs.homestand_id };
    }
    // No current homestand today - find the most recent one that ended.
    const { data: prior } = await sb.from("sc_homestand_schedule")
      .select("homestand_id, service_date")
      .eq("account_key", accountKey)
      .not("homestand_id", "is", null)
      .lte("service_date", asOfDate)
      .order("service_date", { ascending: false })
      .limit(1);
    if (!prior || prior.length === 0) {
      return { ok: false, error: errorPayload(`no homestand data on file for ${accountKey}`) };
    }
    const priorHomestandId = prior[0].homestand_id;
    const { data: range } = await sb.from("sc_homestand_schedule")
      .select("service_date")
      .eq("account_key", accountKey)
      .eq("homestand_id", priorHomestandId)
      .order("service_date");
    return {
      ok: true,
      start_date: range[0].service_date,
      end_date: range[range.length - 1].service_date,
      label: `${priorHomestandId} (most recent; today is off-homestand for ${accountKey})`,
    };
  }
  if (window === "period") {
    const { data: rows } = await sb.from("v_current_period_by_account")
      .select("period, start_date, end_date")
      .eq("account_key", accountKey);
    if (rows && rows.length > 0) {
      const p = rows[0];
      // Period stored as bare number ("8") - normalize to "Period 8" for the
      // human label, matching sc_orientation's convention.
      const normalized = /^\d+$/.test(String(p.period)) ? `Period ${p.period}` : `Period ${p.period}`;
      return { ok: true, start_date: p.start_date, end_date: p.end_date, label: normalized };
    }
    return { ok: false, error: errorPayload(`no active period for ${accountKey} on ${asOfDate} (CORP has no service data; other accounts may be outside their season window)`) };
  }
  return { ok: false, error: errorPayload(`window=${window} not supported`) };
}

function errorPayload(msg) {
  return {
    source: "sc_daily_revenue",
    scope: "current-season Service Calendar",
    loaded: `PG live as of ${new Date().toISOString()}`,
    error: msg,
  };
}
