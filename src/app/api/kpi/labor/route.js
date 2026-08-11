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
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";
import { resolveWorkerName } from "@/lib/kpi/resolveName";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);

function safeError(scope, err) {
  // Never echo a raw PostgREST error to the client (leaks column
  // names). Never echo a name (PII discipline - the users table
  // touches this route).
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

  if (D26_SALARIED_ONLY.has(account)) {
    return NextResponse.json({
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
      name_availability: { has_names: false, resolved: 0, total: 0, reason: "salaried_only" },
    });
  }

  const actuals = await supa
    .from("labor_actuals_latest")
    .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at, source_run")
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

  const workerIds = [...new Set(actuals.data.map(r => r.worker_id))];
  const workerMeta = {};
  let resolvedNames = 0;
  let usersReachable = false;
  if (workerIds.length > 0) {
    const w = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", workerIds);
    if (!w.error) {
      // Collect user_ids from worker payloads, then batch-fetch users.
      // Users table may be empty if the C5 walk has not run yet; the
      // resolver returns null and the surface falls back to #N + title.
      const userIds = [...new Set((w.data || []).map(r => r.payload?.user_id).filter(Boolean))];
      const userByRipplingId = new Map();
      if (userIds.length > 0) {
        const u = await supa
          .from("rippling_raw_users_latest")
          .select("rippling_id, payload")
          .in("rippling_id", userIds);
        // A missing users table (migration not yet applied) surfaces
        // as an error here. Do not fail the whole route; just skip the
        // join and let the resolver return null. Kevin sees the
        // fraction-resolved signal in the response.
        if (!u.error) {
          usersReachable = true;
          for (const r of u.data || []) userByRipplingId.set(r.rippling_id, r.payload || {});
        }
      }
      for (const r of w.data || []) {
        const p = r.payload || {};
        const uid = p.user_id;
        const userPayload = uid ? userByRipplingId.get(uid) : null;
        // Trim title on ingest (Rippling returns some titles with
        // trailing spaces - "Cook " was showing up in the C4 export).
        const title = p.title ? String(p.title).trim() : null;
        const name = resolveWorkerName(p, userPayload);
        if (name) resolvedNames++;
        workerMeta[p.id] = {
          worker_id: p.id,
          number: p.number ?? null,
          display_name: name,                        // null when unresolvable
          title,
          status: p.status || null,
        };
      }
    }
  }

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
    last_derive_at: actuals.data[0]?.derived_at || null,
  };

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
    unattributed: unattr.data.filter(() => true),
    workers: workerMeta,
    derive_freshness,
    unmapped_names: unmapped.data || [],
    account_periods,
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
  });
}
