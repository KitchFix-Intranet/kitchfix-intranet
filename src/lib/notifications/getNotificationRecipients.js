// ═══════════════════════════════════════════════════════════════════
// getNotificationRecipients - resolve admin-recipient list per PAF
// action type from Postgres notification_recipients.
// Extracted 2026-09-04 (Wave 2 of Sheets retirement) from the inline
// implementation at src/app/api/people/route.js:88-116 which read
// from HUB / notifications via readSheetSA.
// ═══════════════════════════════════════════════════════════════════
//
// Why extracted: the previous inline implementation swallowed every
// Sheets read error into `return []` (the standing "swallow-into-
// empty" pattern). On 2026-09-03 a Sheets read-quota error made a
// real PAF submission notify Slack but silently drop the admin email
// to Kevin + Mariela. Wave 2 fixes this at two layers - the source
// (Postgres has no per-minute read quota) AND the reader contract
// (throw on error, distinguish unknown-key from empty-config).
//
// Kevin's rulings encoded here (notify-1 migration header, 2026-09-03):
//
//   Ruling 1 - LEGITIMATE-EMPTY vs READ-FAILURE ARE DIFFERENT SIGNALS.
//     Read error MUST throw. Caller decides catch policy. The
//     silent-swallow that hid the 2026-09-03 outage must not
//     survive this migration.
//
//   Ruling 6 - UNKNOWN-KEY vs EMPTY-CONFIG ARE DIFFERENT SIGNALS.
//     If the action_key has zero rows in the table, that is almost
//     certainly a code-vs-config gap (someone added a new PAF
//     action type in code without seeding recipients here) and gets
//     a log.warn naming the key. If the action_key has rows but
//     all are disabled, that is a legitimate deliberate empty and
//     proceeds silently.
//
// The Sheets tab HUB / notifications is left in place per Kevin's
// ruling 2026-09-03 as a documented fallback reference. Nothing in
// this code path reads it; the tab is preserved so operators can
// consult the historical config visually.

import { getServiceClient } from "@/lib/supabase";

// Normalize the caller's action_key the same way the pre-Wave-2
// inline function did (people/route.js:91). Preserves compatibility
// with call sites that pass raw form values.
function normalizeActionKey(actionKey) {
  return String(actionKey || "").trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Resolve the admin recipient list for a given PAF action type.
 *
 * @param {string} actionKey - normalized to lowercase + underscores
 *                             internally to match the DB
 *                             notification_recipients.action_key
 *                             column (matches pre-Wave-2 behavior).
 * @returns {Promise<string[]>} enabled recipient emails, ordered by
 *                              sort_order then email. Empty array on
 *                              either "unknown key" or "all disabled";
 *                              caller cannot distinguish the two by
 *                              return value alone - the distinction
 *                              is at the log tier (unknown -> warn).
 * @throws on DB read error. Do NOT catch and swallow - the previous
 *         swallow-into-[] was the defect this migration exists to
 *         eliminate. Callers should catch + surface as warn/error.
 */
export async function getNotificationRecipients(actionKey) {
  const normalizedKey = normalizeActionKey(actionKey);
  const supa = getServiceClient();

  // Single query returns every row for this action_key (enabled or
  // not). The enabled filter happens client-side so the length of
  // the raw result tells us whether the key is known at all - a
  // WHERE enabled = TRUE at the DB would collapse "unknown key" and
  // "all disabled" into the same zero-length response.
  const { data, error } = await supa
    .from("notification_recipients")
    .select("email, enabled, sort_order")
    .eq("action_key", normalizedKey)
    .order("sort_order", { ascending: true })
    .order("email",      { ascending: true });

  if (error) {
    // Ruling 1: read errors THROW. Caller's try/catch surfaces the
    // error at console.error tier (see notify() at people/route.js:
    // 337-394 outer catch which logs the error message). Not silent.
    throw new Error(
      `getNotificationRecipients: read failed for action_key="${normalizedKey}": ${error.message}`
    );
  }

  // Ruling 6: distinguish unknown-key from empty-config.
  if (data.length === 0) {
    console.warn(
      `[Notifications] Unknown action_key "${normalizedKey}" - zero rows in notification_recipients. ` +
      `Admin pipeline will skip. If this is a real action type, add a seed row via a follow-on migration.`
    );
    return [];
  }

  // Legitimate empty (rows exist, all disabled): silent. Matches
  // Kevin's spec - a deliberate all-off state proceeds quietly.
  return data.filter(r => r.enabled === true).map(r => r.email);
}
