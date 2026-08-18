// /api/kpi/purchasing
//
// KPI PURCHASING PHASE 1 - C4: the read-only route the (future Phase 2)
// board calls. Contract: docs/KPI_PURCHASING_PHASE1_SPEC.md §3.
//
// DATA ONLY. No UI. No writes to Invoice Capture tables. No changes
// to /api/kpi/labor. Never touches Rippling or bill.com directly - it
// reads the derived purchasing_actuals plus the two views. The syncs
// (C2 + C3) do the writes.
//
// Mirrors /api/kpi/labor's contract exactly:
//   - same range resolution via periods.js
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
//   actuals            [{ gl_line_code, gl_bucket, week_start, amount,
//                        lines, bills, paid_amount, sources }]
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
//                       (null until P0d audit's join lands) }
//   provisional        true when range end + 16 days > today
//                       (bill.com entry-lag p90).
//   freshness          { last_billcom_sync, last_rippling_sync,
//                       last_derive_at }
//   sentinel           the frozen (TBR - FL, P8, 3200.1) value. See PR
//                     body for the freeze number.
//
// Query params:
//   account            accounts.team_key OR ALL / EAST / WEST (required)
//   start              YYYY-MM-DD (defaults to fiscal-year start)
//   end                YYYY-MM-DD (defaults to today)
//
// Auth: session gate via OPS_LEADERSHIP_EMAILS (identical to labor).
// No name / dollar / vendor / merchant echo in error paths.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";
import {
  FY_START_ISO, periodOf, periodStartISO, periodEndISO,
  weekStartsInRange, inferRangeSelection, currentPeriodNo,
} from "@/app/kpi/labor/lib/periods.js";

const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
const V6_ENVELOPE_ACCOUNTS = new Set(["TXR - TX - V"]);
const V6_PAGE_DEFAULT = 1000;

// bill.com entry-lag p90 per master §3. A period is provisional until
// range_end + 16 days is in the past.
const PROVISIONAL_WINDOW_DAYS = 16;

// Category priority order for adaptive list (spec §3).
// Ordinal reflects the ordering the client renders top-to-bottom.
const CATEGORY_PRIORITY = [
  "3200.1", "3200.2", "3400.1", "3400.2", "3400.5",
];

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

// Paginate purchasing_actuals for a members set and a date range.
// Filter drops excluded rows and null account_key rows so the caller
// never has to remember to exclude them. Unattributed / uncoded
// analysis reads a separate query (below) that keeps the null rows.
async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("purchasing_actuals")
      .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, gl_bucket, txn_date, posting_date, amount, paid, approx_date, derived_at")
      .in("account_key", members)
      .eq("excluded", false)
      .gte("txn_date", start)
      .lte("txn_date", end)
      .order("txn_date", { ascending: true })
      .order("account_key", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return { data: out };
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
async function loadPurchasingBudgets(supa, accounts, fiscalYear) {
  const q = await supa.from("kpi_budgets")
    .select("account_key, line_code, period_no, amount")
    .eq("fiscal_year", fiscalYear)
    .in("account_key", accounts)
    .neq("line_code", "3100.1")     // labor lives in labor route
    .neq("line_code", "3100.2");    // salaried; not in scope for purchasing v1
  if (q.error) return { error: q.error };
  const byLine = new Map();
  for (const r of q.data || []) {
    const gl = String(r.line_code);
    const acct = String(r.account_key);
    if (!byLine.has(gl)) byLine.set(gl, new Map());
    if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
    byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
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

// ─── Freshness read ──────────────────────────────────────────────────

async function loadFreshness(supa) {
  const [bc, rp] = await Promise.all([
    supa.from("purchasing_derive_runs")
      .select("completed_at, bills_touched, lines_written")
      .eq("source", "billcom").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_spend").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latestDerive = (bc.data?.completed_at && rp.data?.completed_at)
    ? (bc.data.completed_at > rp.data.completed_at ? bc.data.completed_at : rp.data.completed_at)
    : (bc.data?.completed_at || rp.data?.completed_at || null);
  return {
    last_billcom_sync: bc.data?.completed_at || null,
    last_rippling_sync: rp.data?.completed_at || null,
    last_derive_at: latestDerive,
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
  return {
    bills_in_range:                billCount.count || 0,
    last_bill_created_at:          lastBillCreated,
    days_since_last_bill:          daysSince,
    lines_unattributed:            unattr.count || 0,
    lines_uncoded:                 uncoded.count || 0,
    invoice_capture_matched_pct:   null,   // P0d audit lands separately
  };
}

// ─── Route handler ───────────────────────────────────────────────────

export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const account = (searchParams.get("account") || "").trim();
  const start = searchParams.get("start") || FY_START_ISO;
  const end = searchParams.get("end") || today;
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

  // Actuals for the range.
  const actualsResp = await paginateActuals(supa, { members, start, end, pageSize: pageSizeParam });
  if (actualsResp.error) return NextResponse.json(safeError("purchasing_actuals", actualsResp.error), { status: 500 });
  const actuals = actualsResp.data;

  // Budgets for members.
  const fyForRange = 2026;   // FY2026 hard-coded; matches labor's convention
  const budgetsResp = await loadPurchasingBudgets(supa, members, fyForRange);
  if (budgetsResp.error) return NextResponse.json(safeError("kpi_budgets", budgetsResp.error), { status: 500 });
  const budgetsByLine = budgetsResp.data;

  // Coverage + freshness.
  const [coverage, freshness] = await Promise.all([
    loadCoverage(supa, { members, start, end }),
    loadFreshness(supa),
  ]);

  // Adaptive categories: union of every gl_line_code with actual > 0
  // in range OR budget > 0 in range.
  const glLineCodesInActuals = new Set();
  for (const r of actuals) if (r.gl_line_code) glLineCodesInActuals.add(r.gl_line_code);
  const glLineCodesInBudget = new Set([...budgetsByLine.keys()].filter(gl => {
    const b = budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
    return b > 0;
  }));
  const allGl = new Set([...glLineCodesInActuals, ...glLineCodesInBudget]);
  const orderedGl = [...allGl].sort(comparePriority);

  // Rollup helpers.
  function spentForGl(gl) {
    let s = 0;
    for (const r of actuals) if (r.gl_line_code === gl) s += Number(r.amount || 0);
    return Math.round(s * 100) / 100;
  }

  const rangeSelection = inferRangeSelection(start, end);
  const periodNo = rangeSelection?.kind === "period" ? rangeSelection.value : null;
  const weeks = weekStartsInRange(start, end);
  const weeksInRange = weeks.length;
  // Elapsed frac: for closed range (end < today), 1.0. For in-progress,
  // (days from start to today) / (days from start to end + 1).
  let elapsedFrac = 1.0;
  const todayDate = new Date(today);
  const endDate = new Date(end);
  const startDate = new Date(start);
  if (endDate > todayDate) {
    const totalDays = Math.max(1, Math.floor((endDate - startDate) / 86400000) + 1);
    const doneDays = Math.max(0, Math.floor((todayDate - startDate) / 86400000) + 1);
    elapsedFrac = Math.min(1.0, doneDays / totalDays);
  }
  const closedWeeksInRange = weeks.filter(w => {
    const wEnd = new Date(new Date(w).getTime() + 6 * 86400000);
    return wEnd < todayDate;
  }).length;

  const categories = orderedGl.map(gl => {
    const budget = budgetForRange({ byLine: budgetsByLine, glLineCode: gl, members, start, end });
    const spent = spentForGl(gl);
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

  // Totals by bucket.
  function sumSpentByBucket(bucket) {
    let s = 0;
    for (const r of actuals) if (r.gl_bucket === bucket) s += Number(r.amount || 0);
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
  // Card totals from rippling_spend rows in range.
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

  // Sentinel: value the route returns for the frozen probe. Freeze in
  // the PR body once the syncs run against prod for the first time.
  const sentinelResp = await computeSentinel(supa);

  return NextResponse.json({
    ok: true,
    filters: { account, start, end },
    is_aggregate: isAggregate,
    members,
    range: { start, end },
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
    actuals,
    categories,
    totals,
    coverage,
    provisional,
    freshness,
    sentinel: sentinelResp.error ? null : sentinelResp.data,
  });
}
