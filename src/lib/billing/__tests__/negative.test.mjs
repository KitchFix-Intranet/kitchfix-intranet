// Five negative tests per PR-B acceptance B4:
//   1. unmapped service throws
//   2. rate-guard splits Continental Plus (already covered by parity;
//      test isolates the branch)
//   3. FF emits exactly two weekly lines in the combined biweekly payload
//   4. projections-only week hard-fails (no projected invoice)
//   5. is_non_revenue rows are excluded
//
// Run via: npm run test:unit

import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePayload } from "../buildInvoicePayload.js";
import {
  TXR_AZ_ACCOUNT_MAP, TXR_AZ_SERVICE_MAP,
  CIN_AZ_ACCOUNT_MAP, CIN_AZ_SERVICE_MAP,
} from "./_helpers.mjs";

// Small helpers for row creation.
function scRow(partial) {
  return {
    service_date: partial.service_date,
    service_id:   partial.service_id,
    service_name: partial.service_name,
    account_key:  partial.account_key,
    is_flat_fee:  !!partial.is_flat_fee,
    is_tax_free:  !!partial.is_tax_free,
    is_non_revenue: !!partial.is_non_revenue,
    actual_count: partial.actual_count ?? null,
    actual_price_at_date: partial.price ?? null,
    price_at_date: partial.price ?? null,
    projected_count: partial.projected_count ?? null,
    period: partial.period ?? "8",
    week_label: partial.week_label ?? null,
    has_actuals: partial.actual_count != null,
    has_projection: partial.projected_count != null,
  };
}

// B4-1: unmapped service throws.
test("negative: unmapped service throws with the service named", () => {
  const rows = [
    scRow({
      service_date: "2026-07-27",
      service_id: "00000000-0000-0000-0000-000000000000",
      service_name: "Made-Up Service",
      account_key: "TXR - AZ",
      actual_count: 10, price: 5.00,
      period: "8", week_label: "Week 3",
    }),
  ];
  assert.throws(
    () => buildInvoicePayload({
      accountKey: "TXR - AZ", weekStart: "2026-07-27",
      rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
    }),
    /unmapped service Made-Up Service .* TXR - AZ 2026-07-27/,
  );
});

// B4-2: rate-guard split - Rehab Continental Plus at 6.36 splits from
// aggregated Rehab meal 12.90 within item 3327.
test("negative: rate-guard splits Continental Plus (6.36) from Rehab meal (12.90)", () => {
  // Both service_ids map to item 3327 within cin-rehab-meal group
  // (well, Continental Plus is NOT in the group). Same day, different
  // rates - MUST produce 2 lines.
  const rows = [
    // Same day: Rehab Breakfast qty 10 @ 12.90 + Continental Plus qty 5 @ 6.36
    // Plus the whole bi-weekly range needs the full 14-day span with
    // period+week_label so the biweekly validator passes. Attach the
    // metadata only for the days we care about (others empty).
  ];
  const dates = ["2026-07-13", "2026-07-14"];
  const weekLabels = { "2026-07-13": "Week 1", "2026-07-14": "Week 1" };
  for (const d of dates) {
    rows.push(scRow({
      service_date: d,
      service_id: "4f0cc3af-2fef-4f5a-8762-3f87c45de3a3", // Rehab Breakfast
      service_name: "Breakfast",
      account_key: "CIN - AZ",
      actual_count: 10, price: 12.9018,
      period: "8", week_label: weekLabels[d],
    }));
    rows.push(scRow({
      service_date: d,
      service_id: "c667d4e5-db72-4e37-9da8-06342881e76f", // Continental Plus
      service_name: "Continental Plus",
      account_key: "CIN - AZ",
      actual_count: 5, price: 6.3600,
      period: "8", week_label: weekLabels[d],
    }));
  }
  // Pad the biweekly to 14 days with period/week metadata so
  // validation passes.
  const padDates = [
    ["2026-07-15", "Week 1"], ["2026-07-16", "Week 1"], ["2026-07-17", "Week 1"],
    ["2026-07-18", "Week 1"], ["2026-07-19", "Week 1"],
    ["2026-07-20", "Week 2"], ["2026-07-21", "Week 2"], ["2026-07-22", "Week 2"],
    ["2026-07-23", "Week 2"], ["2026-07-24", "Week 2"], ["2026-07-25", "Week 2"],
    ["2026-07-26", "Week 2"],
  ];
  for (const [d, wk] of padDates) {
    rows.push(scRow({
      service_date: d,
      service_id: "4f0cc3af-2fef-4f5a-8762-3f87c45de3a3",
      service_name: "Breakfast",
      account_key: "CIN - AZ",
      actual_count: 0, price: 12.9018,
      period: "8", week_label: wk,
    }));
  }
  const { invoices } = buildInvoicePayload({
    accountKey: "CIN - AZ", weekStart: "2026-07-13",
    rows, accountMap: CIN_AZ_ACCOUNT_MAP, serviceMap: CIN_AZ_SERVICE_MAP,
  });
  const rehab = invoices.find((i) => i._slot === "rehab");
  assert.ok(rehab, "rehab slot invoice present");
  // Expect 4 lines: 2 dates * 2 (Rehab meal + Continental Plus).
  assert.equal(rehab.Line.length, 4, `expected 4 rehab lines, got ${rehab.Line.length}`);
  const rates = new Set(rehab.Line.map((l) => l.SalesItemLineDetail.UnitPrice));
  assert.deepEqual([...rates].sort((a, b) => a - b), [6.36, 12.9], "two distinct rates present");
});

// B4-3: FF emits exactly 2 weekly lines in the combined biweekly payload.
test("negative: FF service emits exactly 2 weekly lines in a biweekly payload", () => {
  const rows = [];
  // Every day of the 14-day pair gets a Coffee Service row with FF.
  const dates = [
    ["2026-07-13", "Week 1"], ["2026-07-14", "Week 1"], ["2026-07-15", "Week 1"],
    ["2026-07-16", "Week 1"], ["2026-07-17", "Week 1"], ["2026-07-18", "Week 1"],
    ["2026-07-19", "Week 1"],
    ["2026-07-20", "Week 2"], ["2026-07-21", "Week 2"], ["2026-07-22", "Week 2"],
    ["2026-07-23", "Week 2"], ["2026-07-24", "Week 2"], ["2026-07-25", "Week 2"],
    ["2026-07-26", "Week 2"],
  ];
  for (const [d, wk] of dates) {
    rows.push(scRow({
      service_date: d,
      service_id: "3e5ac4cb-7391-46db-ae38-cb71435d4e03", // Coffee Service FF TF
      service_name: "Coffee Service",
      account_key: "CIN - AZ",
      is_flat_fee: true, is_tax_free: true,
      actual_count: 1, price: 511.0529,
      period: "8", week_label: wk,
    }));
  }
  const { invoices } = buildInvoicePayload({
    accountKey: "CIN - AZ", weekStart: "2026-07-13",
    rows, accountMap: CIN_AZ_ACCOUNT_MAP, serviceMap: CIN_AZ_SERVICE_MAP,
  });
  const main = invoices.find((i) => i._slot === "main");
  assert.ok(main, "main slot invoice present");
  const ffLines = main.Line.filter((l) => l.SalesItemLineDetail.ItemRef.value === "3371");
  assert.equal(ffLines.length, 2, `expected 2 Coffee lines (one per week), got ${ffLines.length}`);
  for (const l of ffLines) {
    assert.equal(l.SalesItemLineDetail.Qty, 1, "FF qty always 1");
    assert.equal(l.SalesItemLineDetail.TaxCodeRef.value, "NON", "FF Coffee tax NON");
  }
  // ServiceDates should be Monday of week 1 (2026-07-13) and Monday of week 2 (2026-07-20).
  const svcDates = ffLines.map((l) => l.SalesItemLineDetail.ServiceDate).sort();
  assert.deepEqual(svcDates, ["2026-07-13", "2026-07-20"], "FF ServiceDates = each week's Monday");
});

// B4-4: projections-only week (no actuals) produces an empty invoice
// array - a caller that tries to bill it should see nothing to send.
test("negative: projections-only week yields empty invoices (never projected invoice)", () => {
  const rows = [];
  for (const d of ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]) {
    rows.push(scRow({
      service_date: d,
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: null,           // no actuals
      projected_count: 100,          // projections exist
      price: 14.2926,
      period: "8", week_label: "Week 3",
    }));
  }
  const { invoices } = buildInvoicePayload({
    accountKey: "TXR - AZ", weekStart: "2026-07-27",
    rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
  });
  assert.equal(invoices.length, 0, "projections-only week yields 0 invoices");
});

// B4-5: is_non_revenue rows are excluded.
test("negative: is_non_revenue rows are dropped silently", () => {
  const rows = [
    // Regular meal row
    scRow({
      service_date: "2026-07-27",
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: 100, price: 14.2926,
      period: "8", week_label: "Week 3",
    }),
    // Non-revenue row - would otherwise be unmapped, but is_non_revenue
    // is dropped BEFORE the unmapped check.
    scRow({
      service_date: "2026-07-27",
      service_id: "99999999-9999-9999-9999-999999999999",
      service_name: "Fun $$$$ Allocated",
      account_key: "TXR - AZ",
      is_non_revenue: true,
      actual_count: 50, price: 0,
      period: "8", week_label: "Week 3",
    }),
  ];
  const { invoices } = buildInvoicePayload({
    accountKey: "TXR - AZ", weekStart: "2026-07-27",
    rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
  });
  assert.equal(invoices.length, 1, "one invoice");
  const inv = invoices[0];
  // Only the mapped meal line - non-revenue row must not appear.
  assert.equal(inv.Line.length, 1, `expected 1 line, got ${inv.Line.length}`);
  assert.equal(inv.Line[0].SalesItemLineDetail.ItemRef.value, "3333");
});

// Bonus: P13 hard-fails on bi-weekly (owner amendment 2026-08-06).
test("negative: P13 biweekly build hard-fails with named error", () => {
  const rows = [
    scRow({
      service_date: "2026-11-30",
      service_id: "82fd6db3-35ec-4904-907d-5c52a74f625e",
      service_name: "Breakfast",
      account_key: "CIN - AZ",
      actual_count: 10, price: 12.8950,
      period: "13", week_label: "Week 1",
    }),
  ];
  assert.throws(
    () => buildInvoicePayload({
      accountKey: "CIN - AZ", weekStart: "2026-11-30",
      rows, accountMap: CIN_AZ_ACCOUNT_MAP, serviceMap: CIN_AZ_SERVICE_MAP,
    }),
    /P13 has 3 weeks; bi-weekly pairing is undefined/,
  );
});
