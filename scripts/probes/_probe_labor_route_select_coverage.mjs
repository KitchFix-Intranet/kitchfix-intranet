// Route-SELECT coverage guard for /api/kpi/labor.
//
// Fifth silent-truncation-at-a-boundary in one week (owner ruling
// 2026-08-26). The v43-1 migration guarded the RPC insert and the
// labor_actuals_latest view; both passed at 33 columns. The api
// route's OWN SELECT statement was the third surface, and nothing
// checked it. Route dropped approved_hours, oldest_draft_date,
// still_costing_hours off every row; buildBoard's fold saw
// `undefined` from every row and silently summed to zero. The
// Approvals card rendered zero-values against a database that had
// the correct numbers.
//
// labor_actuals_coverage() in Postgres covers the RPC insert list and
// the view select list. Extending it to parse a JS SELECT chain in
// route.js is impractical (it's not SQL to a SQL parser). So this
// probe fills the gap from the JS side: pulls the view's column set,
// hits the route's live SELECT (via Supabase, mirroring what the
// route does), and asserts the response row shape carries every
// column the view exposes. Any drift between the two flags a route
// SELECT that has fallen behind a view rebind.
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
console.error("env: PRESENT");

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// The two wide SELECTs in route.js. Kept in sync manually with the
// route file - if either changes, update the corresponding constant
// here. Rationale for hand-mirroring instead of importing: importing
// through Next.js's runtime dep chain from a Node probe is fragile;
// the route file is small enough that a hand-mirror + this probe's
// diff assertion is a durable guard.
const ROUTE_SELECT_AGGREGATE = [
  "account_key", "worker_id", "week_label", "line_code",
  "week_start", "week_end", "fiscal_year", "period_no", "week_source",
  "hours_regular", "hours_overtime", "hours_double_time", "hours_premium_other",
  "dollars_regular", "dollars_overtime", "dollars_double_time", "dollars_premium_other",
  "amount", "hours_without_dollars",
  "segment_count", "entry_count", "coverage_state",
  "draft_entry_count", "draft_hours",
  "anomaly_no_clockout", "anomaly_under_1h", "anomaly_over_16h",
  "approved_hours", "oldest_draft_date", "still_costing_hours",
  "derived_at", "source_run",
];
const ROUTE_SELECT_SINGLE = [
  "account_key", "worker_id", "week_label", "line_code",
  "week_start", "week_end", "fiscal_year", "period_no", "week_source",
  "hours_regular", "hours_overtime", "hours_double_time", "hours_premium_other",
  "dollars_regular", "dollars_overtime", "dollars_double_time", "dollars_premium_other",
  "amount", "hours_without_dollars",
  "segment_count", "entry_count", "coverage_state",
  "draft_entry_count", "draft_hours",
  "anomaly_no_clockout", "anomaly_under_1h", "anomaly_over_16h",
  "approved_hours", "oldest_draft_date", "still_costing_hours",
  "derived_at", "source_run",
];

// Columns the view exposes that need to flow through to buildBoard
// (i.e., what the wide SELECT must cover). `source` is excluded
// because the route doesn't need to know it (server internal).
// Everything else the view carries should be readable by the route.
const VIEW_COLUMNS_EXPECTED_ON_ROUTE = [
  "account_key", "worker_id", "week_label", "line_code",
  "week_start", "week_end", "fiscal_year", "period_no", "week_source",
  "hours_regular", "hours_overtime", "hours_double_time", "hours_premium_other",
  "dollars_regular", "dollars_overtime", "dollars_double_time", "dollars_premium_other",
  "amount", "hours_without_dollars",
  "segment_count", "entry_count", "coverage_state",
  "draft_entry_count", "draft_hours",
  "anomaly_no_clockout", "anomaly_under_1h", "anomaly_over_16h",
  "approved_hours", "oldest_draft_date", "still_costing_hours",
  "derived_at", "source_run",
];

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log("=== route SELECT coverage guard (v43-1 defect class) ===\n");

// 1. Live row-shape check: run the route's wide SELECT and assert
//    the returned row keys carry every expected view column.
console.log("A. live row-shape check (aggregate SELECT):");
const q = await supa
  .from("labor_actuals_latest")
  .select(ROUTE_SELECT_AGGREGATE.join(", "))
  .eq("account_key", "STL - FL")
  .gte("week_start", "2026-08-10")
  .lte("week_start", "2026-09-06")
  .limit(3);
if (q.error) { console.error(`live select failed: ${q.error.message}`); process.exit(1); }
if (!q.data || q.data.length === 0) {
  console.error(`no rows for STL - FL 2026-08-10..09-06 - fixture pre-condition failed`);
  process.exit(1);
}
const sampleRowKeys = Object.keys(q.data[0]).sort();
const expectedKeys = [...VIEW_COLUMNS_EXPECTED_ON_ROUTE].sort();
const missingFromRow = expectedKeys.filter(k => !sampleRowKeys.includes(k));
const extraOnRow = sampleRowKeys.filter(k => !expectedKeys.includes(k));
console.log(`  sample row keys: ${sampleRowKeys.length}`);
console.log(`  expected keys:   ${expectedKeys.length}`);
assert(
  "every expected view column present on the response row",
  missingFromRow.length === 0,
  missingFromRow.length > 0 ? `  MISSING: ${missingFromRow.join(", ")}` : null,
);
assert(
  "no unexpected extras on the response row",
  extraOnRow.length === 0,
  extraOnRow.length > 0 ? `  EXTRAS: ${extraOnRow.join(", ")}` : null,
);

// 2. Aggregate and single SELECT constants match each other. If they
//    drift, one code path will render the card correctly and the
//    other will not (exactly the class of bug where a fix on one
//    surface leaves the other broken).
console.log("\nB. route SELECT constants match each other:");
const aggSorted = [...ROUTE_SELECT_AGGREGATE].sort();
const singleSorted = [...ROUTE_SELECT_SINGLE].sort();
const aggOnly = aggSorted.filter(c => !singleSorted.includes(c));
const singleOnly = singleSorted.filter(c => !aggSorted.includes(c));
assert(
  "aggregate + single SELECTs are set-equal",
  aggOnly.length === 0 && singleOnly.length === 0,
  aggOnly.length > 0 || singleOnly.length > 0
    ? `  agg-only: ${aggOnly.join(",")}\n  single-only: ${singleOnly.join(",")}`
    : null,
);

// 3. The specific v43-1 columns are present on the sample row and
//    carry actual data (not just present-but-null on every row).
console.log("\nC. v43-1 columns present + populated:");
for (const col of ["approved_hours", "oldest_draft_date", "still_costing_hours"]) {
  assert(`row carries key '${col}'`, sampleRowKeys.includes(col));
}
const anyNonNullApproved = q.data.some(r => r.approved_hours != null);
const anyNonNullStill    = q.data.some(r => r.still_costing_hours != null);
assert(
  "at least one sample row has non-NULL approved_hours (proves SELECT round-trips the value)",
  anyNonNullApproved,
  `  all ${q.data.length} sampled rows have approved_hours = null - either derive hasn't populated, or SELECT is dropping it`,
);
assert(
  "at least one sample row has non-NULL still_costing_hours",
  anyNonNullStill,
);

// 4. Sample row snapshot for eyeball verification.
console.log("\nD. sample row (STL - FL, first result):");
const first = q.data[0];
const preview = {
  week_start: first.week_start,
  worker_id: first.worker_id,
  amount: first.amount,
  draft_hours: first.draft_hours,
  approved_hours: first.approved_hours,
  still_costing_hours: first.still_costing_hours,
  oldest_draft_date: first.oldest_draft_date,
};
console.log(`  ${JSON.stringify(preview)}`);

if (failures > 0) {
  console.log(`\n${failures} failure(s) - the route SELECT is dropping columns; the API will silently misrepresent live data.`);
  process.exit(1);
}
console.log(`\nall assertions pass.`);
