// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/getAccountTeam.js
// SousAI data tool A5: account team roster.
//
// "Who's the team at CIN-OH?"
//
// Filters `contacts` by team_key and returns them ordered by role seniority
// (site leadership triad first: Executive Chef -> Sous Chef -> Hospitality
// Manager, then everything else in KNOWN_ROLES order).
//
// The missing-versus-zero discipline applied to people: if an account has no
// Sous Chef, the tool reports the missing role explicitly via a `gaps` array
// so the model can say "no Sous Chef listed for CIN-OH" rather than returning
// a short list that reads as complete.
//
// EXPECTED_SITE_ROLES defines which absences count as gaps at a per-account
// site: the site leadership triad. CORP is exempt from the triad (it holds
// company-wide roles, not site-level).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import {
  DIRECTORY_LOAD_DATE,
  CONTACTS_SCOPE,
  EXPECTED_SITE_ROLES,
  ROLE_ORDER,
  A5_ROW_CAP,
} from "./_constants.js";
import { pgLiveAsOf } from "../_freshness.js";

const SELECT_COLUMNS = "name, role, team_key, email, phone, slack_handle";

/**
 * @param {object} args
 * @param {string} args.teamKey - exact account team_key (e.g. "CIN - OH")
 * @returns {Promise<object>}
 */
export async function getAccountTeam({ teamKey } = {}) {
  if (!teamKey || typeof teamKey !== "string" || !teamKey.trim()) {
    return {
      source: "contacts",
      scope: CONTACTS_SCOPE,
      loaded: pgLiveAsOf(DIRECTORY_LOAD_DATE),
      parameters: { teamKey: teamKey || "" },
      team: [],
      total: 0,
      truncated: false,
      gaps: [],
      note: "empty teamKey parameter - supply an exact team_key like 'CIN - OH'",
    };
  }

  const sb = getSupabase();
  const trimmed = teamKey.trim();

  // First verify the account exists - this distinguishes "unknown account"
  // from "known account with no contacts on file" (a real, different miss).
  const { data: acctRow, error: acctErr } = await sb
    .from("accounts")
    .select("team_key, name, level")
    .eq("team_key", trimmed)
    .maybeSingle();
  if (acctErr) {
    throw new Error(`getAccountTeam: accounts lookup failed: ${acctErr.code || "?"} ${acctErr.message}`);
  }

  if (!acctRow) {
    // Return the valid team_keys so the model can restate or route to A2.
    const { data: allAccts } = await sb.from("accounts").select("team_key").order("team_key");
    const validTeamKeys = (allAccts || []).map((r) => r.team_key);
    return {
      source: "contacts",
      scope: CONTACTS_SCOPE,
      loaded: pgLiveAsOf(DIRECTORY_LOAD_DATE),
      parameters: { teamKey: trimmed },
      team: [],
      total: 0,
      truncated: false,
      gaps: [],
      validTeamKeys,
      note: `no account with team_key='${trimmed}' in the current-season list. See validTeamKeys.`,
    };
  }

  const { data: contacts, error } = await sb
    .from("contacts")
    .select(SELECT_COLUMNS)
    .eq("team_key", trimmed);
  if (error) {
    throw new Error(`getAccountTeam: contacts fetch failed: ${error.code || "?"} ${error.message}`);
  }

  // Sort by ROLE_ORDER; unknown roles land at the end in team_key-sort order.
  const roleIndex = new Map(ROLE_ORDER.map((r, i) => [r, i]));
  const sorted = [...contacts].sort((a, b) => {
    const ai = roleIndex.has(a.role) ? roleIndex.get(a.role) : Number.MAX_SAFE_INTEGER;
    const bi = roleIndex.has(b.role) ? roleIndex.get(b.role) : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  const total = sorted.length;
  const truncated = total > A5_ROW_CAP;
  const capped = truncated ? sorted.slice(0, A5_ROW_CAP) : sorted;

  // Missing-versus-zero for people. CORP is exempt from the triad check - it
  // holds company roles, not site roles. Every non-CORP account is expected
  // to carry the triad; a missing member is a gap the model reports.
  let gaps = [];
  if (trimmed !== "CORP") {
    const rolesPresent = new Set(sorted.map((c) => c.role));
    gaps = EXPECTED_SITE_ROLES.filter((r) => !rolesPresent.has(r)).map((r) => ({
      missing_role: r,
      note: `no ${r} on file for ${trimmed}. This is a directory gap, not a claim the seat is unfilled.`,
    }));
  }

  const result = {
    source: "contacts + accounts",
    scope: CONTACTS_SCOPE,
    loaded: pgLiveAsOf(DIRECTORY_LOAD_DATE),
    parameters: { teamKey: trimmed },
    account: { team_key: acctRow.team_key, name: acctRow.name, level: acctRow.level },
    team: capped,
    total,
    truncated,
    gaps,
  };
  if (total === 0) {
    result.note = `${acctRow.name} (${trimmed}) is a current-season account but has no contacts on file in the leadership directory. Directory gap, not a claim the account is unstaffed.`;
  } else if (truncated) {
    result.note = `showing ${A5_ROW_CAP} of ${total}`;
  }
  return result;
}
