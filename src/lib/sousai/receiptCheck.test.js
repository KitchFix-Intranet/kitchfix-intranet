// ═══════════════════════════════════════════════════════════════════════════
// receiptCheck unit tests
// ═══════════════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/sousai/receiptCheck.test.js
//
// Covers:
//   - normalizeNumeric round-trip (the 2026-08-04 M1 root-cause fix).
//   - Date / ordinal / quoted exemptions via maskExempt (indirectly, through
//     extractAnswerNumbers + checkReceipts).
//   - Phone-format exemption (round 0b Part 2): a payload phone stored as
//     "7042995170" against an answer that presents it as "704-299-5170"
//     must not flag as three separate fabrications. This is the Bill
//     Hofmann case from live testing.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNumeric,
  extractAnswerNumbers,
  extractPayloadNumbers,
  checkReceipts,
  maskGroundedPhones,
  maskCalculatedShares,
} from "./receiptCheck.js";

// Fabricate a minimal trajectory shape - checkReceipts only reads step.rawResult.
function traj(...rawResults) {
  return rawResults.map((r) => ({ tool: "test", rawResult: r }));
}

// ── normalizeNumeric round-trip ─────────────────────────────────────────────
describe("normalizeNumeric", () => {
  test("collapses trailing zeros to match Number() stringification", () => {
    assert.equal(normalizeNumeric("1269807.30"), "1269807.3");
    assert.equal(normalizeNumeric("50.00"), "50");
  });
  test("strips currency and percent decorators", () => {
    assert.equal(normalizeNumeric("$244,954"), "244954");
    assert.equal(normalizeNumeric("25%"), "25");
  });
});

// ── Phone-format exemption ──────────────────────────────────────────────────
describe("maskGroundedPhones", () => {
  const cases = [
    ["hyphen form", "call Bill at 704-299-5170.", "704-299-5170"],
    ["dot form",    "phone: 704.299.5170",       "704.299.5170"],
    ["paren form",  "call (704) 299-5170 today", "(704) 299-5170"],
  ];
  for (const [name, input, cluster] of cases) {
    test(`masks a payload-matched phone cluster (${name})`, () => {
      const payload = new Set(["7042995170"]);
      const masked = maskGroundedPhones(input, payload);
      // Length preserved (position math depends on this).
      assert.equal(masked.length, input.length);
      // Cluster no longer present.
      assert.equal(masked.includes(cluster), false, `cluster "${cluster}" should have been masked: ${JSON.stringify(masked)}`);
      // No digits in the masked span.
      const clusterStart = input.indexOf(cluster);
      const clusterEnd = clusterStart + cluster.length;
      const maskedSpan = masked.slice(clusterStart, clusterEnd);
      assert.equal(/\d/.test(maskedSpan), false, `masked span should have no digits: ${JSON.stringify(maskedSpan)}`);
    });
  }
  test("leaves an unmatched phone-shaped cluster untouched", () => {
    const payload = new Set(["1234567890"]);
    const masked = maskGroundedPhones("call 704-299-5170", payload);
    assert.equal(masked, "call 704-299-5170");
  });
});

// ── End-to-end: checkReceipts with phone in the answer ──────────────────────
describe("checkReceipts - phone-format exemption (round 0b Part 2)", () => {
  test("Bill Hofmann case: payload 7042995170 vs answer 704-299-5170 does not flag", () => {
    const trajectory = traj({
      contacts: [{ name: "Bill Hofmann", role: "RDO", phone: "7042995170" }],
      loaded: "2026-08-04",
    });
    const answer = "Bill Hofmann is your RDO. Call him at 704-299-5170.\n\nSource: leadership directory (loaded 2026-08-04).";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true, `should pass; missing was ${JSON.stringify(check.missing)}`);
    assert.deepEqual(check.missing, []);
  });
  test("Fabricated phone (no payload match) still flags the digit-groups", () => {
    const trajectory = traj({
      contacts: [{ name: "Bill Hofmann", role: "RDO", phone: "7042995170" }],
    });
    // Answer states a different phone number that isn't in the payload -
    // the check must catch the fabrication.
    const answer = "Bill Hofmann. Call 555-123-4567.";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, false, "fabricated phone must still flag");
    // At least one digit group from the fake number must appear in misses.
    const hitAny = check.missing.some((m) => ["555", "123", "4567"].includes(m));
    assert.equal(hitAny, true, `expected one of 555/123/4567 in misses, got ${JSON.stringify(check.missing)}`);
  });
  test("Phone with matching thousands separator variant matches payload number too", () => {
    // Guard against the phone regex accidentally consuming a normal 10-digit
    // number. The regex requires a separator between groups, so pure
    // "7042995170" without punctuation should NOT be phone-masked (falls
    // through to the plain payload comparison, which handles it fine).
    const trajectory = traj({ id: "7042995170" });
    const answer = "See id 7042995170.";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true);
  });
});

// ── Line-8 calculation exception (round 0b Part 3 follow-up) ──────────────
describe("checkReceipts - labeled-calculation exemption", () => {
  test("percentage output masked when both inputs trace to payload", () => {
    // Live 2026-08-04 case: 6183 and 30477 both in payload; 20.3 is the
    // computed share (6183 / 30477 * 100). Model wrote "20.3% (calculated:
    // 6,183 / 30,477)" - the check must not flag 20.3.
    const trajectory = traj({ cin_az_meals: 6183, portfolio_total_meals: 30477 });
    const answer = "CIN-AZ share was 20.3% (calculated: 6,183 / 30,477).";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true, `should pass; missing=${JSON.stringify(check.missing)}`);
  });
  test("percentage output NOT masked when inputs are fabricated", () => {
    // Same shape but inputs 999 and 1234 not in payload - the mask must
    // not fire, and 20.3 must still flag as unverified.
    const trajectory = traj({ some_other_figure: 42 });
    const answer = "Share was 20.3% (calculated: 999 / 1234).";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, false, "fabricated inputs must not qualify for the exemption");
  });
  test("labeled calculation via unicode divide sign (÷)", () => {
    const trajectory = traj({ a: 100, b: 400 });
    const answer = "The share is 25% (calculated: 100 ÷ 400).";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true, `should pass; missing=${JSON.stringify(check.missing)}`);
  });
  test("Calculated: A (label) ÷ B (label) = C% shape (with inline parentheticals)", () => {
    // Live 2026-08-04 pattern: model wrote the calculation with inline
    // parenthetical labels between the operands and the divide sign.
    // The strict `(calculated: A ÷ B)` regex missed this - the receipt
    // check then flagged the output as unverified. The window-based
    // matcher must handle it.
    const trajectory = traj({ cin_az: 6183, portfolio: 30477 });
    const answer =
      "**CIN - AZ represented 20.3% of February portfolio breakfast meals.**\n\n" +
      "Calculated: 6,183 (CIN - AZ actual) ÷ 30,477 (portfolio actual) = **20.3%**\n\n" +
      "Source: SC tools (PG live)";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true, `should pass; missing=${JSON.stringify(check.missing)}`);
  });
});

// ── Regression: date exemption still works ──────────────────────────────────
describe("checkReceipts - date exemption preserved", () => {
  test("standalone year in prose is exempt", () => {
    const trajectory = traj({ figure: 100 });
    const answer = "In 2026, the count was 100.";
    const check = checkReceipts(answer, trajectory);
    assert.equal(check.pass, true, `misses: ${JSON.stringify(check.missing)}`);
  });
});
