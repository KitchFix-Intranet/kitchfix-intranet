// PROBE: list (account, month, actionable-day count, dates) for every
// account × month. Feeds Phase 3-B re-gate 3 surface selection - owner
// and Chat-Claude pick a viable target (2+ actionable-scheduled days
// in the same drill) instead of guessing.
//
//   node --env-file=.env.local scripts/_probe_sc_actionable_by_month.mjs
//
// Definition of "actionable" (aligned with the app's queue predicate at
// ServiceCalendar.js:1199-1202 and DrillRail.js:152-159):
//   has_projection = true AND has_actuals = false AND service_date <= today
//
// This is the DB-side proxy for status ∈ { needs-entry, overdue } - the
// only two statuses the queue exposes. Ring-total's larger population
// (adds `upcoming` future service days) is intentionally OUT of scope
// here; the operator can't save `upcoming` days.
//
// CAVEAT (MLB): fee homestand accounts drive scheduled days from
// sc_homestand_schedule (game rows), not sc_daily_projections. This
// probe's projection-based path may under-report MLB surfaces. If the
// re-gate target is an MLB account, cross-check against
// sc_homestand_schedule (home games between service_date and today
// with no matching sc_daily_actuals row).
//
// Read-only. No writes.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const today = todayISO();
  console.log(`\n=== ACTIONABLE-DAY PROBE (today=${today}) ===\n`);
  console.log("Query: sc_daily_revenue where has_projection AND NOT has_actuals AND service_date <= today\n");

  const { data, error } = await supa
    .from("sc_daily_revenue")
    .select("account_key, service_date, has_projection, has_actuals")
    .eq("has_projection", true)
    .eq("has_actuals", false)
    .lte("service_date", today)
    .order("account_key", { ascending: true })
    .order("service_date", { ascending: true });

  if (error) {
    console.error(`ERROR reading sc_daily_revenue: ${error.message}`);
    process.exit(1);
  }
  if (!data?.length) {
    console.log("(no rows) - every projected past service day is entered.");
    return;
  }

  // Dedupe (account, date) - multiple services on the same day collapse
  // to one actionable date (matches how the app's day-status classifies
  // by date, not by service).
  const seen = new Set();
  const dedup = [];
  for (const r of data) {
    const key = `${r.account_key}::${r.service_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push({ account: r.account_key, date: String(r.service_date).slice(0, 10) });
  }

  // Group by (account, month).
  const groups = new Map();
  for (const r of dedup) {
    const month = r.date.slice(0, 7);
    const gkey = `${r.account}::${month}`;
    if (!groups.has(gkey)) groups.set(gkey, { account: r.account, month, dates: [] });
    groups.get(gkey).dates.push(r.date);
  }

  const list = [...groups.values()].sort((a, b) => {
    if (b.dates.length !== a.dates.length) return b.dates.length - a.dates.length;
    if (a.account !== b.account) return a.account.localeCompare(b.account);
    return a.month.localeCompare(b.month);
  });

  console.log("account         month     count  dates (first 8 shown; ... if more)");
  console.log("-".repeat(96));
  for (const g of list) {
    const shown = g.dates.slice(0, 8).join(",");
    const more = g.dates.length > 8 ? ",..." : "";
    console.log(`${g.account.padEnd(15)} ${g.month}  ${String(g.dates.length).padStart(5)}  ${shown}${more}`);
  }
  console.log(`\n${list.length} (account, month) tuples with 1+ actionable day.`);
  const twoPlus = list.filter(g => g.dates.length >= 2).length;
  console.log(`${twoPlus} with 2+ actionable days (viable re-gate surfaces).`);
}

main().catch(e => { console.error(e); process.exit(1); });
