// /api/kpi/labor
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS (six-person leadership
// list per D30, ruled 2026-08-10). Serves the /kpi/labor surface. Never
// calls Rippling; reads labor_actuals_latest + labor_unattributed +
// rippling_raw_workers_latest + rippling_walks + earning_type_unmapped +
// sc_day_metadata (for account_periods).
//
// PR C3 additions:
//   - Worker name resolver returns null when no canonical name field
//     exists on the ingested payload (the current state; Rippling's
//     /workers endpoint does not carry user.name). No email mangling.
//     Consumers render `#N` when name is null.
//   - `title` (job title) included in worker meta for display context.
//   - `account_periods` in response: fiscal-year period boundaries from
//     sc_day_metadata for the requested account. Powers client-side
//     "this period" / "last period" presets.
//
// Error paths return sanitized messages, never raw PostgREST error text.
//
// Query params:
//   account   accounts.team_key (required)
//   start     YYYY-MM-DD (defaults to fiscal-year start)
//   end       YYYY-MM-DD (defaults to today)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);

function safeError(scope, err) {
  console.error(`[kpi/labor] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

// Canonical name resolver. Rippling's /workers endpoint does NOT carry a
// name field today (user is null; there is no full_name, first_name, etc.
// on the payload). Return null if no canonical field is populated so the
// UI renders `#N` honestly - a mangled email-derived guess is worse than
// a number (produced "Treestonebuisness", "Drewchrostowski1", etc. in a
// prior attempt).
function resolveWorkerName(payload) {
  const p = payload || {};
  const candidates = [
    p.full_name,
    p.name,
    p.legal_name,
    p.preferred_name,
    p.display_name,
    p.user?.name,
    p.user?.full_name,
    p.person?.full_name,
    p.person?.name,
    (p.first_name && p.last_name) ? `${p.first_name} ${p.last_name}` : null,
    (p.user?.first_name && p.user?.last_name) ? `${p.user.first_name} ${p.user.last_name}` : null,
  ];
  for (const c of candidates) {
    if (c && String(c).trim().length > 0) return String(c).trim();
  }
  return null;
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
  if (workerIds.length > 0) {
    const w = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", workerIds);
    if (!w.error) {
      for (const r of w.data || []) {
        const p = r.payload || {};
        const name = resolveWorkerName(p);
        if (name) resolvedNames++;
        workerMeta[p.id] = {
          worker_id: p.id,
          number: p.number ?? null,
          display_name: name,                        // null when unresolvable
          title: p.title || null,
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
      reason: resolvedNames === 0
        ? "no_canonical_name_field_in_workers_payload"
        : "canonical_field_present",
    },
  });
}
