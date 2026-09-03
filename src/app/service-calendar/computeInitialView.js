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
//   3. role mapped to floor                -> current-period workspace
//                                            (landOnCurrentPeriod=true,
//                                            periodKey filled by the
//                                            mount once periodRanges
//                                            arrives)
//   4. role mapped to leadership / unknown -> Season overview (today's
//                                            default)
//
// Stage 4 wired the seam (helper + ROLE_TIERS map + landing precedence)
// but the mount passed role=null because contacts.role wasn't exposed
// at the mount fetch.
//
// Role activation (this PR): sc-accounts now returns the requesting
// user's contacts.role values as `roles[]` (multiple rows possible per
// the sc-3 seed). The mount captures roles and passes them here; we
// resolve the tier via tierFromRoles() with the floor-wins tiebreaker.
// Engine touch is minimal + scoped: the existing user-resolution in
// sc-accounts gets one additional contacts query alongside the
// user_accounts_derived query (Promise.all).

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

// F2 (R-A ruling 2026-07-09): the floor -> workspace redirect now
// REQUIRES a resolved home account. A floor-tier user with NO
// mapped account falls through to the Season overview (the picker)
// rather than being force-landed on the CIN-AZ fallback they don't
// own. hasHomeAccount is the signal - true only when the user has
// a resolved account (via user_accounts_derived) AND that account is
// present in the account list the dropdown carries (guards against
// a mapping pointing at an unimported account; see the account-
// fallback comment in ServiceCalendar.js).
//
// URL account/scope still wins over the landing computation (branches 1
// and 2 below); the account switcher is orthogonal - flipping accounts
// after landing does not re-run this helper.
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
  // 3) floor tier + resolved home account -> workspace at current period.
  //    Resolve tier from either `roles` (multi-role aware) or `role`
  //    (single - kept for backward compat with the Stage 4 signature).
  //    Floor-wins applies on `roles`; single-role uses the same map.
  //    periodKey is null at mount; the existing periodRanges-init
  //    effect (B2a) sets periodKey to the period containing today
  //    when landOnCurrentPeriod is true.
  //    F2: gated on hasHomeAccount so a floor role without a resolved
  //    account (via user_accounts_derived) falls to the Season overview
  //    instead of the CIN-AZ fallback.
  const tier = Array.isArray(roles)
    ? tierFromRoles(roles)
    : roleTier(role);
  if (tier === "floor" && hasHomeAccount) {
    return {
      scope: "period", lens: "period",
      isAdminView: false, periodKey: null,
      landOnCurrentPeriod: true,
    };
  }
  // 4) leadership / unknown / floor-without-home -> Season overview,
  //    Period lens (2026-09-03 ruling). Prior default was
  //    lens="calendar" for this branch; Kevin ruled Period is the
  //    right default view for everyone because the calendar-shaped
  //    month view invites finalizing a billing week from a month-
  //    shaped screen (see item 2 finalize scope). Session-only: no
  //    persistence. If Kevin sees people re-toggling to Calendar,
  //    revisit with a preference column.
  return {
    scope: "year", lens: "period",
    isAdminView: false, periodKey: null,
    landOnCurrentPeriod: false,
  };
}
