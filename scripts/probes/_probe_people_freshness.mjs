#!/usr/bin/env node
// _probe_people_freshness - Shape A staleness probe.
//
// Runs at the end of the rippling-sync workflow with `if: always()`
// so it fires regardless of whether prior steps in the same job
// succeeded. Reads `MAX(last_synced_at)` from the `people` table and
// fails the step if the newest row is more than `--max-hours` behind
// NOW(). Default: 48 hours.
//
// The point is a signal independent of "did the sync report success".
// Both stale-directory incidents surfaced by human observation, 15
// days apart. This probe would have fired on Sep 9 (24h after the
// first missed run) and again every night until the fix landed.
//
// A second shape (Shape B, docs/backlog/people-table-staleness-signal.md)
// runs the same check on a Vercel cron independent of GHA, so a
// disabled or missing workflow does not also disable the alarm.
// Shape A is what ships in the same PR as this probe.
//
// USAGE:
//   node scripts/probes/_probe_people_freshness.mjs
//   node scripts/probes/_probe_people_freshness.mjs --max-hours=24
//
// EXIT:
//   0  people.last_synced_at is fresh (age <= max-hours)
//   1  stale (age > max-hours) OR the query failed
//
// The FAIL branch emits a GHA ::error:: notice with the actual age
// so the Actions UI surfaces the number, not just "failed."

import { createClient } from "@supabase/supabase-js";

const args = new Map(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [[m[1], m[2]]] : [];
  })
);
const maxHours = Number(args.get("max-hours") ?? "48");
if (!Number.isFinite(maxHours) || maxHours <= 0) {
  console.error(`::error::--max-hours must be a positive number, got ${args.get("max-hours")}`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("::error::SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await supa
  .from("people")
  .select("last_synced_at")
  .order("last_synced_at", { ascending: false })
  .limit(1);

if (error) {
  console.error(`::error title=People freshness probe query failed::${error.message}`);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.error("::error title=People table empty::people has zero rows; freshness cannot be measured");
  process.exit(1);
}

const newestIso = data[0].last_synced_at;
if (!newestIso) {
  console.error("::error title=People last_synced_at is null::the newest row has a null last_synced_at; sync may never have written");
  process.exit(1);
}

const ageMs = Date.now() - new Date(newestIso).getTime();
const ageHours = ageMs / (1000 * 60 * 60);

if (ageHours > maxHours) {
  const line = `people.last_synced_at newest = ${newestIso} (${ageHours.toFixed(1)}h ago). Threshold ${maxHours}h. STALE.`;
  console.error(`::error title=People table stale::${line}`);
  console.error(`Root cause is likely upstream in this same job or a prior nightly run - see the step that skipped or failed. The gate fix in #1146 landed 2026-09-17; if this probe fires again after that, a NEW derive_people breakage is present.`);
  process.exit(1);
}

console.log(`OK people.last_synced_at newest = ${newestIso} (${ageHours.toFixed(1)}h ago). Threshold ${maxHours}h.`);
process.exit(0);
