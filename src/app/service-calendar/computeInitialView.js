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
// Stage 4 (current): the helper accepts `role` and applies the
// alias-mapped routing. The mount currently passes role=null because
// contacts.role is NOT exposed at the mount fetch yet (sc-accounts
// returns defaultAccount but not role). FLAGGED for follow-up - to
// activate floor-vs-leadership landing, either extend the existing
// sc-accounts response with role from contacts, or add a sc-user-role
// endpoint. Until then, every user gets the Season default - the same
// behavior shipped pre-Stage 4. The seam is wired; the data path is
// the next change.

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

export function computeInitialView({ urlView, urlPeriod, isAdmin, role = null }) {
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
  // 3) floor role lands on the workspace at the current period.
  //    periodKey is null at mount; the mount effect that watches
  //    periodRanges flips landOnCurrentPeriod -> sets periodKey to
  //    the period containing today. Until role data is plumbed,
  //    role=null -> falls through to (4).
  if (roleTier(role) === "floor") {
    return {
      scope: "period", lens: "period",
      isAdminView: false, periodKey: null,
      landOnCurrentPeriod: true,
    };
  }
  // 4) leadership / unknown -> Season overview (today's default)
  return {
    scope: "year", lens: "calendar",
    isAdminView: false, periodKey: null,
    landOnCurrentPeriod: false,
  };
}
