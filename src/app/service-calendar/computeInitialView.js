// Mount default for the Service Calendar view state.
//
// Returns the (scope, lens, isAdminView, periodKey) shape to mount
// in. Pure helper: no React hooks, no closure reads. Inputs explicit
// so the PR-D landing-logic extension is a body-only edit.
//
// PR-B2: accepts urlPeriod for ?period=PN deep-links. Admin URL wins
// over period URL (admin is a parallel surface; the period state
// would be preserved underneath but the admin body shows first).
//
// PR-D (later) will extend the signature to accept the user's role
// from contacts.role and branch:
//   - floor roles (Executive Chef, Sous Chef, etc.) -> month view
//     of their account's current month
//   - leadership roles -> year overview (today's default)
// The seam exists so PR-D's change is just the body of this function,
// not a scatter of edits across ServiceCalendar.js's mount path.
export function computeInitialView({ urlView, urlPeriod, isAdmin }) {
  if (urlView === "admin" && isAdmin) {
    return { scope: "year", lens: "calendar", isAdminView: true, periodKey: null };
  }
  if (urlPeriod && /^P\d+$/.test(urlPeriod)) {
    return { scope: "period", lens: "period", isAdminView: false, periodKey: urlPeriod };
  }
  return { scope: "year", lens: "calendar", isAdminView: false, periodKey: null };
}
