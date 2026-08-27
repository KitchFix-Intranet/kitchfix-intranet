// src/lib/accountModels.js
//
// ACCOUNT COST-MODEL CONSTANTS - single source of truth.
//
// Ruling (Kevin, 2026-08-20): the cost-model dimension lives in a
// shared constants module, NOT in a DB column and NOT hard-coded in a
// route. Rationale, so it does not get re-litigated:
//
//   - `accounts.billing_model` is exactly what a column becomes: bulk-
//     written once in May 2026, never maintained, and now unreliable
//     enough that it cannot be used as a predicate. A column can be
//     edited silently and go stale.
//   - A route hard-code matching V6_ENVELOPE_ACCOUNTS works for one
//     route, but purchasing, SG&A and Overview each need this and
//     three copies will drift.
//   - A module is greppable, single-source, and changing an account's
//     cost model requires a PR - which is correct, because it only
//     happens when a contract is renegotiated.
//
// This module is READ-ONLY. It is the answer to "what is this account's
// cost model?" - it is NOT a wrapper over `accounts.billing_model`.
// billing_model is a different dimension (how the client is billed:
// actuals_drive_invoice / flat_fee) and the two must not be conflated.
//
// COST_MODEL meanings:
//
//   at_risk        Operator IS measured on variance. Overruns are a
//                  KitchFix P&L exposure; savings accrue to KitchFix.
//                  This is the default for a KitchFix operator.
//
//   pass_through   Cost-reimbursable. Client provides the budget,
//                  KitchFix orders at cost, KitchFix bills it back to
//                  the client. Overruns are billable to the client;
//                  savings revert to the client. The operator is NOT
//                  held to a KPI on this line - per Kevin's INV-P9
//                  spec preamble and BRIEF §CIN-OH / §STL-FL / §STL-MO.
//
//   revenue_flex   RESERVED - zero members. Deferred to 2027.
//                  Kevin ruling 2026-08-20 (superseding the earlier
//                  flex ruling from the same day): TXR - TX - V is
//                  NOT a revenue-flex account for purchasing. Its
//                  commercial model is being reworked; a 2027 sales
//                  dashboard will solve the revenue side properly.
//                  Reserved as a named empty set here because a named
//                  empty set is better than a concept with nowhere to
//                  live. See labor route's V37_REVENUE_FLEX_ACCOUNTS
//                  for the labor-side envelope (separate, working
//                  decision, out of scope).
//
// Provenance for pass_through membership: INV-P9 (#730)
// docs/ACCOUNT_MODEL_MATRIX.md Q4 - the three accounts tested (not
// assumed) against contract + reimbursable-GL + KPI-suppression
// signal from BRIEF.
//
// Account-key form: exact `'TBR - FL'` string with spaces around
// dashes. `TXR - TX - H` and `TXR - TX - V` have spaces around BOTH
// dashes. Do NOT lower-case, do NOT strip spaces.

// pass_through - the three cost-reimbursable pass-through accounts,
// tested (not assumed) per INV-P9 Q4:
//   CIN - OH  - Reds Great American Ballpark; §2.b food + supplies
//               reimbursable to `1374.1`
//   STL - FL  - Cardinals Jupiter PDC; $900K food/packaging/supplies
//               + $30K upkeep envelope reimbursable to `1385.3`
//   STL - MO  - Cardinals Busch Stadium; $225K food/packaging/supplies
//               reimbursable to `1385.1`
export const PASS_THROUGH_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - FL",
  "STL - MO",
]);

// revenue_flex - RESERVED, deferred to 2027. Zero members.
// Do NOT put TXR - TX - V here for purchasing (Kevin ruling 2026-08-20).
// The labor route's V37_REVENUE_FLEX_ACCOUNTS handles labor separately.
export const REVENUE_FLEX_ACCOUNTS = new Set([]);

// at_risk - the eight accounts that carry KPI on their own COGS.
// Ordered to match Q1 matrix ordering. TBJ - NY is UNKNOWN-dominant
// in INV-P9 (no operative contract on file - Buffalo bills through
// the Toronto master but the Dec 11, 2018 Rogers/Toronto MSA + any
// Buffalo SOW under it are not in the contract folder). Defaulted
// here to `at_risk` per Kevin ruling because that mirrors its AAA
// sibling CIN - KY and is the operationally-current billing pattern
// (invoice K300168849 shows Buffalo billing at $27.34 per meal like
// a pure per-meal account). Open contract question - if the missing
// SOW ever surfaces a pass-through mechanic, revisit here.
export const AT_RISK_ACCOUNTS = new Set([
  "CIN - AZ",
  "CIN - KY",
  "TBJ - FL",
  "TBJ - NY",   // UNKNOWN-dominant in INV-P9; defaulted to at_risk pending missing Buffalo SOW
  "TBR - FL",
  "TXR - AZ",
  "TXR - TX - H",
  "TXR - TX - V",
]);

// Envelope-exclusion for purchasing aggregate rollups. Historically
// this was defined inline in /api/kpi/purchasing (V6_ENVELOPE_ACCOUNTS)
// to exclude TXR - TX - V. Kevin ruling 2026-08-20 REMOVED TXR - TX - V
// from that exclusion for purchasing - the account has FY2026 P&L
// budget lines (food $102,211, packaging $16,040, vehicle $1,750) and
// should resolve budgets from `kpi_budgets` like every other at-risk
// account. The empty set is exported here so callers can `.has()` it
// with the same shape as before; the exclusion is now a named empty
// concept.
//
// NOTE: this is intentionally SEPARATE from the labor route's
// V37_REVENUE_FLEX_ACCOUNTS. Labor's envelope
// (revenue_forecast x accounts.labor_ratio) is a working decision and
// stays in the labor route. Do NOT wire this constant into the labor
// route.
export const PURCHASING_ENVELOPE_EXCLUSIONS = new Set([]);

// All account keys the resolver knows about. Union of the three sets
// above. If a caller passes a key not in this union, `costModelFor()`
// throws. That is intentional - silent defaults are how a new account
// gets a wrong verdict.
const KNOWN_ACCOUNTS = new Set([
  ...PASS_THROUGH_ACCOUNTS,
  ...REVENUE_FLEX_ACCOUNTS,
  ...AT_RISK_ACCOUNTS,
]);

/**
 * Resolve the cost model for an account.
 *
 * Returns one of the strings: 'at_risk', 'pass_through', 'revenue_flex'.
 *
 * THROWS on an unknown key. Callers must not silently default. If a
 * new account is being onboarded, add it to the appropriate set above
 * (via PR) before calling this resolver.
 *
 * Pseudo-keys (ALL / EAST / WEST) are NOT valid input here - those
 * are aggregate selectors, not accounts. Callers doing aggregate
 * rollups should resolve per-member and then reduce.
 *
 * @param {string} accountKey - exact form: 'TBR - FL', 'TXR - TX - V', etc.
 * @returns {'at_risk' | 'pass_through' | 'revenue_flex'}
 * @throws {Error} if accountKey is not a known account
 */
export function costModelFor(accountKey) {
  if (typeof accountKey !== "string" || accountKey.length === 0) {
    throw new Error(`costModelFor: invalid accountKey ${JSON.stringify(accountKey)}`);
  }
  if (!KNOWN_ACCOUNTS.has(accountKey)) {
    throw new Error(`costModelFor: unknown accountKey ${JSON.stringify(accountKey)} - add to accountModels.js`);
  }
  if (PASS_THROUGH_ACCOUNTS.has(accountKey)) return "pass_through";
  if (REVENUE_FLEX_ACCOUNTS.has(accountKey)) return "revenue_flex";
  return "at_risk";
}

/**
 * True if the given accountKey is a known account (any cost model).
 * Useful for validation without triggering the throw.
 */
export function isKnownAccount(accountKey) {
  return KNOWN_ACCOUNTS.has(accountKey);
}

/**
 * True if the given accountKey is a pass_through account.
 * Convenience helper for the common purchasing-route predicate.
 */
export function isPassThrough(accountKey) {
  return PASS_THROUGH_ACCOUNTS.has(accountKey);
}

// ─── MANAGEMENT-FEE ANNUAL GOALS ────────────────────────────────────
//
// Annual stewardship goals for the three pass_through accounts, used by
// the management-fee board (PR 3). Owner-supplied 2026-08-24 - not from
// `kpi_budgets` because these are ANNUAL commitments the client and
// KitchFix agree on for the season, not period-scoped operating budgets.
//
// The board renders them as `spent FYTD of $goal annual goal, X% used`
// with a progress bar and marker at fraction-of-year-elapsed. No
// verdict, no red/green - the card exists so an outlier is visible
// early, not so someone is graded (spec §6.7 + PR 3 prompt).
//
// STL - MO breakdown, so future-you does not have to reconstruct it:
//   base    = $281,345.95
//   water   = $50,000.00      (added on top per Sebastian)
//   ─────────────────────
//   goal    = $331,345.95     (BEFORE Missouri sales tax)
//
// STL - MO carries `salesTaxApplied: false`. The board surfaces an
// amber caution below the goal because Missouri sales tax has not yet
// been applied - the rate is still outstanding from Sebastian. **Do
// NOT hard-code a rate. Do NOT estimate.** When Sebastian rules, the
// value here and the `salesTaxApplied` flag flip together, in the same
// PR. Until then the caution is the honest surface.
//
// Adding a new pass_through account: extend PASS_THROUGH_ACCOUNTS above
// AND add a row here. `goalFor()` throws on an unknown pass_through key
// so a silent miss cannot happen.
export const MANAGEMENT_FEE_GOALS = {
  "CIN - OH": {
    annual: 227391.02,
    salesTaxApplied: true,
    breakdown: null,
    // R14 additions - card copy inputs for the two-pane layout.
    // clientLabel drives the hero label "Billed back to <clientLabel>".
    // taxCaveatState fills "before <state> sales tax" under the goal figure.
    clientLabel: "Cincinnati Reds",
    taxCaveatState: "Ohio",
  },
  "STL - FL": {
    annual: 1060000.00,
    salesTaxApplied: true,
    breakdown: null,
    clientLabel: "St Louis Cardinals",
    taxCaveatState: "Florida",
  },
  "STL - MO": {
    annual: 331345.95,
    salesTaxApplied: false,
    breakdown: {
      base: 281345.95,
      water: 50000.00,
      note: "before Missouri sales tax - rate outstanding from Sebastian",
    },
    clientLabel: "St Louis Cardinals",
    taxCaveatState: "Missouri",
  },
};

/**
 * Resolve the annual management-fee goal for a pass_through account.
 *
 * Returns { annual, salesTaxApplied, breakdown } for the three
 * pass_through accounts. Returns null for at_risk / revenue_flex
 * accounts (they have no annual goal to render).
 *
 * THROWS on an unknown key - same discipline as costModelFor. THROWS if
 * called with a pass_through key that has no goal row (contract error:
 * PASS_THROUGH_ACCOUNTS and MANAGEMENT_FEE_GOALS must stay in sync).
 *
 * @param {string} accountKey
 * @returns {{ annual: number, salesTaxApplied: boolean, breakdown: object|null } | null}
 */
export function goalFor(accountKey) {
  if (typeof accountKey !== "string" || accountKey.length === 0) {
    throw new Error(`goalFor: invalid accountKey ${JSON.stringify(accountKey)}`);
  }
  if (!KNOWN_ACCOUNTS.has(accountKey)) {
    throw new Error(`goalFor: unknown accountKey ${JSON.stringify(accountKey)} - add to accountModels.js`);
  }
  if (!PASS_THROUGH_ACCOUNTS.has(accountKey)) return null;
  const row = MANAGEMENT_FEE_GOALS[accountKey];
  if (!row) {
    throw new Error(`goalFor: pass_through ${JSON.stringify(accountKey)} missing from MANAGEMENT_FEE_GOALS - keep the two sets in sync`);
  }
  return row;
}
