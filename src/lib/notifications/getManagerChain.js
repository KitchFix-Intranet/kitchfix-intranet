// ═══════════════════════════════════════════════════════════════════
// getManagerChain - resolve location-aware CC recipients for People
// Portal notifications (new hires + PAFs).
//
// Layers on top of getNotificationRecipients: that function returns a
// static per-action-type admin list (Kevin, Mariela, Alex) seeded in
// the notification_recipients table. This function adds location-
// based CC routing so the right regional director and site leader
// receive the notification too.
//
// Pyramid (confirmed 2026-10-06):
//   ALWAYS CC    - Kevin, Mariela, Joe, Alex
//   REGIONAL     - Shane (East) / Ryan (West) / none for CORP
//   SITE LEADERS - contacts WHERE team_key = <loc> AND is_site_leader
//   SUBMITTER    - stripped (they already get their own confirmation
//                  via the separate submitter send in notify()).
//
// Contract matches getNotificationRecipients: throws on DB errors
// (no swallow-into-empty), returns string[] of emails.
// ═══════════════════════════════════════════════════════════════════

import { getServiceClient } from "@/lib/supabase";

const ALWAYS_CC = [
  "k.fietek@kitchfix.com",
  "m.chavez@kitchfix.com",
  "joe@kitchfix.com",
  "a.wasserman@kitchfix.com",
];

const REGIONAL_DIRECTOR_BY_REGION = {
  East: "s.lynch@kitchfix.com",
  West: "r.moore@kitchfix.com",
};

/**
 * Resolve notification CC recipients based on submission location.
 *
 * @param {string} locationKey - team_key from the submission (e.g. "STL - MO")
 * @param {string} submitterEmail - email of the person who submitted
 * @returns {Promise<string[]>} deduplicated CC list, submitter removed
 * @throws on DB read error. Caller catches at notify()'s outer try.
 */
export async function getManagerChain(locationKey, submitterEmail) {
  const supa = getServiceClient();
  const cc = new Set(ALWAYS_CC);

  const key = String(locationKey || "").trim();
  if (!key) {
    return stripSubmitter(cc, submitterEmail);
  }

  const { data: account, error: accountError } = await supa
    .from("accounts")
    .select("region")
    .eq("team_key", key)
    .maybeSingle();

  if (accountError) {
    throw new Error(
      `getManagerChain: accounts lookup failed for team_key="${key}": ${accountError.message}`
    );
  }

  if (!account) {
    console.warn(
      `[Notifications] Unknown team_key "${key}" - no match in accounts. ` +
      `Regional director + site leaders will not be CC'd.`
    );
    return stripSubmitter(cc, submitterEmail);
  }

  const regionalDirector = REGIONAL_DIRECTOR_BY_REGION[account.region];
  if (regionalDirector) cc.add(regionalDirector);

  const { data: leaders, error: leadersError } = await supa
    .from("contacts")
    .select("email")
    .eq("team_key", key)
    .eq("is_site_leader", true);

  if (leadersError) {
    throw new Error(
      `getManagerChain: contacts lookup failed for team_key="${key}": ${leadersError.message}`
    );
  }

  for (const row of leaders) {
    if (row.email) cc.add(row.email);
  }

  return stripSubmitter(cc, submitterEmail);
}

function stripSubmitter(ccSet, submitterEmail) {
  const submitter = String(submitterEmail || "").trim().toLowerCase();
  if (!submitter) return [...ccSet];
  return [...ccSet].filter((e) => e.toLowerCase() !== submitter);
}
