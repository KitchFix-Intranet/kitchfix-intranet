// Fixture parity - line-level equality against 4 live QBO invoices.
// Acceptance B3 for PR-B. Run via: npm run test:unit
//
// Strategy per _helpers.mjs header: reverse-engineer synthetic
// sc_daily_revenue rows from each fixture (parses aggregate
// descriptions, splits per-day per-service), then round-trip through
// buildInvoicePayload and assert exact-line equality.

import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePayload } from "../buildInvoicePayload.js";
import {
  loadFixture,
  synthRowsFromInvoice,
  normaliseLines,
  preTaxSubtotal,
  TXR_AZ_ACCOUNT_MAP, TXR_AZ_SERVICE_MAP,
  CIN_AZ_ACCOUNT_MAP, CIN_AZ_SERVICE_MAP,
  NAME_TO_SVC_ID,
} from "./_helpers.mjs";

// Period metadata reflects the fiscal calendar recon on 2026-08-07:
//   P8 Week 1 = 2026-07-13..07-19
//   P8 Week 2 = 2026-07-20..07-26
//   P8 Week 3 = 2026-07-27..08-02
//   P8 Week 4 = 2026-08-03..08-09
function periodMapForRange(first, lastInclusive) {
  const map = new Map();
  const start = new Date(`${first}T12:00:00Z`);
  const end = new Date(`${lastInclusive}T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    let week_label;
    if (iso >= "2026-07-13" && iso <= "2026-07-19") week_label = "Week 1";
    else if (iso >= "2026-07-20" && iso <= "2026-07-26") week_label = "Week 2";
    else if (iso >= "2026-07-27" && iso <= "2026-08-02") week_label = "Week 3";
    else if (iso >= "2026-08-03" && iso <= "2026-08-09") week_label = "Week 4";
    else week_label = null;
    map.set(iso, { period: "8", week_label });
  }
  return map;
}

// Some fixtures carry KNOWN F1 defects (duplicated-and-edit
// stale-description bugs from the recon audit). Where the builder
// produces a CORRECT description that the invoice got wrong, the
// test asserts the CORRECT value and logs the deviation for the
// PR report. Skipping the description equality would hide the bug;
// asserting the fixture's WRONG value would encode the bug.
function assertLineEqual(actual, expected, prefix, knownDefects = new Map()) {
  assert.equal(actual.ServiceDate, expected.ServiceDate, `${prefix} ServiceDate`);
  assert.equal(actual.ItemRefId, expected.ItemRefId, `${prefix} ItemRefId`);
  assert.equal(actual.UnitPrice, expected.UnitPrice, `${prefix} UnitPrice`);
  assert.equal(actual.Qty, expected.Qty, `${prefix} Qty`);
  assert.equal(actual.Amount, expected.Amount, `${prefix} Amount`);
  // Description: allow override for known F1 defects in fixtures
  // (assert builder's CORRECT string instead of the buggy fixture
  // string).
  const key = `${prefix}::description`;
  const overrideDesc = knownDefects.get(key);
  if (overrideDesc != null) {
    assert.equal(actual.Description, overrideDesc, `${prefix} Description (F1 defect override)`);
  } else {
    assert.equal(actual.Description, expected.Description, `${prefix} Description`);
  }
  assert.equal(actual.TaxCodeRef, expected.TaxCodeRef, `${prefix} TaxCodeRef`);
}

function assertLinesEqual(actualLines, expectedLines, invoiceLabel, knownDefects = new Map()) {
  assert.equal(
    actualLines.length,
    expectedLines.length,
    `${invoiceLabel}: expected ${expectedLines.length} lines, got ${actualLines.length}\n` +
    `  actual: ${JSON.stringify(actualLines.slice(0, 3))}\n  expected: ${JSON.stringify(expectedLines.slice(0, 3))}`
  );
  for (let i = 0; i < actualLines.length; i++) {
    assertLineEqual(actualLines[i], expectedLines[i], `${invoiceLabel} L${i + 1}`, knownDefects);
  }
}

// ─── K300168954 - TXR - AZ weekly Mon 2026-07-27 -> Sun 2026-08-02 ───
test("parity: K300168954 (TXR - AZ weekly, 6 meal days, 6 snack days)", () => {
  const fixture = loadFixture("qbo_K300168954_txr_wk_0727.json");
  const periodByDate = periodMapForRange("2026-07-27", "2026-08-02");
  const rows = synthRowsFromInvoice(fixture, {
    accountKey:  "TXR - AZ",
    serviceMap:  TXR_AZ_SERVICE_MAP,
    nameToSvc:   NAME_TO_SVC_ID["TXR - AZ"],
    periodByDate,
  });

  const { invoices, warnings } = buildInvoicePayload({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    rows,
    accountMap: TXR_AZ_ACCOUNT_MAP,
    serviceMap: TXR_AZ_SERVICE_MAP,
  });

  assert.equal(invoices.length, 1, "TXR - AZ weekly emits 1 invoice");
  const inv = invoices[0];
  assert.equal(inv.TxnDate, "2026-08-02", "TxnDate = closing Sunday");
  assert.equal(inv.CustomerRef.value, "19000");
  assert.equal(inv.TxnTaxDetail.TxnTaxCodeRef.value, "36");
  assert.equal(warnings.length, 0, "no warnings expected");

  const actual = normaliseLines(inv);
  const expected = normaliseLines(fixture);
  assertLinesEqual(actual, expected, "K300168954");

  // Subtotal cent-level equality.
  assert.equal(preTaxSubtotal(actual), preTaxSubtotal(expected), "pre-tax subtotal");
});

// ─── K300168897 - TXR - AZ weekly Mon 2026-07-20 -> Sun 2026-07-26 ───
test("parity: K300168897 (TXR - AZ weekly, prior week)", () => {
  const fixture = loadFixture("qbo_K300168897_txr_wk_0720.json");
  const periodByDate = periodMapForRange("2026-07-20", "2026-07-26");
  const rows = synthRowsFromInvoice(fixture, {
    accountKey: "TXR - AZ",
    serviceMap: TXR_AZ_SERVICE_MAP,
    nameToSvc:  NAME_TO_SVC_ID["TXR - AZ"],
    periodByDate,
  });

  const { invoices, warnings } = buildInvoicePayload({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-20",
    rows,
    accountMap: TXR_AZ_ACCOUNT_MAP,
    serviceMap: TXR_AZ_SERVICE_MAP,
  });

  assert.equal(invoices.length, 1);
  const inv = invoices[0];
  assert.equal(inv.TxnDate, "2026-07-26");
  assert.equal(warnings.length, 0);

  const actual = normaliseLines(inv);
  const expected = normaliseLines(fixture);

  // KNOWN F1 defect from the QB API recon audit (docs/audits/
  // QB_API_RECON_2026-08-06.md §5): this invoice's line at
  // 2026-07-21 (qty 250 at 14.29, amount 3572.50) has Sebastian's
  // stale duplicated description "Total = 175". Our builder
  // produces the correct "Total = 250" from the components. The
  // parity check accepts the builder's CORRECT value here; the
  // fixture's WRONG value is the whole reason this arc exists.
  // Locate the affected line by (ServiceDate, ItemRefId, Qty)
  // signature.
  const idx = expected.findIndex((l) =>
    l.ServiceDate === "2026-07-21" && l.ItemRefId === "3333" && l.Qty === 250 &&
    l.Description === "Breakfast - 50, Lunch - 125, & Dinner - 75. Total = 175."
  );
  const knownDefects = new Map();
  if (idx >= 0) {
    knownDefects.set(`K300168897 L${idx + 1}::description`,
      "Breakfast - 50, Lunch - 125, & Dinner - 75. Total = 250.");
  }
  assertLinesEqual(actual, expected, "K300168897", knownDefects);
  assert.equal(preTaxSubtotal(actual), preTaxSubtotal(expected));
});

// ─── K300168899 (main) + K300168900 (rehab) - CIN - AZ biweekly pair ───
test("parity: K300168899 + K300168900 (CIN - AZ biweekly pair 07-13..07-26)", () => {
  const mainFix  = loadFixture("qbo_K300168899_cin_pair_0713_main.json");
  const rehabFix = loadFixture("qbo_K300168900_cin_pair_0713_rehab.json");
  const periodByDate = periodMapForRange("2026-07-13", "2026-07-26");

  // Combine synthetic rows from both fixtures (main + rehab slots
  // both come from the same 14-day span of sc_daily_revenue).
  const rows = [
    ...synthRowsFromInvoice(mainFix,  { accountKey: "CIN - AZ", serviceMap: CIN_AZ_SERVICE_MAP, nameToSvc: NAME_TO_SVC_ID["CIN - AZ"], periodByDate }),
    ...synthRowsFromInvoice(rehabFix, { accountKey: "CIN - AZ", serviceMap: CIN_AZ_SERVICE_MAP, nameToSvc: NAME_TO_SVC_ID["CIN - AZ"], periodByDate }),
  ];

  const { invoices, warnings } = buildInvoicePayload({
    accountKey: "CIN - AZ",
    weekStart:  "2026-07-13",
    rows,
    accountMap: CIN_AZ_ACCOUNT_MAP,
    serviceMap: CIN_AZ_SERVICE_MAP,
  });

  // Two invoices: main + rehab. Slots alphabetical.
  assert.equal(invoices.length, 2, "CIN - AZ biweekly emits 2 invoices (main + rehab)");
  assert.equal(warnings.length, 0);
  for (const inv of invoices) {
    assert.equal(inv.TxnDate, "2026-07-26", "TxnDate = pair's closing Sunday");
    assert.equal(inv.CustomerRef.value, "17752");
    assert.equal(inv.TxnTaxDetail.TxnTaxCodeRef.value, "37");
  }

  const mainInv = invoices.find((i) => i._slot === "main");
  const rehabInv = invoices.find((i) => i._slot === "rehab");
  assert.ok(mainInv, "main slot present");
  assert.ok(rehabInv, "rehab slot present");

  const actualMain  = normaliseLines(mainInv);
  const expectedMain = normaliseLines(mainFix);
  assertLinesEqual(actualMain, expectedMain, "K300168899 (main)");
  assert.equal(preTaxSubtotal(actualMain), preTaxSubtotal(expectedMain), "main subtotal");

  const actualRehab  = normaliseLines(rehabInv);
  const expectedRehab = normaliseLines(rehabFix);
  assertLinesEqual(actualRehab, expectedRehab, "K300168900 (rehab)");
  assert.equal(preTaxSubtotal(actualRehab), preTaxSubtotal(expectedRehab), "rehab subtotal");
});
