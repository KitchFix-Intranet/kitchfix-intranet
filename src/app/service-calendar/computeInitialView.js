// Mount default for the Service Calendar view state.
//
// Returns the (scope, lens, isAdminView) triple to mount in. Pure
// helper: no React hooks, no closure reads. Inputs explicit so the
// PR-D landing-logic extension is a body-only edit.
//
// PR-A: returns today's exact default behavior - year view for
// everyone, with admin honored only when the URL deep-links to
// ?view=admin AND the user is on the SC_ADMIN allowlist.
//
// PR-D (later) will extend the signature to accept the user's role
// from contacts.role and branch:
//   - floor roles (Executive Chef, Sous Chef, etc.) -> month view
//     of their account's current month
//   - leadership roles -> year overview (today's default)
// The seam exists so PR-D's change is just the body of this function,
// not a scatter of edits across ServiceCalendar.js's mount path.
export function computeInitialView({ urlView, isAdmin }) {
  if (urlView === "admin" && isAdmin) {
    return { scope: "year", lens: "month", isAdminView: true };
  }
  return { scope: "year", lens: "month", isAdminView: false };
}
