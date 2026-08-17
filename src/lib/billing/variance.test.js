// ═══════════════════════════════════════════════════════════════════
// variance unit tests - the digit-drop advisory truth table.
// ═══════════════════════════════════════════════════════════════════
//
// Run with: node --test src/lib/billing/variance.test.js
//
// Rule (Kevin 2026-08-17): fires when ALL FIVE hold -
//   1. entered > 0
//   2. entered < projected
//   3. entered * 10 <= projected  (order-of-magnitude keystroke)
//   4. projected >= 30
//   5. !isFlatFee

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  shouldFlagVariance,
  VARIANCE_MIN_PROJECTED,
  VARIANCE_DIGIT_DROP_MULT,
} from "./variance.js";

describe("shouldFlagVariance - the canonical digit-drop", () => {
  test("fires on 110 -> 11 (exactly the missing-digit shape)", () => {
    const r = shouldFlagVariance({ projected: 110, entered: 11, isFlatFee: false });
    assert.ok(r);
    assert.equal(r.message, "Projected 110, entered 11 - is a digit missing?");
  });

  test("fires on 200 -> 20 (10x error)", () => {
    const r = shouldFlagVariance({ projected: 200, entered: 20, isFlatFee: false });
    assert.ok(r);
    assert.equal(r.message, "Projected 200, entered 20 - is a digit missing?");
  });

  test("fires on 30 -> 3 (right at the projected >= 30 threshold)", () => {
    const r = shouldFlagVariance({ projected: 30, entered: 3, isFlatFee: false });
    assert.ok(r);
  });
});

describe("shouldFlagVariance - travel days + normal swing stay quiet", () => {
  test("110 -> 60 is a travel day, not a typo", () => {
    // entered 60, projected 110. 60 * 10 = 600 > 110 -> quiet.
    const r = shouldFlagVariance({ projected: 110, entered: 60, isFlatFee: false });
    assert.equal(r, null);
  });

  test("110 -> 96 (small realistic swing)", () => {
    const r = shouldFlagVariance({ projected: 110, entered: 96, isFlatFee: false });
    assert.equal(r, null);
  });

  test("100 -> 55 stays quiet under the narrow rule", () => {
    // The old (rejected) rule fired here; the digit-drop rule does not.
    const r = shouldFlagVariance({ projected: 100, entered: 55, isFlatFee: false });
    assert.equal(r, null);
  });

  test("200 -> 180 stays quiet (large-service small swing)", () => {
    const r = shouldFlagVariance({ projected: 200, entered: 180, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - zero entered never fires", () => {
  // Zero is either a no-service or a not-yet-entered day. Other UI
  // owns those signals; the variance flag stays out of them.
  test("110 -> 0 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 110, entered: 0, isFlatFee: false });
    assert.equal(r, null);
  });

  test("300 -> 0 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 300, entered: 0, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - overshoot never fires", () => {
  // Entered above projected is a projections-calibration issue, not
  // an entry error.
  test("110 -> 150 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 110, entered: 150, isFlatFee: false });
    assert.equal(r, null);
  });

  test("50 -> 120 stays quiet (Regular Snack pattern, TXR - AZ)", () => {
    const r = shouldFlagVariance({ projected: 50, entered: 120, isFlatFee: false });
    assert.equal(r, null);
  });

  test("entered exactly equal to projected stays quiet", () => {
    const r = shouldFlagVariance({ projected: 100, entered: 100, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - small projections stay quiet", () => {
  // Projected < 30 - percentage math is noisy on tiny services.
  test("20 -> 2 stays quiet (would be digit-drop shape but proj too small)", () => {
    const r = shouldFlagVariance({ projected: 20, entered: 2, isFlatFee: false });
    assert.equal(r, null);
  });

  test("29 -> 1 stays quiet (just below threshold)", () => {
    const r = shouldFlagVariance({ projected: 29, entered: 1, isFlatFee: false });
    assert.equal(r, null);
  });

  test("15 -> 1 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 15, entered: 1, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - flat-fee services never fire", () => {
  test("Coffee Service 1 -> 2 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 1, entered: 2, isFlatFee: true });
    assert.equal(r, null);
  });

  test("Coffee Service 100 -> 10 stays quiet (would be digit-drop shape but flat-fee)", () => {
    const r = shouldFlagVariance({ projected: 100, entered: 10, isFlatFee: true });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - projection edge cases", () => {
  test("projected null stays quiet", () => {
    const r = shouldFlagVariance({ projected: null, entered: 11, isFlatFee: false });
    assert.equal(r, null);
  });

  test("projected undefined stays quiet", () => {
    const r = shouldFlagVariance({ projected: undefined, entered: 11, isFlatFee: false });
    assert.equal(r, null);
  });

  test("projected NaN stays quiet", () => {
    const r = shouldFlagVariance({ projected: NaN, entered: 11, isFlatFee: false });
    assert.equal(r, null);
  });

  test("projected 0 stays quiet", () => {
    const r = shouldFlagVariance({ projected: 0, entered: 11, isFlatFee: false });
    assert.equal(r, null);
  });

  test("projected negative stays quiet (defensive)", () => {
    const r = shouldFlagVariance({ projected: -50, entered: 11, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - entered edge cases", () => {
  test("entered NaN stays quiet", () => {
    const r = shouldFlagVariance({ projected: 100, entered: NaN, isFlatFee: false });
    assert.equal(r, null);
  });

  test("entered negative stays quiet", () => {
    const r = shouldFlagVariance({ projected: 100, entered: -5, isFlatFee: false });
    assert.equal(r, null);
  });
});

describe("shouldFlagVariance - threshold constants exposed", () => {
  test("VARIANCE_MIN_PROJECTED is 30", () => {
    assert.equal(VARIANCE_MIN_PROJECTED, 30);
  });
  test("VARIANCE_DIGIT_DROP_MULT is 10", () => {
    assert.equal(VARIANCE_DIGIT_DROP_MULT, 10);
  });
});
