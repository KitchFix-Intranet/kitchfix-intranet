// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/scPortfolioWindow.js
// SousAI data tool B1p (portfolio): sc_account_window's sibling, but for
// EVERY account in ONE call.
//
// The motivating live failure (2026-08-03): Kevin asked "total amount of
// breakfast served per account in feb." Sous fanned out one sc_account_
// window call per account, exhausted the tool budget at six of eleven, and
// shipped a partial answer naming the five accounts it never reached. This
// tool ends that class of failure. Every "X across all accounts" question
// - the most natural question an ops director asks - runs on one query.
//
// Inheritance:
//   Every rule in scAccountWindow.js applies per-row here VERBATIM. Read
//   that tool's header comment before extending this one. The rules that
//   matter most in the portfolio shape:
//     - Missing-price rule: unpriced services in-window decline the revenue
//       total for THAT account and name the offending services. Never
//       silently zero.
//     - Fee-branch rule: billing_model==='flat_fee' AND
//       has_homestand_schedule=true means revenue is declined with a
//       pointer to REF-141 and the account's REC record. is_partial is
//       null (completeness does not apply), not false.
//     - STL - FL trap: flat_fee but has_homestand_schedule=false → per-
//       meal branch. Both halves of the predicate matter.
//     - No-service days drop out of both numerator and denominator.
//     - Account keys verbatim ("STL - FL" with spaces).
//     - Truthful absence: an account with total_service_days=0 is
//       distinguishable from an account with days_with_actuals=0 and a
//       real total. Rows for both are emitted.
//
// Query shape: one sb.from("sc_daily_revenue")... .in("account_key", [...])
// call for the window, then group in JS. Twelve accounts x one month is
// well under any cap (~1000 rows/month typical - see the paginationNote
// probe in registry.js).
//
// serviceType filter (Kevin's Part 2): optional enum
// 'breakfast'|'lunch'|'dinner'|'snack'. Substring-match on service_name
// (case-insensitive). Catalog probe 2026-08-04: no clean type column
// exists; 44 distinct service names include variants like "Breakfast -
// MiLB", "Breakfast - ST", "Continental Breakfast", "Pre-Game Snack".
// The mapping is documented in tool description and returned in
// `serviceTypeMatched` so the caller can verify.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { pgLiveNow } from "../_freshness.js";
import { partitionRevenueRows, paginateAll } from "./_constants.js";

const VALID_WINDOWS = ["month", "homestand", "period"];
const VALID_SERVICE_TYPES = ["breakfast", "lunch", "dinner", "snack"];

// serviceType → case-insensitive substring on service_name. Probe on
// 2026-08-04 confirmed the mapping: "Breakfast" matches Breakfast +
// Breakfast - MiLB + Breakfast - MiLB ST + Breakfast - ST + Continental
// Breakfast (5 catalog variants). "Snack" matches Regular / Pre-Game /
// Pre-Game Hot / Snack. Kevin's ruling: mapping stays in the tool, not
// in the prompt or the caller.
const SERVICE_TYPE_MATCHERS = {
  breakfast: /breakfast/i,
  lunch: /\blunch\b/i,
  dinner: /\bdinner\b/i,
  snack: /snack/i,
};

/**
 * @param {object} args
 * @param {"month"|"homestand"|"period"} [args.window="month"]
 * @param {string} [args.asOf] - YYYY-MM-DD; defaults to today
 * @param {"breakfast"|"lunch"|"dinner"|"snack"} [args.serviceType]
 * @returns {Promise<object>}
 */
export async function scPortfolioWindow({ window = "month", asOf, serviceType } = {}) {
  if (!VALID_WINDOWS.includes(window)) {
    return errorPayload(`window must be one of: ${VALID_WINDOWS.join(", ")}`);
  }
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return errorPayload(`asOf must be YYYY-MM-DD, got '${asOfDate}'`);
  }
  if (serviceType && !VALID_SERVICE_TYPES.includes(serviceType)) {
    return errorPayload(`serviceType must be one of: ${VALID_SERVICE_TYPES.join(", ")} (or omit for all-services)`);
  }

  const sb = getSupabase();

  // 1. Account roster + shape for classifier branching. accounts is a
  // 12-row current-season snapshot; a single select carries everything
  // the per-row loop below needs (billing_model + has_homestand_schedule
  // for the fee-branch predicate).
  const { data: accountRows, error: acctErr } = await sb
    .from("accounts")
    .select("team_key, billing_model, has_homestand_schedule, level")
    .order("team_key");
  if (acctErr) throw new Error(`scPortfolioWindow: accounts fetch failed: ${acctErr.code || "?"} ${acctErr.message}`);
  const accountKeys = accountRows.map((a) => a.team_key);

  // 2. Resolve window boundaries. For 'month' the boundaries are the same
  // across accounts (calendar month), so one range serves everyone. For
  // 'homestand' and 'period' the boundaries vary per-account (a homestand
  // is by-account, a period is by-account) - one query PER WINDOW SHAPE
  // per account is acceptable per Kevin's spec: "never one per account"
  // rules out N single-account fan-outs, not the per-window boundary
  // lookup that any implementation has to do.
  //
  // For homestand and period this means a small burst of view reads (one
  // per account for the boundary lookup, plus one big daily_revenue
  // query keyed by the (account_key, [start, end]) tuples). Twelve
  // accounts x one homestand-boundary read is far under any cap. Room
  // for a later refactor into a single view that carries all-account
  // boundaries per window, out of scope this round.
  const perAcctBounds = await resolveAllBounds(sb, accountKeys, window, asOfDate);
  // Errors landed in perAcctBounds.errors; keys with resolvable windows
  // land in perAcctBounds.ok[accountKey] = { start_date, end_date, label }.

  const okAccountKeys = accountKeys.filter((k) => perAcctBounds.ok[k]);

  // 3. Fetch every daily_revenue row for every account in-window in a
  // single query. For 'month' every account shares the same date range,
  // so a single .gte/.lte + .in("account_key", ...) is enough. For
  // 'homestand' / 'period', boundaries differ per account so we OR the
  // per-account (account_key, service_date range) predicates via
  // .or(). Supabase's .or() takes a comma-separated string; we build it
  // from the resolved boundaries.
  // Portfolio scope on a busy month can top 2,500 rows (probe 2026-08-04:
  // May 2026 = 2,755 rows across all 12 accounts). Above Supabase's
  // default single-select 1000-row cap, so we paginate every read.
  const SELECT_COLS = "account_key, service_date, service_id, service_name, group_name, is_flat_fee, is_tax_free, is_non_revenue, projected_count, actual_count, has_actuals, has_projection, price_at_date, price_effective_date, projected_revenue, actual_revenue";
  // Ordering across pages MUST be stable - `.order("service_date")` alone
  // straddles rows with identical service_date across page boundaries and
  // yields duplicates on one side and gaps on the other (2026-08-04 parity
  // smoke: CIN - AZ August portfolio scan returned 405 rows for 401
  // distinct (date, service_id) combos = 4 dupes = +60 phantom meals).
  // Adding account_key + service_id as tiebreakers gives a total order,
  // so each row lands on exactly one page. Any select-list column will
  // do as long as the composite key is unique per row; (service_date,
  // account_key, service_id) is a natural business key for this table.
  const stableOrder = (q) => q.order("service_date").order("account_key").order("service_id");
  const allRows = window === "month"
    ? await (async () => {
        // Every account shares the same month; a single account_key IN
        // + date range serves all with pagination.
        const anyBounds = perAcctBounds.ok[okAccountKeys[0]];
        return paginateAll((from, to) => stableOrder(sb.from("sc_daily_revenue")
          .select(SELECT_COLS)
          .in("account_key", okAccountKeys)
          .gte("service_date", anyBounds.start_date)
          .lte("service_date", anyBounds.end_date))
          .range(from, to));
      })()
    : await (async () => {
        // Per-account bounds differ. Use .or() with per-account
        // (account_key AND range) predicates. Paginated the same way.
        const clauses = okAccountKeys.map((k) => {
          const b = perAcctBounds.ok[k];
          return `and(account_key.eq.${k},service_date.gte.${b.start_date},service_date.lte.${b.end_date})`;
        });
        return paginateAll((from, to) => stableOrder(sb.from("sc_daily_revenue")
          .select(SELECT_COLS)
          .or(clauses.join(",")))
          .range(from, to));
      })();

  // 4. Optional serviceType filter (case-insensitive substring on
  // service_name). Applied post-query for clarity; the row set is
  // small (~2500 rows / month at portfolio scope). If serviceType is
  // supplied, we ALSO surface the distinct service names that matched
  // so the caller can verify which catalog variants were included.
  const matcher = serviceType ? SERVICE_TYPE_MATCHERS[serviceType] : null;
  const filteredRows = matcher
    ? (allRows || []).filter((r) => r.service_name && matcher.test(r.service_name))
    : (allRows || []);
  const serviceTypeMatched = matcher
    ? [...new Set(filteredRows.map((r) => r.service_name))].sort()
    : null;

  // 5. Group rows by account and compute per-row summary. Each account's
  // rules are the same as scAccountWindow: fee-branch classifier, no-
  // service day accounting, missing-price revenue decline.
  const rowsByAccount = new Map();
  for (const r of filteredRows) {
    let arr = rowsByAccount.get(r.account_key);
    if (!arr) { arr = []; rowsByAccount.set(r.account_key, arr); }
    arr.push(r);
  }

  const accounts = [];
  for (const acct of accountRows) {
    const key = acct.team_key;
    const bounds = perAcctBounds.ok[key];
    // Account with no resolvable window (e.g. CORP with no service data,
    // or an account outside its season window) surfaces as an explicit
    // absence entry rather than being silently omitted. Prompt line 8
    // (numeric receipt) and the runtime backstop both benefit from
    // seeing "no window" as an explicit row rather than a missing key.
    if (!bounds) {
      accounts.push({
        account_key: key,
        billing_model: acct.billing_model,
        has_homestand_schedule: !!acct.has_homestand_schedule,
        level: acct.level,
        window_available: false,
        window_reason: perAcctBounds.errors[key] || "no window resolvable for this account",
        meals: { projected: 0, actual: 0 },
        revenue: { available: false, decline_reason: "window did not resolve" },
        days_with_actuals: 0,
        total_service_days: 0,
        no_service_days: 0,
        is_partial: null,
      });
      continue;
    }
    accounts.push(summarizeAccount(acct, bounds, rowsByAccount.get(key) || []));
  }

  // Roll-ups across accounts with resolvable windows. Meal counts always
  // sum. Revenue sums only over rows where revenue.available=true;
  // unpriced-service or fee-branch accounts contribute null and are
  // named separately so the caller can quote a total that doesn't lie
  // about the scope of what it covers.
  const revenueAvailable = accounts.filter((a) => a.revenue && a.revenue.available);
  const revenueUnavailable = accounts.filter((a) => a.revenue && !a.revenue.available && a.window_available);
  const portfolioMealsProjected = accounts.reduce((s, a) => s + (a.meals?.projected || 0), 0);
  const portfolioMealsActual = accounts.reduce((s, a) => s + (a.meals?.actual || 0), 0);
  const portfolioRevenueProjected = revenueAvailable.reduce((s, a) => s + (a.revenue.projected || 0), 0);
  const portfolioRevenueActual = revenueAvailable.reduce((s, a) => s + (a.revenue.actual || 0), 0);

  return {
    source: "sc_daily_revenue + accounts",
    scope: `current-season Service Calendar, all ${accountKeys.length} accounts. Revenue excludes is_non_revenue services and any account whose revenue declined per per-row rules.`,
    loaded: pgLiveNow(),
    parameters: { window, asOf: asOfDate, serviceType: serviceType || null },
    service_type_matched: serviceTypeMatched,
    accounts,
    portfolio_totals: {
      // Meal counts always available - no unpriced/fee-branch caveat applies.
      meals: { projected: portfolioMealsProjected, actual: portfolioMealsActual },
      // Revenue portfolio total covers only revenue-available accounts.
      // The two revenue_unavailable lists tell the caller which accounts
      // were excluded from the sum and why - so a caller quoting the
      // portfolio revenue knows the exact scope.
      revenue: {
        available_accounts: revenueAvailable.map((a) => a.account_key),
        projected: portfolioRevenueProjected,
        actual: portfolioRevenueActual,
        variance: portfolioRevenueActual - portfolioRevenueProjected,
      },
      revenue_unavailable: revenueUnavailable.map((a) => ({
        account_key: a.account_key,
        reason: a.revenue.decline_reason,
      })),
      accounts_without_window: accounts.filter((a) => !a.window_available).map((a) => ({
        account_key: a.account_key,
        reason: a.window_reason,
      })),
    },
    row_count: accounts.length,
  };
}

// Per-row summarizer. Mirrors scAccountWindow's rules line-for-line so a
// portfolio row is bit-for-bit equivalent to what the single-account tool
// would return for that account + window. Parity test in the harness
// asserts this equivalence.
function summarizeAccount(acct, bounds, rows) {
  const revenueRows = rows.filter((r) => !r.is_non_revenue);
  const { priced, unpriced } = partitionRevenueRows(revenueRows);
  const allRows = rows;

  const totalProjectedMeals = allRows.reduce((s, r) => s + (Number(r.projected_count) || 0), 0);
  const totalActualMeals = allRows.reduce((s, r) => s + (r.has_actuals ? (Number(r.actual_count) || 0) : 0), 0);

  // No-service day accounting mirrors scAccountWindow verbatim.
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

  const isFeeBranch = acct.billing_model === "flat_fee" && !!acct.has_homestand_schedule;
  const totalServiceDays = actionableDays;
  const daysWithActuals = enteredDays;
  const isPartial = isFeeBranch ? null : daysWithActuals < totalServiceDays;

  let projectedRevenue = null;
  let actualRevenue = null;
  let revenueDeclineReason = null;
  const unpricedServices = [...new Set(unpriced.map((r) => `${r.service_name} (id ${r.service_id})`))];

  if (isFeeBranch) {
    revenueDeclineReason = `${acct.team_key} is a fee-branch account (billing_model='flat_fee' + has_homestand_schedule=true). The contracted fee does not move with meal counts, so meals * per-meal price is not the revenue figure. The fee lives in REF-141 (Billing Model Quick Reference) and the account's REC record, not in any queryable table.`;
  } else if (unpriced.length === 0) {
    projectedRevenue = priced.reduce((s, r) => s + (Number(r.projected_revenue) || 0), 0);
    actualRevenue = priced.filter((r) => r.has_actuals)
      .reduce((s, r) => s + (Number(r.actual_revenue) || 0), 0);
  } else {
    revenueDeclineReason = `${unpricedServices.length} service(s) in this window have no configured price on their service_date. A revenue total cannot be produced without those prices. Unpriced: ${unpricedServices.join(", ")}. The price_effective_date is NULL for these rows in sc_daily_revenue.`;
  }

  return {
    account_key: acct.team_key,
    billing_model: acct.billing_model,
    has_homestand_schedule: !!acct.has_homestand_schedule,
    level: acct.level,
    window_available: true,
    window_boundaries: { start_date: bounds.start_date, end_date: bounds.end_date, label: bounds.label },
    classifier_branch: isFeeBranch ? "fee" : "per_meal",
    days_with_actuals: daysWithActuals,
    total_service_days: totalServiceDays,
    no_service_days: noServiceDays,
    is_partial: isPartial,
    meals: { projected: totalProjectedMeals, actual: totalActualMeals },
    revenue: revenueDeclineReason
      ? { available: false, decline_reason: revenueDeclineReason, unpriced_services: unpricedServices, fee_branch: isFeeBranch }
      : { available: true, projected: projectedRevenue, actual: actualRevenue, variance: (actualRevenue ?? 0) - (projectedRevenue ?? 0) },
    row_count: allRows.length,
  };
}

// Boundary resolution per account. For 'month' the answer is identical
// across accounts (calendar month); we still resolve per-key so the
// error map has a per-account slot for downstream shape. For
// 'homestand' and 'period' the answer varies (a homestand is by-
// account, a period is by-account).
async function resolveAllBounds(sb, accountKeys, window, asOfDate) {
  const ok = {};
  const errors = {};

  if (window === "month") {
    const d = new Date(asOfDate + "T00:00:00Z");
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    const label = start.slice(0, 7);
    for (const k of accountKeys) ok[k] = { start_date: start, end_date: end, label };
    return { ok, errors };
  }

  if (window === "period") {
    const { data: rows, error } = await sb.from("v_current_period_by_account")
      .select("account_key, period, start_date, end_date");
    if (error) throw new Error(`scPortfolioWindow: v_current_period_by_account fetch failed: ${error.code || "?"} ${error.message}`);
    for (const k of accountKeys) {
      const p = (rows || []).find((r) => r.account_key === k);
      if (p) ok[k] = { start_date: p.start_date, end_date: p.end_date, label: /^\d+$/.test(String(p.period)) ? `Period ${p.period}` : `Period ${p.period}` };
      else errors[k] = `no active period for ${k} on ${asOfDate} (may be outside its season window)`;
    }
    return { ok, errors };
  }

  if (window === "homestand") {
    const { data: rows, error } = await sb.from("v_current_homestand_by_account")
      .select("account_key, homestand_id, start_date, end_date");
    if (error) throw new Error(`scPortfolioWindow: v_current_homestand_by_account fetch failed: ${error.code || "?"} ${error.message}`);
    for (const k of accountKeys) {
      const hs = (rows || []).find((r) => r.account_key === k);
      if (hs) ok[k] = { start_date: hs.start_date, end_date: hs.end_date, label: hs.homestand_id };
      else errors[k] = `no current homestand for ${k} on ${asOfDate} (off-homestand or non-homestand-account)`;
    }
    return { ok, errors };
  }

  for (const k of accountKeys) errors[k] = `window=${window} not supported`;
  return { ok, errors };
}

function errorPayload(msg) {
  return {
    source: "sc_daily_revenue + accounts",
    scope: "current-season Service Calendar (portfolio)",
    loaded: pgLiveNow(),
    error: msg,
  };
}
