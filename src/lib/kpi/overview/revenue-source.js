// src/lib/kpi/overview/revenue-source.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// The ONE resolver of revenue for the Overview. Every card, every
// table row, every ticker read binds through this function. Do NOT
// read pnl_actuals / kpi_budgets / sc_daily_revenue for revenue
// anywhere else in the Overview.
//
// Rules (§5.5, R-20, table):
//
//   Period state       | Per-meal accounts   | Fee accounts        | TXR-TX-V
//   -------------------|---------------------|---------------------|--------
//   Closed, verified   | pnl_actuals         | pnl_actuals         | pnl_actuals
//   Closed, awaiting   | pnl_actuals if      | kpi_budgets 2400.1  | budget + note
//   finance            | present, else       | (contractual)       |
//                      | budget to date      |                     |
//                      | with "estimate"     |                     |
//   Open               | budget to date      | kpi_budgets 2400.1  | budget + note
//                      | (planned) UNLESS    | (contractual)       |
//                      | sc_revenue_live=T   |                     |
//                      | AND rev_source=sc   |                     |
//                      | -> sc_daily_revenue |                     |
//                      | with NOT is_non_rev |                     |
//
// Fee accounts NEVER read sc_daily_revenue (contamination guard,
// R888-1 / #888). Fee accounts NEVER read sc_fee_schedule.amount
// (STL-MO $50,065.52 tax layer absent from the P&L, per
// PURCHASING handoff §10).
//
// R14 note: this resolver does NOT know about closed_at overrides
// beyond the derivePeriodState output; callers pass in the resolved
// period_state ('open' | 'closed_awaiting' | 'verified').

import { costModelFor } from "@/lib/accountModels.js";

// Fee accounts (cost model = pass_through in accountModels.js OR the
// special-case fee accounts CIN - OH, STL - FL, STL - MO, TXR - TX - H).
// The scope brief §5.5 explicitly names the four fee accounts; the
// codebase's accountModels.js today marks the three PASS_THROUGH
// accounts (CIN - OH, STL - FL, STL - MO) as pass_through and TXR - TX - H
// as at_risk. The fee-account list per the scope brief overlaps with
// pass_through PLUS one at_risk (TXR - TX - H) plus TXR - TX - V (which
// is at_risk but has direct-sales semantics per R-3 / R-11).
//
// This Overview resolver treats "fee revenue" as "revenue-side
// contract" rather than "pass_through cost model". The list here
// pins the four accounts named in the scope brief + TXR - TX - V as
// a fifth "tracked" account (revenue = budget with note per R-3).
const FEE_REVENUE_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - FL",
  "STL - MO",
  "TXR - TX - H",
]);

// TXR - TX - V direct-sales / tracked account (R-3, R-11).
const TRACKED_REVENUE_ACCOUNTS = new Set([
  "TXR - TX - V",
]);

/**
 * Classify an account for the Overview revenue picker.
 *
 * Returns one of:
 *   'per_meal'     - open period uses planned (budget-to-date) or
 *                    sc_daily_revenue when sc_revenue_live=true and
 *                    rev_source=sc; closed uses pnl_actuals.
 *   'fee'          - always kpi_budgets 2400.1 (contractual); closed
 *                    verified uses pnl_actuals 2400.1.
 *   'tracked'      - TXR - TX - V; budget + tracked marker, pnl_actuals
 *                    when verified.
 */
export function classifyForRevenue(accountKey) {
  if (FEE_REVENUE_ACCOUNTS.has(accountKey)) return "fee";
  if (TRACKED_REVENUE_ACCOUNTS.has(accountKey)) return "tracked";
  // Rely on the cost-model resolver for the rest. Pseudo-keys are not
  // valid input here; callers should classify per-member for aggregate.
  const cm = costModelFor(accountKey);
  if (cm === "pass_through") return "fee";      // pass_through implies fee revenue
  return "per_meal";
}

/**
 * Resolve the revenue source for one (account, period, state)
 * combination.
 *
 * Inputs:
 *   accountKey    - real account key (no ALL/EAST/WEST)
 *   periodState   - 'open' | 'closed_awaiting' | 'verified'
 *   revSource     - 'planned' (default) | 'sc' (corporate + per-meal only)
 *   accountFlags  - { sc_revenue_live: bool } or null (defaults to false)
 *
 * Returns:
 *   {
 *     source:   'pnl_actuals' | 'sc_daily_revenue' | 'kpi_budgets_2400_1' |
 *               'kpi_budgets_2400_1_estimate' | 'kpi_budgets_2400_1_planned' |
 *               'kpi_budgets_2400_1_tracked' | 'kpi_budgets_2400_1_contractual' |
 *               'pnl_actuals_verified' | 'sc_estimate',
 *     model:    'finance' | 'live_count' | 'contractual' | 'planned' |
 *               'estimate_from_budget' | 'estimate_from_sc' | 'tracked',
 *     line_codes: string[]   // which line codes this source binds to
 *     read_sc_daily_revenue: bool  // guard: iff this account+state actually reads SC
 *   }
 *
 * Guard: `read_sc_daily_revenue = true` iff account is per-meal AND
 * accountFlags.sc_revenue_live === true AND revSource === 'sc'. The
 * loader wrapper in pnl-loader.js does NOT re-check; the resolver's
 * caller enforces via this function's return value.
 */
export function resolveRevenueSource({ accountKey, periodState, revSource = "planned", accountFlags = null }) {
  const kind = classifyForRevenue(accountKey);
  const scLive = !!(accountFlags && accountFlags.sc_revenue_live);
  const wantsSc = revSource === "sc";

  if (kind === "fee") {
    // Fee accounts: contractual on open + closed_awaiting; pnl_actuals
    // on verified. NEVER sc_daily_revenue. NEVER sc_fee_schedule.
    if (periodState === "verified") {
      return {
        source: "pnl_actuals_verified",
        model: "finance",
        line_codes: ["2400.1"],
        read_sc_daily_revenue: false,
      };
    }
    return {
      source: "kpi_budgets_2400_1_contractual",
      model: "contractual",
      line_codes: ["2400.1"],
      read_sc_daily_revenue: false,
    };
  }

  if (kind === "tracked") {
    // TXR - TX - V (direct-sales, tracked). Budget + tracked marker
    // for open + closed_awaiting; pnl_actuals when verified (post-
    // season upload lands per R-3).
    if (periodState === "verified") {
      return {
        source: "pnl_actuals_verified",
        model: "finance",
        line_codes: ["2400.1"],
        read_sc_daily_revenue: false,
      };
    }
    return {
      source: "kpi_budgets_2400_1_tracked",
      model: "tracked",
      line_codes: ["2400.1"],
      read_sc_daily_revenue: false,
    };
  }

  // per_meal: five revenue lines.
  const perMealLines = ["2200", "2300", "2400.1", "2400.2", "2600"];
  if (periodState === "verified") {
    return {
      source: "pnl_actuals_verified",
      model: "finance",
      line_codes: perMealLines,
      read_sc_daily_revenue: false,
    };
  }
  if (periodState === "closed_awaiting") {
    // Closed but finance hasn't verified. Show estimate (from budget-
    // to-date) with the "estimate" marker. Not SC even if flag is
    // live - closed period estimate uses budget for simplicity per
    // Kevin's scope §5.5 "our estimate, marked".
    return {
      source: "kpi_budgets_2400_1_estimate",
      model: "estimate_from_budget",
      line_codes: perMealLines,
      read_sc_daily_revenue: false,
    };
  }
  // open
  if (scLive && wantsSc) {
    return {
      source: "sc_daily_revenue",
      model: "live_count",
      line_codes: perMealLines,
      read_sc_daily_revenue: true,
    };
  }
  return {
    source: "kpi_budgets_2400_1_planned",
    model: "planned",
    line_codes: perMealLines,
    read_sc_daily_revenue: false,
  };
}

/**
 * Guard: throw if we're about to read sc_daily_revenue for an account
 * that shouldn't. Called from the resolver's SC read path as belt-and-
 * suspenders for the picker.
 */
export function assertScReadAllowed({ accountKey, revSource, accountFlags }) {
  const kind = classifyForRevenue(accountKey);
  if (kind !== "per_meal") {
    throw new Error(
      `overview-contamination-guard: attempted sc_daily_revenue read on ${accountKey} ` +
      `(kind=${kind}). Fee + tracked accounts NEVER read sc_daily_revenue (R888-1).`
    );
  }
  if (!(accountFlags && accountFlags.sc_revenue_live === true)) {
    throw new Error(
      `overview-contamination-guard: attempted sc_daily_revenue read on ${accountKey} ` +
      `without kpi_account_flags.sc_revenue_live=true.`
    );
  }
  if (revSource !== "sc") {
    throw new Error(
      `overview-contamination-guard: attempted sc_daily_revenue read on ${accountKey} ` +
      `without rev_source=sc.`
    );
  }
}
