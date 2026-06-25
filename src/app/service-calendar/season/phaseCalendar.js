// Phase calendar - canonical phase vocabulary + alias map + the
// recorded 2026 PDC phase data, seeded from docs/SC_PDC_PHASES.md.
//
// This file is the DATA LAYER under the phase-derivation spine
// (phaseDerivation.js). It is purely declarative - no logic, no
// React, no fetches. derivePhaseTimeline() reads it.
//
// Source of truth: docs/SC_PDC_PHASES.md (recorded for 3/5 PDCs from
// the "Camp Name" column in the SC spreadsheets; not recorded for
// TBJ-FL / STL-FL).
//
// When fiscal 2027 lands: add 2027 entries to the PER_ACCOUNT_2026
// constant alongside (rename if helpful) or migrate to an
// engine-backed sc_phases table (the doc's eventual plan). This file
// is the bootstrap until then.

// ─── Canonical phase vocabulary ────────────────────────────────────
// Operator-meaningful blocks that survive an alias map. Names match
// the per-account labels closely enough that an operator reading the
// strip sees their phase by name, not by abstraction.
//
// Color tints (Decision 3 - color-load audit):
// - Each tint is a desaturated WASH (lightness >=80%) so dark navy
//   text reads at >=9:1 contrast on top.
// - Hue families intentionally span warm-neutral / sky-blue / sea-green
//   / mauve so no two canonical phases sit on the same hue family.
// - NO tint shares the day-square palette's hue (entered=#A8E5C9 teal;
//   needs-entry=#FCD9A0 amber; overdue=#F4B5AC brick; upcoming=#E0F1E7
//   whisper-green; off=#F1EFE8). The phase tints all sit on warm-or-
//   blue-or-mauve rails so they cannot be mistaken for day-status.
export const CANONICAL_PHASES = {
  off:              { label: "Off-season",        tint: "#E6E2D6", textTint: "#5C5440", short: "OFF" },
  prep:             { label: "Camps",             tint: "#F4E4C2", textTint: "#7A5C28", short: "Camp" },
  "spring-training":{ label: "Spring Training",   tint: "#C7D9EA", textTint: "#274A78", short: "ST"   },
  extended:         { label: "Extended",          tint: "#C8DEDC", textTint: "#2D5350", short: "Ext"  },
  "complex-league": { label: "Complex League",    tint: "#A8C5C0", textTint: "#26494A", short: "ACL/FCL" },
  bridge:           { label: "Bridge",            tint: "#E4C9A8", textTint: "#7A4B17", short: "Bridge" },
  instructional:    { label: "Instructional",     tint: "#D9C7DC", textTint: "#5E3F66", short: "Instr" },
  rehab:            { label: "Rehab / Staff",     tint: "#D6D2C8", textTint: "#5C5440", short: "Rehab" },
  unknown:          { label: "Phase pending",     tint: "#EBE9E2", textTint: "#6B6754", short: "?"   },
};

// ─── Alias map ─────────────────────────────────────────────────────
// Maps the messy per-account recorded names from sc_day_metadata's
// event_label (the "Camp Name" column) to the canonical phase keys.
// Driven by the names actually present in SC_PDC_PHASES.md tables.
// Case-insensitive lookups; the deriver normalizes the input.
export const PHASE_ALIAS_MAP = {
  // Off-season variants
  "off":                 "off",
  "off-season":          "off",
  "offseason":           "off",

  // Camps / pre-camp
  "battery camp":        "prep",
  "fantasy camp":        "prep",
  "early camp":          "prep",
  "camps":               "prep",
  "pre-camp":            "prep",

  // Spring Training
  "mlb st":              "spring-training",
  "st":                  "spring-training",
  "st workouts":         "spring-training",
  "spring training":     "spring-training",

  // Extended Spring
  "extended":            "extended",
  "extended spring":     "extended",

  // Complex League
  "acl":                 "complex-league",
  "fcl":                 "complex-league",
  "acl/draft":           "complex-league",

  // Bridge
  "bridge":              "bridge",

  // Instructional
  "instructs":           "instructional",
  "instructs/camps":     "instructional",
  "instructional":       "instructional",

  // Rehab / Staff
  "rehab":               "rehab",
  "staff/rehab":         "rehab",
  "staff":               "rehab",
};

// ─── Recorded 2026 phase calendars ────────────────────────────────
// Seeded directly from docs/SC_PDC_PHASES.md. For accounts that DO NOT
// record (TBJ-FL, STL-FL), this is null - the deriver returns the
// "phase data pending" degraded state.
//
// Each row is { start, end, recordedLabel } in YYYY-MM-DD form. The
// deriver applies PHASE_ALIAS_MAP to recordedLabel to produce the
// canonical key.

export const PER_ACCOUNT_2026 = {
  "CIN - AZ": [
    { start: "2025-12-29", end: "2026-01-03", recordedLabel: "OFF" },
    { start: "2026-01-04", end: "2026-01-11", recordedLabel: "Battery Camp" },
    { start: "2026-01-12", end: "2026-01-18", recordedLabel: "Fantasy Camp" },
    { start: "2026-01-19", end: "2026-02-08", recordedLabel: "Early Camp" },
    { start: "2026-02-09", end: "2026-03-22", recordedLabel: "MLB ST" },
    { start: "2026-03-23", end: "2026-04-01", recordedLabel: "ST" },
    { start: "2026-04-02", end: "2026-05-17", recordedLabel: "Extended" },
    { start: "2026-05-18", end: "2026-07-15", recordedLabel: "ACL" },
    { start: "2026-07-16", end: "2026-07-20", recordedLabel: "ACL/Draft" },
    { start: "2026-07-21", end: "2026-07-26", recordedLabel: "ACL" },
    { start: "2026-07-27", end: "2026-08-23", recordedLabel: "Bridge" },
    { start: "2026-08-24", end: "2026-11-15", recordedLabel: "Instructs/Camps" },
    { start: "2026-11-16", end: "2026-12-20", recordedLabel: "OFF" },
  ],

  "TXR - AZ": [
    // Staff/Rehab + ST Workouts kept simple; the Feb 20 - Mar 22 window
    // is recorded as per-day game labels in the source - we collapse it
    // to a Spring Training block here (the doc's recommendation).
    { start: "2025-12-29", end: "2026-02-08", recordedLabel: "Staff/Rehab" },
    { start: "2026-02-09", end: "2026-02-19", recordedLabel: "ST Workouts" },
    { start: "2026-02-20", end: "2026-03-22", recordedLabel: "Spring Training" },
    { start: "2026-03-23", end: "2026-06-14", recordedLabel: "Extended" },
    { start: "2026-06-15", end: "2026-08-30", recordedLabel: "ACL" },
    { start: "2026-08-31", end: "2026-09-27", recordedLabel: "Bridge" },
    { start: "2026-09-28", end: "2026-11-15", recordedLabel: "Instructs" },
    { start: "2026-11-16", end: "2026-11-22", recordedLabel: "OFF" },
    { start: "2026-11-23", end: "2026-12-13", recordedLabel: "Staff/Rehab" },
    { start: "2026-12-14", end: "2026-12-20", recordedLabel: "OFF" },
  ],

  "TBR - FL": [
    { start: "2025-12-29", end: "2026-01-04", recordedLabel: "OFF" },
    { start: "2026-01-05", end: "2026-02-08", recordedLabel: "Camps" },
    { start: "2026-02-09", end: "2026-03-29", recordedLabel: "ST" },
    { start: "2026-03-30", end: "2026-04-26", recordedLabel: "Extended" },
    { start: "2026-04-27", end: "2026-07-26", recordedLabel: "FCL" },
    { start: "2026-07-27", end: "2026-09-27", recordedLabel: "Bridge" },
    { start: "2026-09-28", end: "2026-10-11", recordedLabel: "Rehab" },
    { start: "2026-10-12", end: "2026-11-22", recordedLabel: "Camps" },
    { start: "2026-11-23", end: "2026-12-20", recordedLabel: "OFF" },
  ],

  // TBJ-FL and STL-FL: NOT recorded (SC_PDC_PHASES.md).
  // Returning null here makes derivePhaseTimeline emit the
  // "phase calendar pending confirmation" degraded state. Stage 3+
  // could seed an inference draft for Kevin to confirm; not in scope
  // for Stage 2.
  "TBJ - FL": null,
  "STL - FL": null,
};

// Resolve a recorded label to canonical phase key. Case-insensitive,
// trim-tolerant. Unknown labels fall back to "unknown" (which renders
// as the neutral pending tint - never crashes).
export function resolveCanonicalPhase(recordedLabel) {
  if (!recordedLabel) return "unknown";
  const key = String(recordedLabel).trim().toLowerCase();
  return PHASE_ALIAS_MAP[key] || "unknown";
}
