// Finding 2 investigation, 2026-08-28. Kevin observed:
//   CIN - AZ FYTD: hours_double_time = 69
//   CIN - AZ table "Holiday 2x" total = 68.79
//   every account FYTD: hours_premium_other = 0
//
// The WeekTable Holiday 2x column renders w.hours_double_time. The
// derive job (src/lib/labor/deriveActuals.js:435) routes rows into
// hours_double_time when earning_type_map.bucket === "double_time".
// This probe lists every merged_earning_type_name that lands in
// hours_double_time so we can decide whether the "Holiday" label is
// right or the column should read "Double time 2x".
//
// Usage: node --env-file=.env.local scripts/probes/_probe_earning_type_map_double_time.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error("SUPABASE_URL ABSENT"); process.exit(1); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY ABSENT"); process.exit(1); }

const supa = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supa
  .from("earning_type_map")
  .select("merged_earning_type_name, multiplier, bucket")
  .order("bucket")
  .order("merged_earning_type_name");
if (error) { console.error(error.message); process.exit(1); }

const byBucket = new Map();
for (const r of data) {
  if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
  byBucket.get(r.bucket).push(r);
}

console.log(`earning_type_map (${data.length} rows total)\n`);
for (const [bucket, rows] of byBucket) {
  console.log(`bucket = ${bucket}  (${rows.length} row${rows.length === 1 ? "" : "s"})`);
  for (const r of rows) {
    const mult = r.multiplier == null ? "null" : String(r.multiplier);
    console.log(`  ${mult.padStart(5)}x  ${r.merged_earning_type_name}`);
  }
  console.log("");
}

// Cross-check: any earning type whose NAME contains "holiday" but that
// is NOT in the double_time bucket, or any double_time row whose name
// does not contain "holiday". That answers "label right or wrong".
console.log("--- name-vs-bucket cross-check ---");
const holidayNamed = data.filter(r => /holiday/i.test(r.merged_earning_type_name || ""));
console.log(`\nrows with "holiday" in the name:`);
if (holidayNamed.length === 0) console.log("  (none)");
for (const r of holidayNamed) console.log(`  bucket=${r.bucket}  mult=${r.multiplier}  ${r.merged_earning_type_name}`);

const doubleBucket = data.filter(r => r.bucket === "double_time");
const doubleNonHoliday = doubleBucket.filter(r => !/holiday/i.test(r.merged_earning_type_name || ""));
console.log(`\ndouble_time bucket rows whose name is NOT holiday:`);
if (doubleNonHoliday.length === 0) console.log("  (none - every double_time entry is a holiday type)");
for (const r of doubleNonHoliday) console.log(`  mult=${r.multiplier}  ${r.merged_earning_type_name}`);

// And check whether any real hours have posted into hours_double_time
// from a non-holiday earning type - which would only be visible in
// labor_actuals if the earning-type-map bucket alone determined it.
// This probe cannot decompose the actuals back to earning types (the
// derive collapses per-week), but the map answers the definitional
// question by itself.
