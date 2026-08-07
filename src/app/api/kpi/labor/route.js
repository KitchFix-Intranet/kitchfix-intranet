// /api/kpi/labor
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS (matches existing
// pattern). Serves the /kpi/labor page. Never calls Rippling - reads
// labor_actuals_latest + labor_unattributed + rippling_raw_workers_latest.
//
// Kevin's note (2026-08-06): "we can gate the data later with a data
// lock. For now I am the only one using this information." Employee-
// level pay data behind an admin gate is acceptable for a single-user
// instrument. It is NOT acceptable once anyone else has the URL.
//
// Query params:
//   account   'all' or an accounts.team_key (defaults 'all')
//   start     YYYY-MM-DD (defaults to Monday of current week)
//   end       YYYY-MM-DD (defaults to Sunday of current week)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { getServiceClient } from "@/lib/supabase";

function isoMondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum);
  return d.toISOString().slice(0, 10);
}
function isoSundayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 6);
  return d.toISOString().slice(0, 10);
}

export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account") || "all";
  const today = new Date().toISOString().slice(0, 10);
  const start = searchParams.get("start") || isoMondayOfWeek(today);
  const end = searchParams.get("end") || isoSundayOfWeek(today);

  const supa = getServiceClient();

  // labor_actuals rows overlapping the [start, end] range
  let q = supa
    .from("labor_actuals_latest")
    .select("account_key, worker_id, week_label, week_start, week_end, fiscal_year, period_no, line_code, amount, hours_regular, hours_overtime, segment_count, entry_count, approval_state, week_source, derived_at")
    .lte("week_start", end)
    .gte("week_end", start)
    .order("week_start", { ascending: true });
  if (account !== "all") q = q.eq("account_key", account);
  const actuals = await q;
  if (actuals.error) return NextResponse.json({ error: actuals.error.message }, { status: 500 });

  // unattributed rows in the range
  let uq = supa
    .from("labor_unattributed")
    .select("*")
    .gte("segment_date", start)
    .lte("segment_date", end)
    .order("derived_at", { ascending: false });
  const unattr = await uq;
  if (unattr.error) return NextResponse.json({ error: unattr.error.message }, { status: 500 });

  // Worker name lookup - only for workers that appear in the results
  const workerIds = new Set(actuals.data.map(r => r.worker_id));
  const workerMeta = {};
  if (workerIds.size > 0) {
    const w = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", [...workerIds]);
    if (!w.error) {
      for (const r of w.data || []) {
        const p = r.payload || {};
        // Rippling API returns first_name/last_name (fetched via user object)
        // but on the workers endpoint they may be null - fall back to
        // work_email prefix if names are missing.
        const email = p.work_email || "";
        const nameFromEmail = email ? email.split("@")[0].replace(/[._]/g, " ") : "";
        workerMeta[p.id] = {
          worker_id: p.id,
          work_email: email,
          display_name: nameFromEmail || `worker-${String(p.id).slice(0, 8)}`,
          status: p.status,
          title: p.title,
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    filters: { account, start, end },
    actuals: actuals.data,
    unattributed: unattr.data,
    workers: workerMeta,
    derived_at: actuals.data[0]?.derived_at || null,
  });
}
