// Phase calendar - canonical phase vocabulary + alias map + the
// recorded 2026 PDC phase data, seeded from docs/SC_PDC_PHASES.md.
//
// This file is the DATA LAYER under the phase-derivation spine
// (phaseDerivation.js). It is purely declarative - no logic, no
// React, no fetches. derivePhaseTimeline() reads it.
//
// Source of truth: docs/SC_PDC_PHASES.md. 3/5 PDCs (CIN-AZ, TXR-AZ,
// TBR-FL) recorded from the "Camp Name" column in the SC spreadsheets.
// TBJ-FL / STL-FL carry a confirmed simple calendar inferred from the
// meal-signal (TBR-FL peer arc + each account's own data-visible
// boundaries), Kevin-approved 2026-07.
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
// Color tints - V3 §5.5 phase family (T-table).
// -------------------------------------------------
// 2026-07-19 (OV-2 C2): tints re-authored to the V3 T-table phase
// family. Six semantic slots per spec:
//   spring         #d3b06a
//   extended       #9db8c9
//   complex        #78a892
//   bridge         #c9986f
//   instructional  #a58fc0
//   off            #b9b3a6
// Prior tints (pastel washes in warm-neutral / sky-blue / sea-green /
// mauve rails) were exactly what the owner rejected in the V3 review.
//
// Cross-surface note: PeriodCard / SeasonStepper / v1 PhaseStrip also
// read from this constant, so the recolor is visible on flag-off too.
// This is INTENTIONAL and listed in the ripple ledger - the T-table
// phase family is the one source across every consumer.
//
// Legacy phase slots (prep, rehab, unknown) that don't have a direct
// T-table analog fall through to the neutral off/family tone.
export const CANONICAL_PHASES = {
  off:              { label: "Off-season",        tint: "#b9b3a6", textTint: "#5C5440", short: "OFF" },
  prep:             { label: "Camps",             tint: "#c9986f", textTint: "#7A4B17", short: "Camp" },      /* bridge family */
  "spring-training":{ label: "Spring Training",   tint: "#d3b06a", textTint: "#5C4218", short: "ST"   },
  extended:         { label: "Extended",          tint: "#9db8c9", textTint: "#2B4A62", short: "Ext"  },
  "complex-league": { label: "Complex League",    tint: "#78a892", textTint: "#1F3E33", short: "ACL/FCL" },
  bridge:           { label: "Bridge",            tint: "#c9986f", textTint: "#7A4B17", short: "Bridge" },
  instructional:    { label: "Instructional",     tint: "#a58fc0", textTint: "#3F2F5A", short: "Instr" },
  rehab:            { label: "Rehab / Staff",     tint: "#b9b3a6", textTint: "#5C5440", short: "Rehab" },     /* off family */
  unknown:          { label: "Phase pending",     tint: "#b9b3a6", textTint: "#5C5440", short: "?"   },       /* off family */
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

  // TBJ-FL and STL-FL: no clean recorded phase column (TBJ = one-day
  // event flags only; STL = blank "Homestand" column). These blocks are
  // a CONFIRMED simple calendar (Kevin-approved 2026-07): TBR-FL's arc as
  // the FL-peer skeleton, with the three boundaries each account's own
  // covers actually show - OFF year-ends; Camps->ST 2/9; ST->Extended 3/22
  // (their own covers step, not TBR's 3/29); Camps->OFF 11/23. Internal
  // Extended/FCL/Bridge dates are peer-anchored (data silent, esp. STL's
  // 140/240 summer rotation). Invented sub-splits (Jan Battery/Fantasy/
  // Early Camp; fall Rehab/Camps) collapsed to plain Camps. TBJ's
  // ~100-cover late-Nov/early-Dec activity is folded into OFF for the
  // simple pass (see SC_PDC_PHASES.md). Both accounts run the same arc;
  // TBJ ~2x STL volume. FL -> FCL, never ACL.
  "TBJ - FL": [
    { start: "2025-12-29", end: "2026-01-04", recordedLabel: "OFF" },
    { start: "2026-01-05", end: "2026-02-08", recordedLabel: "Camps" },
    { start: "2026-02-09", end: "2026-03-22", recordedLabel: "ST" },
    { start: "2026-03-23", end: "2026-04-26", recordedLabel: "Extended" },
    { start: "2026-04-27", end: "2026-07-26", recordedLabel: "FCL" },
    { start: "2026-07-27", end: "2026-09-27", recordedLabel: "Bridge" },
    { start: "2026-09-28", end: "2026-11-22", recordedLabel: "Camps" },
    { start: "2026-11-23", end: "2026-12-20", recordedLabel: "OFF" },
  ],

  "STL - FL": [
    { start: "2025-12-29", end: "2026-01-04", recordedLabel: "OFF" },
    { start: "2026-01-05", end: "2026-02-08", recordedLabel: "Camps" },
    { start: "2026-02-09", end: "2026-03-22", recordedLabel: "ST" },
    { start: "2026-03-23", end: "2026-04-26", recordedLabel: "Extended" },
    { start: "2026-04-27", end: "2026-07-26", recordedLabel: "FCL" },
    { start: "2026-07-27", end: "2026-09-27", recordedLabel: "Bridge" },
    { start: "2026-09-28", end: "2026-11-22", recordedLabel: "Camps" },
    { start: "2026-11-23", end: "2026-12-20", recordedLabel: "OFF" },
  ],
};

// Resolve a recorded label to canonical phase key. Case-insensitive,
// trim-tolerant. Unknown labels fall back to "unknown" (which renders
// as the neutral pending tint - never crashes).
export function resolveCanonicalPhase(recordedLabel) {
  if (!recordedLabel) return "unknown";
  const key = String(recordedLabel).trim().toLowerCase();
  return PHASE_ALIAS_MAP[key] || "unknown";
}
