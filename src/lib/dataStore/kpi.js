// ═══════════════════════════════════════════════════════════════
// KPI Engine - shared data helpers
// ═══════════════════════════════════════════════════════════════
//
// Home for KPI-facing reads that other modules must not duplicate.
// Governing docs: docs/KPI_DASHBOARD_PLAYBOOK.md,
// docs/KPI_ENGINE_ARCHITECTURE.md v1.1.
//
// Rule (v1.1 §0): Postgres is the default. Everything here reads PG.
// Rule (v1.1 §3.1): periods are per-account. TBR-FL's P13 ends
// 2026-12-29 while the other 10 accounts' service in P13 ends
// 2026-12-20. Bucketing resolves (account_key, date), never date alone.

import { getServiceClient } from "@/lib/supabase";

// ─── periodForDate ─────────────────────────────────────────────────
//
//
// SERVICE MEMBERSHIP versus FISCAL MEMBERSHIP - they diverge.
//
// `sc_day_metadata` answers "was there service on this date." The KPI
// engine needs "what period does this date belong to." Those are
// different questions and they diverge in exactly one window per year:
// the 9 days between the end of P13 service (2026-12-20 for 10 of 11
// accounts) and the fiscal year end (2026-12-29, TBR-FL's extended
// P13 end).
//
// Concrete cases in that window: 3100.2 salary accrues, 5013.2
// building lease runs monthly, 5012.3 utilities and 5012.2 scavenger
// accrue, an invoice may be dated in the window. Under exact-date
// service lookup all of that money returns null and has no period to
// land in. Under N5 it would surface as unattributed - technically
// honest but wrong, because the period is knowable.
//
// This helper resolves by FISCAL BOUNDARY, not by service membership.
// A period runs from its own start_date through the day before the
// next period's start_date. P13 extends through the fiscal year end.
// A date past the fiscal year end returns null (2026-12-30 must not
// silently resolve to P13).
//
// PER-ACCOUNT rule is preserved for period boundaries within the
// fiscal year. P1 through P12 are 28-day windows identical across
// the 11 client accounts (verified 2026-08-04: contiguity check
// passes). P13 boundary extends every account through the global
// fiscal year end so cost that accrues after service still buckets.
//
// FISCAL YEAR END is a STATED BUSINESS FACT, not derived from data.
// Kevin's ruling 2026-08-04: 13x4 = 364-day fiscal calendar, so
// FY2026 = P1 start (2025-12-29) + 363 days = 2026-12-27. This is
// hardcoded, not computed via MAX(P13.end) across accounts.
// Deriving a global financial boundary from one account's service
// schedule would let workbook-import drift define a fiscal rule.
//
// TBR-FL's sc_day_metadata rows for 2026-12-28 and 2026-12-29 are
// labeled period=13 in the source, but those days fall past
// FY2026's fiscal end and are FY2027 P1 fiscally. Under Kevin's
// ruling the resolver returns null for dates past FY2026_END;
// whether those rows should be relabeled at source is a separate
// data-cleanup question flagged in the delivery.
//
// FISCAL YEAR SCOPE: this helper handles FY2026 only. All rows in
// sc_day_metadata today are FY2026. When FY2027 data lands, the
// cache builder needs to group by fiscal_year too - flagged in the
// cache load function.
//
// CONTIGUITY ASSUMPTION: MIN/MAX per (account, period) is used to
// derive boundaries. This is safe as long as each account's rows for
// a period form a single contiguous run. Verified 2026-08-04 across
// all 11 client accounts: 0 contiguity breaks, 12 period changes
// each. The probe check #5 (`_probe_kpi_spine.mjs`) catches any
// regression.
//
// CACHE INVALIDATION: TTL, not explicit. sc_day_metadata is written
// by the SC seed / admin surface, not by this module or its callers,
// so explicit invalidation would require every writer to know about
// this cache - not scalable and easy to forget. TTL is one line, self-
// healing, and bounds staleness at CACHE_TTL_MS. For test surfaces
// only, `_resetPeriodCacheForTests()` bypasses TTL and clears state.
// If a caller genuinely needs a bounded-fresh read (e.g. a user just
// edited sc_day_metadata and clicks refresh), the caller may call
// `_resetPeriodCacheForTests()` explicitly - the underscore prefix
// is a signal that this is a test/admin escape hatch, not a normal
// production code path.

const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes

// FISCAL YEAR END - UNRESOLVED. Provisional value only.
//
// This constant decides where 7 days of accrual land: FY2026 P13 or
// FY2027 P1. Salary (3100.2), building lease (5013.2), equipment
// lease (5013.1), utilities (5012.3) and scavenger (5012.2) all
// accrue between 2026-12-21 and 2026-12-27 regardless of whether
// service runs.
//
// The repo disagrees with itself:
//   SC_SPREADSHEET_MAPPING.md:36-44  51 weeks / 357 days, P13 = 3 weeks
//   SOUSAI_AGENT_PLAN.md:539         "13-by-4" = 52 weeks / 364 days
//   SC_STATUS.md:136-141             no fiscal-calendar generator exists;
//                                    sc_day_metadata mirrors the service
//                                    workbooks and nothing else
//
// 357 days cannot be the fiscal year - it drifts 8 days annually and
// destroys year-over-year period comparability. But 364 is Chat-Claude's
// inference, not a stated business fact.
//
// OPEN QUESTION FOR JOE (playbook §12): when does the fiscal year
// actually end? The service calendars stop 12/20; salary does not.
//
// Provisional: 2026-12-27 (P1 start + 363). Changing this moves a week
// of accrual between fiscal years. Do not change it without a ruling.
const FY2026_END = "2026-12-27";

let _cache = null;
let _cacheLoadPromise = null;

function cacheIsFresh() {
  return _cache && (Date.now() - _cache.loadedAt < CACHE_TTL_MS);
}

async function loadBoundaries() {
  if (cacheIsFresh()) return _cache;
  if (_cacheLoadPromise) return _cacheLoadPromise;
  _cacheLoadPromise = (async () => {
    const supa = getServiceClient();
    // Paginate to defeat the 1000-row PostgREST default.
    // 11 accounts x ~357-366 rows = ~3936 rows; comfortably fits.
    let all = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await supa
        .from("sc_day_metadata")
        .select("account_key, service_date, period")
        .not("period", "is", null)
        .order("account_key")
        .order("service_date")
        .range(offset, offset + 999);
      if (error) throw new Error(`kpi.loadBoundaries: ${error.message}`);
      all = all.concat(data || []);
      if ((data || []).length < 1000) break;
      offset += 1000;
    }
    // Group by (account_key, period) with MIN/MAX. Contiguity per
    // (account, period) is an assumption verified by the probe;
    // MIN/MAX gives the correct range only when there is one run per
    // (account, period).
    const perAccount = {};
    for (const r of all) {
      if (!perAccount[r.account_key]) perAccount[r.account_key] = {};
      const bucket = perAccount[r.account_key][r.period];
      if (!bucket) {
        perAccount[r.account_key][r.period] = { start: r.service_date, end: r.service_date };
      } else {
        if (r.service_date < bucket.start) bucket.start = r.service_date;
        if (r.service_date > bucket.end) bucket.end = r.service_date;
      }
    }
    return { perAccount, fiscalYearEnd: FY2026_END, loadedAt: Date.now() };
  })();
  const c = await _cacheLoadPromise;
  _cache = c;
  _cacheLoadPromise = null;
  return c;
}

/**
 * Look up the fiscal period membership for one (account, date).
 *
 * Resolves by FISCAL BOUNDARY, not by service membership on that date
 * (see header). A date after the last service day of P13 but inside
 * the fiscal year still resolves to P13. A date past the fiscal year
 * end returns null.
 *
 * Returns the period as a string ("1".."13") to match how
 * sc_day_metadata stores it. Returns null when the date is outside
 * the account's fiscal year window.
 *
 * @param {string} accountKey - canonical spaced-hyphen team_key (e.g. "CIN - OH")
 * @param {string} date - ISO date "YYYY-MM-DD"
 * @returns {Promise<string|null>}
 */
export async function periodForDate(accountKey, date) {
  const { perAccount, fiscalYearEnd } = await loadBoundaries();
  const acct = perAccount[accountKey];
  if (!acct) return null;
  // Sort periods numerically so we can find the containing bucket.
  const periods = Object.keys(acct).sort((a, b) => Number(a) - Number(b));
  if (!periods.length) return null;
  const firstStart = acct[periods[0]].start;
  if (date < firstStart) return null;                // pre-fiscal-year
  if (date > fiscalYearEnd) return null;             // post-fiscal-year hard end
  // Walk periods and find the one whose boundary contains the date.
  // For period X < last: covers [start_X, start_{X+1} - 1]
  // For the last period: covers [start_last, fiscalYearEnd]
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const start = acct[p].start;
    const boundaryEnd = (i === periods.length - 1)
      ? fiscalYearEnd
      : addOneDayISO(acct[periods[i + 1]].start, -1);
    if (date >= start && date <= boundaryEnd) return p;
  }
  return null;
}

// Small ISO date arithmetic helper: shift YYYY-MM-DD by n days.
// Uses UTC to avoid Vercel/local timezone drift.
function addOneDayISO(iso, deltaDays) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Test hook - reset the cache. Do not call from application code.
export function _resetPeriodCacheForTests() {
  _cache = null;
  _cacheLoadPromise = null;
}
