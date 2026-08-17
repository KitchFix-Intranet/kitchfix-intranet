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
import { REGIONAL_DIRECTORS } from "@/lib/incidentSchema";
import { buildBoard, buildWeekBudgets, buildAggregateWeekBudgets } from "@/app/kpi/labor/lib/board.js";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// v6 PR-1 - reserved uppercase pseudo-account keys per V6-19. Chosen
// to collide with nothing the account regex admits (which requires
// spaced hyphens in the middle). URL: ?account=ALL / EAST / WEST.
const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
// Playbook 4.6 - envelope accounts are excluded from static aggregate
// budgets (their variance is against the adjusted envelope in SC,
// never against the original budget).
const V6_ENVELOPE_ACCOUNTS = new Set(["TXR - TX - V"]);
const V6_PAGE_DEFAULT = 1000;   // PostgREST default response cap

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
    .select("team_key, region, name, city, state")
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
      salaried: salaried.has(r.team_key),
    })),
  };
}

// Paginate through a labor_actuals_latest filter, .range() loop,
// deterministic ordering, single flat array return.
async function paginateActuals(supa, { members, start, end, pageSize }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, week_source, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at, source_run")
      .in("account_key", members)
      .lte("week_start", end)
      .gte("week_end", start)
      .order("week_start", { ascending: true })
      .order("account_key", { ascending: true })
      .order("worker_id", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return { data: out };
}

// Resolve the (member) account's budget_periods per playbook 4.5.
// Returns [] for envelope accounts (caller decides envelope semantics).
// Empty on truly no rows. Never selects 3100.2 or any group total (8.2).
async function resolveMemberBudget(supa, accountKey) {
  if (V6_ENVELOPE_ACCOUNTS.has(accountKey)) return { data: [] };
  const [pnlQ, scQ] = await Promise.all([
    supa
      .from("kpi_budgets")
      .select("period_no, amount")
      .eq("account_key", accountKey)
      .eq("line_code", "3100.1")
      .eq("fiscal_year", 2026),
    supa
      .from("sc_labor_budgets")
      .select("period, hourly_budget, reason")
      .eq("account_key", accountKey)
      .is("superseded_at", null),
  ]);
  if (pnlQ.error) return { error: pnlQ.error, scope: "kpi_budgets_3100_1" };
  if (scQ.error)  return { error: scQ.error,  scope: "sc_labor_budgets" };

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

  const out = [];
  for (let p = 1; p <= 13; p += 1) {
    const sc = scByPeriod.get(p);
    const pnl = pnlByPeriod.get(p);
    if (sc != null && Number.isFinite(sc.amount)) {
      const pnlDiffers = pnl != null && Math.abs(pnl - sc.amount) > 0.01;
      out.push({
        period_no: p,
        amount: Math.round(sc.amount * 100) / 100,
        source: "supersede",
        superseded: pnlDiffers,
        ...(sc.reason ? { reason: sc.reason } : {}),
        ...(pnlDiffers ? { pnl_amount: Math.round(pnl * 100) / 100 } : {}),
      });
    } else if (pnl != null && Number.isFinite(pnl)) {
      out.push({
        period_no: p,
        amount: Math.round(pnl * 100) / 100,
        source: "pnl",
        superseded: false,
      });
    }
    // else: no row - omit.
  }
  return { data: out };
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
  // v6 PR-1 - internal pagination-loop knob for the aggregate probe.
  // Ignored on single-account requests. Never surfaced to the UI.
  const pageSizeParam = parseInt(searchParams.get("_page_size") || "0", 10);

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

  // V6-18/19 - fetch the accounts directory + regional-director
  // display names once per request; every response path (single,
  // aggregate, salaried-only, out-of-scope) carries them so the
  // folio can render regions and RDO eyebrows without a second
  // network call.
  const dirQ = await fetchAccountsDirectory(supa);
  if (dirQ.error) return NextResponse.json(safeError("accounts_directory", dirQ.error), { status: 500 });
  const accounts_directory = dirQ.data;
  const regional_directors_display = {
    East: rdoDisplayName(REGIONAL_DIRECTORS.East),
    West: rdoDisplayName(REGIONAL_DIRECTORS.West),
  };

  // ── v6 PR-1 · aggregate pseudo-keys (ALL / EAST / WEST) ──────────
  // Resolves members from live accounts.region, aggregates actuals,
  // budgets, workers, and unattributed across the member set. Salaried
  // members participate (they contribute no hourly rows). CORP is
  // excluded universally per D17. Single-account requests fall
  // through to the byte-identical existing path below.
  if (V6_PSEUDO_KEYS.has(account)) {
    // 1. Resolve members from live accounts.region.
    let memberQ;
    if (account === "ALL") {
      memberQ = await supa.from("accounts")
        .select("team_key")
        .neq("team_key", "CORP")
        .order("team_key");
    } else {
      // Region values in PG are capitalized ('East' / 'West').
      const regionValue = account === "EAST" ? "East" : "West";
      memberQ = await supa.from("accounts")
        .select("team_key")
        .neq("team_key", "CORP")
        .eq("region", regionValue)
        .order("team_key");
    }
    if (memberQ.error) return NextResponse.json(safeError("v6_members", memberQ.error), { status: 500 });
    const members = (memberQ.data || []).map(r => r.team_key);
    if (members.length === 0) {
      return NextResponse.json({ error: "no_members_in_region", account }, { status: 400 });
    }

    // 2. Actuals - paginated union across members.
    const aQ = await paginateActuals(supa, { members, start, end, pageSize: pageSizeParam });
    if (aQ.error) return NextResponse.json(safeError("labor_actuals_aggregate", aQ.error), { status: 500 });
    const actualsRows = aQ.data;

    // 3. Workers - union by rippling_id (collisions = same person).
    const workerIds = [...new Set(actualsRows.map(r => r.worker_id))];
    const workerMeta = {};
    let resolvedNames = 0;
    let usersReachable = false;
    if (workerIds.length > 0) {
      const w = await supa.from("rippling_raw_workers_latest").select("payload").in("rippling_id", workerIds);
      if (!w.error) {
        const userIds = [...new Set((w.data || []).map(r => r.payload?.user_id).filter(Boolean))];
        const userByRipplingId = new Map();
        if (userIds.length > 0) {
          const u = await supa.from("rippling_raw_users_latest").select("rippling_id, payload").in("rippling_id", userIds);
          if (!u.error) {
            usersReachable = true;
            for (const r of u.data || []) userByRipplingId.set(r.rippling_id, r.payload || {});
          }
        }
        for (const r of w.data || []) {
          const p = r.payload || {};
          const userPayload = p.user_id ? userByRipplingId.get(p.user_id) : null;
          const title = p.title ? String(p.title).trim() : null;
          const name = resolveWorkerName(p, userPayload);
          if (name) resolvedNames++;
          workerMeta[p.id] = {
            worker_id: p.id,
            number: p.number ?? null,
            display_name: name,
            title,
            status: p.status || null,
          };
        }
      }
    }

    // 4. account_periods - fiscal calendar is universal across accounts;
    // use the first member as the canonical source (any account would
    // yield the same period boundaries).
    const canonAcct = members[0];
    const periodDays = await supa.from("sc_day_metadata")
      .select("service_date, period")
      .eq("account_key", canonAcct)
      .gte("service_date", "2025-12-29")
      .lte("service_date", "2026-12-27")
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

    // 5. unattributed / unmapped - global, unchanged.
    const [unattr, unmapped] = await Promise.all([
      supa.from("labor_unattributed")
        .select("reason_code, department_id, worker_id, amount, hours, segment_count, first_seen_date, last_seen_date, derived_at, notes")
        .order("amount", { ascending: false }),
      supa.from("earning_type_unmapped")
        .select("merged_earning_type_name, occurrence_count, total_hours, total_amount, first_seen_at, last_seen_at, resolved_at")
        .is("resolved_at", null)
        .order("total_amount", { ascending: false }),
    ]);
    if (unattr.error) return NextResponse.json(safeError("labor_unattributed", unattr.error), { status: 500 });

    // 6. Aggregate budget_periods - resolve each member via 4.5, sum
    // per period, exclude envelope accounts (TXR - TX - V). Any
    // superseded member period marks the aggregate period superseded;
    // member_detail carries the per-member breakdown for the drill.
    const memberBudgets = new Map();
    for (const m of members) {
      if (V6_ENVELOPE_ACCOUNTS.has(m)) continue;      // 4.6 - envelope excluded
      const b = await resolveMemberBudget(supa, m);
      if (b.error) return NextResponse.json(safeError(b.scope, b.error), { status: 500 });
      memberBudgets.set(m, b.data);
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

    // V6-20 - envelope exclusion note when V is in scope.
    const envelopeExcluded = members.filter(m => V6_ENVELOPE_ACCOUNTS.has(m));
    const budget_notes = envelopeExcluded.length > 0
      ? { envelope_excluded: envelopeExcluded }
      : {};

    return NextResponse.json({
      ok: true,
      filters: { account, start, end },
      account_state: "hourly_ok",
      actuals: actualsRows,
      unattributed: (unattr.data || []).filter(() => true),
      workers: workerMeta,
      derive_freshness: {
        last_walk_at: freshness.last_walk_at,
        last_walk_ids_seen: freshness.last_walk_ids_seen,
        last_derive_at: actualsRows[0]?.derived_at || null,
      },
      unmapped_names: unmapped.data || [],
      account_periods,
      budget_periods,
      budget_mode: "static",
      budget_notes,
      members,
      accounts_directory,
      regional_directors_display,
      board: buildBoard({
        account, start, end, today,
        actuals: actualsRows,
        budget_periods,
        account_state: "hourly_ok",
      }),
      week_budgets: buildAggregateWeekBudgets({ start, end, member_budgets: memberBudgets }),
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

  // ── kpi-2 · budget_periods + budget_mode ────────────────────────
  // Playbook 4.5 resolution order per period:
  //   1. live sc_labor_budgets row (superseded_at IS NULL) wins as
  //      the SUPERSEDE source; carry its reason. If a kpi_budgets
  //      3100.1 row exists and differs, set superseded: true and
  //      include the P&L figure as pnl_amount for the drill.
  //   2. kpi_budgets 3100.1 amount for that (account, period) is the
  //      P&L source.
  //   3. no row for that period - omit it entirely.
  //
  // Playbook 4.6 - TXR - TX - V is envelope mode. This route ships
  // NO budget_periods for envelope accounts; variance is against
  // the ADJUSTED envelope (Service Calendar), never the original
  // budget.
  //
  // Playbook 8.2 hard rule: this route selects line_code = '3100.1'
  // ONLY. Never 3100.2. Never any 3100-group total. The salary
  // subtraction-attack surface must not open here.
  const budget_mode = account === "TXR - TX - V" ? "envelope" : "static";
  let budget_periods = [];
  if (budget_mode === "static") {
    // Pull all 13 periods for this account from the two sources in
    // parallel. Both queries are small (<= 13 rows each) - no
    // pagination concern.
    const [pnlQ, scQ] = await Promise.all([
      supa
        .from("kpi_budgets")
        .select("period_no, amount")
        .eq("account_key", account)
        .eq("line_code", "3100.1")
        .eq("fiscal_year", 2026),
      supa
        .from("sc_labor_budgets")
        .select("period, hourly_budget, reason")
        .eq("account_key", account)
        .is("superseded_at", null),
    ]);
    if (pnlQ.error) return NextResponse.json(safeError("kpi_budgets_3100_1", pnlQ.error), { status: 500 });
    if (scQ.error)  return NextResponse.json(safeError("sc_labor_budgets", scQ.error),   { status: 500 });

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
          superseded: pnlDiffers,
          ...(sc.reason ? { reason: sc.reason } : {}),
          ...(pnlDiffers ? { pnl_amount: Math.round(pnl * 100) / 100 } : {}),
        });
      } else if (pnl != null && Number.isFinite(pnl)) {
        budget_periods.push({
          period_no: p,
          amount: Math.round(pnl * 100) / 100,
          source: "pnl",
          superseded: false,
        });
      }
      // else: no row - omit.
    }
  }

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
    budget_periods,
    budget_mode,
    accounts_directory,
    regional_directors_display,
    board: buildBoard({
      account, start, end, today,
      actuals: actuals.data,
      budget_periods,
      account_state: budget_mode === "envelope" ? "envelope" : "hourly_ok",
    }),
    week_budgets: buildWeekBudgets({ start, end, budget_periods: budget_mode === "envelope" ? [] : budget_periods }),
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
