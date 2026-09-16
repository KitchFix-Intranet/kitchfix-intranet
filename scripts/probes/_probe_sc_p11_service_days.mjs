// R-110 report-before-build (Kevin 2026-09-16): count service days
// for TBJ - FL and TBR - FL in P11 (2026-10-05 to 2026-11-01) so the
// third small card ("A service day") uses the real count instead of
// hardcoding 20.
//
// TBJ + TBR are MLB fee-homestand accounts. MLB service days come
// from sc_homestand_schedule (game rows), NOT sc_daily_projections
// (which is per-meal accounts only). Prior probes flagged this at
// _probe_sc_actionable_by_month.mjs.
//
// Method: distinct DATES in sc_homestand_schedule within [start, end]
// for the account, that carry any scheduled service.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(1); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(1); }
console.log("SUPABASE_URL:", "PRESENT");
console.log("SUPABASE_SERVICE_ROLE_KEY:", "PRESENT");

const sb = createClient(url, key);

// Peek at the schema so I don't guess column names.
const peek = await sb.from("sc_homestand_schedule").select("*").limit(2);
if (peek.error) { console.error("peek error:", peek.error.message); process.exit(1); }
console.log("\nsc_homestand_schedule columns:", Object.keys(peek.data[0] || {}));
console.log("sample row:", JSON.stringify(peek.data[0]).slice(0, 300));

// Now count distinct dates in P11 for TBJ + TBR
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const r = await sb.from("sc_homestand_schedule")
    .select("*")
    .eq("account_key", acct)
    .gte("service_date", "2026-10-05")
    .lte("service_date", "2026-11-01");
  if (r.error) { console.log(acct, "err:", r.error.message); continue; }
  const rows = r.data || [];
  const distinctDates = new Set(rows.map(x => x.service_date));
  console.log(`\n${acct} · P11 · rows: ${rows.length} · distinct dates: ${distinctDates.size}`);
  if (rows.length > 0) console.log("  first row keys:", Object.keys(rows[0]).join(", "));
  console.log("  dates:", [...distinctDates].sort().join(", "));
}

// Also check sc_daily_projections - per-meal accounts and off-season
// data may live there. And check any other schedule-ish tables.
console.log("\n=== sc_daily_projections check ===");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const r = await sb.from("sc_daily_projections")
    .select("service_date, projected_count, has_projection, has_actuals")
    .eq("account_key", acct)
    .gte("service_date", "2026-10-05")
    .lte("service_date", "2026-11-01");
  if (r.error) { console.log(acct, "err:", r.error.message); continue; }
  const rows = r.data || [];
  const distinctDates = new Set(rows.map(x => x.service_date));
  const daysWithProj = new Set(rows.filter(x => Number(x.projected_count || 0) > 0).map(x => x.service_date));
  console.log(`${acct} · P11 · rows: ${rows.length} · distinct dates: ${distinctDates.size} · days with non-zero projection: ${daysWithProj.size}`);
  if (rows.length > 0) {
    const sampleDates = [...distinctDates].sort().slice(0, 5);
    console.log("  first dates:", sampleDates.join(", "));
  }
}

// Check the sc_daily_revenue (service-grained) for context
console.log("\n=== sc_daily_revenue check ===");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const r = await sb.from("sc_daily_revenue")
    .select("service_date, projected_count, has_projection, has_actuals")
    .eq("account_key", acct)
    .gte("service_date", "2026-10-05")
    .lte("service_date", "2026-11-01");
  if (r.error) { console.log(acct, "err:", r.error.message); continue; }
  const rows = r.data || [];
  const distinctDates = new Set(rows.map(x => x.service_date));
  const daysWithProj = new Set(rows.filter(x => Number(x.projected_count || 0) > 0).map(x => x.service_date));
  console.log(`${acct} · P11 · rows: ${rows.length} · distinct dates: ${distinctDates.size} · days with non-zero projection: ${daysWithProj.size}`);
  if (rows.length > 0) {
    const sampleDates = [...distinctDates].sort().slice(0, 5);
    console.log("  first dates:", sampleDates.join(", "));
  }
}
