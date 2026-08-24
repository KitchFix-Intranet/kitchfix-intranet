// /api/kpi/labor
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS. Never calls
// Rippling; reads labor_actuals_latest + labor_unattributed +
// rippling_raw_workers_latest + rippling_raw_users_latest +
// rippling_walks + earning_type_unmapped + sc_day_metadata.
//
// PR C5: names via /users. Worker payload carries user_id but the
// endpoint's response schema does not include name fields. This route
// joins worker.user_id -> rippling_raw_users_latest.rippling_id and
// resolves names via the canonical Rippling field. Never parses email.
//
// PR C3 additions (still relevant):
//   - `title` (job title) included in worker meta for display context.
//   - `account_periods` in response: fiscal-year period boundaries
//     for client-side "this period" / "last period" presets.
//
// Query params:
//   account   accounts.team_key (required)
//   start     YYYY-MM-DD (defaults to fiscal-year start)
//   end       YYYY-MM-DD (defaults to today)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
// V-role-gates - OPS_LEADERSHIP_EMAILS retired here. Access is now
// resolved by roleGate.js (four roles: corporate, rdo, site_leader,
// site_manager). A caller who resolves to null gets 403.
import { getServiceClient } from "@/lib/supabase";
import { resolveWorkerMeta } from "@/lib/kpi/resolveWorkerMeta";
import { resolvePortfolioMembers } from "@/lib/kpi/portfolioMembers";
import { REGIONAL_DIRECTORS } from "@/lib/incidentSchema";
import { buildBoard, buildWeekBudgets, buildAggregateWeekBudgets, computePeriodMeasures } from "@/app/kpi/labor/lib/board.js";
import { periodStartISO as fyPeriodStart, periodEndISO as fyPeriodEnd, inferRangeSelection as fyInferRange } from "@/app/kpi/labor/lib/periods.js";
import { loadRoleGate } from "@/lib/kpi/roleGate.js";
import { load3100_2Budgets, loadSalaryActuals, withSalary as withSalaryMerge } from "@/lib/labor/salaryBoard.js";
import { salaryProRate } from "@/lib/labor/salaryProRate.js";
// PR-2 - range resolver + budget pro-rate. Three-way routing (grain
// first, era second): whole weeks -> weekly, partial post-floor ->
// daily, partial pre-floor -> refuse. See src/lib/labor/rangeResolver.js
// for the design contract.
import { resolveRangeSource } from "@/lib/labor/rangeResolver.js";
import { proRateBudget } from "@/lib/labor/budgetProRate.js";
// PR-3a - salary on the daily path via salaryProRate. The body
// builder lives in a Node-loadable helper so the probe can invoke
// it in-process against real Supabase (no HTTP, no auth session).
// See src/lib/labor/dailyRangeBody.js.
import { buildDailyRangeBody } from "@/lib/labor/dailyRangeBody.js";
// homestand PR-1 - MLB clubhouse view. Six accounts get a homestand
// tab (CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V, CIN - KY,
// TBJ - NY); every other account gets an empty list -> tab absent.
// `?homestand=<game_start ISO>` selects a stand; the resolver returns
// its window, which passes through the existing range resolver
// unchanged (no new source value). See src/lib/labor/homestandResolver.js.
import {
  listHomestands,
  findHomestandByGameStart,
  computeSplitWithGameDates,
  computeHomestandBank,
  actualsByStand,
  foldPerStandSplits,
} from "@/lib/labor/homestandResolver.js";
import { foldPreFloorEstimates } from "@/lib/labor/preFloorEstimator.js";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// v6 PR-1 - reserved uppercase pseudo-account keys per V6-19. Chosen
// to collide with nothing the account regex admits (which requires
// spaced hyphens in the middle). URL: ?account=ALL / EAST / WEST.
const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
// V37 - revenue-flex accounts (TXR - TX - V) budget on a forecast
// envelope: hourly_budget = revenue_forecast x accounts.labor_ratio,
// stored per period in sc_labor_budgets. They participate in the
// board the same way every other account does (playbook 4.5); the
// only difference is the sub-line basis word - 'envelope' vs 'pnl' -
// so the client can label how the number was reached. There is no
// aggregate exclusion any more (V37-5).
const V37_REVENUE_FLEX_ACCOUNTS = new Set(["TXR - TX - V"]);
const V6_PAGE_DEFAULT = 1000;   // PostgREST default response cap

function safeError(scope, err) {
  // Never echo a raw PostgREST error to the client (leaks column
  // names). Never echo a name (PII discipline - the users table
  // touches this route).
  console.error(`[kpi/labor] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

// V6-18 - build the "S. Lynch" / "R. Moore" display name from the
// REGIONAL_DIRECTORS email. Format: `<first-initial>. <Lastname>`
// with the last name capitalized. CSS handles the uppercase eyebrow.
function rdoDisplayName(email) {
  if (!email) return null;
  const local = String(email).split("@")[0] || "";
  const parts = local.split(".");
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  if (!first || !last) return null;
  return `${first.charAt(0).toUpperCase()}. ${last.charAt(0).toUpperCase() + last.slice(1)}`;
}

// V6-18/19 + V7-16 - directory shape the folio consumes on every
// render. Reads accounts.region + name + city + state live from
// accounts. CORP excluded per D17. The folio uses team_name + city
// to render the two-line member rows; salaried flag remains on the
// wire (StateSalaried still gates the account page) but is no longer
// echoed as a folio-row tag (V7-15). Called once per request.
async function fetchAccountsDirectory(supa) {
  const q = await supa.from("accounts")
    .select("team_key, region, name, city, state")
    .neq("team_key", "CORP")
    .order("team_key");
  if (q.error) return { error: q.error };
  const salaried = new Set(["CIN - KY", "TBJ - NY"]);   // D26 mirror
  return {
    data: (q.data || []).map(r => ({
      team_key: r.team_key,
      region: r.region,
      team_name: r.name || null,
      city: r.city || null,
      state: r.state || null,
      salaried: salaried.has(r.team_key),
    })),
  };
}

// Paginate through a labor_actuals_latest filter, .range() loop,
// deterministic ordering, single flat array return.
async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h, derived_at, source_run")
      .in("account_key", members)
      .lte("week_start", end)
      .gte("week_end", start)
      .order("week_start", { ascending: true })
      .order("account_key", { ascending: true })
      .order("worker_id", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return { data: out };
}

// Resolve the (member) account's budget_periods per playbook 4.5.
// V37 - revenue-flex accounts (TXR - TX - V) use the same 4.5
// resolution as every other account. Their sc_labor_budgets rows
// carry hourly_budget = revenue_forecast x accounts.labor_ratio; the
// only downstream difference is the `basis` word on each period,
// which the sub-line surfaces.
// Empty on truly no rows. Never selects 3100.2 or any group total (8.2).
async function resolveMemberBudget(supa, accountKey) {
  const [pnlQ, scQ] = await Promise.all([
    supa
      .from("kpi_budgets")
      .select("period_no, amount")
      .eq("account_key", accountKey)
      .eq("line_code", "3100.1")
      .eq("fiscal_year", 2026),
    supa
      .from("sc_labor_budgets")
      .select("period, hourly_budget, reason")
      .eq("account_key", accountKey)
      .is("superseded_at", null),
  ]);
  if (pnlQ.error) return { error: pnlQ.error, scope: "kpi_budgets_3100_1" };
  if (scQ.error)  return { error: scQ.error,  scope: "sc_labor_budgets" };

  const isRevenueFlex = V37_REVENUE_FLEX_ACCOUNTS.has(accountKey);
  const pnlByPeriod = new Map(
    (pnlQ.data || []).map(r => [Number(r.period_no), Number(r.amount)])
  );
  // sc_labor_budgets.period is TEXT bare-numeric ('5' not 5) per
  // sc-20 + sc-21 convention.
  const scByPeriod = new Map(
    (scQ.data || []).map(r => [parseInt(String(r.period), 10), {
      amount: Number(r.hourly_budget),
      reason: r.reason || null,
    }])
  );

  const out = [];
  for (let p = 1; p <= 13; p += 1) {
    const sc = scByPeriod.get(p);
    const pnl = pnlByPeriod.get(p);
    if (sc != null && Number.isFinite(sc.amount)) {
      const pnlDiffers = pnl != null && Math.abs(pnl - sc.amount) > 0.01;
      out.push({
        period_no: p,
        amount: Math.round(sc.amount * 100) / 100,
        source: "supersede",
        basis: isRevenueFlex ? "envelope" : "pnl",
        superseded: pnlDiffers,
        ...(sc.reason ? { reason: sc.reason } : {}),
        ...(pnlDiffers ? { pnl_amount: Math.round(pnl * 100) / 100 } : {}),
      });
    } else if (pnl != null && Number.isFinite(pnl)) {
      out.push({
        period_no: p,
        amount: Math.round(pnl * 100) / 100,
        source: "pnl",
        basis: "pnl",
        superseded: false,
      });
    }
    // else: no row - omit.
  }
  return { data: out };
}

// V32-12..V32-15 - prior-period comparison payload for the context
// strip. Renders only when the range is a SINGLE fiscal period
// (rangeSelection.kind === "period") with a prior period in FY2026.
// Returns { applies: false, reason } otherwise; the client renders
// nothing (no partial fallback per V32-15).
async function buildPriorPeriodComparison({ supa, rangeStart, rangeEnd, today, isAggregate, members, account, currentActuals, pageSize }) {
  const selection = fyInferRange(rangeStart, rangeEnd);
  if (!selection || selection.kind !== "period") {
    return { applies: false, reason: "range_not_single_period" };
  }
  const currentPeriodNo = selection.value;
  if (currentPeriodNo <= 1) return { applies: false, reason: "no_prior_period" };

  const priorPeriodNo = currentPeriodNo - 1;
  const priorStart = fyPeriodStart(priorPeriodNo);
  const priorEnd = fyPeriodEnd(priorPeriodNo);
  if (!priorStart || !priorEnd) return { applies: false, reason: "no_prior_range" };

  // Current elapsed weeks - closed periods use 4, in-progress uses the
  // fractional elapsed. computePeriodMeasures floors 0 so a not-yet-
  // started period returns null (client hides the strip).
  const currentPeriodEnd = fyPeriodEnd(currentPeriodNo);
  const isClosed = currentPeriodEnd < today;
  let currentElapsedWeeks;
  if (isClosed) {
    currentElapsedWeeks = 4;
  } else {
    const currentStart = fyPeriodStart(currentPeriodNo);
    const todayDate = new Date(today).getTime();
    const startDate = new Date(currentStart).getTime();
    const daysIn = Math.max(0, Math.floor((todayDate - startDate) / 86400000) + 1);
    currentElapsedWeeks = Math.max(0.01, Math.min(4, daysIn / 7));
  }

  // Prior actuals - V37-5 aggregates include every member (revenue-
  // flex accounts no longer excluded); population is now defined by
  // the members list alone.
  let priorActuals;
  if (isAggregate) {
    const rolled = members || [];
    if (rolled.length === 0) return { applies: false, reason: "no_rollup_members" };
    const q = await paginateActuals(supa, { members: rolled, start: priorStart, end: priorEnd, pageSize });
    if (q.error) return { applies: false, reason: "query_error" };
    priorActuals = q.data;
  } else {
    const q = await supa.from("labor_actuals_latest")
      .select("account_key, worker_id, week_start, week_end, hours_regular, hours_overtime, hours_double_time, hours_premium_other, amount")
      .eq("account_key", account)
      .lte("week_start", priorEnd).gte("week_end", priorStart);
    if (q.error) return { applies: false, reason: "query_error" };
    priorActuals = q.data;
  }

  const prior = computePeriodMeasures(priorActuals, 4);
  const now = computePeriodMeasures(currentActuals, currentElapsedWeeks);
  if (!prior || !now) return { applies: false, reason: "insufficient_data" };

  return {
    applies: true,
    current_period_no: currentPeriodNo,
    prior_period_no: priorPeriodNo,
    now,
    prior,
  };
}

export async function GET(request) {
  // PR-3b - TEST_MODE double-gate mirrors src/middleware.js and the
  // sibling kpi/purchasing route (route.js:562-578) so local live
  // probes + Playwright smokes can reach the read-only labor API
  // without an OAuth login. Never fires on Vercel (VERCEL=1 kills
  // the bypass regardless of env vars). The synthetic caller is
  // corporate with full scope + can_see_salary=true so acceptance
  // probes can exercise every response shape.
  const testModeBypass = process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";
  let email = null;
  if (!testModeBypass) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    email = session.user?.email?.toLowerCase().trim();
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const account = (searchParams.get("account") || "").trim();
  // homestand PR-1 - start/end can be overridden by the homestand
  // selection below. `let` so the override lands cleanly; the
  // downstream range resolver, board build, and daily branch see
  // the window as if it had been requested directly.
  let start = searchParams.get("start") || "2025-12-29";  // FY2026 opens
  let end = searchParams.get("end") || today;
  // Future-range flag (owner ruling 2026-08-24, corrected HS PR-A).
  // True when the requested RESOLVED range starts strictly after
  // today. Homestand requests carry `?homestand=<game_start>` and
  // NOT `?start`/`?end` - start falls back to the FY default until
  // the resolver reassigns it to window_start below. So `let` here,
  // recompute after the homestand branch reassigns start.
  //
  // Client uses this to suppress verdict pills + hide signal cards
  // whose premise doesn't hold on a future range (Pace, Overtime,
  // Payroll Data). Hours available stays because its premise holds
  // perfectly: budget exists, no hours scheduled, every hour is
  // available. Straddling ranges (start <= today <= end) get false -
  // in progress, verdicts are honest.
  let is_future_range = start > today;
  const pageSizeParam = parseInt(searchParams.get("_page_size") || "0", 10);
  const includeSalaryReq = searchParams.get("include_salary") === "1";
  const homestandParam = searchParams.get("homestand");   // <game_start ISO>, e.g. 2026-08-14

  const supa = getServiceClient();

  // V-role-gates - resolve the caller once. corporate + rdo come from
  // kpi_roles; site_leader + site_manager come from people. See
  // docs/KPI_ROLE_GATES_SPEC.md for the design contract and
  // src/lib/kpi/roleGate.js for the resolver.
  const gate = await loadRoleGate(supa);
  if (gate.error) return NextResponse.json(safeError("role_gate", gate.error), { status: 500 });
  let caller;
  if (testModeBypass) {
    caller = { role: "corporate", scope: null, can_see_salary: true };
  } else {
    try { caller = await gate.resolveKpiRole(email); }
    catch (e) { return NextResponse.json(safeError("role_gate_resolve", e), { status: 500 }); }
    if (!caller) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const landing_account = gate.landingAccount(caller);

  // Fetch the accounts directory + regional-director display names
  // BEFORE any account-branch logic; every response path (landing,
  // locked, single, aggregate, salaried-only) carries them so the
  // folio and command bar can render without a second network call.
  const dirQ = await fetchAccountsDirectory(supa);
  if (dirQ.error) return NextResponse.json(safeError("accounts_directory", dirQ.error), { status: 500 });
  const accounts_directory = dirQ.data;
  const regional_directors_display = {
    East: rdoDisplayName(REGIONAL_DIRECTORS.East),
    West: rdoDisplayName(REGIONAL_DIRECTORS.West),
  };

  // Empty account -> landing response. 200, not 400; the client
  // redirects to landing_account. Zero board data.
  if (!account) {
    return NextResponse.json({
      landing_account,
      accounts_directory,
      regional_directors_display,
    });
  }
  if (D17_OUT_OF_SCOPE.has(account)) {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }

  // V-role-gates - locked-state response for any account the caller
  // cannot view. NO board, NO actuals, NO budget keys - spec §3
  // makes this a serialized-payload guarantee, not a client hide.
  // Aggregates (ALL / EAST / WEST) are locked for site_leader and
  // site_manager. The directory + landing_account still ship so the
  // client keeps the shell + rail + section switcher visible.
  if (!gate.canViewAccount(caller, account)) {
    return NextResponse.json({
      locked: true,
      account,
      reason: "not_authorised",
      landing_account,
      accounts_directory,
      regional_directors_display,
    });
  }

  const psWalkGlobal = await supa
    .from("rippling_walks")
    .select("completed_at, ids_seen")
    .eq("kind", "pay_segments")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const freshness = {
    last_walk_at: psWalkGlobal.data?.completed_at || null,
    last_walk_ids_seen: psWalkGlobal.data?.ids_seen || null,
    last_derive_at: null,
  };

  // V-role-gates - salary_available now comes from the same resolver
  // that gated view access above. `include_salary=1` is silently
  // dropped when the gate denies, so a caller who cannot see salary
  // gets a byte-identical default response whether they asked for
  // salary or not (spec §6, probe G4).
  const salary_available = gate.canSeeSalary(caller, account);
  const includeSalary = includeSalaryReq && salary_available;

  // PR-2 range routing - one source per answer, never both. See
  // src/lib/labor/rangeResolver.js for the three-way rule.
  // Daily floor is data-derived from labor_actuals.week_source =
  // 'sc_day_metadata' (currently 2026-04-20). Weeks before that
  // were rippling_report-backfilled with no per-day segments.
  const floorQ = await supa
    .from("labor_actuals")
    .select("week_start")
    .eq("week_source", "sc_day_metadata")
    .order("week_start")
    .limit(1)
    .maybeSingle();
  if (floorQ.error) return NextResponse.json(safeError("daily_floor", floorQ.error), { status: 500 });
  const dailyFloorISO = floorQ.data?.week_start || "2026-04-20";

  // homestand PR-1 - MLB clubhouse selection. If `?homestand=<game_start ISO>`
  // is set AND the account has a homestand tab (HOMESTAND_ACCOUNTS_FY2026
  // - four hardcoded accounts per owner ruling 2026-08-21 audit follow-up),
  // resolve the stand to its window and override start/end BEFORE the
  // range resolver sees them. The window then routes to daily or
  // weekly by the existing rule; homestand introduces no new source.
  // Response splices in `homestand`, `homestand_split`, `homestand_bank`
  // regardless of branch. Non-MLB accounts always get an empty list
  // and no homestand fields - client reads the empty list as "no
  // homestand tab here" (absent, not disabled).
  // homestand PR-2 - always fetch stands + FY daily actuals for
  // accounts that have BOTH a homestand schedule AND at least one
  // row in labor_actuals_daily this fiscal year. Owner ruling
  // 2026-08-21 (audit follow-up): the gate is data-driven, not a
  // hardcoded MLB list. listHomestands returns [] when either
  // condition fails, so the follow-on work is naturally skipped for
  // non-schedule accounts (PDC, corp) AND for MLB accounts with no
  // hourly labor (CIN - KY, TBJ - NY today). If either grows hourly
  // staff, the tab appears with no code change.
  let homestandSplice = null;
  let allHomestands = null;
  let homestandBank = null;
  let homestandGameDatesByStand = null;   // Map<game_start ISO, Set<GAME ISO dates>>
  try { allHomestands = await listHomestands(supa, account, 2026, { includeSalary }); }
  catch (e) { return NextResponse.json(safeError("homestand_list", e), { status: 500 }); }
  if (allHomestands && allHomestands.length > 0) {
    const [dailyQ, schedQ] = await Promise.all([
        supa.from("labor_actuals_daily")
          .select("work_date, amount")
          .eq("account_key", account),
        supa.from("sc_homestand_schedule")
          .select("service_date, day_type, day_night")
          .eq("account_key", account),
      ]);
      if (dailyQ.error) return NextResponse.json(safeError("homestand_daily", dailyQ.error), { status: 500 });
      if (schedQ.error) return NextResponse.json(safeError("homestand_schedule", schedQ.error), { status: 500 });
      const dailyRows = dailyQ.data || [];
      const schedRows = schedQ.data || [];

      // Per-stand HOURLY actual (myriadth accumulator, cent-rounded per
      // stand - same discipline the bank uses per owner ruling
      // 2026-08-21). actual is null for pre_floor AND for stands
      // whose game_end has not yet passed today - both classes have
      // no attributable actual. Matches the bank's own finished-vs-
      // remaining discrimination so client "actual" state and the
      // bank agree on which stands are complete.
      const hourlyActMap = actualsByStand(allHomestands, dailyRows);
      // Salary integration (PR #274, owner ruling 2026-08-21): when
      // the toggle is on, pro-rate labor_salary_actuals per stand
      // window and add to the actuals map. Both sides (budget +
      // actual) must move together, or every stand reads over-budget
      // the instant the toggle flips. actMap ends up salary-inclusive
      // when includeSalary; hourly-only otherwise.
      const actMap = new Map(hourlyActMap);
      const salaryX10000ByStand = new Map();
      if (includeSalary) {
        const salActuals = await loadSalaryActuals(supa, [account], "2025-12-29", "2026-12-27");
        if (salActuals.error) return NextResponse.json(safeError("homestand_salary_actuals", { message: salActuals.error }), { status: 500 });
        for (const h of allHomestands) {
          if (h.pre_floor) continue;
          const pr = salaryProRate({
            startISO: h.window_start,
            endISO:   h.window_end,
            salaryRows: salActuals.rows || [],
          });
          const salX10000 = Math.round((pr.total || 0) * 10000);
          salaryX10000ByStand.set(h.game_start, salX10000);
          actMap.set(h.game_start, (actMap.get(h.game_start) || 0) + salX10000);
        }
      }
      allHomestands = allHomestands.map(h => {
        const hourlyX = hourlyActMap.get(h.game_start) || 0;
        const salX    = salaryX10000ByStand.get(h.game_start) || 0;
        const totalX  = actMap.get(h.game_start) || 0;
        return {
          ...h,
          actual: (h.pre_floor || h.game_end > today)
            ? null
            : Math.round(totalX / 100) / 100,
          actual_hourly: (h.pre_floor || h.game_end > today)
            ? null
            : Math.round(hourlyX / 100) / 100,
          actual_salary: (h.pre_floor || h.game_end > today || !includeSalary)
            ? null
            : Math.round(salX / 100) / 100,
        };
      });
      // Season-to-date bank - fixed truth per owner reminder #3, does
      // NOT change with selection. Bank reconciles on the same basis
      // as stand.budget + stand.actual - so hourly-only when the
      // toggle is off, hourly+salary when on. Included on every
      // request so the season-to-date card renders on cold-load.
      homestandBank = computeHomestandBank(allHomestands, actMap, today);

      // PR #273 - pre-floor stand estimator. Attaches actual_estimated
      // + is_estimated + estimator_meta onto pre-floor stands so the
      // rail + season table + selected-stand view can render something
      // other than "no detail." Bank is untouched (pre-floor stands
      // stay excluded from computeHomestandBank per owner ruling
      // 2026-08-21 - estimates never enter the bank). H9 asserts
      // bank byte-identical with the estimator on and off.
      try {
        allHomestands = await foldPreFloorEstimates(supa, account, allHomestands, dailyFloorISO, today);
      } catch (e) {
        return NextResponse.json(safeError("pre_floor_estimator", e), { status: 500 });
      }

      // HS PR-B (owner ruling 2026-08-24): fold per-stand split onto
      // every non-pre-floor stand so the season table renders Prep &
      // off on each row. Pre-PR-B split was computed only for the
      // SELECTED stand and the table column was `–` on every row -
      // a value the payload could compute but did not. The selected
      // -stand homestand_split on homestandSplice now reads from the
      // same folded data instead of a parallel computation.
      try {
        allHomestands = await foldPerStandSplits(supa, account, allHomestands, schedRows, today);
      } catch (e) {
        return NextResponse.json(safeError("per_stand_splits", e), { status: 500 });
      }

      // GAME date sets per stand, keyed by game_start. Client uses
      // these for the identity-variant day strip fill rules; also
      // used below for split computation on the selected stand.
      homestandGameDatesByStand = new Map();
      for (const h of allHomestands) {
        if (h.pre_floor) continue;
        const gameDates = new Set(
          schedRows
            .filter(r => r.day_type === "GAME" && r.service_date >= h.game_start && r.service_date <= h.game_end)
            .map(r => r.service_date)
        );
        homestandGameDatesByStand.set(h.game_start, gameDates);
      }

      if (homestandParam) {
        const found = allHomestands.find(x => x.game_start === homestandParam);
        if (!found) {
          // HS PR-C follow-up (owner ruling 2026-08-24): an
          // unresolvable stand no longer 400s - navigation must
          // survive an unresolvable selection. Reachable by
          // switching accounts while a stand is selected; the
          // prior 400 blanked the whole homestand view.
          //
          // Response shape mirrors the pre-floor refusal path
          // below - refused: true + message + full rail / bank
          // payload so the client renders:
          //   * the tab (hasHomestandTab guards on homestands.length)
          //   * the rail (from data.homestands)
          //   * the season card (from data.homestand_bank)
          //   * a refusal panel in the stand region (settledRefusal
          //     branch in HomestandBoard already exists per PR-2
          //     ruling: "a refusal must not destroy navigation")
          return NextResponse.json({
            source: null,
            refused: true,
            message: `That homestand does not exist for ${account}. Pick a stand from the rail above.`,
            homestand: null,
            homestand_param: homestandParam,
            homestands: allHomestands,
            homestand_bank: homestandBank,
            daily_floor: dailyFloorISO,
            account, filters: { account, homestand: homestandParam },
            landing_account, accounts_directory, regional_directors_display,
            salary_available,
          });
        }
        if (found.pre_floor) {
          // PR #273 - pre-floor stand ships an ESTIMATED response body
          // instead of the earlier refusal. Client renders plan-mode
          // cards using found.actual_estimated + found.estimator_meta.
          // No daily/weekly board (no source-of-truth per-day rows
          // exist pre-floor), no employee expansion (per-worker
          // attribution unavailable). source: "estimated" is a new
          // value alongside "daily" and "weekly". Route-shape probe
          // in _probe_range_resolver treats it as a distinct branch.
          return NextResponse.json({
            source: "estimated",
            refused: false,
            homestand: found,
            homestand_estimated: found.is_estimated ? {
              total:         found.actual_estimated,
              per_day:       found.estimator_meta?.per_day || [],
              base_rates:    found.estimator_meta?.base_rates || null,
              source_stands: found.estimator_meta?.source_stands || 0,
              method:        "game_day_weighted",
              note:          "Estimated: this stand is before daily detail started (04/20/26). Each week's real total is distributed across days by what the schedule says happened (night game, day game, prep day). Derived from the account's own low-OT stands.",
            } : null,
            daily_floor: dailyFloorISO,
            homestands: allHomestands,
            homestand_bank: homestandBank,
            account, filters: { account, homestand: homestandParam },
            landing_account, accounts_directory, regional_directors_display,
            salary_available: false,
          });
        }
        start = found.window_start;
        end   = found.window_end;
        // HS PR-A (owner ruling 2026-08-24): recompute is_future_range
        // AFTER homestand resolution reassigns start. A homestand
        // request lands start=FY_default; without this recompute the
        // flag stays false forever on homestand view and #798's
        // suppression never fires. Uses window_start, not game_start -
        // Kevin's rule keys is_future_range off "resolved range starts
        // in the future" (window_start > today); a stand whose window
        // has opened for prep is NOT a future range even if games are
        // still ahead. Plan mode is the game_start flag on the client.
        is_future_range = start > today;
        const gameDatesForFound = homestandGameDatesByStand.get(found.game_start) || new Set();
        // For the identity day strip, also expose night-game dates.
        const nightDatesForFound = new Set(
          schedRows
            .filter(r => r.day_type === "GAME" && r.day_night === "night"
                      && r.service_date >= found.game_start && r.service_date <= found.game_end)
            .map(r => r.service_date)
        );
        // HS PR-B (owner ruling 2026-08-24): homestand_split reads
        // from the FOLDED per-stand data (foldPerStandSplits above)
        // rather than a parallel computation here. Same source the
        // season table renders from - one source, one answer. The
        // per-stand split was computed with today so spent_to_date
        // is already present when the window has opened.
        homestandSplice = {
          homestand: found,
          homestand_game_dates: [...gameDatesForFound].sort(),
          homestand_night_dates: [...nightDatesForFound].sort(),
          homestand_split: found.split || null,
        };
        // HS PR-A: attach homestand_estimated on POST-FLOOR future
        // stands too. Same shape the pre-floor early-return ships at
        // line 559-577; PlanCards reads data.homestand_estimated and
        // does not care which branch produced it. is_estimated was
        // folded onto future stands by foldPreFloorEstimates when
        // game_start > today.
        if (found.is_estimated) {
          homestandSplice.homestand_estimated = {
            total:         found.actual_estimated,
            per_day:       found.estimator_meta?.per_day || [],
            base_rates:    found.estimator_meta?.base_rates || null,
            source_stands: found.estimator_meta?.source_stands || 0,
            method:        "game_day_weighted",
            note:          found.pre_floor
              ? "Estimated: this stand is before daily detail started (04/20/26). Each week's real total is distributed across days by what the schedule says happened (night game, day game, prep day). Derived from the account's own low-OT stands."
              : "Estimated: this stand's games have not been played yet. Each day is priced at the account's base rate for that day type (night game, day game, prep day). Derived from the account's own low-OT played stands.",
          };
        }
      }
  }
  const homestandsList = allHomestands || [];

  let rangeSource = resolveRangeSource({ startISO: start, endISO: end, dailyFloorISO });

  // HS FB1 PR-1 (owner ruling 2026-08-24, defect 1b): the homestand
  // view ALWAYS needs day-level data - the day strip is the point.
  // The generic resolver was routing whole-week HS windows (e.g.
  // HS 9 STL - MO: 06/29 - 07/12 = 2 fiscal weeks) to `weekly`,
  // which ships zero daily rows and blanks the strip. Same fix as
  // the workers-map empty case (1a): forcing daily on any post-floor
  // homestand window pulls per-day actuals via labor_actuals_daily,
  // and dailyRangeBody ships `workers: workerMeta` (line 193) as a
  // side effect - so employee names resolve too.
  //
  // Only fires when homestandParam is set AND start >= dailyFloor -
  // pre-floor selections take the source: "estimated" early return
  // at line 559 and never reach here.
  if (homestandParam && start >= dailyFloorISO && rangeSource.source !== "daily") {
    rangeSource = {
      source: "daily",
      reason: "homestand_view_forces_daily",
      isWholeWeeks: rangeSource.isWholeWeeks,
      isPartialWeek: rangeSource.isPartialWeek,
      spanDays: rangeSource.spanDays,
      refused: false,
    };
  }

  // Refusal: partial-week range starting before the floor. Cannot be
  // answered - underlying segments were retention-purged before the
  // pipeline was built. User-facing copy names both ways out.
  if (rangeSource.refused) {
    // Homestand PR-2 audit 2026-08-21: refusal must not destroy
    // navigation. Include the homestands list + season-to-date bank
    // so the client's rail + season card + tabs survive; only the
    // stand-specific region shows the refusal message. Same rule as
    // the account-locked panel: board region is replaced, navigation
    // stays. `homestand` is left off deliberately (no valid stand
    // selection reached this branch under the corrected clamp) so
    // the client's selection state falls back to unset.
    return NextResponse.json({
      source: null,
      refused: true,
      reason: rangeSource.reason,
      message: rangeSource.refusalMessage,
      daily_floor: dailyFloorISO,
      account,
      filters: { account, start, end },
      landing_account,
      accounts_directory,
      regional_directors_display,
      salary_available: false,
      homestands: homestandsList,
      homestand_bank: homestandBank,
    });
  }

  // Daily branch. Fetches labor_actuals_daily for the range +
  // account (or members for aggregates), aggregates per (worker,
  // line) into a range-summed shape, pairs with a pro-rated budget,
  // and (PR-3a) merges pro-rated salary when the caller asked for
  // it. salary_available flows through so a caller with the toggle
  // on and role permission gets the salary payload; ungated callers
  // still see the byte-identical default.
  if (rangeSource.source === "daily") {
    return await handleDailyRangeRequest({
      supa, account, start, end, today,
      caller, landing_account,
      accounts_directory, regional_directors_display,
      freshness,
      rangeSource,
      dailyFloorISO,
      salary_available, includeSalary,
      resolveWorkerMeta,
      is_future_range,
      // homestand PR-1/2 - wrapper splices these into the daily body.
      homestandSplice, homestandsList, homestandBank,
    });
  }

  // ── v6 PR-1 · aggregate pseudo-keys (ALL / EAST / WEST) ──────────
  // Resolves members from live accounts.region, aggregates actuals,
  // budgets, workers, and unattributed across the member set. Salaried
  // members participate (they contribute no hourly rows). CORP is
  // excluded universally per D17. Single-account requests fall
  // through to the byte-identical existing path below.
  if (V6_PSEUDO_KEYS.has(account)) {
    // 1. Resolve members from live accounts.region via the shared helper
    //    so the export route sees byte-identical membership.
    const memberQ = await resolvePortfolioMembers(supa, account);
    if (memberQ.error) return NextResponse.json(safeError("v6_members", memberQ.error), { status: 500 });
    const members = memberQ.data.map(r => r.team_key);
    if (members.length === 0) {
      return NextResponse.json({ error: "no_members_in_region", account }, { status: 400 });
    }

    // 2. Actuals - paginated union across members.
    const aQ = await paginateActuals(supa, { members, start, end, pageSize: pageSizeParam });
    if (aQ.error) return NextResponse.json(safeError("labor_actuals_aggregate", aQ.error), { status: 500 });
    const actualsRows = aQ.data;

    // 3. Workers - union by rippling_id (collisions = same person).
    //    V40 BUG 5 - name resolution extracted to resolveWorkerMeta so
    //    the salary path can call it too. Prior state left salaried
    //    workers unresolved (rendered as id hashes at CIN - AZ).
    const workerIds = [...new Set(actualsRows.map(r => r.worker_id))];
    const { workerMeta, resolvedNames, usersReachable } = await resolveWorkerMeta(supa, workerIds);

    // 4. account_periods - fiscal calendar is universal across accounts;
    // use the first member as the canonical source (any account would
    // yield the same period boundaries).
    const canonAcct = members[0];
    const periodDays = await supa.from("sc_day_metadata")
      .select("service_date, period")
      .eq("account_key", canonAcct)
      .gte("service_date", "2025-12-29")
      .lte("service_date", "2026-12-27")
      .not("period", "is", null);
    const periodBounds = new Map();
    if (!periodDays.error) {
      for (const r of periodDays.data || []) {
        const p = String(r.period);
        const cur = periodBounds.get(p);
        if (!cur) periodBounds.set(p, { start: r.service_date, end: r.service_date });
        else {
          if (r.service_date < cur.start) cur.start = r.service_date;
          if (r.service_date > cur.end)   cur.end   = r.service_date;
        }
      }
    }
    const account_periods = [...periodBounds.entries()]
      .map(([p, b]) => ({ fiscal_year: 2026, period_no: parseInt(p, 10), start: b.start, end: b.end }))
      .sort((a, b) => a.period_no - b.period_no);

    // 5. unattributed / unmapped - global, unchanged.
    const [unattr, unmapped] = await Promise.all([
      supa.from("labor_unattributed")
        .select("reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes")
        .order("amount", { ascending: false }),
      supa.from("earning_type_unmapped")
        .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
        .is("resolved_at", null)
        .order("total_amount", { ascending: false }),
    ]);
    if (unattr.error) return NextResponse.json(safeError("labor_unattributed", unattr.error), { status: 500 });

    // 6. Aggregate budget_periods - resolve each member via 4.5, sum
    // per period. V37-5 - revenue-flex accounts (TXR - TX - V) now
    // join every aggregate on both sides. Any superseded member
    // period marks the aggregate period superseded; member_detail
    // carries the per-member breakdown for the drill.
    const memberBudgets = new Map();
    for (const m of members) {
      const b = await resolveMemberBudget(supa, m);
      if (b.error) return NextResponse.json(safeError(b.scope, b.error), { status: 500 });
      memberBudgets.set(m, b.data);
    }
    const perPeriodAgg = new Map();  // p -> { amount, superseded, member_detail: [] }
    for (const [m, list] of memberBudgets) {
      for (const bp of list) {
        const cur = perPeriodAgg.get(bp.period_no) || { amount: 0, superseded: false, member_detail: [] };
        cur.amount += Number(bp.amount);
        if (bp.superseded) cur.superseded = true;
        cur.member_detail.push({
          account_key: m,
          amount: bp.amount,
          source: bp.source,
          basis: bp.basis,
          superseded: !!bp.superseded,
          ...(bp.reason ? { reason: bp.reason } : {}),
        });
        perPeriodAgg.set(bp.period_no, cur);
      }
    }
    const budget_periods = [...perPeriodAgg.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([p, v]) => ({
        period_no: p,
        amount: Math.round(v.amount * 100) / 100,
        source: v.superseded ? "supersede" : "pnl",
        superseded: v.superseded,
        member_detail: v.member_detail.sort((a, b) => a.account_key.localeCompare(b.account_key)),
      }));

    // V37-5 - aggregate rollup population is now the members list in
    // full. envelope_excluded / aggregate_excluded_members retire.
    const rolledUpMembers = members;
    const rolledUpActuals = actualsRows;

    let body = {
      ok: true,
      filters: { account, start, end },
      account_state: "hourly_ok",
      actuals: actualsRows,
      unattributed: (unattr.data || []).filter(() => true),
      workers: workerMeta,
      derive_freshness: {
        last_walk_at: freshness.last_walk_at,
        last_walk_ids_seen: freshness.last_walk_ids_seen,
        // V31 item 1 - MAX(derived_at) across in-scope rows. Derive is
        // incremental (only rewrites rows whose inputs changed), so the
        // FIRST row's timestamp reads as a five-day lag on settled
        // weeks. Max reflects the most recent rebuild. No dedicated
        // derive_runs table exists yet; when one lands, prefer its
        // recorded run timestamp.
        last_derive_at: actualsRows.reduce(
          (max, r) => (r.derived_at && (!max || r.derived_at > max) ? r.derived_at : max),
          null
        ),
      },
      unmapped_names: unmapped.data || [],
      account_periods,
      budget_periods,
      budget_mode: "static",
      members,
      rolled_up_members: rolledUpMembers,
      accounts_directory,
      regional_directors_display,
      board: buildBoard({
        account, start, end, today,
        actuals: rolledUpActuals,
        budget_periods,
        account_state: "hourly_ok",
      }),
      week_budgets: buildAggregateWeekBudgets({ start, end, member_budgets: memberBudgets }),
      prior_period_comparison: await buildPriorPeriodComparison({
        supa, rangeStart: start, rangeEnd: end, today,
        isAggregate: true, members: rolledUpMembers,
        currentActuals: rolledUpActuals, pageSize: pageSizeParam,
      }),
      name_availability: {
        has_names: resolvedNames > 0,
        resolved: resolvedNames,
        total: workerIds.length,
        reason: resolvedNames === workerIds.length && workerIds.length > 0
          ? "all_resolved_from_users_endpoint"
          : !usersReachable
            ? "users_table_empty_or_unreachable"
            : "some_workers_lack_user_id_or_canonical_name",
      },
    };
    if (includeSalary) {
      const [budQ, actQ] = await Promise.all([
        load3100_2Budgets(supa, members),
        loadSalaryActuals(supa, members, start, end),
      ]);
      if (budQ.error) return NextResponse.json(safeError("kpi_budgets_3100_2", budQ.error), { status: 500 });
      if (actQ.error) return NextResponse.json(safeError("labor_salary_actuals", actQ.error), { status: 500 });
      body = withSalaryMerge(body, {
        account, members, start, end, today,
        buildBoard,
        buildWeekBudgets,
        salary3100_2: budQ.byAccount,
        salaryRows: actQ.rows,
      });
      // V40 BUG 5 - resolve names for salary worker_ids not already
      // covered by the hourly resolve above. Same helper, same fallback.
      const salaryOnly = [...new Set(actQ.rows.map(r => r.worker_id))]
        .filter(id => id && !body.workers[id]);
      if (salaryOnly.length > 0) {
        const extra = await resolveWorkerMeta(supa, salaryOnly);
        body.workers = { ...body.workers, ...extra.workerMeta };
      }
    }
    body.salary_available = salary_available;
    body.landing_account = landing_account;
    body.source = "weekly";
    body.is_future_range = is_future_range;
    return NextResponse.json(body);
  }

  if (D26_SALARIED_ONLY.has(account)) {
    let bodyD26 = {
      ok: true,
      filters: { account, start, end },
      account_state: "salaried_only",
      account_state_message: `${account} is a single-employee salaried account (D26). 3100.1 hourly labor is not applicable.`,
      actuals: [],
      unattributed: [],
      workers: {},
      derive_freshness: freshness,
      unmapped_names: [],
      account_periods: [],
      accounts_directory,
      regional_directors_display,
      name_availability: { has_names: false, resolved: 0, total: 0, reason: "salaried_only" },
      board: buildBoard({
        account, start, end, today,
        actuals: [],
        budget_periods: [],
        account_state: "salaried_only",
      }),
      week_budgets: [],
    };
    if (includeSalary) {
      // D26 accounts on the salary path get a real board. Override
      // account_state to hourly_ok so buildBoard emits the full shape;
      // hourly rows are still zero, but salary provides the figures.
      const [budQ, actQ] = await Promise.all([
        load3100_2Budgets(supa, [account]),
        loadSalaryActuals(supa, [account], start, end),
      ]);
      if (budQ.error) return NextResponse.json(safeError("kpi_budgets_3100_2", budQ.error), { status: 500 });
      if (actQ.error) return NextResponse.json(safeError("labor_salary_actuals", actQ.error), { status: 500 });
      bodyD26.account_state = "hourly_ok";
      bodyD26.account_state_message = undefined;
      bodyD26 = withSalaryMerge(bodyD26, {
        account, members: [account], start, end, today,
        buildBoard,
        buildWeekBudgets,
        salary3100_2: budQ.byAccount,
        salaryRows: actQ.rows,
      });
      // V40 BUG 5 - D26 accounts arrive with an empty workers dict.
      // Resolve the salary worker_ids so their names render.
      const salaryOnly = [...new Set(actQ.rows.map(r => r.worker_id))]
        .filter(id => id && !bodyD26.workers[id]);
      if (salaryOnly.length > 0) {
        const extra = await resolveWorkerMeta(supa, salaryOnly);
        bodyD26.workers = { ...bodyD26.workers, ...extra.workerMeta };
      }
    }
    bodyD26.salary_available = salary_available;
    bodyD26.landing_account = landing_account;
    bodyD26.source = "weekly";
    bodyD26.is_future_range = is_future_range;
    return NextResponse.json(bodyD26);
  }

  const actuals = await supa
    .from("labor_actuals_latest")
    .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h, derived_at, source_run")
    .eq("account_key", account)
    .lte("week_start", end)
    .gte("week_end", start)
    .order("week_start", { ascending: true })
    .order("worker_id",  { ascending: true });
  if (actuals.error) return NextResponse.json(safeError("labor_actuals", actuals.error), { status: 500 });

  const unattr = await supa
    .from("labor_unattributed")
    .select("reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes")
    .order("amount", { ascending: false });
  if (unattr.error) return NextResponse.json(safeError("labor_unattributed", unattr.error), { status: 500 });

  // V40 BUG 5 - name resolution extracted to resolveWorkerMeta so the
  // salary path can call it too. Prior inlined block was byte-identical
  // to the aggregate one; both now share resolveWorkerMeta.
  const workerIds = [...new Set(actuals.data.map(r => r.worker_id))];
  const { workerMeta, resolvedNames, usersReachable } = await resolveWorkerMeta(supa, workerIds);

  // account_periods: full FY period boundaries from sc_day_metadata for
  // this account. Powers client-side "this period" / "last period"
  // presets even before the current date-range fetch overlaps them.
  // Cheap query; keyed only to today's fiscal year.
  const fyStart = "2025-12-29";
  const fyEnd = "2026-12-27";
  const periodDays = await supa
    .from("sc_day_metadata")
    .select("service_date, period")
    .eq("account_key", account)
    .gte("service_date", fyStart)
    .lte("service_date", fyEnd)
    .not("period", "is", null);
  const periodBounds = new Map();
  if (!periodDays.error) {
    for (const r of periodDays.data || []) {
      const p = String(r.period);
      const cur = periodBounds.get(p);
      if (!cur) periodBounds.set(p, { start: r.service_date, end: r.service_date });
      else {
        if (r.service_date < cur.start) cur.start = r.service_date;
        if (r.service_date > cur.end)   cur.end   = r.service_date;
      }
    }
  }
  const account_periods = [...periodBounds.entries()]
    .map(([p, b]) => ({ fiscal_year: 2026, period_no: parseInt(p, 10), start: b.start, end: b.end }))
    .sort((a, b) => a.period_no - b.period_no);

  const derive_freshness = {
    last_walk_at: freshness.last_walk_at,
    last_walk_ids_seen: freshness.last_walk_ids_seen,
    // V31 item 1 - MAX(derived_at) across in-scope rows. See aggregate
    // path above for cause.
    last_derive_at: (actuals.data || []).reduce(
      (max, r) => (r.derived_at && (!max || r.derived_at > max) ? r.derived_at : max),
      null
    ),
  };

  const unmapped = await supa
    .from("earning_type_unmapped")
    .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
    .is("resolved_at", null)
    .order("total_amount", { ascending: false });

  // ── kpi-2 · budget_periods + budget_mode ────────────────────────
  // Playbook 4.5 resolution order per period:
  //   1. live sc_labor_budgets row (superseded_at IS NULL) wins as
  //      the SUPERSEDE source; carry its reason. If a kpi_budgets
  //      3100.1 row exists and differs, set superseded: true and
  //      include the P&L figure as pnl_amount for the drill.
  //   2. kpi_budgets 3100.1 amount for that (account, period) is the
  //      P&L source.
  //   3. no row for that period - omit it entirely.
  //
  // V37 - revenue-flex accounts (TXR - TX - V) use the same 4.5
  // resolution; there is no envelope carve-out any more (the Set is
  // gone and every branch it fed collapsed). Basis names the flavour
  // ('envelope' when the sc_labor_budgets row is a revenue-forecast
  // envelope, 'pnl' otherwise) so the sub-line can label it.
  //
  // Playbook 8.2 hard rule: this route selects line_code = '3100.1'
  // ONLY. Never 3100.2. Never any 3100-group total. The salary
  // subtraction-attack surface must not open here.
  const budget_mode = "static";
  const isRevenueFlexAcct = V37_REVENUE_FLEX_ACCOUNTS.has(account);
  let budget_periods = [];
  {
    // Pull all 13 periods for this account from the two sources in
    // parallel. Both queries are small (<= 13 rows each) - no
    // pagination concern.
    const [pnlQ, scQ] = await Promise.all([
      supa
        .from("kpi_budgets")
        .select("period_no, amount")
        .eq("account_key", account)
        .eq("line_code", "3100.1")
        .eq("fiscal_year", 2026),
      supa
        .from("sc_labor_budgets")
        .select("period, hourly_budget, reason")
        .eq("account_key", account)
        .is("superseded_at", null),
    ]);
    if (pnlQ.error) return NextResponse.json(safeError("kpi_budgets_3100_1", pnlQ.error), { status: 500 });
    if (scQ.error)  return NextResponse.json(safeError("sc_labor_budgets", scQ.error),   { status: 500 });

    const pnlByPeriod = new Map(
      (pnlQ.data || []).map(r => [Number(r.period_no), Number(r.amount)])
    );
    // sc_labor_budgets.period is TEXT bare-numeric ('5' not 5) per
    // sc-20 + sc-21 convention.
    const scByPeriod = new Map(
      (scQ.data || []).map(r => [parseInt(String(r.period), 10), {
        amount: Number(r.hourly_budget),
        reason: r.reason || null,
      }])
    );

    for (let p = 1; p <= 13; p += 1) {
      const sc = scByPeriod.get(p);
      const pnl = pnlByPeriod.get(p);
      if (sc != null && Number.isFinite(sc.amount)) {
        const pnlDiffers = pnl != null && Math.abs(pnl - sc.amount) > 0.01;
        budget_periods.push({
          period_no: p,
          amount: Math.round(sc.amount * 100) / 100,
          source: "supersede",
          basis: isRevenueFlexAcct ? "envelope" : "pnl",
          superseded: pnlDiffers,
          ...(sc.reason ? { reason: sc.reason } : {}),
          ...(pnlDiffers ? { pnl_amount: Math.round(pnl * 100) / 100 } : {}),
        });
      } else if (pnl != null && Number.isFinite(pnl)) {
        budget_periods.push({
          period_no: p,
          amount: Math.round(pnl * 100) / 100,
          source: "pnl",
          basis: "pnl",
          superseded: false,
        });
      }
      // else: no row - omit.
    }
  }

  let bodySingle = {
    ok: true,
    filters: { account, start, end },
    account_state: "hourly_ok",
    actuals: actuals.data,
    unattributed: unattr.data.filter(() => true),
    workers: workerMeta,
    derive_freshness,
    unmapped_names: unmapped.data || [],
    account_periods,
    budget_periods,
    budget_mode,
    accounts_directory,
    regional_directors_display,
    board: buildBoard({
      account, start, end, today,
      actuals: actuals.data,
      budget_periods,
      account_state: "hourly_ok",
    }),
    week_budgets: buildWeekBudgets({ start, end, budget_periods }),
    prior_period_comparison: await buildPriorPeriodComparison({
      supa, rangeStart: start, rangeEnd: end, today,
      isAggregate: false, account,
      currentActuals: actuals.data,
    }),
    name_availability: {
      has_names: resolvedNames > 0,
      resolved: resolvedNames,
      total: workerIds.length,
      reason: resolvedNames === workerIds.length && workerIds.length > 0
        ? "all_resolved_from_users_endpoint"
        : !usersReachable
          ? "users_table_empty_or_unreachable"
          : "some_workers_lack_user_id_or_canonical_name",
    },
  };
  if (includeSalary) {
    const [budQ, actQ] = await Promise.all([
      load3100_2Budgets(supa, [account]),
      loadSalaryActuals(supa, [account], start, end),
    ]);
    if (budQ.error) return NextResponse.json(safeError("kpi_budgets_3100_2", budQ.error), { status: 500 });
    if (actQ.error) return NextResponse.json(safeError("labor_salary_actuals", actQ.error), { status: 500 });
    bodySingle = withSalaryMerge(bodySingle, {
      account, members: [account], start, end, today,
      buildBoard,
      buildWeekBudgets,
      salary3100_2: budQ.byAccount,
      salaryRows: actQ.rows,
    });
    // V40 BUG 5 - resolve any salary worker_ids not covered by the
    // hourly resolve. This is the CIN - AZ path (three salaried
    // workers, none in labor_actuals hourly).
    const salaryOnly = [...new Set(actQ.rows.map(r => r.worker_id))]
      .filter(id => id && !bodySingle.workers[id]);
    if (salaryOnly.length > 0) {
      const extra = await resolveWorkerMeta(supa, salaryOnly);
      bodySingle.workers = { ...bodySingle.workers, ...extra.workerMeta };
    }
  }
  bodySingle.salary_available = salary_available;
  bodySingle.landing_account = landing_account;
  bodySingle.source = "weekly";
  // homestand PR-1 - splice into the weekly body. Non-MLB accounts
  // get `homestands: []` so the client's tab-visibility check is
  // one predicate everywhere.
  bodySingle.homestands = homestandsList;
  if (homestandBank) bodySingle.homestand_bank = homestandBank;
  if (homestandSplice) Object.assign(bodySingle, homestandSplice);
  bodySingle.is_future_range = is_future_range;
  return NextResponse.json(bodySingle);
}

// Daily-source branch. Fires when the range resolver routes to daily
// grain (partial week, entirely at or after 2026-04-20). PR-3a moved
// the body into a Node-loadable helper (src/lib/labor/dailyRangeBody.js)
// so scripts/_probe_daily_source_purity.mjs can call it in-process
// against a real service_role client without an HTTP hop or auth
// session. This wrapper adds the NextResponse envelope; nothing else.
export async function handleDailyRangeRequest(ctx) {
  const out = await buildDailyRangeBody(ctx);
  if (out.error) return NextResponse.json(out.error.payload, { status: out.error.status });
  // homestand PR-1 - splice into the daily body. `homestands` is the
  // full list for MLB accounts (empty otherwise); the selected-stand
  // fields land only when the caller requested a homestand.
  const body = { ...out.body };
  if (ctx.homestandsList) body.homestands = ctx.homestandsList;
  if (ctx.homestandBank)  body.homestand_bank = ctx.homestandBank;
  if (ctx.homestandSplice) Object.assign(body, ctx.homestandSplice);
  if (typeof ctx.is_future_range === "boolean") body.is_future_range = ctx.is_future_range;
  return NextResponse.json(body);
}
