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
export const B2_ROW_CAP = 200;  // B2 (homestand detail) - ~10 days x ~20 services
export const C2_ROW_CAP = 200;  // C2 (vendor purchase history) - larger fan-out

// SC accounts - the 12 team_keys as they appear in accounts.team_key. Cached
// here so B5 and orientation tools can validate teamKey inputs against a
// known set without an extra PG lookup.
export const KNOWN_TEAM_KEYS = Object.freeze([
  "CIN - AZ", "CIN - KY", "CIN - OH", "CORP",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
]);

// PDC accounts - the 5 team_keys that carry rows in sc_phase_calendar.
// Non-PDC accounts get no phase dimension by design.
export const PDC_TEAM_KEYS = Object.freeze([
  "CIN - AZ", "STL - FL", "TBJ - FL", "TBR - FL", "TXR - AZ",
]);

// Convention 1 (Pagination): Supabase's PostgREST default caps `.select()` at
// 1000 rows. Any table read that could exceed that ceiling MUST paginate via
// `.range()` sweeps and complete the read, or MUST report truncation honestly
// as "showing N of M". Aggregates built on a silently-truncated read publish
// wrong numbers - the 2026-07-30 Sysco portfolio undercount ($46,444 vs
// $275,970 real) came from spend_summary reading ai_line_items without
// pagination.
//
// Every registry entry declares `pagination` (see registry.js): "safe" (bounded
// reads, cannot exceed 1000 today) or "paginated" (uses paginateAll below).
// A tool that cannot answer confidently is BROKEN until proven otherwise.
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Sweep a Supabase query in `SUPABASE_PAGE_SIZE` chunks until exhausted.
 * The `queryBuilder` callback is called once per page with an `.range(from, to)`
 * that the tool applies to its base query. Returns a single flat array with
 * every row.
 *
 * @param {(from: number, to: number) => Promise<{data: any[]|null, error: any}>} runPage
 * @param {object} [opts]
 * @param {number} [opts.pageSize=SUPABASE_PAGE_SIZE]
 * @returns {Promise<any[]>}
 */
export async function paginateAll(runPage, { pageSize = SUPABASE_PAGE_SIZE } = {}) {
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await runPage(from, to);
    if (error) throw new Error(`paginateAll: ${error.code || "?"} ${error.message}`);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
    from += pageSize;
  }
}

// Convention 6 (Phase F PR 2): a revenue figure derived from a null
// price_effective_date is a DECLINE, not a number. sc_daily_revenue COALESCEs
// price to 0 but does NOT coalesce price_effective_date, so a null there is
// the reliable signal that no price was configured for the service on that
// date. Callers must inspect this signal before totaling.
//
// Every revenue-touching tool imports this rule and enforces it identically:
//   - Split the rows into `priced` and `unpriced`.
//   - If unpriced.length > 0, name the affected service_ids in the tool
//     output and REFUSE to total. Do NOT silently drop them - a total that
//     quietly omits three services is its own lie.
//   - If unpriced.length === 0, aggregate normally.
export function partitionRevenueRows(rows) {
  const priced = [];
  const unpriced = [];
  for (const r of rows || []) {
    if (r.price_effective_date == null) unpriced.push(r);
    else priced.push(r);
  }
  return { priced, unpriced };
}
