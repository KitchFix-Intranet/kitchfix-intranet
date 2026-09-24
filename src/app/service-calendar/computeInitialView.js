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
// period workspace; users drill in themselves. The prior floor-role
// -> current-period-workspace branch (F2, 2026-07-09) is removed;
// explicit user intent (admin URL, ?period deep-link) still wins.
//
// The ROLE_TIERS map + roleTier + tierFromRoles helpers below are
// left in place; they no longer influence the return value from this
// helper. Their last outcome-bearing consumer was branch 3. Retirement
// (and the follow-on retirement of contacts.role in favor of `people`
// as the source of truth) is follow-up scope, not this PR.

// ─── Role alias map ─────────────────────────────────────────────
// contacts.role is free-text - the seed has 14 known roles (per
// SC_LENS_VISION.md section 5.3). Map known strings to a controlled
// tier; unknown strings fall to "unknown" (-> Season default).
//
// Tier rules (locked):
//   floor      -> daily-task-first landing (Period workspace, current
//                 period). The roles whose job is entering today's
//                 actuals.
//   leadership -> bird's-eye landing (Season overview). The roles
//                 whose job is portfolio-level review.
//   unknown    -> Season overview (today's default).
//
// Corporate Field Chef: context-dependent per the lens vision doc.
// Leans leadership for SC (they oversee multiple accounts, not own
// one) - Kevin confirmed "both" with leadership default in the doc's
// open-decisions section. Pinned here for explicit precedence.
export const ROLE_TIERS = {
  // Floor - the operator entering actuals every day.
  "executive chef":         "floor",
  "sous chef":              "floor",
  "chef de cuisine":        "floor",
  "hospitality manager":    "floor",
  "general manager":        "floor",
  // Added 2026-09-09 after a landing-data-health sweep found Claire
  // Parry (TBJ - FL) with people.title="Performance Chef" but
  // contacts.role typed as her surname; her landing fell to Season
  // overview instead of the Period workspace. Companion data fix
  // corrects the contacts.role value; this entry ensures the real
  // title maps for any future performance chef.
  "performance chef":       "floor",

  // Leadership - the portfolio reviewer.
  "ceo":                              "leadership",
  "vp operations":                    "leadership",
  "vp of operations":                 "leadership",
  "director of operations":           "leadership",
  "director of culinary":             "leadership",
  "human resources":                  "leadership",
  "staff accountant":                 "leadership",
  "regional director east":           "leadership",
  "regional director west":           "leadership",
  "regional director":                "leadership",
  "corporate field chef":             "leadership",
};

export function roleTier(role) {
  if (!role) return "unknown";
  const key = String(role).trim().toLowerCase();
  return ROLE_TIERS[key] || "unknown";
}

// Resolve a user's tier from ALL their role strings (per the sc-3
// seed comment, a user can have multiple contacts rows). Tiebreaker
// rule (locked): FLOOR WINS.
//
// Reasoning: a hybrid user (e.g. an Exec Chef who also has a Director
// title) has a daily task of entering actuals. Landing them on the
// workspace is zero-clicks-from-daily; the Season view is one climb
// away. Leadership-wins would be backwards for hybrids. Floor-only
// users: floor (unambiguous). Leadership-only: leadership. No data:
// unknown -> Season default (no regression).
export function tierFromRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return "unknown";
  const tiers = roles.map(roleTier);
  if (tiers.includes("floor")) return "floor";
  if (tiers.includes("leadership")) return "leadership";
  return "unknown";
}

// Helper for tests/diagnostics: pick a representative role to expose
// for logging/UI debug. Floor-tier role wins; else first known role;
// else the first raw string. NEVER throws on empty input.
function pickRepresentativeRole(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  for (const r of roles) if (roleTier(r) === "floor") return r;
  for (const r of roles) if (roleTier(r) === "leadership") return r;
  return roles[0];
}

// URL account/scope still wins over the landing computation (branches 1
// and 2 below); the account switcher is orthogonal - flipping accounts
// after landing does not re-run this helper.
//
// `role`, `roles`, and `hasHomeAccount` are accepted for signature
// stability with the mount caller; they no longer affect the return
// value after the 2026-09-23 ruling.
export function computeInitialView({ urlView, urlPeriod, isAdmin, role = null, roles = null, hasHomeAccount = false }) {
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
