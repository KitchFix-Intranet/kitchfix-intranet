// src/lib/kpi/overview/pnl-loader.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Reads pnl_actuals + kpi_period_status + kpi_account_flags + the
// revenue-line kpi_budgets rows the Overview needs. Everything here
// is READ-ONLY (SELECT only, no writes ever).
//
// Absence contract (BINDING, per pnl-1 migration comments):
//   - An absent (account, fiscal_year, period_no, line_code) row in
//     pnl_actuals means "NOT REPORTED" - it never means "$0".
//   - A row with actual = 0 means zero.
//   - The Overview resolver MUST propagate this distinction into the
//     payload: statement rows carry `reported: true|false`, and
//     `actual` is null when reported=false.
//
// kpi_period_status is authoritative for `verified_at`. `closed_at`
// is a RECORD in the table but is DERIVED at read time from the
// fiscal calendar (docs/audits/OVERVIEW_BUILD_ALIGNMENT_2026-08-31.md
// carry-forward): "nothing sets closed_at when a period ends. Derive
// calendar-closed from periods.js at read time; treat kpi_period_
// status.closed_at as a record and an override, not the source."
// Otherwise P9 reads "open" forever after 2026-09-07.

import {
  periodStartISO,
  periodEndISO,
} from "@/app/kpi/labor/lib/periods.js";

const IN_CHUNK = 100;
const PS_DEFAULT = 1000;

function chunk(values, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

// ─── Revenue-line codes ─────────────────────────────────────────────
//
// The Overview reads these for cost + P&L breakdown. Each is used
// both as a revenue source (kpi_budgets, pnl_actuals) and as a P&L
// row on the statement.
export const REVENUE_LINE_CODES = ["2200", "2300", "2400.1", "2400.2", "2600"];

// The five ALSO TRACKED lines (§5.4 item 9 / R-17b). Overview shows
// budget vs actual for each but no verdict pill.
export const ALSO_TRACKED_LINE_CODES = ["5002.1", "5002.5", "5017.3"];

// ─── kpi_period_status reader (per-fiscal-year) ─────────────────────
//
// Returns Map<period_no, { closed_at, verified_at, verified_by,
// source_ref }>. The Overview resolver DERIVES calendar-closed from
// periods.js AND consults this record; verified is authoritative from
// the row.
export async function loadPeriodStatus(supa, fiscalYear = 2026) {
  const q = await supa
    .from("kpi_period_status")
    .select("period_no, closed_at, verified_at, verified_by, source_ref")
    .eq("fiscal_year", fiscalYear)
    .order("period_no");
  if (q.error) return { error: q.error, scope: "kpi_period_status" };
  const out = new Map();
  for (const r of q.data || []) {
    out.set(Number(r.period_no), {
      closed_at: r.closed_at || null,
      verified_at: r.verified_at || null,
      verified_by: r.verified_by || null,
      source_ref: r.source_ref || null,
    });
  }
  return { data: out };
}

// ─── kpi_account_flags reader ───────────────────────────────────────
//
// Returns Map<account_key, { sc_revenue_live, revenue_model, set_at,
// set_by }>.
//
// `revenue_model` (Kevin R-58, 2026-09-03) is one of:
//   'sc_driven'      revenue fluctuates with SC meal counts
//   'management_fee' revenue is contractual and locked
//   'sales_based'    revenue is sales against budget (TXR - TX - V)
// The column was added by docs/migrations/pnl-2-revenue-model.sql.
// If a row has null revenue_model (fresh env before migration seeds),
// callers should fall back to a safe default; see accountRevenueModel
// in the resolver.
export async function loadAccountFlags(supa) {
  // Migration-gated: revenue_model column is added by
  // docs/migrations/pnl-2-revenue-model.sql. Pre-migration we
  // gracefully fall back to a select without the column so the
  // Overview keeps rendering. Post-migration the resolver reads the
  // column value directly. The `accountRevenueModel` helper on the
  // resolver side handles the null-revenue_model row transparently.
  let q = await supa
    .from("kpi_account_flags")
    .select("account_key, sc_revenue_live, revenue_model, set_at, set_by");
  if (q.error) {
    q = await supa
      .from("kpi_account_flags")
      .select("account_key, sc_revenue_live, set_at, set_by");
    if (q.error) return { error: q.error, scope: "kpi_account_flags" };
  }
  const out = new Map();
  for (const r of q.data || []) {
    out.set(r.account_key, {
      sc_revenue_live: !!r.sc_revenue_live,
      revenue_model: r.revenue_model || null,
      set_at: r.set_at || null,
      set_by: r.set_by || null,
    });
  }
  return { data: out };
}

// ─── pnl_actuals reader (per-member, per-period range) ──────────────
//
// Returns a nested Map:
//   Map<account_key, Map<period_no, Map<line_code, { actual, budget,
//                                                    source_ref,
//                                                    verified_at,
//                                                    verified_by }>>>
//
// Absence = not reported. Callers MUST check .has()/.get() and treat
// missing as null in the payload; never substitute 0.
export async function loadPnlActuals(supa, { members, periods, fiscalYear = 2026 }) {
  if (!members || members.length === 0 || !periods || periods.length === 0) {
    return { data: new Map() };
  }
  const out = new Map();
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("pnl_actuals")
        .select("account_key, period_no, line_code, actual, budget, source_ref, verified_at, verified_by")
        .eq("fiscal_year", fiscalYear)
        .in("account_key", memberChunk)
        .in("period_no", periods)
        .order("account_key")
        .order("period_no")
        .order("line_code")
        .range(from, from + PS_DEFAULT - 1);
      if (q.error) return { error: q.error, scope: "pnl_actuals" };
      const rows = q.data || [];
      for (const r of rows) {
        const acct = String(r.account_key);
        const per = Number(r.period_no);
        const line = String(r.line_code);
        if (!out.has(acct)) out.set(acct, new Map());
        const byAcct = out.get(acct);
        if (!byAcct.has(per)) byAcct.set(per, new Map());
        byAcct.get(per).set(line, {
          actual: Number(r.actual),
          budget: r.budget == null ? null : Number(r.budget),
          source_ref: r.source_ref || null,
          verified_at: r.verified_at || null,
          verified_by: r.verified_by || null,
        });
      }
      if (rows.length < PS_DEFAULT) break;
      from += PS_DEFAULT;
    }
  }
  return { data: out };
}

// ─── kpi_budgets reader for revenue + also-tracked lines ────────────
//
// The purchasing loader excludes 3100.1 + 3100.2 (labor). For the
// Overview we need revenue lines (2xxx) + also-tracked (5002.1 /
// 5002.5 / 5017.3). Purchasing already ships buckets_budget /
// tracked_budget via the resolver so cost-line budgets come from
// there; here we read only what the Overview owns directly.
//
// Returns Map<line_code, Map<account_key, Map<period_no, amount>>>.
export async function loadOverviewBudgets(supa, { members, fiscalYear = 2026 }) {
  if (!members || members.length === 0) return { data: new Map() };
  const wanted = new Set([...REVENUE_LINE_CODES, ...ALSO_TRACKED_LINE_CODES, "3100.1", "3100.2"]);
  const out = new Map();
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("kpi_budgets")
        .select("account_key, line_code, period_no, amount")
        .eq("fiscal_year", fiscalYear)
        .in("account_key", memberChunk)
        .order("account_key")
        .order("line_code")
        .order("period_no")
        .range(from, from + PS_DEFAULT - 1);
      if (q.error) return { error: q.error, scope: "kpi_budgets_overview" };
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.line_code);
        if (!wanted.has(gl)) continue;
        const acct = String(r.account_key);
        if (!out.has(gl)) out.set(gl, new Map());
        if (!out.get(gl).has(acct)) out.get(gl).set(acct, new Map());
        out.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
      }
      if (rows.length < PS_DEFAULT) break;
      from += PS_DEFAULT;
    }
  }
  return { data: out };
}

// The ONE function that owns "through when" - "revenue to date and
// budget to date must mean the same day, or every percentage built
// on them lies". Both the sc_daily_revenue reader and the sources-
// line label call this. Prior to 2026-09-02 the sources line was
// capped (visibly) but the reader was not, so on an open period
// the reader summed future service days (Service Calendar carries
// projected counts) - TBJ - FL P9 was summing 26 days of revenue
// against 22 days of budget and reporting 23.3% over pace.
//
// Cap rule: strictly less than today. Today is not closed; a same-
// day count can still shift as the day runs. Falls back to today - 1
// via Date arithmetic. Returns null on null input.
export function capBeforeToday(iso, today) {
  if (!iso) return null;
  if (iso < today) return iso;
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// ─── sc_daily_revenue reader (per-meal accounts, sc_revenue_live=true) ─
//
// Reads sc_daily_revenue for the requested date range, filtered to
// NOT is_non_revenue (per §5.10 binding rules: "NOT is_non_revenue
// on every raw-view read"). Sums actual_revenue per (account,
// service_date) - the caller decides how to bucket into periods.
//
// GUARD: this loader is called ONLY when the caller has already
// verified: (1) the account is per-meal (cost model = at_risk) AND
// (2) kpi_account_flags.sc_revenue_live = true. Fee accounts NEVER
// read this table. The Overview resolver's revenue-source picker
// enforces those preconditions BEFORE calling this function.
// Passing a fee account here is a caller bug - we don't re-check,
// but the resolver's guard does.
//
// UPPER BOUND (Kevin 2026-09-02 blocker): the effective end is
// min(end, today - 1). The Service Calendar carries projected
// counts for future days; without this cap, on an open period the
// reader sums those days and every downstream percentage is off.
// `today` is required so the loader can share the cap with the
// resolver's sources-line label - one function, one truth.
export async function loadScDailyRevenue(supa, { members, start, end, today }) {
  if (!members || members.length === 0) return { data: new Map() };
  // Cap end at today - 1. When today is not passed (legacy caller),
  // fall back to the raw end so behavior is a strict extension.
  // Every current caller in the Overview resolver passes today.
  const effectiveEnd = today ? capBeforeToday(end, today) : end;
  if (!effectiveEnd || effectiveEnd < start) return { data: new Map() };
  const out = new Map();
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("sc_daily_revenue")
        .select("account_key, service_date, service_id, actual_revenue, is_non_revenue")
        .in("account_key", memberChunk)
        .gte("service_date", start)
        .lte("service_date", effectiveEnd)
        .not("is_non_revenue", "is", true)   // §5.10: NOT is_non_revenue always
        // Order chain must uniquely order rows across the 1000-row page
        // boundary. sc_daily_revenue is grained per
        // (account_key, service_id, service_date) - see sc-6b's
        // service_days CTE. Without service_id in the order chain, tie
        // groups of rows sharing (account_key, service_date) reorder
        // freely across pages, dropping or duplicating rows. Same
        // pagination-order defect class as the sentinel probe fix on
        // 2026-08-31 and purchasing #892's .order("id") retraction.
        .order("account_key")
        .order("service_date")
        .order("service_id")
        .range(from, from + PS_DEFAULT - 1);
      if (q.error) return { error: q.error, scope: "sc_daily_revenue" };
      const rows = q.data || [];
      for (const r of rows) {
        const acct = String(r.account_key);
        const day = r.service_date;
        if (!out.has(acct)) out.set(acct, new Map());
        const m = out.get(acct);
        m.set(day, (m.get(day) || 0) + Number(r.actual_revenue || 0));
      }
      if (rows.length < PS_DEFAULT) break;
      from += PS_DEFAULT;
    }
  }
  return { data: out };
}

// ─── Period state resolver (derived + record) ───────────────────────
//
// Combines calendar-derived close (periods.js periodEndISO) with the
// kpi_period_status record for verified_at. See module docblock for
// why the calendar is authoritative for calendar-closed.
//
// Returns 'open' | 'closed_awaiting' | 'verified'.
export function derivePeriodState({ periodNo, todayISO, periodStatusRow }) {
  const pEnd = periodEndISO(periodNo);
  if (!pEnd) return "open";
  const calendarClosed = pEnd < todayISO;
  const verifiedAt = periodStatusRow?.verified_at || null;
  if (verifiedAt) return "verified";
  // Treat kpi_period_status.closed_at as an OVERRIDE that can force
  // closed even before the calendar (rare early-close case). If not
  // set, calendar is authoritative.
  const recordClosed = !!periodStatusRow?.closed_at;
  if (calendarClosed || recordClosed) return "closed_awaiting";
  return "open";
}
