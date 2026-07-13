#!/usr/bin/env node
// Read-only probe suite for docs/design/PRINT_DATA_CENSUS.md.
// Every finding echoed to stdout with headings and code-block-safe
// exact strings so the census can quote directly. No writes.
//
// Usage: TSX_TSCONFIG_PATH=./jsconfig.json npx tsx --env-file=.env.local \
//   scripts/sc-print/census-probe.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const H = (t) => console.log(`\n=== ${t} ===`);
const line = (...a) => console.log(a.join(" "));

// ── Part A — accounts census ─────────────────────────────────────────
H("A. accounts census (all 11 accounts, all columns print reads)");
{
  const { data, error } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay, active")
    .order("team_key", { ascending: true });
  if (error) throw error;
  for (const a of data) {
    line("--", JSON.stringify(a));
  }
}

// ── Part B — service-name inventory per account ─────────────────────
H("B. service inventory per account (distinct service_name via sc_daily_revenue)");
{
  // Grab a 45-day window per account so we cover typical operating
  // range without pulling the whole year.
  const accountsRes = await supa.from("accounts").select("team_key").order("team_key");
  const accounts = accountsRes.data.map(r => r.team_key);
  const results = {};
  for (const key of accounts) {
    const { data, error } = await supa
      .from("sc_daily_revenue")
      .select("service_name, service_id, is_flat_fee, is_tax_free, is_non_revenue, projected_count, actual_count")
      .eq("account_key", key)
      .gte("service_date", "2026-05-01")
      .lte("service_date", "2026-06-15")
      .limit(2000);
    if (error) { console.error(key, error); continue; }
    const bucket = new Map();
    let maxProj = 0, maxAct = 0;
    for (const r of data || []) {
      const k = r.service_name || "(null)";
      if (!bucket.has(k)) bucket.set(k, {
        service_name: r.service_name, is_flat_fee: r.is_flat_fee,
        is_tax_free: r.is_tax_free, is_non_revenue: r.is_non_revenue,
        len: (r.service_name || "").length,
      });
      if (r.projected_count != null) maxProj = Math.max(maxProj, Number(r.projected_count) || 0);
      if (r.actual_count    != null) maxAct  = Math.max(maxAct,  Number(r.actual_count)    || 0);
    }
    results[key] = { names: [...bucket.values()].sort((a,b)=>a.service_name.localeCompare(b.service_name)), maxProj, maxAct };
  }
  let longestName = { name: "", len: 0, key: "" };
  for (const [k, r] of Object.entries(results)) {
    line(`\n[${k}] maxProjectedCount=${r.maxProj} maxActualCount=${r.maxAct}`);
    for (const n of r.names) {
      line("  ", JSON.stringify(n));
      if (n.len > longestName.len) longestName = { name: n.service_name, len: n.len, key: k };
    }
  }
  line(`\nLONGEST NAME IN SYSTEM: "${longestName.name}" (${longestName.len} chars) — account=${longestName.key}`);
}

// ── Part C — actuals + projection horizon per account ────────────────
H("C. actuals + projection horizon per account (data availability)");
{
  const accountsRes = await supa.from("accounts").select("team_key").order("team_key");
  const accounts = accountsRes.data.map(r => r.team_key);
  for (const key of accounts) {
    const { data: actualsRes } = await supa
      .from("sc_daily_actuals")
      .select("service_date")
      .eq("account_key", key)
      .gte("service_date", "2026-01-01")
      .lte("service_date", "2026-12-31")
      .order("service_date", { ascending: false })
      .limit(1);
    const { data: projRes } = await supa
      .from("sc_daily_projections")
      .select("service_date")
      .eq("account_key", key)
      .gte("service_date", "2026-01-01")
      .lte("service_date", "2026-12-31")
      .order("service_date", { ascending: false })
      .limit(1);
    line(`[${key}] maxActualsDate=${actualsRes?.[0]?.service_date || "(none)"} maxProjectionDate=${projRes?.[0]?.service_date || "(none)"}`);
  }
}

// ── Part D — game/homestand data shape ──────────────────────────────
H("D. sc_homestand_schedule sample per representative account");
{
  for (const key of ["CIN - OH", "CIN - KY", "STL - FL", "TBJ - FL", "TBJ - NY"]) {
    const { data } = await supa
      .from("sc_homestand_schedule")
      .select("service_date, day_of_week, day_type, opponent, game_time, day_night, is_doubleheader, homestand_id, game_pk")
      .eq("account_key", key)
      .gte("service_date", "2026-06-01")
      .lte("service_date", "2026-07-15")
      .order("service_date", { ascending: true })
      .limit(20);
    line(`\n[${key}] sc_homestand_schedule rows (Jun 1 - Jul 15 2026):`);
    if (!data || data.length === 0) { line("  (none)"); continue; }
    for (const r of data) line("  ", JSON.stringify(r));
  }
}

H("D2. day_type ENUM distribution across all accounts (Jun–Sep 2026)");
{
  const { data } = await supa
    .from("sc_homestand_schedule")
    .select("account_key, day_type")
    .gte("service_date", "2026-06-01")
    .lte("service_date", "2026-09-30");
  const counts = {};
  for (const r of data || []) {
    const k = `${r.account_key}|${r.day_type}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort();
  for (const [k, n] of sorted) line(`  ${k} = ${n}`);
  const distinctDayTypes = [...new Set((data || []).map(r => r.day_type))];
  line(`\nDistinct day_type values seen: ${JSON.stringify(distinctDayTypes)}`);
}

// ── Part E — year-scope API payload shape for CIN - OH ──────────────
H("E. accounts row exactly as read by the print's account query (CIN - OH)");
{
  const { data } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", "CIN - OH")
    .maybeSingle();
  line("CIN - OH accounts row:", JSON.stringify(data, null, 2));
}

// ── Part F — day.status enumeration ─────────────────────────────────
H("F. loadMonthData results per representative account+month (status distribution)");
{
  const { loadMonthData } = await import("../../src/lib/dataStore/serviceCalendar.js");
  const cases = [
    ["CIN - OH", 2026, 7], ["CIN - KY", 2026, 7],
    ["STL - FL", 2026, 3], ["STL - FL", 2026, 7],
    ["TBJ - FL", 2026, 7], ["TBJ - FL", 2026, 8],
    ["CIN - AZ", 2026, 2], ["CIN - AZ", 2026, 7],
  ];
  const distinctStatuses = new Set();
  for (const [key, y, m] of cases) {
    try {
      const r = await loadMonthData(key, y, m);
      const dist = {};
      for (const d of r.days || []) {
        dist[d.status] = (dist[d.status] || 0) + 1;
        distinctStatuses.add(d.status);
      }
      line(`[${key} ${y}-${String(m).padStart(2,"0")}] days=${(r.days||[]).length} status=${JSON.stringify(dist)}`);
    } catch (err) {
      line(`[${key} ${y}-${String(m).padStart(2,"0")}] ERR ${err.message}`);
    }
  }
  line(`\nDistinct day.status values observed: ${JSON.stringify([...distinctStatuses].sort())}`);
}

H("F2. TBJ - FL specific: full month day-by-day for Jul + Aug + Sep 2026");
{
  const { loadMonthData } = await import("../../src/lib/dataStore/serviceCalendar.js");
  for (const m of [7, 8, 9]) {
    try {
      const r = await loadMonthData("TBJ - FL", 2026, m);
      const days = r.days || [];
      line(`\n[TBJ - FL 2026-${String(m).padStart(2,"0")}] days returned: ${days.length}`);
      // show shape for each day
      for (const d of days.slice(0, 3)) {
        line("  sample day:", JSON.stringify({
          date: d.date, status: d.status,
          hasActuals: d.hasActuals, hasProjection: d.hasProjection,
          dayType: d.dayType, opponent: d.opponent,
          serviceCount: (d.services || []).length,
        }));
      }
      const byStatus = {};
      for (const d of days) byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      line("  status counts:", JSON.stringify(byStatus));
    } catch (err) {
      line(`[TBJ - FL 2026-${String(m).padStart(2,"0")}] ERR ${err.message}`);
    }
  }
}

H("F3. Direct classify on TBJ - FL Jul 15 / Aug 1 / Sep 1");
{
  const { loadMonthData } = await import("../../src/lib/dataStore/serviceCalendar.js");
  const targets = ["2026-07-15", "2026-08-01", "2026-09-01"];
  for (const iso of targets) {
    const [y, m] = iso.split("-").map(Number);
    const r = await loadMonthData("TBJ - FL", y, m);
    const d = (r.days || []).find(x => x.date === iso);
    line(`[TBJ - FL ${iso}] ${d ? JSON.stringify({
      status: d.status, hasActuals: d.hasActuals, hasProjection: d.hasProjection,
      services: (d.services || []).map(s => ({ name: s.serviceName, act: s.actualCount, proj: s.projectedCount })),
    }) : "(day not present in loadMonthData response)"}`);
  }
}

// ── Part I — bonus: sample service row for MLB accounts + PDC ────────
H("I. billing_model + level + schedule flags for every account (single table for the census)");
{
  const { data } = await supa
    .from("accounts")
    .select("team_key, level, billing_model, has_homestand_schedule, has_schedule_overlay, active")
    .order("team_key");
  for (const a of data) {
    line(JSON.stringify(a));
  }
}

// ── Bonus: does the /api/service-calendar?action=sc-load API include
// hasHomestandSchedule / hasScheduleOverlay on account? Trace the route.
H("J. sc-load account object shape (built in src/app/api/service-calendar/route.js)");
{
  // Direct simulation of the shape the route builds.
  const { data } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay")
    .eq("team_key", "CIN - OH")
    .maybeSingle();
  const category = data?.level;   // levelToCategory in the route flattens PDC/MLB/etc
  const simulated = {
    key: data.team_key,
    category,
    name: data.name || data.team_key,
    billingModel: data.billing_model || null,
    hasScheduleOverlay: !!data.has_schedule_overlay,
    // NOTE: the route emits hasScheduleOverlay but the sc-load response
    // does NOT emit hasHomestandSchedule (verified by grep of route.js).
    spreadsheetId: "",
  };
  line("simulated sc-load account payload:", JSON.stringify(simulated, null, 2));
}

console.log("\n=== END OF PROBE ===");
