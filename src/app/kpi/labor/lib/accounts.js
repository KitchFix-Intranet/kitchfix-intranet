// src/app/kpi/labor/lib/accounts.js
//
// Account roster. The folio falls back to this flat list until the
// /api/kpi/labor accounts_directory payload arrives.

export const ACCOUNTS = [
  "CIN - AZ", "CIN - OH", "CIN - KY",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

// V7-3 - Sections are the command-bar dropdown that replaces the v6
// tabs row. K5 preserved: non-Labor items ghosted with a SOON tag.
export const SECTIONS = [
  { key: "overview", label: "Overview",   enabled: false },
  { key: "labor",    label: "Labor",      enabled: true  },
  { key: "food",     label: "Food",       enabled: false },
  { key: "other",    label: "Other COGS", enabled: false },
  { key: "revenue",  label: "Revenue",    enabled: false },
  { key: "pnl",      label: "P&L",        enabled: false },
];

// Preset date keys (client-resolvable). Same values the loader's
// validation CHECK accepts on kpi_saved_views.date_preset.
export const PRESET_KEYS = ["this_period", "last_period", "last_4wk", "last_13wk", "fytd"];

export const FY_START = "2025-12-29";  // FY2026 opens

// V7-16 - member row description ruling. The three special-case keys
// override the metadata team_name so the folio displays what operators
// call the site, not the parent MLB club:
//   TBJ - NY     -> Buffalo Bisons · Buffalo, NY  (MiLB affiliate)
//   TXR - TX - H -> Rangers · Home · Arlington, TX
//   TXR - TX - V -> Rangers · Visitor · Arlington, TX
// Every other key uses `<accounts.name> · <city>, <state>`. If any
// required metadata field is missing, callers render the key alone
// and log the gap in the PR body. Returns { line, missing } where
// `missing` is a list of the field names that were absent.
export function folioMemberDescription(teamKey, meta) {
  if (teamKey === "TBJ - NY") {
    return { line: "Buffalo Bisons · Buffalo, NY", missing: [] };
  }
  if (teamKey === "TXR - TX - H") {
    return { line: "Rangers · Home · Arlington, TX", missing: [] };
  }
  if (teamKey === "TXR - TX - V") {
    return { line: "Rangers · Visitor · Arlington, TX", missing: [] };
  }
  const missing = [];
  if (!meta?.team_name) missing.push("team_name");
  if (!meta?.city) missing.push("city");
  if (!meta?.state) missing.push("state");
  if (missing.length > 0) return { line: null, missing };
  return { line: `${meta.team_name} · ${meta.city}, ${meta.state}`, missing: [] };
}
