// Class canary - _latest view pagination bounds.
//
// Owner ruling 2026-08-27. After the rippling_raw_time_entries_latest
// statement-timeout incident (Aug 22-27, six nightly derives failed
// silently until #854 unmasked it), the fix was keyset pagination on
// every `_latest` DISTINCT ON view. That solved the case. This canary
// solves the CLASS: the defect was invisible for six days because
// nothing measured it. Ninth or tenth instance of the same pattern
// this week (something that looks like it works, silently doesn't,
// produces a plausible answer).
//
// Assertion: for every `rippling_raw_*_latest` view, a full paginated
// read via fetchAllKeyset completes with EVERY page under BOUND_MS.
// If any page crosses that bound we are approaching the statement
// timeout (60s in Supabase); the canary fires long before the
// derive dies.
//
// This is the CLASS assertion, not the CASE assertion. It fires the
// next time any _latest view starts to drag - even if the offender
// is a different view than the one #854 unmasked.
//
// Bound picked at 10000ms. Statement timeout in Supabase is 60s;
// the canary fires at 10s = 6x headroom, well before Postgres
// cancels. Deep-page keyset in isolation was 1.8s in the incident
// verification, but under real derive load (concurrent reads,
// pooler contention) a single page has been observed at 5.9s. A
// bound of 5s would have fired on today's healthy state; 10s
// leaves room for the normal load band while still firing long
// before the statement timeout.
//
// If a page crosses 10s the pattern has degraded even under keyset;
// time to look at write volume, index health, or option 2 (materialize
// the view).

import { createClient } from "@supabase/supabase-js";
import { fetchAllKeyset } from "../../src/lib/rippling/paginate.js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Every `_latest` DISTINCT ON view read by the nightly derives.
// Add here when a new one lands. The class canary must cover them.
const VIEWS = [
  { name: "rippling_raw_time_entries_latest",  cols: "rippling_id, payload" },
  { name: "rippling_raw_pay_segments_latest",  cols: "rippling_id, payload" },
  { name: "rippling_raw_workers_latest",       cols: "rippling_id, payload" },
  { name: "rippling_raw_users_latest",         cols: "rippling_id, payload" },
  { name: "rippling_raw_time_entry_zo_latest", cols: "rippling_id, payload" },
  { name: "rippling_raw_compensations_latest", cols: "rippling_id, worker_id, payment_type, annual_value, salary_effective_date, currency" },
];

const BOUND_MS = 10000;
const PAGE_SIZE = 1000;

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

// Paginated read that times each page so we can find the worst.
async function timedFetchAll(view, cols) {
  const out = [];
  const pageTimes = [];
  let last = null;
  while (true) {
    let q = supa.from(view).select(cols).order("rippling_id", { ascending: true }).limit(PAGE_SIZE);
    if (last !== null) q = q.gt("rippling_id", last);
    const t0 = Date.now();
    const { data, error } = await q;
    const ms = Date.now() - t0;
    pageTimes.push(ms);
    if (error) throw new Error(`${view}: ${error.message} (page ${pageTimes.length}, ${ms}ms)`);
    if (!data?.length) break;
    out.push(...data);
    last = data[data.length - 1].rippling_id;
    if (data.length < PAGE_SIZE) break;
  }
  return { rows: out, pageTimes };
}

console.log(`=== _latest view pagination bounds (max page ms < ${BOUND_MS}) ===\n`);

for (const v of VIEWS) {
  try {
    const { rows, pageTimes } = await timedFetchAll(v.name, v.cols);
    const worst = Math.max(...pageTimes);
    const worstIdx = pageTimes.indexOf(worst);
    const totalMs = pageTimes.reduce((a, b) => a + b, 0);
    console.log(`  [${v.name}]  rows=${String(rows.length).padStart(6)}  pages=${pageTimes.length}  worst=${worst}ms (page ${worstIdx + 1})  total=${totalMs}ms`);
    assert(
      `${v.name} worst page under ${BOUND_MS}ms`,
      worst < BOUND_MS,
      { worst_ms: worst, worst_page: worstIdx + 1, page_times_ms: pageTimes },
    );
  } catch (e) {
    failures += 1;
    console.log(`  ✗ ${v.name} threw: ${e.message}`);
  }
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} view(s) have a page slower than ${BOUND_MS}ms. Statement timeout is 60,000ms; the canary fires early on purpose.`);
  console.log(`Next steps: check write volume, index health on the raw table, and consider materializing the view (option 2 from the timeout PR body).`);
  process.exit(1);
}
console.log(`every _latest view paginates under ${BOUND_MS}ms per page.`);
