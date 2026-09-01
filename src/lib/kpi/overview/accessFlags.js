// src/lib/kpi/overview/accessFlags.js
//
// R-40 (2026-09-01): the Overview retired its two-layout fork.
// Layout is one thing everywhere; role governs ACCESS only, the same
// way Labor and Purchasing gate access. This module replaces the
// prior posture.js.
//
// What Labor + Purchasing gate by role, and this module mirrors:
//   - salary control (canSeeSalary on the account being viewed)
//   - portfolio panel visibility (implicit via landingAccount being
//     ALL / EAST / WEST vs a real account key)
//
// Payload fields consumed by the client:
//   payload.salary_toggle_visible     bool  - salary +/- control
//   payload.landing_account           string - Labor pattern for
//                                     folio-rail visibility
//
// There is NO `posture` field. Attempting to read one is a defect.
//
// R-40 polish (2026-09-01): the revenue-source toggle was retired -
// the account's own sc_revenue_live flag now flips the source with
// no user control. `revenue_toggle_visible` is no longer part of the
// return shape and no consumer reads it.

/**
 * Resolve the access-only flags for a caller. NO layout information
 * is returned - the Overview has one layout everywhere.
 *
 * @param {object} args
 * @param {object|null} args.caller       - roleGate caller (role, scope, ...)
 * @param {boolean} args.salaryAvailable  - canSeeSalary output for this
 *                                          caller+account (route computes
 *                                          it and passes it in)
 * @returns {{ salary_toggle_visible: boolean }}
 */
export function resolveAccessFlags({ caller, salaryAvailable = false }) {
  if (!caller) {
    return { salary_toggle_visible: false };
  }
  return {
    // Salary control visibility mirrors canSeeSalary from roleGate.
    // The route computes it against the account being viewed and
    // passes it in; a caller who can't see salary gets a byte-
    // identical response whether they asked or not.
    salary_toggle_visible: !!salaryAvailable,
  };
}

/**
 * Resolve `include_salary` request against the visibility gate. Same
 * shape the labor route uses: `include_salary=1` on the URL is
 * SILENTLY DROPPED when the caller can't see salary. Unchanged from
 * the prior posture.js implementation.
 */
export function resolveIncludeSalary({ includeSalaryReq, salaryAvailable }) {
  return !!(includeSalaryReq && salaryAvailable);
}
