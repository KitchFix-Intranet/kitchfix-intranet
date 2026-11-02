#!/usr/bin/env node
/**
 * Acceptance #4 for the time_entries hash fix: of the pairs
 * Chat-Claude classified as "genuinely different time" (~370), how
 * many still produce distinct hashes under the new rule? That
 * number must stay the same - if canonicalizing collapses real
 * punch edits, the transform is too aggressive and the fix is
 * wrong.
 *
 * Methodology:
 *   1. Scan `rippling_raw_time_entries` ordered by (rippling_id,
 *      fetched_at DESC). For each id, keep the first two rows =
 *      (v1 = most recent, v2 = second most recent).
 *   2. For each pair, classify by segments[].end_time:
 *      - SAME instant, different offset  (noise)
 *      - DIFFERENT instant                (real edit)
 *      - end_time string IS byte-identical (nothing to compare on
 *        this field; still re-hash to catch other field moves)
 *   3. Hash v1 and v2 under the CURRENT rule and record whether
 *      the hashes still differ.
 *
 * Expected (matching Chat-Claude's measurement):
 *   total pairs                                             ~11,773
 *   end_time string differs                                 ~11,136
 *     of which same-instant different-offset (noise)        ~10,766
 *     of which genuine different-instant (real edit)           ~370
 *   under NEW rule:
 *     noise pairs still differing in hash                        0
 *     real-edit pairs still differing in hash                  370
 *
 * If "real-edit still differs" <= 370 and "noise still differs"
 * near 0, the fix is correct.
 *
 * READ-ONLY. Paginates the base table; no writes.
 *
 * CLI:
 *   node --env-file=.env.local scripts/probes/_probe_time_entries_genuine_vs_noise.mjs
 *
 * Exit:
 *   0  ran, counts reported
 *   1  env missing or DB read failed
 */
import { createClient } from "@supabase/supabase-js";
import { contentHash } from "../../src/lib/rippling.js";

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

console.log(`time_entries_genuine_vs_noise_probe started=${new Date().toISOString()}`);
const okUrl  = pres("SUPABASE_URL");
const okRole = pres("SUPABASE_SERVICE_ROLE_KEY");
if (!okUrl || !okRole) { console.error("STOP: required env ABSENT."); process.exit(1); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Pull end_time from segments[0]. On a time_entry with multiple
// segments the comparison narrows to the first; Chat-Claude's
// measurement did the same. A payload with no segments falls to
// "no end_time".
function endTimeOf(payload) {
  const s = payload?.segments;
  if (!Array.isArray(s) || s.length === 0) return null;
  return s[0]?.end_time || null;
}

function classifyEndTime(a, b) {
  if (a == null || b == null) return "no_end_time";
  if (a === b) return "byte_identical";
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return "unparseable";
  return ta === tb ? "same_instant_diff_offset" : "different_instant";
}

// Pull the full id list from the _latest view (small, well-indexed)
// then batch-query the base table in groups of IDs. A straight offset
// scan on the base table hit a statement timeout at ~96k rows on the
// warm cache; id-batched queries let the composite index on
// (rippling_id, fetched_at DESC) walk each id's versions directly.
console.log("");
console.log("step 1a: fetch id list from rippling_raw_time_entries_latest");
async function pageAll(builder, pageSize = 1000) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = await builder().range(from, from + pageSize - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
let idsLatest;
try {
  idsLatest = await pageAll(() => supa.from("rippling_raw_time_entries_latest").select("rippling_id"));
} catch (e) { console.error(`  FAIL id-list: ${e.message}`); process.exit(1); }
const allIds = idsLatest.map(r => r.rippling_id);
console.log(`  distinct ids: ${allIds.length}`);

console.log("");
console.log("step 1b: for each id-batch, pull top-2 versions from the base table");
// Supabase caps a single response at 1000 rows. Each id has ~12
// versions in time_entries, so a 100-id batch = ~1200 rows and
// silently truncates ~200 rows (first probe missed 2,561 of 11,803
// ids this way). Paginate INSIDE each batch via .range() until the
// batch is exhausted, so no rows are lost at the 1000-row boundary.
const ID_BATCH = 100;
const PAGE = 1000;
const byId = new Map();
let totalRows = 0;
let batchesDone = 0;
for (let i = 0; i < allIds.length; i += ID_BATCH) {
  const batch = allIds.slice(i, i + ID_BATCH);
  let innerFrom = 0;
  for (;;) {
    const q = await supa.from("rippling_raw_time_entries")
      .select("rippling_id, payload")
      .in("rippling_id", batch)
      .order("rippling_id", { ascending: true })
      .order("fetched_at", { ascending: false })
      .range(innerFrom, innerFrom + PAGE - 1);
    if (q.error) { console.error(`  FAIL id-batch at i=${i} innerFrom=${innerFrom}: ${q.error.message}`); process.exit(1); }
    const rows = q.data || [];
    totalRows += rows.length;
    for (const r of rows) {
      const id = r.rippling_id;
      const cur = byId.get(id) || { v1: null, v2: null, countSeen: 0 };
      if (cur.countSeen === 0) cur.v1 = r.payload;
      else if (cur.countSeen === 1) cur.v2 = r.payload;
      cur.countSeen += 1;
      byId.set(id, cur);
    }
    if (rows.length < PAGE) break;
    innerFrom += PAGE;
  }
  batchesDone += 1;
  if (batchesDone % 10 === 0) process.stderr.write(`\r  batches ${batchesDone}/${Math.ceil(allIds.length / ID_BATCH)} totalRows=${totalRows}`);
}
process.stderr.write(`\r  batches ${batchesDone}/${Math.ceil(allIds.length / ID_BATCH)} totalRows=${totalRows}      \n`);

// Pairs where v2 exists (id had >= 2 versions).
const pairsWithTwo = [...byId.entries()]
  .filter(([, s]) => s.v1 != null && s.v2 != null)
  .map(([id, s]) => ({ id, v1Payload: s.v1, v2Payload: s.v2 }));
console.log(`  distinct ids seen: ${byId.size}`);
console.log(`  pairs with >= 2 versions: ${pairsWithTwo.length}`);

// Classify + re-hash.
const bucket = {
  byte_identical:          { count: 0, hash_still_differs: 0 },
  same_instant_diff_offset:{ count: 0, hash_still_differs: 0 },
  different_instant:       { count: 0, hash_still_differs: 0 },
  no_end_time:             { count: 0, hash_still_differs: 0 },
  unparseable:             { count: 0, hash_still_differs: 0 },
};
let endTimeStringDiffers = 0;
for (const p of pairsWithTwo) {
  const et1 = endTimeOf(p.v1Payload);
  const et2 = endTimeOf(p.v2Payload);
  const cls = classifyEndTime(et1, et2);
  bucket[cls].count += 1;
  if (et1 !== et2) endTimeStringDiffers += 1;
  const h1 = contentHash(p.v1Payload, "time_entries");
  const h2 = contentHash(p.v2Payload, "time_entries");
  if (h1 !== h2) bucket[cls].hash_still_differs += 1;
}

console.log("");
console.log("step 2: classification + hash-still-differs under NEW rule");
console.log(`  total pairs                                       : ${pairsWithTwo.length}`);
console.log(`  end_time string differs                           : ${endTimeStringDiffers}`);
console.log("");
console.log("  per-bucket (count / hash still differs under new rule):");
for (const k of ["byte_identical", "same_instant_diff_offset", "different_instant", "unparseable", "no_end_time"]) {
  const b = bucket[k];
  const pct = b.count > 0 ? ` (${(100 * b.hash_still_differs / b.count).toFixed(1)}%)` : "";
  console.log(`    ${k.padEnd(30)}  count=${String(b.count).padStart(6)}  hash_still_differs=${String(b.hash_still_differs).padStart(6)}${pct}`);
}

console.log("");
console.log("Acceptance #4:");
console.log(`  genuine (different_instant) hash still differs = ${bucket.different_instant.hash_still_differs}`);
console.log(`  Chat-Claude's prior measurement called ~370.`);
console.log(`  noise (same_instant_diff_offset) hash still differs = ${bucket.same_instant_diff_offset.hash_still_differs}`);
console.log(`  Noise should collapse to 0; real edits should be preserved.`);
process.exit(0);
