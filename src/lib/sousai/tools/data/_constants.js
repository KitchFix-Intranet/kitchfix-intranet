// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/_constants.js
// Shared constants for the Phase F directory tools.
//
// The KitchFix `contacts` and `accounts` tables are a single bulk load with no
// active update mechanism; every row carries `updated_at = 2026-05-27`. The
// tools present this as a load date, honestly, per Kevin's ruling: do NOT
// label the freshness as "last verified" (false) and do NOT suppress it
// (leaves the reader trusting stale data with no signal).
//
// Constants live here so all four tools speak the same numbers when the model
// asks about coverage. A change to the load date (or the coverage summary)
// touches ONE file, not four.
// ─────────────────────────────────────────────────────────────────────────────

export const DIRECTORY_LOAD_DATE = "2026-05-27";

// Population totals as of the load. Re-derive with the CLI probe (see
// scripts/sousai-tools-test.mjs) if you suspect a bulk refresh has landed.
export const CONTACTS_TOTAL = 30;
export const ACCOUNTS_TOTAL = 12;

export const CONTACTS_SCOPE =
  "leadership directory: 30 people across 12 accounts at Executive Chef, Sous Chef, Hospitality Manager, and corporate leadership level. Line and hourly staff are not tracked here.";

export const ACCOUNTS_SCOPE =
  "current-season KitchFix accounts, 12 total. Retired accounts (whose contracts ended in prior seasons) are removed from this table, not flagged; the document corpus may still describe them.";

// The controlled role vocabulary as it exists in the load. If a caller passes
// a role that does not appear here, the tool returns this list rather than an
// empty match set. See A4.
export const KNOWN_ROLES = Object.freeze([
  "Executive Chef",
  "Sous Chef",
  "Hospitality Manager",
  "General Manager",
  "Chef De Cuisine",
  "CEO",
  "VP Operations",
  "Director of Operations",
  "Director of Culinary",
  "Corporate Field Chef",
  "Regional Director East",
  "Regional Director West",
  "Human Resources",
  "Staff Accountant",
]);

// Role ordering for A5's account-team roster. Site leadership triad comes
// first in the expected seniority; the rest fall in KNOWN_ROLES order. A team
// without one of the EXPECTED_SITE_ROLES gets a "missing role" line in the
// tool result so the model can report the gap rather than silently omit.
export const EXPECTED_SITE_ROLES = Object.freeze([
  "Executive Chef",
  "Sous Chef",
  "Hospitality Manager",
]);

export const ROLE_ORDER = Object.freeze([...EXPECTED_SITE_ROLES, ...KNOWN_ROLES.filter((r) => !EXPECTED_SITE_ROLES.includes(r))]);

// Result caps. Every rows-returning tool caps output and reports truncation
// honestly, per Convention 1. Directory sets are small enough that the cap is
// a defensive floor rather than a real limit today.
export const DEFAULT_ROW_CAP = 20;
export const A1_ROW_CAP = 10;   // A1 (person lookup) rarely returns > 3
export const A2_ROW_CAP = 20;   // A2 (account list) has 12 rows total
export const A4_ROW_CAP = 20;   // A4 (by role) - the largest role is EC (9)
export const A5_ROW_CAP = 15;   // A5 (team roster) - CORP has 9 people
