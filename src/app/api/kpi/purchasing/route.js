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
//   coverage           { bills_in_range, last_bill_created_at,
//                        days_since_last_bill, lines_unattributed,
//                        lines_uncoded, invoice_capture_matched_pct
//                       (null until P0d audit's join lands),
//                        miscoded_card_lines: { count, by_account: [...] } }
//                       miscoded_card_lines: card lines whose
//                       work_location is Remote/Corporate/HQ (so they
//                       are excluded from any per-account spend view)
//                       BUT whose department_id resolves to a site via
//                       rippling_department_map. That is a policy miss:
//                       a site person spent money and did not code a
//                       location. Attributed by the DEPARTMENT
//                       (cardholder's payroll site) for the report;
//                       NEVER summed into any spend figure.
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
} from "@/lib/accountModels";

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
// Population: bills + coded card lines. Pending sum + coverage nulls
// go via separate paths that keep the rows this drops.
async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("purchasing_actuals")
        .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, gl_bucket, txn_date, posting_date, amount, paid, approx_date, derived_at")
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
  const [bc, rp, cardMaxTxn] = await Promise.all([
    supa.from("purchasing_derive_runs")
      .select("completed_at, bills_touched, lines_written")
      .eq("source", "billcom").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_spend").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_actuals")
      .select("txn_date")
      .eq("source", "rippling_spend").eq("excluded", false)
      .order("txn_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latestDerive = (bc.data?.completed_at && rp.data?.completed_at)
    ? (bc.data.completed_at > rp.data.completed_at ? bc.data.completed_at : rp.data.completed_at)
    : (bc.data?.completed_at || rp.data?.completed_at || null);
  return {
    last_billcom_sync:  bc.data?.completed_at || null,
    last_rippling_sync: rp.data?.completed_at || null,
    last_derive_at:     latestDerive,
    cards_through:      cardMaxTxn.data?.txn_date || null,   // PR-2 R4 Part E
  };
}

// ─── Coverage read ───────────────────────────────────────────────────

async function loadCoverage(supa, { members, start, end }) {
  const [billCount, lastBill, unattr, uncoded] = await Promise.all([
    supa.from("purchasing_actuals")
      .select("source_bill_id", { count: "exact", head: true })
      .eq("source", "billcom").eq("excluded", false)
      .in("account_key", members).gte("txn_date", start).lte("txn_date", end),
    supa.from("billcom_raw_bills_latest")
      .select("created_time")
      .order("created_time", { ascending: false })
      .limit(1).maybeSingle(),
    supa.from("purchasing_actuals")
      .select("id", { count: "exact", head: true })
      .is("account_key", null).eq("excluded", false),
    supa.from("purchasing_actuals")
      .select("id", { count: "exact", head: true })
      .is("gl_line_code", null),
  ]);
  const lastBillCreated = lastBill.data?.created_time || null;
  const daysSince = lastBillCreated
    ? Math.max(0, Math.floor((Date.now() - new Date(lastBillCreated).getTime()) / 86400000))
    : null;

  // miscoded_card_lines (owner ruling 2026-08-18): card lines whose
  // work_location resolved to excluded (Remote/Corporate/HQ) but whose
  // department_id maps to a labor site via rippling_department_map.
  // Attribute by DEPARTMENT (that is the only signal for who should
  // have coded it). NEVER sum into any per-account spend figure.
  //
  // Read the excluded rippling_spend rows in range from raw_latest
  // (excluded rows in purchasing_actuals do not carry account_key by
  // construction; we need the raw row's department_id). Then join
  // against rippling_department_map for account_key.
  const miscoded = { count: 0, by_account: [] };
  {
    // Load raw excluded rows in range. The raw row's first_seen_at
    // approximates the txn_date the derive step uses.
    const rawRows = [];
    let from = 0;
    const CHUNK = 1000;
    while (true) {
      const q = await supa.from("rippling_raw_spend_lines_latest")
        .select("rippling_id, department_id, work_location_id, first_seen_at")
        .not("work_location_id", "is", null)
        .not("department_id", "is", null)
        .gte("first_seen_at", start + "T00:00:00.000Z")
        .lte("first_seen_at", end + "T23:59:59.999Z")
        .order("rippling_id", { ascending: true })
        .range(from, from + CHUNK - 1);
      if (q.error) break;
      const rows = q.data || [];
      for (const r of rows) rawRows.push(r);
      if (rows.length < CHUNK) break;
      from += CHUNK;
    }
    // Load work_location map (excluded set) + rippling_department_map.
    const [wlMap, deptMap] = await Promise.all([
      supa.from("spend_work_location_site_map").select("work_location_id, excluded"),
      supa.from("rippling_department_map").select("department_id, account_key"),
    ]);
    const excludedWLIds = new Set((wlMap.data || []).filter(r => r.excluded).map(r => r.work_location_id));
    const deptToAccount = new Map((deptMap.data || []).map(r => [r.department_id, r.account_key]));
    const byAcct = new Map();
    for (const r of rawRows) {
      if (!excludedWLIds.has(r.work_location_id)) continue;      // not excluded -> normal attribution path
      const accountKey = deptToAccount.get(r.department_id);
      if (!accountKey) continue;                                 // department not mapped
      // miscoding definition: CORP-department cards coded to Remote are
      // expected, not miscodes. Single site of truth for this rule
      // (owner ruling 2026-08-19, PR #713 flag 2 - ACCEPTED as built).
      // A corporate person coding to Remote is expected behaviour: they
      // work remotely. Filtering CORP-department rows out of the count
      // here is the definition, not a policy layered on top.
      if (accountKey === "CORP") continue;
      byAcct.set(accountKey, (byAcct.get(accountKey) || 0) + 1);
    }
    miscoded.count = [...byAcct.values()].reduce((s, n) => s + n, 0);
    miscoded.by_account = [...byAcct.entries()]
      .map(([account_key, lines]) => ({ account_key, lines }))
      .sort((a, b) => b.lines - a.lines);
  }

  return {
    bills_in_range:                billCount.count || 0,
    last_bill_created_at:          lastBillCreated,
    days_since_last_bill:          daysSince,
    lines_unattributed:            unattr.count || 0,
    lines_uncoded:                 uncoded.count || 0,
    invoice_capture_matched_pct:   null,   // P0d audit lands separately
    miscoded_card_lines:           miscoded,
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
// hero for that GL family. We assert it right before returning and
// return a `ledger_reconciliation` block the client can crash on.
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
  // Uncoded card charges - rippling_spend rows with gl_line_code IS NULL.
  // Same population as `pending` but returns per-charge rows instead of
  // the dollar+count summary.
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
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCount = rows.length;
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
  const enriched = rows.map(r => {
    const rawId = (r.source_line_id || "").replace(/^rippling_spend:/, "");
    const catId = rawCatIdMap.get(rawId) || null;
    return {
      account_key: r.account_key,
      txn_date: r.txn_date,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      merchant: r.vendor_or_merchant || null,
      category: catId ? (catLabelMap.get(catId) || null) : null,
      gl_line_code: null,   // uncoded by definition
    };
  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
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

async function loadVendorRollup(supa, { members, start, end, priorStart, priorEnd, cap = 25 }) {
  // Per-vendor rollup for billcom rows (rippling_spend rows do not
  // carry a vendor_id; merchant strings are per-charge, not per-vendor).
  // Un-rolled-up (Kevin ruling): `Sysco JUP` / `Sysco TBJ` / `Sysco TBR`
  // stay three rows. Fragmentation is reported separately, not fixed.
  //
  // Uses the named view so vendor_name lands in a single scan; the
  // unresolved id path just carries vendor_id null on the row.
  async function paginateNamed(startISO, endISO) {
    const rows = [];
    const PS = V6_PAGE_DEFAULT;
    for (const memberChunk of chunk(members, IN_CHUNK)) {
      let from = 0;
      while (true) {
        const r = await supa.from("v_purchasing_actuals_billcom_named")
          .select("account_key, gl_line_code, amount, vendor_id, vendor_name, vendor_resolved")
          .in("account_key", memberChunk)
          .eq("excluded", false)
          .gte("txn_date", startISO)
          .lte("txn_date", endISO)
          .order("id", { ascending: true })
          .range(from, from + PS - 1);
        if (r.error) return { error: r.error };
        const data = r.data || [];
        for (const row of data) rows.push(row);
        if (data.length < PS) break;
        from += PS;
      }
    }
    return { rows };
  }
  const cur = await paginateNamed(start, end);
  if (cur.error) return { error: cur.error };
  const prior = priorStart && priorEnd ? await paginateNamed(priorStart, priorEnd) : { rows: [] };
  if (prior.error) return { error: prior.error };

  function rollup(rows) {
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
          gl_split: { food: 0, packaging: 0, vehicle: 0, other: 0 },
        });
      }
      const v = byVendor.get(key);
      v.spend += Number(r.amount || 0);
      v.line_count += 1;
      const gl = String(r.gl_line_code || "");
      const amt = Number(r.amount || 0);
      if (gl.startsWith("3200")) v.gl_split.food += amt;
      else if (gl.startsWith("3400")) v.gl_split.packaging += amt;
      else if (gl.startsWith("3500")) v.gl_split.vehicle += amt;
      else v.gl_split.other += amt;
    }
    return byVendor;
  }
  const curMap = rollup(cur.rows);
  const priorMap = rollup(prior.rows);

  const enriched = [...curMap.values()].map(v => {
    const p = priorMap.get(v.vendor_id || "__UNRESOLVED__");
    const priorSpend = p ? Math.round(p.spend * 100) / 100 : 0;
    return {
      vendor_id: v.vendor_id,
      name: v.name,
      resolved: v.resolved,
      spend: Math.round(v.spend * 100) / 100,
      line_count: v.line_count,
      gl_split: {
        food: Math.round(v.gl_split.food * 100) / 100,
        packaging: Math.round(v.gl_split.packaging * 100) / 100,
        vehicle: Math.round(v.gl_split.vehicle * 100) / 100,
        other: Math.round(v.gl_split.other * 100) / 100,
      },
      prior_spend: priorSpend,
    };
  }).sort((a, b) => Math.abs(b.spend) - Math.abs(a.spend));

  const totalAmount = enriched.reduce((s, v) => s + v.spend, 0);
  const totalCount = enriched.length;
  const unresolved = enriched.filter(v => !v.resolved).length;

  // Fragmentation report. Kevin ruling: report, do not implement.
  // Strip a trailing `_<SUFFIX>` or ` <SUFFIX>` or ` - <SUFFIX>` where
  // SUFFIX is 2-5 uppercase letters/digits (matches TBR, JUP, TXR-AZ,
  // REDS, CINN, LBAT, etc). This is a heuristic - the actual site-suffix
  // vocabulary is not enumerated in Bill.com; we count *possible*
  // collapses without merging anything downstream.
  const names = enriched.filter(v => v.resolved && v.name).map(v => v.name);
  const canonMap = new Map();
  const suffixPat = /(?:[\s_-]+[A-Z0-9]{2,5}(?:[-][A-Z0-9]{1,3})?)$/;
  for (const n of names) {
    const stripped = n.replace(suffixPat, "").trim();
    const key = stripped || n;
    if (!canonMap.has(key)) canonMap.set(key, new Set());
    canonMap.get(key).add(n);
  }
  const fragmented = [...canonMap.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([canonical, set]) => ({ canonical, variants: [...set] }))
    .sort((a, b) => b.variants.length - a.variants.length);
  const suppliersIfCollapsed = canonMap.size;

  return {
    data: {
      rows: enriched.slice(0, cap),
      cap,
      total_count: totalCount,
      total_amount: Math.round(totalAmount * 100) / 100,
      unresolved_count: unresolved,
      fragmentation: {
        distinct_names: names.length,
        suppliers_if_suffix_stripped: suppliersIfCollapsed,
        collapsed: fragmented,
      },
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
  const account = (searchParams.get("account") || "").trim();
  const start = searchParams.get("start") || FY_START_ISO;
  const end = searchParams.get("end") || today;
  const drill = (searchParams.get("drill") || "").trim().toLowerCase();
  const includeLines = drill === "lines";
  const pageSizeParam = parseInt(searchParams.get("_page_size") || "0", 10);

  if (!account) {
    return NextResponse.json({ error: "account_required", detail: "?account=<team_key> is required" }, { status: 400 });
  }
  if (D17_OUT_OF_SCOPE.has(account)) {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }

  const supa = getServiceClient();

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
  // Every read below (weekly view, purchasing_actuals, pending,
  // coverage) uses the SAME [effStart, effEnd] pair so hero, bills,
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

  // Fetch weekly / pending / raw actuals / coverage / freshness in
  // parallel. Weekly reads the SQL-aggregated view; raw actuals are
  // still needed for source-level splits (bills-only bucket state,
  // totals.card by source). Parallelising cuts wall-time on the
  // common ALL/FYTD path where the largest read (actuals ~ 12.7k
  // rows) would otherwise serialise behind the weekly read.
  //
  // PR-2 R4 Part A: pass [effStart, effEnd] so weekly view, actuals,
  // pending and coverage all describe the same fiscal-week footprint.
  const [weeklyResp, pendingResp, actualsResp, coverage, freshness, dirResp] = await Promise.all([
    paginateWeekly(supa, { members, start: effStart, end: effEnd }),
    loadPending(supa, { members, start: effStart, end: effEnd }),
    paginateActuals(supa, { members, start: effStart, end: effEnd, pageSize: pageSizeParam }),
    loadCoverage(supa, { members, start: effStart, end: effEnd }),
    loadFreshness(supa),
    loadAccountsDirectory(supa),   // PR-2 R2 Fix 7
  ]);
  if (weeklyResp.error) return NextResponse.json(safeError("v_purchasing_by_site_week", weeklyResp.error), { status: 500 });
  if (pendingResp.error) return NextResponse.json(safeError("pending", pendingResp.error), { status: 500 });
  if (actualsResp.error) return NextResponse.json(safeError("purchasing_actuals", actualsResp.error), { status: 500 });
  if (dirResp.error) return NextResponse.json(safeError("accounts_directory", dirResp.error), { status: 500 });
  const weekly = weeklyResp.data;
  const pending = pendingResp.data;
  const actuals = actualsResp.data;

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
  {
    // Fetch weekly view over the whole FYTD once (members-filtered).
    // Reuse `weekly` when the request range IS FYTD - saves a
    // duplicate round-trip on the most common query.
    let fyWeekly;
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

  // Sentinel: value the route returns for the frozen probe.
  const sentinelResp = await computeSentinel(supa);

  // cost_model: single-account calls carry the resolved cost model
  // (at_risk / pass_through / revenue_flex). Aggregates get null -
  // aggregates roll up mixed cost models and the caller must decide
  // how to present.
  //
  // billed_back_reachable: is "billed back to client" derivable from
  // data we hold today? The route reports the honest answer per INV-P9
  // Q5. Reimbursable spend IS captured (13xx GL bucket, per PLAYBOOK
  // §5.2). The client-invoice-back TIMESTAMP + AMOUNT event is NOT
  // captured today - we know KitchFix ordered it, we do not have a
  // record of when/whether Sebastian invoiced the client for it. So
  // reachable = false. What it would need: a bill.com AR-side hook or
  // a manual "billed on" field on the reimbursable row.
  //
  // Do NOT build the billed-back-to-client stream here - Kevin ruled
  // Part B is report-only in this PR.
  const cost_model = isAggregate ? null : costModelFor(account);
  const billed_back_reachable = {
    reachable: false,
    reason: "no AR-side event captured today - reimbursable spend row (13xx) records KitchFix order + cost, but the client-invoice-back timestamp and amount are not persisted",
    would_need: "a bill.com AR-side hook that stamps the reimbursable row on client invoice, or a manual 'billed_on' field on the reimbursable row",
  };

  // ─── PR-2 R6 Part B - capped aggregations for five populated cards ──
  //
  // Ledgers.equipment / ledgers.repair / ledgers.reimbursable each cap
  // at 25. card_charges caps at 50. vendors caps at 25. Each carries a
  // total_count and total_amount for honest "showing 25 of 188" copy.
  //
  // Prior-range window for vendor movement: mirrored window before
  // `start` of the same length. Preserves the shape of the compare:
  // asking "how much did X spend last period vs this one" instead of
  // baking a specific period-of/last-period assumption in the payload.
  const priorRange = (() => {
    const s = new Date(start + "T00:00:00.000Z").getTime();
    const e = new Date(end + "T00:00:00.000Z").getTime();
    const span = e - s;
    if (!(span > 0)) return { start: null, end: null };
    const priorEnd = new Date(s - 86400000).toISOString().slice(0, 10);
    const priorStart = new Date(s - 86400000 - span).toISOString().slice(0, 10);
    return { start: priorStart, end: priorEnd };
  })();

  const [equipR, repairR, reimbR, cardChR, vendorR] = await Promise.all([
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.5", cap: 25 }),
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLineCode: "5002.1", cap: 25 }),
    loadLedgerRows(supa, { members, start: effStart, end: effEnd, glLikePrefix: "13%",    cap: 25 }),
    loadCardCharges(supa, { members, start: effStart, end: effEnd, cap: 50 }),
    loadVendorRollup(supa, { members, start: effStart, end: effEnd, priorStart: priorRange.start, priorEnd: priorRange.end, cap: 25 }),
  ]);
  if (equipR.error)   return NextResponse.json(safeError("ledgers.equipment",   equipR.error),   { status: 500 });
  if (repairR.error)  return NextResponse.json(safeError("ledgers.repair",      repairR.error),  { status: 500 });
  if (reimbR.error)   return NextResponse.json(safeError("ledgers.reimbursable", reimbR.error),  { status: 500 });
  if (cardChR.error)  return NextResponse.json(safeError("card_charges",        cardChR.error),  { status: 500 });
  if (vendorR.error)  return NextResponse.json(safeError("vendors",             vendorR.error),  { status: 500 });

  // ─── Check 9 - ledger sum vs bucket hero reconciliation ─────────────
  //
  // A ledger card's rows must sum to something the card can explain.
  // The uncapped ledger total_amount MUST equal the corresponding
  // `categories[]` hero for that gl_line_code (the number the card's
  // hero displays). If they diverge, the card is lying - same defect
  // class as R4's Part A. Assert and expose the reconciliation on the
  // payload so a client-side gate can crash on drift.
  const equipHero  = spentForGl("5002.5");
  const repairHero = spentForGl("5002.1");
  // Reimb hero: sum every 13xx gl category.spent from `categories[]`.
  const reimbHero  = categories
    .filter(c => String(c.gl_line_code || "").startsWith("13"))
    .reduce((s, c) => s + Number(c.spent || 0), 0);
  const reimbHeroR = Math.round(reimbHero * 100) / 100;
  const ledger_reconciliation = {
    equipment:      { hero: equipHero,   ledger_total: equipR.data.total_amount,   delta: Math.round((equipHero  - equipR.data.total_amount)  * 100) / 100 },
    repair:         { hero: repairHero,  ledger_total: repairR.data.total_amount,  delta: Math.round((repairHero - repairR.data.total_amount) * 100) / 100 },
    reimbursable:   { hero: reimbHeroR,  ledger_total: reimbR.data.total_amount,   delta: Math.round((reimbHeroR - reimbR.data.total_amount)  * 100) / 100 },
  };
  const TOLERANCE_CENTS = 1;   // 1c tolerance to absorb rounding
  const check9_pass =
    Math.abs(ledger_reconciliation.equipment.delta)    <= (TOLERANCE_CENTS / 100) &&
    Math.abs(ledger_reconciliation.repair.delta)       <= (TOLERANCE_CENTS / 100) &&
    Math.abs(ledger_reconciliation.reimbursable.delta) <= (TOLERANCE_CENTS / 100);
  ledger_reconciliation.pass = check9_pass;
  if (!check9_pass) {
    // Log the mismatch but do NOT throw - the client asserts on
    // ledger_reconciliation.pass and refuses to render mismatched cards
    // (Check 9 - THE GATE). Server-side we surface the numbers so the
    // caller can see exactly which query diverged.
    console.warn("[kpi/purchasing] Check 9 ledger reconciliation drift:",
      JSON.stringify(ledger_reconciliation));
  }

  const payload = {
    ok: true,
    filters: { account, start, end, drill: includeLines ? "lines" : null },
    is_aggregate: isAggregate,
    members,
    range: { start, end },
    cost_model,
    billed_back_reachable,
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
    categories,
    totals,
    coverage,
    provisional,
    freshness,
    accounts_directory: dirResp.data,   // PR-2 R2 Fix 7 - rail meta on 11/11
    sentinel: sentinelResp.error ? null : sentinelResp.data,
    // PR-2 R6 Part B - five capped aggregations (spec §6.3-6.5).
    // Each is small (25/50/25 rows). Payload size delta reported in
    // the return; the 4.5MB drill array remains off-by-default.
    ledgers: {
      equipment:    equipR.data,
      repair:       repairR.data,
      reimbursable: reimbR.data,
    },
    card_charges: cardChR.data,
    vendors:      vendorR.data,
    ledger_reconciliation,
  };
  if (includeLines) payload.actuals = actuals;

  return NextResponse.json(payload);
}
