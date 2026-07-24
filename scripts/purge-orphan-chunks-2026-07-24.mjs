#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/purge-orphan-chunks-2026-07-24.mjs
// One-time purge of the 202 document_chunks rows the 2026-07-24 audit found on
// 16 Retired documents.
//
// Explicit-list, not `WHERE status='Retired'` subquery: an explicit list is
// auditable, cannot over-delete if a doc's status changes mid-run, and does
// not require a JOIN privilege the RPC path would need. If any id in the
// list has changed state since the audit, the script HALTs before any DELETE.
//
// Steps:
//   1. Snapshot per-document chunk counts for the 16 orphan ids AND for a
//      random sample of Live/In Build docs (10 of each) as canaries.
//   2. Reject the run if any orphan id no longer has status='Retired' in PG.
//   3. DELETE FROM document_chunks WHERE doc_id = $1 for each of the 16 ids,
//      one at a time, reporting per-doc counts.
//   4. Re-snapshot the same set and confirm:
//        - every orphan id now has 0 chunks
//        - every canary id's count is unchanged
//   5. Report totals.
//
// Documents rows are NOT touched. Retired documents stay in the corpus with
// their ids intact - cross-references still resolve.
//
// USAGE:
//   node --env-file=.env.local scripts/purge-orphan-chunks-2026-07-24.mjs [--dry-run]
//
// The default is dry-run (report only, no writes). Pass --apply to execute.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const mode = apply ? "APPLY" : "DRY-RUN";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ORPHAN_IDS = [
  "REF-005-B", "REF-005-A", "TPL-015", "SOP-016", "TPL-017", "PB-004-ES",
  "REF-008", "REF-009", "SOP-013", "SOP-011", "POL-018", "SOP-003",
  "POL-005", "POL-016", "POL-017", "POL-012",
];

// Canaries: sampled from the 2026-07-24 report - a Live or In Build doc for each of
// the top classes with substantial chunk counts. If any canary's count drops,
// something targeted an active doc by mistake.
const CANARY_IDS = [
  "PB-001",    // 123 chunks Live
  "PB-006",    // 60  chunks Live
  "PB-010",    // 40  chunks Live
  "PB-004",    // 37  chunks Live
  "POL-002",   // 32  chunks Live
  "PB-002",    // 30  chunks Live
  "AGR-001",   // 27  chunks Live
  "POL-003",   // 25  chunks Live
  "PB-007",    // 24  chunks Live
  "PB-014",    // 22  chunks Live
];

console.log(`Mode: ${mode}`);
console.log(`Orphan ids to purge: ${ORPHAN_IDS.length}`);
console.log(`Canary ids to hold flat: ${CANARY_IDS.length}\n`);

// Helper: count chunks for a single doc via count exact head.
async function countFor(id) {
  const { count, error } = await s
    .from("document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("doc_id", id);
  if (error) throw new Error(`count ${id}: ${error.message}`);
  return count || 0;
}

// Guard: reject if any orphan id has changed status.
const { data: statuses, error: sErr } = await s
  .from("documents")
  .select("id, status, archived")
  .in("id", ORPHAN_IDS);
if (sErr) { console.error(sErr); process.exit(1); }
const notRetired = statuses.filter(x => x.status !== "Retired");
if (notRetired.length > 0) {
  console.error("HALT: some orphan ids are no longer Retired:");
  for (const x of notRetired) console.error(`  ${x.id}: status=${x.status} archived=${x.archived}`);
  console.error("\nRe-audit before proceeding.");
  process.exit(1);
}
console.log("Guard OK: all 16 orphan ids still have status='Retired'.\n");

// Snapshot before
console.log("Chunk counts BEFORE:");
const before = {};
for (const id of ORPHAN_IDS) {
  before[id] = await countFor(id);
  console.log(`  ${id}: ${before[id]}`);
}
const canaryBefore = {};
console.log("\nCanary counts BEFORE:");
for (const id of CANARY_IDS) {
  canaryBefore[id] = await countFor(id);
  console.log(`  ${id}: ${canaryBefore[id]}`);
}
const totalOrphanBefore = Object.values(before).reduce((a,b) => a+b, 0);
console.log(`\nTotal orphan chunks BEFORE: ${totalOrphanBefore}`);

if (!apply) {
  console.log("\nDry-run only. Re-run with --apply to execute the deletes.");
  process.exit(0);
}

// Delete, one doc at a time, reporting per-doc count.
console.log("\nDeleting...");
const deleted = {};
for (const id of ORPHAN_IDS) {
  const { error, count } = await s
    .from("document_chunks")
    .delete({ count: "exact" })
    .eq("doc_id", id);
  if (error) { console.error(`  ${id}: ERROR ${error.message}`); process.exit(1); }
  deleted[id] = count;
  console.log(`  ${id}: deleted ${count}`);
}
const totalDeleted = Object.values(deleted).reduce((a,b) => a+b, 0);
console.log(`\nTotal deleted: ${totalDeleted}`);

// Re-snapshot
console.log("\nChunk counts AFTER:");
const after = {};
for (const id of ORPHAN_IDS) {
  after[id] = await countFor(id);
  console.log(`  ${id}: ${after[id]}`);
}
const canaryAfter = {};
console.log("\nCanary counts AFTER:");
let canaryFail = false;
for (const id of CANARY_IDS) {
  canaryAfter[id] = await countFor(id);
  const drift = canaryAfter[id] - canaryBefore[id];
  const flag = drift === 0 ? "OK" : "FAIL";
  console.log(`  ${id}: ${canaryAfter[id]} (drift ${drift}) ${flag}`);
  if (drift !== 0) canaryFail = true;
}

// Assertions
const allZeroed = ORPHAN_IDS.every(id => after[id] === 0);
console.log(`\nAll orphan ids at 0 chunks: ${allZeroed}`);
console.log(`All canaries unchanged: ${!canaryFail}`);
console.log(`Total deleted matches audit (expected 202): ${totalDeleted === 202}`);

if (!allZeroed || canaryFail || totalDeleted !== 202) {
  console.error("\nOne or more post-conditions failed. Investigate before running the SousAI retrieval smoke test.");
  process.exit(2);
}
console.log("\nAll post-conditions OK.");
