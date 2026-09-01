// /api/kpi/purchasing
//
// KPI PURCHASING PHASE 2 - PR 1 (route addendum). Contract:
// docs/KPI_PURCHASING_PHASE2_BUILD_SPEC.md §6.1-6.6.
//
// DATA ONLY. No UI. No writes to Invoice Capture tables. No changes
// to /api/kpi/labor. Never touches Rippling or bill.com directly - it
// reads the derived purchasing_actuals plus the two views. The syncs
// (C2 + C3) do the writes.
//
// Mirrors /api/kpi/labor's contract exactly:
//   - same range resolution via periods.js (imported, never forked)
//   - same account / aggregate / region paths (ALL / EAST / WEST +
//     single-account team_keys)
//   - same PSEUDO_KEYS discipline
//   - same envelope-exclusion mechanics as V25-1
//
// Returns:
//   range              { start, end }
//   fiscal context     { fiscal_year, period_no (if single period),
//                        elapsed_frac, closed_weeks_in_range, weeks_in_range }
//   budget             { by_gl_line_code: [{ gl_line_code, amount }] }
//                       amount summed via labor's per-week convention
//                      (period amount / 4 per fiscal week in range).
//   weekly             [{ account_key, gl_line_code, gl_bucket,
//                         week_start, week_end, amount, line_count,
//                         bill_count, paid_amount }]
//                       Weekly rollup from v_purchasing_by_site_week
//                       (SQL-side aggregation, floor identical to
//                       weekStartsInRange). Replaces the per-line
//                       `actuals` array as the primary weekly series.
//   pending            { amount, line_count } - rippling_spend rows in
//                       range whose gl_line_code IS NULL. A dollar sum
//                       + line count. Never split by bucket (§3.5):
//                       card spend carries no GL line, which is the
//                       whole reason it sits outside the buckets.
//                       Bills-only excluded (source='rippling_spend').
//                       excluded=false. Members-filtered.
//   buckets            [{ bucket ('food'|'packaging'|'vehicle'),
//                         gl_prefix ('3200'|'3400'|'3500'),
//                         budget, spent, variance, pace_pct, state,
//                         line_codes: [gl_line_code, ...] }]
//                       Rollup of 3200.x/3400.x/3500.x from bills
//                       only (§3.4: bucket card state uses bills
//                       only; card spend cannot be attributed to a
//                       bucket). Envelope-account exclusion is now a
//                       named empty set - see PURCHASING_ENVELOPE_EXCLUSIONS
//                       in src/lib/accountModels.js. For pass_through
//                       accounts (CIN - OH, STL - FL, STL - MO) each
//                       bucket returns state='passthru', variance=null,
//                       pace_pct=null - the stewardship budget still
//                       returns as context, not as a target.
//   periods            [{ period_no, start, end, spent, budget,
//                         weeks, closed }] for P1..currentPeriodNo.
//                       Spent is bills+card (bucket-neutral - matches
//                       the totals hero on the period card, §4.1).
//                       Trend card reads this. Cached to FYTD scope,
//                       not the request range.
//   categories         ADAPTIVE list per (account, range). Every
//                      gl_line_code with budget > 0 OR actual > 0 in
//                      range, priority-ordered:
//                        3200.1, 3200.2, 3400.1, 3400.2, 3400.5,
//                        3500.x, then reimbursable 13xx, then sga 5xxx.
//                       Each: { gl_line_code, budget, spent, variance,
//                        pace_pct (in progress) or final (closed),
//                        bucket }.
//   totals             { pl_cogs {budget, spent, variance},
//                        reimbursable {spent, billed_to_client},
//                        sga {spent},
//                        card {spent, unattributed, uncoded} }
//   provisional        true when range end + 16 days > today
//                       (bill.com entry-lag p90).
//   freshness          { last_billcom_sync, last_rippling_sync,
//                       last_derive_at }
//   sentinel           the frozen (TBR - FL, P8, 3200.1) value.
//   actuals            ONLY present when ?drill=lines. Bill-level raw
//                       rows for the drill-down table. Same shape and
//                       filters as prior default. Off-by-default:
//                       12,672 rows / 4.5 MB on ALL FYTD is the
//                       wrong shape for a board.
//
// Query params:
//   account            accounts.team_key OR ALL / EAST / WEST (required)
//   start              YYYY-MM-DD (defaults to fiscal-year start)
//   end                YYYY-MM-DD (defaults to today)
//   drill              'lines' to include the per-line `actuals` array
//
// Auth: session gate via OPS_LEADERSHIP_EMAILS (identical to labor).
// TEST_MODE bypass mirrors src/middleware.js for local Playwright +
// smoke runs; never fires on Vercel (VERCEL=1 unsets regardless).
// No name / dollar / vendor / merchant echo in error paths.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
// KPI PREVIEW FENCE - single source of truth in roleGate.js. The
// purchasing route has not adopted the full role model yet (that is
// Phase 2 work); until it does, the same allowlist that gates the
// labor route also gates this one.
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "@/lib/kpi/roleGate";
import { loadRoleGate } from "@/lib/kpi/roleGate.js";
import { resolvePreviewAccess } from "@/lib/kpi/previewAccess.js";
import { getServiceClient } from "@/lib/supabase";
import {
  FY_START_ISO, periodOf, periodStartISO, periodEndISO,
  weekStartsInRange, inferRangeSelection, currentPeriodNo,
} from "@/app/kpi/labor/lib/periods.js";
// Cost-model constants live in the shared module (Kevin ruling
// 2026-08-20). PASS_THROUGH_ACCOUNTS drives the state-resolver
// distinction (see stateOf below + pass_through short-circuit in the
// buckets rollup). PURCHASING_ENVELOPE_EXCLUSIONS replaces the inline
// V6_ENVELOPE_ACCOUNTS constant this route used to carry - it is now
// a named empty set (TXR - TX - V's purchasing envelope was removed
// per the same ruling; its budget resolves from kpi_budgets like every
// other at-risk account).
import {
  PASS_THROUGH_ACCOUNTS,
  PURCHASING_ENVELOPE_EXCLUSIONS,
  costModelFor,
  MANAGEMENT_FEE_GOALS,
  isKnownAccount,
} from "@/lib/accountModels";
// Precedence: API over report between sources, newest over older
// within report.  loadReportOnlyPending reads the migration-8 view;
// mergePending combines the two sources under the precedence rule.
import {
  loadReportOnlyPending,
  mergePending,
} from "@/app/kpi/purchasing/lib/precedence.js";
// Shared purchasing loaders extracted to src/lib/purchasing/loaders.js on
// 2026-08-31 (Overview Phase 2 PR-2b) so the Overview KPI resolver can
// call them without going through this HTTP route. Pure move: zero
// behaviour change; the route imports and calls the same functions.
// IN_CHUNK + chunk are re-exported constants used by this route's
// drill=lines branch (billcom vendor id resolve) and passed into
// loadReportOnlyPending, so they ride back in the same import.
import {
  IN_CHUNK,
  chunk,
  paginateActuals,
  paginateWeekly,
  loadPriorPeriodHistory,
  loadPending,
  fetchMembers,
  loadPurchasingBudgets,
  computeSentinel,
  loadAccountsDirectory,
  loadFreshness,
  loadLedgerRows,
  loadCardCharges,
  loadVendorRollup,
  loadCompliance,
} from "@/lib/purchasing/loaders.js";

const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// V6_ENVELOPE_ACCOUNTS is retained as an alias for readability at the
// call sites that still spell it that way. It now points at the
// shared PURCHASING_ENVELOPE_EXCLUSIONS - an empty set - so the
// exclusion is a named empty concept, not a per-route silent removal.
const V6_ENVELOPE_ACCOUNTS = PURCHASING_ENVELOPE_EXCLUSIONS;

// bill.com entry-lag p90 per master §3. A period is provisional until
// range_end + 16 days is in the past.
const PROVISIONAL_WINDOW_DAYS = 16;

// Category priority order for adaptive list (spec §3).
// Ordinal reflects the ordering the client renders top-to-bottom.
const CATEGORY_PRIORITY = [
  "3200.1", "3200.2", "3400.1", "3400.2", "3400.5",
];

// Bucket definitions. See PHASE2_BUILD_SPEC.md §1 table:
//   Food     3200.x  (general + resale)
//   Packaging & supplies 3400.x  (packaging + supplies + linen)
//   Vehicle  3500.x  (lease + fuel + insurance + R&M)
const BUCKETS = [
  { key: "food",      gl_prefix: "3200", label: "Food" },
  { key: "packaging", gl_prefix: "3400", label: "Packaging & supplies" },
  { key: "vehicle",   gl_prefix: "3500", label: "Vehicle" },
];

function bucketForGl(gl) {
  if (!gl) return null;
  const s = String(gl);
  if (s.startsWith("3200")) return "food";
  if (s.startsWith("3400")) return "packaging";
  if (s.startsWith("3500")) return "vehicle";
  return null;
}

function comparePriority(a, b) {
  const ai = CATEGORY_PRIORITY.indexOf(a);
  const bi = CATEGORY_PRIORITY.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  // Both fall outside the explicit priority list. Order:
  //   pl_cogs (3xxx) first, sorted numeric-lex
  //   reimbursable (13xx) next
  //   sga (5xxx) last
  const rank = (x) => {
    if (!x) return 9;
    const s = String(x);
    if (s.startsWith("32") || s.startsWith("34") || s.startsWith("35")) return 1;
    if (s.startsWith("13")) return 2;
    if (s.startsWith("5"))  return 3;
    return 4;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b));
}

function glBucketFor(accountNumber) {
  if (!accountNumber) return null;
  const s = String(accountNumber);
  if (s.startsWith("32") || s.startsWith("34") || s.startsWith("35")) return "pl_cogs";
  if (s.startsWith("13")) return "reimbursable";
  if (s.startsWith("5"))  return "sga";
  return "other";
}

function safeError(scope, err) {
  console.error(`[kpi/purchasing] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

// State resolver (§3.4). One implementation. The pill, the bar
// pattern, the hero colour and the table variance all read from this.
// Three elements disagreeing about the same bucket is a P0.
//
// PASS_THROUGH SEMANTICS (Kevin ruling 2026-08-20):
//   For a pass_through account (CIN - OH, STL - FL, STL - MO) the
//   caller passes { isPassThrough: true } and this returns 'passthru'
//   - a distinct state, not 'under'. The stewardship budget still
//     rides on the payload as context; there is NO variance state,
//     NO over/under verdict, NO pace pill. Rendering rules elsewhere
//     must map 'passthru' to a "Billed back to client" affordance
//     rather than dropping the row.
//   This is deliberately BEFORE the budget check - a pass-through
//   account with no budget populated still resolves to 'passthru',
//   not 'nobud', so the render stays consistent while the
//   stewardship-budget seeding lands.
function stateOf({ spent, budget, elapsedFrac, hasBills, isPassThrough }) {
  if (isPassThrough) return "passthru";
  if (!(budget > 0)) return "nobud";
  if (!hasBills) return "none";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}

// paginateActuals, paginateWeekly, loadPriorPeriodHistory, loadPending,
// fetchMembers, loadPurchasingBudgets now live in src/lib/purchasing/loaders.js
// (Overview Phase 2 PR-2b, 2026-08-31) so the Overview KPI resolver can
// call them without going through this HTTP route. Route imports them at
// the top of the file - zero behaviour change, no duplicate definitions.
// See loaders.js header for the extraction contract.

// Sum budget for a gl_line_code over the fiscal weeks contained in
// [start, end]. Uses labor's per-week convention: period_amount / 4
// per fiscal week in range. Envelope accounts are excluded from
// aggregate rollups (V6_ENVELOPE_ACCOUNTS).
function budgetForRange({ byLine, glLineCode, members, start, end }) {
  const weeks = weekStartsInRange(start, end);
  if (weeks.length === 0) return 0;
  const perLine = byLine.get(glLineCode);
  if (!perLine) return 0;
  let total = 0;
  for (const w of weeks) {
    const p = periodOf(w);
    if (p == null) continue;
    for (const m of members) {
      if (V6_ENVELOPE_ACCOUNTS.has(m)) continue;
      const byAcct = perLine.get(m);
      if (!byAcct) continue;
      const amt = byAcct.get(p);
      if (amt == null) continue;
      total += amt / 4;
    }
  }
  return Math.round(total * 100) / 100;
}

// Sum period budget for a gl_line_code across members (no per-week
// prorate - the caller wants the full-period figure). Envelope
// accounts excluded.
function budgetForPeriod({ byLine, glLineCode, members, periodNo }) {
  const perLine = byLine.get(glLineCode);
  if (!perLine) return 0;
  let total = 0;
  for (const m of members) {
    if (V6_ENVELOPE_ACCOUNTS.has(m)) continue;
    const byAcct = perLine.get(m);
    if (!byAcct) continue;
    const amt = byAcct.get(periodNo);
    if (amt == null) continue;
    total += amt;
  }
  return Math.round(total * 100) / 100;
}

// computeSentinel, loadAccountsDirectory, loadFreshness now live in
// src/lib/purchasing/loaders.js (Overview Phase 2 PR-2b). Route imports
// them at the top of the file.

// loadLedgerRows, loadCardCharges, loadVendorRollup, loadCompliance now
// live in src/lib/purchasing/loaders.js (Overview Phase 2 PR-2b,
// 2026-08-31) so the Overview KPI resolver can call them without going
// through this HTTP route. Route imports them at the top - zero
// behaviour change, no duplicate definitions. See loaders.js header for
// the full extraction contract + per-loader docblocks.

// ─── Route handler ───────────────────────────────────────────────────

export async function GET(request) {
  // TEST_MODE double-gate mirrors src/middleware.js so local Playwright
  // + smoke runs can reach the read-only API. Never fires on Vercel
  // (VERCEL=1 unsets the bypass regardless of env vars).
  const testModeBypass = process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";
  if (!testModeBypass) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const email = session.user?.email?.toLowerCase().trim();
    // KPI PREVIEW FENCE - sits in FRONT of the existing
    // OPS_LEADERSHIP_EMAILS gate so a fenced caller is refused even
    // if they are on the ops leadership list. Flipping
    // KPI_PREVIEW_ONLY to false in src/lib/kpi/roleGate.js opens
    // this route back up to OPS_LEADERSHIP_EMAILS.
    if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  // 2026-08-28 preview mode adoption (labor's #873 shape).  `account`
  // is `let` because resolvePreviewAccess reassigns it to the preview
  // value when preview intersects real access.
  let account = (searchParams.get("account") || "").trim();
  const previewParam = (searchParams.get("preview") || "").trim();
  const start = searchParams.get("start") || FY_START_ISO;
  const end = searchParams.get("end") || today;
  const drill = (searchParams.get("drill") || "").trim().toLowerCase();
  const includeLines = drill === "lines";
  // PR 4 - drill-down table. Lazy source-split aggregate for the SHOW
  // filter (All / Bills only / Cards only). Off by default so the
  // mount payload is unchanged. The drill-table client fetches with
  // `?table=1` on the FIRST switch to Bills or Cards, caches, then
  // reads from that data. Payload delta is measured in the return
  // (see mgmt_fee for the shape of an additive block).
  const includeTable = (searchParams.get("table") || "").trim() === "1";
  const pageSizeParam = parseInt(searchParams.get("_page_size") || "0", 10);

  const supa = getServiceClient();

  // 2026-08-28 preview mode adoption (labor's #873 shape).  Load the
  // role gate to get `canViewAccount` for the preview intersection;
  // resolvePreviewAccess silently ignores preview whose target the
  // caller can't view.  This runs BEFORE the !account 400 gate so a
  // corporate hitting `?preview=CIN - AZ` (no ?account=) still lands
  // on the previewed account.
  //
  // NOT a permissions change: the OPS_LEADERSHIP + KPI_PREVIEW gates
  // above already refused unauthorised callers.  This block only
  // narrows an authorised caller's effective account.
  const gate = await loadRoleGate(supa);
  if (gate.error) return NextResponse.json(safeError("role_gate", gate.error), { status: 500 });
  let caller = null;
  if (testModeBypass) {
    caller = { role: "corporate", scope: null, can_see_salary: true };
  } else {
    // Auth already ran above; re-derive email for the gate.
    const session = await auth();
    const email = session?.user?.email?.toLowerCase().trim();
    if (email) {
      try { caller = await gate.resolveKpiRole(email); } catch {}
    }
  }
  const landing_account = caller ? gate.landingAccount(caller) : null;

  // Preview target must be a known account (or a pseudo like ALL/EAST/
  // WEST that maps to a member set).  Skip the intersection when it
  // isn't - downstream `costModelFor` and friends throw on unknown
  // strings.  Silent-ignore an unknown preview matches the safety
  // spirit of resolvePreviewAccess: never grant, never crash.
  const previewIsValidTarget = previewParam && (
    isKnownAccount(previewParam) || V6_PSEUDO_KEYS.has(previewParam)
  );
  const preview = resolvePreviewAccess({
    caller,
    canViewAccount: gate.canViewAccount,
    urlAccount: account,
    previewParam: previewIsValidTarget ? previewParam : "",
  });
  account = preview.account;
  const preview_account = preview.preview_account;

  if (!account) {
    return NextResponse.json({
      error: "account_required",
      detail: "?account=<team_key> is required",
      landing_account,
      preview_account,
    }, { status: 400 });
  }
  if (D17_OUT_OF_SCOPE.has(account)) {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }

  // Resolve members.
  const membersResp = await fetchMembers(supa, account);
  if (membersResp.error) return NextResponse.json(safeError("members", membersResp.error), { status: 500 });
  const members = membersResp.members;
  if (members.length === 0) {
    return NextResponse.json({ error: "no_members_in_selection", account }, { status: 400 });
  }

  const isAggregate = V6_PSEUDO_KEYS.has(account);

  // ── PR-2 R4 Part A: partial-week accounting rule (owner ruling
  // 2026-08-24) ──────────────────────────────────────────────────────
  //
  // Labor's `paginateActuals` at labor/route.js:137-138 uses OVERLAP
  // semantics on labor_actuals_latest:
  //     .lte("week_start", end).gte("week_end", start)
  // so ANY fiscal week that overlaps the user's range is counted at
  // week-grain. Purchasing was using start-only semantics
  //     .gte("week_start", start).lte("week_start", end)
  // which silently drops a fiscal week whose week_start is 1..6 days
  // BEFORE rangeStart - the classic 07/28 case where week_start=07/27
  // gets dropped from the view read while purchasing_actuals still
  // counts the 07/28..08/02 partial-week bills via `txn_date >= start`.
  // That produced the three-figures-don't-agree bug on TBR-FL 07/28-08/24
  // ($18,171.25 hero vs $26,614.47 From bills vs "no spend" week bar).
  //
  // Chosen rule: **include the whole fiscal week when it overlaps the
  // range** (Kevin's Option 2). Matches labor's overlap semantics.
  // Every read below (weekly view, purchasing_actuals, pending) uses
  // the SAME [effStart, effEnd] pair so hero, bills,
  // cards, bars all describe the same fiscal-week footprint. URL /
  // rangeLabel keep the user's start/end untouched - the chart bar
  // caption already prints the real MM/DD - MM/DD fiscal-week label
  // via `weekRangeLabel` (WeekChart.js:64), so the widening is honest
  // on screen without dishonest range copy.
  const fiscalWeeks = weekStartsInRange(start, end);
  const effStart = fiscalWeeks.length > 0 ? fiscalWeeks[0] : start;
  const effEnd = fiscalWeeks.length > 0
    ? (() => {
        const last = fiscalWeeks[fiscalWeeks.length - 1];
        const d = new Date(last + "T00:00:00.000Z");
        d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().slice(0, 10);
      })()
    : end;

  // FY2026 hard-coded; matches labor's convention. Loaded inside the
  // merged Promise.all below.
  const fyForRange = 2026;

  // R13 P0-1: detect the closed single-period case so we can fetch
  // prior-period + 8-period sparkline history in parallel with the
  // other loaders.  Guard: only fires when the range EQUALS a single
  // fiscal period AND the period is closed (end date before today).
  // Aggregate scopes roll up across members inside the loader.
  const rangeSelectionEarly = inferRangeSelection(start, end);
  const isSinglePeriodRange = rangeSelectionEarly?.kind === "period" && rangeSelectionEarly.value != null;
  const singlePeriodNo = isSinglePeriodRange ? Number(rangeSelectionEarly.value) : null;
  const rangeEndDate = new Date(end + "T23:59:59Z");
  const todayDateEarly = new Date(today + "T00:00:00Z");
  const isClosedSinglePeriod = isSinglePeriodRange && rangeEndDate < todayDateEarly;

  // Merged loader block (INV-P23 arc 2026-08-29). What used to be
  // three sequential waits (serial loadPurchasingBudgets + first
  // Promise.all of 8 loaders + second Promise.all of 6 loaders) is
  // one Promise.all of 15. Rollups between the two prior blocks
  // measured at 6ms combined on ALL FYTD - the split bought nothing.
  // Dependency audit 2026-08-29 read each of the six ledger/card/
  // vendor loaders and confirmed none reads first-block state; they
  // only take {members, start, end, cap}. Wait time is max(all 15)
  // instead of sum-of-three-waits.
  //
  // F-11 item 1 instrumentation (2026-09-01): per-loader timing so
  // cold-lambda reproduction can name the loader that timed out and
  // its elapsed. Side-channel array; returns unchanged. Logged after
  // Promise.all settles as one greppable [F-11-timing] line so we
  // can slice by scope in Vercel runtime logs.
  const loaderTimings = [];
  const timed = (name, p) => {
    const t0 = Date.now();
    return p.then(
      r => { loaderTimings.push({ name, ms: Date.now() - t0, ok: !r?.error }); return r; },
      e => { loaderTimings.push({ name, ms: Date.now() - t0, ok: false, thrown: true }); throw e; }
    );
  };
  const promiseAllT0 = Date.now();

  // PR-2 R4 Part A: [effStart, effEnd] pass so weekly view, actuals,
  // pending all describe the same fiscal-week footprint.
  const [
    weeklyResp, pendingResp, reportPendingResp, actualsResp, freshness,
    dirResp, priorHistoryResp, complianceResp, budgetsResp,
    vehicleR, equipR, repairR, reimbR, cardChR, vendorRollupR,
  ] = await Promise.all([
    timed("paginateWeekly",        paginateWeekly(supa, { members, start: effStart, end: effEnd })),
    timed("loadPending",           loadPending(supa, { members, start: effStart, end: effEnd })),
    timed("loadReportOnlyPending", loadReportOnlyPending(supa, { members: members.filter(m => m !== "CORP"), start: effStart, end: effEnd, IN_CHUNK })),
    timed("paginateActuals",       paginateActuals(supa, { members, start: effStart, end: effEnd, pageSize: pageSizeParam, includeLines })),
    timed("loadFreshness",         loadFreshness(supa)),
    timed("loadAccountsDirectory", loadAccountsDirectory(supa)),   // PR-2 R2 Fix 7
    // R13 P0-1 - history for closed period card only.  Loader returns
    // { data: null } instantly if the range isn't a closed period.
    timed("loadPriorPeriodHistory", isClosedSinglePeriod
      ? loadPriorPeriodHistory(supa, { members, periodNo: singlePeriodNo })
      : Promise.resolve({ data: null })),
    // PR 6 - compliance card. Reads the report side of uncoded card
    // spend (rippling_report_txns_latest sentinel category) restricted
    // to attributable work locations. Corp/Remote uncoded rows are a
    // footer count only. See loadCompliance() docblock for the full
    // shape + why the population is the report side, not the board.
    timed("loadCompliance",        loadCompliance(supa, { members, start: effStart, end: effEnd, today })),
    // Moved from serial (INV-P23 arc, was ~265ms of blocking wait).
    timed("loadPurchasingBudgets", loadPurchasingBudgets(supa, members, fyForRange)),
    // Moved from the second Promise.all (INV-P23 arc). Each loader's
    // dependency confirmed to be {members, start, end, cap} only.
    timed("loadLedgerRows.vehicle",       loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLikePrefix: "3500%", cap: 25 })),
    timed("loadLedgerRows.equipment",     loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.5", cap: 25 })),
    timed("loadLedgerRows.repair",        loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.1", cap: 25 })),
    timed("loadLedgerRows.reimbursable",  loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLikePrefix: "13%",    cap: 25 })),
    timed("loadCardCharges",       loadCardCharges(supa, { members, start: effStart, end: effEnd, cap: 50 })),
    timed("loadVendorRollup",      loadVendorRollup(supa, { members, start: effStart, end: effEnd })),
  ]);

  // F-11 item 1: emit greppable timing summary. Every request; not
  // gated on threshold - the cold-vs-warm distinction is what we
  // need to see, and warm requests are ~200ms of log noise that
  // amortises cheaply against the diagnostic value.
  {
    const total = Date.now() - promiseAllT0;
    const sorted = [...loaderTimings].sort((a, b) => b.ms - a.ms);
    const slowest = sorted[0] || { name: "?", ms: 0 };
    const near = sorted.filter(t => t.ms >= 5500);  // within 500ms of the 6s F-11 guard
    const parts = sorted.map(t => `${t.name}=${t.ms}${t.ok ? "" : "!"}`).join(" ");
    const near_note = near.length > 0 ? ` near_guard=${near.map(t => `${t.name}:${t.ms}`).join(",")}` : "";
    console.log(`[F-11-timing] account=${account} range=${effStart}..${effEnd} total=${total}ms slowest=${slowest.name}:${slowest.ms}ms${near_note} | ${parts}`);
  }
  if (weeklyResp.error) return NextResponse.json(safeError("v_purchasing_by_site_week", weeklyResp.error), { status: 500 });
  if (pendingResp.error) return NextResponse.json(safeError("pending", pendingResp.error), { status: 500 });
  // F-11: reportPendingResp is a genuine SQL error only. Timeouts on
  // the view are absorbed by loadReportOnlyPending's Promise.race and
  // returned as data.unavailable=true. Real errors still 500.
  if (reportPendingResp.error) return NextResponse.json(safeError("rippling_report_only_pending_v1", reportPendingResp.error), { status: 500 });
  if (actualsResp.error) return NextResponse.json(safeError("purchasing_actuals", actualsResp.error), { status: 500 });
  if (dirResp.error) return NextResponse.json(safeError("accounts_directory", dirResp.error), { status: 500 });
  if (priorHistoryResp.error) return NextResponse.json(safeError("prior_period_history", priorHistoryResp.error), { status: 500 });
  if (complianceResp.error) return NextResponse.json(safeError("compliance", complianceResp.error), { status: 500 });
  if (budgetsResp.error) return NextResponse.json(safeError("kpi_budgets", budgetsResp.error), { status: 500 });
  if (vehicleR.error) return NextResponse.json(safeError("ledgers.vehicle", vehicleR.error), { status: 500 });
  if (equipR.error) return NextResponse.json(safeError("ledgers.equipment", equipR.error), { status: 500 });
  if (repairR.error) return NextResponse.json(safeError("ledgers.repair", repairR.error), { status: 500 });
  if (reimbR.error) return NextResponse.json(safeError("ledgers.reimbursable", reimbR.error), { status: 500 });
  if (cardChR.error) return NextResponse.json(safeError("card_charges", cardChR.error), { status: 500 });
  if (vendorRollupR.error) return NextResponse.json(safeError("vendor_rollup", vendorRollupR.error), { status: 500 });
  const budgetsByLine = budgetsResp.data;
  const weekly = weeklyResp.data;
  // Precedence merge: API pending + report-only pending (no double
  // count - API rows are structurally excluded from the report-only
  // view; newest content_hash wins within the report via _latest).
  const pending = mergePending(pendingResp.data, reportPendingResp.data);
  const actuals = actualsResp.data;

  // Freshness pill extension.  cards_through was the newest txn_date on
  // rippling_spend (API); report-only pending now covers dates the API
  // has not seen.  cards_through_effective = max of the two, so the
  // pill reflects the picture the operator is actually looking at.
  // Owner ruling 2026-08-26 (Part D).  cards_through unchanged to keep
  // probes and other consumers stable.
  //
  // F-11: if the report-only slice was unavailable this request (view
  // timed out at 6s), the max_purchased_at we have is not
  // trustworthy - fall back to apiThrough alone AND surface the
  // unavailability so the pill can say so. A silent empty is
  // indistinguishable from a true empty and the view currently returns
  // zero rows either way.
  {
    const apiThrough = freshness.cards_through;
    const reportOnlyUnavailable = pending.report_only.unavailable === true;
    const reportThrough = reportOnlyUnavailable ? null : pending.report_only.max_purchased_at;
    freshness.cards_through_effective =
      apiThrough && reportThrough
        ? (apiThrough > reportThrough ? apiThrough : reportThrough)
        : (apiThrough || reportThrough || null);
    // F-11: two new freshness fields consumers can render.
    // - report_only_unavailable: true when the view timeout fired
    // - report_only_unavailable_reason: 'timeout' when so; null when ok
    // The pill / sources line should surface these when true; hero + list +
    // drill all read `pending.report_only.line_count === 0` regardless.
    freshness.report_only_unavailable = reportOnlyUnavailable;
    freshness.report_only_unavailable_reason = pending.report_only.unavailable_reason || null;
  }

  // Adaptive categories: union of every gl_line_code with actual > 0
  // in range OR budget > 0 in range. Actual side sourced from the
  // weekly view (already aggregated + filtered to non-excluded rows).
  const glLineCodesInWeekly = new Set();
  for (const r of weekly) if (r.gl_line_code) glLineCodesInWeekly.add(r.gl_line_code);
  const glLineCodesInBudget = new Set([...budgetsByLine.keys()].filter(gl => {
    const b = budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
    return b > 0;
  }));
  const allGl = new Set([...glLineCodesInWeekly, ...glLineCodesInBudget]);
  const orderedGl = [...allGl].sort(comparePriority);

  // Rollup helpers.
  // Bills-only spent by gl_line_code (source='billcom' + coded card
  // lines both roll here via gl_bucket, but weekly view groups by
  // gl_line_code independently of source). §3.4 bucket state uses
  // BILLS ONLY: the view path counts every non-excluded coded row.
  // For the categories rollup below we retain the historical
  // behaviour (spent = every non-excluded row with this gl_line_code)
  // so category variance stays comparable to prior payloads.
  function spentForGl(gl) {
    let s = 0;
    for (const r of weekly) if (r.gl_line_code === gl) s += Number(r.amount || 0);
    return Math.round(s * 100) / 100;
  }
  function billsOnlySpentForGl(gl) {
    let s = 0;
    for (const r of actuals) {
      if (r.gl_line_code !== gl) continue;
      if (r.source !== "billcom") continue;
      s += Number(r.amount || 0);
    }
    return Math.round(s * 100) / 100;
  }
  // PR-2 R4 Part A: coded-card spend by gl_line_code (rippling_spend
  // rows whose gl_line_code is set + within the effective fiscal-week
  // window). Shipping this per-bucket lets the client render the
  // "From cards" split as a real source-of-truth number instead of the
  // R2-vintage `max(0, hero - bills)` clamp that could mask a
  // three-figures-don't-agree mismatch (the Part A P0).
  function codedCardSpentForGl(gl) {
    let s = 0;
    for (const r of actuals) {
      if (r.gl_line_code !== gl) continue;
      if (r.source !== "rippling_spend") continue;
      s += Number(r.amount || 0);
    }
    return Math.round(s * 100) / 100;
  }

  const rangeSelection = inferRangeSelection(start, end);
  const periodNo = rangeSelection?.kind === "period" ? rangeSelection.value : null;
  const weeks = weekStartsInRange(start, end);
  const weeksInRange = weeks.length;
  const todayDate = new Date(today);
  const endDate = new Date(end);
  const startDate = new Date(start);
  const closedWeeksInRange = weeks.filter(w => {
    const wEnd = new Date(new Date(w).getTime() + 6 * 86400000);
    return wEnd < todayDate;
  }).length;
  // PR-2 R4 Part D: elapsed frac is **week-native**, not day-based.
  // Formula (owner ruling 2026-08-24):
  //   elapsed = (closed_weeks_in_range + fraction_of_running_week) / weeks_in_range
  // The running week's fraction is (days into that week including today) / 7,
  // e.g. Monday = 1/7, Sunday = 7/7. Gate is `>=` so a range ENDING today
  // still enters the fractional branch - a closed-yesterday range keeps
  // elapsed = 1.0, but a range whose final week is IN PROGRESS never lies
  // that it is 100% elapsed. Prior day-based formula:
  //   (days_from_start_to_today) / (days_from_start_to_end + 1)
  // returned 1.0 on every range ending today because todayDate <= endDate
  // failed the strict `>` gate. That fed pace = spent / (budget * 1.0)
  // across every card, understating pace on every in-progress range by
  // (weeks_in_range / weeks_elapsed).
  let elapsedFrac = 1.0;
  if (endDate >= todayDate && weeksInRange > 0) {
    // Running week's Monday - the fiscal week that contains today.
    // Fiscal week floor = FY_START + floor((today - FY_START) / 7) * 7,
    // matching the view's week_start floor. Simpler: today's Monday
    // via ISO weekday math (day-of-week Mon=1..Sun=7 in UTC).
    const dow = todayDate.getUTCDay(); // Sun=0..Sat=6
    const daysToMon = (dow + 6) % 7;   // Mon=0, Sun=6
    // Fraction of running week already lived. Mon => 1/7, Sun => 7/7.
    const runFrac = Math.min(1, (daysToMon + 1) / 7);
    elapsedFrac = Math.min(1.0, (closedWeeksInRange + runFrac) / weeksInRange);
  }

  // PASS_THROUGH single-account short-circuit (Kevin ruling 2026-08-20):
  //   For a single pass_through account (CIN - OH, STL - FL, STL - MO)
  //   the operator is NOT held to a KPI on the reimbursable bucket. In
  //   the purchasing route this means:
  //     - state = 'passthru' (a distinct value; not 'under')
  //     - no variance
  //     - no pace_pct
  //     - the stewardship budget from kpi_budgets still returns as
  //       CONTEXT (a number to compare against for the report reader)
  //       but is NOT rendered as a target with over/under semantics
  //   The bucket-level `spent` still reports in full, per bucket, per
  //   week - passing the raw spend up to the caller is the point of
  //   the route; only the verdict layer is suppressed.
  //
  //   Aggregates (ALL / EAST / WEST) are NOT short-circuited - a mixed
  //   aggregate rolls up at-risk and pass_through spend together and
  //   the caller must decide how to present. This route does not gross-
  //   up or net-out - that is a rendering-layer question Kevin ruled
  //   is UNKNOWN in INV-P9 Q5.
  const isPassThroughAccount = !isAggregate && PASS_THROUGH_ACCOUNTS.has(account);

  const categories = orderedGl.map(gl => {
    const budget = budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
    const spent = spentForGl(gl);
    // Pass-through: suppress variance + pace_pct at the category level.
    // Budget and spent still flow (context values); variance/pace are
    // null because the operator is not measured on them.
    if (isPassThroughAccount) {
      return {
        gl_line_code: gl,
        bucket:       glBucketFor(gl),
        budget:       budget,
        spent:        spent,
        variance:     null,
        pace_pct:     null,
        final:        false,
      };
    }
    const variance = Math.round((spent - budget) * 100) / 100;
    // pace_pct: for in-progress ranges, spend rate vs allowed rate.
    // Closed: pace_pct = spent/budget (final variance implied).
    let pace_pct = null;
    let final = false;
    if (endDate < todayDate) {
      final = true;
      pace_pct = budget > 0 ? Math.round((spent / budget) * 100 * 100) / 100 : null;
    } else if (elapsedFrac > 0 && budget > 0) {
      pace_pct = Math.round(((spent / (budget * elapsedFrac))) * 100 * 100) / 100;
    }
    return {
      gl_line_code: gl,
      bucket:       glBucketFor(gl),
      budget:       budget,
      spent:        spent,
      variance:     variance,
      pace_pct:     pace_pct,
      final:        final,
    };
  });

  // Buckets rollup (§6.3 + §3.4). food/packaging/vehicle -
  // budget + spent (bills only) + variance + state. Bucket state
  // uses BILLS ONLY. Line_codes lists the gl_line_codes that
  // contributed to this bucket in this (account, range).
  const buckets = BUCKETS.map(({ key, gl_prefix, label }) => {
    let budget = 0;
    let spent = 0;
    let cardsCoded = 0;
    const line_codes = [];
    for (const gl of orderedGl) {
      if (bucketForGl(gl) !== key) continue;
      line_codes.push(gl);
      budget += budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
      spent  += billsOnlySpentForGl(gl);
      cardsCoded += codedCardSpentForGl(gl);
    }
    const budgetR = Math.round(budget * 100) / 100;
    const spentR  = Math.round(spent  * 100) / 100;
    const cardsCodedR = Math.round(cardsCoded * 100) / 100;
    // Pass-through short-circuit: null variance + null pace, state
    // resolves to 'passthru'. Budget and spent still return as
    // context.
    if (isPassThroughAccount) {
      return {
        bucket:       key,
        label,
        gl_prefix,
        budget:       budgetR,
        spent:        spentR,
        cards_coded:  cardsCodedR,   // PR-2 R4 Part A
        variance:     null,
        pace_pct:     null,
        state:        stateOf({ isPassThrough: true }),
        line_codes,
      };
    }
    const varianceR = Math.round((spentR - budgetR) * 100) / 100;
    let pace_pct = null;
    if (endDate < todayDate) {
      pace_pct = budgetR > 0 ? Math.round((spentR / budgetR) * 100 * 100) / 100 : null;
    } else if (elapsedFrac > 0 && budgetR > 0) {
      pace_pct = Math.round(((spentR / (budgetR * elapsedFrac))) * 100 * 100) / 100;
    }
    const state = stateOf({
      spent:       spentR,
      budget:      budgetR,
      elapsedFrac,
      hasBills:    spentR > 0,
    });
    return {
      bucket:       key,
      label,
      gl_prefix,
      budget:       budgetR,
      spent:        spentR,       // bills-only (§3.4 - bucket STATE uses bills only)
      cards_coded:  cardsCodedR,  // PR-2 R4 Part A - coded card spend, per bucket
      variance:     varianceR,
      pace_pct,
      state,
      line_codes,
    };
  });

  // Periods series (§6.4). FYTD P1..currentPeriodNo. Spent uses the
  // period card population (bills + card), matching §4.1's hero. This
  // series is not range-scoped: the trend card is always full-year.
  const currentP = currentPeriodNo(today) || 1;
  const periods = [];
  // PR 3 (mgmt-fee board): fyWeekly is also the source for the
  // pass_through mgmt_fee.periods_trend + goal_fytd_spent. Lifted out
  // of the periods{} block so the mgmt_fee computation below can reuse
  // the same rows without a second FYTD fetch.
  let fyWeekly;
  {
    // Fetch weekly view over the whole FYTD once (members-filtered).
    // Reuse `weekly` when the request range IS FYTD - saves a
    // duplicate round-trip on the most common query.
    if (start === FY_START_ISO && end === today) {
      fyWeekly = weekly;
    } else {
      const fyWeeklyResp = await paginateWeekly(supa, { members, start: FY_START_ISO, end: today });
      if (fyWeeklyResp.error) {
        return NextResponse.json(safeError("periods_weekly", fyWeeklyResp.error), { status: 500 });
      }
      fyWeekly = fyWeeklyResp.data;
    }
    // Bucket weekly rows by period.
    const spentByPeriod = new Map();
    // PR-2 R4 Part B: per-bucket per-period spent, sourced from the
    // weekly view's gl_bucket + week_start. Tier C bars need per-bucket
    // per-period figures so the target line reflects THAT period's
    // budget, not a flat range average. Without this, TBR - FL Food
    // P1 ($4,264 budget) vs P3 ($164,897 budget) rendered identical
    // flat targets - calling P1 catastrophically under and P3
    // catastrophically over when both may be on plan.
    const spentByPeriodByBucket = new Map(); // periodNo -> { food, packaging, vehicle }
    for (const r of fyWeekly) {
      const p = periodOf(r.week_start);
      if (p == null) continue;
      spentByPeriod.set(p, (spentByPeriod.get(p) || 0) + Number(r.amount || 0));
      const bk = bucketForGl(r.gl_line_code);
      if (!bk) continue;
      if (!spentByPeriodByBucket.has(p)) {
        spentByPeriodByBucket.set(p, { food: 0, packaging: 0, vehicle: 0 });
      }
      spentByPeriodByBucket.get(p)[bk] += Number(r.amount || 0);
    }
    for (let p = 1; p <= currentP; p += 1) {
      const pStart = periodStartISO(p);
      const pEnd = periodEndISO(p);
      // Budget for period: sum kpi_budgets over members for this
      // period_no (envelope-excluded).
      let budgetP = 0;
      const bucketBudgetP = { food: 0, packaging: 0, vehicle: 0 };
      for (const gl of budgetsByLine.keys()) {
        const glB = budgetForPeriod({ byLine: budgetsByLine, glLineCode: gl, members, periodNo: p });
        budgetP += glB;
        const bk = bucketForGl(gl);
        if (bk) bucketBudgetP[bk] += glB;
      }
      const spentP = Math.round((spentByPeriod.get(p) || 0) * 100) / 100;
      const bucketSpentP = spentByPeriodByBucket.get(p) || { food: 0, packaging: 0, vehicle: 0 };
      // Was this period closed on the date the request ran?
      const closed = new Date(pEnd) < todayDate;
      periods.push({
        period_no: p,
        start:     pStart,
        end:       pEnd,
        spent:     spentP,
        budget:    Math.round(budgetP * 100) / 100,
        closed,
        // PR-2 R4 Part B: per-bucket per-period rollup. Client tier C
        // strip reads these directly - each bar's target line == THAT
        // period's bucket budget, from kpi_budgets, envelope-excluded.
        by_bucket: {
          food:      { spent: Math.round(bucketSpentP.food      * 100) / 100, budget: Math.round(bucketBudgetP.food      * 100) / 100 },
          packaging: { spent: Math.round(bucketSpentP.packaging * 100) / 100, budget: Math.round(bucketBudgetP.packaging * 100) / 100 },
          vehicle:   { spent: Math.round(bucketSpentP.vehicle   * 100) / 100, budget: Math.round(bucketBudgetP.vehicle   * 100) / 100 },
        },
      });
    }
  }

  // Totals by bucket. Weekly view is bills + coded card (gl_bucket
  // reflects the coded gl). Card + rippling filtering still needs the
  // raw actuals to distinguish source, so both paths coexist.
  function sumSpentByBucket(bucket) {
    let s = 0;
    for (const r of weekly) if (r.gl_bucket === bucket) s += Number(r.amount || 0);
    return Math.round(s * 100) / 100;
  }
  function sumBudgetByBucket(bucket) {
    let s = 0;
    for (const gl of budgetsByLine.keys()) {
      if (glBucketFor(gl) !== bucket) continue;
      s += budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
    }
    return Math.round(s * 100) / 100;
  }
  const pl_cogs_spent  = sumSpentByBucket("pl_cogs");
  const pl_cogs_budget = sumBudgetByBucket("pl_cogs");
  const reimb_spent    = sumSpentByBucket("reimbursable");
  const sga_spent      = sumSpentByBucket("sga");
  // Card totals from rippling_spend rows in range. Sourced from
  // paginateActuals (source predicate lives on raw rows, not the view).
  let card_spent = 0;
  let card_unattributed = 0;
  let card_uncoded = 0;
  for (const r of actuals) {
    if (r.source !== "rippling_spend") continue;
    card_spent += Number(r.amount || 0);
    if (!r.account_key) card_unattributed++;
    if (!r.gl_line_code) card_uncoded++;
  }

  const totals = {
    pl_cogs: {
      budget:   pl_cogs_budget,
      spent:    pl_cogs_spent,
      variance: Math.round((pl_cogs_spent - pl_cogs_budget) * 100) / 100,
    },
    reimbursable: {
      spent:              reimb_spent,
      billed_to_client:   reimb_spent,   // reimbursable is billed 1:1 to client
    },
    sga: {
      spent: sga_spent,
    },
    card: {
      spent:         Math.round(card_spent * 100) / 100,
      unattributed:  card_unattributed,
      uncoded:       card_uncoded,
    },
  };

  // Provisional flag: range_end + 16 days > today.
  const provisionalCutoff = new Date(endDate.getTime() + PROVISIONAL_WINDOW_DAYS * 86400000);
  const provisional = provisionalCutoff > todayDate;

  // Sentinel: value the route returns for the frozen probe.  Gated on
  // ?debug=1 (owner ruling 2026-08-28) - zero board consumers read
  // body.sentinel; only acceptance probes _pr2r3_ + _pr2r5_ do and
  // they pass debug=1.  Saves ~50ms per board load.
  const debugRequested = new URL(request.url).searchParams.get("debug") === "1";
  const sentinelResp = debugRequested ? await computeSentinel(supa) : { data: null };

  // INV-P23 (2026-08-28): `cost_model`, `billed_back_reachable`,
  // `filters`, `is_aggregate`, `members`, `ledger_reconciliation`
  // were shipped in the payload for months with zero client consumers.
  // Client computes cost_model itself (accountModels.costModelFor);
  // isAggregate + filters come from URL state; members is server-
  // internal; billed_back_reachable was documentation-as-payload from
  // INV-P9 Q5; ledger_reconciliation duplicated the live client Check 9
  // in LedgerCard.js:56 + CardPurchases.js:39 - see PR body for why the
  // server duplicate was the risk, not the deletion.

  // ─── PR-2 R6 Part B - capped aggregations for populated cards ──
  //
  // Ledgers (vehicle / equipment / repair / reimbursable) each cap at 25.
  // card_charges caps at 50. Each carries total_count + total_amount for
  // honest "showing 25 of 188" copy.
  //
  // R15 E - vendor rollup + priorRange (mirrored prior-window compare)
  // removed with VendorBreakdown; no other consumer of priorRange.

  // Ledger loaders now live in the merged Promise.all further up
  // (INV-P23 arc). vehicleR/equipR/repairR/reimbR/cardChR/vendorRollupR
  // are already resolved and error-checked; this block used to await
  // them serially after the rollups. R15 - Vehicle joins the matched-
  // ledgers row (was a bucket card chart); R15 F - vendor_rollup for
  // the drill table's "By vendor" row mode.

  // R15 B - Rule 2 flag: vendor on a known vehicle-service list appearing
  // in R&M (5002.1) is a misclassification signal.  Small curated list;
  // Kevin's ruling 2026-08-27 after measuring 30 candidate patterns
  // against the four rule variants - Rule 2 was the only one that flagged
  // exactly the target Meineke row with zero false positives on 2026-08-27
  // data.  List maintained here in the route so changes are one code
  // change (probe measurements + ledgers together).
  const RM_VEHICLE_VENDOR_PATTERNS = [
    "MEINEKE", "FIRESTONE", "MIDAS", "GOODYEAR", "JIFFY LUBE",
    "ENTERPRISE RENT", "HERTZ", "AVIS", "DISCOUNT TIRE",
    "AUTOZONE", "ADVANCE AUTO", "O'REILLY", "PEP BOYS", "VALVOLINE",
    "BIG O TIRES", "LES SCHWAB", "AAMCO", "MAACO", "CHRISTIAN BROTHERS",
    "MAVIS TIRE", "GRUBBS", "BROWN AUTOMOTIVE", "PENSKE", "RYDER",
    "U-HAUL", "UHAUL", "NAPA AUTO", "CARQUEST",
  ];
  for (const row of (repairR.data?.rows || [])) {
    const v = String(row.vendor || "").toUpperCase();
    const match = RM_VEHICLE_VENDOR_PATTERNS.find(pat => v.startsWith(pat));
    if (match) {
      row.flag = { kind: "vehicle-in-rm", reason: "vehicle service in 5002.1" };
    }
  }

  // Check 9 (ledger sum vs bucket hero) is asserted CLIENT-side in
  // LedgerCard.js:56-73 + CardPurchases.js:39-59, reading local props.
  // A server-side duplicate lived here from R6 through 2026-08-28,
  // shipped in the payload as `ledger_reconciliation` with zero client
  // consumers - the client never read the server's answer. Two
  // implementations of the same assertion is the defect labor's
  // three-surface invariant names (route select / view / RPC): either
  // half can drift without the other firing. INV-P23 removed the
  // server duplicate; the client assertion is the live one.

  // ─── PR 3 - management-fee board data (pass_through only) ───────────
  //
  // For CIN - OH, STL - FL, STL - MO the operator is NOT held to a
  // KPI on COGS - food, packaging, supplies are billed back to the
  // client. The mgmt-fee board (spec §2, §6.7) surfaces:
  //   goal_fytd_spent  - FYTD reimbursable spend across the 13xx
  //                      family, independent of the requested range.
  //                      The hero on the mgmt-fee card reads "$X of
  //                      $goal annual goal" - annual metric, not
  //                      range-scoped.
  //   periods_trend    - per-period reimbursable spend (P1..currentP),
  //                      feeds the 8-period bar strip.
  //   fun_money        - STL - FL only. Owner ruling 2026-08-21 (spec
  //                      §2.3): 3200.2 Resale Food ($25K annual budget)
  //                      is the one genuinely at-risk figure at this
  //                      account. It gets a real verdict, computed
  //                      independent of the pass_through short-circuit
  //                      that null-variances the rest.
  //
  // Goal figures live in src/lib/accountModels.js MANAGEMENT_FEE_GOALS
  // (owner-supplied 2026-08-24 - annual client commitments, not
  // period-scoped operating budgets, so they belong beside the cost
  // model, not in kpi_budgets). The client reads that constant; the
  // route does NOT ship goal amounts (they are static config).
  let mgmt_fee = null;
  if (isPassThroughAccount) {
    let goalFytdSpent = 0;
    const trendByPeriod = new Map();
    for (const r of fyWeekly) {
      if (r.gl_bucket !== "reimbursable") continue;
      goalFytdSpent += Number(r.amount || 0);
      const p = periodOf(r.week_start);
      if (p == null) continue;
      trendByPeriod.set(p, (trendByPeriod.get(p) || 0) + Number(r.amount || 0));
    }
    const periods_trend = [];
    for (let p = 1; p <= currentP; p += 1) {
      periods_trend.push({
        period_no: p,
        start:     periodStartISO(p),
        end:       periodEndISO(p),
        spent:     Math.round((trendByPeriod.get(p) || 0) * 100) / 100,
      });
    }
    // R14 - fun money for all three pass-through accounts (was STL-FL
    // only per Kevin ruling 2026-08-21).  The R14 combined card puts
    // fun money on the same statement as reimbursable when spend > 0,
    // so the hero label can adapt.  All three accounts read $0 today
    // at 3200.2; the synthetic-value probe covers the label-swap
    // behaviour without waiting for real spend to appear.
    const fmSpent  = spentForGl("3200.2");
    const fmBudget = budgetForRange({ byLine: budgetsByLine, glLineCode: "3200.2", members, start, end });
    const fun_money = {
      gl_line_code: "3200.2",
      label:        "Fun Money",
      sub:          "Resale food · 3200.2",
      budget:       Math.round(fmBudget * 100) / 100,
      spent:        Math.round(fmSpent  * 100) / 100,
      variance:     Math.round((fmSpent - fmBudget) * 100) / 100,
    };
    // R14 - reimbursable category breakdown for the RANGE (not FYTD).
    // Each row carries name + gl_line_code + spent.  Names come from
    // billcom_ref_accounts (chart of accounts snapshot, 1,072 rows).
    // A 13xx code missing from ref_accounts (unlikely) will render as
    // the code alone - resolver rule, not a route decision.
    //
    // Fetch only the 13xx codes that actually appear in this range's
    // categories[].  For an ALL FYTD read this is at most ~20 codes,
    // one small in-list query.
    const reimb_categories_raw = [];
    for (const gl of orderedGl) {
      if (!String(gl).startsWith("13")) continue;
      const spent = spentForGl(gl);
      if (spent <= 0.005) continue;   // don't ship zero rows
      reimb_categories_raw.push({ gl_line_code: gl, spent: Math.round(spent * 100) / 100 });
    }
    const glCodesToName = reimb_categories_raw.map(r => r.gl_line_code);
    let namesByCode = new Map();
    if (glCodesToName.length > 0) {
      const nq = await supa.from("billcom_ref_accounts")
        .select("account_number, name")
        .in("account_number", glCodesToName);
      if (nq.error) return NextResponse.json(safeError("billcom_ref_accounts", nq.error), { status: 500 });
      for (const r of nq.data || []) namesByCode.set(String(r.account_number), r.name || null);
    }
    const reimb_categories = reimb_categories_raw.map(r => ({
      gl_line_code: r.gl_line_code,
      name:         namesByCode.get(r.gl_line_code) || null,
      spent:        r.spent,
    }));
    // R14 - crossed-period: the first period in periods_trend where
    // cumulative reimbursable spend exceeded the annual goal.  Null
    // when the account has not crossed yet (STL - FL currently).
    // Goals live in accountModels.js client-side; the route ships the
    // trend + FYTD sum so the client resolver can compute crossing.
    // We compute crossing here too so the sentence has one source.
    const goalRow = MANAGEMENT_FEE_GOALS[account] || null;
    let crossed_period_no = null;
    if (goalRow && goalRow.annual > 0) {
      let cum = 0;
      for (const t of periods_trend) {
        cum += Number(t.spent || 0);
        if (cum >= goalRow.annual) { crossed_period_no = t.period_no; break; }
      }
    }
    mgmt_fee = {
      goal_fytd_spent: Math.round(goalFytdSpent * 100) / 100,
      periods_trend,
      fun_money,
      // R14 additions - client_label + tax_caveat_state read off
      // accountModels.js so a single source of truth drives the
      // hero label + tax caveat.
      client_label:      goalRow?.clientLabel || account,
      tax_caveat_state:  goalRow?.taxCaveatState || null,
      reimb_categories,
      crossed_period_no,
    };
  }

  // ─── PR 4 - source-split weekly aggregate for the drill-down table ──
  //
  // Only computed when `?table=1` is passed. Lazy path: the table's
  // SHOW filter fires this on the FIRST switch to Bills or Cards.
  // Payload is small - N weeks × 5 columns × 2 sources = ~340 rows
  // max at ALL FYTD, most zero and dropped. Ships as a flat array to
  // stay consistent with the shape of `weekly`.
  //
  // Column mapping (matches PurchasingTable's columns):
  //   food, packaging, vehicle   - by gl_bucket on the actual
  //   equipment                  - gl_line_code = '5002.5'
  //   repair                     - gl_line_code = '5002.1'
  // Other rows (SGA lines other than 5002.5/5002.1, reimbursable 13xx,
  // uncoded card charges) do NOT contribute to the table columns and
  // are dropped from this aggregate - they render elsewhere on the
  // board.
  let weekly_by_source = null;
  if (includeTable) {
    function weekStartFromTxnDate(txnDate) {
      const t = new Date(txnDate + "T00:00:00Z").getTime();
      const fs = new Date(FY_START_ISO + "T00:00:00Z").getTime();
      if (!Number.isFinite(t) || t < fs) return null;
      const wks = Math.floor((t - fs) / (7 * 86400000));
      return new Date(fs + wks * 7 * 86400000).toISOString().slice(0, 10);
    }
    function columnFor(r) {
      if (r.gl_line_code === "5002.5") return "equipment";
      if (r.gl_line_code === "5002.1") return "repair";
      // Food / Packaging / Vehicle keyed by gl_line_code prefix
      // (bucketForGl above). `r.gl_bucket` on purchasing_actuals is
      // the broader family (pl_cogs / sga / reimbursable / card),
      // NOT the per-column bucket the table wants - do not read it.
      return bucketForGl(r.gl_line_code);
    }
    // Map: week_start -> column -> source -> cents (avoid float drift)
    const acc = new Map();
    for (const r of actuals) {
      const col = columnFor(r);
      if (!col) continue;
      const src = r.source === "rippling_spend" ? "rippling_spend" : "billcom";
      const ws = weekStartFromTxnDate(r.txn_date);
      if (!ws) continue;
      if (!acc.has(ws)) acc.set(ws, {});
      const wk = acc.get(ws);
      if (!wk[col]) wk[col] = { billcom: 0, rippling_spend: 0 };
      wk[col][src] += Math.round(Number(r.amount || 0) * 100);
    }
    const rows = [];
    for (const [ws, cols] of acc) {
      for (const [col, sources] of Object.entries(cols)) {
        for (const [src, cents] of Object.entries(sources)) {
          if (cents === 0) continue;
          rows.push({
            week_start: ws,
            column:     col,
            source:     src,
            amount:     Math.round(cents) / 100,
          });
        }
      }
    }
    weekly_by_source = rows;
  }

  // PR 2 R8 - align with labor: `is_future_range` is true when the
  // requested START is strictly after today - the range has not begun.
  // Broader rule (Kevin ruling 2026-08-24): "no spend means no verdict"
  // covers a future period, an off-season site, and an account that
  // genuinely bought nothing. Client uses this flag to suppress the
  // projected-close row + the % elapsed header on the period card, both
  // of which currently render a "would close $X under budget" arrow on
  // a range that has not begun. See labor's route.js:317 for the
  // parallel derivation.
  const is_future_range = startDate > todayDate;

  const payload = {
    ok: true,
    range: { start, end },
    is_future_range,
    // 2026-08-28 preview mode.  landing_account = caller's default
    // landing (single-account users land on their site, corporate
    // lands on ALL); preview_account non-null when preview intersected
    // real access.  Client uses both to decide the rail + banner.
    landing_account,
    preview_account,
    fiscal: {
      fiscal_year:           fyForRange,
      period_no:             periodNo,
      elapsed_frac:          Math.round(elapsedFrac * 10000) / 10000,
      weeks_in_range:        weeksInRange,
      closed_weeks_in_range: closedWeeksInRange,
    },
    budget: {
      by_gl_line_code: orderedGl.map(gl => ({
        gl_line_code: gl,
        amount: budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end }),
      })),
    },
    weekly,
    pending,
    buckets,
    periods,
    // R13 P0-1 - closed-card comparison block payload.  null on any
    // range that isn't a closed single fiscal period, so the client
    // shape is `data.period_history?.prior` etc.
    period_history: priorHistoryResp.data,
    categories,
    totals,
    provisional,
    freshness,
    accounts_directory: dirResp.data,   // PR-2 R2 Fix 7 - rail meta on 11/11
    sentinel: sentinelResp.error ? null : sentinelResp.data,
    // PR-2 R6 Part B - five capped aggregations (spec §6.3-6.5).
    // Each is small (25/50/25 rows). Payload size delta reported in
    // the return; the 4.5MB drill array remains off-by-default.
    ledgers: {
      // R15 - vehicle joins as a fourth ledger, matched shape.
      vehicle:      vehicleR.data,
      equipment:    equipR.data,
      repair:       repairR.data,
      reimbursable: reimbR.data,
    },
    card_charges: cardChR.data,
    // R15 F - per-vendor rollup for the drill table's By vendor row mode.
    vendor_rollup: vendorRollupR.data,
    // PR 3 - management-fee board data (pass_through accounts only).
    // null at at_risk / aggregate. See mgmt_fee construction above.
    mgmt_fee,
    // PR 4 - source-split weekly aggregate for the drill-down table's
    // SHOW filter. null unless ?table=1 (lazy fetch on first Bills /
    // Cards switch).
    weekly_by_source,
    // PR 6 - compliance card. Report-side uncoded (sentinel category)
    // rows restricted to attributable work locations, grouped by site
    // and by person. Corp/Remote uncoded surfaces as a footer count at
    // aggregate scopes. Empty (`total_count = 0`) means every uncoded
    // charge at attributable sites has already been coded; the card
    // hides itself in that case (E-clause rule: empty card does not
    // appear).
    compliance: complianceResp.data,
  };
  if (includeLines) {
    // PR-2 R11 item 4 - drill-table vendor column was rendering `—` on
    // 100% of rows because paginateActuals didn't SELECT
    // vendor_or_merchant, so PurchasingTable.js:166 read an undefined
    // field. Now that the field IS selected, resolve billcom vendor
    // ids to names before shipping so PurchasingTable renders a name
    // instead of an opaque id. Same pattern as loadLedgerRows lines
    // 711-745 in this file - one shared resolve mechanism, no second
    // path.
    const billcomVendorIds = [
      ...new Set(actuals.filter(r => r.source === "billcom" && r.vendor_or_merchant).map(r => r.vendor_or_merchant)),
    ];
    const vendorNameMap = new Map();
    if (billcomVendorIds.length > 0) {
      for (const idChunk of chunk(billcomVendorIds, IN_CHUNK)) {
        const vr = await supa.from("billcom_ref_vendors").select("id, name").in("id", idChunk);
        if (vr.error) return NextResponse.json(safeError("billcom_ref_vendors", vr.error), { status: 500 });
        for (const v of vr.data || []) vendorNameMap.set(v.id, v.name || null);
      }
    }
    // Attach `vendor` per row: resolved name for billcom, raw merchant
    // string for rippling, null when unresolvable. PurchasingTable
    // decides the display copy (name / "unresolved vendor" / "—") from
    // r.vendor + r.source. Ship only the resolved field: the raw
    // vendor_or_merchant id is opaque to the frontend and dropping it
    // saves ~30-40 bytes/row on the drill=lines wire.
    payload.actuals = actuals.map(r => {
      let vendor = null;
      if (r.source === "billcom") {
        if (r.vendor_or_merchant && vendorNameMap.has(r.vendor_or_merchant)) {
          vendor = vendorNameMap.get(r.vendor_or_merchant);
        }
      } else {
        vendor = r.vendor_or_merchant || null;
      }
      const { vendor_or_merchant: _drop, ...rest } = r;
      return { ...rest, vendor };
    });
  }

  return NextResponse.json(payload);
}
