// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/listContactsByRole.js
// SousAI data tool A4: contacts filtered by role.
//
// "Who are all the Executive Chefs?"
// "Who is the Hospitality Manager at CIN-OH?" (with the teamKey filter)
//
// The role column is a controlled vocabulary (14 distinct values at load).
// An unknown role returns the KNOWN_ROLES list so the model can either
// restate or ask; a silent empty result would misread as "the company has no
// [role]" which is a different, wrong claim.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import {
  DIRECTORY_LOAD_DATE,
  CONTACTS_SCOPE,
  KNOWN_ROLES,
  A4_ROW_CAP,
} from "./_constants.js";

const SELECT_COLUMNS = "name, role, team_key, email, phone, slack_handle";

/**
 * @param {object} args
 * @param {string} args.role - exact role from KNOWN_ROLES
 * @param {string} [args.teamKey] - optional team_key filter (composes with A2)
 * @returns {Promise<object>}
 */
export async function listContactsByRole({ role, teamKey } = {}) {
  if (!role || typeof role !== "string" || !role.trim()) {
    return {
      source: "contacts",
      scope: CONTACTS_SCOPE,
      loaded: DIRECTORY_LOAD_DATE,
      parameters: { role: role || "", teamKey: teamKey || null },
      matches: [],
      total: 0,
      truncated: false,
      validRoles: [...KNOWN_ROLES],
      note: "empty role parameter - pass one of validRoles",
    };
  }

  const trimmedRole = role.trim();

  // Case-insensitive exact match against KNOWN_ROLES. If nothing matches,
  // return the valid list and stop. This is the "unknown value returns the
  // valid list" convention from Task 4.
  const canonicalRole = KNOWN_ROLES.find((r) => r.toLowerCase() === trimmedRole.toLowerCase());
  if (!canonicalRole) {
    return {
      source: "contacts",
      scope: CONTACTS_SCOPE,
      loaded: DIRECTORY_LOAD_DATE,
      parameters: { role: trimmedRole, teamKey: teamKey || null },
      matches: [],
      total: 0,
      truncated: false,
      validRoles: [...KNOWN_ROLES],
      note: `'${trimmedRole}' is not a known role in the leadership directory. See validRoles.`,
    };
  }

  const sb = getSupabase();
  let q = sb.from("contacts").select(SELECT_COLUMNS).eq("role", canonicalRole).order("team_key", { ascending: true });
  if (teamKey) q = q.eq("team_key", teamKey);

  const { data, error } = await q;
  if (error) {
    throw new Error(`listContactsByRole: query failed: ${error.code || "?"} ${error.message}`);
  }

  const total = data.length;
  const truncated = total > A4_ROW_CAP;
  const capped = truncated ? data.slice(0, A4_ROW_CAP) : data;

  const result = {
    source: "contacts",
    scope: CONTACTS_SCOPE,
    loaded: DIRECTORY_LOAD_DATE,
    parameters: { role: canonicalRole, teamKey: teamKey || null },
    matches: capped,
    total,
    truncated,
  };
  if (total === 0) {
    result.note = teamKey
      ? `no ${canonicalRole} on file for team_key='${teamKey}'. This is a directory gap, not a claim that no such person exists.`
      : `no ${canonicalRole} on file across the 12 accounts. This is a directory gap, not a claim that no such person exists.`;
  } else if (truncated) {
    result.note = `showing ${A4_ROW_CAP} of ${total}`;
  }
  return result;
}
