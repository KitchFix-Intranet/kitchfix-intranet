// /api/kpi/labor
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS (six-person leadership
// list per D30, ruled 2026-08-10). Serves the /kpi/labor surface. Never
// calls Rippling; reads labor_actuals_latest + labor_unattributed +
// rippling_raw_workers_latest + rippling_walks + earning_type_unmapped.
//
// PR B2 rewrite - the two-column shape from #635 is retired. This route
// returns the full labor_actuals column set (four hour buckets + four
// dollar buckets + amount + hours_without_dollars + coverage_state +
// week metadata) required by the page.
//
// Error paths return sanitized messages, never raw PostgREST error text
// (which leaks table names and column details to the client).
//
// Query params:
//   account   accounts.team_key (defaults to first hourly-eligible account)
//   start     YYYY-MM-DD (defaults to fiscal-year start)
//   end       YYYY-MM-DD (defaults to today)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";

// D26 salaried-only accounts have no hourly labor pipeline.
const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
// D17 out of scope.
const D17_OUT_OF_SCOPE = new Set(["CORP"]);

function safeError(scope, err) {
  // Sanitized error - the client sees a category and a scope, never the
  // raw PostgREST message which leaks column names, table names, and
  // sometimes hints about the query shape.
  console.error(`[kpi/labor] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

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
  const start = searchParams.get("start") || "2025-12-29";  // FY2026 opens
  const end = searchParams.get("end") || today;

  if (!account) {
    return NextResponse.json({ error: "account_required", detail: "?account=<team_key> is required" }, { status: 400 });
  }
  if (D17_OUT_OF_SCOPE.has(account)) {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }

  const supa = getServiceClient();

  // ── Salaried-only account: return an explanatory state, not empty data ──
  if (D26_SALARIED_ONLY.has(account)) {
    return NextResponse.json({
      ok: true,
      filters: { account, start, end },
      account_state: "salaried_only",
      account_state_message: `${account} is a single-employee salaried account (D26). 3100.1 hourly labor is not applicable.`,
      actuals: [],
      unattributed: [],
      workers: {},
      derive_freshness: null,
      unmapped_names: [],
    });
  }

  // ── labor_actuals for this account in range ──
  const actuals = await supa
    .from("labor_actuals_latest")
    .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at, source_run")
    .eq("account_key", account)
    .lte("week_start", end)
    .gte("week_end", start)
    .order("week_start", { ascending: true })
    .order("worker_id",  { ascending: true });
  if (actuals.error) return NextResponse.json(safeError("labor_actuals", actuals.error), { status: 500 });

  // ── unattributed rows (portfolio-wide by design; filter to this account) ──
  const unattr = await supa
    .from("labor_unattributed")
    .select("reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes")
    .order("amount", { ascending: false });
  if (unattr.error) return NextResponse.json(safeError("labor_unattributed", unattr.error), { status: 500 });

  // ── worker names ──
  const workerIds = [...new Set(actuals.data.map(r => r.worker_id))];
  const workerMeta = {};
  if (workerIds.length > 0) {
    const w = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", workerIds);
    if (!w.error) {
      for (const r of w.data || []) {
        const p = r.payload || {};
        const email = p.work_email || "";
        const nameFromEmail = email ? email.split("@")[0].replace(/[._]/g, " ") : "";
        workerMeta[p.id] = {
          worker_id: p.id,
          work_email: email,
          display_name: nameFromEmail || `worker-${String(p.id).slice(0, 8)}`,
          number: p.number,
          status: p.status,
          title: p.title,
        };
      }
    }
  }

  // ── freshness: last successful pay_segments walk ──
  const psWalk = await supa
    .from("rippling_walks")
    .select("completed_at, ids_seen")
    .eq("kind", "pay_segments")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const derive_freshness = {
    last_walk_at: psWalk.data?.completed_at || null,
    last_walk_ids_seen: psWalk.data?.ids_seen || null,
    last_derive_at: actuals.data[0]?.derived_at || null,
  };

  // ── unmapped earning types (D37 loud-visibility surface) ──
  const unmapped = await supa
    .from("earning_type_unmapped")
    .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
    .is("resolved_at", null)
    .order("total_amount", { ascending: false });

  return NextResponse.json({
    ok: true,
    filters: { account, start, end },
    account_state: "hourly_ok",
    actuals: actuals.data,
    unattributed: unattr.data.filter(u => {
      // Include only unattributed rows relevant to this account's context.
      // Since labor_unattributed doesn't carry account_key (those rows
      // didn't attribute to an account by definition), show all portfolio
      // orphans so operators see the D36 orphan signal.
      return true;
    }),
    workers: workerMeta,
    derive_freshness,
    unmapped_names: unmapped.data || [],
  });
}
