#!/usr/bin/env node
// Kevin ask 2026-09-04: how far ahead are Service Calendar counts
// confirmed today? For TBJ - FL and TBR - FL, week by week across
// P9 and P10.
//
// v2 - reads sc_daily_revenue view (the authoritative KPI-side
// projection of both grains) rather than the raw tables, because
// the raw sc_daily_actuals table can hold placeholder rows for
// scheduled service days that don't yet carry a count. The view's
// has_actuals + has_projection booleans are the honest signal for
// "count is entered" vs "count is planned only".
//
// Per row the view exposes:
//   projected_count · projected_revenue
//   actual_count    · actual_revenue
//   has_actuals     (true iff actual_count is populated)
//   has_projection  (true iff projected_count is populated)
//
// A day is "confirmed" when at least one service on that day has
// has_actuals=true. A day is "projected only" when every service
// on that day has_projection=true and has_actuals=false. A day is
// "empty" when neither grain fires (no service scheduled).
//
// Probe only. No build.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ACCOUNTS = ["TBJ - FL", "TBR - FL"];
const WEEKS = [
  { period: 9,  wk: 1, start: "2026-08-10", end: "2026-08-16" },
  { period: 9,  wk: 2, start: "2026-08-17", end: "2026-08-23" },
  { period: 9,  wk: 3, start: "2026-08-24", end: "2026-08-30" },
  { period: 9,  wk: 4, start: "2026-08-31", end: "2026-09-06" },
  { period: 10, wk: 1, start: "2026-09-07", end: "2026-09-13" },
  { period: 10, wk: 2, start: "2026-09-14", end: "2026-09-20" },
  { period: 10, wk: 3, start: "2026-09-21", end: "2026-09-27" },
  { period: 10, wk: 4, start: "2026-09-28", end: "2026-10-04" },
];

const TODAY = "2026-09-04";

async function pullDailyRevenue(account, start, end) {
  const q = await supa
    .from("sc_daily_revenue")
    .select("service_date, service_id, service_name, actual_count, projected_count, actual_revenue, projected_revenue, has_actuals, has_projection, is_non_revenue")
    .eq("account_key", account)
    .gte("service_date", start)
    .lte("service_date", end)
    .not("is_non_revenue", "is", true)
    .order("service_date")
    .order("service_id");
  if (q.error) return { error: q.error };
  return { rows: q.data || [] };
}

console.log(`# SC calendar confirmation horizon  ·  today = ${TODAY}\n`);
console.log("Read surface: sc_daily_revenue (view), NOT is_non_revenue.\n");
console.log("Per day: confirmed = any service on that day has_actuals; projected = every service has_projection only; empty = no service scheduled.");
console.log("Per-day revenue: actual_revenue when has_actuals, else projected_revenue.\n");

for (const account of ACCOUNTS) {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`${account}\n`);
  console.log("| period | wk | dates | days confirmed | confirmed $ | days projected only | projected $ | days empty | days past today |");
  console.log("|---|---:|---|---:|---:|---:|---:|---:|---:|");
  for (const w of WEEKS) {
    const res = await pullDailyRevenue(account, w.start, w.end);
    if (res.error) { console.log(`| P${w.period} | ${w.wk} | ERR ${res.error.message} |||||||`); continue; }

    // Group by service_date
    const byDate = new Map();
    for (const r of res.rows) {
      const d = r.service_date;
      const dayEntry = byDate.get(d) || { services: [], hasAnyActual: false, hasAnyProjection: false, actualRev: 0, projectedRev: 0 };
      dayEntry.services.push(r);
      if (r.has_actuals) dayEntry.hasAnyActual = true;
      if (r.has_projection) dayEntry.hasAnyProjection = true;
      dayEntry.actualRev += Number(r.actual_revenue || 0);
      dayEntry.projectedRev += Number(r.projected_revenue || 0);
      byDate.set(d, dayEntry);
    }

    // Iterate every calendar day in the week window
    const allDaysInRange = [];
    {
      const d0 = new Date(w.start + "T00:00:00Z");
      for (let i = 0; i < 7; i++) {
        const d = new Date(d0);
        d.setUTCDate(d0.getUTCDate() + i);
        allDaysInRange.push(d.toISOString().slice(0, 10));
      }
    }

    let daysConfirmed = 0, daysProjectedOnly = 0, daysEmpty = 0;
    let confirmedRev = 0, projectedRev = 0;
    let daysPastToday = 0;
    for (const d of allDaysInRange) {
      const entry = byDate.get(d);
      const isPast = d < TODAY;
      if (isPast) daysPastToday++;
      if (!entry) {
        daysEmpty++;
      } else if (entry.hasAnyActual) {
        daysConfirmed++;
        confirmedRev += entry.actualRev;
      } else if (entry.hasAnyProjection) {
        daysProjectedOnly++;
        projectedRev += entry.projectedRev;
      } else {
        daysEmpty++;
      }
    }

    const dateRange = `${w.start.slice(5)} – ${w.end.slice(5)}`;
    console.log(`| P${w.period} | ${w.wk} | ${dateRange} | ${daysConfirmed} | $${confirmedRev.toFixed(0)} | ${daysProjectedOnly} | $${projectedRev.toFixed(0)} | ${daysEmpty} | ${daysPastToday} |`);
  }
}

// Also: what fraction of a period's revenue is "confirmed" vs
// "projected only" per week - useful for the design conversation.
console.log(`\n\n## Roll-up: per-period week-by-week revenue mix\n`);
console.log("Kevin's framing: a week with confirmed counts has a real budget derived from that week's revenue; a week without them falls back to plan.");
console.log("Shows how far ahead confirmation actually reaches, per account.\n");
for (const account of ACCOUNTS) {
  console.log(`\n### ${account}`);
  console.log("");
  const periodTotals = new Map();
  for (const w of WEEKS) {
    const res = await pullDailyRevenue(account, w.start, w.end);
    if (res.error) continue;
    const byDate = new Map();
    for (const r of res.rows) {
      const d = r.service_date;
      const dayEntry = byDate.get(d) || { hasAnyActual: false, actualRev: 0, projectedRev: 0 };
      if (r.has_actuals) dayEntry.hasAnyActual = true;
      dayEntry.actualRev += Number(r.actual_revenue || 0);
      dayEntry.projectedRev += Number(r.projected_revenue || 0);
      byDate.set(d, dayEntry);
    }
    let cRev = 0, pRev = 0;
    for (const [d, e] of byDate.entries()) {
      if (e.hasAnyActual) cRev += e.actualRev;
      else pRev += e.projectedRev;
    }
    const key = `P${w.period}`;
    const pt = periodTotals.get(key) || { confirmed: 0, projected: 0 };
    pt.confirmed += cRev;
    pt.projected += pRev;
    periodTotals.set(key, pt);
    console.log(`  P${w.period} W${w.wk}: confirmed $${cRev.toFixed(0)} · projected-only $${pRev.toFixed(0)} · total $${(cRev + pRev).toFixed(0)}`);
  }
  for (const [k, v] of periodTotals) {
    const tot = v.confirmed + v.projected;
    const pctConf = tot > 0 ? (v.confirmed / tot * 100).toFixed(1) : "0.0";
    console.log(`  ${k} total: confirmed $${v.confirmed.toFixed(0)} (${pctConf}%) · projected $${v.projected.toFixed(0)}`);
  }
}
