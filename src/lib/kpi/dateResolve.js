// src/lib/kpi/dateResolve.js
//
// Preset-date resolution shared by the labor page, the export route,
// and the saved-views validation. A saved view stores INTENT
// (preset name), so both server and client must agree on how a
// preset resolves at query time.
//
// The five presets:
//   this_period, last_period    require an accountPeriods list from
//                                sc_day_metadata (per-account fiscal
//                                boundaries). If empty, return null.
//   last_4wk, last_13wk, fytd   pure date math against today.
//
// Returns { start, end } as ISO YYYY-MM-DD, or null when the preset
// cannot be resolved (missing period data or unknown preset name).

const FY_START = "2025-12-29";  // FY2026 opens

export const PRESET_LABELS = {
  this_period: "This period",
  last_period: "Last period",
  last_4wk:    "Last 4 wk",
  last_13wk:   "Last 13 wk",
  fytd:        "FYTD",
};

export function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolvePreset(preset, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const periods = opts.accountPeriods || [];
  switch (preset) {
    case "last_4wk":  return { start: addDaysISO(today, -27), end: today };
    case "last_13wk": return { start: addDaysISO(today, -90), end: today };
    case "fytd":      return { start: FY_START,               end: today };
    case "this_period":
    case "last_period": {
      const withBounds = periods.filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
      const past = withBounds.filter(p => p.start <= today);
      if (past.length === 0) return null;
      const p = preset === "this_period" ? past[past.length - 1] : past[past.length - 2];
      if (!p) return null;
      return { start: p.start, end: p.end };
    }
    default: return null;
  }
}

// Given a view row and the account's periods, produce the concrete
// resolved range. Returns null on unresolvable preset (e.g. no periods
// data or invalid preset name).
export function resolveViewDates(view, opts = {}) {
  if (!view) return null;
  if (view.date_mode === "absolute") {
    return { start: view.date_from, end: view.date_to };
  }
  if (view.date_mode === "preset") {
    return resolvePreset(view.date_preset, opts);
  }
  return null;
}
