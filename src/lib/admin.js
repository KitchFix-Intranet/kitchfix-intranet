/**
 * Single source of truth for ops leadership / admin email gating.
 * Used across the ops route, invoice handlers, and vendor handlers.
 */
export const OPS_LEADERSHIP_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
];

/**
 * Service Calendar admin gate. Tighter than OPS_LEADERSHIP because
 * SC config edits (price changes, service deactivation) move money;
 * the gate stays restrictive until the v1 site-lead rollout settles.
 *
 * Call sites today (all in src/app/service-calendar/):
 *   - page.js                  page-level gate (Coming Soon screen)
 *   - api/service-calendar/    server-side gate on every admin POST
 *                              action (price, fee, archive/reactivate,
 *                              add-service, add-group); see route.js
 *                              for the action-by-action gate table
 *
 * The pre-Stage-2 ServiceConfig.js admin component was retired in PR
 * #209; modern admin paths live under
 * src/app/service-calendar/admin/.
 */
export const SC_ADMINS = [
  "k.fietek@kitchfix.com",
  "joe@kitchfix.com",
];

/**
 * Service Calendar admin-dashboard gate (corporate edit allowlist).
 *
 * Distinct from SC_ADMINS above: that constant gates "who can see the
 * Service Calendar at all" during the dev/operator rollout. This
 * constant gates "who can edit pricing, fees, services, and other
 * money-moving config" inside the corporate-only admin dashboard at
 * /service-calendar/admin. Two questions, two lists.
 *
 * Membership is hardcoded so adds/removes are 1-line PRs and visible
 * in git history. Not imported from opdAcl (different concern; that
 * is hierarchical doc-tier access). Not derived from
 * OPS_LEADERSHIP_EMAILS (overlapping but different - misses Castro/
 * Moore/Lynch, includes Wasserman).
 *
 * The Set is frozen so a runtime mutation mistake is loud. Values
 * stored lowercased to match the session.user.email lowercasing done
 * at the call sites; isScAdmin() below does the normalization so
 * callers never compare raw emails.
 *
 * Deliberately excluded for v1: d.inthavone@kitchfix.com (Corporate
 * Field Chef). This surface moves money; the corporate-field-chef
 * role has no current need to edit billing config. Add back if scope
 * grows.
 */
export const SC_ADMIN_EMAILS = Object.freeze(new Set([
  "k.fietek@kitchfix.com",  // Kevin Fietek - Director of Operations
  "josh@kitchfix.com",       // Josh Katt - CEO
  "joe@kitchfix.com",        // Joe Lessard - VP Operations
  "britt@kitchfix.com",      // Britt Chernikovich - Director of Culinary
  "m.chavez@kitchfix.com",   // Mariela Chavez - Human Resources
  "s.castro@kitchfix.com",   // Sebastian Castro - Finance
  "r.moore@kitchfix.com",    // Ryan Moore - Regional Director West
  "s.lynch@kitchfix.com",    // Shane Lynch - Regional Director East
]));

/**
 * Normalized SC admin-dashboard check. Lowercases + trims so callers
 * don't have to. Returns false for any falsy input. Use this anywhere
 * the SC admin gate fires (page.js server-side, route per-action
 * handlers, the header link in ServiceCalendar.js).
 */
export const isScAdmin = (email) =>
  !!email && SC_ADMIN_EMAILS.has(email.toLowerCase().trim());

/**
 * SC lock-override group (Kevin K-10 ruling, 2026-08-06).
 *
 * The three-person group that can bypass the sc-25 period lock AND
 * the sc-30 week-finalize lock. Deliberately narrower than
 * SC_ADMIN_EMAILS above: the eight-member admin set gates money-
 * moving CONFIG edits (prices, fees, services), which is a different
 * responsibility from bypassing a completed-billing freeze.
 *
 * Two powers, two groups (K-10):
 *   - SC_ADMIN_EMAILS: edit the catalog / prices / fees.
 *   - SC_LOCK_OVERRIDE: reach into a locked or finalized week to
 *     unlock, revert, or write. Kevin (ops), Joe (VP ops with the
 *     domain context), Sebastian (billing, only he sees the invoice
 *     side). Britt / Josh / Mariela / Ryan / Shane sit in the
 *     catalog set but do NOT sit here - a locked week is billing
 *     territory, not general admin.
 *
 * The sc-25 period lock's short-circuit at
 * `src/lib/scPeriodLock.js:42` swaps from `isScAdmin` to
 * `isScLockOverride` in this PR (PR-A). The sc-30 week-finalize
 * predicate (this PR's `src/lib/scWeekFinalize.js`) uses the same
 * function. If a future ruling opens more override territory, this
 * comment gets the new phrase and the set gains a member - do NOT
 * fold new powers into SC_ADMIN_EMAILS.
 *
 * Frozen Set, lowercased values, exact-email match. Same discipline
 * as SC_ADMIN_EMAILS above.
 */
export const SC_LOCK_OVERRIDE = Object.freeze(new Set([
  "k.fietek@kitchfix.com",  // Kevin Fietek - Director of Operations
  "joe@kitchfix.com",        // Joe Lessard - VP Operations
  "s.castro@kitchfix.com",   // Sebastian Castro - Finance / billing
]));

/**
 * Normalized SC lock-override check. Same shape as isScAdmin.
 * Use in every server-side gate that would otherwise refuse a write
 * to a locked period or a finalized week.
 */
export const isScLockOverride = (email) =>
  !!email && SC_LOCK_OVERRIDE.has(email.toLowerCase().trim());
