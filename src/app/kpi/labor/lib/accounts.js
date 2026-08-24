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

// V40 FIX 4 - static directory + RDO map so the folio renders the FULL
// grouped rail (region cards + RDO subline + all 11 members) on the
// first paint instead of the flat 11-row skeleton. The account list is
// stable for a session; region + salaried are structural facts, RDO
// display names are hard-coded elsewhere in the codebase (see
// src/lib/admin.js and src/lib/incidentSchema.js). Team_name / city /
// state stay null in the static rows to avoid stale-copy risk; the
// row height CSS reserves the desc-line slot so the swap when live
// data lands does not reflow the rail. Regions come from
// docs/SC_ADMIN_RECON_REPORT.md and match accounts.region in Supabase.
export const STATIC_DIRECTORY = [
  { team_key: "CIN - AZ",     region: "West", team_name: null, city: null, state: null, salaried: false },
  { team_key: "CIN - KY",     region: "West", team_name: null, city: null, state: null, salaried: true  },
  { team_key: "CIN - OH",     region: "West", team_name: null, city: null, state: null, salaried: false },
  { team_key: "STL - FL",     region: "East", team_name: null, city: null, state: null, salaried: false },
  { team_key: "STL - MO",     region: "East", team_name: null, city: null, state: null, salaried: false },
  { team_key: "TBJ - FL",     region: "East", team_name: null, city: null, state: null, salaried: false },
  { team_key: "TBJ - NY",     region: "East", team_name: null, city: null, state: null, salaried: true  },
  { team_key: "TBR - FL",     region: "East", team_name: null, city: null, state: null, salaried: false },
  { team_key: "TXR - AZ",     region: "West", team_name: null, city: null, state: null, salaried: false },
  { team_key: "TXR - TX - H", region: "West", team_name: null, city: null, state: null, salaried: false },
  { team_key: "TXR - TX - V", region: "West", team_name: null, city: null, state: null, salaried: false },
];

export const STATIC_RDO_DISPLAY = { East: "S. Lynch", West: "R. Moore" };

// V7-3 - Sections are the command-bar dropdown that replaces the v6
// tabs row. K5 preserved: non-Labor items ghosted with a SOON tag.
// Enabled sections carry a `path`; disabled sections do NOT - a path
// on a SOON item invites someone to make it clickable without thinking.
export const SECTIONS = [
  { key: "overview",   label: "Overview",   enabled: false                          },
  { key: "labor",      label: "Labor",      enabled: true,  path: "/kpi/labor"      },
  { key: "purchasing", label: "Purchasing", enabled: true,  path: "/kpi/purchasing" },
  { key: "food",       label: "Food",       enabled: false                          },
  { key: "other",      label: "Other COGS", enabled: false                          },
  { key: "revenue",    label: "Revenue",    enabled: false                          },
  { key: "pnl",        label: "P&L",        enabled: false                          },
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
