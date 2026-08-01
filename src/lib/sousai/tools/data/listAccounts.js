// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/listAccounts.js
// SousAI data tool A2: current-season account directory.
//
// "Which accounts do we run? Which are PDC?"
//
// Reads `accounts`, 12 rows. Every row is currently active=true and
// season='2026' - the table is a current-season snapshot, not a historical
// registry. Retired accounts are physically deleted (BGC's term ended
// 2026-05-21 and it is absent from the table entirely, even though it appears
// in 7 corpus documents including REF-140/141/142).
//
// This is why the tool's MISS shape matters. A caller asking about BGC gets a
// current-season-list message, not a flat denial - the account existed and
// the corpus knows it; the operational directory has moved on.
//
// Skipped columns per the investigation:
//   - URL columns (`stadium_header_url`, `logo_url`, `homestand_url`, ...) - display concerns
//   - `labor_ratio` (populated on 1 of 12 - not a general answer surface)
//   - `active` and `season` (uniform - all true / all 2026)
//   - `created_at` / `updated_at` (bulk-load date, misleading if surfaced)
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import {
  DIRECTORY_LOAD_DATE,
  ACCOUNTS_SCOPE,
  A2_ROW_CAP,
} from "./_constants.js";
import { pgLiveAsOf } from "../_freshness.js";

const SELECT_COLUMNS = [
  "team_key",
  "name",
  "level",
  "city",
  "state",
  "stadium_name",
  "region",
  "timezone",
  "billing_model",
  "has_homestand_schedule",
  "has_schedule_overlay",
].join(", ");

/**
 * @param {object} [args]
 * @param {string} [args.level] - optional filter on accounts.level (MLB / MiLB / PDC / CORP - the actual set is returned in `validLevels` on an unknown value)
 * @param {string} [args.teamKey] - optional exact team_key filter (single-row lookup)
 * @returns {Promise<object>}
 */
export async function listAccounts({ level, teamKey } = {}) {
  const sb = getSupabase();
  let q = sb.from("accounts").select(SELECT_COLUMNS).order("team_key", { ascending: true });
  if (teamKey) q = q.eq("team_key", teamKey);
  if (level) q = q.eq("level", level);

  const { data, error } = await q;
  if (error) {
    throw new Error(`listAccounts: query failed: ${error.code || "?"} ${error.message}`);
  }

  // If a level was supplied and returned no rows, surface the known levels so
  // the model can either restate the ask or narrow correctly. Same discipline
  // as A4's KNOWN_ROLES fallback.
  let validLevels;
  if (level && data.length === 0) {
    const { data: allLevels } = await sb.from("accounts").select("level");
    validLevels = [...new Set((allLevels || []).map((r) => r.level))].sort();
  }

  const total = data.length;
  const truncated = total > A2_ROW_CAP;
  const capped = truncated ? data.slice(0, A2_ROW_CAP) : data;

  const result = {
    source: "accounts",
    scope: ACCOUNTS_SCOPE,
    loaded: pgLiveAsOf(DIRECTORY_LOAD_DATE),
    parameters: { level: level || null, teamKey: teamKey || null },
    accounts: capped,
    total,
    truncated,
  };
  if (validLevels) {
    result.validLevels = validLevels;
    result.note = `no account has level='${level}'. Valid levels: ${validLevels.join(", ")}`;
  } else if (teamKey && total === 0) {
    result.note = `no account with team_key='${teamKey}' in the current-season list. If the account was active in a prior season, the document corpus (REC records) may still describe it - try search_documents or list_documents docClass='REC'.`;
  } else if (truncated) {
    result.note = `showing ${A2_ROW_CAP} of ${total}`;
  }
  return result;
}
