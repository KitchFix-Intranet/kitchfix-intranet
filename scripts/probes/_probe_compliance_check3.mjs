#!/usr/bin/env node
/*
 * Prove Check 3 (site == sum(people)) and Check 2 (east+west == total)
 * FIRE on a seeded mismatch. CC_PROMPT B: "assert it. Prove it fires
 * on a seeded mismatch." Every clean render is a null result; only a
 * seeded mismatch that throws is evidence.
 *
 * Method:
 *   1. Fetch the real /api/kpi/purchasing?account=ALL payload.
 *   2. Call the assertion clean (should NOT throw).
 *   3. Mutate the first site's people[0].charges by +1 (seeded mismatch).
 *      Call the assertion (MUST throw).
 *   4. Mutate the region_split.east.count by +1 (seeded mismatch).
 *      Call the assertion (MUST throw).
 *   5. Exit 0 only when both throw with the expected message.
 */
import { assertSitePeopleParity, assertRegionParity } from "../../src/app/kpi/purchasing/lib/complianceAsserts.js";

const BASE = process.env.KPI_BASE || "http://localhost:3022";

async function fetchAll() {
  const r = await fetch(`${BASE}/api/kpi/purchasing?account=ALL`, {
    headers: { "X-Test-Mode": "1" },
  });
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()).compliance;
}

function tryThrow(label, fn) {
  try {
    fn();
    console.error(`FAIL: ${label} did NOT throw`);
    process.exit(1);
  } catch (err) {
    console.log(`OK:   ${label} threw: ${err.message.slice(0, 80)}...`);
  }
}

function tryNoThrow(label, fn) {
  try {
    fn();
    console.log(`OK:   ${label} did not throw`);
  } catch (err) {
    console.error(`FAIL: ${label} threw unexpectedly: ${err.message}`);
    process.exit(1);
  }
}

const c = await fetchAll();
if (!c) { console.error("FAIL: no compliance block on ALL"); process.exit(1); }
console.log(`clean payload: total_count=${c.total_count} amount=${c.total_amount} sites=${c.site_rows.length} region_split=${c.region_split ? "present" : "null"}`);

// Baseline: real payload passes both.
tryNoThrow("Check 3 baseline", () => assertSitePeopleParity(c.site_rows));
tryNoThrow("Check 2 baseline", () => assertRegionParity(c.region_split, c.total_count, c.total_amount));

// Seed Check 3 mismatch: first site's first person +1 charge.
const seed3 = structuredClone(c);
if (seed3.site_rows[0]?.people?.[0]) {
  seed3.site_rows[0].people[0].charges += 1;
  tryThrow("Check 3 seeded (site people charges +1)", () => assertSitePeopleParity(seed3.site_rows));
} else {
  console.error("FAIL: no first site/people to seed on");
  process.exit(1);
}

// Seed Check 3 amount mismatch too - separate seed.
const seed3b = structuredClone(c);
if (seed3b.site_rows[0]?.people?.[0]) {
  seed3b.site_rows[0].people[0].amount += 100.00;
  tryThrow("Check 3 seeded (site people amount +$100)", () => assertSitePeopleParity(seed3b.site_rows));
}

// Seed Check 2 mismatch: east.count +1.
const seed2 = structuredClone(c);
if (seed2.region_split?.east) {
  seed2.region_split.east.count += 1;
  tryThrow("Check 2 seeded (region east count +1)", () => assertRegionParity(seed2.region_split, seed2.total_count, seed2.total_amount));
} else {
  console.error("FAIL: no region_split to seed on (ALL scope should populate it)");
  process.exit(1);
}

const seed2b = structuredClone(c);
if (seed2b.region_split?.east) {
  seed2b.region_split.east.amount += 500.00;
  tryThrow("Check 2 seeded (region east amount +$500)", () => assertRegionParity(seed2b.region_split, seed2b.total_count, seed2b.total_amount));
}

console.log("\nAll checks pass: baselines clean, seeded mismatches throw.");
