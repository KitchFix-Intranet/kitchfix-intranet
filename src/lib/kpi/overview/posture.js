// src/lib/kpi/overview/posture.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Posture resolution per §5.3 / R-19. Two audiences, one engine.
//
// Corporate posture:
//   - Portfolio rail
//   - GL codes in card headers
//   - Revenue-source toggle (planned | sc)
//   - Aggregate account keys (ALL / EAST / WEST) resolve to the
//     portfolio
//   - Salary control gated by can_see_salary (default true unless
//     kpi_roles.can_see_salary = false)
//
// Site-leader posture:
//   - No portfolio rail (single account)
//   - GL codes inside the statement (not in card headers)
//   - No revenue-source toggle (rev_source always 'planned')
//   - Salary control shown on own account only (site_leader),
//     never for site_manager
//
// Role -> posture (audit Q4):
//   corporate     -> corporate
//   rdo           -> corporate (portfolio rail visible)
//   site_leader   -> site_leader
//   site_manager  -> site_leader
//   (null caller) -> refused upstream (403)
//
// Salary toggle visibility mirrors canSeeSalary from roleGate.js.

/**
 * Resolve the Overview posture for a caller.
 *
 * Returns:
 *   {
 *     posture:              'corporate' | 'site_leader',
 *     portfolio_rail:       bool,
 *     gl_in_card_headers:   bool,
 *     revenue_toggle_visible: bool,
 *     salary_toggle_visible: bool,
 *   }
 */
export function resolvePosture({ caller, salaryAvailable = false }) {
  if (!caller) {
    return {
      posture: "site_leader",
      portfolio_rail: false,
      gl_in_card_headers: false,
      revenue_toggle_visible: false,
      salary_toggle_visible: false,
    };
  }
  const role = caller.role;
  const isCorporatePosture = role === "corporate" || role === "rdo";
  return {
    posture: isCorporatePosture ? "corporate" : "site_leader",
    portfolio_rail: isCorporatePosture,
    gl_in_card_headers: isCorporatePosture,
    // Revenue-source toggle only meaningful on corporate posture. Site
    // leaders never see SC test data - the toggle is intentionally
    // hidden for them (§5.5 / R-20).
    revenue_toggle_visible: isCorporatePosture,
    // Salary toggle: visible when the role gate says the caller can see
    // salary on the account they're viewing. The route computes
    // salaryAvailable via canSeeSalary and passes it in.
    salary_toggle_visible: !!salaryAvailable,
  };
}

/**
 * Resolve `include_salary` request against the visibility gate. Same
 * shape the labor route uses: `include_salary=1` on the URL is
 * SILENTLY DROPPED when the caller can't see salary. A caller who
 * cannot see salary gets a byte-identical default response whether
 * they asked or not.
 */
export function resolveIncludeSalary({ includeSalaryReq, salaryAvailable }) {
  return !!(includeSalaryReq && salaryAvailable);
}
