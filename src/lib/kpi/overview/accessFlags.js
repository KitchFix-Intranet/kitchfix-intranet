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
//   - revenue-source toggle (corporate + regional only - it exposes
//     the pipeline-validation SC path; site leaders must never see
//     Service Calendar test data)
//
// Payload fields consumed by the client:
//   payload.salary_toggle_visible     bool  - salary +/- control
//   payload.revenue_toggle_visible    bool  - Planned / SC toggle
//   payload.landing_account           string - Labor pattern for
//                                     folio-rail visibility
//
// There is NO `posture` field. Attempting to read one is a defect.

/**
 * Resolve the access-only flags for a caller. NO layout information
 * is returned - the Overview has one layout everywhere.
 *
 * @param {object} args
 * @param {object|null} args.caller       - roleGate caller (role, scope, ...)
 * @param {boolean} args.salaryAvailable  - canSeeSalary output for this
 *                                          caller+account (route computes
 *                                          it and passes it in)
 * @returns {{
 *   salary_toggle_visible:  boolean,
 *   revenue_toggle_visible: boolean,
 * }}
 */
export function resolveAccessFlags({ caller, salaryAvailable = false }) {
  if (!caller) {
    return { salary_toggle_visible: false, revenue_toggle_visible: false };
  }
  const role = caller.role;
  const isCorporateAccess = role === "corporate" || role === "rdo";
  return {
    // Salary control visibility mirrors canSeeSalary from roleGate.
    // The route computes it against the account being viewed and
    // passes it in; a caller who can't see salary gets a byte-
    // identical response whether they asked or not.
    salary_toggle_visible: !!salaryAvailable,
    // Revenue-source toggle exposes the Planned / Service Calendar
    // switch. It is a pipeline-validation control - site leaders must
    // never see Service Calendar test data - so it is corporate/rdo
    // only. Access, not layout.
    revenue_toggle_visible: isCorporateAccess,
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
