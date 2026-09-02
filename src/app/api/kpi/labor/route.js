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
import { fetchAllOffset } from "@/lib/rippling/paginate";
import { buildWorkerToEmail } from "@/lib/labor/personCount";
import { REGIONAL_DIRECTORS } from "@/lib/incidentSchema";
import { buildBoard, buildWeekBudgets, buildAggregateWeekBudgets } from "@/app/kpi/labor/lib/board.js";
// PR-1 extract (2026-08-31) - periods.js + computePeriodMeasures were
// only consumed by paginateActuals / resolveMemberBudget /
// buildPriorPeriodComparison; the loaders module owns those imports now.
import { loadRoleGate } from "@/lib/kpi/roleGate.js";
import { resolvePreviewAccess } from "@/lib/kpi/previewAccess.js";
import { load3100_2Budgets, loadSalaryActuals, withSalary as withSalaryMerge, pinHourlyOnly } from "@/lib/labor/salaryBoard.js";
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
import { snapRange } from "@/lib/kpi/rangeSnap.js";
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
// Overview Phase 2 PR-1 (2026-08-31) - pure move. paginateActuals,
// resolveMemberBudget, buildPriorPeriodComparison + V37_REVENUE_FLEX_ACCOUNTS
// now live in src/lib/labor/loaders.js so the overview KPI seat can
// consume them without route bloat. Same functions this route calls -
// no duplicate. See loaders.js header for the extraction contract.
import {
  V37_REVENUE_FLEX_ACCOUNTS,
  paginateActuals,
  resolveMemberBudget,
  buildPriorPeriodComparison,
} from "@/lib/labor/loaders.js";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// v6 PR-1 - reserved uppercase pseudo-account keys per V6-19. Chosen
// to collide with nothing the account regex admits (which requires
// spaced hyphens in the middle). URL: ?account=ALL / EAST / WEST.
const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

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
    // homestand-redesign 2026-08-26: timezone added so the day-strip
    // caption can convert UTC game_time to local. Owner ruling: NO
    // fallback - if timezone is null, client renders the date
    // without a time. A wrong first pitch is worse than no first
    // pitch. Populated today on STL - MO / CIN - OH / TXR - TX - H
    // / TXR - TX - V per owner verification 2026-08-26.
    .select("team_key, region, name, city, state, timezone")
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
      timezone: r.timezone || null,
      salaried: salaried.has(r.team_key),
    })),
  };
}

// paginateActuals, resolveMemberBudget, buildPriorPeriodComparison
// were extracted to src/lib/labor/loaders.js on 2026-08-31 (Overview
// Phase 2 PR-1). Imported at the top of this file - see that import
// block for the contract. Pure move, zero behaviour change.

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
  // 2026-08-28 preview mode - `account` is `let` because
  // resolvePreviewAccess may reassign it to the preview value when
  // preview is in the caller's real access. See below.
  let account = (searchParams.get("account") || "").trim();
  const previewParam = (searchParams.get("preview") || "").trim();
  // homestand PR-1 - start/end can be overridden by the homestand
  // selection below. `let` so the override lands cleanly; the
  // downstream range resolver, board build, and daily branch see
  // the window as if it had been requested directly.
  let start = searchParams.get("start") || "2025-12-29";  // FY2026 opens
  let end = searchParams.get("end") || today;
  // 2026-09-02 "retire custom + rolling" PR: snap any non-aligned
  // (start, end) to the fiscal period containing `end` per Kevin's
  // rule 4. The client's range menu emits aligned URLs, but /api/
  // is a front door too and the grain-mismatch defect Kevin
  // measured (65.7% GM on 08/03-08/30) fires the same way here.
  const _labSnap = snapRange(start, end, today);
  const _labSnapped = _labSnap.snapped;
  const _labSnappedFrom = _labSnap.snapped_from;
  start = _labSnap.start;
  end = _labSnap.end;
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

  // 2026-08-28 preview mode. Structural safety: preview only NARROWS
  // access, never grants it. `resolvePreviewAccess` intersects the
  // preview value against the caller's real access via the same
  // canViewAccount gate every other check uses. If the preview
  // isn't in real access, the resolver silently returns the URL
  // account unchanged - the empty intersection returns real access,
  // never grants. See src/lib/kpi/previewAccess.js + the 96-case
  // safety probe.
  //
  // Client uses the returned `preview_account` to render the amber
  // "Previewing as X" banner and to hide the folio rail when a
  // corporate/rdo user narrows to a single account.
  const preview = resolvePreviewAccess({
    caller,
    canViewAccount: gate.canViewAccount,
    urlAccount: account,
    previewParam,
  });
  account = preview.account;
  const preview_account = preview.preview_account;

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
      preview_account,
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
      preview_account,
      accounts_directory,
      regional_directors_display,
    });
  }

  // Step 2 ride-along 2026-08-29: `ids_seen` dropped from the select
  // because the only consumer was the deferred `last_walk_ids_seen`
  // field in derive_freshness, now removed. maybeSingle row read
  // stays; only the trimmed column count changes.
  const psWalkGlobal = await supa
    .from("rippling_walks")
    .select("completed_at")
    .eq("kind", "pay_segments")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // 2026-08-27 staleness banner: table-wide max(derived_at) on both
  // labor_actuals and labor_actuals_daily. The client's banner checks
  // these against a 30h threshold and renders amber if either is stale,
  // naming the stale table + timestamp. This is the "am I looking at
  // fresh data" surface - orthogonal to the Slack webhook on the
  // rippling-sync workflow, which answers "did the pipeline run". The
  // labor board opened cleanly every day for six days while the sync
  // was silently failing, until Kevin checked Actions by hand; the
  // banner is meant to stop that from happening again. Single-row
  // scalar reads via order+limit+maybeSingle; no wide scan.
  const [weeklyMaxQ, dailyMaxQ] = await Promise.all([
    supa.from("labor_actuals").select("derived_at")
      .order("derived_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("labor_actuals_daily").select("derived_at")
      .order("derived_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Step 2 ride-along 2026-08-29: `last_walk_ids_seen` removed from
  // the response. Deferred from Step 1; the only reference outside
  // this route was a stale comment in src/lib/labor/staleness.js
  // which the ride-along also updates. Prior value came from
  // rippling_walks.ids_seen; the rippling_walks read on the two
  // lines above stays (needed for last_walk_at). Nothing on the
  // client read the field.
  const freshness = {
    last_walk_at: psWalkGlobal.data?.completed_at || null,
    last_derive_at: null,
    // 2026-08-27 - table-wide maxes for the staleness banner. Distinct
    // from `last_derive_at` above which is in-scope-max (used by the
    // existing freshness pill) - a stale pipeline shows here even if
    // the currently-selected account has no in-scope rows.
    last_weekly_derive_at: weeklyMaxQ.data?.derived_at || null,
    last_daily_derive_at:  dailyMaxQ.data?.derived_at  || null,
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
    // 2026-08-28 pagination sweep. labor_actuals_daily is 4,792 rows
    // globally (measured); a mature single account has ~880 daily rows
    // today - 12% off the 1000 cap. sc_homestand_schedule is 1,146 rows
    // globally; multi-year single-account reads sit close to the cap.
    // Both go through fetchAllOffset with .eq() as a filter.
    let dailyRows, schedRows;
    try {
      [dailyRows, schedRows] = await Promise.all([
        fetchAllOffset(supa, "labor_actuals_daily",
          // homestand-redesign 2026-08-26: extend the daily select to
          // include per-worker OT hours so the played-day captions on
          // the day-strip can render the regular/OT split
          // (`06/26 Fri · vs MIA · $1,560 · 91% OT`). Client aggregates
          // by work_date to compute the per-day OT %. Adds three
          // fields to the payload; the existing per-day amount
          // aggregation (aggregatePerDay) already ignores extras.
          "work_date, amount, hours_regular, hours_overtime, dollars_overtime",
          [(q) => q.eq("account_key", account)]),
        fetchAllOffset(supa, "sc_homestand_schedule",
          // homestand-redesign 2026-08-26: fetch game_time + opponent
          // so the day-strip caption can carry `vs BAL · 6:45p` under
          // each game bar. game_time is TIMESTAMPTZ (UTC); client
          // converts via the account's timezone (added to response
          // below). NO fallback - owner ruling: if timezone is null,
          // render the date without a time rather than guessing UTC,
          // because a wrong first pitch is worse than no first pitch.
          "service_date, day_type, day_night, game_time, opponent",
          [(q) => q.eq("account_key", account)]),
      ]);
    } catch (e) {
      return NextResponse.json(safeError("homestand_daily_or_schedule", { message: e.message }), { status: 500 });
    }

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
            landing_account, preview_account, accounts_directory, regional_directors_display,
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
            landing_account, preview_account, accounts_directory, regional_directors_display,
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
        // homestand-redesign 2026-08-26: per-game schedule detail for
        // the day-strip caption. Each game in this stand's window
        // ships { date, opponent, day_night, game_time }. Client
        // renders `vs OPP · 6:45p` under game bars via account.timezone
        // conversion. Non-game days (prep/off) are absent from this
        // map; DayStrip already knows which dates ARE games via
        // homestand_game_dates. game_time may be null on rare rows
        // (e.g. TBD first-pitch on a rescheduled game); the client
        // renders date-without-time in that case rather than guessing.
        const schedByDate = new Map();
        for (const r of schedRows) {
          if (r.day_type !== "GAME") continue;
          if (r.service_date < found.game_start || r.service_date > found.game_end) continue;
          schedByDate.set(r.service_date, {
            date: r.service_date,
            opponent: r.opponent || null,
            day_night: r.day_night || null,
            game_time: r.game_time || null,   // TIMESTAMPTZ ISO, may be null
          });
        }
        homestandSplice = {
          homestand: found,
          homestand_game_dates: [...gameDatesForFound].sort(),
          homestand_night_dates: [...nightDatesForFound].sort(),
          homestand_schedule: [...schedByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
          homestand_split: found.split || null,
        };
        // HS PR-A: attach homestand_estimated on POST-FLOOR future
        // stands too. Same shape the pre-floor early-return ships at
        // line 559-577; PlanCards reads data.homestand_estimated and
        // does not care which branch produced it. is_estimated was
        // folded onto future stands by foldPreFloorEstimates when
        // game_start > today.
        //
        // HS FB1 PR-4 (owner ruling 2026-08-25): gate widens from
        // `found.is_estimated` to `found.actual_estimated != null` so
        // homestand_estimated ships on PLAYED stands too. The Actuals
        // | Plan toggle in the season rail card reads this payload to
        // render the retrospective plan alongside the played actual.
        // is_estimated stays false on played stands (rail hatch
        // semantics unchanged); the toggle is a client-side view
        // switch, not a substitution.
        if (found.actual_estimated != null) {
          const isPlayed = !found.is_estimated;
          homestandSplice.homestand_estimated = {
            total:         found.actual_estimated,
            per_day:       found.estimator_meta?.per_day || [],
            base_rates:    found.estimator_meta?.base_rates || null,
            source_stands: found.estimator_meta?.source_stands || 0,
            method:        "game_day_weighted",
            note:          found.pre_floor
              ? "Estimated: this stand is before daily detail started (04/20/26). Each week's real total is distributed across days by what the schedule says happened (night game, day game, prep day). Derived from the account's own low-OT stands."
              : isPlayed
                ? "Retrospective plan: the account's low-OT weekly totals distributed across this stand's days by night/day/prep weights. Compares what the plan would have said against what the stand actually cost."
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
      preview_account,
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
      caller, landing_account, preview_account,
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

    // Step 3 restructure 2026-08-29: five independent reads fired in
    // parallel now that members is resolved. Independence audit is in
    // the PR body; every branch below is proven to read only (supa,
    // members) or (supa) - none consume paginateActuals output.
    //
    // Loader inputs (audit):
    //   - paginateActuals(supa, {members, start, end, pageSize}) - members only
    //   - sc_day_metadata period bounds - (supa, canonAcct = members[0])
    //   - labor_unattributed - (supa) global read
    //   - earning_type_unmapped - (supa) global read
    //   - resolveMemberBudget(supa, m) x members.length - (supa, m per iter)
    //
    // The prior serial for-loop over resolveMemberBudget was 805ms
    // median (11 members * ~73ms per call, hitting kpi_budgets +
    // sc_labor_budgets on each). Promise.all over the same 11 calls
    // measured at 197ms median (-75%). The Map assembly downstream
    // (line ~1015 second loop) reads memberBudgets AFTER all entries
    // are populated - no ordering dependency, verified by reading.
    // See _probe_labor_step3_attribution.mjs for the numbers.
    const canonAcct = members[0];
    let aQ, periodDays, unattrRowsAgg, unmapped, memberBudgetResults;
    try {
      [aQ, periodDays, unattrRowsAgg, unmapped, memberBudgetResults] = await Promise.all([
        paginateActuals(supa, { members, start, end, pageSize: pageSizeParam }),
        supa.from("sc_day_metadata")
          .select("service_date, period")
          .eq("account_key", canonAcct)
          .gte("service_date", "2025-12-29")
          .lte("service_date", "2026-12-27")
          .not("period", "is", null),
        fetchAllOffset(supa, "labor_unattributed",
          "reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes",
          [(q) => q.order("amount", { ascending: false })]),
        supa.from("earning_type_unmapped")
          .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
          .is("resolved_at", null)
          .order("total_amount", { ascending: false }),
        Promise.all(members.map(m => resolveMemberBudget(supa, m))),
      ]);
    } catch (e) {
      // P3 (Step 4 2026-08-29): the try/catch wraps 5 loaders
      // (paginateActuals + sc_day_metadata + labor_unattributed +
      // earning_type_unmapped + resolveMemberBudget per-member).
      // Prior label `labor_unattributed` pointed a debugger at the
      // wrong table whenever any of the other four threw. Scope now
      // names the block, and the message carries the thrown text for
      // triage; the specific-loader .error paths below still surface
      // with their own precise scopes for the non-throw failure mode.
      return NextResponse.json(safeError("labor_aggregate_loaders", { message: e.message }), { status: 500 });
    }
    if (aQ.error) return NextResponse.json(safeError("labor_actuals_aggregate", aQ.error), { status: 500 });
    const actualsRows = aQ.data;

    // 2026-08-28 swallowing-catch fix: a DB error must surface as
    // safeError so downstream period-scope math cannot silently fall
    // back to fiscal defaults with wrong-looking-right numbers.
    if (periodDays.error) return NextResponse.json(safeError("sc_day_metadata_period_bounds_aggregate", periodDays.error), { status: 500 });
    // resolveMemberBudget error surfacing: each element in
    // memberBudgetResults carries { data } or { error, scope }. First
    // non-null error is the one we surface (same shape as the prior
    // serial loop's early return).
    for (let i = 0; i < memberBudgetResults.length; i += 1) {
      const r = memberBudgetResults[i];
      if (r.error) return NextResponse.json(safeError(r.scope, r.error), { status: 500 });
    }

    const periodBounds = new Map();
    for (const r of periodDays.data || []) {
      const p = String(r.period);
      const cur = periodBounds.get(p);
      if (!cur) periodBounds.set(p, { start: r.service_date, end: r.service_date });
      else {
        if (r.service_date < cur.start) cur.start = r.service_date;
        if (r.service_date > cur.end)   cur.end   = r.service_date;
      }
    }
    const account_periods = [...periodBounds.entries()]
      .map(([p, b]) => ({ fiscal_year: 2026, period_no: parseInt(p, 10), start: b.start, end: b.end }))
      .sort((a, b) => a.period_no - b.period_no);

    const unattr = { data: unattrRowsAgg };

    // Aggregate budget_periods - resolve each member via 4.5, sum
    // per period. Assembly before buildPriorPeriodComparison so its
    // return value is safely built before the next Promise.all.
    // V37-5 - revenue-flex accounts (TXR - TX - V) now join every
    // aggregate on both sides. Any superseded member period marks the
    // aggregate period superseded; member_detail carries the per-member
    // breakdown for the drill.
    const memberBudgets = new Map();
    for (let i = 0; i < members.length; i += 1) {
      memberBudgets.set(members[i], memberBudgetResults[i].data);
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

    // Step 3 restructure: workerMeta (needs actualsRows.worker_id) and
    // buildPriorPeriodComparison (needs actualsRows via
    // currentActuals; fires its own paginateActuals over the prior
    // window) are both independent-of-each-other reads that only
    // consume the Layer-1 outputs (actualsRows, members). Fire them
    // in parallel. Median saving: ~75ms (priorPeriod overlaps
    // resolveWorkerMeta rather than running after it).
    //
    // Loader inputs (audit):
    //   - resolveWorkerMeta(supa, workerIds): supa, workerIds from
    //     actualsRows[].worker_id (unique). Reads
    //     rippling_raw_workers_latest -> rippling_raw_users_latest
    //     (its own internal serial chain).
    //   - buildPriorPeriodComparison({supa, rangeStart, rangeEnd,
    //     today, isAggregate, members, currentActuals, pageSize}):
    //     supa, rangeStart/rangeEnd/today (URL params), isAggregate,
    //     members (Layer 1), currentActuals (paginateActuals output).
    //     Fires prior-period paginateActuals; does NOT touch
    //     workerMeta.
    //
    // Neither reads the other's output. Confirmed by reading; see
    // src/lib/kpi/resolveWorkerMeta.js and buildPriorPeriodComparison
    // (route.js line ~275).
    const workerIds = [...new Set(actualsRows.map(r => r.worker_id))];
    let workerMeta, resolvedNames, usersReachable, priorCmpAgg;
    try {
      const [workerRes, priorRes] = await Promise.all([
        resolveWorkerMeta(supa, workerIds),
        buildPriorPeriodComparison({
          supa, rangeStart: start, rangeEnd: end, today,
          isAggregate: true, members: rolledUpMembers,
          currentActuals: rolledUpActuals, pageSize: pageSizeParam,
        }),
      ]);
      ({ workerMeta, resolvedNames, usersReachable } = workerRes);
      priorCmpAgg = priorRes;
    } catch (e) {
      return NextResponse.json(safeError("workerMeta_or_prior", { message: e.message }), { status: 500 });
    }
    if (priorCmpAgg?.error) return NextResponse.json(safeError(priorCmpAgg.scope, priorCmpAgg.error), { status: 500 });

    // 2026-08-28 person-key fix: build the worker_id -> email map once
    // and thread it through buildBoard + salary paths so distinct-people
    // counts dedupe by person (email) not employment spell (worker_id).
    const workerToEmail = buildWorkerToEmail(workerMeta);

    let body = {
      ok: true,
      filters: { account, start, end },
      account_state: "hourly_ok",
      actuals: actualsRows,
      unattributed: (unattr.data || []).filter(() => true),
      workers: workerMeta,
      derive_freshness: {
        last_walk_at: freshness.last_walk_at,
        // Step 2 ride-along 2026-08-29: `last_walk_ids_seen` removed.
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
        last_weekly_derive_at: freshness.last_weekly_derive_at,
        last_daily_derive_at:  freshness.last_daily_derive_at,
      },
      unmapped_names: unmapped.data || [],
      account_periods,
      budget_periods,
      // Step 1 dead-payload sweep 2026-08-29: `budget_mode: "static"`
      // removed here and from the single body below. Value never
      // varied and no client code read it (only comment reference in
      // src/app/kpi/labor/lib/budgets.js was stale doc).
      members,
      rolled_up_members: rolledUpMembers,
      accounts_directory,
      regional_directors_display,
      board: buildBoard({
        account, start, end, today,
        actuals: rolledUpActuals,
        budget_periods,
        account_state: "hourly_ok",
        workerToEmail,
      }),
      week_budgets: buildAggregateWeekBudgets({ start, end, member_budgets: memberBudgets }),
      prior_period_comparison: priorCmpAgg,
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
    Object.assign(body, pinHourlyOnly(body.board));
    if (includeSalary) {
      const [budQ, actQ] = await Promise.all([
        load3100_2Budgets(supa, members),
        loadSalaryActuals(supa, members, start, end),
      ]);
      if (budQ.error) return NextResponse.json(safeError("kpi_budgets_3100_2", budQ.error), { status: 500 });
      if (actQ.error) return NextResponse.json(safeError("labor_salary_actuals", actQ.error), { status: 500 });
      // 2026-08-28 person-key fix: resolve salary worker_ids BEFORE
      // withSalaryMerge so the merged workerToEmail covers both the
      // hourly and salary sides. Previously salary worker names were
      // resolved AFTER the merge for display only - the merged board's
      // person-counts would have missed salary rehires. Now the merge
      // sees the complete map.
      const salaryOnlyIds = [...new Set(actQ.rows.map(r => r.worker_id))]
        .filter(id => id && !body.workers[id]);
      let mergedWorkerToEmail = workerToEmail;
      if (salaryOnlyIds.length > 0) {
        const extra = await resolveWorkerMeta(supa, salaryOnlyIds);
        body.workers = { ...body.workers, ...extra.workerMeta };
        mergedWorkerToEmail = buildWorkerToEmail(body.workers);
      }
      body = withSalaryMerge(body, {
        account, members, start, end, today,
        buildBoard,
        buildWeekBudgets,
        salary3100_2: budQ.byAccount,
        salaryRows: actQ.rows,
        workerToEmail: mergedWorkerToEmail,
      });
    }
    body.salary_available = salary_available;
    body.landing_account = landing_account;
    body.preview_account = preview_account;
    body.source = "weekly";
    body.is_future_range = is_future_range;
    return NextResponse.json(body);
  }

  if (D26_SALARIED_ONLY.has(account)) {
    // Step 1 dead-payload sweep 2026-08-29: `account_state_message`
    // removed. Nothing in the client (or elsewhere in the repo) read
    // this diagnostic string; the D26 body set it and, if
    // include_salary=1 was passed, immediately unset it below - a
    // clear signal it was dead by construction. Kept the
    // account_state discriminator ("salaried_only" vs "hourly_ok"),
    // which the client does branch on.
    let bodyD26 = {
      ok: true,
      filters: { account, start, end },
      account_state: "salaried_only",
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
    Object.assign(bodyD26, pinHourlyOnly(bodyD26.board));
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
      // Step 1 sweep 2026-08-29: `bodyD26.account_state_message = undefined`
      // removed. The field is no longer set at construction so there
      // is nothing to unset.
      // 2026-08-28 person-key fix: resolve salary worker_ids BEFORE
      // withSalaryMerge so the workerToEmail map covers them; D26
      // accounts arrive with an empty workers dict, so this is the
      // FIRST resolve for them.
      const salaryOnlyIds = [...new Set(actQ.rows.map(r => r.worker_id))]
        .filter(id => id && !bodyD26.workers[id]);
      let d26WorkerToEmail = new Map();
      if (salaryOnlyIds.length > 0) {
        const extra = await resolveWorkerMeta(supa, salaryOnlyIds);
        bodyD26.workers = { ...bodyD26.workers, ...extra.workerMeta };
        d26WorkerToEmail = buildWorkerToEmail(bodyD26.workers);
      }
      bodyD26 = withSalaryMerge(bodyD26, {
        account, members: [account], start, end, today,
        buildBoard,
        buildWeekBudgets,
        salary3100_2: budQ.byAccount,
        salaryRows: actQ.rows,
        workerToEmail: d26WorkerToEmail,
      });
    }
    bodyD26.salary_available = salary_available;
    bodyD26.landing_account = landing_account;
    bodyD26.preview_account = preview_account;
    bodyD26.source = "weekly";
    bodyD26.is_future_range = is_future_range;
    return NextResponse.json(bodyD26);
  }

  // Step 3 restructure 2026-08-29: five independent single-account
  // reads fired in parallel. Each depends only on (supa, account) or
  // (supa) - none consume any other's output.
  //
  // Loader inputs (audit):
  //   - labor_actuals_latest (paginated): (supa, account, start, end)
  //     Step 2 column trim 2026-08-29: matches paginateActuals - six
  //     dead cols dropped (line_code, period_no, week_source,
  //     segment_count, entry_count, source_run). Same consumer walk
  //     applies to this single-account path (same client, same
  //     buildBoard, same salaryBoard merge). .order() chain preserved.
  //   - labor_unattributed (paginated): (supa) global. 0 rows today
  //     (2026-08-28); paginating pre-emptively.
  //   - sc_day_metadata period bounds: (supa, account)
  //   - earning_type_unmapped: (supa) global. Empty today; 5-row map.
  //   - kpi_budgets 3100.1 + sc_labor_budgets: (supa, account) - was
  //     already a Promise.all inside a block; hoisted here.
  //
  // Median serial sum on TBR - FL FYTD: ~294ms (79+55+58+53+49).
  // Layer-1 parallel: max(79, 55, 58, 53, 49) = 79ms (-215ms).
  let actualsRows, unattrRows, periodDays, unmapped, pnlQ, scQ;
  try {
    [actualsRows, unattrRows, periodDays, unmapped, pnlQ, scQ] = await Promise.all([
      fetchAllOffset(supa, "labor_actuals_latest",
        "account_key, worker_id, week_label, week_start, week_end, fiscal_year, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, coverage_state, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h, approved_hours, oldest_draft_date, still_costing_hours, derived_at",
        [
          (q) => q.eq("account_key", account),
          (q) => q.lte("week_start", end),
          (q) => q.gte("week_end", start),
          (q) => q.order("week_start", { ascending: true }).order("worker_id", { ascending: true }),
        ]),
      fetchAllOffset(supa, "labor_unattributed",
        "reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes",
        [(q) => q.order("amount", { ascending: false })]),
      supa.from("sc_day_metadata")
        .select("service_date, period")
        .eq("account_key", account)
        .gte("service_date", "2025-12-29")
        .lte("service_date", "2026-12-27")
        .not("period", "is", null),
      supa.from("earning_type_unmapped")
        .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
        .is("resolved_at", null)
        .order("total_amount", { ascending: false }),
      supa.from("kpi_budgets")
        .select("period_no, amount")
        .eq("account_key", account)
        .eq("line_code", "3100.1")
        .eq("fiscal_year", 2026),
      supa.from("sc_labor_budgets")
        .select("period, hourly_budget, reason")
        .eq("account_key", account)
        .is("superseded_at", null),
    ]);
  } catch (e) {
    return NextResponse.json(safeError("labor_actuals", { message: e.message }), { status: 500 });
  }
  const actuals = { data: actualsRows };
  const unattr = { data: unattrRows };
  // 2026-08-28 swallowing-catch fix (single-account path). See the
  // aggregate-path fix for shape rationale.
  if (periodDays.error) return NextResponse.json(safeError("sc_day_metadata_period_bounds_single", periodDays.error), { status: 500 });
  if (pnlQ.error) return NextResponse.json(safeError("kpi_budgets_3100_1", pnlQ.error), { status: 500 });
  if (scQ.error)  return NextResponse.json(safeError("sc_labor_budgets", scQ.error),   { status: 500 });

  // account_periods: full FY period boundaries from sc_day_metadata for
  // this account. Powers client-side "this period" / "last period"
  // presets even before the current date-range fetch overlaps them.
  const periodBounds = new Map();
  for (const r of periodDays.data || []) {
    const p = String(r.period);
    const cur = periodBounds.get(p);
    if (!cur) periodBounds.set(p, { start: r.service_date, end: r.service_date });
    else {
      if (r.service_date < cur.start) cur.start = r.service_date;
      if (r.service_date > cur.end)   cur.end   = r.service_date;
    }
  }
  const account_periods = [...periodBounds.entries()]
    .map(([p, b]) => ({ fiscal_year: 2026, period_no: parseInt(p, 10), start: b.start, end: b.end }))
    .sort((a, b) => a.period_no - b.period_no);

  const derive_freshness = {
    last_walk_at: freshness.last_walk_at,
    // Step 2 ride-along 2026-08-29: `last_walk_ids_seen` removed.
    // V31 item 1 - MAX(derived_at) across in-scope rows. See aggregate
    // path above for cause.
    last_derive_at: (actuals.data || []).reduce(
      (max, r) => (r.derived_at && (!max || r.derived_at > max) ? r.derived_at : max),
      null
    ),
    last_weekly_derive_at: freshness.last_weekly_derive_at,
    last_daily_derive_at:  freshness.last_daily_derive_at,
  };

  // ── kpi-2 · budget_periods ──────────────────────────────────────
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
  //
  // Step 1 dead-payload sweep 2026-08-29: `budget_mode = "static"`
  // removed. Value never varied and no client code read it. If a
  // future superseded-vs-static discriminator is needed, add it as
  // a live signal (not a constant).
  const isRevenueFlexAcct = V37_REVENUE_FLEX_ACCOUNTS.has(account);
  let budget_periods = [];
  {
    // Step 3 restructure: pnlQ + scQ were previously fired as a
    // sub-Promise.all here; they now ride along in the Layer 1 hoist
    // above (labor_actuals + labor_unattributed + sc_day_metadata +
    // earning_type_unmapped + kpi_budgets + sc_labor_budgets = one
    // Promise.all after the preamble). Same read shape, same result
    // objects (pnlQ, scQ), same error handling; the parallel-of-two
    // moved into the parallel-of-six.
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

  // Step 3 restructure 2026-08-29: resolveWorkerMeta and
  // buildPriorPeriodComparison are both independent-of-each-other
  // reads that only depend on Layer-1 outputs (actualsRows). Fire in
  // parallel. Loader inputs (audit) - identical shape to the aggregate
  // path's Layer 2:
  //   - resolveWorkerMeta(supa, workerIds): supa, workerIds from
  //     actualsRows[].worker_id. Reads workers -> users (own serial
  //     chain per Candidate B).
  //   - buildPriorPeriodComparison(single): supa, rangeStart, rangeEnd,
  //     today, isAggregate:false, account, currentActuals. Fires the
  //     narrow 9-column prior-period read against labor_actuals_latest;
  //     does NOT touch workerMeta.
  //
  // Median saving: ~55ms (priorPeriodSingle overlaps
  // resolveWorkerMeta rather than running after it).
  const workerIds = [...new Set(actuals.data.map(r => r.worker_id))];
  let workerMeta, resolvedNames, usersReachable, priorCmpSingle;
  try {
    const [workerRes, priorRes] = await Promise.all([
      resolveWorkerMeta(supa, workerIds),
      buildPriorPeriodComparison({
        supa, rangeStart: start, rangeEnd: end, today,
        isAggregate: false, account,
        currentActuals: actuals.data,
      }),
    ]);
    ({ workerMeta, resolvedNames, usersReachable } = workerRes);
    priorCmpSingle = priorRes;
  } catch (e) {
    return NextResponse.json(safeError("workerMeta_or_prior_single", { message: e.message }), { status: 500 });
  }
  if (priorCmpSingle?.error) return NextResponse.json(safeError(priorCmpSingle.scope, priorCmpSingle.error), { status: 500 });
  // 2026-08-28 person-key fix (single-account path).
  const workerToEmail = buildWorkerToEmail(workerMeta);

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
    // Step 1 dead-payload sweep 2026-08-29: `budget_mode` removed
    // (was always "static", never read).
    accounts_directory,
    regional_directors_display,
    board: buildBoard({
      account, start, end, today,
      actuals: actuals.data,
      budget_periods,
      account_state: "hourly_ok",
      workerToEmail,
    }),
    week_budgets: buildWeekBudgets({ start, end, budget_periods }),
    prior_period_comparison: priorCmpSingle,
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
  Object.assign(bodySingle, pinHourlyOnly(bodySingle.board));
  if (includeSalary) {
    const [budQ, actQ] = await Promise.all([
      load3100_2Budgets(supa, [account]),
      loadSalaryActuals(supa, [account], start, end),
    ]);
    if (budQ.error) return NextResponse.json(safeError("kpi_budgets_3100_2", budQ.error), { status: 500 });
    if (actQ.error) return NextResponse.json(safeError("labor_salary_actuals", actQ.error), { status: 500 });
    // 2026-08-28 person-key fix: resolve salary worker_ids BEFORE
    // withSalaryMerge so the workerToEmail map covers them. This is
    // the CIN - AZ path (three salaried workers, none in labor_actuals
    // hourly) - salary workers were previously only resolved AFTER
    // the merge for display, so the merged board's person-counts
    // missed any salary rehires.
    const salaryOnlyIds = [...new Set(actQ.rows.map(r => r.worker_id))]
      .filter(id => id && !bodySingle.workers[id]);
    let mergedWorkerToEmail = workerToEmail;
    if (salaryOnlyIds.length > 0) {
      const extra = await resolveWorkerMeta(supa, salaryOnlyIds);
      bodySingle.workers = { ...bodySingle.workers, ...extra.workerMeta };
      mergedWorkerToEmail = buildWorkerToEmail(bodySingle.workers);
    }
    bodySingle = withSalaryMerge(bodySingle, {
      account, members: [account], start, end, today,
      buildBoard,
      buildWeekBudgets,
      salary3100_2: budQ.byAccount,
      salaryRows: actQ.rows,
      workerToEmail: mergedWorkerToEmail,
    });
    // Legacy CIN - AZ re-resolve retained as belt-and-braces: the
    // salary-first resolve above covers this today, but a future
    // refactor that changes the merge shape shouldn't silently drop
    // salary names. Idempotent.
    const salaryOnly = [...new Set(actQ.rows.map(r => r.worker_id))]
      .filter(id => id && !bodySingle.workers[id]);
    if (salaryOnly.length > 0) {
      const extra = await resolveWorkerMeta(supa, salaryOnly);
      bodySingle.workers = { ...bodySingle.workers, ...extra.workerMeta };
    }
  }
  bodySingle.salary_available = salary_available;
  bodySingle.landing_account = landing_account;
  bodySingle.preview_account = preview_account;
  bodySingle.source = "weekly";
  // homestand PR-1 - splice into the weekly body. Non-MLB accounts
  // get `homestands: []` so the client's tab-visibility check is
  // one predicate everywhere.
  bodySingle.homestands = homestandsList;
  if (homestandBank) bodySingle.homestand_bank = homestandBank;
  if (homestandSplice) Object.assign(bodySingle, homestandSplice);
  bodySingle.is_future_range = is_future_range;
  // 2026-09-02: snap disclosure - the client chip reads "Period N ·
  // snapped from a custom range" when set. Homestand requests carry
  // a game-window range that isn't period-aligned by design; skip
  // the snap disclosure when a homestand override took effect.
  if (_labSnapped && !homestandParam) {
    bodySingle.range_snap = {
      snapped: true,
      snapped_from: _labSnappedFrom,
      snapped_to: { start, end },
    };
  }
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
