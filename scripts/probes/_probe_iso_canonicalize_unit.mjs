#!/usr/bin/env node
/**
 * Unit probe over the two sample time_entries strings Chat-Claude
 * provided from id 6908bb54f896bb023337ffae:
 *
 *   v1 "2025-11-03T17:25:00+00:00"
 *   v2 "2025-11-03T12:25:00-05:00"
 *
 * These denote the SAME INSTANT. After the canonicalization in
 * src/lib/rippling.js _canonicalizeScalar, both must produce one
 * output. Pre-fix they produce two different byte strings and
 * therefore two different content hashes.
 *
 * Also exercises the strict-match guard: strings that look vaguely
 * datetime-ish but should NOT be transformed must pass through
 * byte-identical. A loose Date.parse() on every string would
 * silently rewrite date-only ids, numeric ids, free text, etc.
 *
 * READ-ONLY. No network, no DB.
 *
 * Exit:
 *   0  every assertion passed
 *   1  any assertion failed
 */
import { contentHash } from "../../src/lib/rippling.js";

// `kind: "workers"` is one of the shapes in HASH_EXCLUDE_TOP; the
// payload shape is arbitrary - we just need any valid kind so the
// top-level excludes get a bound Set.
const KIND = "workers";

let failed = 0;
function assertEq(name, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? "OK" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`      got : ${JSON.stringify(got)}`);
    console.log(`      want: ${JSON.stringify(want)}`);
    failed += 1;
  }
}

console.log("1. SAME-INSTANT canonicalization");
const h1 = contentHash({ end_time: "2025-11-03T17:25:00+00:00" }, KIND);
const h2 = contentHash({ end_time: "2025-11-03T12:25:00-05:00" }, KIND);
assertEq("sample-pair hashes equal", h1, h2);

console.log("");
console.log("2. Guard: non-datetime strings must pass through byte-identical");
// If any of these got canonicalized, the two sides would hash the
// same when their raw strings differ byte-for-byte. We assert the
// hash DIFFERS to prove they were NOT transformed.
const nonDtPairs = [
  ["date-only",       "2026-11-03",                 "2026-11-04"],
  ["duration",        "P1D",                        "P2D"],
  ["numeric id",      "1700000000",                 "1700000001"],
  ["free text",       "Some text",                  "Different text"],
  ["no-offset local", "2025-11-03T17:25:00",        "2025-11-03T17:25:01"],
  ["partial ISO",     "2025-11-03T17:25",           "2025-11-03T17:26"],
];
for (const [name, a, b] of nonDtPairs) {
  const ha = contentHash({ v: a }, KIND);
  const hb = contentHash({ v: b }, KIND);
  const ok = ha !== hb;
  console.log(`  ${ok ? "OK" : "FAIL"}  ${name}: distinct inputs hash distinct`);
  if (!ok) failed += 1;
}

console.log("");
console.log("3. Datetime equivalences (same instant, different form)");
const sameInstant = [
  ["+00:00 vs Z",       "2025-11-03T17:25:00+00:00", "2025-11-03T17:25:00Z"],
  ["+00:00 vs -05:00",  "2025-11-03T17:25:00+00:00", "2025-11-03T12:25:00-05:00"],
  ["frac vs no-frac Z", "2025-11-03T17:25:00.000Z",  "2025-11-03T17:25:00Z"],
  ["frac 3 vs frac 6",  "2025-11-03T17:25:00.000Z",  "2025-11-03T17:25:00.000000Z"],
];
for (const [name, a, b] of sameInstant) {
  const ha = contentHash({ v: a }, KIND);
  const hb = contentHash({ v: b }, KIND);
  const ok = ha === hb;
  console.log(`  ${ok ? "OK" : "FAIL"}  ${name}: same-instant inputs collapse to one hash`);
  if (!ok) failed += 1;
}

console.log("");
console.log("4. Datetime genuine differences must still hash distinct");
const realEdits = [
  ["one minute later", "2025-11-03T17:25:00Z", "2025-11-03T17:26:00Z"],
  ["one hour later",   "2025-11-03T17:25:00+00:00", "2025-11-03T18:25:00+00:00"],
  ["different offset AND wall-time", "2025-11-03T17:25:00+00:00", "2025-11-03T17:25:00-05:00"],
];
for (const [name, a, b] of realEdits) {
  const ha = contentHash({ v: a }, KIND);
  const hb = contentHash({ v: b }, KIND);
  const ok = ha !== hb;
  console.log(`  ${ok ? "OK" : "FAIL"}  ${name}: real edit still produces a new hash`);
  if (!ok) failed += 1;
}

console.log("");
if (failed === 0) {
  console.log("probe PASS: all canonicalization assertions held.");
  process.exit(0);
}
console.log(`probe FAIL: ${failed} assertion(s) failed above.`);
process.exit(1);
