// Post-derive live invariants on labor_actuals for the Approvals card
// (v43-1). Runs against the ACTUAL rows just written by the derive,
// not fixtures. Owner directive 2026-08-26 pre-attestation: the
// fixture-based four-state probe is not enough; the live rows have to
// hold the same invariants or the card is decoration on wrong data.
//
// Checks:
//   1. Rows carrying non-NULL approved_hours (if zero, derive ran but
//      did not populate - something is wrong).
//   2. I1 partition: draft_hours + approved_hours ≈ total time-entry
//      hours per row. total time-entry hours are not directly stored,
//      but we approximate the invariant at range level by checking
//      the derive's own accumulator behaviour: every row with
//      draft_hours >= 0 and approved_hours >= 0.
//   Actually, we check pairwise: on every row, still_costing_hours
//   <= approved_hours (subset) and both >= 0 (non-neg). That is what
//   this probe can assert against post-derive rows without re-running
//   the source-of-truth aggregation.
//   3. STL - FL sanity fixture: oldest_draft_date somewhere in the
//      STL - FL row set is 2026-07-28 (or older) - the 29-day-old
//      shift owner surfaced during review. If oldest anywhere across
//      STL - FL rows is > 2026-07-28, either (a) the shift has since
//      been approved (which would be great but change the report) or
//      (b) the derive is missing it - either way, worth naming.
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

// Paginate through labor_actuals reading only the fields the audit
// needs. Limit to source='api' (the derive-written rows) so pre-floor
// backfill rows do not skew the invariants (backfill preceded v43-1
// and its rows carry NULL for the new columns).
async function loadAllApi() {
  const PS = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals")
      .select("account_key, week_start, worker_id, draft_hours, approved_hours, still_costing_hours, oldest_draft_date, source")
      .eq("source", "api")
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_actuals: ${q.error.message}`);
    for (const r of q.data || []) rows.push(r);
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return rows;
}

const rows = await loadAllApi();
console.error(`\nrows loaded (source=api): ${rows.length}`);

// 1. Population coverage on the new columns.
const nonNullApproved   = rows.filter(r => r.approved_hours != null).length;
const nonNullStill      = rows.filter(r => r.still_costing_hours != null).length;
const nonNullOldest     = rows.filter(r => r.oldest_draft_date != null).length;
const nonNullDraft      = rows.filter(r => r.draft_hours != null).length;

console.error(`\ncolumn population:`);
console.error(`  draft_hours         non-null:  ${nonNullDraft} / ${rows.length}   (v42 baseline)`);
console.error(`  approved_hours      non-null:  ${nonNullApproved} / ${rows.length}   (v43-1)`);
console.error(`  still_costing_hours non-null:  ${nonNullStill} / ${rows.length}   (v43-1)`);
console.error(`  oldest_draft_date   non-null:  ${nonNullOldest} / ${rows.length}   (v43-1; NULL is valid on rows with zero drafts)`);

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

console.log(`\n=== v43-1 live invariants (post-derive, source=api) ===\n`);

// A. Derive populated the new columns. If nonNullApproved is 0 the
//    derive ran but did not touch these fields - the migration or
//    the derive-write path is broken.
console.log("A. approved_hours populated:");
assert(
  "at least one row carries non-NULL approved_hours",
  nonNullApproved > 0,
  `  derive wrote ${rows.length} rows but ZERO carry approved_hours - the derive-write path or RPC coverage is broken`,
);

// B. Non-negative on every row.
console.log("\nB. non-negative on every row:");
const negDraft    = rows.filter(r => r.draft_hours != null && r.draft_hours < 0);
const negApproved = rows.filter(r => r.approved_hours != null && r.approved_hours < 0);
const negStill    = rows.filter(r => r.still_costing_hours != null && r.still_costing_hours < 0);
assert(`every row has draft_hours >= 0 or NULL (found ${negDraft.length} < 0)`,     negDraft.length === 0);
assert(`every row has approved_hours >= 0 or NULL (found ${negApproved.length} < 0)`, negApproved.length === 0);
assert(`every row has still_costing_hours >= 0 or NULL (found ${negStill.length} < 0)`, negStill.length === 0);

// C. Subset invariant: still_costing_hours <= approved_hours on
//    every row (still-costing is a subset of approved). If any row
//    breaks it, the coverage-hop logic is misclassifying entries.
console.log("\nC. subset invariant (still_costing <= approved on every row):");
const subsetBreakers = rows.filter(r =>
  r.approved_hours != null && r.still_costing_hours != null &&
  (r.still_costing_hours - r.approved_hours) > 0.01
);
assert(
  `every row satisfies still_costing_hours <= approved_hours (found ${subsetBreakers.length} breakers)`,
  subsetBreakers.length === 0,
  subsetBreakers.length > 0
    ? `  breakers (first 5):\n${subsetBreakers.slice(0, 5).map(r => `    ${r.account_key} ${r.week_start} worker=${r.worker_id}: still=${r.still_costing_hours} approved=${r.approved_hours}`).join("\n")}`
    : null,
);

// D. Consistency: every row with draft_hours > 0 has some OR no
//    oldest_draft_date? On a row-by-row basis, a row with draft_hours
//    > 0 SHOULD have oldest_draft_date set (the derive computes it
//    from the same DRAFT entries). Rows with draft_hours = 0 MUST
//   have oldest_draft_date NULL (nothing to age).
console.log("\nD. oldest_draft_date consistency (per row):");
const draftButNoOldest = rows.filter(r => (r.draft_hours || 0) > 0.004 && r.oldest_draft_date == null);
const oldestButNoDraft = rows.filter(r => (r.draft_hours || 0) <= 0.004 && r.oldest_draft_date != null);
assert(
  `every row with draft_hours > 0 has oldest_draft_date set (found ${draftButNoOldest.length} with null)`,
  draftButNoOldest.length === 0,
  draftButNoOldest.length > 0
    ? `  drafts-without-oldest (first 5):\n${draftButNoOldest.slice(0, 5).map(r => `    ${r.account_key} ${r.week_start} worker=${r.worker_id}: draft_hours=${r.draft_hours}, oldest_draft_date=NULL`).join("\n")}`
    : null,
);
assert(
  `no row has oldest_draft_date set without drafts (found ${oldestButNoDraft.length} anomalies)`,
  oldestButNoDraft.length === 0,
);

// E. STL - FL fixture check: the 29-day-old draft owner surfaced.
//    Look at all STL - FL rows and find the MIN oldest_draft_date.
//    It should be 2026-07-28 or earlier (the shift may have been
//    approved since; if MIN is later than 07-28, name it and move on).
console.log("\nE. STL - FL oldest-draft fixture (owner's 29-day-old shift):");
const stlfl = rows.filter(r => r.account_key === "STL - FL" && r.oldest_draft_date != null);
const stlfl_oldest = stlfl.length > 0 ? stlfl.map(r => r.oldest_draft_date).sort()[0] : null;
console.log(`  STL - FL rows with oldest_draft_date populated: ${stlfl.length}`);
console.log(`  MIN oldest_draft_date across STL - FL:          ${stlfl_oldest ?? "NULL"}`);
if (stlfl_oldest) {
  const days = Math.floor((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - new Date(`${stlfl_oldest}T00:00:00.000Z`).getTime()) / 86400000);
  console.log(`  age at ${new Date().toISOString().slice(0,10)}:                          ${days} days`);
}
assert(
  "STL - FL MIN oldest_draft_date is on or before 2026-07-28 (owner's fixture)",
  stlfl_oldest !== null && stlfl_oldest <= "2026-07-28",
  stlfl_oldest === null
    ? `  STL - FL has ZERO rows with a draft-date - either every draft was approved since the review, or the derive missed them`
    : `  MIN is ${stlfl_oldest}, later than the expected 2026-07-28. If the shift was approved since, this is not a defect; owner ruling needed.`,
);

// F. Per-account roll-up so owner can eyeball where the drafts sit
//    and what the oldest is per account. Not an assertion; just
//    print.
console.log("\nF. per-account roll-up (drafts + oldest, populated rows only):");
const byAccount = new Map();
for (const r of rows) {
  const cur = byAccount.get(r.account_key) || { draft_hrs: 0, approved_hrs: 0, still_costing_hrs: 0, oldest: null, workers_with_drafts: new Set() };
  cur.draft_hrs += Number(r.draft_hours || 0);
  cur.approved_hrs += Number(r.approved_hours || 0);
  cur.still_costing_hrs += Number(r.still_costing_hours || 0);
  if (r.oldest_draft_date && (cur.oldest === null || r.oldest_draft_date < cur.oldest)) cur.oldest = r.oldest_draft_date;
  if ((r.draft_hours || 0) > 0.004 && r.worker_id) cur.workers_with_drafts.add(r.worker_id);
  byAccount.set(r.account_key, cur);
}
console.log(`  account         | draft hrs | approved hrs | still-costing hrs | oldest draft   | ppl with drafts`);
console.log(`  ----------------+-----------+--------------+-------------------+----------------+----------------`);
for (const [acct, a] of [...byAccount.entries()].sort()) {
  console.log(`  ${acct.padEnd(15)} | ${a.draft_hrs.toFixed(2).padStart(9)} | ${a.approved_hrs.toFixed(2).padStart(12)} | ${a.still_costing_hrs.toFixed(2).padStart(17)} | ${(a.oldest || "—").padEnd(14)} | ${String(a.workers_with_drafts.size).padStart(15)}`);
}

if (failures > 0) {
  console.log(`\n${failures} live-invariant failure(s).`);
  process.exit(1);
}
console.log(`\nall live invariants pass.`);
