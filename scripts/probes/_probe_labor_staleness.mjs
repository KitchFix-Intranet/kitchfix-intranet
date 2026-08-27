// Staleness banner assertions.
//
// Owner ruling 2026-08-27 (#854 review). The banner has to fire on
// stale timestamps, not just stay quiet when data is fresh. Kevin
// verified live: banner absent, wire response missing the two field
// names I named in the report. Absent-case proof alone would ship a
// staleness check that cannot detect staleness - the class of defect
// this PR exists to prevent.
//
// This probe feeds computeStaleness fixtures and asserts:
//   A1  fresh timestamps  -> null
//   A2  weekly 40h old    -> [{table: "labor_actuals",       hoursOld ≈ 40}]
//   A3  daily  40h old    -> [{table: "labor_actuals_daily", hoursOld ≈ 40}]
//   A4  both stale        -> two entries, weekly first (stable order)
//   A5  boundary 30.0h    -> fires (>= threshold)
//   A6  boundary 29.9h    -> quiet
//   A7  absent fields     -> null (banner stays quiet; wire-shape
//                             defect is caught by a separate probe)
//   A8  malformed ISO     -> null (parseable check falls through)
//
// The probe uses `opts.now` to freeze the reference time, so it is
// deterministic regardless of when it runs.

import { computeStaleness } from "../../src/lib/labor/staleness.js";

const NOW = new Date("2026-08-27T18:00:00Z");
function isoHoursAgo(h) {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== staleness banner ===\n");

// A1 - fresh timestamps
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(2),
    last_daily_derive_at:  isoHoursAgo(1),
  }, { now: NOW });
  assert("A1  fresh timestamps -> null", res === null, res);
}

// A2 - weekly stale only
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(40),
    last_daily_derive_at:  isoHoursAgo(2),
  }, { now: NOW });
  assert("A2  weekly 40h -> one entry naming labor_actuals",
    Array.isArray(res) && res.length === 1
      && res[0].table === "labor_actuals"
      && Math.round(res[0].hoursOld) === 40,
    res);
}

// A3 - daily stale only
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(2),
    last_daily_derive_at:  isoHoursAgo(40),
  }, { now: NOW });
  assert("A3  daily 40h -> one entry naming labor_actuals_daily",
    Array.isArray(res) && res.length === 1
      && res[0].table === "labor_actuals_daily"
      && Math.round(res[0].hoursOld) === 40,
    res);
}

// A4 - both stale, stable order (weekly first)
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(48),
    last_daily_derive_at:  isoHoursAgo(72),
  }, { now: NOW });
  assert("A4  both stale -> two entries, weekly first",
    Array.isArray(res) && res.length === 2
      && res[0].table === "labor_actuals"
      && res[1].table === "labor_actuals_daily",
    res);
}

// A5 - boundary 30h exact fires
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(30),
    last_daily_derive_at:  isoHoursAgo(2),
  }, { now: NOW });
  assert("A5  boundary 30.0h -> fires",
    Array.isArray(res) && res.length === 1 && res[0].table === "labor_actuals",
    res);
}

// A6 - boundary 29.9h stays quiet
{
  const res = computeStaleness({
    last_weekly_derive_at: isoHoursAgo(29.9),
    last_daily_derive_at:  isoHoursAgo(2),
  }, { now: NOW });
  assert("A6  boundary 29.9h -> quiet", res === null, res);
}

// A7 - absent fields (wire-shape defect)
{
  const res = computeStaleness({}, { now: NOW });
  assert("A7  absent fields -> null (banner quiet; wire-shape defect is separate)", res === null, res);
}

// A8 - malformed ISO
{
  const res = computeStaleness({
    last_weekly_derive_at: "not-a-date",
    last_daily_derive_at:  "2026-13-45",
  }, { now: NOW });
  assert("A8  malformed ISO -> null", res === null, res);
}

// A9 - live DB source check. Route.js queries max(derived_at) on both
// tables to populate derive_freshness.last_weekly_derive_at +
// last_daily_derive_at. Assert both queries return a non-null row so
// the wire fields can never be null while the pipeline is healthy.
// If this fires, the banner would falsely stay quiet even on a real
// staleness because the source is empty.
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("\n=== live DB source (route feeds banner from here) ===\n");
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const [w, d] = await Promise.all([
    supa.from("labor_actuals").select("derived_at")
      .order("derived_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("labor_actuals_daily").select("derived_at")
      .order("derived_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  assert(`A9a  max(labor_actuals.derived_at) is non-null`,
    !w.error && w.data?.derived_at,
    w.error?.message || `data=${JSON.stringify(w.data)}`);
  assert(`A9b  max(labor_actuals_daily.derived_at) is non-null`,
    !d.error && d.data?.derived_at,
    d.error?.message || `data=${JSON.stringify(d.data)}`);
  console.log(`     weekly max: ${w.data?.derived_at}`);
  console.log(`     daily  max: ${d.data?.derived_at}`);
} else {
  console.log("\n(A9 skipped - no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env)");
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
