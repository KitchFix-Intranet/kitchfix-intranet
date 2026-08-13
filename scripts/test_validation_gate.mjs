// Standalone test cases for the Task 3 Fix 1 validation gate helpers
// exported from src/lib/dataStore/invoice.js.
//
// Run:
//   node --import ./scripts/_setup/register-aliases.mjs \
//        scripts/test_validation_gate.mjs
//
// No test infra dep - just assertions + exit code. Non-zero on any fail.

import { strict as assert } from "node:assert";
import {
  evaluateLineArithmetic,
  evaluateInvoiceOverextraction,
  EP_ABS_TOLERANCE,
  EP_REL_TOLERANCE,
  INVOICE_OVEREXTRACTION_THRESHOLD,
} from "../src/lib/dataStore/invoice.js";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

console.log(`\n[test] constants: EP_ABS=${EP_ABS_TOLERANCE} EP_REL=${EP_REL_TOLERANCE} INVOICE_TH=${INVOICE_OVEREXTRACTION_THRESHOLD}\n`);

// ── evaluateLineArithmetic ──
console.log("[test] evaluateLineArithmetic");

t("clean row passes", () => {
  const r = evaluateLineArithmetic({ quantity: 2, unitPrice: 10, extendedPrice: 20 });
  assert.equal(r.needsReview, false);
  assert.equal(r.reason, null);
});

t("penny rounding passes (0.01 diff)", () => {
  const r = evaluateLineArithmetic({ quantity: 3, unitPrice: 4.99, extendedPrice: 14.98 });
  assert.equal(r.needsReview, false);
});

t("small line under abs tolerance passes ($4 diff, expected $100)", () => {
  // qty*up = 100, ep = 104, diff = 4 < max(5, 2) = 5. PASS.
  const r = evaluateLineArithmetic({ quantity: 10, unitPrice: 10, extendedPrice: 104 });
  assert.equal(r.needsReview, false);
});

t("small line above abs tolerance fails ($6 diff, expected $100)", () => {
  // qty*up = 100, ep = 106, diff = 6 > max(5, 2) = 5. FAIL.
  const r = evaluateLineArithmetic({ quantity: 10, unitPrice: 10, extendedPrice: 106 });
  assert.equal(r.needsReview, true);
  assert.equal(r.reason, "ep_qty_up_mismatch");
});

t("large line above rel tolerance fails (3% diff on $10k)", () => {
  // qty*up = 10000, ep = 10300, diff = 300 > max(5, 200) = 200. FAIL.
  const r = evaluateLineArithmetic({ quantity: 100, unitPrice: 100, extendedPrice: 10300 });
  assert.equal(r.needsReview, true);
  assert.equal(r.reason, "ep_qty_up_mismatch");
});

t("large line under rel tolerance passes (1.5% diff on $10k)", () => {
  // qty*up = 10000, ep = 10150, diff = 150 < max(5, 200) = 200. PASS.
  const r = evaluateLineArithmetic({ quantity: 100, unitPrice: 100, extendedPrice: 10150 });
  assert.equal(r.needsReview, false);
});

t("null qty short-circuits (no tag)", () => {
  const r = evaluateLineArithmetic({ quantity: null, unitPrice: 10, extendedPrice: 20 });
  assert.equal(r.needsReview, false);
});

t("null unitPrice short-circuits", () => {
  const r = evaluateLineArithmetic({ quantity: 2, unitPrice: null, extendedPrice: 20 });
  assert.equal(r.needsReview, false);
});

t("null extendedPrice short-circuits", () => {
  const r = evaluateLineArithmetic({ quantity: 2, unitPrice: 10, extendedPrice: null });
  assert.equal(r.needsReview, false);
});

// ── evaluateInvoiceOverextraction ──
console.log("\n[test] evaluateInvoiceOverextraction");

t("sum equals header total: false", () => {
  const lines = [{ extendedPrice: 50 }, { extendedPrice: 50 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 100), false);
});

t("sum 10% over: false (under threshold)", () => {
  const lines = [{ extendedPrice: 110 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 100), false);
});

t("sum 20% over: true (over 15% threshold)", () => {
  const lines = [{ extendedPrice: 120 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 100), true);
});

t("sum 50% over (duplicate lines scenario): true", () => {
  const lines = [{ extendedPrice: 100 }, { extendedPrice: 100 }, { extendedPrice: 100 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 200), true);
});

t("null header: no tag", () => {
  const lines = [{ extendedPrice: 100 }];
  assert.equal(evaluateInvoiceOverextraction(lines, null), false);
});

t("zero header: no tag", () => {
  const lines = [{ extendedPrice: 100 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 0), false);
});

t("null extended_price rows sum as 0", () => {
  const lines = [{ extendedPrice: null }, { extendedPrice: 100 }];
  assert.equal(evaluateInvoiceOverextraction(lines, 100), false);
});

console.log(`\n[test] ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
