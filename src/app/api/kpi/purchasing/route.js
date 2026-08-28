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

const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// V6_ENVELOPE_ACCOUNTS is retained as an alias for readability at the
// call sites that still spell it that way. It now points at the
// shared PURCHASING_ENVELOPE_EXCLUSIONS - an empty set - so the
// exclusion is a named empty concept, not a per-route silent removal.
const V6_ENVELOPE_ACCOUNTS = PURCHASING_ENVELOPE_EXCLUSIONS;
const V6_PAGE_DEFAULT = 1000;
// PostgREST .in() with 100+ 36-char UUIDs or 51+ char
// rippling_spend:<uuid> ids overflows the URL and throws
// `TypeError: fetch failed` before any HTTP status. Chunk at 100.
// team_keys are short enough that this could go higher for members,
// but the same constant applies consistently to every .in() so a
// single ceiling is remembered.
const IN_CHUNK = 100;

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

// Chunk a values array to IN_CHUNK-size slices. Callers loop and
// merge results (concat for rows, add for counts).
function chunk(values, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
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

// Paginate purchasing_actuals for a members set and a date range.
// Filter drops excluded rows and null account_key rows so the caller
// never has to remember to exclude them. Unattributed / uncoded
// analysis reads a separate query (below) that keeps the null rows.
//
// Population: bills + coded card lines. Pending sum + null-attribution
// analysis go via separate paths that keep the rows this drops.
async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("purchasing_actuals")
        .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, gl_bucket, txn_date, posting_date, amount, paid, approx_date, derived_at, vendor_or_merchant")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("account_key", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) out.push(r);
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: out };
}

// Paginate v_purchasing_by_site_week for the weekly series. Same
// members + range filter as paginateActuals, but the view has already
// aggregated per (account_key, week_start, gl_line_code, gl_bucket),
// so payload size drops by ~2 orders of magnitude for ALL FYTD.
//
// View's week_start floor is DATE '2025-12-29' + floor((txn_date -
// FY_START)/7)*7. INV-P1 Q4 confirmed byte-identical to
// weekStartsInRange('2025-12-29', today) - 34 weeks on ALL FYTD.
//
// Population: bills + coded card lines (view excludes excluded=true
// and null account_key). Uncoded card lines don't have gl_line_code
// so they group under NULL gl_line_code - callers that only want
// bill buckets should filter gl_bucket='pl_cogs'.
async function paginateWeekly(supa, { members, start, end }) {
  const PS = V6_PAGE_DEFAULT;
  const out = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("v_purchasing_by_site_week")
        .select("account_key, week_start, week_end, gl_line_code, gl_bucket, amount, line_count, bill_count, paid_amount")
        .in("account_key", memberChunk)
        .gte("week_start", start)
        .lte("week_start", end)
        .order("account_key", { ascending: true })
        .order("week_start", { ascending: true })
        .order("gl_line_code", { ascending: true, nullsFirst: false })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) out.push(r);
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: out };
}

// R13 P0-1: prior-period + last-8-periods spend history for the
// closed-card comparison block.  Rolled up across the members set so
// aggregate scopes (ALL / EAST / WEST) return the portfolio shape
// rather than one site's (INV-P21 axis).  Reads the SQL-aggregated
// weekly view - a single call for the P(N-7)..P(N-0) window rolled
// client-side to periods.  Probe 2026-08-26 measured wall-time at
// 74ms (single-account) to 250ms (ALL) for the 8-period window; the
// call runs in parallel with the other loaders so it doesn't add
// serial cost.
async function loadPriorPeriodHistory(supa, { members, periodNo }) {
  if (!periodNo || periodNo < 2) return { data: null };   // no prior period exists for P1
  const firstPeriod = Math.max(1, periodNo - 7);          // last 8 periods ending at current
  const startISO = periodStartISO(firstPeriod);
  const endISO   = periodEndISO(periodNo);
  const IN_CHUNK_LOCAL = 100;
  const PS = 1000;
  const byWeek = new Map();
  for (let i = 0; i < members.length; i += IN_CHUNK_LOCAL) {
    const chunk = members.slice(i, i + IN_CHUNK_LOCAL);
    let from = 0;
    while (true) {
      // R13 P0-1: sparkline must compare like-to-like with the hero,
      // which is the KPI line only (food + packaging + vehicle).  Pull
      // gl_line_code and filter client-side to lines beginning with
      // 3200 / 3400 / 3500 - same predicate as kpiBudget in
      // src/app/kpi/purchasing/lib/board.js.  Without this filter the
      // prior-period value included reimbursable + SG&A and read as a
      // different base than the hero it was compared against.
      const q = await supa.from("v_purchasing_by_site_week")
        .select("week_start, amount, gl_line_code")
        .in("account_key", chunk)
        .gte("week_start", startISO)
        .lte("week_start", endISO)
        .order("week_start", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.gl_line_code || "");
        if (!(gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500"))) continue;
        const wk = r.week_start;
        byWeek.set(wk, (byWeek.get(wk) || 0) + Number(r.amount || 0));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  const byPeriod = new Map();
  for (const [wk, amt] of byWeek) {
    const p = periodOf(wk);
    if (p >= firstPeriod && p <= periodNo) {
      byPeriod.set(p, (byPeriod.get(p) || 0) + amt);
    }
  }
  const sparkline = [];
  for (let p = firstPeriod; p <= periodNo; p++) {
    sparkline.push({
      period_no: p,
      spent: Math.round((byPeriod.get(p) || 0) * 100) / 100,
    });
  }
  const priorSpent = Math.round((byPeriod.get(periodNo - 1) || 0) * 100) / 100;
  return {
    data: {
      prior: {
        period_no: periodNo - 1,
        spent: priorSpent,
        label: `Period ${periodNo - 1}`,
      },
      sparkline,   // P(N-7) .. P(N), inclusive
    },
  };
}

// Pending: SUM(amount) + line count of rippling_spend rows in range
// whose gl_line_code IS NULL. Members-filtered so ALL/EAST/WEST return
// the aggregate. excluded=false always. §3.5: a dollar sum, never
// split by bucket. Card spend carries no GL line - that IS why it
// sits outside the buckets.
//
// Population differs from paginateActuals (which drops gl_line_code
// only if account_key is null too): we specifically WANT the
// gl_line_code=NULL rows.
async function loadPending(supa, { members, start, end }) {
  let amount = 0;
  let line_count = 0;
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("purchasing_actuals")
        .select("amount, source_line_id")
        .eq("source", "rippling_spend")
        .eq("excluded", false)
        .is("gl_line_code", null)
        .in("account_key", memberChunk)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("source_line_id", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        amount += Number(r.amount || 0);
        line_count += 1;
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return {
    data: {
      amount:     Math.round(amount * 100) / 100,
      line_count,
    },
  };
}

async function fetchMembers(supa, account) {
  if (account === "ALL") {
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
    return q.error ? { error: q.error } : { members: (q.data || []).map(r => r.team_key) };
  }
  if (account === "EAST" || account === "WEST") {
    const regionValue = account === "EAST" ? "East" : "West";
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").eq("region", regionValue).order("team_key");
    return q.error ? { error: q.error } : { members: (q.data || []).map(r => r.team_key) };
  }
  return { members: [account] };
}

// Load kpi_budgets purchasing lines for a set of accounts + FY. Returns
// map: gl_line_code -> Map(account_key -> Map(period_no -> amount)).
// Purchasing lines are all COGS + reimbursable + SG&A lines except
// 3100.1 (labor - handled by /api/kpi/labor).
//
// Paginates the .in() over accounts AND the row window. FY2026 ALL
// membership is ~24 lines x 11 accounts x 13 periods = ~3,400 rows,
// well over PostgREST's silent 1000-row cap. Mirrors the pagination
// pattern the other three .select() calls in this file already use
// (paginateActuals, paginateWeekly, loadPending): .order() BEFORE
// .range(), chunk members through IN_CHUNK, walk pages until a short
// page returns.
async function loadPurchasingBudgets(supa, accounts, fiscalYear) {
  const byLine = new Map();
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(accounts, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa.from("kpi_budgets")
        .select("account_key, line_code, period_no, amount")
        .eq("fiscal_year", fiscalYear)
        .in("account_key", memberChunk)
        .neq("line_code", "3100.1")     // labor lives in labor route
        .neq("line_code", "3100.2")     // salaried; not in scope for purchasing v1
        .order("account_key", { ascending: true })
        .order("line_code", { ascending: true })
        .order("period_no", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.line_code);
        const acct = String(r.account_key);
        if (!byLine.has(gl)) byLine.set(gl, new Map());
        if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
        byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: byLine };
}

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

// Compute the sentinel: TBR - FL, P8, gl 3200.1.
async function computeSentinel(supa) {
  const p8start = periodStartISO(8);
  const p8end = periodEndISO(8);
  const q = await supa.from("purchasing_actuals")
    .select("amount")
    .eq("source", "billcom")
    .eq("excluded", false)
    .eq("account_key", "TBR - FL")
    .eq("gl_line_code", "3200.1")
    .gte("txn_date", p8start)
    .lte("txn_date", p8end);
  if (q.error) return { error: q.error };
  const total = (q.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    data: {
      account:      "TBR - FL",
      period_no:    8,
      range:        { start: p8start, end: p8end },
      gl_line_code: "3200.1",
      amount:       Math.round(total * 100) / 100,
      line_count:   (q.data || []).length,
    },
  };
}

// ─── Accounts directory ──────────────────────────────────────────────
//
// PR-2 R2 Fix 7 - owner ruling 2026-08-24: purchasing must ship
// `accounts_directory` too. Previously the page passed
// `accountsDirectory={undefined}` and the rail fell back to
// STATIC_DIRECTORY, whose `team_name`/`city`/`state` are all null, so
// 8 of 11 members rendered blank because `folioMemberDescription`
// returns `line: null` when team_name is missing. Labor already
// resolves this exact query - mirroring here (rule 4: never fork; but
// the labor helper is not exported and the module boundary keeps the
// two routes independent - this is a live query, not a fork of logic).
async function loadAccountsDirectory(supa) {
  const q = await supa.from("accounts")
    .select("team_key, region, name, city, state")
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
      salaried: salaried.has(r.team_key),
    })),
  };
}

// ─── Freshness read ──────────────────────────────────────────────────

async function loadFreshness(supa) {
  // PR-2 R4 Part E: freshness pill splits `Bills current` from
  // `cards through <date>`. `cards_through` = the newest txn_date on
  // any rippling_spend row (excluded=false). Cards land in the derive
  // ~8 days after they post to the card (ObjectID latency finding from
  // PR-2 R3), so the pill must be honest about that boundary. Derived
  // date, never hardcoded.
  //
  // INV-P20 report-ingest lane: `source='rippling_report'` is the
  // scheduled email ingestion (purchasing_report_ingest.mjs); its
  // completed_at drives the third staleness gate. If the newest
  // successful ingest is > 36h old, the pill flips red - "Report feed
  // stale, last ingest Nh ago". The 36h boundary tolerates one missed
  // night: schedule runs at 06:00 UTC daily, so 36h means "we missed
  // last night entirely" before we page an operator.
  const [bc, rp, rr, cardMaxTxn] = await Promise.all([
    supa.from("purchasing_derive_runs")
      .select("completed_at, bills_touched, lines_written")
      .eq("source", "billcom").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_spend").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_report").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_actuals")
      .select("txn_date")
      .eq("source", "rippling_spend").eq("excluded", false)
      .order("txn_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latestDerive = (bc.data?.completed_at && rp.data?.completed_at)
    ? (bc.data.completed_at > rp.data.completed_at ? bc.data.completed_at : rp.data.completed_at)
    : (bc.data?.completed_at || rp.data?.completed_at || null);
  const reportAt = rr.data?.completed_at || null;
  const reportAgeHours = reportAt
    ? Math.round((Date.now() - new Date(reportAt).getTime()) / 3600000)
    : null;
  const REPORT_STALE_LIMIT_H = 36;
  const reportStale = reportAgeHours == null ? true : reportAgeHours > REPORT_STALE_LIMIT_H;
  return {
    last_billcom_sync:      bc.data?.completed_at || null,
    last_rippling_sync:     rp.data?.completed_at || null,
    last_derive_at:         latestDerive,
    cards_through:          cardMaxTxn.data?.txn_date || null,   // PR-2 R4 Part E
    last_report_ingest_at:  reportAt,                            // INV-P20
    report_row_count:       rr.data?.lines_written ?? null,      // INV-P20
    report_age_hours:       reportAgeHours,                      // INV-P20
    report_stale:           reportStale,                         // INV-P20
    report_stale_limit_h:   REPORT_STALE_LIMIT_H,                // INV-P20
  };
}


// ─── PR-2 R6 Part B - capped aggregations for the five populated cards ───
//
// Owner ruling 2026-08-24: five cards on the board currently render
// honest placeholders (equipment / repair / reimbursable ledgers, card
// purchases, vendor breakdown). Each needs a SMALL pre-aggregated list
// in the default payload - never the full 12,672-row `?drill=lines`
// stream. Rules that apply to every one:
//   - sorted by amount DESC, capped at 25/50/25
//   - total_count + total_amount alongside so "showing 25 of 188"
//     copy is honest (silent truncation is the failure mode this
//     board has three times over)
//   - account_key on every row (only rendered at ALL by the client)
//   - vendor names via billcom_ref_vendors (v_purchasing_actuals_billcom_named
//     view; unresolved vendor_id stays unresolved, gets counted, never
//     invented)
//   - rippling_spend rows (coded card) join by merchant_name in
//     `vendor_or_merchant` directly (no billcom vendor id)
//
// A ledger card's rows must sum to something the card can explain
// (Check 9 - THE GATE). The uncapped sum of ledger rows == the bucket
// hero for that GL family. Check 9 is asserted on the CLIENT in
// LedgerCard.js:56-73 + CardPurchases.js:39-59 against local props.
// A server-side duplicate lived here until INV-P23 removed it - see
// the deleted `ledger_reconciliation` block for why one implementation
// per assertion is the rule.
//
// Vendor rollup ships UN-ROLLED-UP for now (Kevin ruling: report
// fragmentation, do not implement).

async function loadLedgerRows(supa, { members, start, end, glLineCode, glLikePrefix, cap = 25 }) {
  // billcom rows carry a vendor_id we can resolve; rippling_spend rows
  // carry the raw merchant name. Read both from purchasing_actuals so
  // hero (categories.spent) and rows come from the same query.
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      let q = supa.from("purchasing_actuals")
        .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, txn_date, amount, vendor_or_merchant")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (glLineCode) q = q.eq("gl_line_code", glLineCode);
      else if (glLikePrefix) q = q.like("gl_line_code", glLikePrefix);
      const r = await q;
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  // Total (uncapped) - this must equal the bucket hero for Check 9.
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCount = rows.length;
  // Resolve billcom vendor ids to names in one round trip.
  const billcomVendorIds = [
    ...new Set(rows.filter(r => r.source === "billcom" && r.vendor_or_merchant).map(r => r.vendor_or_merchant)),
  ];
  const vendorNameMap = new Map();
  let unresolved = 0;
  if (billcomVendorIds.length > 0) {
    for (const idChunk of chunk(billcomVendorIds, IN_CHUNK)) {
      const vr = await supa.from("billcom_ref_vendors").select("id, name").in("id", idChunk);
      if (vr.error) return { error: vr.error };
      for (const v of vr.data || []) vendorNameMap.set(v.id, v.name || null);
    }
  }
  // Enrich + sort by amount desc + cap.
  const enriched = rows.map(r => {
    let vendor = null;
    if (r.source === "billcom") {
      if (r.vendor_or_merchant && vendorNameMap.has(r.vendor_or_merchant)) {
        vendor = vendorNameMap.get(r.vendor_or_merchant);
      } else {
        if (r.vendor_or_merchant) unresolved += 1;
      }
    } else {
      // rippling_spend: vendor_or_merchant is the raw merchant string.
      vendor = r.vendor_or_merchant || null;
    }
    return {
      account_key: r.account_key,
      gl_line_code: r.gl_line_code,
      txn_date: r.txn_date,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      vendor: vendor,
      source: r.source,
    };
  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const capped = enriched.slice(0, cap);
  return {
    data: {
      rows: capped,
      cap,
      total_count: totalCount,
      total_amount: Math.round(totalAmount * 100) / 100,
      unresolved_vendor_id_count: unresolved,
    },
  };
}

async function loadCardCharges(supa, { members, start, end, cap = 50 }) {
  // Uncoded card charges - rippling_spend rows with gl_line_code IS NULL
  // PLUS report-only pending rows (parents in rippling_report_only_pending_v1
  // that have not yet landed in purchasing_actuals).
  //
  // R16 P0 (owner ruling 2026-08-28): before this change the list walked
  // purchasing_actuals only, while the hero (board.pending) added report-
  // only pending via mergePending().  That produced the 222 vs 219 gap on
  // ALL FYTD - hero counted the report-only slice, list didn't.  The fix:
  // ship both slices in one row set so hero, footer and drill agree.
  // Removing the slice from the hero would understate real exposure -
  // report-only rows are exactly what yesterday's ingest lane was built
  // to bring onto the board.
  //
  // No double-count risk: the report-only view excludes parents already
  // seen by the API (precedence rule, migration-8).  See
  // src/app/kpi/purchasing/lib/precedence.js for the invariant.
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("purchasing_actuals")
        .select("id, source_line_id, account_key, txn_date, amount, vendor_or_merchant, gl_line_code")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .eq("source", "rippling_spend")
        .is("gl_line_code", null)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  // R16 P0 - parallel walk of the report-only view.  Uses the same
  // (account_key, date-window) chunking as loadReportOnlyPending, so the
  // count/amount this produces exactly matches the aggregate that hero
  // adds via mergePending().  CORP is filtered out at the site of the
  // preamble Promise.all; we keep the same filter here for parity.
  const reportRows = [];
  const membersNoCorp = members.filter(m => m !== "CORP");
  for (const memberChunk of chunk(membersNoCorp, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("rippling_report_only_pending_v1")
        .select("parent_txn_id, account_key, purchased_at, amount, category, work_location")
        .in("account_key", memberChunk)
        .gte("purchased_at", start)
        .lte("purchased_at", end)
        .order("parent_txn_id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) reportRows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
                    + reportRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCount = rows.length + reportRows.length;
  // Operator category (the label the operator picked in Rippling)
  // lives on rippling_raw_spend_lines_latest as `category_id`, and the
  // human label lives on `spend_category_map.category_label`. Join
  // via source_line_id (rippling_spend:<uuid> -> raw uuid) then map
  // category_id -> category_label. Never invented - a category with
  // no map row surfaces as null.
  const rawIds = rows.map(r => (r.source_line_id || "").replace(/^rippling_spend:/, "")).filter(Boolean);
  const rawCatIdMap = new Map();     // rippling_id -> category_id
  if (rawIds.length > 0) {
    for (const idChunk of chunk(rawIds, IN_CHUNK)) {
      const rr = await supa.from("rippling_raw_spend_lines_latest")
        .select("rippling_id, category_id")
        .in("rippling_id", idChunk);
      if (rr.error) return { error: rr.error };
      for (const row of rr.data || []) rawCatIdMap.set(row.rippling_id, row.category_id || null);
    }
  }
  const catIds = [...new Set([...rawCatIdMap.values()].filter(Boolean))];
  const catLabelMap = new Map();
  if (catIds.length > 0) {
    for (const idChunk of chunk(catIds, IN_CHUNK)) {
      const cr = await supa.from("spend_category_map").select("category_id, category_label").in("category_id", idChunk);
      if (cr.error) return { error: cr.error };
      for (const row of cr.data || []) catLabelMap.set(row.category_id, row.category_label || null);
    }
  }
  const enrichedApi = rows.map(r => {
    const rawId = (r.source_line_id || "").replace(/^rippling_spend:/, "");
    const catId = rawCatIdMap.get(rawId) || null;
    return {
      account_key: r.account_key,
      txn_date: r.txn_date,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      merchant: r.vendor_or_merchant || null,
      category: catId ? (catLabelMap.get(catId) || null) : null,
      gl_line_code: null,   // uncoded by definition
      source: "api",
    };
  });
  // R16 P0 - report-only rows carry `purchased_at`, `amount`, `category`
  // and `work_location` from the CSV.  They do not carry a merchant
  // name (the ingest lane hasn't matched them yet), so `merchant` is
  // null; the client's `needsAttention` gate already flags null-merchant
  // rows, so report-only rows read as "unknown merchant" - accurate.
  // `source: "report_only"` marks their origin so future UI can label
  // them if wanted.
  const enrichedReport = reportRows.map(r => ({
    account_key: r.account_key,
    txn_date: r.purchased_at,
    amount: Math.round(Number(r.amount || 0) * 100) / 100,
    merchant: null,
    category: r.category || null,
    gl_line_code: null,
    source: "report_only",
  }));
  const enriched = [...enrichedApi, ...enrichedReport]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const capped = enriched.slice(0, cap);
  return {
    data: {
      rows: capped,
      cap,
      total_count: totalCount,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

// R15 F - per-vendor rollup for PurchasingTable's "By vendor" row mode.
// Slimmed from the pre-R15 loadVendorRollup: prior-range compare and
// fragmentation report dropped (they were VendorBreakdown-specific and
// ruled not-value-delivering).  Ships one row per vendor id with total
// spend + gl split, sorted by |spend| desc.  Uncapped - the table's
// own scroll owns the row count.
async function loadVendorRollup(supa, { members, start, end }) {
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("v_purchasing_actuals_billcom_named")
        .select("account_key, gl_line_code, amount, vendor_id, vendor_name, vendor_resolved")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  const byVendor = new Map();
  for (const r of rows) {
    const key = r.vendor_id || "__UNRESOLVED__";
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendor_id: r.vendor_id,
        name: r.vendor_name,
        resolved: !!r.vendor_resolved,
        spend: 0,
        line_count: 0,
        gl_split: { food: 0, packaging: 0, vehicle: 0, equipment: 0, repair: 0, reimbursable: 0, other: 0 },
      });
    }
    const v = byVendor.get(key);
    const amt = Number(r.amount || 0);
    v.spend += amt;
    v.line_count += 1;
    const gl = String(r.gl_line_code || "");
    if      (gl.startsWith("3200")) v.gl_split.food      += amt;
    else if (gl.startsWith("3400")) v.gl_split.packaging += amt;
    else if (gl.startsWith("3500")) v.gl_split.vehicle   += amt;
    else if (gl === "5002.5")       v.gl_split.equipment += amt;
    else if (gl === "5002.1")       v.gl_split.repair    += amt;
    else if (gl.startsWith("13"))   v.gl_split.reimbursable += amt;
    else                            v.gl_split.other     += amt;
  }
  const enriched = [...byVendor.values()].map(v => ({
    vendor_id: v.vendor_id,
    name: v.name,
    resolved: v.resolved,
    spend: Math.round(v.spend * 100) / 100,
    line_count: v.line_count,
    gl_split: {
      food:         Math.round(v.gl_split.food * 100) / 100,
      packaging:    Math.round(v.gl_split.packaging * 100) / 100,
      vehicle:      Math.round(v.gl_split.vehicle * 100) / 100,
      equipment:    Math.round(v.gl_split.equipment * 100) / 100,
      repair:       Math.round(v.gl_split.repair * 100) / 100,
      reimbursable: Math.round(v.gl_split.reimbursable * 100) / 100,
      other:        Math.round(v.gl_split.other * 100) / 100,
    },
  })).sort((a, b) => Math.abs(b.spend) - Math.abs(a.spend));
  const totalAmount = enriched.reduce((s, v) => s + v.spend, 0);
  return {
    data: {
      rows: enriched,
      total_count: enriched.length,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

// ─── Compliance card loader (PR 6) ───────────────────────────────────
//
// Population: rippling_report_txns_latest rows where category is the
// sentinel `Please Select A Category`. This is the report's equivalent
// of "uncoded" - the coder has to pick a P&L line before a row leaves
// the sentinel bucket. Restricted to attributable work locations (rows
// whose spend_work_location_site_map.account_key is set) so the card
// counts what the period card counts: two surfaces describing uncoded
// card spend with the SAME exclusion set. Two cards on different rules
// is exactly the defect class Kevin ruled out.
//
// The Corp/Remote uncoded rows (work_location = "Remote" or "Corporate
// (CORP)", account_key = null in the map, excluded = true) carry no site
// attribution and surface as a footer count only at aggregate scopes -
// they are real compliance work but a site-attribution card is not
// their home.
//
// Compliance attributes come straight off the report row:
//   has_receipt    - fraction present per site + person (Check 7)
//   approval_state - "Missing Requirements" count feeds the header only;
//                    per-person receipt fraction stays the primary signal
//   purchased_at   - age source. Owner ruling 2026-08-28: purchased is
//                    how long the money has been outstanding; submitted
//                    is how long since the person acted. This card is
//                    the money question, so purchased_at is the age.
//
// People are grouped by employee. Empty employee -> "unattributed" row,
// never dropped (Check 4). The people sum to the site row (Check 3
// gate) and the site rows sum to the hero. The client asserts the
// site==sum(people) invariant.
async function loadCompliance(supa, { members, start, end, today }) {
  const PS = V6_PAGE_DEFAULT;
  const rows = [];
  let from = 0;
  while (true) {
    const q = await supa.from("rippling_report_txns_latest")
      .select("purchased_at, amount, work_location, employee, has_receipt, approval_state, category")
      .ilike("category", "%please select%")
      .gte("purchased_at", start)
      .lte("purchased_at", end)
      .order("purchased_at", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const data = q.data || [];
    for (const r of data) rows.push(r);
    if (data.length < PS) break;
    from += PS;
  }

  // Resolve work_location label -> account_key. The map keys by
  // work_location_id, but the report gives us the label string, so join
  // on label. Attributable labels are 1:1 with account_key; Corp/Remote
  // labels have many map rows (one per work_location_id) all with
  // account_key=null, so first-wins collapses them consistently.
  const labels = [...new Set(rows.map(r => r.work_location).filter(Boolean))];
  const labelToKey = new Map();
  if (labels.length > 0) {
    for (const chunkLabels of chunk(labels, IN_CHUNK)) {
      const mr = await supa.from("spend_work_location_site_map")
        .select("work_location_label, account_key")
        .in("work_location_label", chunkLabels);
      if (mr.error) return { error: mr.error };
      for (const m of mr.data || []) {
        if (!labelToKey.has(m.work_location_label)) {
          labelToKey.set(m.work_location_label, m.account_key || null);
        }
      }
    }
  }

  // Age is computed as of the range end, clamped to today for
  // in-progress ranges. A closed-period range reads the age as it was on
  // that period's last day; an FYTD-through-today range reads the age
  // as of today. Consistent with how period cards handle "as of".
  const asOfIso = (end > today) ? today : end;
  const asOf = new Date(asOfIso + "T00:00:00Z");
  function daysBetween(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr + "T00:00:00Z");
    return Math.floor((asOf.getTime() - d.getTime()) / 86400000);
  }

  // Partition rows: attributable (mapped to an account_key in members)
  // vs Corp/Remote (label mapped to null account_key). Rows at
  // attributable sites outside `members` (e.g. single-account scope
  // looking at CIN - AZ, row is at TBR - FL) drop silently - they
  // belong to a different account's view.
  const memberSet = new Set(members);
  const attributable = [];
  const corpRemote = [];
  for (const r of rows) {
    const key = r.work_location ? labelToKey.get(r.work_location) : null;
    if (key && memberSet.has(key)) {
      attributable.push({ ...r, _account_key: key });
    } else if (!key) {
      corpRemote.push(r);
    }
  }

  // Group by site, then by employee within site.
  const bySite = new Map();
  for (const r of attributable) {
    const site = r._account_key;
    if (!bySite.has(site)) bySite.set(site, new Map());
    const perSite = bySite.get(site);
    const empKey = (r.employee || "").trim() || "__UNATTRIBUTED__";
    if (!perSite.has(empKey)) {
      perSite.set(empKey, {
        key: empKey,
        label: empKey === "__UNATTRIBUTED__" ? "unattributed" : r.employee,
        charges: 0,
        amount: 0,
        oldest_age_days: 0,
        receipts_present: 0,
        receipts_total: 0,
      });
    }
    const person = perSite.get(empKey);
    person.charges += 1;
    person.amount += Number(r.amount || 0);
    const age = daysBetween(r.purchased_at);
    if (age > person.oldest_age_days) person.oldest_age_days = age;
    if (r.has_receipt === true) person.receipts_present += 1;
    person.receipts_total += 1;
  }

  // Build site_rows: people amount-desc, unattributed last so the
  // catch-all reads as a floor, not a headline.
  const site_rows = [];
  for (const [site_code, perSite] of bySite.entries()) {
    const people = [...perSite.values()].map(p => ({
      key: p.key,
      label: p.label,
      charges: p.charges,
      amount: Math.round(p.amount * 100) / 100,
      oldest_age_days: p.oldest_age_days,
      receipts_present: p.receipts_present,
      receipts_total: p.receipts_total,
    })).sort((a, b) => {
      if (a.key === "__UNATTRIBUTED__") return 1;
      if (b.key === "__UNATTRIBUTED__") return -1;
      return b.amount - a.amount;
    });
    const charges = people.reduce((s, p) => s + p.charges, 0);
    const amount = Math.round(people.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const oldest_age_days = people.reduce((m, p) => Math.max(m, p.oldest_age_days), 0);
    const receipts_present = people.reduce((s, p) => s + p.receipts_present, 0);
    const receipts_total = people.reduce((s, p) => s + p.receipts_total, 0);
    site_rows.push({
      site_code,
      charges,
      amount,
      oldest_age_days,
      receipts_present,
      receipts_total,
      people,
    });
  }
  site_rows.sort((a, b) => b.amount - a.amount);

  const total_count = site_rows.reduce((s, r) => s + r.charges, 0);
  const total_amount = Math.round(site_rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const oldest_age_days = site_rows.reduce((m, r) => Math.max(m, r.oldest_age_days), 0);
  const no_receipt_count = site_rows.reduce((s, r) => s + (r.receipts_total - r.receipts_present), 0);

  // Stale-over-90d - a standing figure on the card's OWN population
  // (attributable/in-range). Currently zero on 2026-08-28. Ships even
  // when zero so a nine-month-old charge landing on this surface is
  // observable, not a silent transition from empty to populated.
  const stale_over_90d_count = site_rows.reduce(
    (s, r) => s + r.people.reduce((sp, p) => sp + (p.oldest_age_days > 90 ? p.charges : 0), 0),
    0,
  );
  // We can't cleanly derive amount from the per-person aggregate above
  // without re-walking rows; do the walk once here.
  let stale_over_90d_amount = 0;
  for (const r of attributable) {
    const age = daysBetween(r.purchased_at);
    if (age > 90) stale_over_90d_amount += Number(r.amount || 0);
  }
  const stale_over_90d = {
    count:  stale_over_90d_count,
    amount: Math.round(stale_over_90d_amount * 100) / 100,
  };

  // Corp/Remote footer bucket - only at aggregate scopes (single
  // accounts don't need noise about Corp/Remote spend they don't own).
  // Kevin ruling 2026-08-28: also carry oldest_age_days on the footer
  // so a nine-month-old Corp/Remote charge (275d observed on the
  // corpus) has a surface. Card's own scope is unchanged.
  let corp_remote = null;
  if (members.length > 1 && corpRemote.length > 0) {
    let crOldest = 0;
    for (const r of corpRemote) {
      const age = daysBetween(r.purchased_at);
      if (age > crOldest) crOldest = age;
    }
    corp_remote = {
      count: corpRemote.length,
      amount: Math.round(corpRemote.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
      oldest_age_days: crOldest,
    };
  }

  // Region split at aggregate scopes. Same shape as Check 3 - the
  // regions must sum to the portfolio, otherwise a row belongs to a
  // site that no region owns and the ALL / EAST / WEST views disagree.
  // Server throws (not just logs) so a drift can't ship. Region parity
  // holds structurally on 2026-08-28 (5 East + 6 West + 0 NULL), but
  // this guards against future region-null accounts.
  let region_split = null;
  if (members.length > 1) {
    // 11-row read; kept inside the resolver so loadCompliance is
    // self-contained and its assertions don't depend on parallel-load
    // ordering. loadAccountsDirectory also fetches these fields for the
    // rail; the duplication is worth the isolation.
    const arResp = await supa.from("accounts").select("team_key, region").neq("team_key", "CORP");
    if (arResp.error) return { error: arResp.error };
    const regionByKey = new Map();
    for (const row of arResp.data || []) regionByKey.set(row.team_key, row.region);
    const east = { count: 0, amount: 0 };
    const west = { count: 0, amount: 0 };
    const other = { count: 0, amount: 0, keys: new Set() };
    for (const site of site_rows) {
      const region = regionByKey.get(site.site_code);
      const bucket = region === "East" ? east : region === "West" ? west : other;
      bucket.count += site.charges;
      bucket.amount += site.amount;
      if (bucket === other) bucket.keys.add(site.site_code);
    }
    east.amount  = Math.round(east.amount  * 100) / 100;
    west.amount  = Math.round(west.amount  * 100) / 100;
    other.amount = Math.round(other.amount * 100) / 100;
    // Same-defect-shape check: regions must sum to total. Throw so the
    // resolver refuses to serve a broken payload; the client Check 3 is
    // the belt-and-braces gate over the same invariant on the whole
    // (site == sum-of-people == sum-of-regions) column.
    const combined = east.count + west.count + other.count;
    if (combined !== total_count) {
      return { error: { message: `region parity: east=${east.count} west=${west.count} other=${other.count} sum=${combined} total_count=${total_count}`, code: "region_parity_sum" } };
    }
    if (other.count > 0) {
      return { error: { message: `region parity: ${other.count} charge(s) at site(s) [${[...other.keys].join(",")}] whose region is neither East nor West. Fix accounts.region before continuing.`, code: "region_parity_other" } };
    }
    region_split = { east, west };
  }

  return {
    data: {
      total_count,
      total_amount,
      oldest_age_days,
      no_receipt_count,
      site_rows,
      corp_remote,
      region_split,
      stale_over_90d,
      thresholds: { red_days: 14, amber_days: 7 },
    },
  };
}

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

  // Budgets for members (needed by budget block, categories, buckets,
  // periods).
  const fyForRange = 2026;   // FY2026 hard-coded; matches labor's convention
  const budgetsResp = await loadPurchasingBudgets(supa, members, fyForRange);
  if (budgetsResp.error) return NextResponse.json(safeError("kpi_budgets", budgetsResp.error), { status: 500 });
  const budgetsByLine = budgetsResp.data;

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

  // Fetch weekly / pending / raw actuals / freshness in
  // parallel. Weekly reads the SQL-aggregated view; raw actuals are
  // still needed for source-level splits (bills-only bucket state,
  // totals.card by source). Parallelising cuts wall-time on the
  // common ALL/FYTD path where the largest read (actuals ~ 12.7k
  // rows) would otherwise serialise behind the weekly read.
  //
  // PR-2 R4 Part A: pass [effStart, effEnd] so weekly view, actuals,
  // pending all describe the same fiscal-week footprint.
  const [weeklyResp, pendingResp, reportPendingResp, actualsResp, freshness, dirResp, priorHistoryResp, complianceResp] = await Promise.all([
    paginateWeekly(supa, { members, start: effStart, end: effEnd }),
    loadPending(supa, { members, start: effStart, end: effEnd }),
    loadReportOnlyPending(supa, { members: members.filter(m => m !== "CORP"), start: effStart, end: effEnd, IN_CHUNK }),
    paginateActuals(supa, { members, start: effStart, end: effEnd, pageSize: pageSizeParam }),
    loadFreshness(supa),
    loadAccountsDirectory(supa),   // PR-2 R2 Fix 7
    // R13 P0-1 - history for closed period card only.  Loader returns
    // { data: null } instantly if the range isn't a closed period.
    isClosedSinglePeriod
      ? loadPriorPeriodHistory(supa, { members, periodNo: singlePeriodNo })
      : Promise.resolve({ data: null }),
    // PR 6 - compliance card. Reads the report side of uncoded card
    // spend (rippling_report_txns_latest sentinel category) restricted
    // to attributable work locations. Corp/Remote uncoded rows are a
    // footer count only. See loadCompliance() docblock for the full
    // shape + why the population is the report side, not the board.
    loadCompliance(supa, { members, start: effStart, end: effEnd, today }),
  ]);
  if (weeklyResp.error) return NextResponse.json(safeError("v_purchasing_by_site_week", weeklyResp.error), { status: 500 });
  if (pendingResp.error) return NextResponse.json(safeError("pending", pendingResp.error), { status: 500 });
  if (reportPendingResp.error) return NextResponse.json(safeError("rippling_report_only_pending_v1", reportPendingResp.error), { status: 500 });
  if (actualsResp.error) return NextResponse.json(safeError("purchasing_actuals", actualsResp.error), { status: 500 });
  if (dirResp.error) return NextResponse.json(safeError("accounts_directory", dirResp.error), { status: 500 });
  if (priorHistoryResp.error) return NextResponse.json(safeError("prior_period_history", priorHistoryResp.error), { status: 500 });
  if (complianceResp.error) return NextResponse.json(safeError("compliance", complianceResp.error), { status: 500 });
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
  {
    const apiThrough = freshness.cards_through;
    const reportThrough = pending.report_only.max_purchased_at;
    freshness.cards_through_effective =
      apiThrough && reportThrough
        ? (apiThrough > reportThrough ? apiThrough : reportThrough)
        : (apiThrough || reportThrough || null);
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

  // R15 - Vehicle joins the matched-ledgers row (was a bucket card chart).
  // Same shape as Equipment / R&M so page.js can render three cards with
  // one component.  gl_line_code prefix is 3500 (any 3500.*).
  // R15 F - vendor_rollup for the drill table's "By vendor" row mode
  // (VendorBreakdown card gone; vendor rows land in-table now).
  const [vehicleR, equipR, repairR, reimbR, cardChR, vendorRollupR] = await Promise.all([
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLikePrefix: "3500%", cap: 25 }),
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.5", cap: 25 }),
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.1", cap: 25 }),
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLikePrefix: "13%",    cap: 25 }),
    loadCardCharges(supa, { members, start: effStart, end: effEnd, cap: 50 }),
    loadVendorRollup(supa, { members, start: effStart, end: effEnd }),
  ]);
  if (vehicleR.error)       return NextResponse.json(safeError("ledgers.vehicle",     vehicleR.error), { status: 500 });
  if (equipR.error)         return NextResponse.json(safeError("ledgers.equipment",   equipR.error),   { status: 500 });
  if (repairR.error)        return NextResponse.json(safeError("ledgers.repair",      repairR.error),  { status: 500 });
  if (reimbR.error)         return NextResponse.json(safeError("ledgers.reimbursable", reimbR.error),  { status: 500 });
  if (cardChR.error)        return NextResponse.json(safeError("card_charges",        cardChR.error),  { status: 500 });
  if (vendorRollupR.error)  return NextResponse.json(safeError("vendor_rollup",       vendorRollupR.error), { status: 500 });

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
