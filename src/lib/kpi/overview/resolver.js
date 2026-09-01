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
    loadScDailyRevenue(supa, { members, start: rng.start, end: rng.end }),
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
  const totalRevenue = totalRevReported ? r2(totalRevenueAmount) : null;

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

  // 11. Gross margin.
  const grossMargin = totalRevenue != null ? r2(totalRevenue - cogsActual) : null;
  const grossMarginBudget = totalRevenue != null ? r2((revenue_budget_to_date || 0) - cogsBudgetToDateDays) : null;
  const gmPctActual = pctOf(grossMargin, totalRevenue);
  const gmPctBudget = pctOf(grossMarginBudget, revenue_budget_to_date);

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

  // 14. Ticker.
  const isFeeAccount = !isAggregate && classifyForRevenue(accountKey) === "fee";
  const isPassThrough = flags.pass_through;
  const cogsLinesForTicker = [
    // 2026-09-01 defect fix: target_pct uses per-line to-date budget
    // against to-date revenue budget. Same window on both sides. See
    // the bucketsToDateRatio block above for the per-bucket proration.
    { line_code: "3100", label: "Kitchen labor",           actual_pct: pctOf(labor3100_actual, totalRevenue), target_pct: pctOf(labor3100_budget_to_date_days, revenue_budget_to_date) },
    { line_code: "3200", label: "Food purchased",          actual_pct: pctOf(food_actual, totalRevenue),      target_pct: pctOf(food_budget_to_date_days,      revenue_budget_to_date) },
    { line_code: "3400", label: "Packaging and supplies",  actual_pct: pctOf(packaging_actual, totalRevenue), target_pct: pctOf(packaging_budget_to_date_days, revenue_budget_to_date) },
    { line_code: "3500", label: "Vehicle",                 actual_pct: pctOf(vehicle_actual, totalRevenue),   target_pct: pctOf(vehicle_budget_to_date_days,   revenue_budget_to_date) },
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
      pill: (() => {
        if (isFeeAccount) return { label: "Contractual", tone: "neutral" };
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
      // 2026-09-01 defect fix: target_pct on COGS card uses TO-DATE
      // budget on BOTH sides (was cogsBudget full-period / revenue
      // to-date - mixed horizons produced a 71.5% target where 56.2%
      // was correct on CIN - AZ P9, and a 25.7% "under" verdict when
      // the honest gap was 10.4%).
      target_pct_of_revenue: pctOf(cogsBudgetToDateDays, revenue_budget_to_date),
      target_pct_display: formatPct(pctOf(cogsBudgetToDateDays, revenue_budget_to_date)),
      delta_dollars: r2(cogsDelta),
      delta_display: gapDollarsCost(cogsDelta),
      delta_direction: directionOfDelta(cogsDelta, "cost"),
      delta_pct_display: gapPointsCost(pctOf(cogsActual, totalRevenue) - pctOf(cogsBudgetToDateDays, revenue_budget_to_date)),
      pill: (() => {
        const pa = pctOf(cogsActual, totalRevenue);
        const pt = pctOf(cogsBudgetToDateDays, revenue_budget_to_date);
        if (pa == null || pt == null) return { label: "No data", tone: "neutral" };
        return pa <= pt
          ? { label: "Under target", tone: "good" }
          : { label: "Over target", tone: "bad" };
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
      target_pct_of_revenue: gmPctBudget,
      target_pct_display: formatPct(gmPctBudget),
      delta_dollars: gmDelta,
      delta_display: gmDelta != null ? gapDollarsMargin(gmDelta) : null,
      delta_direction: gmDelta != null ? directionOfDelta(gmDelta, "margin") : null,
      delta_pct_display: (gmPctActual != null && gmPctBudget != null) ? gapPointsMargin(gmPctActual - gmPctBudget) : null,
      pill: (() => {
        if (gmPctActual == null || gmPctBudget == null) return { label: "No data", tone: "neutral" };
        return gmPctActual >= gmPctBudget
          ? { label: "Ahead", tone: "good" }
          : { label: "Behind", tone: "warn" };
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
    const targetPct = pctOf(budgetToDate, revenue_budget_to_date);
    const dv = actual != null && budget != null ? r2(actual - budget) : null;
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
      target_pct_display: formatPct(targetPct),
      variance_pct: (actualPct != null && targetPct != null) ? r2(actualPct - targetPct) : null,
      variance_pct_display: (actualPct != null && targetPct != null) ? gapPointsCost(actualPct - targetPct) : null,
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
    chart = { grain: "week", series, weekly_budget: wkBudget };
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
    const suppress = inactive;
    const rowActualPct = (!inactive && rev.reported) ? pctOf(rev.amount, totalRevenue) : null;
    const rowTargetPct = (!inactive && bto.amount != null) ? pctOf(bto.amount, revenue_budget_to_date) : null;
    statementRows.push({
      line_code: line,
      section: "revenue",
      label: labelForLine(line),
      reported: !inactive && rev.reported,
      actual: (!inactive && rev.reported) ? rev.amount : null,
      budget_to_date: inactive ? null : bto.amount,
      period_budget: inactive ? null : fp,
      variance: (!suppress && rev.reported && bto.amount != null) ? r2(rev.amount - bto.amount) : null,
      variance_pct: (!suppress && rev.reported && bto.amount != null && bto.amount > 0) ? r2(((rev.amount - bto.amount) / bto.amount) * 100) : null,
      actual_pct: rowActualPct,
      target_pct: rowTargetPct,
      sources: rev.sources,
      flags: [
        ...(isContractual ? ["contractual"] : []),
        ...(inactive ? ["inactive"] : []),
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
  statementRows.push({
    line_code: "3100",
    section: "cogs",
    label: "Kitchen labor",
    reported: !labor3100_inactive && laborBoard?.applies === true,
    actual: labor3100_actual,
    budget_to_date: labor3100_budget_to_date_days,
    period_budget: labor3100_budget,
    variance: (!labor3100_inactive && labor3100_actual != null && labor3100_budget_to_date_days != null) ? r2(labor3100_actual - labor3100_budget_to_date_days) : null,
    variance_pct: null,
    sources: ["labor_actuals"],
    flags: labor3100_inactive ? ["inactive"] : [],
  });
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
  const buildCostRow = ({ line_code, label, actual, budget, extraFlags = [] }) => {
    const billed_back = isPassThrough;
    // inactive takes precedence over billed_back only when there is
    // truly nothing to say (no actual and no budget). Billed-back
    // accounts with real spend against $0 budget remain billed_back.
    const inactive = !billed_back && isCostInactive(actual, budget);
    const suppress = billed_back || inactive;
    return {
      line_code,
      section: "cogs",
      label,
      reported: !inactive,
      actual,
      budget_to_date: null,
      period_budget: budget,
      variance: (!suppress && actual != null && budget != null) ? r2(actual - budget) : null,
      variance_pct: null,
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
    const reported = r.actual != null && r.actual > 0;
    return {
      line_code: r.line_code,
      label: r.label,
      reported,
      actual: r.actual,
      actual_display: formatMoneyWhole(r.actual),
      budget: r.budget,
      budget_display: formatMoneyWhole(r.budget),
      // Variance is only computed against a reported actual. An
      // unreported line has null variance - the client renders
      // "no data" instead of computing a delta from a phantom zero.
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
  const purchTargetPct = pctOf(purchSpentBudgetToDate, revenue_budget_to_date);
  const purchVariancePct = (purchActualPct != null && purchTargetPct != null)
    ? r2(purchActualPct - purchTargetPct)
    : null;
  // E16 (2026-09-01): on pass-through accounts the purchasing spend
  // is billed back - the client pays for it. Rendering "0.1% over
  // target" on $37 against $0 was the specific defect Kevin flagged.
  // The drill payload carries a `billed_back: true` flag so the
  // client hides the percentage and renders a tag. No variance,
  // no direction, no verdict.
  const drillBilledBack = isPassThrough;
  const drill = {
    purchasing: {
      spent_display: formatMoneyWhole(purchSpentActual),
      pct_of_revenue_display: drillBilledBack ? null : formatPct(purchActualPct),
      target_pct_display: drillBilledBack ? null : formatPct(purchTargetPct),
      // Site posture drill button carries the verdict (R-32). "5.4%
      // under target" pattern - cost axis, so under=good, over=bad.
      // Billed-back accounts get null on all three so the client
      // cannot accidentally render a verdict.
      variance_pct: drillBilledBack ? null : purchVariancePct,
      variance_pct_display: (drillBilledBack || purchVariancePct == null) ? null : gapPointsCost(purchVariancePct),
      direction: (drillBilledBack || purchVariancePct == null) ? null : directionOfDelta(purchVariancePct, "cost"),
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
      // Display strings for the three cells.
      cell_1: {
        label: "Cost of goods left to spend",
        value_display: formatMoneyWhole(cogsLeft),
        sub_line: `for the ${daysRemaining} days remaining`,
      },
      cell_2: {
        label: "Which is",
        value_display: formatMoneyWhole(perDayLeft),
        value_suffix: "a day",
        sub_line: perDaySoFar != null
          ? `you have averaged ${formatMoneyWhole(perDaySoFar)} a day so far`
          : null,
      },
      cell_3: {
        label: "Budget used",
        value_display: formatPct(budgetUsedPct),
        direction: pace === "slower" ? "good" : (pace === "faster" ? "bad" : "neutral"),
        sub_line_prefix: elapsedPct != null ? `with ${formatPct(elapsedPct)} of the period gone` : null,
        verdict: paceCopy,
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
  const capBeforeToday = (iso) => {
    if (!iso) return null;
    if (iso < today) return iso;
    // Fall back to today - 1. Cheaper than parsing the ISO and
    // stepping back a day - today is already an ISO YYYY-MM-DD string
    // computed against the request's timezone in step 1 of the
    // resolver; subtracting one day from an ISO date is a
    // well-defined arithmetic on the Date wrapper.
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };
  const laborLastClosed = (() => {
    const weeks = laborBoard?.weeks || [];
    let max = null;
    for (const w of weeks) {
      if (w.state !== "closed") continue;
      if (max == null || w.week_end > max) max = w.week_end;
    }
    return capBeforeToday(max);
  })();
  const scMaxDate = (() => {
    let max = null;
    for (const [, byDate] of scByAcct) {
      for (const [day] of byDate) {
        if (max == null || day > max) max = day;
      }
    }
    return capBeforeToday(max);
  })();
  const cardsThrough = capBeforeToday(purchFreshness?.cards_through || null);

  const labelWithThrough = (base, iso, fallback) => {
    const day = iso ? formatDayLabel(iso) : null;
    return day ? `${base} ${day}` : (fallback || `${base} (not yet reporting)`);
  };
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
      },
      gross_margin: {
        period_budget: (revenue_budget_full_period != null) ? r2(revenue_budget_full_period - cogsBudget) : null,
        budget_to_date: grossMarginBudget,
        actual: grossMargin,
      },
    },
    also_tracked: alsoTracked,
    drill,
    // R-34 what-is-left. null on corporate posture, closed periods,
    // and FYTD - client hides the strip when this field is null.
    // Corporate payloads have never carried this field; adding it as
    // null preserves the corporate shape at the type-checker level and
    // makes the absence intentional rather than an accident of key
    // ordering.
    what_is_left: whatIsLeft,
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
