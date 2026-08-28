#!/usr/bin/env node
/*
 * PII audit on rippling_report_txns + rippling_report_txns_latest.
 *
 * Rewritten 2026-08-28 (INV-P23 probe hygiene arc) after the original
 * shipped a call to the `exec_sql` RPC that was dropped from the schema
 * in a prior cleanup. The old probe threw `PGRST202 Could not find the
 * function public.exec_sql(query)` on first query - a broken probe that
 * appeared as passing in any harness catching exit codes but not
 * import/first-query errors. The seventh instance of the pattern law
 * in `docs/GOTCHAS.md`.
 *
 * This rewrite uses the Supabase JS client exclusively. What it can do:
 *   - Inventory the columns of the two report surfaces via `.from()`
 *     + sample-row Object.keys
 *   - Row count via `.select('*', { count: 'exact', head: true })`
 *   - Classify each column against the KNOWN_PII set + flag unclassified
 *     columns as review-needed
 *
 * What it cannot do (named blocker below):
 *   - Read `pg_roles`, `pg_stat_activity`, or `information_schema.role_
 *     table_grants` via PostgREST. Supabase exposes `public` schema only
 *     by default; the catalog audit needs a Studio-side query. SQL for
 *     that check is printed at the end.
 *
 * The probe FIRES (exit 1) when:
 *   - A known PII column has DISAPPEARED from the base table (schema
 *     drift; the audit is now scoping wrong)
 *   - A NEW un-classified column has appeared (review needed before
 *     the API path can trust the surface)
 *   - The `_latest` view has fewer PII columns than the base table
 *     (structural leak-risk verification; the view is what the API reads)
 *
 * Env: process.env only (--env-file=.env.local recommended).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. No writes.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("=== env preflight (PRESENT / ABSENT) ===");
console.log(`SUPABASE_URL:              ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Columns marked personal data. Two flavours:
//   direct - names or worker IDs
//   free_text - can carry names/receipt narrative even if the column
//               is not typed as PII
const KNOWN_PII = new Map([
  ["employee",       { kind: "direct",    reason: "employee display name" }],
  ["employee_id",    { kind: "direct",    reason: "worker identifier" }],
  ["memo",           { kind: "free_text", reason: "arbitrary text; can carry names, receipt narrative" }],
  ["line_item_memo", { kind: "free_text", reason: "arbitrary text; same class as memo" }],
  ["raw",            { kind: "container", reason: "JSONB; carries every un-projected CSV column including the four above" }],
]);
const PII_NAMES = new Set(KNOWN_PII.keys());

let anyFail = false;

async function sampleColumns(surfaceName) {
  const r = await supa.from(surfaceName).select("*").limit(1);
  if (r.error) throw new Error(`${surfaceName} sample failed: ${r.error.message}`);
  if (!r.data || r.data.length === 0) return [];
  return Object.keys(r.data[0]);
}
async function rowCount(surfaceName) {
  const r = await supa.from(surfaceName).select("*", { count: "exact", head: true });
  if (r.error) throw new Error(`${surfaceName} count failed: ${r.error.message}`);
  return r.count;
}
function classify(columns) {
  const pii = [];
  const nonPii = [];
  for (const c of columns) {
    if (PII_NAMES.has(c)) pii.push(c);
    else nonPii.push(c);
  }
  return { pii, nonPii };
}

// ─── A. rippling_report_txns (base table) ────────────────────────────
console.log("\n════════════════════════════════════════════════════════════════════");
console.log("A. rippling_report_txns (base, append-on-content-hash)");
console.log("════════════════════════════════════════════════════════════════════");
const baseCols = await sampleColumns("rippling_report_txns");
const baseCount = await rowCount("rippling_report_txns");
console.log(`\n  columns: ${baseCols.length}`);
console.log(`  rows:    ${baseCount}`);
const baseClass = classify(baseCols);
console.log(`\n  PII columns present (${baseClass.pii.length}):`);
for (const c of baseClass.pii) {
  const info = KNOWN_PII.get(c);
  console.log(`    ${c.padEnd(20)}  ${info.kind.padEnd(10)}  ${info.reason}`);
}
// Fire on missing PII column - schema drift
const missingFromBase = [...PII_NAMES].filter(p => !baseCols.includes(p));
if (missingFromBase.length) {
  console.error(`  FAIL: known PII column(s) MISSING from rippling_report_txns: ${missingFromBase.join(", ")}`);
  console.error(`        the audit was scoping around these columns; a rename or drop needs a scoping refresh.`);
  anyFail = true;
}

// ─── B. rippling_report_txns_latest (view - what the API reads) ─────
console.log("\n════════════════════════════════════════════════════════════════════");
console.log("B. rippling_report_txns_latest (view - what /api/kpi/purchasing reads)");
console.log("════════════════════════════════════════════════════════════════════");
const viewCols = await sampleColumns("rippling_report_txns_latest");
const viewCount = await rowCount("rippling_report_txns_latest");
console.log(`\n  columns: ${viewCols.length}`);
console.log(`  rows:    ${viewCount}`);
const viewClass = classify(viewCols);
console.log(`\n  PII columns present in view (${viewClass.pii.length}):`);
for (const c of viewClass.pii) {
  const info = KNOWN_PII.get(c);
  console.log(`    ${c.padEnd(20)}  ${info.kind.padEnd(10)}  ${info.reason}`);
}
// The view SHOULD carry the PII columns (the API needs employee to
// render the compliance card at surface where names are the point).
// Fire ONLY if the base has PII and the view is MISSING it - that would
// mean a structural leak where the view was supposed to protect a
// downstream reader but no longer does.
const baseHas = new Set(baseClass.pii);
const missingFromView = [...baseHas].filter(p => !viewCols.includes(p));
if (missingFromView.length) {
  console.error(`  FAIL: PII column(s) present in base but MISSING from _latest view: ${missingFromView.join(", ")}`);
  console.error(`        the view was tightened without the API path being reviewed for the removed column.`);
  anyFail = true;
}

// ─── C. Unclassified column check (surface drift) ────────────────────
console.log("\n════════════════════════════════════════════════════════════════════");
console.log("C. Un-classified columns (review-needed before trusting the surface)");
console.log("════════════════════════════════════════════════════════════════════");
// The classification list is at the top of this file. Any column that
// is neither in that list nor obviously non-PII (numeric, date, id
// token) is worth a look. This is not an automated PII detector; it is
// a schema-drift alarm.
const OBVIOUSLY_NON_PII = new Set([
  "id", "content_hash", "parent_txn_id", "purchased_at", "posted_date",
  "submission_date", "approved_at", "approval_state", "has_receipt",
  "amount", "currency", "vendor_name", "vendor", "category",
  "category_name", "department_name", "work_location", "gl_sync_status",
  "gl_vendor_name", "is_manually_paid", "repayment_status",
  "is_user_edited", "fetch_source", "first_seen_at", "last_seen_at",
]);
const unclassifiedBase = baseCols.filter(c => !PII_NAMES.has(c) && !OBVIOUSLY_NON_PII.has(c));
const unclassifiedView = viewCols.filter(c => !PII_NAMES.has(c) && !OBVIOUSLY_NON_PII.has(c));
console.log(`\n  base un-classified: ${unclassifiedBase.length}`);
for (const c of unclassifiedBase) console.log(`    ${c}`);
console.log(`  view un-classified: ${unclassifiedView.length}`);
for (const c of unclassifiedView) console.log(`    ${c}`);
if (unclassifiedBase.length > 0 || unclassifiedView.length > 0) {
  console.error(`  FAIL: ${unclassifiedBase.length + unclassifiedView.length} un-classified column(s) present.`);
  console.error(`        review each and add to KNOWN_PII or OBVIOUSLY_NON_PII at the top of this file.`);
  anyFail = true;
}

// ─── D. joe_readonly - named blocker ────────────────────────────────
console.log("\n════════════════════════════════════════════════════════════════════");
console.log("D. joe_readonly role audit - named blocker");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`
  Supabase's PostgREST exposes 'public' schema by default. pg_roles,
  pg_stat_activity, and information_schema.role_table_grants are NOT
  reachable via the JS client's .from() interface.

  The role/grant audit needs a Studio-side (or psql / MCP-side) query.
  sc-37 migration exists to drop joe_readonly; verify it has been
  applied by running the following in Studio and checking the result:

    SELECT COUNT(*) AS still_present
      FROM pg_roles WHERE rolname = 'joe_readonly';

  Expected: 0 after sc-37 is applied. If > 0, the migration is pending;
  named blocker - flip the draft-check on the sc-37 PR.
`);

// ─── Summary ────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`
  base table:     ${baseCount} rows, ${baseCols.length} columns, ${baseClass.pii.length} PII
  latest view:    ${viewCount} rows, ${viewCols.length} columns, ${viewClass.pii.length} PII
  unclassified:   ${unclassifiedBase.length + unclassifiedView.length} column(s)
  joe_readonly:   named blocker - Studio-side query required (D above)
`);

process.exit(anyFail ? 1 : 0);
