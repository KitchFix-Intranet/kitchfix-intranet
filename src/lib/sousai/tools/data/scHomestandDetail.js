// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/scHomestandDetail.js
// SousAI data tool B2: homestand day-by-day detail.
//
// "What's projected vs actual on TBJ-FL's current homestand? Day by day."
//
// Reads sc_daily_revenue joined against sc_homestand_schedule for membership.
// **Always returns rows** (never aggregate) capped at B2_ROW_CAP with honest
// truncation. B1 is the aggregate tool - the two shapes never cross.
//
// Missing-price and has_actuals discipline:
//   - has_actuals=false days render with a distinct marker (`actual_meals=null`,
//     `actual_revenue=null`, `has_actuals=false`), never as 0. A no-entry day
//     is the whole reason this tool exists - to surface entry gaps.
//   - Rows where price_effective_date IS NULL carry `revenue_available=false`
//     with the reason (no configured price). Meal counts still land.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { B2_ROW_CAP } from "./_constants.js";

const VALID_REFS = ["current", "next", "previous"];

/**
 * @param {object} args
 * @param {string} args.accountKey - e.g. "TBJ - FL"
 * @param {"current"|"next"|"previous"|string} [args.homestandRef="current"] - or an ISO date within the target homestand
 * @returns {Promise<object>}
 */
export async function scHomestandDetail({ accountKey, homestandRef = "current" } = {}) {
  if (!accountKey || typeof accountKey !== "string") {
    return errorPayload("accountKey is required (e.g. 'TBJ - FL')");
  }
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(homestandRef);
  if (!isDate && !VALID_REFS.includes(homestandRef)) {
    return errorPayload(`homestandRef must be one of ${VALID_REFS.join(", ")} or a YYYY-MM-DD date`);
  }

  const sb = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // Resolve the target homestand by finding a service_date that identifies it.
  const targetDate = isDate ? homestandRef : today;
  let hsQuery = sb.from("sc_homestand_schedule")
    .select("homestand_id, service_date")
    .eq("account_key", accountKey)
    .not("homestand_id", "is", null);

  let homestandId = null;
  let refLabel = homestandRef;

  if (homestandRef === "current" || isDate) {
    const { data: rows } = await hsQuery
      .lte("service_date", targetDate)
      .order("service_date", { ascending: false })
      .limit(1);
    if (!rows || rows.length === 0) {
      return errorPayload(`no homestand row found for ${accountKey} on or before ${targetDate}. Homestand may not have started yet, or this account has no homestand schedule.`);
    }
    // Verify this is actually today's homestand (not a prior one that already ended)
    const candidate = rows[0].homestand_id;
    const { data: rangeCheck } = await sb.from("sc_homestand_schedule")
      .select("service_date")
      .eq("account_key", accountKey)
      .eq("homestand_id", candidate)
      .order("service_date");
    const start = rangeCheck[0].service_date;
    const end = rangeCheck[rangeCheck.length - 1].service_date;
    if (homestandRef === "current" && (targetDate < start || targetDate > end)) {
      // Today is not IN this homestand; caller asked for "current" but there
      // isn't one right now. Return note without rows.
      return {
        source: "sc_daily_revenue + sc_homestand_schedule",
        scope: "current-season Service Calendar",
        loaded: `PG live as of ${new Date().toISOString()}`,
        parameters: { accountKey, homestandRef, resolved_date: targetDate },
        homestand_id: null,
        rows: [],
        row_count: 0,
        truncated: false,
        note: `no current homestand for ${accountKey} today. Most recent was ${candidate} (${start} to ${end}). Try homestandRef='previous' or a specific date.`,
      };
    }
    homestandId = candidate;
  } else if (homestandRef === "next") {
    const { data: rows } = await hsQuery
      .gt("service_date", today)
      .order("service_date", { ascending: true })
      .limit(1);
    if (!rows || rows.length === 0) {
      return errorPayload(`no upcoming homestand for ${accountKey}`);
    }
    homestandId = rows[0].homestand_id;
  } else if (homestandRef === "previous") {
    // Prior homestand strictly before today
    const { data: rows } = await hsQuery
      .lt("service_date", today)
      .order("service_date", { ascending: false })
      .limit(1);
    if (!rows || rows.length === 0) {
      return errorPayload(`no prior homestand for ${accountKey}`);
    }
    homestandId = rows[0].homestand_id;
  }

  // Now get the full date range of this homestand
  const { data: hsRange } = await sb.from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, game_time, day_night")
    .eq("account_key", accountKey)
    .eq("homestand_id", homestandId)
    .order("service_date");
  if (!hsRange || hsRange.length === 0) {
    return errorPayload(`homestand ${homestandId} has no schedule rows`);
  }
  const startDate = hsRange[0].service_date;
  const endDate = hsRange[hsRange.length - 1].service_date;

  // Fetch per-service revenue rows in the range
  const { data: revenueRows, error } = await sb.from("sc_daily_revenue")
    .select("service_date, service_id, service_name, group_name, is_non_revenue, projected_count, actual_count, has_actuals, has_projection, price_at_date, price_effective_date, projected_revenue, actual_revenue")
    .eq("account_key", accountKey)
    .gte("service_date", startDate)
    .lte("service_date", endDate)
    .order("service_date, service_name");
  if (error) throw new Error(`scHomestandDetail: query failed: ${error.code || "?"} ${error.message}`);

  const hsIndex = new Map(hsRange.map((r) => [r.service_date, r]));

  const rows = (revenueRows || []).map((r) => {
    const priceMissing = r.price_effective_date == null && !r.is_non_revenue;
    return {
      service_date: r.service_date,
      day_type: hsIndex.get(r.service_date)?.day_type ?? null,
      opponent: hsIndex.get(r.service_date)?.opponent ?? null,
      service_id: r.service_id,
      service_name: r.service_name,
      group: r.group_name,
      projected_meals: r.projected_count == null ? 0 : Number(r.projected_count),
      // has_actuals=false: actual_meals is NULL not 0 - distinct from a real zero-meal day.
      actual_meals: r.has_actuals ? Number(r.actual_count) : null,
      has_actuals: !!r.has_actuals,
      revenue_available: !priceMissing,
      projected_revenue: priceMissing ? null : Number(r.projected_revenue) || 0,
      actual_revenue: priceMissing ? null : (r.has_actuals ? Number(r.actual_revenue) || 0 : null),
      revenue_decline_reason: priceMissing ? "no configured price for this service on this date (price_effective_date IS NULL)" : null,
    };
  });

  const total = rows.length;
  const truncated = total > B2_ROW_CAP;
  const capped = truncated ? rows.slice(0, B2_ROW_CAP) : rows;

  // Rollup counters
  const unpricedRowCount = rows.filter((r) => !r.revenue_available).length;
  const noEntryDayCount = new Set(rows.filter((r) => !r.has_actuals).map((r) => r.service_date)).size;
  const totalDays = new Set(rows.map((r) => r.service_date)).size;

  const result = {
    source: "sc_daily_revenue + sc_homestand_schedule",
    scope: "current-season Service Calendar",
    loaded: `PG live as of ${new Date().toISOString()}`,
    parameters: { accountKey, homestandRef },
    homestand_id: homestandId,
    date_range: { start: startDate, end: endDate },
    total_days: totalDays,
    days_without_actuals: noEntryDayCount,
    rows_unpriced: unpricedRowCount,
    row_count: total,
    truncated,
    rows: capped,
  };
  if (unpricedRowCount > 0) {
    result.note = `${unpricedRowCount} row(s) have no configured price and are excluded from any revenue total. Meal counts still land. See rows[].revenue_available.`;
  }
  if (noEntryDayCount > 0) {
    result.note_actuals = `${noEntryDayCount} of ${totalDays} days in this homestand have no actuals entered. Those rows carry actual_meals=null (distinct from a zero-meal day).`;
  }
  if (truncated) {
    result.note_truncation = `showing ${B2_ROW_CAP} of ${total} rows`;
  }
  return result;
}

function errorPayload(msg) {
  return {
    source: "sc_daily_revenue + sc_homestand_schedule",
    scope: "current-season Service Calendar",
    loaded: `PG live as of ${new Date().toISOString()}`,
    error: msg,
  };
}
