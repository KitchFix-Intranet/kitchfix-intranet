// ═══════════════════════════════════════════════════════════════════
// Period-lock permission helper (2026-08-01, sc-25).
// ═══════════════════════════════════════════════════════════════════
//
// One place to check whether writing to (accountKey, dates) is
// permitted for the given caller. Wired into every write path that
// touches sc_daily_actuals (sc-submit-day, sc-bulk-submit,
// sc-submit-closeout, sc-reset-day). Not wired into sc-add-note -
// notes stay open on a locked period per owner ruling.
//
// SLT override lives here, not in the SQL. Any caller in
// SC_ADMIN_EMAILS (isScAdmin) short-circuits before the RPC fires.
// Keeps the SQL function agnostic to session identity + avoids one
// RPC per write for the 8 admins.
//
// Refusal shape is machine-readable. Step 2 of the feature (UI)
// will parse `code === 'PERIOD_LOCKED'` to surface a specific
// operator message. The `message` field is fallback copy for tools
// that don't parse the code (probes, logs, curl).
//
// Contract:
//   returns null            -> caller may write
//   returns { code, ... }   -> refuse, return the object as-is in
//                              the response body with 403 status

import { getServiceClient } from "@/lib/supabase";
import { isScAdmin } from "@/lib/admin";

/**
 * @param {string}   accountKey
 * @param {string[]} dates          - ISO YYYY-MM-DD strings; duplicates OK
 * @param {string}   email          - session.user.email
 * @returns {Promise<null | { code: 'PERIOD_LOCKED', lockedDates: string[], message: string }>}
 */
export async function assertDaysUnlockedForWrite(accountKey, dates, email) {
  if (!accountKey) {
    throw new Error("assertDaysUnlockedForWrite: accountKey required");
  }
  if (!Array.isArray(dates) || dates.length === 0) return null;

  // SLT bypass. isScAdmin normalizes email casing + trims.
  if (isScAdmin(email)) return null;

  const supa = getServiceClient();
  const uniqueDates = [...new Set(dates)];

  // One RPC per unique date. Batch shape not natively supported by
  // supabase-js .rpc(); Promise.all keeps latency at max-single-call.
  // Bulk saves rarely span > ~30 unique dates, well within limits.
  const results = await Promise.all(
    uniqueDates.map((d) =>
      supa.rpc("sc_is_day_locked", {
        p_account_key: accountKey,
        p_service_date: d,
      })
    )
  );

  const lockedDates = [];
  for (let i = 0; i < uniqueDates.length; i++) {
    const { data, error } = results[i];
    if (error) {
      throw new Error(
        `sc_is_day_locked RPC error for ${accountKey} ${uniqueDates[i]}: ${error.message}`
      );
    }
    if (data === true) lockedDates.push(uniqueDates[i]);
  }

  if (lockedDates.length === 0) return null;

  lockedDates.sort();

  // Message text is placeholder pending step-2 UI copy ruling.
  // Machine-readable code + lockedDates array are the load-bearing
  // parts of the refusal; step 2 formats the operator-facing copy.
  const message =
    lockedDates.length === 1
      ? `Cannot save ${lockedDates[0]} - the period is closed. Ask leadership if this needs to change.`
      : `Cannot save ${lockedDates.length} days - one or more periods are closed. Ask leadership if this needs to change.`;

  return {
    code: "PERIOD_LOCKED",
    lockedDates,
    message,
  };
}
