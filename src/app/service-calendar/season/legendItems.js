// Shared legend items table (extracted in cleanup C1a from
// StateLegend + LegendInfoPopup, which duplicated the mod->visual
// mapping across four account-shape branches).
//
// Each entry: { mod, icon, label, description }.
//   mod         - status-modifier class ("entered", "needs-entry", ...)
//   icon        - unicode dingbat inside the swatch (glyphless => "")
//   label       - the always-visible legend chip label
//   description - the popup copy for LegendInfoPopup
//
// getLegendItems returns the array for the active account shape.
// StateLegend renders labels only (short) + a universal "Today"
// trailer. LegendInfoPopup renders labels + descriptions, plus its
// own Section framing around the array.
//
// ─── SC drill Phase 1 · DP1-18 (2026-07-20) - ONE STATE SPINE ───
//
// Owner ruling: unify the shared STATE VOCABULARY across the four
// arrays so switching accounts changes WHICH entries appear, not
// the wording of shared ones. Layered model:
//
// SHARED STATE SPINE (identical label + swatch on every array
// that has the state):
//   entered      -> "Entered"       - actionable day with actuals
//   needs-entry  -> "Needs entry"   - past day without actuals
//   overdue      -> "Overdue"       - past entry deadline
//   upcoming     -> "Upcoming"      - future service day
//   today        -> "Today"         - navy outline ring (added
//                                     universally by StateLegend.js)
//
// ACCOUNT-SPECIFIC ADDITIONS (real semantic differences - kept
// distinct per the guardrail):
//   off (HOMESTAND only) -> "Non Game day" - a between-games day
//     on an MLB/AAA schedule. GUARDRAIL FIRED: reconciling per-
//     meal's grey off-tile with MLB's "Non Game day" would
//     mislabel one or the other - per-meal off means "no service
//     contract this day"; MLB Non-Game-day means "scheduled non-
//     game between games". Different semantics. HOMESTAND keeps
//     "Non Game day"; per-meal / MiLB / FEE strip continues to
//     drop off from the legend (self-evident flat grey per
//     StateLegend.js:43-45).
//   exhibition (HOMESTAND) -> "EXH" - TXR spring exhibitions.
//   away (HOMESTAND)       -> "Away" - team on the road.
//
// ORTHOGONAL MARKER LAYER (glyph/notch swatches, not state fills):
//   game-day-mark   -> "Game day"      (F9 outline notch, navy)
//   spring-mark     -> "Spring Training" (F9 outline notch, copper)
//   milb-day        -> "Day"           (sun glyph on lg tile)
//   milb-night      -> "Night"         (moon glyph on lg tile)
// Markers are appended to the strip by StateLegend.js and
// getLegendItems() per account shape - they layer on top of the
// spine, they don't compete with state names.
//
// PRIOR STATE (before DP1-18): HOMESTAND used "Scheduled" for the
// upcoming mod class (same mod as per-meal "Upcoming"). Same state
// under the hood; different word. Renamed to "Upcoming" - matches
// the spine. The longer "Scheduled game day" survives as labelLong
// so LegendInfoPopup can still surface the MLB-flavored specificity
// in its detail section.
//
// v1 REGRESSION DECLARATION (owner-accepted for the demolition-
// bound v1): renaming HOMESTAND upcoming's label lands in v1 too.
// v1 MLB fee accounts will read "Upcoming" instead of "Scheduled"
// on their legend strip + popup. Owner spec permits this
// (v1 is demolition-bound); declared here rather than silently
// changed.

// OV-3 F9 (2026-07-19) - overlay marker legend entries. Notch
// construction (see .scv2 .sc-daysq--sm.sc-daysq--game-day::before
// + .sc-daysq--spring::after in DaySquare.css) - stroke-only corner
// brackets that don't devour the tile numeral. Game mark navy;
// spring mark copper.
const GAME_DAY_MARK = {
  mod: "game-day-mark",
  icon: "",
  label: "Game day",
  labelLong: "Game day mark",
  description: "Navy top-right corner bracket - the day is a scheduled home game (or an overlay game for STL - FL / TBJ - FL AAA).",
};
const SPRING_MARK = {
  mod: "spring-mark",
  icon: "",
  label: "Spring Training",
  labelLong: "Spring Training mark",
  description: "Copper bottom-left corner bracket - the day falls inside the account's Spring Training phase (PDC accounts).",
};

const HOMESTAND = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Actuals recorded (zero counts as a cancelled game).",
  },
  {
    // DP1-18: label unified to the spine word "Upcoming" (was
    // "Scheduled" - same mod class as per-meal upcoming, just
    // MLB-flavored wording). labelLong preserves "Scheduled game
    // day" so LegendInfoPopup can still surface the MLB detail.
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    labelLong: "Scheduled game day",
    description: "Upcoming game on the homestand schedule.",
  },
  {
    mod: "off",
    icon: "",
    label: "Non Game day",
    description: "Between-games day, no scheduled service.",
  },
  {
    mod: "exhibition",
    icon: "",
    label: "EXH",
    labelLong: "Exhibition",
    description: "Spring-training exhibition, billed outside the contract. Display-only.",
  },
  {
    mod: "away",
    icon: "",
    label: "Away",
    labelLong: "Away game",
    description: "Team on the road, no home service. Display-only, plane glyph top-right.",
  },
];

const FEE = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Service confirmed, actuals recorded.",
  },
  {
    mod: "needs-entry",
    icon: "✎",
    label: "Needs entry",
    description: "Past day with no actuals yet.",
  },
  {
    mod: "overdue",
    icon: "!",
    label: "Overdue",
    description: "Past entry deadline.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    description: "Future service day.",
  },
];

const MILB = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Service confirmed, actuals recorded.",
  },
  {
    mod: "needs-entry",
    icon: "✎",
    label: "Needs entry",
    description: "Past day with no actuals yet.",
  },
  {
    mod: "overdue",
    icon: "!",
    label: "Overdue",
    description: "Past entry deadline.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    description: "Future service day.",
  },
  // Day/night live in a separate MILB_DAY_NIGHT array below - their
  // swatch renders sun/moon glyphs, not a swatch fill, so both
  // components branch on them explicitly.
];

const PER_MEAL = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Actuals recorded.",
  },
  {
    mod: "needs-entry",
    icon: "✎",
    label: "Needs entry",
    description: "Past day with no actuals yet.",
  },
  {
    mod: "overdue",
    icon: "!",
    label: "Overdue",
    description: "Past entry deadline.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    description: "Future service day.",
  },
];

// P2 (item 3, R3, 2026-07-10): shared entry for the DaySquare note
// indicator - the chat-bubble outline that renders on days carrying
// at least one authored NOTE ledger entry. Not a status, so it lives
// alongside MILB_DAY_NIGHT as an orthogonal-signal entry rather than
// inside the per-shape status arrays. LegendInfoPopup consumes it in
// the "Calendar context" section (same place TODAY lives). StateLegend
// does NOT append it to the compact strip - the strip is status-only.
export const NOTE_INDICATOR = {
  mod: "notebubble",
  label: "Has notes",
  labelLong: "Has notes",
  description: "Day carries an authored note.",
};

// MiLB day/night entries. Sun/moon icons come from Icons.js via the
// consumer components. StateLegend appends both to the strip; the
// popup renders them via MilbRow.
export const MILB_DAY_NIGHT = [
  {
    mod: "milb-day",
    type: "day",
    label: "Day",
    labelLong: "Day game",
    description: "Amber sun on the homestand day.",
  },
  {
    mod: "milb-night",
    type: "night",
    label: "Night",
    labelLong: "Night game",
    description: "Navy moon on the homestand day.",
  },
];

// Returns the account-shape array. Same branch order the two
// consumer components used pre-C1a.
// OV-3 F9: game-day + spring markers append to the arrays where
// the marks CAN render on tiles today:
//   - Game mark: HOMESTAND (MLB fee + MiLB AAA via #474 emit) +
//     FEE (STL - FL overlay via sc-17) + PER_MEAL (TBJ - FL AAA
//     overlay via sc-17b).
//   - Spring mark: FEE (STL - FL is PDC) + PER_MEAL (PDC per-meal
//     accounts have springDateSet from phaseCalendar).
// MILB (non-fee, non-homestand, non-AAA) sees neither marker in
// practice, so its array stays untouched.
export function getLegendItems({ hasHomestandSchedule, isFeeAccount, isMilb }) {
  if (hasHomestandSchedule) return [...HOMESTAND, GAME_DAY_MARK];
  if (isFeeAccount)         return [...FEE, GAME_DAY_MARK, SPRING_MARK];
  if (isMilb)               return MILB;
  return [...PER_MEAL, GAME_DAY_MARK, SPRING_MARK];
}
