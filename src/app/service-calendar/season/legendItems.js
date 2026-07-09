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
