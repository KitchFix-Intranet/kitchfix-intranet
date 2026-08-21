// INV-P8b Part E - proof the pre-write asserts fire on seeded bad cases.
// Zero database access; pure in-memory unit test of the assert helpers.
//
// Cases:
//   1. superseded-split shape (INV-P8 parent 6a6c093207bd8eb94ef93ca4 replica)
//   2. non-USD row (CAD line replica)
//   3. clean population (both asserts pass)
//
// Exit code: 0 if all 3 behave as expected; 1 otherwise.

import {
  assertNoSupersededSplitParents,
  assertNoNonUsdAmountsSummed,
} from "../../src/lib/purchasingSpendAsserts.js";

let ok = true;
function log(name, expected, actual, detail) {
  const pass = expected === actual;
  if (!pass) ok = false;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  expected=${expected}  actual=${actual}  ${detail || ""}`);
}

// ── Case 1: superseded-split shape ─────────────────────────────────────
// INV-P8 case: parent Mongo id 6a6c093207bd8eb94ef93ca4 has three coexisting
// split sets [$311.40], [$155.70, $155.70], [$103.80, $103.80, $103.80] -
// six line rows all belonging to that ONE parent, stored sum $934.20,
// canonical amount $311.40.
console.log("Case 1: superseded-split shape");
{
  const parent = "6a6c093207bd8eb94ef93ca4";
  const mkLine = (idx, amount) => ({
    source_line_id: `rippling_spend:00000000-0000-0000-0000-00000000000${idx}`,
    amount,
  });
  const derivedRows = [
    mkLine(1, 311.40),
    mkLine(2, 155.70),
    mkLine(3, 155.70),
    mkLine(4, 103.80),
    mkLine(5, 103.80),
    mkLine(6, 103.80),
  ];
  const rawRowsByRippling = new Map();
  for (let i = 1; i <= 6; i++) {
    rawRowsByRippling.set(`00000000-0000-0000-0000-00000000000${i}`, {
      external_id: `${parent}__line_item_content_${i}`,
      currency: "USD",
    });
  }
  let threw = false, msg = "";
  try { assertNoSupersededSplitParents(derivedRows, rawRowsByRippling); }
  catch (e) { threw = true; msg = e.message; }
  log("superseded-split fires", true, threw, threw ? `msg starts: "${msg.slice(0, 100)}..."` : "did NOT throw");
}

// ── Case 2: non-USD amount ────────────────────────────────────────────
console.log("Case 2: non-USD amount");
{
  const derivedRows = [
    { source_line_id: "rippling_spend:cad-line-01", amount: 1549.34 },
    { source_line_id: "rippling_spend:usd-line-01", amount: 100.00 },
  ];
  const rawRowsByRippling = new Map();
  rawRowsByRippling.set("cad-line-01", { external_id: "parent01__x", currency: "CAD" });
  rawRowsByRippling.set("usd-line-01", { external_id: "parent01__x", currency: "USD" });
  let threw = false, msg = "";
  try { assertNoNonUsdAmountsSummed(derivedRows, rawRowsByRippling); }
  catch (e) { threw = true; msg = e.message; }
  log("non-USD fires", true, threw, threw ? `msg starts: "${msg.slice(0, 100)}..."` : "did NOT throw");
}

// ── Case 3: clean population (both asserts pass) ──────────────────────
console.log("Case 3: clean population");
{
  const derivedRows = [
    { source_line_id: "rippling_spend:clean-01", amount: 100.00 },
    { source_line_id: "rippling_spend:clean-02", amount: 50.00 },
    { source_line_id: "rippling_spend:clean-03", amount: 25.00 },
    { source_line_id: "rippling_spend:clean-04", amount: 25.00 },  // 2 lines same amount, ONE bucket, no shape
  ];
  const rawRowsByRippling = new Map();
  const parent = "abcdef0123456789abcdef01";
  rawRowsByRippling.set("clean-01", { external_id: `${parent}a__x`, currency: "USD" });
  rawRowsByRippling.set("clean-02", { external_id: `${parent}b__x`, currency: "USD" });
  rawRowsByRippling.set("clean-03", { external_id: `${parent}c__x`, currency: "USD" });
  rawRowsByRippling.set("clean-04", { external_id: `${parent}c__x`, currency: "USD" });
  let sThrow = false, fThrow = false;
  try { assertNoSupersededSplitParents(derivedRows, rawRowsByRippling); } catch { sThrow = true; }
  try { assertNoNonUsdAmountsSummed(derivedRows, rawRowsByRippling); } catch { fThrow = true; }
  log("superseded-split does NOT fire on clean", false, sThrow);
  log("non-USD does NOT fire on clean", false, fThrow);
}

// ── Case 4: bucketA - N identical lines (INV-P8 documented shape) ─────
// 106 parents in current corpus with 2 identical lines. This is ALSO a
// version-duplication shape - two lines that both claim to BE the parent.
// The superseded-split detector only catches multi-set coexistence; it
// does NOT catch bucketA (all-lines-equal). Owner ruling drives whether
// bucketA should also throw. Test documents current behaviour.
console.log("Case 4: bucketA (all-lines-equal, N=2) - documents current behaviour");
{
  const derivedRows = [
    { source_line_id: "rippling_spend:a-01", amount: 100.00 },
    { source_line_id: "rippling_spend:a-02", amount: 100.00 },
  ];
  const rawRowsByRippling = new Map();
  const parent = "bbbbbb0123456789abcdef01";
  rawRowsByRippling.set("a-01", { external_id: `${parent}__x`, currency: "USD" });
  rawRowsByRippling.set("a-02", { external_id: `${parent}__x`, currency: "USD" });
  let threw = false;
  try { assertNoSupersededSplitParents(derivedRows, rawRowsByRippling); }
  catch { threw = true; }
  log("bucketA does NOT fire (documented gap)", false, threw,
    "detector requires >= 2 distinct amount buckets; bucketA has 1 bucket. Owner rules whether this should also throw.");
}

console.log("");
console.log(ok ? "ALL EXPECTED BEHAVIOURS PRESENT" : "SOME BEHAVIOURS UNEXPECTED - REVIEW");
process.exit(ok ? 0 : 1);
