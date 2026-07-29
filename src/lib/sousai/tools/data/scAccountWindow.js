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

  const totalServiceDays = new Set(allRows.map((r) => r.service_date)).size;
  const daysWithActuals = new Set(allRows.filter((r) => r.has_actuals).map((r) => r.service_date)).size;

  // Revenue totals only when every revenue-bearing row has a price.
  let projectedRevenue = null;
  let actualRevenue = null;
  let revenueDeclineReason = null;
  const unpricedServices = [...new Set(unpriced.map((r) => `${r.service_name} (id ${r.service_id})`))];

  if (unpriced.length === 0) {
    projectedRevenue = priced.reduce((s, r) => s + (Number(r.projected_revenue) || 0), 0);
    actualRevenue = priced.filter((r) => r.has_actuals)
      .reduce((s, r) => s + (Number(r.actual_revenue) || 0), 0);
  } else {
    revenueDeclineReason = `${unpricedServices.length} service(s) in this window have no configured price on their service_date. A revenue total cannot be produced without those prices. Unpriced: ${unpricedServices.join(", ")}. The price_effective_date is NULL for these rows in sc_daily_revenue.`;
  }

  return {
    source: "sc_daily_revenue" + (window === "month" ? " (+ sc_month_summary spot-check)" : ""),
    scope: "current-season Service Calendar. Revenue excludes is_non_revenue services (Fun Money etc.); meal counts include all services.",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { accountKey, window, asOf: asOfDate },
    window_boundaries: { start_date: bounds.start_date, end_date: bounds.end_date, label: bounds.label },
    // Partial-window discipline: fraction is always visible.
    days_with_actuals: daysWithActuals,
    total_service_days: totalServiceDays,
    is_partial: daysWithActuals < totalServiceDays,
    meals: {
      projected: totalProjectedMeals,
      actual: totalActualMeals,
    },
    revenue: revenueDeclineReason
      ? { available: false, decline_reason: revenueDeclineReason, unpriced_services: unpricedServices }
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
