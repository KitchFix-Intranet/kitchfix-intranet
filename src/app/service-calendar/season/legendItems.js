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
// Copy is verbatim-preserved from the pre-C1a renders - this
// consolidates the SOURCE, not the wording.

const HOMESTAND = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description:
      "Actuals recorded. Includes game days (any recorded meal count, zero counts as a cancelled game) and non-game days where meals were served.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Scheduled",
    labelLong: "Scheduled game day",
    description: "An upcoming game on the homestand schedule.",
  },
  {
    mod: "off",
    icon: "",
    label: "Non Game day",
    description: "Prep, open, close, or off-day between homestands.",
  },
  // sc-12 (2026-07-10): TXR spring-training exhibitions (vs KC).
  // Display-only tile - billed as separate catering outside the
  // contract, so it does NOT count toward the game-days-entered
  // progress bar and cannot be clicked to enter actuals.
  {
    mod: "exhibition",
    icon: "",
    label: "EXH",
    labelLong: "Exhibition",
    description:
      "Spring-training exhibition. Billed as separate catering outside the contract. Display-only - excluded from the game-days-entered counter and not clickable.",
  },
  // sc-13 (2026-07-10): away games - team is on the road, no service.
  // Display-only tile - carries date + opponent for planning context,
  // but excluded from the game-days-entered counter and not clickable.
  // The plane glyph top-right is the primary shape signal.
  {
    mod: "away",
    icon: "",
    label: "Away",
    labelLong: "Away game",
    description:
      "Team is on the road; no service happens at the home clubhouse. Display-only - excluded from the game-days-entered counter and not clickable. Plane glyph top-right is the state signal.",
  },
];

const FEE = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Service confirmed - actuals recorded.",
  },
  {
    mod: "needs-entry",
    icon: "✎",
    label: "Needs entry",
    description: "Past day with no actuals yet - action required.",
  },
  {
    mod: "overdue",
    icon: "!",
    label: "Overdue",
    description: "Past entry deadline - escalated action.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    description: "Future service day; nothing required yet.",
  },
];

const MILB = [
  {
    mod: "entered",
    icon: "",
    label: "Entered",
    description: "Service confirmed - actuals recorded.",
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
    description: "Past entry deadline - escalated.",
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
    description: "Past day with no actuals yet - action required.",
  },
  {
    mod: "overdue",
    icon: "!",
    label: "Overdue",
    description: "Past entry deadline - escalated.",
  },
  {
    mod: "upcoming",
    icon: "○",
    label: "Upcoming",
    description: "Future service day; nothing required yet.",
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
  description:
    "The day carries at least one authored note in its Activity ledger. The bubble reads at half opacity so it defers to the state signal.",
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
    description: "Day game - amber sun on the homestand day.",
  },
  {
    mod: "milb-night",
    type: "night",
    label: "Night",
    labelLong: "Night game",
    description: "Night game - navy moon on the homestand day.",
  },
];

// Returns the account-shape array. Same branch order the two
// consumer components used pre-C1a.
export function getLegendItems({ hasHomestandSchedule, isFeeAccount, isMilb }) {
  if (hasHomestandSchedule) return HOMESTAND;
  if (isFeeAccount)         return FEE;
  if (isMilb)               return MILB;
  return PER_MEAL;
}
