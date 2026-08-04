// ═══════════════════════════════════════════════════════════════════
// Backdate-impact reporter (2026-08-04, admin PR 1).
// ═══════════════════════════════════════════════════════════════════
//
// Reports what closed periods a backdated price or fee change would
// touch, plus a revenue delta for the price case. Does NOT refuse and
// does NOT decide policy - it yields to the caller (route handler +
// panel warning). The route composes the prose prefix from this
// report and writes; the panel warns before the operator confirms.
//
// Owner ruling 2026-08-04: warn and record, do not block. Everyone
// who can reach these paths is already the population the day-lock's
// SLT override exists for; blocking them in the UI would just move
// the same edits into SQL where they leave no reason field, no
// author, and no history. So the edits stay allowed and become
// impossible to do accidentally.
//
// Sibling but not sibling: `assertDaysUnlockedForWrite` in
// scPeriodLock.js refuses `sc_daily_actuals` writes on a locked day.
// This module warns on `sc_service_prices` / `sc_fee_schedule`
// writes whose effect reaches into a closed period. Different
// semantics, parallel paths - conflating them would weaken the day
// lock. See sc-25-period-lock.sql header for the day-lock's
// coverage statement (updated in this same PR to name the price /
// fee bypass).

import { getServiceClient } from "@/lib/supabase";

// Preview call ceiling. Owner ruling: ~1s cost is fine on the
// backdate-reaches-closed path (rare, deliberate, one moment where
// a second of latency is well spent). Beyond this, fall back to
// periods-only so the panel never stalls a legitimate edit.
const PREVIEW_TIMEOUT_MS = 1500;

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Describe the impact of a backdated price or fee change on closed periods.
 *
 * @param {Object} args
 * @param {"price" | "fee"} args.type
 * @param {string} args.accountKey
 * @param {string} args.effectiveDate       - YYYY-MM-DD, past
 * @param {string} [args.serviceId]         - required for type="price"
 * @param {number} [args.newPrice]          - required for type="price"
 * @returns {Promise<{
 *   closedPeriods: string[],          // ["4", "5"] bare-numeric per sc_day_metadata.period house convention (sc-21)
 *   affectedDayCount: number,         // days in interval with any projection or actual (0 when nothing to affect)
 *   revenueDeltaCents: number | null, // price only; null on fee, timeout, or error
 *   deltaSource: "full-preview" | "periods-only" | "unavailable"
 * }>}
 */
export async function describeBackdateImpact(args) {
  const { type, accountKey, effectiveDate, serviceId, newPrice } = args || {};
  if (!accountKey || !effectiveDate) {
    throw new Error("describeBackdateImpact: accountKey and effectiveDate required");
  }
  const today = isoToday();
  if (effectiveDate >= today) {
    // Scoping: only backdates can reach a closed period. Today and future
    // by construction cannot (current period is open; future periods have
    // not started). This is a hot-path shortcut, not a policy fence -
    // callers still control whether they invoke this helper.
    return {
      closedPeriods: [],
      affectedDayCount: 0,
      revenueDeltaCents: null,
      deltaSource: "periods-only",
    };
  }

  // Phase 1 - closed-period enumeration. Always runs. Cheap: two indexed
  // queries against sc_day_metadata and sc_is_period_closed.
  const closedReport = await enumerateClosedPeriods(accountKey, effectiveDate, today);
  if (closedReport.closedPeriods.length === 0 || type === "fee") {
    // Fee: sc_daily_revenue does not include fee amounts (fee accounts
    // carry price=0 services; contract-revenue lives in sc_fee_schedule
    // and is not per-day-multiplied). No sc_daily_revenue delta to
    // compute - the warning still names the closed periods and the day
    // count, which is the honest signal for the fee case. If a future
    // report needs a per-period fee-attribution figure, that is a
    // separate design question (proration + payment cadence).
    return {
      closedPeriods: closedReport.closedPeriods,
      affectedDayCount: closedReport.affectedDayCount,
      revenueDeltaCents: null,
      deltaSource: "periods-only",
    };
  }

  // Phase 2 - price delta via sc_daily_revenue. Best-effort; falls back
  // to periods-only on timeout or query error per owner ruling. NEVER
  // fails closed.
  if (!serviceId || newPrice == null || isNaN(Number(newPrice))) {
    throw new Error("describeBackdateImpact: type=\"price\" requires serviceId and newPrice");
  }
  try {
    const delta = await Promise.race([
      computePriceDeltaFromView(accountKey, serviceId, effectiveDate, Number(newPrice), today),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("preview timeout")), PREVIEW_TIMEOUT_MS)
      ),
    ]);
    return {
      closedPeriods: closedReport.closedPeriods,
      affectedDayCount: closedReport.affectedDayCount,
      revenueDeltaCents: delta,
      deltaSource: "full-preview",
    };
  } catch (err) {
    // Owner ruling: fall back to C, do not fail closed. A warning naming
    // the periods without a delta is worth shipping; a spinner that
    // blocks a legitimate edit is not.
    console.warn(`[scBackdateReport] delta preview failed; falling back to periods-only: ${err?.message || err}`);
    return {
      closedPeriods: closedReport.closedPeriods,
      affectedDayCount: closedReport.affectedDayCount,
      revenueDeltaCents: null,
      deltaSource: "periods-only",
    };
  }
}

// ─── Phase 1 helper ─────────────────────────────────────────────────
async function enumerateClosedPeriods(accountKey, startDate, endDate) {
  const supa = getServiceClient();

  // Days in the interval that carry a period tag. Missing-period rows
  // (nulls) do not contribute to closedness - a period must exist to be
  // closed. Also emits the day count so the panel can name the number
  // of days that fall inside a closed period specifically.
  const { data: metaRows, error: metaErr } = await supa
    .from("sc_day_metadata")
    .select("period, service_date")
    .eq("account_key", accountKey)
    .gte("service_date", startDate)
    .lte("service_date", endDate)
    .not("period", "is", null);
  if (metaErr) throw new Error(`sc_day_metadata lookup failed: ${metaErr.message}`);

  const uniquePeriods = [...new Set((metaRows || []).map(r => String(r.period)))];
  if (uniquePeriods.length === 0) {
    return { closedPeriods: [], affectedDayCount: 0 };
  }

  // One RPC per unique period. Same pattern assertDaysUnlockedForWrite
  // uses (Promise.all keeps latency at max-single-call). Interval sizes
  // are typically <=13 periods per fiscal year.
  const closedResults = await Promise.all(
    uniquePeriods.map(p =>
      supa.rpc("sc_is_period_closed", { p_account_key: accountKey, p_period: p })
    )
  );
  const closedPeriods = [];
  for (let i = 0; i < uniquePeriods.length; i++) {
    const { data, error } = closedResults[i];
    if (error) throw new Error(`sc_is_period_closed(${uniquePeriods[i]}) failed: ${error.message}`);
    if (data === true) closedPeriods.push(uniquePeriods[i]);
  }
  closedPeriods.sort((a, b) => Number(a) - Number(b));

  // Affected day count = days in the interval whose period is closed.
  // Filter the metaRows against the closed set.
  const closedSet = new Set(closedPeriods);
  const affectedDayCount = (metaRows || []).filter(r => closedSet.has(String(r.period))).length;

  return { closedPeriods, affectedDayCount };
}

// ─── Phase 2 helper - price delta from sc_daily_revenue ─────────────
//
// Reads per-day rows from `sc_daily_revenue` for the affected interval
// and computes the revenue delta using the view's own formula
// (projected_revenue = projected_count * price_at_date), substituting
// the new price. Rationale in detail:
//
// This is NOT the "independent-sum" pattern owner has removed four
// times this month. Those defects were places where code independently
// derived a total that the view also derives, and drifted from the
// view's semantics. Here we read the view's emitted `projected_count`,
// `projected_revenue`, `actual_count`, `actual_revenue`, and
// `actual_price_effective_date` directly, and the delta is computed
// as `new_revenue = count * newPrice`, where `count` is the view's
// emitted count and `count * newPrice` reproduces the view's own
// arithmetic with a substituted price. delta = new_revenue - (view's
// emitted revenue). The formula stays anchored to the view; only the
// price parameter changes.
//
// The "read sc_daily_revenue" ruling is honored: every input above
// (projected_count, actual_count, projected_revenue, actual_revenue,
// price_effective_date, actual_price_effective_date, is_non_revenue)
// comes from the view. If the view's formula changes in the future,
// this helper's arithmetic tracks it by construction because the
// inputs shift with it.
//
// A Postgres FUNCTION that opens a transaction, inserts the
// hypothetical price row, SELECTs the view, and rolls back would be
// even more literal ("read sc_daily_revenue" with the row present),
// but that is a migration owner has not yet ruled on. If this
// approach reads wrong, the follow-up is a `sc_backdate_preview()`
// function - migration file only, no schema-shape change beyond
// adding a callable.
async function computePriceDeltaFromView(accountKey, serviceId, effectiveDate, newPrice, today) {
  const supa = getServiceClient();

  // Ceiling: the day BEFORE the next existing sc_service_prices row
  // with effective_date > effectiveDate for this service, or today,
  // whichever is earlier. On days at or after the ceiling, some later
  // price row already wins, so the new (backdated) row does not
  // affect them.
  const { data: nextPriceRows, error: nextErr } = await supa
    .from("sc_service_prices")
    .select("effective_date")
    .eq("service_id", serviceId)
    .eq("price_kind", "projected")
    .gt("effective_date", effectiveDate)
    .order("effective_date", { ascending: true })
    .limit(1);
  if (nextErr) throw new Error(`sc_service_prices ceiling lookup failed: ${nextErr.message}`);
  let ceiling = today;
  if (nextPriceRows && nextPriceRows.length > 0) {
    // Ceiling = day before the next existing row. The next row wins on
    // its own effective_date onward; days STRICTLY before it are where
    // the new backdated row wins.
    const next = nextPriceRows[0].effective_date;
    const nextDate = new Date(next + "T00:00:00Z");
    nextDate.setUTCDate(nextDate.getUTCDate() - 1);
    const prevDay = nextDate.toISOString().slice(0, 10);
    if (prevDay < ceiling) ceiling = prevDay;
  }
  if (ceiling < effectiveDate) {
    // Backdated effective date lies AFTER a later row - the backdate is
    // dominated everywhere. No delta.
    return 0;
  }

  // Pull per-day view rows for the affected interval on this service.
  // Filter to days with either projected or actual data - days with
  // neither cannot contribute to the delta.
  const { data: dayRows, error: dayErr } = await supa
    .from("sc_daily_revenue")
    .select(
      "service_date, projected_count, actual_count, projected_revenue, actual_revenue, actual_price_effective_date, is_non_revenue"
    )
    .eq("account_key", accountKey)
    .eq("service_id", serviceId)
    .gte("service_date", effectiveDate)
    .lte("service_date", ceiling);
  if (dayErr) throw new Error(`sc_daily_revenue read failed: ${dayErr.message}`);

  let deltaCents = 0;
  for (const row of dayRows || []) {
    if (row.is_non_revenue) continue;
    const projectedCount = Number(row.projected_count || 0);
    const actualCount = Number(row.actual_count || 0);
    const projectedRevenue = Number(row.projected_revenue || 0);
    const actualRevenue = Number(row.actual_revenue || 0);

    // Projected side always shifts (backdated row is price_kind='projected').
    const newProjectedRevenue = projectedCount * newPrice;
    deltaCents += Math.round((newProjectedRevenue - projectedRevenue) * 100);

    // Actual side shifts only when the view's actual LATERAL fell back
    // to the projected price (i.e., no separate 'actual' price row for
    // this day-service pair - the common case). Detection: the view
    // exposes actual_price_effective_date; NULL means no actual-kind
    // row existed and the COALESCE in sc-8b-actual-prices-and-view.sql
    // line 269 fell through to pr_proj.price.
    if (row.actual_price_effective_date == null) {
      const newActualRevenue = actualCount * newPrice;
      deltaCents += Math.round((newActualRevenue - actualRevenue) * 100);
    }
  }

  return deltaCents;
}

// ═══════════════════════════════════════════════════════════════════
// Prose prefix composition (owner ruling: no JSONB column, no schema).
// ═══════════════════════════════════════════════════════════════════
//
// Format (documented so a future migration COULD parse it if the audit
// consumer ever needs it structurally):
//
//   [Backdate touched closed period P4, 43 days ($-1234.56)] reason
//   [Backdate touched closed periods P4, P5, 43 days (delta unavailable)] reason
//   [Backdate touched closed period P4, 43 days] reason
//
// Rules:
//   - Prefix is opened by a literal `[Backdate touched closed period`
//     token followed by "s" for plural.
//   - Period list is `P<num>` separated by ", "; num is bare-numeric
//     per sc-21 house convention (sc_day_metadata.period).
//   - Day count is `<count> day` singular / `<count> days` plural.
//   - Delta segment is optional. When present, formatted as
//     ` ($<signed-dollars>)`. Absent when revenueDeltaCents is null
//     (fee, timeout, or fallback).
//   - Closes with `]` then space, then the operator's typed reason.
//   - Composed string is capped at 280 chars to match the schema
//     CHECK on sc_config_changelog.reason. If it would exceed, the
//     operator's tail is truncated with `…` (the prefix is
//     load-bearing).
//
// Server composes this. Client MUST NOT send this shape - if the
// server sees a client-submitted reason that already opens with this
// prefix, the server strips the client-authored prefix before
// prepending its own (defense against forgery).

const PREFIX_HEAD = "[Backdate touched closed period";
const PREFIX_END = "]";
const CHANGELOG_REASON_MAX = 280;
const TRUNCATE_MARK = "…";

/**
 * Compose the server-authored prose prefix + the operator's reason.
 *
 * @param {Object} args
 * @param {string[]} args.closedPeriods       - bare-numeric period keys, sorted
 * @param {number} args.affectedDayCount
 * @param {number | null} args.revenueDeltaCents - null omits the delta segment
 * @param {string} args.operatorReason
 * @returns {string}                         - reason + prefix, capped at 280
 */
export function composeBackdateReason({ closedPeriods, affectedDayCount, revenueDeltaCents, operatorReason }) {
  const cleanOperator = stripClientAuthoredPrefix(String(operatorReason || "").trim());
  if (!closedPeriods || closedPeriods.length === 0) {
    return cleanOperator;
  }
  const plural = closedPeriods.length === 1 ? "" : "s";
  const periodList = closedPeriods.map(p => `P${p}`).join(", ");
  const dayWord = affectedDayCount === 1 ? "day" : "days";
  let deltaSegment = "";
  if (revenueDeltaCents != null && Number.isFinite(revenueDeltaCents)) {
    const dollars = revenueDeltaCents / 100;
    const sign = dollars >= 0 ? "+" : "-";
    const abs = Math.abs(dollars).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    deltaSegment = ` (${sign}$${abs})`;
  }
  const prefix = `${PREFIX_HEAD}${plural} ${periodList}, ${affectedDayCount} ${dayWord}${deltaSegment}${PREFIX_END} `;
  const composed = prefix + cleanOperator;
  if (composed.length <= CHANGELOG_REASON_MAX) return composed;
  // Prefix is load-bearing (the audit signal); truncate the operator tail.
  const roomForOperator = CHANGELOG_REASON_MAX - prefix.length - TRUNCATE_MARK.length;
  if (roomForOperator <= 0) {
    // Extreme edge case (very many closed periods). Truncate the whole
    // composed string with the mark - prefix takes what it needs.
    return composed.slice(0, CHANGELOG_REASON_MAX - TRUNCATE_MARK.length) + TRUNCATE_MARK;
  }
  return prefix + cleanOperator.slice(0, roomForOperator) + TRUNCATE_MARK;
}

// Defense: if a client-submitted reason already opens with the prefix
// token, strip that leading segment so the server's fresh prefix is
// authoritative. Cannot rely on client honesty for an audit field.
function stripClientAuthoredPrefix(reason) {
  if (!reason.startsWith(PREFIX_HEAD)) return reason;
  const closeIdx = reason.indexOf(PREFIX_END);
  if (closeIdx === -1) return reason;
  return reason.slice(closeIdx + 1).trimStart();
}
