// Mount default for the Service Calendar view state.
//
// Returns the (scope, lens, isAdminView, periodKey, landOnCurrentPeriod)
// shape to mount in. Pure helper: no React hooks, no closure reads,
// no fetches. Inputs explicit so wiring is one body edit, not a
// scatter across ServiceCalendar.js's mount path.
//
// Precedence (highest wins):
//   1. urlView === "admin" + isAdmin       -> admin parallel surface
//   2. urlPeriod matches /^P\d+$/          -> deep-link to that period
//   3. default (every clean-URL landing)   -> year overview on the
//                                             Period lens
//
// 2026-09-23 ruling (Kevin): every user lands on their own account's
// year overview with the Period lens. Nobody is auto-dropped into a
// period workspace; users drill in themselves. Explicit user intent
// (admin URL, ?period deep-link) still wins.

// URL account/scope still wins over the landing computation (branches 1
// and 2 below); the account switcher is orthogonal - flipping accounts
// after landing does not re-run this helper.
//
// `hasHomeAccount` is accepted for signature stability with the mount
// caller; it no longer affects the return value after the 2026-09-23
// ruling.
export function computeInitialView({ urlView, urlPeriod, isAdmin, hasHomeAccount = false }) {
  // 1) admin URL wins (explicit user intent + isAdmin gate)
  if (urlView === "admin" && isAdmin) {
    return {
      scope: "year", lens: "calendar",
      isAdminView: true, periodKey: null,
      landOnCurrentPeriod: false,
    };
  }
  // 2) period deep-link wins next
  if (urlPeriod && /^P\d+$/.test(urlPeriod)) {
    return {
      scope: "period", lens: "period",
      isAdminView: false, periodKey: urlPeriod,
      landOnCurrentPeriod: false,
    };
  }
  // 3) default (2026-09-23 ruling): every clean-URL landing resolves
  //    to the year overview on the Period lens. Nobody is auto-dropped
  //    into a period workspace; users drill in themselves.
  return {
    scope: "year", lens: "period",
    isAdminView: false, periodKey: null,
    landOnCurrentPeriod: false,
  };
}
