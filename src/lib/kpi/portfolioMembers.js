// src/lib/kpi/portfolioMembers.js
//
// Single source of truth for pseudo-key membership (ALL / EAST / WEST).
//
// The read route (src/app/api/kpi/labor/route.js) and the export route
// (src/app/api/kpi/labor/export/route.js) both need to resolve which
// accounts sit inside a portfolio view. If the two diverged, an export
// scoped to EAST would show a different account set than the board it
// was exported from - worse than no export. Owner ruling 2026-08-24:
// do not re-derive membership; both routes call this helper.
//
// Rules:
// - ALL     = every non-CORP account in `accounts`
// - EAST    = accounts.region == 'East', minus CORP
// - WEST    = accounts.region == 'West', minus CORP
// - Rows are returned in team_key order (deterministic export filenames
//   and Summary sort).

export const PORTFOLIO_KEYS = new Set(["ALL", "EAST", "WEST"]);

/**
 * Resolve members for a portfolio pseudo-key.
 *
 * @param {ReturnType<typeof import("@/lib/supabase").getServiceClient>} supa
 * @param {"ALL"|"EAST"|"WEST"} pseudoKey
 * @returns {Promise<{ data: Array<{team_key: string, region: string|null}>, error: any }>}
 */
export async function resolvePortfolioMembers(supa, pseudoKey) {
  if (!PORTFOLIO_KEYS.has(pseudoKey)) {
    return { data: [], error: { message: `not_a_portfolio_key: ${pseudoKey}` } };
  }
  let q = supa.from("accounts")
    .select("team_key, region")
    .neq("team_key", "CORP")
    .order("team_key");
  if (pseudoKey !== "ALL") {
    // Region values in PG are capitalized ('East' / 'West').
    const regionValue = pseudoKey === "EAST" ? "East" : "West";
    q = q.eq("region", regionValue);
  }
  const res = await q;
  return { data: res.data || [], error: res.error || null };
}
