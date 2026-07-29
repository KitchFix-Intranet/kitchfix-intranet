// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/findContact.js
// SousAI data tool A1: person lookup by name.
//
// "What is Chef Kelsey's account and phone number?"
//
// Reads `contacts` with a case-insensitive partial match on `name`. Supports
// first-name-only input. Multiple matches return all of them - the tool does
// not guess between "Kelsey Atherton" and "Kelsey Smith"; the model picks.
//
// The MISS shape is the load-bearing part of this tool. A person absent from
// the leadership directory is NOT "does not exist" - line and hourly staff
// aren't tracked here. The tool response for zero matches states the scope
// (30 people, 12 accounts, EC/Sous/HM/corporate) so the model has the
// coverage language in the returned data, not just in the prompt.
//
// slack_user_id is populated on 20 of 30 rows and is not surfaced.
// updated_at is not surfaced (it reflects the bulk-load date, not real edits).
// See _constants.js for the load-date affordance.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import {
  DIRECTORY_LOAD_DATE,
  CONTACTS_SCOPE,
  A1_ROW_CAP,
} from "./_constants.js";

const SELECT_COLUMNS = "name, role, team_key, email, phone, slack_handle";

/**
 * @param {object} args
 * @param {string} args.nameQuery - partial name (e.g. "Kelsey", "Atherton", "Kelsey A")
 * @returns {Promise<{
 *   source: string,
 *   scope: string,
 *   loaded: string,
 *   parameters: { nameQuery: string },
 *   matches: Array<{name:string, role:string, team_key:string, email:string, phone:string|null, slack_handle:string|null}>,
 *   total: number,
 *   truncated: boolean,
 *   note?: string,
 * }>}
 */
export async function findContact({ nameQuery } = {}) {
  if (!nameQuery || typeof nameQuery !== "string" || !nameQuery.trim()) {
    return {
      source: "contacts",
      scope: CONTACTS_SCOPE,
      loaded: DIRECTORY_LOAD_DATE,
      parameters: { nameQuery: nameQuery || "" },
      matches: [],
      total: 0,
      truncated: false,
      note: "empty nameQuery - provide a partial or full name to search",
    };
  }

  const sb = getSupabase();
  const trimmed = nameQuery.trim();
  // Case-insensitive partial match. Contacts.name is a plain TEXT column;
  // ilike with %...% covers first-name, last-name, and partial-word inputs
  // without a full-text index.
  const { data, error } = await sb
    .from("contacts")
    .select(SELECT_COLUMNS + ", id")
    .ilike("name", `%${trimmed}%`)
    .order("name", { ascending: true });
  if (error) {
    throw new Error(`findContact: query failed: ${error.code || "?"} ${error.message}`);
  }

  const total = data.length;
  const truncated = total > A1_ROW_CAP;
  const capped = truncated ? data.slice(0, A1_ROW_CAP) : data;
  const matches = capped.map((r) => ({
    name: r.name,
    role: r.role,
    team_key: r.team_key,
    email: r.email,
    phone: r.phone || null,
    slack_handle: r.slack_handle || null,
  }));

  const result = {
    source: "contacts",
    scope: CONTACTS_SCOPE,
    loaded: DIRECTORY_LOAD_DATE,
    parameters: { nameQuery: trimmed },
    matches,
    total,
    truncated,
  };
  if (total === 0) {
    result.note = `no match in the leadership directory for '${trimmed}'. Coverage: ${CONTACTS_SCOPE}`;
  } else if (truncated) {
    result.note = `showing ${A1_ROW_CAP} of ${total} matches - narrow the query`;
  }
  return result;
}
