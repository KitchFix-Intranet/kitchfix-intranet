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
 * Service Calendar page-level gate: who can OPEN the Service Calendar
 * at all. Anyone not in this list gets the "Coming Soon" screen from
 * src/app/service-calendar/page.js.
 *
 * Two related lists in this file, one question each:
 *   - SC_ADMINS (this constant): who can open the Service Calendar.
 *     Corporate admins + the site-lead operator group at each live
 *     account.
 *   - SC_ADMIN_EMAILS (below): who can edit money-moving config
 *     (prices, fees, services, archive/reactivate). Corporate only.
 *
 * The five site operators (Trible, Decanio at CIN - AZ; Randall, Lacy,
 * Hughes at TXR - AZ) sit in SC_ADMINS so they can run the tool on
 * their account, and DELIBERATELY do NOT sit in SC_ADMIN_EMAILS.
 * Operators run the calendar; corporate admins move money. Adding a
 * site operator to the money-moving list is a separate ruling and a
 * separate PR.
 *
 * Functional call site: src/app/service-calendar/page.js:223 (the
 * Coming Soon short-circuit). Every other reference to SC_ADMINS is a
 * comment; the admin POST handlers under api/service-calendar/ gate on
 * isScAdmin(SC_ADMIN_EMAILS), not on SC_ADMINS.
 */
export const SC_ADMINS = [
  "k.fietek@kitchfix.com",  // Kevin Fietek - Director of Operations
  "joe@kitchfix.com",        // Joe Lessard - VP Operations
  "josh@kitchfix.com",       // Josh Katt - CEO
  "s.castro@kitchfix.com",   // Sebastian Castro - Finance / billing
  "m.chavez@kitchfix.com",   // Mariela Chavez - Human Resources
  "r.moore@kitchfix.com",    // Ryan Moore - Regional Director West
  "j.trible@kitchfix.com",   // Jennifer Trible - GM, CIN - AZ
  "m.decanio@kitchfix.com",  // Michael Decanio - Chef de Cuisine, CIN - AZ
  "e.randall@kitchfix.com",  // Liz Randall - GM, TXR - AZ
  "a.lacy@kitchfix.com",     // Adam Lacy - Chef de Cuisine, TXR - AZ
  "a.hughes@kitchfix.com",   // Anna Hughes - Asst Hospitality Mgr, TXR - AZ
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


// ═══════════════════════════════════════════════════════════════════
// Stage 4 (admin-panel-stage-4a) · DB-backed permission layer
//
// Strictly additive: every sync export above stays as the hardcoded
// fallback for the dual-read window. Stage 5 removes the hardcoded
// paths and the comparison code.
//
// Dual-read contract: each async wrapper queries the `people` table,
// compares the DB result against the hardcoded set, logs
// `[admin] DRIFT` on mismatch (console.warn - drift is informational
// during the window, not an error), and returns the DB result when
// available. On DB error, returns the hardcoded fallback so a
// transient Supabase blip never produces a gate miss.
//
// NOTE on the match key: `people.work_email` is the correct column
// (Stage 1 seeded on LOWER(work_email); there is no `people.email`
// column). Rippling writes already lower-case + trim the value on
// ingest, so `.ilike(work_email, email)` and `.eq(work_email, email)`
// are both safe in current state; `.ilike` is kept for defensive
// case-insensitivity to match the Stage 3 route pattern.
// ═══════════════════════════════════════════════════════════════════

import { getServiceClient } from "@/lib/supabase";

/**
 * Code-level super-admin allowlist. Checked FIRST in every panel-
 * access and toggle-protection path across the app.
 *
 * Kevin's DB flags can be toggled through the admin UI without
 * locking him out; this constant is the structural backstop so a
 * mis-click can never remove ops leadership from the one person who
 * needs to recover from it. Deliberately narrower than
 * OPS_LEADERSHIP_EMAILS above (6 people) - panel access via code is
 * for exactly Kevin; the other 5 ops-leadership members ride on
 * their DB `is_ops_leadership` flag.
 *
 * Moved to admin.js in Stage 4a. The inline copy at the top of
 * src/app/api/directory/route.js (Stage 3) stays in place for now;
 * Stage 4b consumer rewire removes it there and imports from here.
 */
export const SUPER_ADMINS = ["k.fietek@kitchfix.com"];
const SUPER_ADMINS_SET = new Set(SUPER_ADMINS.map((e) => e.toLowerCase().trim()));

/**
 * Sync code-level super-admin check. Safe to call from client-side
 * modules (no DB dependency).
 */
export const isSuperAdmin = (email) =>
  !!email && SUPER_ADMINS_SET.has(email.toLowerCase().trim());


// ─── Lower-cased sets for the hardcoded-vs-DB diff ────────────────────
// Pre-computed so each dual-read wrapper doesn't re-lower the array
// per call. The source constants above stay in their original casing
// for human readability of the admin.js file.
const OPS_LEADERSHIP_LC = new Set(OPS_LEADERSHIP_EMAILS.map((e) => e.toLowerCase().trim()));
const SC_ADMINS_LC      = new Set(SC_ADMINS.map((e)              => e.toLowerCase().trim()));


/**
 * Fetch a person's permission flags from the `people` table. Returns
 * an object with every permission column, or null when the email is
 * not found or the DB errored. Callers that need a specific flag go
 * through the per-permission wrappers below (which handle the
 * drift log + hardcoded fallback); this is for bulk reads.
 *
 * Server-only. The service client reads `people` without RLS; do not
 * import this from a `"use client"` component.
 */
export async function getPermissions(email) {
  if (!email) return null;
  const norm = email.toLowerCase().trim();
  try {
    const supa = getServiceClient();
    const { data, error } = await supa
      .from("people")
      .select(
        "work_email, is_ops_leadership, is_sc_access, is_sc_admin, " +
        "is_sc_lock_override, is_labor_admin, is_invoice_admin, " +
        "is_inv_manager, paf_always_cc, is_site_leader, " +
        "is_playbook_owner, is_sous_preview, is_hr_admin, region, " +
        "kpi_role, kpi_scope, can_see_salary, is_kpi_preview, " +
        "opd_access_tier, incident_notify, sc_default_account"
      )
      .ilike("work_email", norm)
      .maybeSingle();
    if (error) {
      console.error(`[admin] getPermissions DB error for ${norm}:`, error.message);
      return null;
    }
    return data; // null if the person doesn't exist in people
  } catch (err) {
    console.error(`[admin] getPermissions exception for ${norm}:`, err.message);
    return null;
  }
}

/**
 * Dual-read: ops leadership. SUPER_ADMIN -> true unconditionally
 * (structural backstop). Then DB; drift-check vs OPS_LEADERSHIP_EMAILS;
 * return DB. On DB error, fall back to hardcoded.
 */
export async function isOpsLeadershipDb(email) {
  if (!email) return false;
  if (isSuperAdmin(email)) return true;
  const norm = email.toLowerCase().trim();
  const hardcoded = OPS_LEADERSHIP_LC.has(norm);
  const perms = await getPermissions(email);
  if (!perms) return hardcoded;
  const db = !!perms.is_ops_leadership;
  if (db !== hardcoded) {
    console.warn(`[admin] DRIFT is_ops_leadership for ${norm}: DB=${db} hardcoded=${hardcoded}`);
  }
  return db;
}

/**
 * Dual-read: SC page access.
 */
export async function isScAccessDb(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();
  const hardcoded = SC_ADMINS_LC.has(norm);
  const perms = await getPermissions(email);
  if (!perms) return hardcoded;
  const db = !!perms.is_sc_access;
  if (db !== hardcoded) {
    console.warn(`[admin] DRIFT is_sc_access for ${norm}: DB=${db} hardcoded=${hardcoded}`);
  }
  return db;
}

/**
 * Dual-read: SC admin (money-moving config).
 */
export async function isScAdminDb(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();
  const hardcoded = SC_ADMIN_EMAILS.has(norm);
  const perms = await getPermissions(email);
  if (!perms) return hardcoded;
  const db = !!perms.is_sc_admin;
  if (db !== hardcoded) {
    console.warn(`[admin] DRIFT is_sc_admin for ${norm}: DB=${db} hardcoded=${hardcoded}`);
  }
  return db;
}

/**
 * Dual-read: SC lock-override.
 */
export async function isScLockOverrideDb(email) {
  if (!email) return false;
  const norm = email.toLowerCase().trim();
  const hardcoded = SC_LOCK_OVERRIDE.has(norm);
  const perms = await getPermissions(email);
  if (!perms) return hardcoded;
  const db = !!perms.is_sc_lock_override;
  if (db !== hardcoded) {
    console.warn(`[admin] DRIFT is_sc_lock_override for ${norm}: DB=${db} hardcoded=${hardcoded}`);
  }
  return db;
}
