// ═══════════════════════════════════════════════════════════════════
// Week-finalize permission helper + completeness rule + effects seam
// (2026-08-06, sc-30, PR-A of the SC -> QBO billing arc).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §3 (state machine) + §6
// (data model). Kevin signed the spec v1.0 on 2026-08-06.
//
// SISTER FILE to src/lib/scPeriodLock.js. Same discipline: one
// swappable predicate function, no business logic in the SQL layer,
// override lives here not in the DB.
//
// LOCK STACK (per spec §3, K-1): the week-finalize lock sits INSIDE
// the period lock. Both signals stack independently.
//   - Period lock (sc-25): the period end date + grace window. Whole
//     periods freeze for AP.
//   - Week finalize (sc-30, this file): a completed billing week
//     freezes AS SOON AS the site leader presses Finalize, well
//     before the period closes. Once BILLED (PR-C), the week is a
//     one-way door (K-3).
//
// Both use the same override group: SC_LOCK_OVERRIDE (Kevin + Joe +
// Sebastian, K-10). See src/lib/admin.js.
//
// Contract (matches assertDaysUnlockedForWrite exactly for grep parity):
//   returns null            -> caller may write
//   returns { code, ... }   -> refuse, return the object as-is in
//                              the response body with 403 status

import { getServiceClient } from "@/lib/supabase";
import { isScLockOverride } from "@/lib/admin";

// ─────────────────────────────────────────────────────────────────
// Mon-Sun week derivation (banned from `week_label` per C-3).
// ─────────────────────────────────────────────────────────────────
//
// Week identity ALWAYS derives from `service_date` here.
// sc_daily_revenue.week_label is period-relative (resets to Week 1
// at every period boundary) and is banned from billing-week logic
// per C-3 / C-12 in the billing recon.
//
// Input: an ISO YYYY-MM-DD string (server-side dates are stored as
// PG DATE, so no timezone drama). Output: ISO YYYY-MM-DD for the
// Monday of the same ISO week.
//
// Implementation uses UTC arithmetic so the calculation is
// timezone-independent (matches PG's extract(isodow ...) evaluated
// on the same date value).
export function mondayOfWeek(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`mondayOfWeek: expected YYYY-MM-DD, got ${JSON.stringify(isoDate)}`);
  }
  const d = new Date(`${isoDate}T12:00:00Z`);
  // getUTCDay: 0=Sunday..6=Saturday. Convert to ISO (Monday=0..Sunday=6).
  const isoIdx = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - isoIdx);
  return d.toISOString().slice(0, 10);
}

// Return the 7 ISO-week dates (Mon..Sun) as YYYY-MM-DD strings.
export function weekDates(weekStartMonday) {
  const monday = mondayOfWeek(weekStartMonday);
  const out = [];
  const base = new Date(`${monday}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Completeness rule: `entered || no-service` for all 7 days.
// ─────────────────────────────────────────────────────────────────
//
// Spec §3, verbatim: "the completeness rule holds for all 7 days:
// `entered || no-service` (the shipped rule, reused verbatim)."
//
// Shipped rule cited: src/app/service-calendar/season/dayPredicates.js
// lines 43-49 (NON_ACTIONABLE_STATUSES) + the atom-status derivation
// in src/lib/dataStore/serviceCalendar.js `classifyDayStatus`
// lines 259-337. Per-meal accounts (this pipeline's scope) classify
// as follows:
//   - entered   : `sc_daily_actuals` row exists with a non-zero
//                 actual_count somewhere in the day
//   - no-service: `sc_daily_actuals` row exists with ALL zero
//                 actual_counts (line 326)
//               : OR `sc_daily_projections` rows exist for the day
//                 with ALL zero projected_counts and NO actuals
//                 (line 333 - the planned off-day, PR #167 shape)
//
// This function collapses both `entered` and `no-service` into
// "complete" via two structural predicates:
//   hasActualsRow  = at least one sc_daily_actuals row for (acct, date)
//   plannedOffDay  = at least one sc_daily_projections row exists AND
//                    all projected_counts for (acct, date) are 0
//
// A day is complete when either predicate holds; incomplete
// otherwise. This matches classifyDayStatus for per-meal accounts on
// the finalize-relevant path exactly.
//
// AWAY / EXHIBITION / OFF-SEASON / PREP: per-meal accounts do not
// emit these statuses in the shipped code (they belong to fee/MLB
// paths). This function does NOT check for them because a per-meal
// account cannot produce them. Fee accounts are structurally
// excluded from the finalize pipeline (see
// v2/billing/perMealAccounts.js).
export async function computeWeekCompleteness(accountKey, weekStartMonday) {
  const supa = getServiceClient();
  const dates = weekDates(weekStartMonday);

  // Fetch actuals + projections for the 7 dates. Two round trips,
  // paginated shape optional (14 dates x N services per account is
  // well under the 1000-row page even for the fattest catalog).
  const [actualsRes, projectionsRes] = await Promise.all([
    supa
      .from("sc_daily_actuals")
      .select("service_date, actual_count")
      .eq("account_key", accountKey)
      .in("service_date", dates),
    supa
      .from("sc_daily_projections")
      .select("service_date, projected_count")
      .eq("account_key", accountKey)
      .in("service_date", dates),
  ]);
  if (actualsRes.error) {
    throw new Error(`computeWeekCompleteness actuals: ${actualsRes.error.message}`);
  }
  if (projectionsRes.error) {
    throw new Error(`computeWeekCompleteness projections: ${projectionsRes.error.message}`);
  }

  const actualsByDate = new Map();  // date -> true if any row exists
  for (const r of actualsRes.data || []) {
    actualsByDate.set(String(r.service_date).slice(0, 10), true);
  }

  // Per date: does a projection row exist? Are all projections zero?
  const projByDate = new Map();     // date -> { hasRow: bool, anyNonZero: bool }
  for (const r of projectionsRes.data || []) {
    const d = String(r.service_date).slice(0, 10);
    const cur = projByDate.get(d) || { hasRow: false, anyNonZero: false };
    cur.hasRow = true;
    if (Number(r.projected_count) > 0) cur.anyNonZero = true;
    projByDate.set(d, cur);
  }

  const missingDates = [];
  for (const d of dates) {
    const hasActualsRow = actualsByDate.get(d) === true;
    const proj = projByDate.get(d) || { hasRow: false, anyNonZero: false };
    const plannedOffDay = proj.hasRow && !proj.anyNonZero;
    const isComplete = hasActualsRow || plannedOffDay;
    if (!isComplete) missingDates.push(d);
  }

  return {
    complete: missingDates.length === 0,
    missingDates,
    weekStart: dates[0],
    weekEnd: dates[6],
    reason: missingDates.length === 0
      ? null
      : `${missingDates.length} day${missingDates.length === 1 ? "" : "s"} still need entry or no-service`,
  };
}

// ─────────────────────────────────────────────────────────────────
// Live-row lookup for (account, week).
// ─────────────────────────────────────────────────────────────────
//
// Returns the current live row for (accountKey, mondayOfWeek(date))
// OR null if the week is OPEN. LIVE = status != 'reverted' (matches
// sc-30's partial unique index).
export async function loadLiveFinalizeRow(accountKey, dateInWeek) {
  const supa = getServiceClient();
  const weekStart = mondayOfWeek(dateInWeek);
  const { data, error } = await supa
    .from("sc_week_finalize")
    .select("id, account_key, week_start, status, finalized_by, finalized_at")
    .eq("account_key", accountKey)
    .eq("week_start", weekStart)
    .neq("status", "reverted")
    .maybeSingle();
  if (error) {
    throw new Error(`loadLiveFinalizeRow(${accountKey}, ${dateInWeek}): ${error.message}`);
  }
  return data || null;
}

// ─────────────────────────────────────────────────────────────────
// The write-path predicate (matches assertDaysUnlockedForWrite).
// ─────────────────────────────────────────────────────────────────
//
// Wired into the SAME four write paths that carry the sc-25 period
// lock (sc-submit-day, sc-reset-day, sc-bulk-submit,
// sc-submit-closeout). If a day's week has a live row with status
// finalized / push_failed / billed, the write is refused for
// non-override callers.
//
// Override group: SC_LOCK_OVERRIDE (K-10) - Kevin + Joe + Sebastian.
// Same override that bypasses the period lock. Rationale: whoever
// can reach into a closed period should also be who can reach into
// a finalized week; two nested locks with the same escape hatch.
//
// For an array of dates, checks each unique Mon-Sun week once (not
// per-date) - the week key is derived server-side so the caller
// cannot bypass by rounding dates.
export async function assertWeekOpenForWrite(accountKey, dates, email) {
  if (!accountKey) {
    throw new Error("assertWeekOpenForWrite: accountKey required");
  }
  if (!Array.isArray(dates) || dates.length === 0) return null;

  // Override bypass. Same identity check as assertDaysUnlockedForWrite.
  if (isScLockOverride(email)) return null;

  // Collapse to unique week starts. A 30-day bulk write touches at
  // most 5-6 weeks; the loop below is bounded by that.
  const uniqueWeekStarts = new Set();
  for (const d of dates) {
    uniqueWeekStarts.add(mondayOfWeek(d));
  }

  // One SELECT per unique week. supabase-js .rpc isn't necessary
  // here - a table SELECT with equal predicates is simpler and
  // hits the partial unique index cleanly.
  const results = await Promise.all(
    [...uniqueWeekStarts].map((ws) =>
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        try {
          const supa = getServiceClient();
          const { data, error } = await supa
            .from("sc_week_finalize")
            .select("week_start, status")
            .eq("account_key", accountKey)
            .eq("week_start", ws)
            .neq("status", "reverted")
            .maybeSingle();
          if (error) return reject(error);
          resolve({ weekStart: ws, live: data || null });
        } catch (err) {
          reject(err);
        }
      })
    )
  );

  const finalizedWeeks = [];
  for (const r of results) {
    if (r.live) {
      finalizedWeeks.push({ weekStart: r.weekStart, status: r.live.status });
    }
  }

  if (finalizedWeeks.length === 0) return null;

  finalizedWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Message text placeholder pending UI copy ruling in the same
  // shape as scPeriodLock.js. The code + finalizedWeeks array are
  // load-bearing; the message is fallback copy for probes / logs.
  const message =
    finalizedWeeks.length === 1
      ? `Cannot save - week ${finalizedWeeks[0].weekStart} is ${finalizedWeeks[0].status}. Ask leadership if this needs to change.`
      : `Cannot save - ${finalizedWeeks.length} weeks are locked (finalized or billed). Ask leadership if this needs to change.`;

  return {
    code: "WEEK_FINALIZED",
    finalizedWeeks,
    message,
  };
}

// ─────────────────────────────────────────────────────────────────
// runFinalizeEffects - the seam PR-C will extend.
// ─────────────────────────────────────────────────────────────────
//
// PR-A (this file): records state only. No side effects. Returns a
// summary object the caller passes back to the client.
//
// PR-C (next arc PR): this hook grows to POST the invoice payload to
// QBO's proxy + send the K-1 notification email. The seam exists
// today so PR-C is a fill-in-the-hook change, not a rewrite of the
// finalize action.
//
// Contract (PR-A):
//   Input:  { accountKey, weekStart, finalizedRow }
//   Output: { pushed: false, reason: "PR-A: state-only" }
//
// Contract (PR-C future - DOCUMENTED HERE, NOT IMPLEMENTED):
//   Input:  same
//   Output: {
//     pushed: true,
//     qboInvoiceId: string,
//     qboDocNumber: string,
//     pretaxTotal: number,      // cents
//     ledgerRowId: uuid,
//     notification: { sent: bool, to: string[] },
//   } or on failure
//   Output: {
//     pushed: false,
//     failure: { code: "QBO_ERROR" | "MAPPING_ERROR" | ...,
//                message: string, attempt: number },
//   }
//
// Do NOT stub fake QBO push code in PR-A. The seam is inert until
// PR-C's build; a stub would drift and mislead.
export async function runFinalizeEffects(_ctx) {
  return {
    pushed: false,
    reason: "PR-A: state-only, no QBO push implemented yet",
  };
}
