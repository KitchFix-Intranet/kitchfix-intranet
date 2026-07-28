// PROBE: list (account, month, actionable-day count, dates) for every
// account × month. Feeds Phase 3-B re-gate surface selection - owner
// and Chat-Claude pick a viable target (2+ actionable-scheduled days
// in the same drill) instead of guessing.
//
//   node --env-file=.env.local scripts/_probe_sc_actionable_by_month.mjs
//
// GRAIN (re-gate 5 fix, 2026-07-28):
//   sc_daily_revenue is SERVICE-grained. A per-meal day may have N
//   services, each row is its own (has_projection, has_actuals) pair.
//   The v2 save writes only touched services, so an entered day keeps
//   projection-only rows for its untouched services. Filtering rows
//   directly with `has_projection AND NOT has_actuals` counted those
//   service rows and over-reported. The queue predicate (Service-
//   Calendar.js:1199-1202) is DAY-level.
//
// Additional refinement (post-first-run, CIN-AZ 2026-07 sanity anchor):
//   the classifier at serviceCalendar.js:310 also treats a day with
//   projections but ALL-ZERO projected_count as "no-service" (planned
//   off day). Sundays for CIN-AZ carry has_projection=true rows with
//   projected_count=0. The queue skips those. So the probe must also
//   check anyNonZeroProj at the DAY level.
//
// Corrected DAY-level predicate - actionable iff:
//   anyActuals = false                                (no service touched)
//   AND anyNonZeroProjection = true                   (>=1 non-zero proj)
//   AND service_date <= today
//
// Ring-total's larger population (adds `upcoming` future service days)
// is intentionally OUT of scope here; the operator can't save `upcoming`.
//
// CAVEAT (MLB): fee homestand accounts drive scheduled days from
// sc_homestand_schedule (game rows), not sc_daily_projections. This
// probe's projection-based path may under-report MLB surfaces. If the
// re-gate target is an MLB account, cross-check against
// sc_homestand_schedule.
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
  console.log("Grain: DAY-level. A day is actionable iff ANY service that day");
  console.log("has a projection AND NO service that day has actuals AND date <= today.\n");

  // Read every past service-day row. Grain here is one row per
  // (account, service, date); we aggregate to (account, date) below.
  // PostgREST default limit is 1000 - paginate via .range() to avoid
  // silent truncation on the multi-account read.
  const PAGE = 1000;
  const data = [];
  for (let from = 0; ; from += PAGE) {
    const { data: chunk, error } = await supa
      .from("sc_daily_revenue")
      .select("account_key, service_date, has_projection, has_actuals, projected_count")
      .lte("service_date", today)
      .order("account_key", { ascending: true })
      .order("service_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`ERROR reading sc_daily_revenue: ${error.message}`);
      process.exit(1);
    }
    if (!chunk?.length) break;
    data.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  if (!data.length) {
    console.log("(no rows in sc_daily_revenue for past dates)");
    return;
  }
  console.log(`Read ${data.length} service-rows (paged).\n`);

  // Aggregate to (account, date):
  //   anyActuals    = any service that day carries actuals
  //   anyNonZeroProj = any service that day has projected_count > 0
  // A day is actionable iff NO service touched AND at least ONE non-
  // zero projection existed. Matches the classifier at
  // serviceCalendar.js:303-313: !hasAct + hasProj + !anyNonZeroProj
  // collapses to "no-service" (planned off day, not in the queue).
  const perDay = new Map();
  for (const r of data) {
    const date = String(r.service_date).slice(0, 10);
    const key = `${r.account_key}::${date}`;
    let bag = perDay.get(key);
    if (!bag) {
      bag = { account: r.account_key, date, anyActuals: false, anyNonZeroProj: false };
      perDay.set(key, bag);
    }
    if (r.has_actuals) bag.anyActuals = true;
    if ((r.projected_count || 0) > 0) bag.anyNonZeroProj = true;
  }

  const dedup = [];
  for (const bag of perDay.values()) {
    if (bag.anyActuals) continue;      // entered day - drop
    if (!bag.anyNonZeroProj) continue; // planned off day (no-service) - drop
    dedup.push({ account: bag.account, date: bag.date });
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

  // Sanity anchors (owner-gated at re-gate 5): probe must satisfy these
  // before the output is used to pick a target surface.
  console.log("\n=== SANITY ANCHORS ===");
  const findGroup = (a, m) => list.find(g => g.account === a && g.month === m);
  const cinAzJul = findGroup("CIN - AZ", "2026-07");
  console.log(`  CIN-AZ 2026-07 count = ${cinAzJul?.dates.length ?? 0} (expected: 0)`);
  const cinKyJul = findGroup("CIN - KY", "2026-07");
  const kyDates = cinKyJul?.dates || [];
  const kyIncludes = ["2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13","2026-07-14"].filter(d => kyDates.includes(d));
  console.log(`  CIN-KY 2026-07 dates: [${kyDates.join(",")}] (must exclude Jul 8-14; found ${kyIncludes.length} of the excluded set present)`);
  const stlFlJul = findGroup("STL - FL", "2026-07");
  const flDates = stlFlJul?.dates || [];
  const flIncludes = ["2026-07-02","2026-07-08","2026-07-18"].filter(d => flDates.includes(d));
  console.log(`  STL-FL 2026-07 dates: [${flDates.join(",")}] (must exclude Jul 2/8/18; found ${flIncludes.length} of the excluded set present)`);
}

main().catch(e => { console.error(e); process.exit(1); });
