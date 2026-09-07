// ═══════════════════════════════════════════════════════════════════
// scReviewState - day-level review-state helpers for the week-review-
//                  before-finalize feature.
// 2026-09-08
// ═══════════════════════════════════════════════════════════════════
//
// Owner rulings from the pre-build report (2026-09-08):
//   1. State lives on sc_day_metadata (three columns + CHECK).
//      Not a new table. History belongs to sc_day_note_entries.
//   2. Actor + timestamp required whenever review_status is set.
//      Enforced at the DB layer via CHECK constraint from sc-42.
//   3. Clear on any write to the day. Every actuals-write handler
//      calls clearReviewStateForDays after the write lands.
//   4. Clear on week unlock. sc-revert-finalize calls this too.
//   5. Biweekly pair: clearing on unlock covers both weeks.
//      Handled at the call site in sc-revert-finalize which picks
//      the right date range.

import { getServiceClient } from "@/lib/supabase";

/**
 * Clear review state (all three columns) for a set of
 * (account_key, service_date) pairs. Called by every write path
 * that invalidates a prior review: sc-submit-day, sc-bulk-submit,
 * sc-reset-day, sc-bulk-reset, sc-revert-finalize.
 *
 * The rule ships unconditional per Kevin ruling 2026-09-08: "a
 * save intent is a save intent, and filtering on touched > 0
 * invites the question of what counts as touched." Every write
 * clears the marker, even a no-op save.
 *
 * @param {string}   accountKey
 * @param {string[]} dates    ISO YYYY-MM-DD strings
 * @param {object}   supa?    optional shared client (test harness)
 * @returns {Promise<{ success: boolean, error?: string, cleared?: number }>}
 */
export async function clearReviewStateForDays(accountKey, dates, supa) {
  if (!accountKey) return { success: false, error: "accountKey required" };
  if (!Array.isArray(dates) || dates.length === 0) {
    return { success: true, cleared: 0 };
  }
  const client = supa || getServiceClient();
  const uniq = [...new Set(dates)];
  const { data, error } = await client
    .from("sc_day_metadata")
    .update({
      review_status: null,
      reviewed_by:   null,
      reviewed_at:   null,
    })
    // Only touch rows that actually carried a marker - saves an
    // UPDATE round-trip on the common case (unreviewed day gets a
    // fresh save) and keeps the change_log noise-free.
    .eq("account_key", accountKey)
    .in("service_date", uniq)
    .not("review_status", "is", null)
    .select("service_date");
  if (error) return { success: false, error: error.message };
  return { success: true, cleared: data?.length || 0 };
}

/**
 * Read review state for a set of days. Used by the finalize gate
 * to require all-approved and by the WeekReview client to hydrate
 * the modal.
 *
 * @param {string}   accountKey
 * @param {string[]} dates
 * @param {object}   supa?
 * @returns {Promise<{ success: boolean, error?: string, rows?: Array<{ service_date, review_status, reviewed_by, reviewed_at }> }>}
 */
export async function readReviewStateForDays(accountKey, dates, supa) {
  if (!accountKey) return { success: false, error: "accountKey required" };
  if (!Array.isArray(dates) || dates.length === 0) {
    return { success: true, rows: [] };
  }
  const client = supa || getServiceClient();
  const uniq = [...new Set(dates)];
  const { data, error } = await client
    .from("sc_day_metadata")
    .select("service_date, review_status, reviewed_by, reviewed_at")
    .eq("account_key", accountKey)
    .in("service_date", uniq)
    .order("service_date", { ascending: true });
  if (error) return { success: false, error: error.message };
  return { success: true, rows: data || [] };
}

/**
 * Predicate: are all days in the set approved? Returns
 * { allApproved, missingDates } where missingDates is every day
 * that either has no metadata row, has review_status = null, or
 * has review_status = 'flagged'.
 *
 * Used by sc-finalize-week's extended gate.
 */
export async function requireAllDaysApproved(accountKey, dates, supa) {
  const read = await readReviewStateForDays(accountKey, dates, supa);
  if (!read.success) return { success: false, error: read.error };
  const byDate = new Map();
  for (const r of read.rows) byDate.set(String(r.service_date).slice(0, 10), r);
  const missing = [];
  for (const d of dates) {
    const row = byDate.get(d);
    if (!row || row.review_status !== "approved") missing.push(d);
  }
  return {
    success: true,
    allApproved: missing.length === 0,
    missingDates: missing,
  };
}

/**
 * Post an operational Slack alert to the SC billing channel when
 * an unlock's review-state clear fails.
 *
 * Kevin ruling 2026-09-08: "A silent console.error on a path that
 * leaves a billing gate open is precisely the pattern in this
 * week's GOTCHAS entry." The clear failure is exactly this shape -
 * the revert succeeded, the days still carry approved markers, and
 * the finalize gate will pass on a re-finalize without any human
 * having re-looked. Silent log is not enough.
 *
 * Non-fatal. If Slack post fails too, we log both. The response
 * shape carrying this alert to the client is what unblocks the
 * operator.
 */
export async function alertReviewClearFailure({
  accountKey,
  weekStart,
  weekEnd,
  affectedDates,
  clearError,
  revertedBy,
  slackWebhookUrl,
}) {
  const webhook = slackWebhookUrl || process.env.SLACK_SC_BILLING_WEBHOOK_URL;
  if (!webhook) {
    // eslint-disable-next-line no-console
    console.warn("[alertReviewClearFailure] no SLACK_SC_BILLING_WEBHOOK_URL - falling back to console.error");
    // eslint-disable-next-line no-console
    console.error(
      `[review-clear-fail] ${accountKey} week ${weekStart}..${weekEnd} - revert by ${revertedBy} succeeded, ` +
      `review_status clear FAILED: ${clearError}. Affected: ${affectedDates.join(", ")}. ` +
      `Finalize gate will pass without re-review until manually cleared.`
    );
    return { sent: false, skipped: "no webhook" };
  }
  const text =
    `:rotating_light: *Review-state clear failed after unlock*\n` +
    `Account: \`${accountKey}\`\n` +
    `Week: ${weekStart} .. ${weekEnd}\n` +
    `Reverted by: ${revertedBy}\n` +
    `Days affected: ${affectedDates.join(", ")}\n` +
    `Error: \`${clearError}\`\n` +
    `The revert succeeded and stands. The days still carry the pre-revert approvals, ` +
    `which means the finalize gate would let a re-finalize send without re-review. ` +
    `Clear the review_status column manually in Studio, or hit the finalize modal ` +
    `and re-approve each day before re-finalizing.`;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[alertReviewClearFailure] Slack POST failed: HTTP ${res.status}`);
      return { sent: false, error: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[alertReviewClearFailure] Slack POST threw: ${e?.message || e}`);
    return { sent: false, error: e?.message || String(e) };
  }
}
