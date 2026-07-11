// Shared day-resolution helpers for the SC redesign (Stages 1-5).
//
// These map between the engine's resolved data and the DaySquare
// atom's prop shape. They live in one file so Stages 2 and 3 reuse
// the SAME mappings the Stage 1 Calendar grid uses; the trusted
// heatmap's status assignments stay the source of truth across
// every new surface.
//
// IMPORTANT: these are PURE - no React, no engine calls, no fetching.

// Map the engine's per-day status (from sc-year-summary or sc-load)
// to the atom's smaller status enum. The atom intentionally collapses
// some of the heatmap's finer distinctions (upcoming-game vs
// future-service vs prep) into broader buckets because the year-grid
// at small size shouldn't carry that nuance - it lives in the strip
// + the polymorphic middle line. Stage 5 polymorphism hardening can
// revisit if Kevin wants finer day-state cues.
//
// Engine enum (from serviceCalendar.js classify() + client remaps):
//   entered          actuals in
//   needs-entry      past, unentered, before lock
//   overdue          past, unentered, locked
//   future           upcoming service day (per-meal)
//   upcoming-game    upcoming game day (MiLB - client remap)
//   future-service   upcoming service day (per-meal - client remap)
//   no-service       confirmed zero, or planned off-day
//   off-season       outside the operational arc
//   prep             non-game day in homestand (fee accounts)
//
// Atom enum (Design Batch 1 expanded):
//   entered, needs-entry, overdue, upcoming, off, off-season, loading, failed
//   + today/selected/focused overlays.
//
// off-season splits from off so "outside the operational arc" reads
// distinctly from "confirmed zero" / "planned off-day" (audit non-
// negotiable #2). The atom CSS gives off-season a diagonal hatch as
// the non-color cue.
//
// loadState is the client-side hook (no engine change). The shell
// passes one of:
//   undefined | "loaded" - resolve from serverStatus (the normal path)
//   "loading"            - data fetch in flight, render the loading skeleton
//   "failed"             - data fetch errored, render the failed-load cell
// A failed or loading day NEVER falls back to a zero render - the rubric's
// highest-priority tracker check.
//
// C1b (Section-2 midnight candidate): the server bakes `day.isPast`
// at fetch time. A tab left open across midnight then misclassifies
// today/yesterday - the payload's isPast for yesterday still reads
// false, and today reads false when it should read true after
// midnight. Client sites now derive pastness at READ time via
// isPastDate(day.date) against local midnight. Next interaction or
// render after midnight self-corrects; no timers/refresh loops.
// Server payload keeps isPast for its own readers.
export function isPastDate(iso) {
  if (!iso) return false;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const today = `${y}-${m}-${d}`;
  return iso < today; // lexicographic YYYY-MM-DD is date-order
}

export function resolveDayStatus(serverStatus, loadState) {
  if (loadState === "loading") return "loading";
  if (loadState === "failed")  return "failed";
  switch (serverStatus) {
    case "entered":       return "entered";
    case "needs-entry":   return "needs-entry";
    case "overdue":       return "overdue";
    case "future":        return "upcoming";
    case "upcoming-game": return "upcoming";
    case "future-service":return "upcoming";
    case "no-service":    return "off";
    case "off-season":    return "off-season";
    case "prep":          return "off";
    case "exhibition":    return "exhibition";
    case "away":          return "away";
    default:              return "off";
  }
}

// Resolve the polymorphic content kind for the atom from the account
// shape. The account block lives at data.account on sc-load and on
// the account-list endpoint. The kind drives which middle-line
// content renders on the atom:
//   per-meal       $ + meals (CIN-AZ, TXR-AZ, TBR-FL, MiLB per-meal)
//   mlb-fee        opponent + meals, NO $ (4 MLB fee accounts)
//   milb           day/night pill + meals (MiLB hybrid)
//   fee-no-dollar  served + meals, structural no-$ (STL-FL)
//
// hasHomestandSchedule is the practical gate for "is this a homestand-
// fee account" because STL-FL is flat_fee but has no homestand rows -
// it falls into fee-no-dollar via that gate even though billing_model
// agrees with the 4 MLB fees.
export function resolveDayKind({ billingModel, category, hasHomestandSchedule }) {
  // sc-16 (2026-07-11): MiLB AAA accounts (Louisville/Buffalo) get
  // hasHomestandSchedule=true but stay per-meal financially. Gate the
  // mlb-fee (no-$) render on flat_fee as well as schedule presence so
  // MiLB with schedule falls through to the milb branch (per-meal $
  // preserved, schedule context additive).
  if (hasHomestandSchedule && billingModel === "flat_fee") return "mlb-fee";
  if (billingModel === "flat_fee") return "fee-no-dollar"; // STL-FL path
  if (category === "MiLB") return "milb";
  return "per-meal";
}

// Build the content bag the atom expects from the per-day data the
// year-summary returns. The year-summary days[] is THINNER than
// sc-load's days[] - it has actualMeals + status + optional homestand
// fields, but no per-service projected/actual breakdown. So the small
// (year-grid) tiles render with the data the heatmap already has.
//
// Returns null when no useful content exists (off days, off-season) -
// the atom handles a null content prop cleanly.
export function buildCompactContent(day, kind) {
  if (!day) return null;
  const meals = Number(day.actualMeals) || 0;
  switch (kind) {
    case "mlb-fee": {
      // 2026-07-11 fix: strip dayNight from the sm content bag entirely.
      // The lg pill's atom-level `size === "lg"` render gate was already
      // correct, but keeping dayNight on the sm bag left a data path
      // that any current or future sm-scope reader (renderMiddleLine,
      // pickCompactSmall, buildAriaLabel, a downstream hook) could
      // pick up and re-emit as a glyph. Sm tiles are date + opponent
      // only - no day/night signal at all, per Kevin's ruling.
      return day.opponent ? { opponent: day.opponent } : null;
    }
    case "milb": {
      // 2026-07-11 fix: MiLB sm tiles no longer emit a day/night pill
      // in the compact bag. The sun/moon on sm was retired as part of
      // the ghost-pill migration (matches sc-13 away-plane sm-drop).
      // sc-16 (2026-07-11): MiLB with schedule (Louisville/Buffalo)
      // surfaces the opponent chip on sm (matches mlb-fee compact bag).
      // Other MiLB accounts have no opponent field on year-summary days
      // and stay date-only. Day/night pill still stripped from sm per
      // the polish pass.
      return day.opponent ? { opponent: day.opponent } : null;
    }
    case "fee-no-dollar":
      return meals > 0 ? { served: meals } : null;
    case "per-meal":
    default:
      // Year-summary doesn't carry per-day projected revenue, only the
      // per-MONTH totals. So per-meal small tiles show meals only at
      // the year level. Per-meal $ shows on the lg atom in the workspace
      // (Stage 3), which reads sc-load's day.totals.
      return meals > 0 ? { meals } : null;
  }
}
