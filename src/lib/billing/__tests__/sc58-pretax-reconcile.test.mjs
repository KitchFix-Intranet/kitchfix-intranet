// sc-58 - regression tests for the two-sided pretax reconciliation.
//
// Case 1: screen == payload for TBR - FL week 2026-03-02 post-fix.
//         B&G Lunch excluded on BOTH sides (payload drops export_excluded
//         at buildInvoicePayload.js:292; billable helper drops the same
//         set); zero-count per-occurrence services produce no line.
//         Both totals equal 14,950,610 cents ($149,506.10).
//
// Case 2: per-occurrence billing. A service with is_flat_fee=false,
//         mapped, no aggregate_group, actual_count=1 on three distinct
//         dates emits three lines - not one weekly qty=1 line.
//
// Run via: npm run test:unit (or node --import ./scripts/_setup/
// register-aliases.mjs --test src/lib/billing/__tests__/sc58-pretax-reconcile.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePayload } from "../buildInvoicePayload.js";
import { sumBillablePretaxCents } from "../billableTotal.js";

// ─── Service IDs from the live TBR - FL config (confirmed by probe) ──
const SVC = {
  BREAKFAST_MLB:  "fe3d10b2-ab84-4f54-96c5-857b44a218ce",  // item 3297
  LUNCH_MLB:      "48893d82-39a1-4113-b1fd-012d22a30245",  // item 3298 (agg tbr-mlb-ld)
  BREAKFAST_MILB: "1318c319-1844-410a-ace5-8f8812eebd23",  // item 3293
  LUNCH_MILB:     "1c62040d-b56c-4660-9b72-6e58b0554865",  // item 3294 (agg tbr-milb-ld)
  BG_LUNCH:       "35bc73d2-c465-4c3d-bf30-908da81d54fa",  // export_excluded, no item
  EXTRA_PROTEIN:  "7d535c74-7184-4069-bad3-efbcabc16718",  // item 3369 (post-sc-58: is_flat_fee=false)
  EXT_DAY_LABOR:  "ef227171-0d60-4ff3-a5aa-d779e59da9a5",  // item 3392 (post-sc-58: is_flat_fee=false, tax_override=NON)
};

const TBR_FL_ACCOUNT_MAP = {
  account_key:      "TBR - FL",
  qbo_customer_id:  "17860",
  qbo_customer_name: "Tampa Bay Rays - Port Charlotte, FL",
  qbo_taxcode_id:   "26",
  qbo_class_id:     "1200000000000091984",
  cadence:          "weekly",
  qbo_mode:         "test",
  active:           true,
};

// Post-migration shape. 3369 and 3392 are flipped to is_flat_fee=false
// via sc-58 (migration file at docs/migrations/sc-58-tbr-per-occurrence.sql);
// mapping rows themselves are unchanged.
const TBR_FL_SERVICE_MAP = [
  { service_id: SVC.BREAKFAST_MLB,  account_key: "TBR - FL", qbo_item_id: "3297", qbo_line_description: null,                                aggregate_group: null,          invoice_slot: "mlb",  tax_override: null,  line_desc_style: null,         active: true, export_excluded: false },
  { service_id: SVC.LUNCH_MLB,      account_key: "TBR - FL", qbo_item_id: "3298", qbo_line_description: "Lunch",                             aggregate_group: "tbr-mlb-ld",  invoice_slot: "mlb",  tax_override: null,  line_desc_style: null,         active: true, export_excluded: false },
  { service_id: SVC.BREAKFAST_MILB, account_key: "TBR - FL", qbo_item_id: "3293", qbo_line_description: null,                                aggregate_group: null,          invoice_slot: "milb", tax_override: null,  line_desc_style: null,         active: true, export_excluded: false },
  { service_id: SVC.LUNCH_MILB,     account_key: "TBR - FL", qbo_item_id: "3294", qbo_line_description: "Lunch - MiLB",                      aggregate_group: "tbr-milb-ld", invoice_slot: "milb", tax_override: null,  line_desc_style: null,         active: true, export_excluded: false },
  { service_id: SVC.BG_LUNCH,       account_key: "TBR - FL", qbo_item_id: null,   qbo_line_description: null,                                aggregate_group: null,          invoice_slot: "main", tax_override: null,  line_desc_style: null,         active: true, export_excluded: true  },
  { service_id: SVC.EXTRA_PROTEIN,  account_key: "TBR - FL", qbo_item_id: "3369", qbo_line_description: "Extra Protein (TBR) - Chicken/Pork", aggregate_group: null,         invoice_slot: "milb", tax_override: null,  line_desc_style: "plain_name", active: true, export_excluded: false },
  { service_id: SVC.EXT_DAY_LABOR,  account_key: "TBR - FL", qbo_item_id: "3392", qbo_line_description: "Labor Fee",                         aggregate_group: null,          invoice_slot: "milb", tax_override: "NON", line_desc_style: "plain_name", active: true, export_excluded: false },
];

// ─── Row-shape helpers ─────────────────────────────────────────────
function mealRow({ date, service_id, service_name, actual_count, price, is_flat_fee = false, is_non_revenue = false }) {
  const revenue = Number((actual_count * price).toFixed(2));
  return {
    service_date:            date,
    service_id,
    service_name,
    account_key:             "TBR - FL",
    is_flat_fee,
    is_tax_free:             false,
    is_non_revenue,
    actual_count,
    actual_price_at_date:    price,
    price_at_date:           price,
    projected_count:         null,
    period:                  "P9",
    week_label:              "Week 1",
    has_actuals:             actual_count > 0,
    has_projection:          false,
    actual_revenue:          revenue,
    projected_revenue:       0,
  };
}

function zeroRow(date, service_id, service_name, price, { is_flat_fee = false } = {}) {
  return {
    service_date:            date,
    service_id,
    service_name,
    account_key:             "TBR - FL",
    is_flat_fee,
    is_tax_free:             false,
    is_non_revenue:          false,
    actual_count:            0,
    actual_price_at_date:    price,
    price_at_date:           price,
    projected_count:         0,
    period:                  "P9",
    week_label:              "Week 1",
    has_actuals:             false,
    has_projection:          false,
    actual_revenue:          0,
    projected_revenue:       0,
  };
}

// ─── Case 1: screen == payload reconciliation ─────────────────────
test("sc-58 case 1 - billable confirm total equals payload pretax (TBR - FL 2026-03-02)", () => {
  const rows = [];

  // Four meal services with real actuals across the week.
  // Day-by-day counts match the probe dump for TBR - FL 2026-03-02..03-08.
  const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"];
  const mlbBreakfastQty  = [120, 140, 150, 160, 120, 120, 160];  // sum=970 x 35.63 = 34561.10
  const mlbLunchQty      = [120, 140, 150, 160, 120, 120, 160];  // sum=970 x 39.48 = 38295.60
  const milbBreakfastQty = [275, 275, 275, 275, 280, 280, 280];  // sum=1940 x 17.83 = 34590.20
  const milbLunchQty     = [275, 275, 275, 275, 280, 280, 280];  // sum=1940 x 21.68 = 42059.20
  // Total of the four: 149,506.10

  for (let i = 0; i < days.length; i++) {
    rows.push(mealRow({ date: days[i], service_id: SVC.BREAKFAST_MLB,  service_name: "Breakfast",        actual_count: mlbBreakfastQty[i],  price: 35.63 }));
    rows.push(mealRow({ date: days[i], service_id: SVC.LUNCH_MLB,      service_name: "Lunch",            actual_count: mlbLunchQty[i],      price: 39.48 }));
    rows.push(mealRow({ date: days[i], service_id: SVC.BREAKFAST_MILB, service_name: "Breakfast - MiLB", actual_count: milbBreakfastQty[i], price: 17.83 }));
    rows.push(mealRow({ date: days[i], service_id: SVC.LUNCH_MILB,     service_name: "Lunch - MiLB",     actual_count: milbLunchQty[i],     price: 21.68 }));
  }

  // B&G Lunch - billed outside the system; actual on three days.
  // Overlay used to include this ($2,430); post-fix it is excluded.
  rows.push(mealRow({ date: "2026-03-03", service_id: SVC.BG_LUNCH, service_name: "B&G Lunch", actual_count: 130, price: 6.75 }));
  rows.push(mealRow({ date: "2026-03-04", service_id: SVC.BG_LUNCH, service_name: "B&G Lunch", actual_count: 115, price: 6.75 }));
  rows.push(mealRow({ date: "2026-03-05", service_id: SVC.BG_LUNCH, service_name: "B&G Lunch", actual_count: 115, price: 6.75 }));

  // The two per-occurrence services, post-sc-58: is_flat_fee=false,
  // zero actual_count all week. Payload used to emit $111.84 + $280 =
  // $391.84 of phantom lines; post-fix they produce no line.
  for (const d of days) {
    rows.push(zeroRow(d, SVC.EXTRA_PROTEIN, "Extra Protein - Chicken/Pork", 111.84, { is_flat_fee: false }));
    rows.push(zeroRow(d, SVC.EXT_DAY_LABOR, "Extended Day Labor",            280.00, { is_flat_fee: false }));
  }

  // ─── Payload side ─────────────────────────────────────────────
  const payload = buildInvoicePayload({
    accountKey: "TBR - FL",
    weekStart:  "2026-03-02",
    rows,
    accountMap: TBR_FL_ACCOUNT_MAP,
    serviceMap: TBR_FL_SERVICE_MAP,
  });
  let payloadCents = 0;
  for (const inv of payload.invoices) {
    for (const l of (inv.Line || [])) {
      if (l.DetailType !== "SalesItemLineDetail") continue;
      payloadCents += Math.round(Number(l.Amount) * 100);
    }
  }
  assert.equal(payloadCents, 14_950_610, "payload pretax should equal $149,506.10 (no B&G, no phantom FF lines)");

  // ─── Screen side ──────────────────────────────────────────────
  // Reproduces the loader's filter: drop is_non_revenue AND
  // export_excluded. Matches the shape of day.totals.billableActualRevenue.
  const exportExcludedIds = new Set(
    TBR_FL_SERVICE_MAP.filter((m) => m.export_excluded).map((m) => m.service_id)
  );
  const billableCents = sumBillablePretaxCents(rows, exportExcludedIds);
  assert.equal(billableCents, 14_950_610, "billable confirm total should equal $149,506.10 (B&G filtered out)");

  // ─── Reconciliation ──────────────────────────────────────────
  assert.equal(payloadCents, billableCents, "payload and screen must reconcile");
});

// ─── Case 2: per-occurrence billing (post-migration shape) ────────
test("sc-58 case 2 - is_flat_fee=false service emits one line per occurrence (not one weekly qty=1)", () => {
  // Three distinct dates in the span, actual_count = 1 on each.
  const rows = [
    mealRow({ date: "2026-03-02", service_id: SVC.EXT_DAY_LABOR, service_name: "Extended Day Labor", actual_count: 1, price: 280.00 }),
    mealRow({ date: "2026-03-04", service_id: SVC.EXT_DAY_LABOR, service_name: "Extended Day Labor", actual_count: 1, price: 280.00 }),
    mealRow({ date: "2026-03-06", service_id: SVC.EXT_DAY_LABOR, service_name: "Extended Day Labor", actual_count: 1, price: 280.00 }),
  ];

  const payload = buildInvoicePayload({
    accountKey: "TBR - FL",
    weekStart:  "2026-03-02",
    rows,
    accountMap: TBR_FL_ACCOUNT_MAP,
    serviceMap: TBR_FL_SERVICE_MAP,
  });
  // Only the 'milb' slot carries 3392; main / mlb will be empty-skipped.
  const milbInvoice = payload.invoices.find((i) => i._slot === "milb");
  assert.ok(milbInvoice, "expected a milb-slot invoice");
  const items = (milbInvoice.Line || []).filter((l) => l.DetailType === "SalesItemLineDetail");
  assert.equal(items.length, 3, "expected 3 per-occurrence lines (one per date), not 1 weekly qty=1 line");
  const dates = items.map((l) => l.SalesItemLineDetail.ServiceDate).sort();
  assert.deepEqual(dates, ["2026-03-02", "2026-03-04", "2026-03-06"]);
  for (const l of items) {
    assert.equal(Number(l.SalesItemLineDetail.Qty), 1, "each line qty = 1");
    assert.equal(Number(l.SalesItemLineDetail.UnitPrice), 280.00, "each line rate = $280.00");
    assert.equal(Number(l.Amount), 280.00, "each line amount = $280.00");
    assert.equal(l.SalesItemLineDetail.ItemRef.value, "3392");
    // tax_override='NON' flows through on the meal path too (per audit §4).
    assert.equal(l.SalesItemLineDetail.TaxCodeRef.value, "NON");
  }
  const total = items.reduce((s, l) => s + Math.round(Number(l.Amount) * 100), 0);
  assert.equal(total, 84_000, "three days x $280 = $840.00");
});
