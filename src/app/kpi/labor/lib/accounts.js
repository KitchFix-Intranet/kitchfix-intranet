// src/app/kpi/labor/lib/accounts.js
//
// Account roster + salaried-only marker. Extracted from page.js in D2.
// D3 will replace ACCOUNTS with a server-driven list (aggregate endpoint
// returns per-account presence + region); until then, hardcoded matches
// the render's account list exactly.

export const ACCOUNTS = [
  "CIN - AZ", "CIN - OH", "CIN - KY",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

// D26 salaried-only accounts: no hourly labor pipeline. The API returns
// account_state='salaried_only' for these; the FolioRail renders them
// with a "salaried" italic tag and no sparkline (per spec §3.1).
export const SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);

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
