// src/lib/kpi/overview/resolver.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Top-level orchestrator. Composes labor + purchasing engines as
// LIBRARY CALLS (never re-queries labor_actuals, never re-buckets
// purchasing rows) and folds the pnl / period / flag layer on top to
// produce the Overview payload described in §5.4-§5.8 of
// KPI_MASTER_SCOPE.md v4.
//
// Rule enforcement in code:
//   - Cost lines come exclusively from labor's buildBoard (3100) +
//     purchasing's buildPurchasingBoard (3200 / 3400 / 3500 buckets +
//     tracked 5002.1 / 5002.5 / 5017.3).
//   - Revenue lines come from resolveRevenueSource, which picks
//     pnl_actuals / kpi_budgets / sc_daily_revenue per §5.5.
//   - budget_to_date_days for cost lines comes from
//     board.budget_to_date_days + totals.buckets_budget_to_date_days
//     (Phase B rider on the drill boards). Revenue budget_to_date_days
//     uses the pure computeBudgetToDateForLine from budget-to-date.js.
//   - Absence contract propagates: statement rows carry
//     `reported: true|false`, and `actual` is null when reported=false.
//
// Instrumentation:
//   - Every loader call is timed via performance.now(). The `?debug=
//     timing` param on the route returns an `_debug` block with the
//     per-loader wall-time attribution (Phase E of the brief).

import { performance } from "node:perf_hooks";

// Labor + purchasing engines (library-call, no HTTP hop).
import { buildBoard, computeBudgetToDateDays as computeLaborBudgetToDateDays } from "@/app/kpi/labor/lib/board.js";
import { paginateActuals as paginateLaborActuals, resolveMemberBudget } from "@/lib/labor/loaders.js";
import {
  loadWeeklyRevenueBasis as loadWeeklyRevenueBasisForOverview,
  attachWeeklyBasisToBoard,
  computeLineTargetPctByPeriod,
} from "@/lib/labor/labor-week-basis.js";
import { resolveWorkerMeta } from "@/lib/kpi/resolveWorkerMeta.js";
import { buildWorkerToEmail, countDistinctPeople } from "@/lib/labor/personCount.js";
// Salary-side loaders + merge helper. Overview ALWAYS composes labor
// with salary included (R-28, §5.9): "Salary control reveals sub-lines
// only; totals always include salary. Gross margin must equal
// finance's, and finance's includes salary." The `includeSalary` flag
// on this resolver is a DISCLOSURE toggle for the 3100.1 / 3100.2
// sub-rows in the statement; it never changes the 3100 total or any
// derived figure (COGS, gross margin, ticker, chart).
import { load3100_2Budgets, loadSalaryActuals, mergeBudgetPeriods, shapeSalaryRow } from "@/lib/labor/salaryBoard.js";
// R-77 fix (Kevin 2026-09-04): budget_at_this_revenue moves to a
// shared module so both boards compute the same figure. See the
// header of src/lib/kpi/shared/batr.js for the invariant + reasoning.
import {
  budgetAtThisRevenue as sharedBatr,
  envelopeDelta as sharedEnvelopeDelta,
  computePeriodRevenueByLine as sharedComputePeriodRevenueByLine,
  contributesToTotal,
  computeContractualAccrualByPeriod,
} from "@/lib/kpi/shared/periodBasis.js";

import { buildPurchasingBoard } from "@/app/kpi/purchasing/lib/resolver.js";
import {
  paginateActuals as paginatePurchasingActuals,
  paginateWeekly as paginatePurchasingWeekly,
  loadPending as loadPurchasingPending,
  loadPurchasingBudgets,
  loadFreshness as loadPurchasingFreshness,
  fetchMembers,
} from "@/lib/purchasing/loaders.js";

import { REGIONAL_DIRECTORS } from "@/lib/incidentSchema";

// Overview owned modules.
import {
  REVENUE_LINE_CODES,
  ALSO_TRACKED_LINE_CODES,
  loadPeriodStatus,
  loadAccountFlags,
  loadPnlActuals,
  loadOverviewBudgets,
  loadInventoryAdjustments,
  loadScDailyRevenue,
  derivePeriodState,
  capBeforeToday,
} from "./pnl-loader.js";

// R-67 constant + computePeriodRevenueByLine now live in
// src/lib/kpi/shared/periodBasis.js (see imports above). Local
// duplicates removed 2026-09-07 per Kevin's shared-basis PR.
// classifyForRevenue + resolveRevenueSource stay in revenue-source.js
// (still owned there); periodBasis re-exports them for convenience
// but this file keeps the direct import for the two remaining
// direct call sites.
import { classifyForRevenue, resolveRevenueSource } from "./revenue-source.js";
import {
  computeBudgetToDateForLine,
  computeFullPeriodBudget,
  computeFullYearBudget,
} from "./budget-to-date.js";
import { computeTicker } from "./ticker.js";
import {
  formatMoneyWhole,
  formatPct,
  formatDayLabel,
  pctOf,
  gapDollarsCost,
  gapDollarsRevenue,
  gapDollarsMargin,
  gapPointsCost,
  gapPointsRevenue,
  gapPointsMargin,
  directionOfDelta,
} from "./formatting.js";
import { resolveAccessFlags, resolveIncludeSalary } from "./accessFlags.js";
import { composeFlags, isPackagingGapAccount, isSeededAccount } from "./flags.js";

import { periodOf, periodStartISO, periodEndISO, weekStartsInRange, endOfLastCompleteWeek } from "@/app/kpi/labor/lib/periods.js";
import { PURCHASING_ENVELOPE_EXCLUSIONS } from "@/lib/accountModels.js";

const FISCAL_YEAR = 2026;

// ─── Helpers ────────────────────────────────────────────────────────

function r2(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(Number(n) * 100) / 100;
}

// Sum a specific line's budgets across members (returns Map<period, amount>).
function sumBudgetByPeriodForLine({ overviewBudgets, lineCode, members }) {
  const perLine = overviewBudgets.get(lineCode);
  if (!perLine) return new Map();
  const out = new Map();
  for (const m of members) {
    if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
    const byAcct = perLine.get(m);
    if (!byAcct) continue;
    for (const [pn, amt] of byAcct) {
      out.set(pn, (out.get(pn) || 0) + Number(amt));
    }
  }
  return out;
}

// Sum a line's actuals across members + periods from pnl_actuals.
// Returns { amount, reported_period_count, absent_period_count }.
// Absent periods do NOT contribute to `amount` (null = not reported).
function sumPnlForLine({ pnl, lineCode, members, periods }) {
  let amount = 0;
  let reported = 0;
  let absent = 0;
  let anyReported = false;
  for (const m of members) {
    const byAcct = pnl.get(m);
    for (const p of periods) {
      const perPeriod = byAcct?.get(p);
      const row = perPeriod?.get(lineCode);
      if (row && row.actual != null) {
        amount += Number(row.actual);
        reported += 1;
        anyReported = true;
      } else {
        absent += 1;
      }
    }
  }
  return {
    amount: anyReported ? r2(amount) : null,
    reported_period_count: reported,
    absent_period_count: absent,
  };
}

// SC daily revenue -> sum across members + periods. Sums are cumulative.
// scByAcct: Map<account, Map<serviceDate, amount>>
function sumScDailyRevenue({ scByAcct, members, start, end }) {
  let amount = 0;
  let any = false;
  for (const m of members) {
    const byDate = scByAcct.get(m);
    if (!byDate) continue;
    for (const [day, amt] of byDate) {
      if (day >= start && day <= end) {
        amount += Number(amt);
        any = true;
      }
    }
  }
  return { amount: any ? r2(amount) : null, present: any };
}

// Resolve the members list for a top-level account key.
async function resolveMembers(supa, account) {
  if (account === "ALL" || account === "EAST" || account === "WEST") {
    const q = await fetchMembers(supa, account);
    if (q.error) return { error: q.error, scope: "members" };
    return { data: q.members };
  }
  return { data: [account] };
}

// P2-1 (2026-09-01): the folio rail on the Overview corporate posture
// needs the same live directory shape labor + purchasing ship
// (accounts.name / city / state). Prior to this fix the Overview
// passed STATIC_DIRECTORY from lib/accounts.js, which reserves the
// desc-line slot but carries null team_name / city / state on 8 of
// 11 accounts. folioMemberDescription returned `line: null` for
// those 8 rows, so the FolioRail rendered the placeholder single
// space (" ") for 8/11 accounts instead of "St Louis Cardinals ·
// Jupiter, FL". Kevin's DOM audit named this class as a "payload
// gap, not styling."
//
// Mirrors the private helper in src/app/api/kpi/labor/route.js
// (fetchAccountsDirectory). Duplication is intentional - the labor
// route helper is not exported and lifting it into a shared module
// would touch the labor route (off-limits for this PR). Query is
// small (15 lines, one SELECT), self-contained, and the CORP filter
// / D17 exclusion are inherited from the labor version.
async function fetchAccountsDirectoryOv(supa) {
  const q = await supa.from("accounts")
    .select("team_key, region, name, city, state, timezone")
    .neq("team_key", "CORP")
    .order("team_key");
  if (q.error) return { error: q.error };
  const salaried = new Set(["CIN - KY", "TBJ - NY"]);
  return {
    data: (q.data || []).map(r => ({
      team_key: r.team_key,
      region: r.region,
      team_name: r.name || null,
      city: r.city || null,
      state: r.state || null,
      timezone: r.timezone || null,
      salaried: salaried.has(r.team_key),
    })),
  };
}

// P2-1 (2026-09-01): mirrors labor route's rdoDisplayName. Turns a
// REGIONAL_DIRECTORS email ("first.lastname@kitchfix.com") into the
// folio display format "F. Lastname". Returns null when the email
// cannot be parsed - the folio suppresses the "RDO ..." subline.
function ovRdoDisplayName(email) {
  if (!email) return null;
  const local = String(email).split("@")[0] || "";
  const parts = local.split(".");
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  if (!first || !last) return null;
  return `${first.charAt(0).toUpperCase()}. ${last.charAt(0).toUpperCase() + last.slice(1)}`;
}

const FY_START_ISO = "2025-12-29";

// Kevin R-58 (2026-09-03): every account belongs to one of three
// revenue models. Source of truth is kpi_account_flags.revenue_model
// (migration docs/migrations/pnl-2-revenue-model.sql). This map is a
// PRE-MIGRATION FALLBACK ONLY - dev environments or a fresh row can
// return null revenue_model. In production the column is populated
// per Kevin's ruling and the fallback is never consulted. Kept in
// sync with the SQL backfill; if either changes, both change.
const REVENUE_MODEL_FALLBACK = {
  "TBR - FL": "sc_driven",
  "TBJ - FL": "sc_driven",
  "TBJ - NY": "sc_driven",
  "CIN - AZ": "sc_driven",
  "CIN - KY": "sc_driven",
  "TXR - AZ": "sc_driven",
  "STL - FL": "management_fee",
  "STL - MO": "management_fee",
  "CIN - OH": "management_fee",
  "TXR - TX - H": "management_fee",
  "TXR - TX - V": "sales_based",
};
function accountRevenueModel(accountKey, flagRow) {
  if (flagRow && flagRow.revenue_model) return flagRow.revenue_model;
  return REVENUE_MODEL_FALLBACK[accountKey] || null;
}

// P2-3 / P2-5 (2026-09-01): normalize an `explicit` (start, end) that
// matches a known preset window to that preset's canonical kind so
// downstream consumers (range chip label, revenue card full-year
// vs full-period budget label) hit the right branch. Same class as
// R14's `?preset=` silent-ignore: the client sends explicit dates
// but the server had no way to recover the preset identity, so the
// range chip read "Custom 12/29/25 - 08/31/26" instead of "FYTD"
// and the revenue card read "period budget" ($1,400,799 for CIN - AZ,
// = sum of P1-P9) instead of "annual budget" ($1,572,700).
//
// Two preset windows are recognized:
//   - FYTD:  start === FY_START_ISO && end === today
//   - Period N: (start, end) === (periodStartISO(N), periodEndISO(N))
//
// A single-period explicit range folds to { kind: 'period', period_no }.
// FY start..today folds to { kind: 'fytd' }. Everything else stays
// explicit. Range PR-2 retired last_4wk / last_13wk as presets on
// the picker; those windows do not fold and correctly read as
// "Custom" on the chip.
function normalizeExplicitToPreset({ start, end, today }) {
  if (start === FY_START_ISO && end === today) {
    return { kind: "fytd", period_no: null };
  }
  for (let p = 1; p <= 13; p += 1) {
    const ps = periodStartISO(p);
    const pe = periodEndISO(p);
    if (ps && pe && start === ps && end === pe) {
      return { kind: "period", period_no: p };
    }
  }
  return null;
}

// Kevin 2026-09-02 (PR-1 of language pass): FYTD ends at the last
// CLOSED period's end - not `today`. The Overview is a scoreboard,
// so its year-to-date figure must not roll in a live partial period
// alongside eight closed ones. Both revenue and cost derive from
// this end date, so both sides move together at the same grain -
// the exact defect class that produced the rolling-window 65.7% GM
// and the 23% revenue "beat" on future service days. "Closed"
// here means calendar-closed: the period whose end < today.
// Fee accounts, salaried, per-meal - all treated identically.
// The running period stays reachable through the "This period"
// preset and the P{N} picker.
function lastClosedPeriodNoBefore(today) {
  let last = null;
  for (let p = 1; p <= 13; p += 1) {
    const pe = periodEndISO(p);
    if (pe && pe < today) last = p;
  }
  return last;
}

// Range resolution. `range` inputs:
//   - { kind: 'fytd' }
//   - { kind: 'period', period_no: N }
//   - { kind: 'explicit', start, end }
function resolveRange({ range, today }) {
  if (!range || range.kind === "fytd") {
    const lastClosed = lastClosedPeriodNoBefore(today);
    // Fall back to `today` if the FY hasn't got a single closed period
    // yet (e.g. day one of a new FY). Downstream still works but the
    // payload will just carry zero contributing periods.
    const end = lastClosed != null ? periodEndISO(lastClosed) : today;
    return {
      start: FY_START_ISO,
      end,
      kind: "fytd",
      period_no: null,
    };
  }
  if (range.kind === "period") {
    const s = periodStartISO(range.period_no);
    const e = periodEndISO(range.period_no);
    if (!s || !e) {
      throw new Error(`overview-range: unknown period_no ${range.period_no}`);
    }
    return {
      start: s,
      end: e,
      kind: "period",
      period_no: range.period_no,
    };
  }
  if (range.kind === "explicit") {
    const folded = normalizeExplicitToPreset({
      start: range.start,
      end: range.end,
      today,
    });
    if (folded) {
      return {
        start: range.start,
        end: range.end,
        kind: folded.kind,
        period_no: folded.period_no,
      };
    }
    return {
      start: range.start,
      end: range.end,
      kind: "explicit",
      period_no: null,
    };
  }
  throw new Error(`overview-range: unknown range.kind ${range?.kind}`);
}

// Enumerate the fiscal periods the range's weeks touch.
function periodsInRangeFor(start, end) {
  const weeks = weekStartsInRange(start, end);
  return [...new Set(weeks.map(w => periodOf(w)).filter(p => p != null))].sort((a, b) => a - b);
}


// Sum per-period contributions into range totals per line.
function sumRangeRevenueByLine({ perPeriod, lineCodes }) {
  const out = {};
  for (const line of lineCodes) {
    let amount = 0;
    let anyReported = false;
    const sources = new Set();
    for (const [_, byLine] of perPeriod) {
      const b = byLine[line];
      if (b) {
        if (b.reported) {
          amount += b.amount;
          anyReported = true;
        }
        for (const s of b.sources) sources.add(s);
      }
    }
    out[line] = {
      amount: anyReported ? r2(amount) : null,
      reported: anyReported,
      sources: [...sources],
    };
  }
  return out;
}

// ─── Loader independence audit ──────────────────────────────────────
//
// This audit is proven BY READING each loader's inputs, per Kevin's
// rule. See PR body for the table. The three top-level parallel
// loaders in this resolver are:
//   - loadPeriodStatus (supa, fiscalYear)      - global
//   - loadAccountFlags (supa)                  - global
//   - resolveMembers (supa, accountKey)        - independent of the two above
// Once members is resolved, all downstream loaders read only
// (supa, members, start, end, fiscal_year). None reads any other's
// output. The single downstream parallel block is safe.

// ─── The top-level resolve ──────────────────────────────────────────

/**
 * Resolve the Overview payload for one request.
 *
 * @param {object} args
 * @param {object} args.supa               Supabase service client
 * @param {string} args.accountKey         'ALL' | 'EAST' | 'WEST' | single account
 * @param {object} args.range              { kind: 'fytd' | 'period' | 'explicit', ... }
 * @param {string} args.revSource          'planned' | 'sc'
 * @param {boolean} args.includeSalary
 * @param {object} args.caller             { role, scope, can_see_salary }
 * @param {string} args.today              ISO YYYY-MM-DD
 * @param {boolean} [args.debugTiming]     when true, includes _debug.timings
 *
 * @returns {Promise<object>} payload
 */
export async function resolveOverview({
  supa,
  accountKey,
  range,
  // R-40 polish (2026-09-01): rev_source URL parameter retired.
  // Overview picks SC automatically when the account carries
  // sc_revenue_live=true. The `revSource` positional keeps a stub
  // value here for the internal `assertScReadAllowed` signature (see
  // step 3 loader block below); no caller passes it.
  includeSalary = false,
  caller,
  today,
  debugTiming = false,
}) {
  const t0 = performance.now();
  const timings = {};
  const timeIt = async (label, fn) => {
    const t = performance.now();
    const v = await fn();
    timings[label] = Math.round((performance.now() - t) * 10) / 10;
    return v;
  };

  // 1. Range resolution + members resolution (single hop each, independent).
  const rng = resolveRange({ range, today });
  const mResp = await timeIt("resolveMembers", () => resolveMembers(supa, accountKey));
  if (mResp.error) return { error: mResp.error, scope: mResp.scope };
  const members = mResp.data;
  if (!members || members.length === 0) {
    return { error: { message: `no members for ${accountKey}` }, scope: "members" };
  }

  const isAggregate = accountKey === "ALL" || accountKey === "EAST" || accountKey === "WEST";
  // R-40: no `posture` variable. Access flags only. Layout is one
  // thing everywhere; role governs access.
  const access = resolveAccessFlags({ caller, salaryAvailable: caller?.can_see_salary === true });

  // R-40 polish (2026-09-01): the user-facing rev-source toggle was
  // retired. revenue-source.js now flips to SC purely on the account's
  // own sc_revenue_live flag - no caller input consulted. `effRevSource`
  // stays as a string for the downstream sc_mode_test_data flag +
  // the payload's rev_source echo (audit trail so a debugger can tell
  // which source produced a given revenue figure).
  const effRevSource = "sc";   // marker; resolveRevenueSource ignores this

  // 2. Layer-1 loaders. Fire in parallel - all read (supa, members)
  //    or (supa) or (supa, members, start, end).
  //
  // Loader independence audit (proven by reading):
  //   - loadPeriodStatus(supa, FY)                              - (supa) global
  //   - loadAccountFlags(supa)                                  - (supa) global
  //   - loadOverviewBudgets(supa, {members, FY})                - (supa, members)
  //   - loadPnlActuals(supa, {members, periods, FY})            - (supa, members, periods)
  //     periods enumerated from range (URL param), NOT from any loader
  //   - loadScDailyRevenue(supa, {members, start, end})         - (supa, members, range)
  //   - LABOR: paginateLaborActuals(supa, {members, start, end}) - (supa, members, range)
  //   - LABOR: resolveMemberBudget(supa, m) per member          - (supa, m)
  //   - PURCH: paginatePurchasingWeekly(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: paginatePurchasingActuals(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: loadPurchasingPending(supa, {members, start, end}) - (supa, members, range)
  //   - PURCH: loadPurchasingBudgets(supa, members, FY)         - (supa, members, FY)
  //
  // None reads another loader's output. Fire all in one Promise.all.
  //
  // resolveWorkerMeta needs actualsRows[].worker_id from paginateLaborActuals -
  // that IS a dependency, so it runs AFTER Layer 1 in Layer 2.
  const periods = periodsInRangeFor(rng.start, rng.end);

  // Kevin ruling R-63 (2026-09-03): revenue and cost both stop at the
  // end of the last complete week in the range. On closed ranges every
  // week is complete, so this is a no-op (effectiveEnd == rng.end).
  // On open ranges (P9 today = week 4 running), this caps every loader
  // and every proration at week 3's end (08/30), so revenue and cost
  // both measure the same window and the acceptance
  //   max(revenue_contrib_date) == max(cost_contrib_date)
  // holds by construction.
  //
  // Supersedes the today - 1 cap from #976 on open ranges - 08/30 is
  // earlier than today - 1 = 09/02, so #976's inequality still holds.
  const lastCompleteWk = endOfLastCompleteWeek(rng.start, rng.end, today);
  const effectiveEndISO = lastCompleteWk && lastCompleteWk.effectiveEndISO < rng.end
    ? lastCompleteWk.effectiveEndISO
    : rng.end;

  // Kevin ruling 2026-09-08 item 3 (Approach A). Calendar-derived
  // gate that decides whether to fire the three rail-block queries
  // in parallel with layer1 rather than serialising them after.
  // Derived from rng + today alone - no DB read - so it can be
  // evaluated BEFORE layer1 runs.
  //
  // "Open" per derivePeriodState() is calendar-authoritative when
  // periodStatusRow carries no verified_at / closed_at OVERRIDE.
  // So this gate is a superset of the real isRunningSinglePeriod
  // (below, post-layer1): any period whose calendar window contains
  // today AND has no early-close/early-verify override. Divergence
  // asserted below and telemetry-logged; see the divergence branch
  // for the two theoretical mismatch cases.
  const railGatePStart = rng.kind === "period" && rng.period_no != null
    ? periodStartISO(rng.period_no) : null;
  const railGatePEnd = rng.kind === "period" && rng.period_no != null
    ? periodEndISO(rng.period_no) : null;
  const willBeRunningSinglePeriod = !!(
    rng.kind === "period" &&
    rng.period_no != null &&
    railGatePStart && railGatePStart <= today &&
    railGatePEnd && today <= railGatePEnd
  );

  const layer1 = await timeIt("layer1_parallel", async () => Promise.all([
    loadPeriodStatus(supa, FISCAL_YEAR),
    loadAccountFlags(supa),
    loadOverviewBudgets(supa, { members, fiscalYear: FISCAL_YEAR }),
    loadPnlActuals(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    // SC daily revenue always read (cheap; per-account narrow). The
    // guard is what prevents contamination from surfacing in the
    // per-account picker. Aggregates that don't need it just pass
    // through zero-summed maps.
    // 2026-09-02 blocker fix: loader now takes `today` and caps
    // its own upper bound at today - 1. Prior implementation summed
    // Service Calendar rows for future service days, inflating
    // revenue on open periods (TBJ - FL P9: 26 days vs 22 days of
    // budget). Same helper the sources-line label uses below -
    // label and query derive from one value.
    // R-63 (2026-09-03): every range-scoped loader takes effectiveEndISO
    // instead of rng.end. On closed ranges effectiveEndISO == rng.end
    // (no change); on open ranges it caps at the last complete week's
    // end. SC's own capBeforeToday(today) is now redundant when the
    // resolver caps upstream, but stays defensive for legacy callers.
    loadScDailyRevenue(supa, { members, start: rng.start, end: effectiveEndISO, today }),
    paginateLaborActuals(supa, { members, start: rng.start, end: effectiveEndISO }),
    Promise.all(members.map(m => resolveMemberBudget(supa, m))),
    paginatePurchasingWeekly(supa, { members, start: rng.start, end: effectiveEndISO }),
    paginatePurchasingActuals(supa, { members, start: rng.start, end: effectiveEndISO }),
    loadPurchasingPending(supa, { members, start: rng.start, end: effectiveEndISO }),
    loadPurchasingBudgets(supa, members, FISCAL_YEAR),
    // R-28 / §5.9 - salary is composed INTO 3100 unconditionally on
    // both postures. These two loaders feed the merge in step 5
    // (buildBoard) below.
    load3100_2Budgets(supa, members),
    // R-63: salary actuals capped at effectiveEndISO too so labour and
    // purchasing measure the same window.
    loadSalaryActuals(supa, members, rng.start, effectiveEndISO),
    // P2-1 (2026-09-01): live accounts_directory for the folio rail.
    // Global read (independent of members). Cheap - one SELECT.
    fetchAccountsDirectoryOv(supa),
    // P2-4b / P2-4d (2026-09-01): purchasing freshness for cards_
    // through (last CLOSED card date) + last_derive_at (drives the
    // Overview's command-bar freshness chip via last_walk_at echo).
    loadPurchasingFreshness(supa),
    // Kevin R-61 (2026-09-03): Sebastian's inventory adjusting JEs.
    // Ships an empty map pre-migration; the resolver treats absent
    // JEs as "no adjustment", not zero (absent-vs-zero rule). Never
    // fabricates rows for accounts that carry no inventory.
    loadInventoryAdjustments(supa, { members, periods, fiscalYear: FISCAL_YEAR }),
    // Kevin ruling 2026-09-08 item 3 (Approach A). Rail-block queries
    // moved into layer1_parallel so they hide behind the slowest
    // existing query instead of serialising after. Only fire when
    // the calendar gate says the range is likely a running single
    // period; otherwise resolve to null and the rail branch skips.
    // Prod cost drops from ~1,250ms serialised to ~50-100ms concurrent
    // per Kevin's page-cost timing.
    //
    // Wk basis fetch covers the FULL range (not effectiveEndISO) -
    // the rail needs all four weeks including forecast, and the
    // R-92 branch (below) reads the same result.
    willBeRunningSinglePeriod
      ? loadWeeklyRevenueBasisForOverview(supa, { members, start: rng.start, end: rng.end, today })
      : Promise.resolve(null),
    // Rail labor + salary full-range fetches (versus the existing
    // effectiveEndISO-capped fetches above). Full range needed so
    // buildBoard sees weeks 3+4 on later dates in a period.
    willBeRunningSinglePeriod
      ? paginateLaborActuals(supa, { members, start: rng.start, end: rng.end })
      : Promise.resolve(null),
    willBeRunningSinglePeriod
      ? loadSalaryActuals(supa, members, rng.start, rng.end)
      : Promise.resolve(null),
  ]));
  const [
    periodStatusResp, accountFlagsResp, overviewBudgetsResp, pnlResp,
    scResp, laborActualsResp, memberBudgetResults,
    purchWeeklyResp, purchActualsResp, purchPendingResp, purchBudgetsResp,
    salaryBudgetsResp, salaryActualsResp,
    dirResp, purchFreshness, invAdjResp,
    railWkBasisResp, railLaborActualsResp, railSalaryActualsResp,
  ] = layer1;

  const errs = [];
  if (periodStatusResp.error) errs.push({ scope: "kpi_period_status", error: periodStatusResp.error });
  if (accountFlagsResp.error) errs.push({ scope: "kpi_account_flags", error: accountFlagsResp.error });
  if (overviewBudgetsResp.error) errs.push({ scope: "kpi_budgets_overview", error: overviewBudgetsResp.error });
  if (pnlResp.error) errs.push({ scope: "pnl_actuals", error: pnlResp.error });
  if (scResp.error) errs.push({ scope: "sc_daily_revenue", error: scResp.error });
  if (laborActualsResp.error) errs.push({ scope: "labor_actuals", error: laborActualsResp.error });
  for (const r of memberBudgetResults || []) {
    if (r.error) errs.push({ scope: r.scope || "member_budget", error: r.error });
  }
  if (purchWeeklyResp.error) errs.push({ scope: "v_purchasing_by_site_week", error: purchWeeklyResp.error });
  if (purchActualsResp.error) errs.push({ scope: "purchasing_actuals", error: purchActualsResp.error });
  if (purchPendingResp.error) errs.push({ scope: "purchasing_pending", error: purchPendingResp.error });
  if (purchBudgetsResp.error) errs.push({ scope: "kpi_budgets_purchasing", error: purchBudgetsResp.error });
  if (salaryBudgetsResp.error) errs.push({ scope: "kpi_budgets_3100_2", error: salaryBudgetsResp.error });
  if (salaryActualsResp.error) errs.push({ scope: "labor_salary_actuals", error: salaryActualsResp.error });
  if (dirResp?.error) errs.push({ scope: "accounts_directory", error: dirResp.error });
  if (invAdjResp?.error) errs.push({ scope: "inventory_adjustments", error: invAdjResp.error });
  // Rail responses only checked when the gate fired (otherwise null).
  if (railWkBasisResp?.error) errs.push({ scope: "rail_weekly_revenue_basis", error: railWkBasisResp.error });
  if (railLaborActualsResp?.error) errs.push({ scope: "rail_labor_actuals", error: railLaborActualsResp.error });
  if (railSalaryActualsResp?.error) errs.push({ scope: "rail_salary_actuals", error: railSalaryActualsResp.error });
  // purchFreshness never returns an `error` field per its loader
  // shape (loadFreshness returns the freshness object directly),
  // so no err check here.
  if (errs.length > 0) {
    return { error: errs[0].error, scope: errs[0].scope, all_errors: errs };
  }

  const periodStatus = periodStatusResp.data;
  const accountFlags = accountFlagsResp.data;
  const overviewBudgets = overviewBudgetsResp.data;
  const pnl = pnlResp.data;
  const scByAcct = scResp.data;
  const laborActuals = laborActualsResp.data;
  const memberBudgets = new Map();
  for (let i = 0; i < members.length; i += 1) {
    memberBudgets.set(members[i], memberBudgetResults[i].data);
  }
  const purchWeekly = purchWeeklyResp.data;
  const purchActuals = purchActualsResp.data;
  const purchPending = purchPendingResp.data;
  const purchBudgets = purchBudgetsResp.data;
  // Kevin R-61 (2026-09-03): inventory adjusting JEs keyed by
  // (account, period, gl_line_code). Pre-migration this is empty.
  const invAdjByAcct = invAdjResp?.data || new Map();
  // Finalised periods (closed_awaiting or verified) - NEVER open.
  // JEs are booked at close; the running period shows purchases
  // alone. Computed once here + reused for the row + status
  // computations later.
  const finalisedPeriods = periods.filter(p => {
    const state = derivePeriodState({
      periodNo: p,
      todayISO: today,
      periodStatusRow: periodStatus.get(p) || null,
    });
    return state !== "open";
  });
  // Sum JEs across members × finalised periods for a given GL code.
  // Returns 0 (not null) when no JEs found; this is a SUM, not an
  // actual-vs-null value. Callers subtract from purchases to get
  // adjusted cost.
  const sumInventoryJeForGl = (glLineCode) => {
    let total = 0;
    for (const m of members) {
      const byPeriod = invAdjByAcct.get(m);
      if (!byPeriod) continue;
      for (const p of finalisedPeriods) {
        const byGl = byPeriod.get(p);
        if (!byGl) continue;
        const je = byGl.get(glLineCode);
        if (je != null) total += je;
      }
    }
    return r2(total);
  };
  const foodInventoryJe = sumInventoryJeForGl("3200");
  const packagingInventoryJe = sumInventoryJeForGl("3400");
  // Salary side (§5.9 / R-28). Always composed - no toggle guard.
  const salary3100_2Budgets = salaryBudgetsResp.byAccount || new Map();
  const salaryRows = salaryActualsResp.rows || [];

  // 3. Layer-2: workerToEmail from laborActuals (dependency).
  //    Include salary worker_ids so distinct-people counts dedupe across
  //    the hourly + salary merge (mirrors the labor route's
  //    withSalary path, which resolves salary-only ids BEFORE the merge
  //    for the same reason - see src/lib/labor/salaryBoard.js §
  //    "2026-08-28 person-key fix").
  const workerIds = [...new Set([
    ...(laborActuals || []).map(r => r.worker_id),
    ...salaryRows.map(r => r.worker_id),
  ])];
  const workerMeta = await timeIt("resolveWorkerMeta", () => resolveWorkerMeta(supa, workerIds));
  const workerToEmail = buildWorkerToEmail(workerMeta.workerMeta);

  // 4. Aggregate labor budget_periods across members (mirrors labor
  //    route's aggregate branch's per-period sum). Also handles
  //    single-account case (memberBudgets has one entry).
  //
  //    R-28 / §5.9 (2026-08-31): Overview ALWAYS composes labor with
  //    salary INCLUDED regardless of the `includeSalary` toggle. The
  //    toggle is a DISCLOSURE control for the 3100.1 / 3100.2 sub-rows
  //    in the statement; it never moves the 3100 total or any derived
  //    figure. Rebuild the labor budget input by merging 3100.2 salary
  //    budgets on top of the resolved hourly (3100.1 / SC-superseded)
  //    budgets, mirroring what the labor route's withSalary does for
  //    include_salary=1.
  const laborBudgetSumMap = new Map();  // p -> amount (hourly)
  for (const [, list] of memberBudgets) {
    for (const bp of list || []) {
      laborBudgetSumMap.set(bp.period_no, (laborBudgetSumMap.get(bp.period_no) || 0) + Number(bp.amount));
    }
  }
  const laborBudgetPeriodsHourly = [...laborBudgetSumMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, amt]) => ({ period_no: p, amount: r2(amt) }));
  // Sum salary (3100.2) budget per period across members.
  const salaryBudgetByPeriod = new Map();
  for (const m of members) {
    const inner = salary3100_2Budgets.get(m);
    if (!inner) continue;
    for (const [pn, amt] of inner) {
      salaryBudgetByPeriod.set(pn, (salaryBudgetByPeriod.get(pn) || 0) + Number(amt || 0));
    }
  }
  // Kevin ruling R-68 item 1 (2026-09-04) BLOCKER: revert the
  // this-period item-4 gating. Labor ALWAYS composes salary into
  // the 3100 total, target %, chart series and cost total. Never
  // moves a number by toggle. The toggle is a DISCLOSURE control
  // only - it gates the 3100.1 / 3100.2 sub-rows in the P&L and
  // the P&L's Full-view button; the parent 3100 total is byte-
  // identical between the two toggle states.
  //
  // Rationale from Kevin: managers below site-leader have no access
  // to salary line items. The default view (hourly) must still tie
  // to finance's P&L, so hourly-only can never be the composition
  // seen by any reader. The prior item-4 behavior showed a cost
  // ($780k) that was not the cost and a target (42.6%) that was not
  // the target - $115k and seven points out.
  //
  // Drill URL from the cost-line row: also always passes
  // include_salary=1 so the labor board opens at the same salary-
  // inclusive composition the row's 3100 total reflects.
  const mergedBudget = mergeBudgetPeriods(laborBudgetPeriodsHourly, salaryBudgetByPeriod);
  const laborBudgetPeriods = mergedBudget.periods;
  // Merged per-period map for downstream consumers (chart per-period
  // labor budget point). Always salary-inclusive per R-68.
  const laborBudgetSumMapMerged = new Map();
  for (const bp of laborBudgetPeriods) {
    laborBudgetSumMapMerged.set(bp.period_no, Number(bp.amount || 0));
  }

  // 5. Call labor buildBoard as a library call, on the merged (hourly +
  //    salary) inputs. account_state stays "hourly_ok" - the salaried-
  //    only single accounts (CIN - KY, TBJ - NY) fall out with applies=
  //    false when there are no hourly rows AND no salary rows; when
  //    salary rows exist they get a real board (matches the labor
  //    route's D26 salary-on branch, salaryBoard.js line 222-232).
  const salaryActualsShaped = salaryRows.map(shapeSalaryRow);
  const mergedLaborActuals = (laborActuals || []).concat(salaryActualsShaped);
  // R-63 (Kevin 2026-09-03): pass effectiveEndISO as the range end AND
  // as throughISO so labor's budget-to-date days proration stops at
  // the same edge as revenue + purchasing. On closed ranges this is
  // a no-op (effectiveEndISO == rng.end).
  const laborBoard = await timeIt("buildBoard(labor)", async () => buildBoard({
    account: accountKey,
    start: rng.start,
    end: effectiveEndISO,
    today,
    throughISO: effectiveEndISO,
    actuals: mergedLaborActuals,
    budget_periods: laborBudgetPeriods,
    account_state: "hourly_ok",
    workerToEmail,
  }));

  // 6. Call purchasing buildPurchasingBoard as a library call.
  //
  // R-63 (Kevin 2026-09-03): pass effectiveEndISO as the range end AND
  // as throughISO so the purchasing board's own budget-to-date days
  // proration lands on the same edge that the SC + labor loaders use.
  // On closed ranges effectiveEndISO == rng.end (no change).
  const purchBoard = await timeIt("buildBoard(purchasing)", async () => buildPurchasingBoard({
    members,
    start: rng.start,
    end: effectiveEndISO,
    today,
    throughISO: effectiveEndISO,
    actualsRows: purchActuals,
    weeklyRows: purchWeekly,
    pendingRow: purchPending,
    budgetMap: purchBudgets,
  }));

  // 7. Compute per-period revenue by line + range totals.
  // Kevin ruling 2026-09-07: shared periodBasis.js owns the picker
  // + rules; this file is a consumer.
  const perPeriodRevenue = sharedComputePeriodRevenueByLine({
    members,
    periods,
    periodStatus,
    accountFlags,
    todayISO: today,
    overviewBudgets,
    pnl,
    scByAcct,
    revSource: effRevSource,
  });
  const revenueByLine = sumRangeRevenueByLine({
    perPeriod: perPeriodRevenue,
    lineCodes: REVENUE_LINE_CODES,
  });

  // 7b. Range composition (Kevin 2026-09-02 blocker). Every period in
  //     the range is exactly one of verified / live / planned. The
  //     board's four disclosure surfaces (range chip, revenue-lines
  //     pill, revenue card sub-line, sources popover) read from THIS
  //     one field so each surface can't derive its own version - the
  //     same defect class as the two "year budget" figures on one
  //     screen. Classification rule (per period):
  //       - state === "verified"           -> verified
  //       - any member picked sc_daily_revenue -> live
  //       - otherwise (open non-SC, closed_awaiting, fee) -> planned
  //     Invariant: verified.count + live.count + planned.count ===
  //     periods_total on every range. Enforced at build time; the
  //     verify probe reasserts on live payloads.
  const rangeComposition = buildRangeComposition({ periods, perPeriodRevenue });
  // Build-time invariant: every period is exactly one kind. If this
  // ever throws, the classifier lost track and a downstream surface
  // (pill / popover / status) will lie.
  {
    const sum = rangeComposition.verified.count
      + (rangeComposition.awaiting?.count || 0)
      + rangeComposition.live.count
      + rangeComposition.planned.count;
    if (sum !== rangeComposition.periods_total) {
      throw new Error(
        `overview-range-composition invariant: ${sum} categorized ` +
        `vs ${rangeComposition.periods_total} periods_total (periods=${periods.join(",")})`,
      );
    }
  }

  // 8. Revenue TOTAL: sum across the 5 revenue lines. reported = any
  //    line reported. sources = union of sources across lines.
  let totalRevenueAmount = 0;
  let totalRevReported = false;
  const totalRevSources = new Set();
  for (const line of REVENUE_LINE_CODES) {
    const r = revenueByLine[line];
    if (r?.reported) {
      totalRevenueAmount += r.amount;
      totalRevReported = true;
    }
    for (const s of r?.sources || []) totalRevSources.add(s);
  }
  // let (not const) so the sc_counts_without_dollars pass below can
  // override this to null when the SC path returned rows summing to 0.
  let totalRevenue = totalRevReported ? r2(totalRevenueAmount) : null;

  // 9. Revenue BUDGET to date + full-period + full-year. Sum over the
  //    5 revenue lines' budgets. Fee accounts + tracked accounts only
  //    have 2400.1 populated; per-meal have multiple.
  let revBudgetToDate = 0;
  let revBudgetFullPeriod = 0;
  let revBudgetFullYear = 0;
  let anyRevBudget = false;
  for (const line of REVENUE_LINE_CODES) {
    const byPeriod = sumBudgetByPeriodForLine({ overviewBudgets, lineCode: line, members });
    if (byPeriod.size === 0) continue;
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today, throughISO: effectiveEndISO });
    if (bto.amount != null) {
      revBudgetToDate += bto.amount;
      anyRevBudget = true;
    }
    const fp = computeFullPeriodBudget({ budgetByPeriod: byPeriod, periodsInRange: periods });
    if (fp != null) revBudgetFullPeriod += fp;
    const fy = computeFullYearBudget({ budgetByPeriod: byPeriod });
    if (fy != null) revBudgetFullYear += fy;
  }
  const revenue_budget_to_date = anyRevBudget ? r2(revBudgetToDate) : null;
  const revenue_budget_full_period = anyRevBudget ? r2(revBudgetFullPeriod) : null;
  const revenue_budget_full_year = anyRevBudget ? r2(revBudgetFullYear) : null;

  // 10. Cost lines - pull from the engines.
  //    Labor (3100): board.spent_to_date + board.range_budget +
  //      board.budget_to_date_days
  //    Purchasing buckets (3200/3400/3500): purchBoard.buckets +
  //      purchBoard.totals.buckets_budget +
  //      purchBoard.totals.buckets_budget_to_date_days
  //    Purchasing tracked (5002.1/5002.5/5017.3): purchBoard.tracked +
  //      purchBoard.totals.tracked_budget_to_date_days

  const labor3100_actual = laborBoard?.applies ? r2(laborBoard.spent_to_date) : null;
  const labor3100_budget = laborBoard?.applies ? (laborBoard.range_budget ?? null) : null;
  const labor3100_budget_to_date_days = laborBoard?.applies
    ? (laborBoard.budget_to_date_days?.amount ?? null)
    : null;

  // Raw purchases (what was BOUGHT). Kevin R-61 (2026-09-03): the
  // Overview shows finance-side numbers - what was USED, not what
  // was bought - by subtracting Sebastian's inventory adjusting JEs.
  // Both figures ship on the cost-lines row so the operator sees the
  // reconciliation ("$X purchased · −$Y inventory = $Z"). Every
  // downstream calc (cogsActual, pcts, variance, verdicts) uses the
  // ADJUSTED value. 3200 (food) + 3400 (packaging + supplies) only;
  // labor + vehicle carry no inventory.
  const food_actual_purchased = purchBoard.buckets["3200"]?.period_total ?? null;
  const food_budget = purchBoard.buckets["3200"]?.budget ?? null;
  const packaging_actual_purchased = purchBoard.buckets["3400"]?.period_total ?? null;
  const packaging_budget = purchBoard.buckets["3400"]?.budget ?? null;
  const vehicle_actual = purchBoard.buckets["3500"]?.period_total ?? null;
  const vehicle_budget = purchBoard.buckets["3500"]?.budget ?? null;
  const food_actual = food_actual_purchased != null
    ? r2(food_actual_purchased - foodInventoryJe)
    : null;
  const packaging_actual = packaging_actual_purchased != null
    ? r2(packaging_actual_purchased - packagingInventoryJe)
    : null;

  // Budget-to-date-days for the buckets aggregate. purchBoard's
  // totals block ships buckets_budget_to_date_days as an aggregate;
  // per-bucket day-budget is a Phase-6 deliverable, not shipped here.
  const buckets_budget_to_date_days = purchBoard.totals.buckets_budget_to_date_days;

  const rm_actual = purchBoard.tracked["5002.1"]?.period_total ?? null;
  const rm_budget = purchBoard.tracked["5002.1"]?.budget ?? null;
  const equip_actual = purchBoard.tracked["5002.5"]?.period_total ?? null;
  const equip_budget = purchBoard.tracked["5002.5"]?.budget ?? null;
  const perks_actual = purchBoard.tracked["5017.3"]?.period_total ?? null;
  const perks_budget = purchBoard.tracked["5017.3"]?.budget ?? null;

  // Total COGS actual + budget = labor + food + packaging + vehicle.
  // A null on any line means "not applicable" (e.g., labor on a
  // salaried-only single account). Substitute 0 for math when null,
  // but the payload preserves the null in each line.
  const cogsActual = (labor3100_actual || 0) + (food_actual || 0) + (packaging_actual || 0) + (vehicle_actual || 0);
  const cogsBudget = (labor3100_budget || 0) + (food_budget || 0) + (packaging_budget || 0) + (vehicle_budget || 0);
  const cogsBudgetToDateDays = (labor3100_budget_to_date_days || 0) + (buckets_budget_to_date_days?.amount || 0);

  // 2026-09-01 defect fix: target-% surfaces were composing the ratio
  // as full-period-budget / to-date-revenue - CIN - AZ P9 showed
  // COGS target 71.5% against actual 45.8% (25.7% "under"), when
  // the correct same-window ratio is 56.2% (10.4% under). Ratio
  // rule: target_pct = budget_to_date(line) / budget_to_date(revenue).
  // Both sides on the same horizon.
  //
  // Purchasing exposes only an AGGREGATE `buckets_budget_to_date_days`
  // (not per-bucket). Since all three buckets prorate against the
  // same period-in-range grid, the per-bucket to-date is
  //   bucket.budget * (agg_to_date / agg_full)
  // The ratio is well-defined when the agg full is non-zero. When
  // either operand is null (no data), the per-bucket to-date is
  // null and downstream pctOf returns null.
  const bucketsBudgetFullSum = (food_budget || 0) + (packaging_budget || 0) + (vehicle_budget || 0);
  const bucketsToDateRatio = (buckets_budget_to_date_days?.amount != null && bucketsBudgetFullSum > 0)
    ? buckets_budget_to_date_days.amount / bucketsBudgetFullSum
    : null;
  const prorateBucketToDate = (fullBudget) => {
    if (fullBudget == null || bucketsToDateRatio == null) return null;
    return r2(fullBudget * bucketsToDateRatio);
  };
  const food_budget_to_date_days      = prorateBucketToDate(food_budget);
  const packaging_budget_to_date_days = prorateBucketToDate(packaging_budget);
  const vehicle_budget_to_date_days   = prorateBucketToDate(vehicle_budget);

  // R-71 Stage 2 (Kevin ruling 2026-09-04): sum vendor-credit amounts
  // (signed negative, stored that way by the loader) per parent bucket.
  // Used by the cost row's "$X invoiced - $Y credits = $Z" sub-line
  // display. Credits FOLD into the GL-coded sub-line (they carry a
  // chartOfAccountId), so no synthetic CREDITS sub-row is emitted;
  // the per-gl aggregation naturally nets them into e.g. 3200.1.
  // The per-bucket total is retained solely for the cost-row derivation
  // sub-line's visibility.
  const creditsByBucket = { "3200": 0, "3400": 0, "3500": 0 };
  const purchasesByBucket = { "3200": 0, "3400": 0, "3500": 0 };
  for (const r of (purchActuals || [])) {
    const gl = String(r.gl_line_code || "");
    const bucket = gl.startsWith("3200") ? "3200"
                 : gl.startsWith("3400") ? "3400"
                 : gl.startsWith("3500") ? "3500"
                 : null;
    if (!bucket) continue;
    const amt = Number(r.amount || 0);
    if (r.source === "billcom_credit") {
      creditsByBucket[bucket] += amt;
    } else {
      purchasesByBucket[bucket] += amt;
    }
  }

  // PR-1 item 1 (2026-09-02). has_target is the invariant "there is a
  // real target to compare against on this range". Rules:
  //   - Single fiscal period (kind === "period")     -> true
  //   - FYTD (kind === "fytd")                       -> true
  //   - Rolling window (kind === "explicit")         -> false
  // Plus a guard: both budgets must actually be present. An account
  // with no budget file (or a period with no matching budget row)
  // trips false regardless of range kind.
  //
  // When false, every target_pct, variance_pct, envelope_delta and
  // budget_at_this_revenue field on every surface (cards, levers,
  // statement rows, drill.purchasing, statement_totals) is null. The
  // COGS + GM pills read "No target" (neutral tone). Cost variances
  // remain (dollars are honest without a target); cost pcts of
  // revenue remain (a ratio of two actuals, not a comparison).
  // Kevin CC prompt 2026-09-08. #1063 made This year resolve as
  // kind="explicit" (client sends R-93 dates directly, no preset
  // param). The old predicate only recognized `period` / `fytd`, so
  // has_target went false on This year - and every target_pct,
  // variance_pct, envelope_delta and budget_at_this_revenue null'd
  // out. Empty board.
  //
  // Widened: a target is meaningful whenever the range covers WHOLE
  // fiscal periods with budgets present, however it was reached
  // (preset, shared link, back button, typed URL). A rolling window
  // whose start/end don't align to period boundaries stays false -
  // that's the guard against going too far. Anyone landing on P3-P5
  // by any route gets the same answer as clicking a "P3-P5" preset
  // would today.
  //
  // A single-period / fytd fold still resolves via the existing
  // resolveRange path so those keep has_target=true too; the alignment
  // check catches the explicit path that #1063 introduced.
  const rangeAlignsToPeriods = (() => {
    if (rng.kind === "period" || rng.kind === "fytd") return true;
    if (rng.kind !== "explicit" || !rng.start || !rng.end) return false;
    let matchStart = false;
    let matchEnd = false;
    for (let p = 1; p <= 13; p += 1) {
      if (periodStartISO(p) === rng.start) matchStart = true;
      if (periodEndISO(p) === rng.end) matchEnd = true;
    }
    return matchStart && matchEnd;
  })();
  const has_target = rangeAlignsToPeriods
    && revenue_budget_full_period != null && revenue_budget_full_period > 0
    && cogsBudget > 0;

  // 10b. sc_counts_without_dollars diagnostic (PR-1 item 6, Kevin
  // 2026-09-02). When the range is open and the effective revenue
  // source is sc_daily_revenue, and rows landed but every
  // actual_revenue is 0, the operator is looking at service days on
  // the calendar with no meal counts entered - revenue is an absence,
  // not a zero. Compute here so we can null totalRevenue below and
  // cascade the null through downstream verdicts rather than lying
  // "$0" into the payload. Kevin's SC thread: seeding must write
  // sc_daily_actuals.actual_count. Prices are resolved in the sc-8b
  // view via double COALESCE (actual price -> projected price -> 0),
  // so counts alone drive dollars; a row without a count contributes
  // exactly 0.
  //
  // Single-account per-meal only. Aggregates + fee + tracked accounts
  // never read sc_daily_revenue and stay null.
  //
  // We derive displayPeriodState locally (it's computed formally
  // below) so the totalRevenue override can happen before the gross-
  // margin math.
  const displayPeriodStateForSc = (() => {
    let n = null;
    if (rng.kind === "period") n = rng.period_no;
    else if (periods.length > 0) n = periods[periods.length - 1];
    if (n == null) return "open";
    return derivePeriodState({
      periodNo: n,
      todayISO: today,
      periodStatusRow: periodStatus.get(n) || null,
    });
  })();
  let sc_counts_without_dollars = null;
  if (!isAggregate && classifyForRevenue(accountKey) === "per_meal"
      && displayPeriodStateForSc === "open") {
    const acctFlags = accountFlags.get(accountKey) || null;
    if (acctFlags && acctFlags.sc_revenue_live === true) {
      const byDate = scByAcct.get(accountKey);
      if (byDate) {
        // Sum over the DISPLAY PERIOD, not the whole range. On FYTD
        // the display period is the running period; only its counts
        // (or lack thereof) determine the diagnostic. Prior periods
        // in FYTD read pnl_actuals via the picker.
        const pn = rng.kind === "period" ? rng.period_no
          : (periods.length > 0 ? periods[periods.length - 1] : null);
        const pStart = pn != null ? periodStartISO(pn) : rng.start;
        const pEnd = pn != null ? periodEndISO(pn) : rng.end;
        let rowCount = 0;
        let sumRev = 0;
        let firstDate = null;
        let lastDate = null;
        for (const [day, amt] of byDate) {
          if (day >= pStart && day <= pEnd) {
            rowCount += 1;
            sumRev += Number(amt);
            if (firstDate == null || day < firstDate) firstDate = day;
            if (lastDate == null || day > lastDate) lastDate = day;
          }
        }
        if (rowCount > 0 && sumRev === 0) {
          sc_counts_without_dollars = {
            row_count: rowCount,
            dates_covered: { first: firstDate, last: lastDate },
          };
        }
      }
    }
  }
  // Absence, not zero. Every downstream cogs pct + verdict already
  // cascades from null revenue. See statement row 2400.1 override
  // further down for the per-row absence patch.
  if (sc_counts_without_dollars) {
    totalRevReported = false;
    totalRevenue = null;
  }

  // Kevin R-92 (2026-09-09). On a running single period the standard
  // SC path caps at capBeforeToday (today - 1) and misses the week's
  // confirmed counts entered ahead of the day. Labor already reads
  // per-week SC and treats a week as CONFIRMED when every projected
  // service has a count - "a week counts once its counts are
  // confirmed, not once it has closed." Overview follows the same
  // rule on This period: revenue actual becomes the sum of confirmed
  // weeks; the card names the count ("2 of 4 weeks confirmed in the
  // Service Calendar"). Cost + margin cards HOLD (see cards[]
  // overrides below and client gate).
  //
  // Only runs on a running single period (rng.kind === "period" +
  // displayPeriodState === "open"). Every other range keeps its
  // existing totalRevenue path.
  // R-92 declarations moved below displayPeriodState (line 1130ish)
  // to escape TDZ - the reference read displayPeriodState before its
  // let-declaration and threw "Cannot access 'displayPeriodState'
  // before initialization". See block below.
  let confirmedWeeksCount = null;
  let totalWeeksCount = null;

  // 11. Gross margin.
  // grossMargin (dollars) depends on totalRevenue - under
  // sc_counts_without_dollars it correctly nulls out. grossMarginBudget
  // (dollars) is budget-vs-budget: revenue_budget_to_date minus
  // cogsBudgetToDateDays. Previously gated on totalRevenue != null,
  // which was wrong - a target is a budget concept, not an actual one.
  // On sc_counts_without_dollars the target-side stays intact (a real
  // "here's what you should be spending" number the operator can
  // still see), only actual-derived figures null out.
  //
  // PR-1 item 1 (2026-09-02): gmPctBudget is the FULL-PERIOD target
  // ratio, not to-date. Kevin's rule: "target percent is identical on
  // day 1 and day 28". On single-period ranges the two are identical
  // (proration cancels); on FYTD the to-date form drifts as the
  // running period elapses. Full-period is invariant across the year.
  const grossMargin = totalRevenue != null ? r2(totalRevenue - cogsActual) : null;
  const grossMarginBudget = (revenue_budget_to_date != null)
    ? r2(revenue_budget_to_date - cogsBudgetToDateDays)
    : null;
  const gmPctActual = pctOf(grossMargin, totalRevenue);
  const gmPctBudget = (revenue_budget_full_period != null && revenue_budget_full_period > 0)
    ? pctOf(revenue_budget_full_period - cogsBudget, revenue_budget_full_period)
    : null;

  // 12. Period state chip - the range's chip is the state of the
  //     current period in the range, or the terminal period for a
  //     closed range. FYTD uses the current period.
  let displayPeriodNo = null;
  let displayPeriodState = "open";
  if (rng.kind === "period") {
    displayPeriodNo = rng.period_no;
  } else if (rng.kind === "fytd") {
    displayPeriodNo = periods.length > 0 ? periods[periods.length - 1] : null;
  } else if (rng.kind === "explicit") {
    displayPeriodNo = periods.length > 0 ? periods[periods.length - 1] : null;
  }
  if (displayPeriodNo != null) {
    displayPeriodState = derivePeriodState({
      periodNo: displayPeriodNo,
      todayISO: today,
      periodStatusRow: periodStatus.get(displayPeriodNo) || null,
    });
  }

  // Kevin R-92 (2026-09-09). Confirmed-weeks SC read for This period.
  // Placed here (right after displayPeriodState resolves) so the
  // isRunningSinglePeriod gate can key off displayPeriodState.
  // Overrides totalRevenue when the range is a running single period
  // and at least one week's SC counts are all confirmed - Labor
  // already reads per-week and treats a week as CONFIRMED when every
  // projected service has a count. Overview follows the same rule
  // on This period: revenue actual becomes the sum of confirmed
  // weeks; the card names the count. Cost + margin cards HOLD (see
  // cards[] pill overrides + client gate).
  const isRunningSinglePeriod = rng.kind === "period" && displayPeriodState === "open";
  // Kevin ruling 2026-09-08 item 3. Assert the calendar-derived
  // rail gate agrees with the real state post-layer1. The gate
  // gets checked BEFORE any DB reads to decide whether to fire
  // the three rail queries in parallel with layer1; if it ever
  // disagrees, either wasted queries (false positive - gate fires
  // but state isn't open) or missing data (false negative - state
  // is open but queries didn't fire).
  //
  // Divergence cases from derivePeriodState:
  //   false positive: calendar-open AND periodStatusRow.verified_at
  //     OR closed_at set -> state = "verified" / "closed_awaiting".
  //     Rare early-verify or early-close override. Wasted queries,
  //     no wrong result (rail block skips).
  //   false negative: state = "open" but calendar-not-open. Cannot
  //     happen per derivePeriodState (returns "planned" for future,
  //     "open" only when today in [pStart, pEnd] + no override).
  //
  // Warn on divergence so the telemetry catches an actual case if
  // one appears in production.
  if (willBeRunningSinglePeriod !== isRunningSinglePeriod) {
    // eslint-disable-next-line no-console
    console.warn("[overview] rail-gate divergence", {
      account: accountKey,
      range: { start: rng.start, end: rng.end, period_no: rng.period_no },
      today,
      willBeRunningSinglePeriod,
      isRunningSinglePeriod,
      displayPeriodState,
      periodStatusRow: displayPeriodNo != null ? (periodStatus.get(displayPeriodNo) || null) : null,
    });
  }
  // Kevin ruling 2026-09-08 Path B. wkBasis lives at outer scope so
  // both the R-92 confirmed-weeks compute (this block) and the
  // week_rail compute (below the chart) read the same SC weekly
  // rows. One fetch, two consumers.
  //
  // Approach A (2026-09-08 item 3): the fetch itself moved into
  // layer1_parallel above, gated on willBeRunningSinglePeriod. When
  // the calendar gate agreed with the real state we already have
  // the result; otherwise runningWkBasis stays null and the R-92
  // branch skips.
  let runningWkBasis = willBeRunningSinglePeriod ? railWkBasisResp : null;
  if (isRunningSinglePeriod && effRevSource === "sc") {
    if (runningWkBasis?.data?.length) {
      const wkBasis = runningWkBasis;
      const weeks = wkBasis.data;
      totalWeeksCount = weeks.length;
      const confirmedWks = weeks.filter(w => w.basis === "confirmed");
      confirmedWeeksCount = confirmedWks.length;
      // Kevin ratify (2026-09-09). Revenue for a confirmed week is
      // EVERYTHING the operator entered - full actuals, no filter
      // on whether a service was in the R-85 denominator. Kevin's
      // rule: "a confirmed week is one the operator confirmed and
      // saved. If they put in 160 breakfasts, 160 lunches and 6
      // dinners, that is the week." R-85 (denom-only) is for
      // COUNTING which weeks are confirmed - not for the revenue
      // figure. Prior code used actual_revenue_in_denom here and
      // reverted after Kevin's ratify; the $208 he traced to a
      // stray forecast week was a week-boundary error in his own
      // query, not a real leak.
      const confirmedSum = confirmedWks.reduce((s, w) => s + Number(w.revenue || 0), 0);
      if (confirmedSum > 0) {
        // Kevin ruling 2026-09-08. Running-period revenue is the
        // Service Calendar confirmed-weeks sum PLUS the 2300 service
        // fee prorated by the same confirmed weeks. Kept OUT of
        // periodBasis's R-67 branch on purpose (Guard 1 in the CC
        // prompt): this is an Overview presentation rule for the
        // running period, not a shared accrual rule. periodBasis
        // gets zero changes so Last period, Current year, and Labor
        // are byte-identical.
        //
        // Kevin scope call (item 2): 2300 ONLY. Do not prorate 2200
        // on TBR - its catering comes from the Service Calendar
        // (B&G Lunch), so it is already in the SC figure. 2600
        // untouched (rare, no B&G analogue).
        const feeBudgetByPeriod = sumBudgetByPeriodForLine({
          overviewBudgets, lineCode: "2300", members,
        });
        const feeThisPeriod = Number(feeBudgetByPeriod.get(displayPeriodNo) || 0);
        const feeProrate = (feeThisPeriod > 0 && confirmedWeeksCount > 0)
          ? feeThisPeriod * (confirmedWeeksCount / 4)
          : 0;
        totalRevenue = Math.round((confirmedSum + feeProrate) * 100) / 100;
        totalRevReported = true;
        totalRevSources.add("sc_daily_revenue");
        if (feeProrate > 0) totalRevSources.add("kpi_budgets_2300_prorate");
        // Kevin ruling PR-3 follow-up (2026-09-08). Per-line
        // attribution on TP is an audit question, not a design one,
        // and comes back in a deliberate audit pass. Until then:
        // the confirmed sum lands as the TOTAL only. Each revenue
        // line reads "not reported" - honest partial state beats
        // per-line figures that don't sum to the total (a $3,765
        // 2400.1 under a $51,190 total is worse than showing
        // nothing on the lines). The standard SC-through-yesterday
        // path had populated 2400.1 with a one-day partial;
        // overwrite that null so the lines match the honest state.
        for (const line of REVENUE_LINE_CODES) {
          if (revenueByLine[line]) {
            revenueByLine[line] = { amount: 0, reported: false, sources: [] };
          }
        }
      }
    }
  }

  // 13. Flags block.
  // Determine if the display period's per-meal revenue is planned
  // (has at least one per-meal member on planned mode).
  const perMealMembers = members.filter(m => classifyForRevenue(m) === "per_meal");
  const perMealPlanned = displayPeriodState === "open" && perMealMembers.length > 0 && !(
    effRevSource === "sc" && perMealMembers.every(m => accountFlags.get(m)?.sc_revenue_live === true)
  );
  const scLiveAny = perMealMembers.some(m => accountFlags.get(m)?.sc_revenue_live === true);
  const flags = composeFlags({
    accountKey,
    members,
    revSource: effRevSource,
    scLive: scLiveAny,
    revenueModel: (() => {
      if (isAggregate) return null;
      const rs = resolveRevenueSource({
        accountKey,
        periodState: displayPeriodState,
        revSource: effRevSource,
        accountFlags: accountFlags.get(accountKey) || null,
      });
      return rs.model;
    })(),
  });
  // Override `planned` to reflect display-period planned semantics for
  // aggregates too.
  flags.planned = perMealPlanned;

  // PR-1 item 5 (2026-09-02). revenue_source_state names WHY the
  // revenue variance carries a suffix, so the client keys "provisional"
  // off source, not off period_state. Once sc_revenue_live=true for an
  // account, revenue to date is real actual and the variance is a
  // settled comparison; the amber suffix belongs only on planned
  // revenue. Verified periods are also settled (finance P&L).
  //   planned  - open period, sc_revenue_live=false OR no live counts
  //   live     - open period, sc_revenue_live=true (real actual)
  //   verified - period closed (verified or awaiting finance)
  const revenue_source_state = (() => {
    if (displayPeriodState === "verified") return "verified";
    if (displayPeriodState === "closed_awaiting") return "verified";
    if (isAggregate) return flags.planned ? "planned" : "live";
    const acctFlags = accountFlags.get(accountKey) || null;
    return (acctFlags && acctFlags.sc_revenue_live === true) ? "live" : "planned";
  })();

  // Kevin R-58 (2026-09-03): revenue_model on payload root. Cards,
  // cost lines, help copy and probes read this to gate the "adjusted
  // budget" surface. Portfolio scope has no single model; the value
  // is null there and downstream surfaces default to the SC-driven
  // shape (the corporate rollup mixes all three models). Single-
  // account: read from kpi_account_flags.revenue_model (fallback to
  // the pre-migration map).
  const revenue_model = isAggregate
    ? null
    : accountRevenueModel(accountKey, accountFlags.get(accountKey) || null);
  const isManagementFee = revenue_model === "management_fee";

  // PR-1 item 2 (2026-09-02). Envelope + pace helpers.
  // revenue_pace_pct: how far revenue came in against its own budget-
  //   to-date. Not a target percent - a pace measurement on revenue.
  // budget_at_this_revenue: the cost the target percent buys at the
  //   revenue actually earned (line_target_pct * actual_revenue).
  // envelope_delta: budget_to_date - budget_at_this_revenue. Positive
  //   means the envelope shrank (revenue short); negative grew.
  const revenue_pace_pct = (totalRevenue != null && revenue_budget_to_date != null && revenue_budget_to_date > 0)
    ? r2((totalRevenue / revenue_budget_to_date) * 100) : null;
  // R-77 fix (Kevin 2026-09-04): route through the shared helper.
  // Formula is identical; the guard shape moves into the helper so
  // Labor's route computes with the same rules. See
  // src/lib/kpi/shared/batr.js for why one owner beats two.
  const budgetAtThisRevenue = (lineBudget) => sharedBatr({
    actualRevenue: totalRevenue,
    lineBudget,
    revenueBudgetFullPeriod: revenue_budget_full_period,
    hasTarget: has_target,
  });
  const envelopeDelta = (btd, batr) => sharedEnvelopeDelta(btd, batr);

  // 14. Ticker.
  const isFeeAccount = !isAggregate && classifyForRevenue(accountKey) === "fee";
  const isPassThrough = flags.pass_through;
  const cogsLinesForTicker = [
    // PR-1 item 1 (2026-09-02): target_pct = line_budget_full_period /
    // revenue_budget_full_period. Horizon-invariant across FYTD too.
    // See card + lever + statement-row treatment for the same rule.
    { line_code: "3100", label: "Kitchen labor",           actual_pct: pctOf(labor3100_actual, totalRevenue), target_pct: pctOf(labor3100_budget, revenue_budget_full_period) },
    { line_code: "3200", label: "Food purchased",          actual_pct: pctOf(food_actual, totalRevenue),      target_pct: pctOf(food_budget,      revenue_budget_full_period) },
    { line_code: "3400", label: "Packaging and supplies",  actual_pct: pctOf(packaging_actual, totalRevenue), target_pct: pctOf(packaging_budget, revenue_budget_full_period) },
    { line_code: "3500", label: "Vehicle",                 actual_pct: pctOf(vehicle_actual, totalRevenue),   target_pct: pctOf(vehicle_budget,   revenue_budget_full_period) },
  ].filter(l => l.actual_pct != null && l.target_pct != null);

  // Weeks-closed for the through segment (single-period ranges).
  let weeks_closed = null;
  let weeks_total = null;
  if (rng.kind === "period" && laborBoard?.applies) {
    weeks_closed = laborBoard.closed_weeks_count ?? null;
    weeks_total = laborBoard.weeks_in_period ?? null;
  }

  const ticker = computeTicker({
    gm_pct_actual: gmPctActual,
    gm_pct_target: gmPctBudget,
    cogs_lines: cogsLinesForTicker,
    period_state: displayPeriodState,
    data_thru_date: today,
    weeks_closed,
    weeks_total,
    is_fee_account: isFeeAccount,
    is_pass_through: isPassThrough,
    revenue_is_planned: flags.planned,
    // R-40: effRevSource === "sc" is only reachable when the caller
    // has revenue_toggle_visible (access-gated in resolveAccessFlags),
    // so the prior redundant `posture.posture === "corporate"` check
    // is dropped. Same set of callers reach this branch as before.
    sc_mode_test_data: effRevSource === "sc" && flags.seeded,
  });

  // 15. Cards (Revenue, COGS, Gross margin). Server-side formatting.
  const revenueDelta = totalRevenue != null && revenue_budget_to_date != null
    ? r2(totalRevenue - revenue_budget_to_date) : null;
  const cogsDelta = cogsActual - cogsBudgetToDateDays;
  const gmDelta = grossMargin != null && grossMarginBudget != null
    ? r2(grossMargin - grossMarginBudget) : null;

  const cards = [
    {
      key: "revenue",
      label: "Revenue",
      gl_codes: "2200 · 2300 · 2400",
      hero_actual: totalRevenue,
      hero_actual_display: formatMoneyWhole(totalRevenue),
      hero_reported: totalRevReported,
      // Kevin R-92 (2026-09-09). Confirmed-weeks count for the
      // running-period card caption: "N of X weeks confirmed in the
      // Service Calendar. The rest is forecast and will firm up as
      // counts land." Null on every other range - client omits the
      // caption. See the confirmed-weeks override on totalRevenue
      // above; these two fields expose the same computation for
      // the card face.
      confirmed_weeks_count: confirmedWeeksCount,
      total_weeks_count: totalWeeksCount,
      budget_to_date: revenue_budget_to_date,
      budget_to_date_display: formatMoneyWhole(revenue_budget_to_date),
      budget_full_period: revenue_budget_full_period,
      budget_full_period_display: formatMoneyWhole(revenue_budget_full_period),
      budget_full_year: revenue_budget_full_year,
      budget_full_year_display: formatMoneyWhole(revenue_budget_full_year),
      delta_dollars: revenueDelta,
      delta_display: revenueDelta != null ? gapDollarsRevenue(revenueDelta) : null,
      delta_direction: revenueDelta != null ? directionOfDelta(revenueDelta, "revenue") : null,
      // PR-1 item 2 (2026-09-02): revenue_pace_pct on the revenue card
      // so the status line and card sub-line can name how far revenue
      // came in against its own budget-to-date - the sentence Kevin
      // wants operators to see when SC counts arrive short: "revenue
      // came in 8.1% short, so your cost budget dropped with it".
      revenue_pace_pct,
      pill: (() => {
        if (isFeeAccount) return { label: "Contractual", tone: "neutral" };
        // PR-1 item 6 (2026-09-02): sc_counts_without_dollars is an
        // absence, not a comparison. "Not yet reporting" beats "Below
        // budget" because the second reads as a shortfall when the
        // truth is the counts have not been entered.
        if (sc_counts_without_dollars) return { label: "Not yet reporting", tone: "neutral" };
        if (flags.planned) return { label: "Planned", tone: "warn" };
        if (revenueDelta == null) return { label: "No data", tone: "neutral" };
        // Kevin ruling this-period (2026-09-03) item 2: on an open
        // range the comparison is prorated (revenue running against
        // forecast-to-date, not the settled period budget), so the
        // pill reads TRENDING ABOVE / TRENDING BELOW with a neutral
        // tone. Green on an AT-RISK card would read as good news
        // mid-period. Closed ranges keep the settled verdict.
        //
        // Kevin post-1060 sweep (2026-09-09): pill drops the dollar
        // figure. It moves to the variance footer on the card body
        // so the pill scans identically across all three cards. State
        // words only. Render of record:
        // docs/renders/overview-cards-variance-footer.html.
        // Prior form: "$27,085 above projection". New form: "above
        // projection". Trending state on open-mid-period is preserved
        // (real semantic distinction from the settled verdict on a
        // closed range).
        //
        // Kevin R-92 (2026-09-09): on a running single period with
        // confirmed-weeks revenue, the pill reads "Confirmed so
        // far" green - names what the figure is. The trending
        // state above only fires on ranges where no week is fully
        // confirmed yet (SC still filling in).
        const openRange = displayPeriodState === "open";
        if (isRunningSinglePeriod && confirmedWeeksCount != null && confirmedWeeksCount > 0) {
          return { label: "Confirmed so far", tone: "good" };
        }
        if (Math.abs(revenueDelta) < 1) {
          return { label: "on projection", tone: openRange ? "neutral" : "good" };
        }
        if (openRange) {
          return revenueDelta >= 0
            ? { label: "trending above", tone: "neutral" }
            : { label: "trending below", tone: "neutral" };
        }
        return revenueDelta >= 0
          ? { label: "above projection", tone: "good" }
          : { label: "below projection", tone: "bad" };
      })(),
      sources: [...totalRevSources],
    },
    {
      key: "cogs",
      label: "Cost of goods sold",
      gl_codes: "3100 – 3500",
      hero_actual: r2(cogsActual),
      hero_actual_display: formatMoneyWhole(cogsActual),
      // COGS is derived from live labor + live purchasing engines - it
      // is always reported (never null in-scope).
      hero_reported: true,
      budget_to_date: r2(cogsBudgetToDateDays),
      budget_to_date_display: formatMoneyWhole(cogsBudgetToDateDays),
      pct_of_revenue: pctOf(cogsActual, totalRevenue),
      pct_of_revenue_display: formatPct(pctOf(cogsActual, totalRevenue)),
      // PR-1 item 1 (2026-09-02): target_pct is budget/budget on the
      // FULL-PERIOD sums, not to-date sums. Within a single period the
      // two are identical (proration cancels), but on FYTD the to-date
      // form drifts as the running period elapses. Kevin's rule "the
      // target is identical on day 1 and day 28" applies to every range
      // that has a target; using full-period sums makes it invariant
      // across the fiscal year too. Cost pcts of revenue remain (ratio
      // of two actuals - honest without a target); the target does not
      // when !has_target (rolling window).
      target_pct_of_revenue: has_target ? pctOf(cogsBudget, revenue_budget_full_period) : null,
      target_pct_display: has_target ? formatPct(pctOf(cogsBudget, revenue_budget_full_period)) : null,
      // PR-1 item 2 (2026-09-02): envelope + pace on the COGS card.
      // budget_at_this_revenue = cost the target buys at actual rev.
      // envelope_delta = budget_to_date - budget_at_this_revenue.
      budget_at_this_revenue: budgetAtThisRevenue(cogsBudget),
      // Kevin ruling final-presentation (2026-09-03) item 2: display
      // string beside the target percent on the card face.
      budget_at_this_revenue_display: formatMoneyWhole(budgetAtThisRevenue(cogsBudget)),
      // Kevin R-58/R-59 (2026-09-03): management-fee accounts have
      // contractual revenue, so budget_at_this_revenue equals the
      // period budget by construction and the delta is $0 in
      // perpetuity. Emit envelope_delta as null on those accounts so
      // the card + cost-lines can suppress the "$0 more than planned"
      // line rather than render a figure that can never move.
      envelope_delta: isManagementFee ? null : envelopeDelta(r2(cogsBudgetToDateDays), budgetAtThisRevenue(cogsBudget)),
      delta_dollars: r2(cogsDelta),
      delta_display: gapDollarsCost(cogsDelta),
      delta_direction: directionOfDelta(cogsDelta, "cost"),
      delta_pct_display: has_target ? gapPointsCost(pctOf(cogsActual, totalRevenue) - pctOf(cogsBudget, revenue_budget_full_period)) : null,
      pill: (() => {
        // PR-1 item 1: rolling window -> "No target", neutral tone.
        if (!has_target) return { label: "No target", tone: "neutral" };
        // Kevin R-92 (2026-09-09). On a running single period the
        // cost pct is HELD - revenue is confirmed ahead of the week
        // and invoices arrive weeks later, so a percentage now
        // reads 8.3% and means nothing. Pill names the state that
        // is preventing a verdict.
        if (isRunningSinglePeriod) return { label: "Invoices still arriving", tone: "wait" };
        // Kevin PR-B item 4 (2026-09-03): the pill reads OVER BUDGET
        // / UNDER BUDGET, tied to total cost of goods against its
        // adjusted budget - not a count of lines and not the % gap.
        // Simple, and it agrees with the card above it (which
        // displays actual vs budget_at_this_revenue). Algebraically
        // identical to the prior actual-% vs target-% comparison,
        // stated in the natural "total vs total" idiom.
        const budAtRev = budgetAtThisRevenue(cogsBudget);
        // Kevin walkthrough sweep item 6 (2026-09-07). "No data" fired
        // whenever budAtRev was null (no revenue means no adjusted
        // budget) even when cogsActual carried a real dollar figure -
        // a contradiction: pill says no data on top of a shown number.
        // Split the cases: if actual exists but batr can't compute
        // (day one of a period, no revenue yet), say what is true -
        // "cost, no revenue yet". If actual itself is missing, keep
        // "No data".
        if (cogsActual == null) return { label: "No data", tone: "neutral" };
        if (budAtRev == null) return { label: "cost, no revenue yet", tone: "neutral" };
        return cogsActual <= budAtRev
          ? { label: "under budget", tone: "good" }
          : { label: "over budget", tone: "bad" };
      })(),
      mini: [
        { label: "Labor",     actual: labor3100_actual, display: formatMoneyWhole(labor3100_actual) },
        { label: "Food",      actual: food_actual,      display: formatMoneyWhole(food_actual) },
        { label: "Packaging", actual: packaging_actual, display: formatMoneyWhole(packaging_actual) },
        { label: "Vehicle",   actual: vehicle_actual,   display: formatMoneyWhole(vehicle_actual) },
      ],
      // Kevin Prompt 2 PR-B (2026-09-04): the Planning view reads
      // budget_full_period on the cogs + gm cards (revenue card
      // already carries it). One field, same shape across three cards.
      budget_full_period: r2(cogsBudget),
      budget_full_period_display: formatMoneyWhole(cogsBudget),
    },
    {
      key: "gross_margin",
      label: "Gross margin",
      hero_actual: grossMargin,
      hero_actual_display: formatMoneyWhole(grossMargin),
      hero_reported: totalRevReported,
      budget_to_date: grossMarginBudget,
      budget_to_date_display: formatMoneyWhole(grossMarginBudget),
      // Kevin Prompt 2 PR-B (2026-09-04): budget_full_period for the
      // Planning view. GM's full-period budget is revenue_full_period
      // minus cogs_full_period - the same accounting relationship the
      // cards above express, restated on the margin card.
      budget_full_period: (revenue_budget_full_period != null)
        ? r2(revenue_budget_full_period - cogsBudget)
        : null,
      budget_full_period_display: (revenue_budget_full_period != null)
        ? formatMoneyWhole(r2(revenue_budget_full_period - cogsBudget))
        : null,
      pct_of_revenue: gmPctActual,
      pct_of_revenue_display: formatPct(gmPctActual),
      // PR-1 item 1: null target when !has_target.
      target_pct_of_revenue: has_target ? gmPctBudget : null,
      target_pct_display: has_target ? formatPct(gmPctBudget) : null,
      // Kevin ruling final-presentation (2026-09-03) item 2: GM card
      // carries a target dollar beside the target percent. Derived as
      // revenue - cogs_budget_at_this_revenue so the value agrees by
      // construction with the cost table's plan column + COGS card's
      // target dollar. Null when has_target is false.
      budget_at_this_revenue: (has_target && totalRevenue != null)
        ? r2(totalRevenue - budgetAtThisRevenue(cogsBudget))
        : null,
      budget_at_this_revenue_display: (has_target && totalRevenue != null)
        ? formatMoneyWhole(r2(totalRevenue - budgetAtThisRevenue(cogsBudget)))
        : null,
      delta_dollars: gmDelta,
      delta_display: gmDelta != null ? gapDollarsMargin(gmDelta) : null,
      delta_direction: gmDelta != null ? directionOfDelta(gmDelta, "margin") : null,
      delta_pct_display: (has_target && gmPctActual != null && gmPctBudget != null) ? gapPointsMargin(gmPctActual - gmPctBudget) : null,
      pill: (() => {
        // PR-1 item 1: rolling window -> "No target", neutral tone.
        if (!has_target) return { label: "No target", tone: "neutral" };
        // Kevin R-92 (2026-09-09). On a running single period the
        // margin verdict is HELD - margin needs both sides and cost
        // is not confirmed. Pill names what the card is waiting on.
        if (isRunningSinglePeriod) return { label: "Waiting on cost", tone: "neutral" };
        // Kevin walkthrough sweep item 6 (2026-09-07). Split the No
        // data case: if target exists but actual is a real number and
        // gmPctActual can't compute (needs revenue as denominator),
        // don't lie "No data" over a shown dollar hero. Same rule as
        // cost.
        if (gmPctActual == null && grossMargin != null) return { label: "cost, no revenue yet", tone: "neutral" };
        if (gmPctActual == null || gmPctBudget == null) return { label: "No data", tone: "neutral" };
        // Kevin post-1060 sweep (2026-09-09): pill drops the percent
        // figure. Cost + margin cards now carry a variance footer
        // with dollar arrow/amount; the pill scans identically to
        // revenue's ("above projection" / "below projection") and
        // labor's ("Over target" / "On target"). Prior form:
        // "0.7% AHEAD" / "0.7% BEHIND". New form: state words only.
        return gmPctActual >= gmPctBudget
          ? { label: "ahead of target", tone: "good" }
          : { label: "behind target", tone: "bad" };
      })(),
    },
  ];

  // 16. Levers - the four COGS lines with actual + budget + variance +
  //     pct-of-rev + target-pct + vs-target.
  // 2026-09-01 defect fix: buildLever takes budgetToDate for the
  // target-pct denominator alignment. `budget` stays the full-period
  // figure for the variance dollars + budget_display; `budgetToDate`
  // is used exclusively for the target-pct ratio so both sides of
  // the ratio share the same horizon.
  const buildLever = (label, code, actual, budget, budgetToDate) => {
    const actualPct = pctOf(actual, totalRevenue);
    // PR-1 item 1 (2026-09-02): target_pct = budget/budget on full-
    // period sums. Horizon-invariant across FYTD.
    const targetPct = has_target ? pctOf(budget, revenue_budget_full_period) : null;
    const dv = actual != null && budget != null ? r2(actual - budget) : null;
    // PR-1 item 2 (2026-09-02): envelope + budget-at-this-revenue per
    // lever so PR-2's cost-lines table can render them per row.
    const batr = budgetAtThisRevenue(budget);
    return {
      line_code: code,
      label,
      actual,
      actual_display: formatMoneyWhole(actual),
      budget,
      budget_display: formatMoneyWhole(budget),
      variance_dollars: dv,
      variance_display: dv != null ? gapDollarsCost(dv) : null,
      actual_pct: actualPct,
      actual_pct_display: formatPct(actualPct),
      target_pct: targetPct,
      target_pct_display: has_target ? formatPct(targetPct) : null,
      variance_pct: (has_target && actualPct != null && targetPct != null) ? r2(actualPct - targetPct) : null,
      variance_pct_display: (has_target && actualPct != null && targetPct != null) ? gapPointsCost(actualPct - targetPct) : null,
      budget_at_this_revenue: batr,
      // R-58/R-59: MF accounts get null envelope (contractual revenue).
      envelope_delta: isManagementFee ? null : envelopeDelta(budgetToDate, batr),
      direction: dv != null ? directionOfDelta(dv, "cost") : null,
      flag: code === "3400" && flags.packaging_gap ? "mapping_gap" : null,
    };
  };
  const levers = [
    buildLever("Kitchen labor",          "3100", labor3100_actual,  labor3100_budget,  labor3100_budget_to_date_days),
    buildLever("Food purchased",         "3200", food_actual,       food_budget,       food_budget_to_date_days),
    buildLever("Packaging and supplies", "3400", packaging_actual,  packaging_budget,  packaging_budget_to_date_days),
    buildLever("Vehicle",                "3500", vehicle_actual,    vehicle_budget,    vehicle_budget_to_date_days),
  ];

  // 17. Chart series. Period grain for FYTD; week grain for a single
  //     period. Weeks come from the purchasing weekly view + labor
  //     week aggregates.
  let chart;
  if (rng.kind === "period") {
    // Week grain. Iterate the weeks in the period and read from both
    // engines' per-week outputs where present.
    const laborWeeks = new Map();
    for (const w of laborBoard?.weeks || []) {
      laborWeeks.set(w.week_start, Number(w.spent || 0));
    }
    // Purchasing weekly per bucket already; sum food+packaging+vehicle
    // for the aggregate COGS view.
    const purchWeekMap = new Map();
    for (const key of ["3200", "3400", "3500"]) {
      const bucket = purchBoard.buckets[key];
      if (!bucket?.week_series) continue;
      for (const w of bucket.week_series) {
        purchWeekMap.set(w.week_start, (purchWeekMap.get(w.week_start) || 0) + Number(w.amount || 0));
      }
    }
    const weekStarts = weekStartsInRange(rng.start, rng.end);
    // Kevin PR-B item 5 (2026-09-03): the weekly budget line is drawn
    // from the ADJUSTED budget (cogs.budget_at_this_revenue) divided
    // by COMPLETE weeks in the range - same figure the cost card
    // displays as its target, and the same rule the FYTD per-period
    // dashes already follow. Prior formula (period_budget / 4) was
    // off by ~$780/wk on TBJ - FL P9 because it used the un-adjusted
    // period budget and divided by every week (not just complete
    // ones). Closed ranges reduce to the same answer (all weeks
    // complete, revenue is settled).
    const budAtRev = has_target ? budgetAtThisRevenue(cogsBudget) : null;
    const closedWeeksCount = weekStarts.filter(ws => {
      const wEnd = new Date(new Date(ws + "T00:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
      return wEnd < today;
    }).length;
    const wkBudget = (budAtRev != null && closedWeeksCount > 0)
      ? r2(budAtRev / closedWeeksCount)
      : (laborBoard?.applies && laborBoard.range_budget != null
          ? r2((laborBoard.range_budget + (purchBoard.totals.buckets_budget || 0)) / weekStarts.length)
          : null);
    const series = weekStarts.map(ws => {
      const laborS = laborWeeks.get(ws) || 0;
      const purchS = purchWeekMap.get(ws) || 0;
      const total = r2(laborS + purchS);
      const wEnd = new Date(new Date(ws + "T00:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const state = wEnd < today ? "closed" : (ws <= today && today <= wEnd) ? "in_progress" : "not_started";
      return {
        week_start: ws,
        week_end: wEnd,
        state,
        spent: state === "not_started" ? null : total,
        budget: wkBudget,
      };
    });
    // Kevin ruling this-period (2026-09-03) item 5: the RUNNING week
    // draws hatched with its partial cost from labor + purchasing
    // (Service Calendar deliberately does not carry data past effective
    // end; labor + purchasing do). The cost card stays at closed-weeks
    // only via R-63 effectiveEndISO capping - so this partial sits
    // OUTSIDE the tie between closed-bar sum and cost card actual.
    // Targeted secondary query for the running week only; keeps every
    // other loader capped and the tie invariant load-bearing.
    const runningIdx = series.findIndex(s => s.state === "in_progress");
    if (runningIdx >= 0 && lastCompleteWk && effectiveEndISO < rng.end) {
      const rw = series[runningIdx];
      // R-68 (2026-09-04): salary is always composed into the chart
      // series (labor is always salary-inclusive per Kevin's ruling).
      const [rwLabor, rwPurch, rwSalary] = await Promise.all([
        paginateLaborActuals(supa, { members, start: rw.week_start, end: rw.week_end }),
        paginatePurchasingWeekly(supa, { members, start: rw.week_start, end: rw.week_end }),
        loadSalaryActuals(supa, members, rw.week_start, rw.week_end),
      ]);
      let laborSum = 0;
      for (const r of (rwLabor.data || [])) laborSum += Number(r.amount || 0);
      let purchSum = 0;
      for (const r of (rwPurch.data || [])) {
        const b = String(r.gl_bucket || "");
        if (b === "3200" || b === "3400" || b === "3500") {
          purchSum += Number(r.amount || 0);
        }
      }
      let salarySum = 0;
      for (const r of (rwSalary.rows || [])) salarySum += Number(r.amount || 0);
      series[runningIdx] = { ...rw, spent: r2(laborSum + purchSum + salarySum) };
    }
    // C13 (2026-09-01): bar hover leads with the period + its dates.
    // The chart carries the period_no so the tooltip header can read
    // "Period 9 · Week 2" rather than the standalone "Week 2" the
    // prior render used - naming the period + the week is what makes
    // the tooltip legible on FYTD screenshots where the period is
    // otherwise off-screen.
    // Item 5 tail: expose the running week's 1-based index so the
    // chart header can say "week N in progress, not yet counted"
    // beside the weeks-closed pill.
    const runningWeekNo = runningIdx >= 0 ? runningIdx + 1 : null;
    chart = { grain: "week", series, weekly_budget: wkBudget, period_no: rng.period_no, running_week_no: runningWeekNo };
  } else {
    // Period grain for FYTD or explicit range - build one point per
    // fiscal period in the range.
    const laborByPeriod = new Map();
    for (const w of laborBoard?.weeks || []) {
      const p = periodOf(w.week_start);
      if (p != null) laborByPeriod.set(p, (laborByPeriod.get(p) || 0) + Number(w.spent || 0));
    }
    const purchByPeriod = new Map();
    for (const key of ["3200", "3400", "3500"]) {
      const bucket = purchBoard.buckets[key];
      if (!bucket?.week_series) continue;
      for (const w of bucket.week_series) {
        const p = periodOf(w.week_start);
        if (p != null) purchByPeriod.set(p, (purchByPeriod.get(p) || 0) + Number(w.amount || 0));
      }
    }
    // Kevin walkthrough sweep item 4 (2026-09-07). Inventory adjusting
    // JEs (R-61) were applied to the COGS card total but not to the
    // chart's per-period bars. On Last period (single period), the fix
    // that landed at the account level happens to net to the same
    // figure because sum-over-one-period equals the whole; on This year
    // (multi-period), the chart's sum-of-bars differs from the card by
    // the total JE sum. Measured live 2026-09-07:
    //   TBJ - FL  bars vs card off by  $3,842
    //   TBR - FL                       $11,693
    //
    // Fix: build per-period inventory-adjustment map from invAdjByAcct
    // and subtract from chart spent, mirroring the card's
    // `adjusted_cost = purchases - adjusting_je` derivation (see
    // pnl-loader.js line 123). 3200 + 3400 only per R-61.
    const invAdjByPeriod = new Map();
    for (const acct of members) {
      const byAcct = invAdjByAcct.get(acct);
      if (!byAcct) continue;
      for (const [pn, byLine] of byAcct) {
        let periodJe = 0;
        for (const [gl, je] of byLine) {
          if (gl === "3200" || gl === "3400") periodJe += Number(je || 0);
        }
        if (periodJe !== 0) invAdjByPeriod.set(pn, (invAdjByPeriod.get(pn) || 0) + periodJe);
      }
    }
    // Kevin walkthrough sweep addendum F (2026-09-07). Labor's Tier A
    // strip hatches the unapproved portion within each bar (see PR
    // #1034); the Overview's cost-of-goods chart is showing the same
    // labor hours in its aggregate spent and needs the same
    // treatment. Compute per-period unapproved-labor dollars from
    // labor board weeks (draft_hours × avg_rate) so the chart can
    // render a hatched slice inside each bar sized to the ratio.
    const laborRate = Number(laborBoard?.avg_rate || 0);
    const unappLaborByPeriod = new Map();
    if (laborRate > 0) {
      for (const w of laborBoard?.weeks || []) {
        const p = periodOf(w.week_start);
        if (p == null) continue;
        const dh = Number(w.draft_hours || 0);
        if (dh > 0.004) unappLaborByPeriod.set(p, (unappLaborByPeriod.get(p) || 0) + dh * laborRate);
      }
    }
    // Kevin 2026-09-02 language pass Item 15: each period's budget
    // line is that period's ADJUSTED budget - period actual revenue
    // times the target cost percentage. Same rule as the COGS card's
    // "Adjusted budget" figure. A period where revenue missed gets a
    // lower budget line.
    //
    // Kevin post-1049 sweep item 5b (2026-09-07): the ratio must be
    // PER-PERIOD, never the annual one applied to every period.
    // Prior code used the range-level ratio (cogsBudget /
    // revenue_budget_full_period) which produced $67,998 for TBJ - FL
    // P9 (51.5% annual) when P9's own budget says $79,227 (60.0%
    // period-own) - an $11,229 gap that flipped P9's bar red when
    // it should be green. Now uses computePeriodTargetPctForLines
    // from the shared module - the SAME derivation Last period's
    // single-period view uses, so the two agree by construction.
    const series = periods.map(p => {
      const pStart = periodStartISO(p);
      const pEnd = periodEndISO(p);
      const state = pEnd < today ? "closed" : (pStart <= today && today <= pEnd) ? "in_progress" : "not_started";
      // Period budget = sum of member budget + purchasing bucket
      // budget for this one period. Labor budget is the MERGED
      // (hourly + salary) figure per R-28 / §5.9 - the chart line
      // matches the composed labor total the levers surface.
      const laborBudP = laborBudgetSumMapMerged.get(p) || 0;
      // Purchasing per-period budget: sum through kpi_budgets purchase
      // lines. Not directly available on purchBoard.totals per-period,
      // but we can compute from purchBudgets map for the three
      // buckets.
      let purchBudP = 0;
      const purchLineKeys = typeof purchBudgets?.keys === "function" ? [...purchBudgets.keys()] : Object.keys(purchBudgets || {});
      for (const gl of purchLineKeys) {
        const glStr = String(gl);
        if (!(glStr.startsWith("3200") || glStr.startsWith("3400") || glStr.startsWith("3500"))) continue;
        const perLine = typeof purchBudgets.get === "function" ? purchBudgets.get(gl) : purchBudgets[gl];
        if (!perLine) continue;
        for (const m of members) {
          if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
          const byAcct = typeof perLine.get === "function" ? perLine.get(m) : perLine[m];
          if (!byAcct) continue;
          const v = typeof byAcct.get === "function" ? byAcct.get(p) : (byAcct[p] ?? byAcct[String(p)]);
          if (v != null) purchBudP += Number(v);
        }
      }
      // Per-period revenue: sum across the 5 revenue lines from
      // perPeriodRevenue map. reported=false rows contribute 0.
      const pRev = perPeriodRevenue.get(p);
      let periodRevenueActual = 0;
      if (pRev) {
        for (const line of REVENUE_LINE_CODES) {
          const rec = pRev[line];
          if (rec?.reported && rec.amount != null) periodRevenueActual += Number(rec.amount);
        }
      }
      // Kevin post-1049 sweep item 5b: PER-PERIOD target ratio, not
      // annual. Numerator = period's own cogs budget (labor + purch
      // + inventory adjustment sign parity), denominator = period's
      // revenue budget (sum of REVENUE_LINE_CODES from overviewBudgets).
      // Adjusted budget = period revenue actual × period target pct.
      let periodRevBudget = 0;
      let anyRevBud = false;
      for (const rline of REVENUE_LINE_CODES) {
        const perR = overviewBudgets.get(rline);
        if (!perR) continue;
        for (const m of members) {
          const byAcct = perR.get(m);
          if (!byAcct) continue;
          const v = byAcct.get(p);
          if (v != null) { periodRevBudget += Number(v); anyRevBud = true; }
        }
      }
      const perPeriodCogsBudget = laborBudP + purchBudP;
      const perPeriodTargetPct = (anyRevBud && periodRevBudget > 0 && perPeriodCogsBudget > 0)
        ? (perPeriodCogsBudget / periodRevBudget)
        : null;
      const adjustedBudget = (perPeriodTargetPct != null && periodRevenueActual > 0)
        ? r2(periodRevenueActual * perPeriodTargetPct)
        : null;
      return {
        period_no: p,
        state,
        // Kevin walkthrough item 4 - subtract inventory-adjustment JE
        // so the chart's per-period bars sum to the card total.
        spent: state === "not_started" ? null : r2((laborByPeriod.get(p) || 0) + (purchByPeriod.get(p) || 0) - (invAdjByPeriod.get(p) || 0)),
        budget: r2(laborBudP + purchBudP),
        // Item 15: adjusted per-period budget for the chart's target
        // line. `budget` above is retained for legacy consumers.
        revenue_actual: r2(periodRevenueActual),
        adjusted_budget: adjustedBudget,
        // Kevin walkthrough sweep addendum F (2026-09-07) - per-period
        // unapproved-labor dollars, so the chart can render a hatched
        // slice within the bar. Same math the Labor Tier A strip uses.
        unapproved_labor_dollars: state === "not_started" ? null : r2(unappLaborByPeriod.get(p) || 0),
      };
    });
    chart = { grain: "period", series };
  }

  // 17b. Week rail (Kevin CC prompt 2026-09-08 item 4). Four cards
  // below the three, showing each week's confirmed / forecast meals
  // + prorated service fee + cost target + cost landed + caveats.
  // Running single-period only; null everywhere else.
  //
  // Data source: Path B (Kevin ruling). Structural parity with
  // Labor comes from calling Labor's buildBoard a second time with
  // end=rng.end (not effectiveEndISO, which caps at the last complete
  // week on later dates in a period). One buildBoard call = one
  // computation. Composing per-week from separate labor / SC /
  // purchasing sources is exactly how the two boards drifted apart
  // before; Path B refuses that.
  //
  // Purchasing per-week comes from purchBoard.buckets (already in
  // scope). Only the labor+salary side needs the extra fetch.
  let week_rail = null;
  if (isRunningSinglePeriod && rng.period_no != null) {
    // Approach A (Kevin ruling 2026-09-08 item 3): rail's labor +
    // salary fetches moved into layer1_parallel, gated on
    // willBeRunningSinglePeriod. When the calendar gate agreed
    // with the real state (~always in practice - divergence warned
    // above) the results are already in hand. The false-positive
    // divergence case (gate true, state !open) never reaches here
    // because this branch keys off isRunningSinglePeriod itself.
    const railLaborActuals = railLaborActualsResp;
    const railSalaryActuals = railSalaryActualsResp;
    const railSalaryShaped = (railSalaryActuals?.rows || []).map(shapeSalaryRow);
    const railMergedLabor = (railLaborActuals?.data || []).concat(railSalaryShaped);
    const railBoard = buildBoard({
      account: accountKey,
      start: rng.start,
      end: rng.end,
      today,
      actuals: railMergedLabor,
      budget_periods: laborBudgetPeriods,
      account_state: "hourly_ok",
      workerToEmail,
    });
    // Attach the SC weekly basis so each week carries revenue_basis
    // + week_actual_revenue + week_projected_revenue. Uses the same
    // runningWkBasis fetched for R-92 above (hoisted so both consume
    // one query).
    if (railBoard?.applies !== false && runningWkBasis?.data?.length) {
      const railLineTargetPct = computeLineTargetPctByPeriod({
        budgetPeriods: laborBudgetPeriods,
        overviewBudgets,
        members,
        periods: [rng.period_no],
      });
      const railContractualAccrual = computeContractualAccrualByPeriod({
        overviewBudgets,
        members,
        periods: [rng.period_no],
      });
      attachWeeklyBasisToBoard(railBoard, runningWkBasis, {
        lineTargetPctByPeriod: railLineTargetPct,
        todayISO: today,
        contractualAccrualByPeriod: railContractualAccrual,
        verifiedPeriodTotals: null,
      });
    }
    // Purchasing per-week (3200 + 3400 + 3500), indexed by
    // week_start. Same three buckets the chart's week grain uses.
    const railPurchByWeek = new Map();
    for (const key of ["3200", "3400", "3500"]) {
      const bucket = purchBoard.buckets[key];
      if (!bucket?.week_series) continue;
      for (const w of bucket.week_series) {
        railPurchByWeek.set(w.week_start, (railPurchByWeek.get(w.week_start) || 0) + Number(w.amount || 0));
      }
    }
    // Fee prorated by week. 2300 budget / 4 flat per week; the
    // period-level accrual (confirmedWeeks × fee/4) lives on the
    // revenue card hero; this per-week figure is contractual and
    // the same on every week regardless of state.
    const feeBudgetByPeriod = sumBudgetByPeriodForLine({
      overviewBudgets, lineCode: "2300", members,
    });
    const feePerWeek = Number(feeBudgetByPeriod.get(rng.period_no) || 0) / 4;
    // Period COGS target% - used for cost_target per week
    // (week_revenue × target%). Same figure the cost card displays.
    const cogsTargetPct = (cogsBudget != null && revenue_budget_full_period != null && revenue_budget_full_period > 0)
      ? (cogsBudget / revenue_budget_full_period) * 100
      : null;
    const runningWeekNoOut = (lastCompleteWk?.weekNo ?? 0) + 1;
    const rows = (railBoard?.weeks || []).map((w, i) => {
      const wkNo = i + 1;
      // Meal revenue: confirmed weeks use SC actual; forecast weeks
      // use projected. `week_actual_revenue` and `week_projected_
      // revenue` are attached by attachWeeklyBasisToBoard.
      const mealRev = w.revenue_basis === "confirmed"
        ? Number(w.week_actual_revenue || 0)
        : Number(w.week_projected_revenue || 0);
      const weekRevTotal = mealRev + feePerWeek;
      const costTarget = cogsTargetPct != null ? weekRevTotal * (cogsTargetPct / 100) : null;
      const laborSpent = Number(w.spent || 0);
      const purchSpent = Number(railPurchByWeek.get(w.week_start) || 0);
      return {
        week_no: wkNo,
        week_start: w.week_start,
        week_end: w.week_end,
        state: w.state,                           // "closed" | "in_progress" | "not_started"
        revenue_basis: w.revenue_basis || null,   // "confirmed" | "forecast" | null
        meal_revenue: r2(mealRev),
        fee_prorate: r2(feePerWeek),
        week_revenue: r2(weekRevTotal),
        cost_target: costTarget != null ? r2(costTarget) : null,
        cost_landed: r2(laborSpent + purchSpent),
        labor_landed: r2(laborSpent),
        purchasing_landed: r2(purchSpent),
        unapproved_hours: Number(w.unapproved_hours || 0),
      };
    });
    week_rail = {
      period_no: rng.period_no,
      running_week_no: runningWeekNoOut,
      // Kevin ruling: invoice-landed state derives from the week
      // index, not from a date string. Client applies:
      //   invoices_landed = (running_week_no - week_no) >= 2
      // for each week's caveat line. Two-week rule holds at the
      // boundary by construction.
      weeks: rows,
    };
  }

  // 18. Statement rows (per-line P&L) and also-tracked rows.
  const statementRows = [];
  // Revenue section
  //
  // actual_pct / target_pct additions (2026-08-31, engine follow-up):
  // Revenue rows previously carried only variance_pct, so the client
  // rendered a dash on pct-of-revenue for each revenue line even when
  // the row was reported. That reads as "no data" on a money surface
  // where data does exist (e.g. 2400.1 is genuinely 68.1% of revenue).
  // Emit the ratio here, mirroring the lever-row convention:
  //   - fraction returned by pctOf is a percent number (e.g. 68.1),
  //     not 0.681 - same shape as levers[].actual_pct.
  // Absence contract propagated:
  //   - reported=false                     -> actual_pct = null
  //   - reported=true, totalRevenue = 0    -> actual_pct = null (pctOf
  //     returns null when denominator is 0)
  //   - reported=true, actual = 0          -> actual_pct = 0
  // Same rules apply to target_pct against the revenue budget-to-date.
  for (const line of REVENUE_LINE_CODES) {
    const rev = revenueByLine[line];
    const byPeriod = sumBudgetByPeriodForLine({ overviewBudgets, lineCode: line, members });
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today, throughISO: effectiveEndISO });
    const fp = computeFullPeriodBudget({ budgetByPeriod: byPeriod, periodsInRange: periods });
    // E17 (2026-09-01): a revenue line the account does not run (no
    // budget, no actual) reads `inactive`, not a $0 variance. The
    // contractual flag on the fee account's 2400.1 takes precedence
    // - a fee account IS running that line, the ratio is just always
    // 100%.
    const isContractual = isFeeAccount && line === "2400.1";
    const noBudget = fp == null || fp === 0;
    const noActual = !rev.reported || rev.amount == null || rev.amount === 0;
    const inactive = !isContractual && noBudget && noActual;
    // PR-1 item 6 (2026-09-02): on the sc_counts_without_dollars
    // path, the 2400.1 line is an absence (service days on the
    // calendar, no counts entered). Override reported/actual to
    // null with the diagnostic flag so the P&L reads honestly.
    const scAbsent = sc_counts_without_dollars && line === "2400.1";
    const suppress = inactive;
    const rowActualPct = (!inactive && !scAbsent && rev.reported) ? pctOf(rev.amount, totalRevenue) : null;
    const rowTargetPct = (!inactive && bto.amount != null) ? pctOf(bto.amount, revenue_budget_to_date) : null;
    statementRows.push({
      line_code: line,
      section: "revenue",
      label: labelForLine(line),
      reported: !inactive && !scAbsent && rev.reported,
      actual: (!inactive && !scAbsent && rev.reported) ? rev.amount : null,
      budget_to_date: inactive ? null : bto.amount,
      period_budget: inactive ? null : fp,
      variance: (!suppress && !scAbsent && rev.reported && bto.amount != null) ? r2(rev.amount - bto.amount) : null,
      variance_pct: (!suppress && !scAbsent && rev.reported && bto.amount != null && bto.amount > 0) ? r2(((rev.amount - bto.amount) / bto.amount) * 100) : null,
      actual_pct: rowActualPct,
      target_pct: rowTargetPct,
      // PR-1 item 5 (2026-09-02): provisional flag keyed on
      // revenue_source_state, not period_state. Once counts are live
      // for an account, revenue to date is real actual and the
      // variance is settled - no "provisional" suffix. Verified
      // periods are also settled. Only the planned path is amber.
      provisional: revenue_source_state === "planned",
      sources: rev.sources,
      flags: [
        ...(isContractual ? ["contractual"] : []),
        ...(inactive ? ["inactive"] : []),
        ...(scAbsent ? ["sc_counts_without_dollars"] : []),
      ],
    });
  }
  // COGS section
  // E17 (2026-09-01): 3100 is inactive when both actual and budget
  // are absent (labor board didn't apply, or the account genuinely
  // ran no labor in range). Salaried-only D26 accounts return
  // applies=false from buildBoard, so labor3100_actual is null - we
  // don't want that to render as "$0 under".
  const labor3100_inactive =
    (labor3100_actual == null || labor3100_actual === 0) &&
    (labor3100_budget == null || labor3100_budget === 0);
  {
    // PR-1 item 3 (2026-09-02): backfill actual_pct + target_pct on
    // the 3100 statement row so the P&L Target % column stops
    // rendering dashes. Same budget/budget rule the cards use.
    const _actPct = pctOf(labor3100_actual, totalRevenue);
    // PR-1 item 1: budget/budget on full-period sums (horizon-invariant).
    const _tgtPct = has_target ? pctOf(labor3100_budget, revenue_budget_full_period) : null;
    const _batr = budgetAtThisRevenue(labor3100_budget);
    statementRows.push({
      line_code: "3100",
      section: "cogs",
      label: "Kitchen labor",
      reported: !labor3100_inactive && laborBoard?.applies === true,
      actual: labor3100_actual,
      budget_to_date: labor3100_budget_to_date_days,
      period_budget: labor3100_budget,
      // Kevin ruling 2026-09-03 (BLOCKER): row variance must share
      // the reference with the row's percent gap. Measured against
      // budget_at_this_revenue - not budget_to_date - so the dollar
      // and percent columns on the same row agree in sign.
      variance: (!labor3100_inactive && labor3100_actual != null && _batr != null) ? r2(labor3100_actual - _batr) : null,
      variance_pct: (has_target && !labor3100_inactive && _actPct != null && _tgtPct != null) ? r2(_actPct - _tgtPct) : null,
      actual_pct: labor3100_inactive ? null : _actPct,
      target_pct: labor3100_inactive ? null : _tgtPct,
      budget_at_this_revenue: labor3100_inactive ? null : _batr,
      // R-58/R-59: MF accounts null out envelope (contractual revenue).
      envelope_delta: (labor3100_inactive || isManagementFee) ? null : envelopeDelta(labor3100_budget_to_date_days, _batr),
      sources: ["labor_actuals"],
      flags: labor3100_inactive ? ["inactive"] : [],
    });
  }
  // Salary reveal (R-28 / §5.9): emit 3100.1 (hourly) + 3100.2
  // (salary) sub-rows under 3100 when the caller requested the salary
  // split AND the posture makes it visible. The rows carry
  // `parent_line_code: "3100"` so the client renders them indented
  // beneath the aggregate. The 3100 total row above is unchanged -
  // the totals never move; the split just becomes visible.
  //
  // 2026-08-31 (blocker 1 fix): salary is now composed into the 3100
  // total ON EVERY REQUEST (see step 5 above where laborBoard is built
  // on merged hourly + salary actuals + budgets). The `includeSalary`
  // flag is purely a DISCLOSURE control here - toggle ON reveals the
  // sub-rows, toggle OFF hides them; the 3100 total is byte-identical
  // in both states. This is the fix for Kevin's live measurement
  // (CIN - AZ FYTD showing 61.2% GM against a 54.4% target because
  // labor was hourly-only, missing $129,615.58 of salary).
  //
  // Absence contract: reported=false on any sub-row we cannot ground
  // in pnl_actuals. The client renders "-" (missing) rather than
  // guessing.
  if (includeSalary && access.salary_toggle_visible) {
    // Kevin ruling final-P&L (2026-09-03) item 3: source both
    // sub-rows from the SAME engine that produces the parent. The
    // parent `3100` reads laborBoard.spent_to_date, which is the
    // sum of hourly (laborActuals) + salary (salaryRows) after the
    // R-63 effectiveEnd cap. Previously the sub-rows read pnl_actuals
    // directly, so 3100.1 + 3100.2 did not sum to 3100 (TBJ - FL
    // FYTD was $2,532 off - a defect finance would find on the
    // first read). Sourcing from the same engine ties them by
    // construction.
    const sumRows = (rows, field = "amount") => {
      let amt = 0;
      let anyReported = false;
      for (const r of rows || []) {
        const v = r?.[field];
        if (v != null) {
          amt += Number(v);
          anyReported = true;
        }
      }
      return anyReported ? r2(amt) : null;
    };
    const hourly = sumRows(laborActuals || [], "amount");
    const salary = sumRows(salaryRows || [], "amount");
    // Kevin ruling final-P&L (2026-09-03) item 3: budgets must sum
    // to parent too. Use the SAME inputs the labor engine consumes
    // to build laborBudgetPeriods (parent's input):
    //   hourly = laborBudgetPeriodsHourly (pre-merge; resolveMemberBudget
    //            output; on revenue-flex accounts this is the SC-derived
    //            hourly budget, NOT the kpi_budgets_overview 3100.1
    //            line - which is why the sub-row previously diverged
    //            from the parent on TXR - TX - H by $30k).
    //   salary = salaryBudgetByPeriod (aggregate map)
    // Both feed computeBudgetToDateDays (labor engine's helper) so the
    // same days-elapsed math applies to sub-rows and parent.
    const salaryBudgetPeriodsArr = [...salaryBudgetByPeriod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([p, amt]) => ({ period_no: p, amount: r2(amt) }));
    const hourlyBTDLabor = computeLaborBudgetToDateDays({
      budget_periods: laborBudgetPeriodsHourly,
      start: rng.start,
      end: effectiveEndISO,
      today,
      throughISO: effectiveEndISO,
    });
    const salaryBTDLabor = computeLaborBudgetToDateDays({
      budget_periods: salaryBudgetPeriodsArr,
      start: rng.start,
      end: effectiveEndISO,
      today,
      throughISO: effectiveEndISO,
    });
    const hourlyBTD = { amount: hourlyBTDLabor.amount };
    const salaryBTD = { amount: salaryBTDLabor.amount };
    // Period-budget (full range budget) computed from the same per-
    // period inputs so it stays consistent with budget_to_date.
    const sumPeriodBudget = (arr) => arr.reduce((acc, bp) => {
      if (periods.includes(bp.period_no)) return acc + Number(bp.amount || 0);
      return acc;
    }, 0);
    const hourlyPB = r2(sumPeriodBudget(laborBudgetPeriodsHourly));
    const salaryPB = r2(sumPeriodBudget(salaryBudgetPeriodsArr));
    // Kevin ruling final-P&L (2026-09-03) item 4: sub-rows gain
    // Target % and Adjusted so the split can be judged on the same
    // axis as the parent. Both are computable and both sum to the
    // parent's figures by construction. "The parent says labour is
    // $10,504 over - mild. The split says hourly is roughly $36,581
    // over and salary roughly $26,077 under. They partly cancel and
    // the parent hides both."
    //
    // Hourly (3100.1) is measured as a percent of revenue - it's the
    // controllable line. Salary (3100.2) is fixed at hire and does
    // NOT track revenue; Kevin's item 5 says salary sub-rows and
    // tracked lines hatch the Target % + Adjusted cells (not-
    // applicable, marked with flags:["not_applicable"]).
    const hourlyTargetPct = has_target ? pctOf(hourlyBTD.amount || hourlyPB, revenue_budget_full_period) : null;
    const hourlyBatr = (has_target && totalRevenue != null && hourlyTargetPct != null)
      ? r2((hourlyTargetPct / 100) * totalRevenue)
      : null;
    statementRows.push({
      line_code: "3100.1",
      section: "cogs",
      parent_line_code: "3100",
      label: "Hourly wages",
      reported: hourly != null,
      actual: hourly,
      budget_to_date: hourlyBTD.amount,
      period_budget: hourlyPB,
      // Item 6: variance ties. Cost sub-rows measure against Adjusted.
      variance: (hourly != null && hourlyBatr != null) ? r2(hourly - hourlyBatr) : null,
      variance_pct: null,
      actual_pct: pctOf(hourly, totalRevenue),
      target_pct: hourlyTargetPct,
      budget_at_this_revenue: hourlyBatr,
      sources: ["labor_actuals"],
      flags: [],
    });
    statementRows.push({
      line_code: "3100.2",
      section: "cogs",
      parent_line_code: "3100",
      label: "Salary wages",
      reported: salary != null,
      actual: salary,
      budget_to_date: salaryBTD.amount,
      period_budget: salaryPB,
      // Salary is fixed - variance is dollar over/under the salary
      // BUDGET, not against a % of revenue. Emit against budget_to_date
      // so the P&L variance column still ties for the sub-row without
      // needing an Adjusted figure that doesn't apply.
      variance: (salary != null && salaryBTD.amount != null) ? r2(salary - salaryBTD.amount) : null,
      variance_pct: null,
      actual_pct: pctOf(salary, totalRevenue),
      target_pct: null,
      budget_at_this_revenue: null,
      sources: ["labor_salary_actuals"],
      // Item 5: salary sub-rows are not measured on % of revenue;
      // hatch the Target % and Adjusted cells in the P&L.
      flags: ["not_applicable_target_pct"],
    });
  }
  // 2026-09-01 polish PR (E16 + E17): tagging + verdict suppression
  // on cost-section statement rows.
  //
  // E16 billed_back: on pass-through accounts (CIN - OH, STL - MO,
  // STL - FL) food + packaging are the client's cost, billed back on
  // the reimbursable line. Rendering a red "over target" verdict on
  // $37 of packaging against a $0 budget was the specific defect
  // Kevin flagged - the purchasing board's own §5.6 rule (no verdict
  // on billed-back lines) applied to the Overview statement too.
  // Cost rows on pass-through accounts carry `billed_back: true`,
  // variance NULL, no target/actual pct. Client renders a tag + no
  // percentage.
  //
  // E17 inactive: a cost line with no budget AND no actual (or
  // actual=0) is not a saving - it is a line the account does not
  // run at all. Cost rows with (budget == null || budget == 0) AND
  // (actual == null || actual == 0) carry `inactive: true`, variance
  // NULL. Client renders "not active".
  //
  // Bill-back takes precedence: on a pass-through account with a
  // real $37 packaging charge and a $0 budget, the row is billed_
  // back (client's cost), not inactive (line the account doesn't
  // run).
  const isCostInactive = (actual, budget) => {
    const noBudget = budget == null || budget === 0;
    const noActual = actual == null || actual === 0;
    return noBudget && noActual;
  };
  // PR-1 item 3 (2026-09-02): map line_code to its per-bucket
  // budget-to-date-days so the cost row can ship actual_pct +
  // target_pct without dashes. buildCostRow already runs for 3200 /
  // 3400 / 3500, each with a full-period `budget`; the resolver
  // already prorates each via bucketsToDateRatio above. Reuse those.
  const perBucketBudgetToDate = {
    "3200": food_budget_to_date_days,
    "3400": packaging_budget_to_date_days,
    "3500": vehicle_budget_to_date_days,
  };
  // Kevin R-61 (2026-09-03): inventory status - card 1 states
  // whether the range is `Inventory actualized` (every finalised
  // period on every applicable member has at least one JE row) or
  // `Pending inventory` (any finalised period lacks one). Only
  // applicable to accounts that CAN carry inventory (per-meal /
  // sales-based). Management-fee + pass-through accounts (billed-
  // back food) never carry inventory; status is null on those.
  const inventoryApplicable = !isAggregate && !isPassThrough && !isFeeAccount;
  const inventory_status = (() => {
    if (!inventoryApplicable) return null;
    if (finalisedPeriods.length === 0) return null;
    let allActualized = true;
    const pendingPeriods = [];
    for (const p of finalisedPeriods) {
      let hasAny = false;
      for (const m of members) {
        const byPeriod = invAdjByAcct.get(m);
        if (byPeriod && byPeriod.get(p)) { hasAny = true; break; }
      }
      if (!hasAny) { allActualized = false; pendingPeriods.push(p); }
    }
    return {
      status: allActualized ? "actualized" : "pending",
      finalised_periods: finalisedPeriods.slice(),
      pending_periods: pendingPeriods,
    };
  })();

  const buildCostRow = ({ line_code, label, actual, budget, extraFlags = [], inventoryJe = 0, actualPurchased = null, creditsTotal = 0 }) => {
    const billed_back = isPassThrough;
    // inactive takes precedence over billed_back only when there is
    // truly nothing to say (no actual and no budget). Billed-back
    // accounts with real spend against $0 budget remain billed_back.
    const inactive = !billed_back && isCostInactive(actual, budget);
    const suppress = billed_back || inactive;
    // PR-1 item 2 + 3: envelope + pct fields per row. Suppressed rows
    // (billed_back / inactive) still emit null everywhere - the
    // absence-contract cascade holds.
    const btd = perBucketBudgetToDate[line_code] || null;
    const _actPct = suppress ? null : pctOf(actual, totalRevenue);
    // PR-1 item 1: budget/budget on full-period sums (horizon-invariant).
    const _tgtPct = (suppress || !has_target) ? null : pctOf(budget, revenue_budget_full_period);
    // PR-2 (2026-09-02) half-null guard: batr + envelope_delta are
    // a matched trio with btd. If we can't ship btd (per-bucket
    // proration returned null), suppress batr + envelope too so the
    // row never emits {btd:null, batr:0, envelope:null}. The cost-
    // lines row-consistency probe asserts this trio is all-null or
    // all-present per scored row.
    const _batr = (suppress || btd == null) ? null : budgetAtThisRevenue(budget);
    return {
      line_code,
      section: "cogs",
      label,
      reported: !inactive,
      actual,
      budget_to_date: suppress ? null : btd,
      period_budget: budget,
      // Kevin ruling 2026-09-03 (BLOCKER): row variance shares
      // reference with the row's percent gap - measured against
      // budget_at_this_revenue, not budget_to_date. Same fix as the
      // GM total row and the cost-lines table.
      variance: (!suppress && actual != null && _batr != null) ? r2(actual - _batr) : null,
      variance_pct: (has_target && !suppress && _actPct != null && _tgtPct != null) ? r2(_actPct - _tgtPct) : null,
      actual_pct: _actPct,
      target_pct: _tgtPct,
      budget_at_this_revenue: _batr,
      // R-58/R-59: MF accounts null envelope (contractual revenue).
      // Kevin R-61 (2026-09-03): inventory adjustment on 3200/3400.
      // `actual` above is the ADJUSTED figure (purchases - JE) so
      // every downstream calc uses the finance-side number; the raw
      // purchases figure ships alongside for the cost-lines trio
      // display. Non-adjustable rows (3100 labor, 3500 vehicle) emit
      // inventory_je=null so the client knows to skip the trio.
      envelope_delta: (suppress || btd == null || isManagementFee) ? null : envelopeDelta(btd, _batr),
      inventory_je: (line_code === "3200" || line_code === "3400") ? r2(inventoryJe) : null,
      actual_purchased: (line_code === "3200" || line_code === "3400" || line_code === "3500") ? actualPurchased : null,
      // R-71 Stage 2 (Kevin 2026-09-04): vendor-credits total (signed
      // negative) surfaces on the cost row so the client can render
      // "$X invoiced - $Y credits = $Z" sub-line, mirroring the
      // inventory-je pattern. Zero on rows/accounts without credits;
      // client suppresses the sub-line when zero.
      credits_total: (line_code === "3200" || line_code === "3400" || line_code === "3500") ? r2(creditsTotal) : null,
      sources: Math.abs(Number(creditsTotal || 0)) >= 0.01
        ? ["purchasing_actuals", "billcom_credit"]
        : ["purchasing_actuals"],
      flags: [
        ...(billed_back ? ["billed_back"] : []),
        ...(inactive ? ["inactive"] : []),
        ...extraFlags,
      ],
    };
  };
  // R-71 Stage 2: `actualPurchased` shipped to the row is the pre-
  // credit, pre-JE invoiced total. The client renders the derivation
  // sub-line "$X invoiced - $Y credits - $Z inventory = $W". Prior
  // to R-71 `actualPurchased` was `purchBoard.buckets[X].period_total`
  // which included credits (since credits landed in purchasing_actuals
  // once the loader ran); use `purchasesByBucket[X]` here so the
  // display is honestly labelled.
  statementRows.push(buildCostRow({
    line_code: "3200",
    label: "Food purchased",
    actual: food_actual,           // adjusted (purchases + credits - foodInventoryJe)
    actualPurchased: r2(purchasesByBucket["3200"]),
    inventoryJe: foodInventoryJe,
    creditsTotal: creditsByBucket["3200"],
    budget: food_budget,
  }));
  statementRows.push(buildCostRow({
    line_code: "3400",
    label: "Packaging and supplies",
    actual: packaging_actual,
    actualPurchased: r2(purchasesByBucket["3400"]),
    inventoryJe: packagingInventoryJe,
    creditsTotal: creditsByBucket["3400"],
    budget: packaging_budget,
    extraFlags: flags.packaging_gap ? ["packaging_gap"] : [],
  }));
  statementRows.push(buildCostRow({
    line_code: "3500",
    label: "Vehicle",
    actual: vehicle_actual,
    actualPurchased: r2(purchasesByBucket["3500"]),
    creditsTotal: creditsByBucket["3500"],
    budget: vehicle_budget,
  }));

  // Kevin PR-B item 6 (2026-09-03) + follow-up: sub-lines under 3200 /
  // 3400 / 3500 sourced DATA-DRIVEN from purchasing_actuals AND
  // kpi_budgets_purchasing - every gl_line_code that appears under
  // one of the three parent prefixes gets a sub-row. Finance labels
  // for the codes the P8 workbook names; bare gl_code + `unmapped`
  // flag for anything the workbook doesn't (finding for Sebastian).
  //
  // Parent-sum invariant (HARD, per Kevin's ruling): parent equals
  // sum(children) on every parent, every account, every range, both
  // budget and actual. Emissions honour this by construction:
  //   - actuals sum: subs sum raw purchasing_actuals per gl code;
  //     an "Inventory adjustment" synthetic sub-row carries the
  //     foodInventoryJe / packagingInventoryJe offset so post-JE
  //     parents still tie to sub-sum.
  //   - budget sum: subs are suppressed to null WHEN the parent is
  //     suppressed (billed_back / inactive), propagating the fee-
  //     account exclusion down the tree. Kevin's second-defect fix.
  //
  // Finance labels from the P8 workbook (source of truth):
  const FINANCE_LABELS = {
    "3200.1": "General Food",
    "3200.2": "Resale Food",
    "3400.1": "Packaging",
    "3400.2": "Supplies",
    "3400.5": "Linen",
    "3500.2": "Vehicle Insurance",
    "3500.3": "Leased Vehicle",
    "3500.4": "Fuel",
    "3500.5": "Vehicle Repair & Maintenance",
  };
  const PARENT_PREFIXES = ["3200", "3400", "3500"];
  const isPrefixMatch = (gl, parent) => typeof gl === "string" && gl.startsWith(parent) && gl !== parent;
  const parentPrefixOf = (gl) => PARENT_PREFIXES.find(p => isPrefixMatch(gl, p)) || null;
  // Collect every gl_line_code present in either engine under the
  // three parents. Sort by parent then by gl for stable render.
  //
  // R-71 Stage 2 (Kevin ruling 2026-09-04): vendor-credits FOLD into
  // the GL-coded sub-line, not a synthetic CREDITS row.
  //
  // Kevin's ruling: "A credit carries a chartOfAccountId. It is
  // GL-coded to 3200.1 or 3200.2, so it belongs on that line -
  // unlike an inventory JE, which has no GL line of its own and
  // genuinely needs a synthetic row."
  //
  // Fold means: include billcom_credit rows in the per-gl aggregation
  // (they naturally reduce the sub-row's actual by their negative
  // amount) and DO NOT emit a separate `{parent}.CREDITS` synthetic.
  // The parent-row derivation sub-line still surfaces the credit
  // amount ("$X invoiced - $Y credits = $Z") so visibility survives
  // without double-listing.
  //
  // Two knock-on wins: (1) sub-line becomes comparable to finance's
  // 3200.1 (finance also folds credits in), closing the $19k+ display
  // gap on TBJ - FL. (2) The pass-through parent-sum edge case
  // disappears - no synthetic row to gate, so sub-rows tie to parent
  // on billed-back accounts without a special-case guard.
  const glsUnderParent = new Map(PARENT_PREFIXES.map(p => [p, new Set()]));
  const purchActualsByLine = new Map();
  const purchActualsLinesPresent = new Set();
  for (const r of (purchActuals || [])) {
    const gl = String(r.gl_line_code || "");
    if (!gl) continue;
    const parent = parentPrefixOf(gl);
    if (!parent) continue;
    glsUnderParent.get(parent).add(gl);
    purchActualsByLine.set(gl, (purchActualsByLine.get(gl) || 0) + Number(r.amount || 0));
    purchActualsLinesPresent.add(gl);
  }
  if (purchBudgets && typeof purchBudgets.keys === "function") {
    for (const gl of purchBudgets.keys()) {
      const parent = parentPrefixOf(gl);
      if (parent) glsUnderParent.get(parent).add(gl);
    }
  }
  // Per-line budget sum across members + periods. purchBudgets shape
  // is gl → account → period → amount. PURCHASING_ENVELOPE_EXCLUSIONS
  // handled explicitly.
  const sumPurchByPeriod = (lineCode) => {
    const perLine = purchBudgets?.get?.(lineCode);
    if (!perLine) return new Map();
    const out = new Map();
    for (const m of members) {
      if (PURCHASING_ENVELOPE_EXCLUSIONS.has(m)) continue;
      const byAcct = perLine.get(m);
      if (!byAcct) continue;
      for (const [pn, amt] of byAcct) {
        out.set(pn, (out.get(pn) || 0) + Number(amt));
      }
    }
    return out;
  };
  // Per-parent suppression: mirror buildCostRow's `suppress`. If the
  // parent is billed_back (pass_through) OR inactive (no actual AND
  // no budget), children carry null on every budget/batr field so the
  // parent-null → children-null invariant holds. Actual still flows
  // through on billed_back (real spend, real gl_line_codes) so parent
  // actual and sub-sum tie via the inventory-JE synthetic row.
  const parentIsSuppressed = (parent) => {
    if (isPassThrough) return true;
    if (parent === "3200") return isCostInactive(food_actual, food_budget);
    if (parent === "3400") return isCostInactive(packaging_actual, packaging_budget);
    if (parent === "3500") return isCostInactive(vehicle_actual, vehicle_budget);
    return false;
  };
  // Inventory-JE offset: parent 3200/3400 actual is
  //   food_actual  = food_actual_purchased  - foodInventoryJe
  //   packaging    = packaging_purchased    - packagingInventoryJe
  // Sub actuals sum the pre-JE purchasing_actuals. Emit a synthetic
  // "Inventory adjustment" sub-row per parent carrying the -JE so
  // sub-sum = parent post-JE.
  const parentInventoryJe = {
    "3200": Number(foodInventoryJe || 0),
    "3400": Number(packagingInventoryJe || 0),
    "3500": 0,
  };
  for (const parent of PARENT_PREFIXES) {
    const parentSuppressed_ = parentIsSuppressed(parent);
    const glList = [...glsUnderParent.get(parent)].sort();
    for (const gl of glList) {
      const actualPresent = purchActualsLinesPresent.has(gl);
      const actual = actualPresent ? r2(purchActualsByLine.get(gl) || 0) : null;
      const byPeriod = sumPurchByPeriod(gl);
      let periodBudget = 0;
      let anyBudget = false;
      for (const p of periods) {
        const v = byPeriod.get(p);
        if (v != null) {
          periodBudget += Number(v);
          anyBudget = true;
        }
      }
      const period_budget_raw = anyBudget ? r2(periodBudget) : null;
      const btd = computeBudgetToDateForLine({
        budgetByPeriod: byPeriod,
        periodsInRange: periods,
        today,
        throughISO: effectiveEndISO,
      });
      const budget_to_date_raw = btd.amount;
      const period_budget = parentSuppressed_ ? null : period_budget_raw;
      const budget_to_date = parentSuppressed_ ? null : budget_to_date_raw;
      const isInactive = actual == null && (period_budget == null || period_budget === 0);
      const _actPct = (parentSuppressed_ || isInactive) ? null : pctOf(actual, totalRevenue);
      const _tgtPct = (parentSuppressed_ || isInactive || !has_target) ? null : pctOf(period_budget, revenue_budget_full_period);
      const _batr = (parentSuppressed_ || isInactive) ? null : budgetAtThisRevenue(period_budget);
      const label = FINANCE_LABELS[gl] || gl;
      const unmapped = !FINANCE_LABELS[gl];
      statementRows.push({
        line_code: gl,
        section: "cogs",
        parent_line_code: parent,
        label,
        reported: actual != null,
        actual,
        budget_to_date,
        period_budget,
        variance: (actual != null && _batr != null) ? r2(actual - _batr) : null,
        variance_pct: (has_target && _actPct != null && _tgtPct != null) ? r2(_actPct - _tgtPct) : null,
        actual_pct: _actPct,
        target_pct: _tgtPct,
        budget_at_this_revenue: _batr,
        envelope_delta: (parentSuppressed_ || isInactive || isManagementFee) ? null : envelopeDelta(budget_to_date, _batr),
        sources: ["purchasing_actuals"],
        flags: [
          ...(parentSuppressed_ ? ["billed_back"] : []),
          ...(isInactive ? ["inactive"] : []),
          ...(unmapped ? ["unmapped"] : []),
        ],
      });
    }
    // Inventory-JE synthetic sub-row (3200 / 3400 only). Reconciles
    // sub-actuals (pre-JE) with parent actual (post-JE). Renders with
    // the inventory_adjustment flag; no budget side.
    const je = parentInventoryJe[parent];
    if (je && je !== 0 && !parentSuppressed_) {
      statementRows.push({
        line_code: `${parent}.INVJE`,
        section: "cogs",
        parent_line_code: parent,
        label: "Inventory adjustment",
        reported: true,
        actual: r2(-je),
        budget_to_date: null,
        period_budget: null,
        variance: null,
        variance_pct: null,
        actual_pct: null,
        target_pct: null,
        budget_at_this_revenue: null,
        envelope_delta: null,
        sources: ["inventory_adjustments"],
        flags: ["inventory_adjustment"],
      });
    }
  }

  // Also-tracked rows
  // 2026-09-01 defect fix: the tracked lines (5002.1 / 5002.5 /
  // 5017.3) are Rippling-card spend that returns period_total=0 when
  // no card rows exist for the line - operationally indistinguishable
  // from "no data" (there is no reported-zero-vs-no-activity signal
  // on the purchasing side). Prior code kept `reported = actual > 0`
  // but STILL computed variance from the underlying 0, which rendered
  // "$115 under" for a line with no measured spend - a saving that
  // has not been measured.
  //
  // Absence-contract fix: when reported=false, variance is null so
  // the client renders "no data" instead of a fake savings figure.
  const alsoTracked = [
    { line_code: "5002.1", label: "Gen. Repair & Maintenance", actual: rm_actual, budget: rm_budget },
    { line_code: "5002.5", label: "Equipment",                     actual: equip_actual, budget: equip_budget },
    { line_code: "5017.3", label: "Perks",                         actual: perks_actual, budget: perks_budget },
  ].map(r => {
    // reported is true iff the loader saw a non-zero actual - positive
    // OR negative (a credit note on 5002.5 is a real reported figure,
    // e.g. ALL/P9 -157.03). Zero on the purchasing side is ambiguous
    // between reported-zero and absent, so we treat it as unreported.
    const reported = r.actual != null && r.actual !== 0;
    // PR 2 addition (2026-09-01, Kevin surfaced): when reported=false,
    // the actual + actual_display fields must go null too. Prior code
    // shipped actual:0 + actual_display:"$0" alongside reported:false -
    // the flag was right but the payload string was one step behind
    // it, and any consumer reading actual_display in isolation saw a
    // phantom zero instead of an absence.
    return {
      line_code: r.line_code,
      label: r.label,
      reported,
      actual: reported ? r.actual : null,
      actual_display: reported ? formatMoneyWhole(r.actual) : null,
      budget: r.budget,
      budget_display: formatMoneyWhole(r.budget),
      variance: (reported && r.budget != null) ? r2(r.actual - r.budget) : null,
      note: r.line_code === "5017.3" ? "Rippling card spend on perks" : null,
    };
  });

  // 18b. Drill sub-object (2026-08-31, engine follow-up).
  //
  // The purchasing drill button on the Overview needs a single
  // combined-purchasing summary (spend, pct-of-revenue, target-pct).
  // Kevin's approved render pulls these three pre-formatted display
  // strings from the payload rather than having the client sum
  // buckets and derive a combined pct client-side (§9B: server
  // computes every dollar, formatting decisions server-side).
  //
  // COGS / drill total is food + packaging + vehicle only. R&M /
  // Equipment / Perks are the "Also tracked" band per R-17b
  // (charter §11: "not part of gross margin or cost of goods sold
  // - watched together"), deliberately outside the measured figure.
  // Including them here would create two numbers for one idea on
  // the same page (drill would exceed the purchasing board's own
  // pl_cogs.spent headline) and cross the scored-versus-tracked
  // line. Kevin ruling 2026-08-31.
  //
  // Nulls are treated as 0 for the summation (mirrors cogsActual /
  // cogsBudget on line 646-647 above). A null-only spend collapses
  // pct via pctOf's zero-denominator branch to null.
  const purchSpentActual = (food_actual || 0) + (packaging_actual || 0) + (vehicle_actual || 0);
  const purchSpentBudget = (food_budget || 0) + (packaging_budget || 0) + (vehicle_budget || 0);
  // 2026-09-01 defect fix: target-pct denominator alignment. Use the
  // aggregate to-date purchasing budget so both sides of the ratio
  // share the same horizon. Falls back to null (drill.target hides)
  // if buckets_budget_to_date_days is absent.
  const purchSpentBudgetToDate = buckets_budget_to_date_days?.amount ?? null;
  const purchActualPct = pctOf(purchSpentActual, totalRevenue);
  // PR-1 item 1 (2026-09-02): budget/budget on full-period sums so
  // the drill target is horizon-invariant across FYTD too. Null on
  // rolling windows.
  const purchSpentBudgetFull = (food_budget || 0) + (packaging_budget || 0) + (vehicle_budget || 0);
  const purchTargetPct = has_target ? pctOf(purchSpentBudgetFull, revenue_budget_full_period) : null;
  const purchVariancePct = (has_target && purchActualPct != null && purchTargetPct != null)
    ? r2(purchActualPct - purchTargetPct)
    : null;
  // E16 (2026-09-01): on pass-through accounts the purchasing spend
  // is billed back - the client pays for it. Rendering "0.1% over
  // target" on $37 against $0 was the specific defect Kevin flagged.
  // The drill payload carries a `billed_back: true` flag so the
  // client hides the percentage and renders a tag. No variance,
  // no direction, no verdict.
  const drillBilledBack = isPassThrough;
  // PR-1 item 2 (2026-09-02): envelope on the drill so PR-2's card
  // can render "$X less than the plan allowed" beside the total.
  // purchTargetPct is a percent number; convert to ratio for the
  // envelope math (batr = actual_revenue * ratio).
  const drillBudgetAtThisRevenue = (has_target && totalRevenue != null && purchTargetPct != null)
    ? r2(totalRevenue * purchTargetPct / 100) : null;
  const drillEnvelopeDelta = envelopeDelta(purchSpentBudgetToDate, drillBudgetAtThisRevenue);
  const drill = {
    purchasing: {
      spent_display: formatMoneyWhole(purchSpentActual),
      pct_of_revenue_display: drillBilledBack ? null : formatPct(purchActualPct),
      target_pct_display: (drillBilledBack || !has_target) ? null : formatPct(purchTargetPct),
      // Site posture drill button carries the verdict (R-32). "5.4%
      // under target" pattern - cost axis, so under=good, over=bad.
      // Billed-back accounts + rolling windows get null on all three
      // so the client cannot accidentally render a verdict.
      variance_pct: (drillBilledBack || !has_target) ? null : purchVariancePct,
      variance_pct_display: (drillBilledBack || !has_target || purchVariancePct == null) ? null : gapPointsCost(purchVariancePct),
      direction: (drillBilledBack || !has_target || purchVariancePct == null) ? null : directionOfDelta(purchVariancePct, "cost"),
      budget_at_this_revenue: drillBilledBack ? null : drillBudgetAtThisRevenue,
      envelope_delta: drillBilledBack ? null : drillEnvelopeDelta,
      billed_back: drillBilledBack,
    },
  };

  // 18c. R-52 (Kevin, 2026-09-02): pace card removed from the Overview.
  //
  // "The Overview is a scoreboard, not a forecast. The board's
  // credibility rests on stating what is measured, and a projection
  // invites an operator to argue with the prediction instead of
  // looking at their spend." what_is_left, its runway math, the pace-
  // vs-clock verdict, and the two-card composition are all retired.
  //
  // The future-period planning view (R-47 / R-48) is a separate
  // surface, not yet built, and is not affected by this ruling.

  // 19. Sources line. Data-through dates for each source.
  //
  // P2-4a / P2-4b / P2-4c (2026-09-01): three-way rewrite.
  //   (a) Raw ISO dates -> formatDayLabel ("Sun 08/30") per the
  //       render of record (docs/renders/overview-prototype.html:382).
  //   (b) Never assert data through a day that has not closed. Each
  //       source ships the max CLOSED day it actually has:
  //         - labor:     max labor board week_end where state==='closed'
  //         - purchases: purchFreshness.cards_through (last CLOSED
  //                      card txn_date from rippling_spend - one-week
  //                      lag is baked in)
  //         - sc:        max sc_daily_revenue.service_date seen for
  //                      any member in range
  //       Prior implementation echoed `today` which claimed data
  //       through an incomplete day (Kevin's live measurement:
  //       "Labor through 2026-08-31 [today] while cards_through is
  //       08/30").
  //   (c) SC revenue always renders as a third source line - not
  //       gated on effRevSource==='sc' + scLiveAny. Per render of
  //       record the sources line advertises three sources
  //       regardless of the revenue-source toggle; the toggle
  //       controls which SOURCE feeds the open-period revenue
  //       NUMBERS, not whether the SC through-date is disclosed.
  //       When no SC data landed at all in range (empty scByAcct),
  //       the line renders "not yet reporting" so it never asserts
  //       a date it doesn't have.
  // 2026-09-01 follow-up rule: NEVER claim data through an incomplete
  // day. Every source's through_date is capped at STRICTLY LESS THAN
  // `today` so a sources line can never assert "through Tue 09/01"
  // when 09/01 is today. Labor already respects this via its
  // state==='closed' filter (the week has to be closed for its
  // week_end to count). Purchases + SC use raw last-observed values
  // from their loaders and can slip past midnight - cap them here.
  // 2026-09-02: capBeforeToday moved to pnl-loader.js so the
  // sc_daily_revenue reader and the sources-line label call the
  // SAME function. Kevin's rule: "one function owns 'through when',
  // and the sources line already calls it". Locally alias the
  // imported helper so the callsites below stay legible.
  const capBefore = (iso) => capBeforeToday(iso, today);
  const laborLastClosed = (() => {
    const weeks = laborBoard?.weeks || [];
    let max = null;
    for (const w of weeks) {
      if (w.state !== "closed") continue;
      if (max == null || w.week_end > max) max = w.week_end;
    }
    return capBefore(max);
  })();
  const scMaxDate = (() => {
    let max = null;
    for (const [, byDate] of scByAcct) {
      for (const [day] of byDate) {
        if (max == null || day > max) max = day;
      }
    }
    return capBefore(max);
  })();
  const cardsThrough = capBefore(purchFreshness?.cards_through || null);

  const labelWithThrough = (base, iso, fallback) => {
    const day = iso ? formatDayLabel(iso) : null;
    return day ? `${base} ${day}` : (fallback || `${base} (not yet reporting)`);
  };
  // Kevin 2026-09-02 blocker Item 4+5: the popover revenue row must
  // name every source the payload used (verified first), and when the
  // range contains a still-running period the consequence sentence
  // must fire. `sources_used` echoes the union of statement_rows
  // revenue sources so the probe can assert
  // popover.sources_used == union(statement_rows.revenue.sources)
  // - the popover cannot omit a source the payload used.
  const revenueSourcesUsed = (() => {
    const set = new Set();
    for (const r of statementRows) {
      if (r.section !== "revenue") continue;
      const srcs = Array.isArray(r.sources) ? r.sources : [];
      for (const s of srcs) set.add(s);
    }
    return [...set];
  })();
  const revenueRowParts = (() => {
    const parts = [];
    if (rangeComposition.verified.count) {
      parts.push(`${rangeComposition.verified.label} verified against the finance P&L`);
    }
    // Kevin walkthrough item 3 - awaiting bucket surfaces in the
    // popover so the reader sees why a closed period's revenue is
    // provisional. Sits between verified and live/planned to
    // preserve the reading order.
    if (rangeComposition.awaiting?.count) {
      parts.push(`${rangeComposition.awaiting.label} closed but awaiting finance verification`);
    }
    if (rangeComposition.live.count) {
      const dayLbl = scMaxDate ? formatDayLabel(scMaxDate) : null;
      const tail = dayLbl ? ` through ${dayLbl}` : "";
      parts.push(`${rangeComposition.live.label} live from Service Calendar${tail}`);
    }
    if (rangeComposition.planned.count) {
      // Fee accounts read from a contract; per-meal flag-off + closed_
      // awaiting per-meal read from budget. Name it what it is so the
      // popover doesn't lump the two together. The union of used
      // sources tells us which noun to pick.
      const usesContract = revenueSourcesUsed.some(s => s === "kpi_budgets_2400_1_contractual");
      const usesTracked = revenueSourcesUsed.some(s => s === "kpi_budgets_2400_1_tracked");
      const noun = usesContract ? "the fee contract"
        : usesTracked ? "the tracked budget"
        : "budget";
      parts.push(`${rangeComposition.planned.label} planned from ${noun}`);
    }
    return parts;
  })();
  const revenueConsequence = rangeComposition.will_change_at_close && rangeComposition.live.count
    ? `The ${rangeComposition.live.label} figure is a live estimate and will change when the period closes and is verified against the finance P&L.`
    : (rangeComposition.will_change_at_close && rangeComposition.planned.count
      ? `The ${rangeComposition.planned.label} figure is a planned estimate and will change when the period closes and is verified against the finance P&L.`
      : null);
  const sourcesLine = {
    labor: {
      through_date: laborLastClosed,
      label: labelWithThrough("Labor through", laborLastClosed, "Labor not yet reporting"),
    },
    purchases: {
      through_date: cardsThrough,
      label: labelWithThrough("Purchases through", cardsThrough, "Purchases not yet reporting"),
    },
    sc_revenue: {
      through_date: scMaxDate,
      label: labelWithThrough(
        "Revenue from Service Calendar through",
        scMaxDate,
        "Service Calendar revenue not yet reporting",
      ),
    },
    // Composed revenue row (Item 4+5). Parts joined by " · " in the
    // popover; consequence rendered as a trailing note when set.
    revenue: {
      parts: revenueRowParts,
      sources_used: revenueSourcesUsed,
      consequence: revenueConsequence,
    },
    period_state: displayPeriodState,
    period_state_display: (() => {
      switch (displayPeriodState) {
        case "open":            return "open · live estimate";
        case "closed_awaiting": return "closed · awaiting finance";
        case "verified": {
          const row = periodStatus.get(displayPeriodNo);
          const va = row?.verified_at;
          if (va) return `verified against P&L · ${String(va).slice(5, 10).replace("-", "/")}`;
          return "verified against P&L";
        }
        default: return null;
      }
    })(),
    // Kevin ruling 2026-09-03 (top-simplify) item 3: two disclosures
    // move here from the Revenue card. `Periods verified` (was the
    // range-composition sub-line) + `Inventory` (was the badge). These
    // are trust statements about the numbers, not metrics; the
    // Data-current popover is where an operator asks "where do these
    // numbers come from".
    periods_display: (() => {
      if (!rangeComposition) return null;
      const v = rangeComposition.verified;
      if (!v || !v.count) return null;
      return `${v.label} verified`;
    })(),
    // Inventory: "actualized" when every finalised period has a JE;
    // "pending · P6" (or "P6, P7") when one or more are outstanding;
    // "lands at close" on an open range where the badge would
    // otherwise vanish (Kevin's item 3: the operator should know the
    // adjustment is coming, not wonder why the row disappeared).
    inventory_display: (() => {
      // Only relevant on inventory-carrying accounts. `inventoryApplicable`
      // is true for SC-driven / sales-based sites; MF + pass-through
      // accounts stay null.
      if (!inventoryApplicable) return null;
      if (displayPeriodState === "open" && (!inventory_status || inventory_status.finalised_periods?.length === 0)) {
        return "lands at close";
      }
      if (!inventory_status) return null;
      if (inventory_status.status === "actualized") return "actualized";
      if (inventory_status.status === "pending") {
        const pp = inventory_status.pending_periods || [];
        if (pp.length === 0) return "pending";
        return `pending · ${pp.map(p => "P" + p).join(", ")}`;
      }
      return null;
    })(),
  };

  // 20. Freshness echo. cards_through comes from the purchasing
  //     freshness loader; today is the request date. `last_walk_at`
  //     drives the Shell's command-bar freshness chip (green / amber
  //     / red per hoursSinceISO(last_walk_at)).
  //
  //     P2-4d (2026-09-01): fix the false red chip. The Overview
  //     composes labor + purchasing + SC. Prior implementation
  //     passed `freshness={ last_walk_at: null }` on the client
  //     side, which the Shell's FreshnessChip renders as red
  //     "No recent walk". That is wrong for the Overview: the
  //     signal that drives the red on the labor board is the
  //     Rippling walk age (a labor-pipeline-specific concept),
  //     but the Overview's aggregated view has no single "walk"
  //     - it has three source pipes. On the same account,
  //     purchasing was reading "Data current" while Overview
  //     was reading red "No recent walk".
  //     Kevin's ruling: a false red alarm is worse than no chip.
  //     Fix: emit last_walk_at as the max(labor last derive,
  //     purchasing last derive). The client passes this into
  //     Shell's `freshness` prop and the chip reflects the
  //     underlying data-pipe age. When both pipes are fresh
  //     (< 30h old per freshnessTint) the chip renders "Data
  //     current" - matching what purchasing shows on the same
  //     account.
  const laborDeriveAt = null;  // labor board doesn't ship this on library-call output
  const purchDeriveAt = purchFreshness?.last_derive_at || null;
  const composedWalkAt = purchDeriveAt || laborDeriveAt;
  const freshness = {
    today,
    cards_through: cardsThrough || today,
    last_walk_at: composedWalkAt,
  };

  // Kevin R-94 (2026-09-09). Settling data for the "What is still
  // moving" strip on Last period when displayPeriodState === "closed_
  // awaiting". Names the two sources of movement on a period that
  // closed on Sunday - invoice lag (bill.com nightly sync) + labour
  // approval (unapproved hours land as approvals happen). Prior-
  // period line count baseline ("36 against 80 in P8") is a separate
  // targeted query so the range-scoped weekly load stays clean.
  // Null on any state that isn't single-period closed_awaiting so the
  // client omits the strip.
  const settling = await (async () => {
    if (rng.kind !== "period" || displayPeriodState !== "closed_awaiting") return null;
    const p = rng.period_no;
    if (p == null) return null;
    const pEnd = periodEndISO(p);

    // Kevin ruling 2026-09-08. Purchases line no longer renders
    // counts - copy is period-dynamic + generic ("Invoices for
    // P{period_no} finalizing"). Prior current + prior line-count
    // queries removed with the fields; nothing else consumed them.
    // Labour: sum draft_hours + count distinct people with any draft
    // in the period. Reads laborActuals directly (already in scope,
    // no extra query).
    const inPeriod = (laborActuals || []).filter(r =>
      r.week_start && periodOf(r.week_start) === p && Number(r.draft_hours || 0) > 0.004
    );
    const draftHours = inPeriod.reduce((s, r) => s + Number(r.draft_hours || 0), 0);
    const draftPeople = countDistinctPeople(inPeriod, workerToEmail);

    return {
      period_no: p,
      period_end: pEnd,
      labour: {
        hours: Math.round(draftHours * 100) / 100,
        people: draftPeople,
      },
    };
  })();

  // 21. Payload assembly.
  const payload = {
    ok: true,
    filters: {
      account: accountKey,
      range: { start: rng.start, end: rng.end, kind: rng.kind, period_no: rng.period_no },
      rev_source: effRevSource,
      include_salary: !!includeSalary,
    },
    account: accountKey,
    range: {
      start: rng.start,
      end: rng.end,
      kind: rng.kind,
      period_no: rng.period_no,
      periods_in_range: periods,
    },
    // Kevin 2026-09-02 blocker: FYTD hides that it is N verified
    // periods plus one still running. See step 7b for the
    // classification rule. Every board surface that names composition
    // (range chip / revenue-lines pill / revenue card sub-line /
    // sources popover / status line third clause) reads from this
    // field. Invariant asserted at build:
    //   verified.count + live.count + planned.count === periods_total
    range_composition: rangeComposition,
    // Kevin 2026-09-02 language pass: every "thru P#" / "P1-P8" label
    // on the board comes from this one object. See buildRangeLabels
    // for the shape. Client reads verbatim.
    range_labels: buildRangeLabels({
      range: { start: rng.start, end: rng.end, kind: rng.kind, period_no: rng.period_no },
      rangeComposition,
      periodState: displayPeriodState,
      lastCompleteWk,
      effectiveEndISO,
      todayISO: today,
    }),
    // Kevin ruling R-63 (2026-09-03): the "as of when" answer for
    // every figure on the board. On closed ranges this equals
    // rng.end; on open ranges it's the last complete week's end so
    // revenue and cost measure the same window. PR-B renders the
    // horizon line off range_labels.horizon (below).
    range_effective_end: effectiveEndISO,
    // R-40 (2026-09-01): posture retired as a layout switch. Access
    // flags only, named for what they do.
    //
    // Polish PR (2026-09-01): revenue_toggle_visible was also
    // retired - the account's own sc_revenue_live flag flips the
    // source with no user control, so the toggle has nothing left to
    // do. Zero unconsumed keys.
    salary_toggle_visible: access.salary_toggle_visible,
    period_state: displayPeriodState,
    period_state_details: {
      period_no: displayPeriodNo,
      status_row: displayPeriodNo != null ? (periodStatus.get(displayPeriodNo) || null) : null,
    },
    ticker,
    cards,
    levers,
    chart,
    statement_rows: statementRows,
    // E19 (2026-09-01): total-row period-budget figures the client
    // renders on Total revenue and Total COGS. Prior payload shipped
    // only revenue totals in the cards + a null total-COGS period
    // budget in the statement, so Total COGS rendered as a dash next
    // to Total revenue's actual dollar figure - two different shapes
    // for two total rows on one page.
    // PR-1 item 2 (2026-09-02): envelope + pace on the COGS total so
    // the PR-2 lever-table row-and-total agreement probe has a
    // reconciled number to check against per line.
    // Kevin ruling 2026-09-03: every P&L row carrying both a percent
    // gap and a dollar variance MUST measure both against the SAME
    // reference. The reference is `x_at_this_revenue` (actual revenue
    // times the target ratio) - not `budget_to_date`. With BOTH
    // computed against the same denominator, `variance` and (actual_
    // pct - target_pct) agree in sign by construction, because
    //   variance = actual - x_at_this_revenue
    //            = actual - revenue × target_ratio
    //            = revenue × (actual/revenue - target_ratio)
    //            = revenue × (actual_pct - target_pct) / 100
    // Fourth instance of the split-reference defect class. Client
    // renders these fields; it computes NOTHING.
    statement_totals: {
      revenue: {
        period_budget: revenue_budget_full_period,
        budget_to_date: revenue_budget_to_date,
        actual: totalRevenue,
        // Revenue has no `%-of-revenue` counterpart to disagree with -
        // actual_pct is always 100 by definition. The dollar variance
        // measures revenue vs planned (its own comparison axis). No
        // split possible; audited 2026-09-03.
      },
      cogs: {
        period_budget: r2(cogsBudget),
        budget_to_date: r2(cogsBudgetToDateDays),
        actual: r2(cogsActual),
        // BATR was already shipped for the COGS card + cost lines
        // envelope note. Explicitly repurposed here as the unified
        // reference: variance = actual - budget_at_this_revenue,
        // pcts = actual/revenue vs cogs_budget/rev_budget.
        budget_at_this_revenue: budgetAtThisRevenue(cogsBudget),
        // R-58/R-59: MF accounts null envelope (contractual revenue).
        envelope_delta: isManagementFee ? null : envelopeDelta(r2(cogsBudgetToDateDays), budgetAtThisRevenue(cogsBudget)),
        variance: (cogsActual != null && budgetAtThisRevenue(cogsBudget) != null)
          ? r2(cogsActual - budgetAtThisRevenue(cogsBudget)) : null,
        actual_pct: pctOf(cogsActual, totalRevenue),
        target_pct: (revenue_budget_full_period != null && revenue_budget_full_period > 0)
          ? pctOf(cogsBudget, revenue_budget_full_period) : null,
      },
      gross_margin: {
        period_budget: (revenue_budget_full_period != null) ? r2(revenue_budget_full_period - cogsBudget) : null,
        budget_to_date: grossMarginBudget,
        actual: grossMargin,
        // Kevin ruling 2026-09-03 (BLOCKER): the P&L GM row was
        // rendering ↑ $29,215 in GREEN next to "2.0 points BEHIND"
        // in RED - percent vs target, dollar vs budget_to_date, two
        // different references. Unified reference:
        //   margin_at_this_revenue = revenue × target_margin_pct
        //   variance               = actual - margin_at_this_revenue
        // Fires green/red on the same axis as actual_pct - target_pct.
        margin_at_this_revenue: budgetAtThisRevenue(
          (revenue_budget_full_period != null) ? (revenue_budget_full_period - cogsBudget) : null,
        ),
        variance: (grossMargin != null
          && budgetAtThisRevenue((revenue_budget_full_period != null) ? (revenue_budget_full_period - cogsBudget) : null) != null)
          ? r2(grossMargin - budgetAtThisRevenue(
              (revenue_budget_full_period != null) ? (revenue_budget_full_period - cogsBudget) : null,
            ))
          : null,
        actual_pct: pctOf(grossMargin, totalRevenue),
        target_pct: gmPctBudget,
      },
    },
    // PR-1 payload additions (2026-09-02).
    has_target,
    revenue_source_state,
    // Kevin R-58 (2026-09-03): three-way account model - source of
    // truth for gating "adjusted budget" copy on cards + cost lines.
    // Null on portfolio scope (mixed models across members).
    revenue_model,
    revenue_pace_pct,
    sc_counts_without_dollars,
    // Kevin R-61 (2026-09-03): inventory adjustment status. Card 1
    // states whether every finalised period in range carries an
    // adjusting JE. `null` on accounts that don't carry inventory
    // (management-fee / pass-through) and on single-open ranges.
    inventory_status,
    also_tracked: alsoTracked,
    drill,
    // A3+A4 (2026-09-01): the ticker retired. A single status line
    // replaces it - fixed shape on every account. The pass-through /
    // fee / planned notes were three restatements of a fact already
    // carried by the Revenue card's pill and the billed-back tags,
    // and the longest one forced the ticker to wrap on fee accounts.
    //
    // Kevin ruling 2026-09-03 (top-simplify): the status line becomes
    // a single pill - state_copy + tone. Every segment beneath
    // (GM vs target, biggest lever, weeks-closed progress) was a
    // restatement of what the three cards below already say. See
    // buildStatusLine below - trimmed to { state, state_copy, tone }.
    status_line: buildStatusLine({
      ticker,
      period_state: displayPeriodState,
      has_target,
      range_kind: rng.kind,
    }),
    // Kevin R-94 (2026-09-09). "What is still moving" strip data
    // on Last period when the period is closed but not yet
    // finance-verified. Null on every other state; client omits the
    // strip. Includes an amber-tone signal cost + margin cards
    // consume to render Provisional.
    settling,
    // Kevin CC prompt 2026-09-08 item 4. Week-by-week rail on the
    // running single-period surface. Null on every other range; the
    // client omits the section.
    week_rail,
    sources: sourcesLine,
    flags,
    freshness,
    // P2-1 (2026-09-01): live accounts_directory + rdo display so
    // the folio rail on the corporate posture can render real
    // descriptions ("St Louis Cardinals · Jupiter, FL") on all 11
    // rows instead of the placeholder space that STATIC_DIRECTORY
    // (nulls) resolved to via folioMemberDescription. Mirrors the
    // labor + purchasing payloads.
    accounts_directory: dirResp?.data || null,
    regional_directors_display: {
      East: ovRdoDisplayName(REGIONAL_DIRECTORS.East),
      West: ovRdoDisplayName(REGIONAL_DIRECTORS.West),
    },
    // Preview-mode + landing propagation (mirrors labor route echoes).
    preview_account: null,
    landing_account: null,
    // Instrumentation.
    ...(debugTiming ? { _debug: { timings, total_ms: Math.round((performance.now() - t0) * 10) / 10 } } : {}),
  };

  return payload;
}

// A3+A4 (2026-09-01): the single-sentence status line that replaces
// the ticker. Fixed shape across every account. Three segments joined
// by " · " on the client. No notes, no account-model clauses.
//
// Segments:
//
// Kevin ruling 2026-09-03 (top-simplify): status_line collapses to a
// single pill - `state`, `state_copy`, `tone`. The GM-vs-target
// segment, biggest-lever segment and weeks-closed segment all restated
// what the three cards below already say. Sentence-building fields
// (gm_actual_display / gm_target_display / biggest_lever /
// progress_display / gm_tone) removed. Card face is now the
// comparison; the pill states the state alone.
function buildStatusLine({ ticker, period_state, has_target, range_kind }) {
  if (!ticker) return null;
  const gmActualPct = ticker.gm_pct_actual;
  const gmTargetPct = ticker.gm_pct_target;

  // Two-tone rule (Kevin 2026-09-02 items 2-3). GM at or above target
  // is green; below is red. Rolling windows (has_target=false) are
  // neutral.
  const gmDeltaForTone = (gmActualPct != null && gmTargetPct != null)
    ? Number(gmActualPct) - Number(gmTargetPct)
    : null;
  const statusTone = !has_target
    ? "neutral"
    : gmDeltaForTone == null
      ? "neutral"
      : gmDeltaForTone >= 0 ? "good" : "bad";

  // Kevin R-94 (2026-09-09). A closed-but-not-yet-verified period
  // reads "Awaiting verification" in AMBER, not a settled verdict.
  // The pill contradicts itself when it says "on target" beside a
  // horizon line that says "awaiting verification" - and the
  // figures are still moving, so the verdict is a reading, not a
  // result. Wait tone is a NEW variant beyond good/bad/neutral;
  // client renders it as amber with a leading indicator dot.
  const rangeIsAwaiting = range_kind === "period" && period_state === "closed_awaiting";
  if (rangeIsAwaiting) {
    return {
      state: "awaiting_verification",
      state_copy: "Awaiting verification",
      tone: "wait",
    };
  }

  // Kevin ruling 2026-09-08. Running-single-period pill is
  // "Period running" - a state, not a verdict. Two days into a
  // period is no time to read "At risk" or "On track"; the ticker
  // is judging a period against a whole-period budget. Horizon
  // sub-line ("P10 · week 1 of 4 · day 2 of 28") carries the
  // progress; the pill just names the state. New tone "run" -
  // client renders navy with a leading dot (same treatment as
  // "wait" but different palette).
  const rangeIsRunning = range_kind === "period" && period_state === "open";
  if (rangeIsRunning) {
    return {
      state: "period_running",
      state_copy: "Period running",
      tone: "run",
    };
  }

  // "Period closed · on target / off target" on any closed range
  // (single closed or FYTD - and post-2026-09-08 the aligned-explicit
  // path This year takes since #1063 sends R-93 dates as explicit).
  // Open ranges keep the ticker's running copy ("On track" / "Behind
  // target" / "At risk"). No-target ranges read "No target" (neutral).
  const rangeIsClosed = range_kind === "period" && period_state !== "open";
  const rangeIsFytdClosed = range_kind === "fytd";
  // Kevin ruling 2026-09-08. Widen to aligned-explicit so This year
  // (post-#1063) gets the same closed-copy override. has_target has
  // already been widened upstream with the same predicate; caller
  // passes it here so we don't recompute.
  const rangeIsAlignedExplicit = range_kind === "explicit" && has_target;
  const closedCopyOverride = (has_target && (rangeIsClosed || rangeIsFytdClosed || rangeIsAlignedExplicit))
    ? (statusTone === "good" ? "Period closed · on target" : "Period closed · off target")
    : null;
  const finalStateCopy = closedCopyOverride
    || (has_target ? ticker.state_copy : "No target");

  return {
    state: has_target ? ticker.state : "on_track_below",
    state_copy: finalStateCopy,
    tone: statusTone,
  };
}

// Kevin 2026-09-02 language pass: one helper emits every "thru P#"
// / "P1-P8" / period-descriptor label the board renders. Client reads
// verbatim - no per-surface rewrite. `P#` is dynamic:
//   FYTD                -> last closed period (PR-1 boundary)
//   Single closed range -> that period
//   Single open range   -> "period to date" (the period isn't "through"
//                          anything yet, per the ruling)
//
// Shape:
//   {
//     kind: "fytd" | "single_open" | "single_closed" | "explicit",
//     through: "thru P8" | "period to date" | "final" | "to date",
//     period_span: "P1-P8" | "P8" | null,
//     period_last: "P8" | null,
//   }
function buildRangeLabels({ range, rangeComposition, periodState, lastCompleteWk, effectiveEndISO, todayISO }) {
  const rc = rangeComposition;
  // Kevin ruling 2026-09-08. Explicit ranges that align to WHOLE
  // period boundaries render fytd-style labels (P1-P8 · closed and
  // verified). Otherwise they carry no target and the horizon path
  // never fires. Widens the fytd branch to catch This year post-R-93
  // (kind="explicit" with settle-day end). Same predicate the
  // has_target check uses upstream.
  const explicitAlignsToPeriods = (() => {
    if (range.kind !== "explicit" || !range.start || !range.end) return false;
    let matchStart = false;
    let matchEnd = false;
    for (let p = 1; p <= 13; p += 1) {
      if (periodStartISO(p) === range.start) matchStart = true;
      if (periodEndISO(p) === range.end) matchEnd = true;
    }
    return matchStart && matchEnd;
  })();
  const isFytd = range.kind === "fytd" || explicitAlignsToPeriods;
  const isSinglePeriod = range.kind === "period";
  const isSingleOpen = isSinglePeriod && periodState === "open";
  const isSingleClosed = isSinglePeriod && !isSingleOpen;

  // Kevin ruling R-63 (2026-09-03): the "as of when" answer for the
  // horizon line above the cards. Closed ranges read "P1-P8 · closed
  // and verified" / "P8 · closed and verified"; open ranges read
  // "through week N · MM/DD – MM/DD" where N + dates come from the
  // last complete week helper. Rendered server-side so the value is
  // one string in one place.
  const fmtMMDD = (iso) => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : null;
  let horizon = null;
  // Kevin ruling this-period (2026-09-03) item 3: revenue table's
  // plan-column header names the span. On open the range is partial
  // ("WK 1 – WK 3") since no complete period; on closed the range
  // IS the period ("P8", or "P1-P8" on FYTD).
  //
  // Kevin ruling PR-B item 2 (2026-09-03): the revenue table now
  // renders BOTH a budget and an actuals column - same span header
  // suffixed by "BUDGET" / "ACTUALS" respectively. Emit the span
  // by itself so the render composes both column heads without
  // duplicating the branching. `forecast_header` stays for backward
  // compat with other consumers of the range-labels shape.
  let spanHeader = null;
  if (isSingleOpen) {
    // Kevin ruling 2026-09-08. Current period horizon reads
    // "P{n} · week X of 4 · day Y of Z" - progress-oriented, matches
    // the running-period render of record. Replaces the prior
    // closed-week-oriented "through week N" / "no complete weeks yet"
    // forms; both were the This year treatment leaking onto the
    // running period. Sub-line beside the "Period running" pill.
    const runningWk = (lastCompleteWk?.weekNo ?? 0) + 1;
    let dayNo = null;
    let totalDays = null;
    if (todayISO && range.start && range.end) {
      const parseISO = (iso) => {
        const mm = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return mm ? new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3])) : null;
      };
      const s = parseISO(range.start), e = parseISO(range.end), t = parseISO(todayISO);
      if (s && e && t) {
        const MSD = 86400000;
        totalDays = Math.floor((e.getTime() - s.getTime()) / MSD) + 1;
        dayNo = Math.min(totalDays, Math.max(1, Math.floor((t.getTime() - s.getTime()) / MSD) + 1));
      }
    }
    const pNo = range.period_no != null ? `P${range.period_no}` : "This period";
    if (dayNo != null && totalDays != null) {
      horizon = `${pNo} · week ${runningWk} of 4 · day ${dayNo} of ${totalDays}`;
    } else {
      horizon = `${pNo} · week ${runningWk} of 4`;
    }
    spanHeader = lastCompleteWk
      ? (lastCompleteWk.weekNo === 1 ? "WK 1" : `WK 1 – WK ${lastCompleteWk.weekNo}`)
      : "WK 1";
  } else if (isSingleClosed && range.period_no != null) {
    // Kevin post-1049 sweep item 1 (2026-09-07). #1046 fixed this
    // on This year but overlooked single_closed. Last period on
    // TBJ - FL P9 said "closed and verified" while pnl_actuals had
    // P1-P8 only. Check the awaiting bucket - if this period is
    // in it, name the state honestly.
    const isAwaiting = rc?.awaiting?.count > 0
      && rc.awaiting.first === range.period_no
      && rc.awaiting.last === range.period_no;
    // Kevin R-94 (2026-09-09): awaiting horizon names the CLOSE
    // DATE + explains the state ("figures still settling") so a
    // reader sees why the pill went amber. Verified state keeps
    // its terse "closed and verified" form.
    if (isAwaiting) {
      const pEnd = periodEndISO(range.period_no);
      const md = pEnd ? `${pEnd.slice(5, 7)}/${pEnd.slice(8, 10)}` : "";
      horizon = md
        ? `P${range.period_no} · closed ${md} · figures still settling`
        : `P${range.period_no} · awaiting verification`;
    } else {
      horizon = `P${range.period_no} · closed and verified`;
    }
    spanHeader = `P${range.period_no}`;
  } else if (isFytd) {
    // Kevin walkthrough item 3 (2026-09-07). Prior FYTD label read
    // "P1-P8 · closed and verified" using verified.first + verified.last,
    // which lagged the data (revenue aggregate already included P9
    // via the closed_awaiting picker). Use `settled` (verified +
    // awaiting = all calendar-closed periods) for the span, and
    // append the awaiting note when a period is closed but not yet
    // finance-verified.
    const sfirst = rc?.settled?.first ?? rc?.verified?.first ?? 1;
    const slast = rc?.settled?.last ?? rc?.verified?.last ?? rc?.periods_total ?? 1;
    const spanCopy = sfirst === slast ? `P${slast}` : `P${sfirst}-P${slast}`;
    const awaitingSuffix = rc?.awaiting?.count
      ? ` · ${rc.awaiting.label} awaiting verification`
      : " · closed and verified";
    horizon = `${spanCopy}${awaitingSuffix}`;
    spanHeader = spanCopy;
  }
  // Kevin walkthrough sweep addendum item A (2026-09-07): the header
  // reads "PROJECTION" on every revenue surface. `forecast_header` key
  // preserved for backwards compat with existing consumers - only the
  // string value flips.
  const forecastHeader = spanHeader ? `${spanHeader} PROJECTION` : "PROJECTION";
  const budgetHeader   = spanHeader ? `${spanHeader} BUDGET`   : "BUDGET";
  const actualsHeader  = spanHeader ? `${spanHeader} ACTUALS`  : "ACTUALS";

  // Kevin R-60 + PR-B items 1-5 (2026-09-03): a closed period is not
  // "through" anything - it is settled. `Final P#` replaces every
  // "thru P#" on a single-closed range. The `through` field also
  // switches its preposition from "thru" to "in" so descriptors like
  // "of revenue thru P8" read as "of revenue in P8".
  //
  //   through   - inline preposition phrase ("of revenue thru P8",
  //               "of revenue in P8", "of revenue period to date")
  //   actuals   - noun phrase for actuals headers/hero ("Final P8",
  //               "thru P8", "period to date"). Same string as
  //               `through` on FYTD + single_open; differs on
  //               single_closed.
  if (isFytd) {
    // Kevin walkthrough item 3 - use `settled` span (verified +
    // awaiting) so labels match the data. Falls back to verified
    // then periods_total to stay defined on legacy composition
    // shapes.
    const first = rc?.settled?.first ?? rc?.verified?.first ?? 1;
    const last = rc?.settled?.last ?? rc?.verified?.last ?? rc?.periods_total ?? 1;
    const thruLast = `thru P${last}`;
    return {
      kind: "fytd",
      through: thruLast,
      actuals: thruLast,
      period_span: first === last ? `P${last}` : `P${first}-P${last}`,
      period_last: `P${last}`,
      horizon,
      forecast_header: forecastHeader,
      budget_header: budgetHeader,
      actuals_header: actualsHeader,
      effective_end_iso: effectiveEndISO,
    };
  }
  if (isSingleOpen) {
    const n = range.period_no;
    return {
      kind: "single_open",
      through: "period to date",
      actuals: "period to date",
      period_span: n != null ? `P${n}` : null,
      period_last: n != null ? `P${n}` : null,
      horizon,
      forecast_header: forecastHeader,
      budget_header: budgetHeader,
      actuals_header: actualsHeader,
      effective_end_iso: effectiveEndISO,
    };
  }
  if (isSingleClosed) {
    const n = range.period_no;
    return {
      kind: "single_closed",
      through: `in P${n}`,
      actuals: `Final P${n}`,
      period_span: `P${n}`,
      period_last: `P${n}`,
      horizon,
      forecast_header: forecastHeader,
      budget_header: budgetHeader,
      actuals_header: actualsHeader,
      effective_end_iso: effectiveEndISO,
    };
  }
  return {
    kind: "explicit",
    through: "to date",
    actuals: "to date",
    period_span: null,
    period_last: null,
    horizon,
    forecast_header: forecastHeader,
    effective_end_iso: effectiveEndISO,
  };
}

// Range composition (Kevin 2026-09-02 blocker). One field, one truth,
// four consumers. See the callsite at step 7b for the classification
// rule and the invariant every range must satisfy.
//
// Shape:
//   {
//     periods_total: 9,
//     verified: { count, first, last, label },
//     live:     { count, first, last, label },
//     planned:  { count, first, last, label },
//     will_change_at_close: bool,
//     summary: "P1-P8 verified · P9 still running"
//   }
//
// The Sheets audit was clear that composition matters more than any
// single-source label ("Revenue · Service Calendar · Tue 09/01" named
// the 7% while omitting the 93%). This function is the single
// authority - do NOT reproduce its logic on the client.
function buildRangeComposition({ periods, perPeriodRevenue }) {
  const verifiedNos = [];
  const awaitingNos = [];
  const liveNos = [];
  const plannedNos = [];
  for (const p of periods) {
    const entry = perPeriodRevenue.get(p);
    if (!entry) {
      plannedNos.push(p);
      continue;
    }
    const state = entry.state;
    let sawSc = false;
    for (const [key, v] of Object.entries(entry)) {
      if (key === "state") continue;
      if (v && Array.isArray(v.sources)) {
        for (const s of v.sources) {
          if (s === "sc_daily_revenue") { sawSc = true; break; }
        }
      }
      if (sawSc) break;
    }
    // Kevin walkthrough sweep item 3 (2026-09-07). The `closed_awaiting`
    // state already existed in the pnl-loader (calendar-closed OR
    // record-closed but P&L not yet posted) but did not surface here
    // - it fell through to `live` or `planned`. On TBJ - FL FYTD today
    // the label read "P1-P8 · closed and verified" while the revenue
    // aggregate included P9's $104,995 (SC-sourced on the picker's
    // closed_awaiting branch). Two lies at once: wrong span + a
    // "verified" claim about a period finance has not posted.
    //
    // Kevin ruling: include P9 in the label, name the awaiting state
    // explicitly. Add `awaiting` bucket. Downstream label helpers
    // read `settled.label` (verified + awaiting) as the span and
    // append "· PN awaiting verification" when awaiting.count > 0.
    if (state === "verified") verifiedNos.push(p);
    else if (state === "closed_awaiting") awaitingNos.push(p);
    else if (sawSc) liveNos.push(p);
    else plannedNos.push(p);
  }
  const shape = (arr) => {
    if (arr.length === 0) return { count: 0, first: null, last: null, label: null };
    const first = arr[0];
    const last = arr[arr.length - 1];
    return {
      count: arr.length,
      first,
      last,
      label: first === last ? `P${first}` : `P${first}-P${last}`,
    };
  };
  const verified = shape(verifiedNos);
  const awaiting = shape(awaitingNos);
  const live = shape(liveNos);
  const planned = shape(plannedNos);
  // Settled = calendar-closed periods, whether verified or awaiting P&L.
  // The label reader wants the whole closed span so a chef sees the
  // range they are looking at, not just the verified subset.
  const settledNos = [...verifiedNos, ...awaitingNos].sort((a, b) => a - b);
  const settled = shape(settledNos);
  const willChange = verified.count < periods.length;
  const parts = [];
  if (verified.count) parts.push(`${verified.label} verified`);
  if (awaiting.count) parts.push(`${awaiting.label} awaiting verification`);
  if (live.count) parts.push(`${live.label} still running`);
  if (planned.count) parts.push(`${planned.label} planned`);
  const summary = parts.length ? parts.join(" · ") : null;
  return {
    periods_total: periods.length,
    verified,
    awaiting,
    settled,
    live,
    planned,
    will_change_at_close: willChange,
    summary,
  };
}

function labelForLine(code) {
  switch (code) {
    case "2200":  return "Catering revenue";
    case "2300":  return "Service charges";
    case "2400.1": return "Meal service (home)";
    case "2400.2": return "Meal service (away)";
    case "2600":  return "Consulting";
    case "3100":  return "Kitchen labor";
    case "3200":  return "Food purchased";
    case "3400":  return "Packaging and supplies";
    case "3500":  return "Vehicle";
    default:      return code;
  }
}
