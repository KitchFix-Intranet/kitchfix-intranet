// Pagination-helper probe, 2026-08-28.
//
// Pure-function assertions for chunkKeys (extracted from fetchAllIn
// so the boundary behavior is testable without booting a Supabase
// client). Live-DB assertion at the bottom exercises fetchAllIn on
// rippling_raw_workers_latest with a >1000-key input to prove the
// helper returns full results where a bare .in(keyCol, bigArray)
// would truncate at 1000.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_pagination_helpers.mjs

import { createClient } from "@supabase/supabase-js";
import { chunkKeys, fetchAllIn } from "../../src/lib/rippling/paginate.js";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== chunkKeys pure behavior ===\n");

// Empty
assert("empty input -> empty output",
  JSON.stringify(chunkKeys([], 500)) === "[]");

// Single-chunk
assert("N below chunkSize -> one chunk of N",
  JSON.stringify(chunkKeys([1, 2, 3], 500)) === "[[1,2,3]]");

// Exact multiple
{
  const arr = Array.from({ length: 1000 }, (_, i) => i);
  const chunks = chunkKeys(arr, 500);
  assert("N = 2 x chunkSize -> two chunks of chunkSize",
    chunks.length === 2 && chunks[0].length === 500 && chunks[1].length === 500);
  assert("chunks tile the input in order (no gap, no overlap)",
    chunks[0][0] === 0 && chunks[0][499] === 499 && chunks[1][0] === 500 && chunks[1][499] === 999);
}

// Off-by-one
{
  const arr = Array.from({ length: 501 }, (_, i) => i);
  const chunks = chunkKeys(arr, 500);
  assert("N = chunkSize + 1 -> two chunks (500 + 1)",
    chunks.length === 2 && chunks[0].length === 500 && chunks[1].length === 1);
}

// chunkSize = 1
assert("chunkSize = 1 -> one chunk per element",
  JSON.stringify(chunkKeys([1, 2, 3], 1)) === "[[1],[2],[3]]");

// Zero / negative chunkSize should throw
{
  let threw = false;
  try { chunkKeys([1, 2, 3], 0); } catch { threw = true; }
  assert("chunkSize = 0 throws", threw);
}
{
  let threw = false;
  try { chunkKeys([1, 2, 3], -1); } catch { threw = true; }
  assert("chunkSize < 0 throws", threw);
}

console.log("");

// === live-DB assertion ===
//
// Load every rippling_id from rippling_raw_workers_latest (1129 rows
// as of 2026-08-28), then fetchAllIn the workers back and confirm we
// receive exactly the same set. A bare .in() would return 1000, so if
// this assertion passes, fetchAllIn is doing its job.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("=== live-DB assertion skipped (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY ABSENT) ===");
  process.exit(failures === 0 ? 0 : 1);
}

console.log("=== fetchAllIn against rippling_raw_workers_latest (live) ===\n");
const supa = createClient(url, key, { auth: { persistSession: false } });

// Ground truth: every rippling_id in the view. Paginated to defeat
// the 1000-cap here too (the probe cannot use the tool it's testing
// as its ground truth).
async function fetchAllIdsKeyset() {
  const ids = [];
  let last = null;
  while (true) {
    let q = supa.from("rippling_raw_workers_latest")
      .select("rippling_id")
      .order("rippling_id", { ascending: true })
      .limit(1000);
    if (last) q = q.gt("rippling_id", last);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) ids.push(r.rippling_id);
    last = data[data.length - 1].rippling_id;
    if (data.length < 1000) break;
  }
  return ids;
}
const truthIds = await fetchAllIdsKeyset();
console.log(`  ground truth: ${truthIds.length} distinct rippling_ids`);

// Bare .in() control - proves the failure mode exists. Two flavors:
//   URL length overflow: Supabase rejects with 400 Bad Request when
//     the .in(...) list crosses the URL byte limit (~2KB). Not silent
//     but not a caller-friendly error either.
//   Silent truncation at 1000: when the .in list fits in the URL but
//     the response would exceed the 1000-row cap.
// Either way, fetchAllIn defeats both.
const bareQ = await supa.from("rippling_raw_workers_latest")
  .select("rippling_id")
  .in("rippling_id", truthIds);
let bareFailureMode = "none";
let bareCount = 0;
if (bareQ.error) {
  bareFailureMode = /request/i.test(bareQ.error.message) ? "url-overflow" : "error";
  console.log(`  bare .in(...${truthIds.length} ids) FAILED: ${bareQ.error.message}  (URL-overflow failure mode)`);
} else {
  bareCount = (bareQ.data || []).length;
  if (bareCount < truthIds.length) bareFailureMode = "silent-truncation";
  console.log(`  bare .in(...${truthIds.length} ids) returned: ${bareCount} rows${bareCount < truthIds.length ? "  (silent-truncation failure mode)" : ""}`);
}

// The helper - should return the full set regardless of failure mode
// the bare call hit.
const helpRows = await fetchAllIn(supa, "rippling_raw_workers_latest", "rippling_id", {
  keyCol: "rippling_id",
  keyValues: truthIds,
});
const helpIds = new Set(helpRows.map(r => r.rippling_id));
console.log(`  fetchAllIn returned: ${helpRows.length} rows (distinct: ${helpIds.size})`);

assert(`fetchAllIn returns every ground-truth id (expected ${truthIds.length}, got ${helpIds.size})`,
  helpIds.size === truthIds.length);
assert(`fetchAllIn set == ground-truth set`,
  truthIds.every(id => helpIds.has(id)));
assert(`bare .in() fails (either URL-overflow or silent-truncation) at ${truthIds.length} keys - fetchAllIn is the fix`,
  bareFailureMode !== "none");

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass. chunkKeys tiles correctly + fetchAllIn defeats the 1000-cap on .in().`);
