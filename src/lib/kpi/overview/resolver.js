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
import { buildBoard } from "@/app/kpi/labor/lib/board.js";
import { paginateActuals as paginateLaborActuals, resolveMemberBudget } from "@/lib/labor/loaders.js";
import { resolveWorkerMeta } from "@/lib/kpi/resolveWorkerMeta.js";
import { buildWorkerToEmail } from "@/lib/labor/personCount.js";
// Salary-side loaders + merge helper. Overview ALWAYS composes labor
// with salary included (R-28, §5.9): "Salary control reveals sub-lines
// only; totals always include salary. Gross margin must equal
// finance's, and finance's includes salary." The `includeSalary` flag
// on this resolver is a DISCLOSURE toggle for the 3100.1 / 3100.2
// sub-rows in the statement; it never changes the 3100 total or any
// derived figure (COGS, gross margin, ticker, chart).
import { load3100_2Budgets, loadSalaryActuals, mergeBudgetPeriods, shapeSalaryRow } from "@/lib/labor/salaryBoard.js";

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
  loadScDailyRevenue,
  derivePeriodState,
  capBeforeToday,
} from "./pnl-loader.js";
import { resolveRevenueSource, classifyForRevenue, assertScReadAllowed } from "./revenue-source.js";
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

import { periodOf, periodStartISO, periodEndISO, weekStartsInRange } from "@/app/kpi/labor/lib/periods.js";
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

// Range resolution. `range` inputs:
//   - { kind: 'fytd' }
//   - { kind: 'period', period_no: N }
//   - { kind: 'explicit', start, end }
function resolveRange({ range, today }) {
  if (!range || range.kind === "fytd") {
    return {
      start: FY_START_ISO,
      end: today,
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

// Compute per-period revenue: pick the source per period and produce
// { amount, reported: bool, source, model } for each period.
function computePeriodRevenueByLine({
  members,
  periods,
  periodStatus,
  accountFlags,
  todayISO,
  overviewBudgets,
  pnl,
  scByAcct,
  revSource,
  scope,   // { accountKey, kind: 'single' | 'aggregate' }
}) {
  // Per-period, per-member picker. For an aggregate, we roll UP the
  // per-member picks (source per member because per-meal vs fee can
  // mix across members in ALL / EAST / WEST).
  const perPeriod = new Map();  // period -> { line_code -> { amount, reported, sources[] } }
  for (const p of periods) {
    const statusRow = periodStatus.get(p) || null;
    const state = derivePeriodState({ periodNo: p, todayISO, periodStatusRow: statusRow });
    if (!perPeriod.has(p)) perPeriod.set(p, { state });
    const perP = perPeriod.get(p);
    const memberContribs = new Map();  // line_code -> {amount, reported, sources[]}
    for (const m of members) {
      const flags = accountFlags.get(m) || null;
      const src = resolveRevenueSource({
        accountKey: m,
        periodState: state,
        revSource,
        accountFlags: flags,
      });
      for (const line of src.line_codes) {
        if (!memberContribs.has(line)) {
          memberContribs.set(line, { amount: 0, reported: false, sources: new Set(), any_actual: false });
        }
        const bucket = memberContribs.get(line);
        // Pick the number:
        //   source = pnl_actuals_verified  -> pnl_actuals row's `actual`
        //   source = sc_daily_revenue      -> sum sc_daily_revenue for this
        //                                     member across period days
        //   source = kpi_budgets_*         -> budget-to-date proration by
        //                                     day for the current period,
        //                                     full budget for closed
        //                                     (contractual / estimate /
        //                                     planned / tracked all use
        //                                     kpi_budgets amount)
        if (src.source === "pnl_actuals_verified") {
          const row = pnl.get(m)?.get(p)?.get(line);
          if (row && row.actual != null) {
            bucket.amount += Number(row.actual);
            bucket.any_actual = true;
          }
          // Absent = not reported. Don't contribute.
          bucket.sources.add("pnl_actuals");
        } else if (src.source === "sc_daily_revenue") {
          // Guard - belt-and-suspenders (picker already checked).
          try { assertScReadAllowed({ accountKey: m, revSource, accountFlags: flags }); }
          catch (e) { throw e; }
          // For SC, we only credit line 2400.1 (the per-meal service line;
          // sc_daily_revenue represents meal-service revenue only).
          if (line === "2400.1") {
            const byDate = scByAcct.get(m);
            if (byDate) {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              // The period runs pStart..pEnd; SC data through
              // yesterday is what the render displays "through DATA_
              // THRU". Sum EVERY sc day in the period that we have
              // (up to today; the resolver crops if end > today).
              for (const [day, amt] of byDate) {
                if (day >= pStart && day <= pEnd) {
                  bucket.amount += Number(amt);
                  bucket.any_actual = true;
                }
              }
            }
            bucket.sources.add("sc_daily_revenue");
          }
        } else {
          // kpi_budgets_* (contractual / estimate / planned / tracked).
          // For a CLOSED period => full budget. For OPEN period =>
          // budget-to-date by days. Compute here.
          const byAcct = overviewBudgets.get(line)?.get(m);
          const amtRaw = byAcct?.get(p);
          if (amtRaw != null) {
            if (state === "open") {
              const pStart = periodStartISO(p);
              const pEnd = periodEndISO(p);
              // Days elapsed through yesterday inclusive.
              const parseISOUTC = (iso) => {
                const mm = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!mm) return null;
                return new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3]));
              };
              const MSD = 86400000;
              const pS = parseISOUTC(pStart), pE = parseISOUTC(pEnd), tD = parseISOUTC(todayISO);
              if (pS && pE && tD) {
                const daysIn = Math.floor((pE.getTime() - pS.getTime()) / MSD) + 1;
                const elapsed = Math.min(daysIn, Math.max(0, Math.floor((tD.getTime() - pS.getTime()) / MSD)));
                bucket.amount += Number(amtRaw) * (elapsed / daysIn);
                bucket.any_actual = true;   // budget contributes (planned or contractual)
              }
            } else {
              // Closed - full period budget (fee accounts get contract;
              // per-meal closed_awaiting gets budget as estimate).
              bucket.amount += Number(amtRaw);
              bucket.any_actual = true;
            }
          }
          bucket.sources.add(src.source);
        }
      }
    }
    // Fold member contribs -> period contribs.
    for (const [line, b] of memberContribs) {
      if (!perP[line]) perP[line] = { amount: 0, reported: false, sources: [] };
      if (b.any_actual) {
        perP[line].amount += b.amount;
        perP[line].reported = true;
      }
      perP[line].sources.push(...[...b.sources]);
    }
  }
  return perPeriod;
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
    loadScDailyRevenue(supa, { members, start: rng.start, end: rng.end, today }),
    paginateLaborActuals(supa, { members, start: rng.start, end: rng.end }),
    Promise.all(members.map(m => resolveMemberBudget(supa, m))),
    paginatePurchasingWeekly(supa, { members, start: rng.start, end: rng.end }),
    paginatePurchasingActuals(supa, { members, start: rng.start, end: rng.end }),
    loadPurchasingPending(supa, { members, start: rng.start, end: rng.end }),
    loadPurchasingBudgets(supa, members, FISCAL_YEAR),
    // R-28 / §5.9 - salary is composed INTO 3100 unconditionally on
    // both postures. These two loaders feed the merge in step 5
    // (buildBoard) below.
    load3100_2Budgets(supa, members),
    loadSalaryActuals(supa, members, rng.start, rng.end),
    // P2-1 (2026-09-01): live accounts_directory for the folio rail.
    // Global read (independent of members). Cheap - one SELECT.
    fetchAccountsDirectoryOv(supa),
    // P2-4b / P2-4d (2026-09-01): purchasing freshness for cards_
    // through (last CLOSED card date) + last_derive_at (drives the
    // Overview's command-bar freshness chip via last_walk_at echo).
    loadPurchasingFreshness(supa),
  ]));
  const [
    periodStatusResp, accountFlagsResp, overviewBudgetsResp, pnlResp,
    scResp, laborActualsResp, memberBudgetResults,
    purchWeeklyResp, purchActualsResp, purchPendingResp, purchBudgetsResp,
    salaryBudgetsResp, salaryActualsResp,
    dirResp, purchFreshness,
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
  const mergedBudget = mergeBudgetPeriods(laborBudgetPeriodsHourly, salaryBudgetByPeriod);
  const laborBudgetPeriods = mergedBudget.periods;
  // Merged per-period map (hourly + salary) for downstream consumers
  // (chart series per-period labor budget point). Kept as a Map to
  // mirror laborBudgetSumMap's shape; chart consumers switch to this
  // so the chart's per-period labor budget line matches the composed
  // labor total (never hourly-only, matching R-28 §5.9).
  const laborBudgetSumMapMerged = new Map();
  for (const bp of laborBudgetPeriods) {
    laborBudgetSumMapMerged.set(bp.period_no, Number(bp.amount || 0));
  }

  // 5. Call labor buildBoard as a library call, on the merged (hourly +
  //    salary) inputs. account_state stays "hourly_ok" - the salaried-
  //    only single accounts (CIN - KY, TBJ - NY) fall out with
  //    applies:false when there are no hourly rows AND no salary rows;
  //    when salary rows exist they get a real board (matches the labor
  //    route's D26 salary-on branch, salaryBoard.js line 222-232).
  const salaryActualsShaped = salaryRows.map(shapeSalaryRow);
  const mergedLaborActuals = (laborActuals || []).concat(salaryActualsShaped);
  const laborBoard = await timeIt("buildBoard(labor)", async () => buildBoard({
    account: accountKey,
    start: rng.start,
    end: rng.end,
    today,
    actuals: mergedLaborActuals,
    budget_periods: laborBudgetPeriods,
    account_state: "hourly_ok",
    workerToEmail,
  }));

  // 6. Call purchasing buildPurchasingBoard as a library call.
  const purchBoard = await timeIt("buildBoard(purchasing)", async () => buildPurchasingBoard({
    members,
    start: rng.start,
    end: rng.end,
    today,
    actualsRows: purchActuals,
    weeklyRows: purchWeekly,
    pendingRow: purchPending,
    budgetMap: purchBudgets,
  }));

  // 7. Compute per-period revenue by line + range totals.
  const perPeriodRevenue = computePeriodRevenueByLine({
    members,
    periods,
    periodStatus,
    accountFlags,
    todayISO: today,
    overviewBudgets,
    pnl,
    scByAcct,
    revSource: effRevSource,
    scope: { accountKey, kind: isAggregate ? "aggregate" : "single" },
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
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today });
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

  const food_actual = purchBoard.buckets["3200"]?.period_total ?? null;
  const food_budget = purchBoard.buckets["3200"]?.budget ?? null;
  const packaging_actual = purchBoard.buckets["3400"]?.period_total ?? null;
  const packaging_budget = purchBoard.buckets["3400"]?.budget ?? null;
  const vehicle_actual = purchBoard.buckets["3500"]?.period_total ?? null;
  const vehicle_budget = purchBoard.buckets["3500"]?.budget ?? null;

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
  const has_target = (rng.kind === "period" || rng.kind === "fytd")
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

  // PR-1 item 2 (2026-09-02). Envelope + pace helpers.
  // revenue_pace_pct: how far revenue came in against its own budget-
  //   to-date. Not a target percent - a pace measurement on revenue.
  // budget_at_this_revenue: the cost the target percent buys at the
  //   revenue actually earned (line_target_pct * actual_revenue).
  // envelope_delta: budget_to_date - budget_at_this_revenue. Positive
  //   means the envelope shrank (revenue short); negative grew.
  const revenue_pace_pct = (totalRevenue != null && revenue_budget_to_date != null && revenue_budget_to_date > 0)
    ? r2((totalRevenue / revenue_budget_to_date) * 100) : null;
  const budgetAtThisRevenue = (lineBudget) => {
    if (!has_target || totalRevenue == null || lineBudget == null) return null;
    const lineTarget = lineBudget / revenue_budget_full_period; // ratio, not pct
    return r2(totalRevenue * lineTarget);
  };
  const envelopeDelta = (btd, batr) => (btd == null || batr == null) ? null : r2(btd - batr);

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
        return revenueDelta >= 0
          ? { label: "Above budget", tone: "good" }
          : { label: "Below budget", tone: "bad" };
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
      envelope_delta: envelopeDelta(r2(cogsBudgetToDateDays), budgetAtThisRevenue(cogsBudget)),
      delta_dollars: r2(cogsDelta),
      delta_display: gapDollarsCost(cogsDelta),
      delta_direction: directionOfDelta(cogsDelta, "cost"),
      delta_pct_display: has_target ? gapPointsCost(pctOf(cogsActual, totalRevenue) - pctOf(cogsBudget, revenue_budget_full_period)) : null,
      pill: (() => {
        // PR-1 item 1: rolling window -> "No target", neutral tone.
        if (!has_target) return { label: "No target", tone: "neutral" };
        const pa = pctOf(cogsActual, totalRevenue);
        const pt = pctOf(cogsBudget, revenue_budget_full_period);
        if (pa == null || pt == null) return { label: "No data", tone: "neutral" };
        // B6 (2026-09-01): the gap moves INTO the pill. Prior copy was
        // "Under target" plus a separate "10.4% under" below - two
        // statements of one fact. Now the pill carries both.
        const absPct = Math.abs(Number(pa) - Number(pt)).toFixed(1);
        return pa <= pt
          ? { label: `${absPct}% UNDER TARGET`, tone: "good" }
          : { label: `${absPct}% OVER TARGET`, tone: "bad" };
      })(),
      mini: [
        { label: "Labor",     actual: labor3100_actual, display: formatMoneyWhole(labor3100_actual) },
        { label: "Food",      actual: food_actual,      display: formatMoneyWhole(food_actual) },
        { label: "Packaging", actual: packaging_actual, display: formatMoneyWhole(packaging_actual) },
        { label: "Vehicle",   actual: vehicle_actual,   display: formatMoneyWhole(vehicle_actual) },
      ],
    },
    {
      key: "gross_margin",
      label: "Gross margin",
      hero_actual: grossMargin,
      hero_actual_display: formatMoneyWhole(grossMargin),
      hero_reported: totalRevReported,
      budget_to_date: grossMarginBudget,
      budget_to_date_display: formatMoneyWhole(grossMarginBudget),
      pct_of_revenue: gmPctActual,
      pct_of_revenue_display: formatPct(gmPctActual),
      // PR-1 item 1: null target when !has_target.
      target_pct_of_revenue: has_target ? gmPctBudget : null,
      target_pct_display: has_target ? formatPct(gmPctBudget) : null,
      delta_dollars: gmDelta,
      delta_display: gmDelta != null ? gapDollarsMargin(gmDelta) : null,
      delta_direction: gmDelta != null ? directionOfDelta(gmDelta, "margin") : null,
      delta_pct_display: (has_target && gmPctActual != null && gmPctBudget != null) ? gapPointsMargin(gmPctActual - gmPctBudget) : null,
      pill: (() => {
        // PR-1 item 1: rolling window -> "No target", neutral tone.
        if (!has_target) return { label: "No target", tone: "neutral" };
        if (gmPctActual == null || gmPctBudget == null) return { label: "No data", tone: "neutral" };
        // B6 (2026-09-01): the gap moves INTO the pill. Same pattern
        // as COGS above - one statement, not two.
        const absPct = Math.abs(Number(gmPctActual) - Number(gmPctBudget)).toFixed(1);
        return gmPctActual >= gmPctBudget
          ? { label: `${absPct}% AHEAD`, tone: "good" }
          : { label: `${absPct}% BEHIND`, tone: "warn" };
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
      envelope_delta: envelopeDelta(budgetToDate, batr),
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
    const wkBudget = laborBoard?.applies && laborBoard.range_budget != null
      ? r2((laborBoard.range_budget + (purchBoard.totals.buckets_budget || 0)) / weekStarts.length)
      : null;
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
    // C13 (2026-09-01): bar hover leads with the period + its dates.
    // The chart carries the period_no so the tooltip header can read
    // "Period 9 · Week 2" rather than the standalone "Week 2" the
    // prior render used - naming the period + the week is what makes
    // the tooltip legible on FYTD screenshots where the period is
    // otherwise off-screen.
    chart = { grain: "week", series, weekly_budget: wkBudget, period_no: rng.period_no };
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
      return {
        period_no: p,
        state,
        spent: state === "not_started" ? null : r2((laborByPeriod.get(p) || 0) + (purchByPeriod.get(p) || 0)),
        budget: r2(laborBudP + purchBudP),
      };
    });
    chart = { grain: "period", series };
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
    const bto = computeBudgetToDateForLine({ budgetByPeriod: byPeriod, periodsInRange: periods, today });
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
      variance: (!labor3100_inactive && labor3100_actual != null && labor3100_budget_to_date_days != null) ? r2(labor3100_actual - labor3100_budget_to_date_days) : null,
      variance_pct: (has_target && !labor3100_inactive && _actPct != null && _tgtPct != null) ? r2(_actPct - _tgtPct) : null,
      actual_pct: labor3100_inactive ? null : _actPct,
      target_pct: labor3100_inactive ? null : _tgtPct,
      budget_at_this_revenue: labor3100_inactive ? null : _batr,
      envelope_delta: labor3100_inactive ? null : envelopeDelta(labor3100_budget_to_date_days, _batr),
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
    const sumSubLineFromPnl = (lineCode) => {
      let amt = 0;
      let anyReported = false;
      for (const m of members) {
        const byAcct = pnl.get(m);
        for (const p of periods) {
          const row = byAcct?.get(p)?.get(lineCode);
          if (row && row.actual != null) {
            amt += Number(row.actual);
            anyReported = true;
          }
        }
      }
      return anyReported ? r2(amt) : null;
    };
    const hourly = sumSubLineFromPnl("3100.1");
    const salary = sumSubLineFromPnl("3100.2");
    statementRows.push({
      line_code: "3100.1",
      section: "cogs",
      parent_line_code: "3100",
      label: "Hourly wages",
      reported: hourly != null,
      actual: hourly,
      budget_to_date: null,
      period_budget: null,
      variance: null,
      variance_pct: null,
      actual_pct: pctOf(hourly, totalRevenue),
      target_pct: null,
      sources: ["pnl_actuals"],
      flags: [],
    });
    statementRows.push({
      line_code: "3100.2",
      section: "cogs",
      parent_line_code: "3100",
      label: "Salary wages",
      reported: salary != null,
      actual: salary,
      budget_to_date: null,
      period_budget: null,
      variance: null,
      variance_pct: null,
      actual_pct: pctOf(salary, totalRevenue),
      target_pct: null,
      sources: ["pnl_actuals"],
      flags: [],
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
  const buildCostRow = ({ line_code, label, actual, budget, extraFlags = [] }) => {
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
      variance: (!suppress && actual != null && btd != null) ? r2(actual - btd) : null,
      variance_pct: (has_target && !suppress && _actPct != null && _tgtPct != null) ? r2(_actPct - _tgtPct) : null,
      actual_pct: _actPct,
      target_pct: _tgtPct,
      budget_at_this_revenue: _batr,
      envelope_delta: (suppress || btd == null) ? null : envelopeDelta(btd, _batr),
      sources: ["purchasing_actuals"],
      flags: [
        ...(billed_back ? ["billed_back"] : []),
        ...(inactive ? ["inactive"] : []),
        ...extraFlags,
      ],
    };
  };
  statementRows.push(buildCostRow({
    line_code: "3200",
    label: "Food purchased",
    actual: food_actual,
    budget: food_budget,
  }));
  statementRows.push(buildCostRow({
    line_code: "3400",
    label: "Packaging and supplies",
    actual: packaging_actual,
    budget: packaging_budget,
    extraFlags: flags.packaging_gap ? ["packaging_gap"] : [],
  }));
  statementRows.push(buildCostRow({
    line_code: "3500",
    label: "Vehicle",
    actual: vehicle_actual,
    budget: vehicle_budget,
  }));

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
    { line_code: "5002.1", label: "General repair and maintenance", actual: rm_actual, budget: rm_budget },
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

  // 18c. "What is left" (R-34, 2026-09-01).
  //
  // The one operator number that converts to a decision today. Open
  // period only, site posture only, single-period range only.
  // Absent on closed periods (a review surface does not steer) and
  // absent on FYTD (applying an open period's remaining days to a year
  // is wrong arithmetic - explicit R-34 rule).
  //
  // Three cells, all formatted server-side per §9B:
  //   1. Cost of goods left to spend = period_budget - actual_to_date
  //   2. Per day left = left / days_remaining
  //      Comparison: per_day_so_far = actual / days_elapsed
  //   3. Budget used pct = actual / period_budget
  //      Compared to elapsed pct = days_elapsed / days_in_period
  //      Verdict = "spending slower/faster than the clock"
  //
  // No projection ("at this pace margin closes at X%") - that is an
  // identity under linear accrual, not a forecast (R-33). Never
  // shipped from this resolver.
  // R-40 (2026-09-01): what_is_left gate is SCOPE-based, not role-
  // based. Everyone at single-account scope on an open period sees
  // it. Portfolio scope (ALL / EAST / WEST) and closed periods and
  // FYTD do not - unchanged from before.
  let whatIsLeft = null;
  const isSingleAccountScope = !isAggregate;
  const isSinglePeriodRange = rng.kind === "period";
  const isOpenPeriod = displayPeriodState === "open";
  if (isSingleAccountScope && isSinglePeriodRange && isOpenPeriod && displayPeriodNo != null) {
    // Compute period bounds + elapsed. R-25: days elapsed is COUNTED
    // THROUGH YESTERDAY, never through today - today is not closed.
    //
    // 2026-09-01 defect fix: prior implementation had `+ 1` on
    // rawElapsed which included today in the count, producing
    // days_elapsed=23 / days_remaining=5 / elapsed_pct=82.14% while
    // the revenue card's budget_to_date was 22/28 (through yesterday)
    // on the same page - two different day counts of the same period.
    // Removes the +1 so this block agrees with the same formula in
    // budget-to-date.js line 84 (daysThroughYesterday = floor((today
    // - pStart) / MSD)). One number, one function.
    const pStart = periodStartISO(displayPeriodNo);
    const pEnd = periodEndISO(displayPeriodNo);
    const MSD = 24 * 60 * 60 * 1000;
    const tS = new Date(`${pStart}T00:00:00Z`);
    const tE = new Date(`${pEnd}T00:00:00Z`);
    const tT = new Date(`${today}T00:00:00Z`);
    const daysInPeriod = Math.max(1, Math.round((tE.getTime() - tS.getTime()) / MSD) + 1);
    // Days elapsed = calendar days from period start THROUGH YESTERDAY
    // inclusive. Formula: floor((today - pStart) / MSD).
    //   today  =  pStart          -> 0 days elapsed (first day, nothing closed)
    //   today  =  pStart + 1 day  -> 1 day elapsed  (yesterday closed)
    //   today  =  pEnd            -> daysInPeriod - 1 days elapsed
    //   today  =  pEnd + 1 day    -> daysInPeriod   days elapsed (all closed)
    const daysThroughYesterday = Math.floor((tT.getTime() - tS.getTime()) / MSD);
    const daysElapsed = Math.min(daysInPeriod, Math.max(0, daysThroughYesterday));
    const daysRemaining = Math.max(0, daysInPeriod - daysElapsed);
    // Period-full COGS budget = sum of the four lever full-period
    // budgets. cogsBudget above is the full-period figure (not the
    // to-date-days-adjusted one).
    const cogsBudgetFullPeriod = cogsBudget;
    const cogsLeft = cogsBudgetFullPeriod != null && cogsActual != null
      ? r2(cogsBudgetFullPeriod - cogsActual)
      : null;
    const perDayLeft = cogsLeft != null && daysRemaining > 0
      ? r2(cogsLeft / daysRemaining)
      : null;
    const perDaySoFar = cogsActual != null && daysElapsed > 0
      ? r2(cogsActual / daysElapsed)
      : null;
    const budgetUsedPct = cogsActual != null && cogsBudgetFullPeriod > 0
      ? r2((cogsActual / cogsBudgetFullPeriod) * 100)
      : null;
    const elapsedPct = daysInPeriod > 0
      ? r2((daysElapsed / daysInPeriod) * 100)
      : null;
    // Pace verdict: slower means the % of budget used is at or below
    // the % of period elapsed. Faster means over. Copy fixed per the
    // render of record.
    const pace = (budgetUsedPct != null && elapsedPct != null)
      ? (budgetUsedPct <= elapsedPct ? "slower" : "faster")
      : null;
    const paceCopy = pace === "slower"
      ? "spending slower than the clock"
      : (pace === "faster" ? "spending faster than the clock" : null);
    // B8+B9 (2026-09-01): two cards, not three. "Which is" retired -
    // it was left ÷ days, a restatement of the card beside it. The
    // per-day figure moves onto Left to spend. Both cards use the
    // .split layout (headline left, two labelled stats right-aligned).
    whatIsLeft = {
      // Machine values so probes can assert numerics without parsing
      // display strings.
      days_elapsed: daysElapsed,
      days_remaining: daysRemaining,
      days_in_period: daysInPeriod,
      cogs_left: cogsLeft,
      per_day_left: perDayLeft,
      per_day_so_far: perDaySoFar,
      budget_used_pct: budgetUsedPct,
      elapsed_pct: elapsedPct,
      pace,
      // Card 1: Left to spend. Headline dollars remaining, two stats
      // right-aligned. "A day available" is what today's remaining
      // budget would buy per day if spent linearly through period end.
      // "Averaging" is what has actually been spent per day so far -
      // the reality check on the plan.
      left_card: {
        days_left_pill: `${daysRemaining} days left`,
        hero_display: formatMoneyWhole(cogsLeft),
        stats: [
          {
            label: "A day available",
            value_display: formatMoneyWhole(perDayLeft),
          },
          {
            label: "Averaging",
            value_display: formatMoneyWhole(perDaySoFar),
            value_suffix: perDaySoFar != null ? "a day" : null,
          },
        ],
      },
      // Card 2: Budget used. Headline pct of budget consumed, colored
      // by pace. Two stats right-aligned. Behind-the-clock is good.
      used_card: {
        pace_pill: paceCopy
          ? (pace === "slower" ? "Slower than the clock" : "Faster than the clock")
          : null,
        pace_direction: pace === "slower" ? "good" : (pace === "faster" ? "bad" : "neutral"),
        hero_display: formatPct(budgetUsedPct),
        stats: [
          {
            label: "Period gone",
            value_display: formatPct(elapsedPct),
          },
          {
            label: "Spent of budget",
            value_display: formatMoneyWhole(cogsActual),
            value_suffix: cogsBudgetFullPeriod != null
              ? `of ${formatMoneyWhole(cogsBudgetFullPeriod)}`
              : null,
          },
        ],
      },
    };
  }

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
    statement_totals: {
      revenue: {
        period_budget: revenue_budget_full_period,
        budget_to_date: revenue_budget_to_date,
        actual: totalRevenue,
      },
      cogs: {
        period_budget: r2(cogsBudget),
        budget_to_date: r2(cogsBudgetToDateDays),
        actual: r2(cogsActual),
        budget_at_this_revenue: budgetAtThisRevenue(cogsBudget),
        envelope_delta: envelopeDelta(r2(cogsBudgetToDateDays), budgetAtThisRevenue(cogsBudget)),
      },
      gross_margin: {
        period_budget: (revenue_budget_full_period != null) ? r2(revenue_budget_full_period - cogsBudget) : null,
        budget_to_date: grossMarginBudget,
        actual: grossMargin,
      },
    },
    // PR-1 payload additions (2026-09-02).
    has_target,
    revenue_source_state,
    revenue_pace_pct,
    sc_counts_without_dollars,
    also_tracked: alsoTracked,
    drill,
    // R-34 what-is-left. null on corporate posture, closed periods,
    // and FYTD - client hides the strip when this field is null.
    // Corporate payloads have never carried this field; adding it as
    // null preserves the corporate shape at the type-checker level and
    // makes the absence intentional rather than an accident of key
    // ordering.
    what_is_left: whatIsLeft,
    // A3+A4 (2026-09-01): the ticker retired. A single status line
    // replaces it - fixed shape on every account. The pass-through /
    // fee / planned notes were three restatements of a fact already
    // carried by the Revenue card's pill and the billed-back tags,
    // and the longest one forced the ticker to wrap on fee accounts.
    // status_line has NO account-model notes; every account renders
    // the same three segments (GM · lever · progress).
    status_line: buildStatusLine({
      ticker,
      cogsLines: cogsLinesForTicker,
      weeks_closed,
      weeks_total,
      period_state: displayPeriodState,
      has_target,
      range_composition: rangeComposition,
      range_kind: rng.kind,
    }),
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
//   1. "Gross margin <X%> vs <Y%> target"        - always renders when both pcts known
//   2. "<Lever> is <N.N%> under|over its target" - biggest lever, dropped if unknown
//   3. "N of M weeks closed"                     - open period only, dropped otherwise
//
// State + state_copy come from the ticker computation - the classifier
// logic is the same, only the render shape changed.
function buildStatusLine({ ticker, cogsLines, weeks_closed, weeks_total, period_state, has_target, range_composition, range_kind }) {
  if (!ticker) return null;
  const gmActualPct = ticker.gm_pct_actual;
  const gmTargetPct = ticker.gm_pct_target;
  const gm_actual_display = gmActualPct != null ? `${Number(gmActualPct).toFixed(1)}%` : null;
  // PR-1 item 1 (2026-09-02): drop the target display + biggest-lever
  // segment when has_target is false. State pill flips to "No target"
  // neutral. Cost pcts of revenue remain (ticker keeps them for the
  // internal state classifier), but the sentence renders no target
  // comparison because there isn't one.
  const gm_target_display = (has_target && gmTargetPct != null) ? `${Number(gmTargetPct).toFixed(1)}%` : null;

  // Biggest lever: ticker already ranked levers by |dev_pct|; we take
  // the top one. Direction is cost-axis: dev_pct > 0 means over target.
  let biggest_lever = null;
  if (has_target && ticker.biggest_lever && ticker.biggest_lever.dev_pct != null) {
    const dev = Number(ticker.biggest_lever.dev_pct);
    biggest_lever = {
      label: ticker.biggest_lever.label,
      dev_display: `${Math.abs(dev).toFixed(1)}%`,
      direction: dev > 0 ? "over" : "under",
    };
  }

  // Kevin 2026-09-02 blocker Item 6: FYTD mixed ranges gain a third
  // clause "8 of 9 periods verified". Prior code left FYTD progress
  // null because weeks_closed/weeks_total are only set on single-
  // period ranges - the bar ended abruptly after two clauses.
  // Single-period open ranges keep the weeks-closed clause.
  let progress_display = null;
  if (period_state === "open" && weeks_closed != null && weeks_total != null) {
    progress_display = `${weeks_closed} of ${weeks_total} weeks closed`;
  } else if (range_kind === "fytd" && range_composition && range_composition.periods_total > 1 && range_composition.verified.count < range_composition.periods_total) {
    progress_display = `${range_composition.verified.count} of ${range_composition.periods_total} periods verified`;
  }

  return {
    // PR-1 item 1: "No target" state pill on rolling windows. Neutral
    // tone, no verdict.
    state: has_target ? ticker.state : "on_track_below",
    state_copy: has_target ? ticker.state_copy : "No target",
    gm_actual_display,
    gm_target_display,
    biggest_lever,
    progress_display,
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
  const liveNos = [];
  const plannedNos = [];
  for (const p of periods) {
    const entry = perPeriodRevenue.get(p);
    if (!entry) {
      // Should not happen for periods that came from periodsInRangeFor,
      // but guard for the corporate/empty case. Treat as planned so
      // the invariant holds.
      plannedNos.push(p);
      continue;
    }
    const state = entry.state;
    // Union of sources this period saw across every revenue line +
    // every member. If any member picked sc_daily_revenue this period,
    // the period reads as "live" (verified always wins).
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
    if (state === "verified") verifiedNos.push(p);
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
  const live = shape(liveNos);
  const planned = shape(plannedNos);
  const willChange = verified.count < periods.length;
  const parts = [];
  if (verified.count) parts.push(`${verified.label} verified`);
  if (live.count) parts.push(`${live.label} still running`);
  if (planned.count) parts.push(`${planned.label} planned`);
  const summary = parts.length ? parts.join(" · ") : null;
  return {
    periods_total: periods.length,
    verified,
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
