// Five negative tests per PR-B acceptance B4:
//   1. unmapped service throws (positive qty)
//   2. rate-guard splits Continental Plus (already covered by parity;
//      test isolates the branch)
//   3. FF emits exactly two weekly lines in the combined biweekly payload
//   4. projections-only week hard-fails (no projected invoice)
//   5. is_non_revenue rows are excluded
//
// PR-B2 (owner ruling 2026-08-10, retro-shadow round 1):
//   6. unmapped MEAL row with actual_count=0 -> warn + skip (no throw)
//   7. unmapped FF   row with actual_count=0 -> warn + skip (no throw)
//   8. unmapped FF   row with actual_count>0 -> THROW
//   9. plain_name description emits mapping.qbo_line_description (not
//      SC row's service_name) - the Fountain Bev case.
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

// ─── PR-B2 additions (owner ruling 2026-08-10) ────────────────────

// B4-6: unmapped MEAL with actual_count=0 warns and skips (no throw).
test("negative: unmapped meal with zero actual_count warns and skips", () => {
  const rows = [
    // Mapped positive line so the invoice isn't empty.
    scRow({
      service_date: "2026-07-27",
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f", // TXR MiLB Breakfast
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: 100, price: 14.2926,
      period: "8", week_label: "Week 3",
    }),
    // Unmapped, zero qty - must WARN and SKIP, never throw.
    scRow({
      service_date: "2026-07-28",
      service_id: "00000000-0000-0000-0000-abcdefabcdef",
      service_name: "Extra Protein - Chicken",
      account_key: "TXR - AZ",
      actual_count: 0, price: 3.50,
      period: "8", week_label: "Week 3",
    }),
  ];
  const { invoices, warnings } = buildInvoicePayload({
    accountKey: "TXR - AZ", weekStart: "2026-07-27",
    rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
  });
  assert.equal(invoices.length, 1, "one invoice from the mapped positive row");
  assert.equal(invoices[0].Line.length, 1, "one line - unmapped zero not billed");
  assert.equal(warnings.length, 1, "one warning for the unmapped zero row");
  assert.match(
    warnings[0],
    /unmapped service Extra Protein - Chicken .* TXR - AZ 2026-07-28 skipped \(zero actual_count\)\./,
    "warning names the service, account, and date"
  );
});

// B4-7: unmapped FF with actual_count=0 warns and skips (Finding B case).
test("negative: unmapped FF with zero actual_count warns and skips (Finding B)", () => {
  const rows = [
    // Mapped positive meal so invoice isn't empty.
    scRow({
      service_date: "2026-07-27",
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: 100, price: 14.2926,
      period: "8", week_label: "Week 3",
    }),
    // Unmapped FF, zero actual - must WARN and SKIP. Before the ruling
    // this would throw on the plain unmapped-FF check.
    scRow({
      service_date: "2026-07-28",
      service_id: "abcdefab-cdef-abcd-efab-cdefabcdefab",
      service_name: "Extra Protein - Chicken (FF)",
      account_key: "TXR - AZ",
      is_flat_fee: true,
      actual_count: 0, price: 25.0,
      period: "8", week_label: "Week 3",
    }),
  ];
  const { invoices, warnings } = buildInvoicePayload({
    accountKey: "TXR - AZ", weekStart: "2026-07-27",
    rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
  });
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].Line.length, 1, "no FF line emitted for unmapped zero row");
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /unmapped FF service Extra Protein - Chicken \(FF\) .* TXR - AZ 2026-07-28 skipped \(zero actual_count\)\./,
  );
});

// B4-8: unmapped FF with actual_count>0 still THROWS (regression guard).
test("negative: unmapped FF with positive actual_count throws (regression guard)", () => {
  const rows = [
    scRow({
      service_date: "2026-07-27",
      service_id: "beadedbe-aded-beat-edbe-adedbeadedbe",
      service_name: "Made-Up FF",
      account_key: "TXR - AZ",
      is_flat_fee: true,
      actual_count: 1, price: 25.0,
      period: "8", week_label: "Week 3",
    }),
  ];
  assert.throws(
    () => buildInvoicePayload({
      accountKey: "TXR - AZ", weekStart: "2026-07-27",
      rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
    }),
    /unmapped FF service Made-Up FF .* TXR - AZ 2026-07-27/,
  );
});

// B4-9: plain_name emits mapping.qbo_line_description, not SC row's
// service_name (the Fountain Bev case owner ruled on 2026-08-10).
test("plain_name description emits mapping.qbo_line_description (Fountain Bev case)", () => {
  // Force the SC row's service_name to a DIFFERENT string ("Fountain Bev")
  // than the mapping's qbo_line_description ("Fountain Beverages"). Builder must
  // emit the mapping value regardless.
  const rows = [];
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
      service_id: "d9e368ee-916a-4f03-96f5-1079bb520cc7", // Fountain (FF)
      service_name: "Fountain Bev",                       // SC name != invoice desc
      account_key: "CIN - AZ",
      is_flat_fee: true, is_tax_free: true,
      actual_count: 1, price: 283.9200,
      period: "8", week_label: wk,
    }));
  }
  const { invoices } = buildInvoicePayload({
    accountKey: "CIN - AZ", weekStart: "2026-07-13",
    rows, accountMap: CIN_AZ_ACCOUNT_MAP, serviceMap: CIN_AZ_SERVICE_MAP,
  });
  const main = invoices.find((i) => i._slot === "main");
  const ffLines = main.Line.filter((l) => l.SalesItemLineDetail.ItemRef.value === "3372");
  assert.equal(ffLines.length, 2, "one Fountain line per week in the biweekly pair");
  for (const l of ffLines) {
    assert.equal(l.Description, "Fountain Beverages",
      "description emits mapping.qbo_line_description, NOT the SC row's service_name 'Fountain Bev'");
  }
});

// sc-38 (2026-09-02): export_excluded rows drop from line emission
// but the row must NOT throw the unmapped-service guard. B&G Lunch on
// TBR - FL is the first case (Sebastian bills B&G outside the system;
// B&G revenue stays in TBR account totals per Kevin's kitchen-margin
// rule, but the line is suppressed from the QBO invoice).
test("negative: export_excluded row does NOT throw and produces NO invoice line", () => {
  const bgServiceId = "35bc73d2-c465-4c3d-bf30-908da81d54fa"; // TBR B&G Lunch
  const bfstMilbId  = "1318c319-1844-410a-ace5-8f8812eebd23"; // TBR Bfst-MiLB
  const tbrAccountMap = {
    account_key: "TBR - FL",
    qbo_customer_id: "17860",
    qbo_customer_name: "Tampa Bay Rays MiLB/MLB",
    qbo_taxcode_id: "26",
    qbo_class_id: "1200000000000091984",  // PFS:TBR - FL (sc-41)
    cadence: "weekly",
    biweekly_anchor: null,
    active: true,
  };
  const tbrServiceMap = [
    // B&G excluded row: mapping present so unmapped-throw does NOT fire,
    // export_excluded=true so line emission is suppressed.
    { service_id: bgServiceId, account_key: "TBR - FL",
      qbo_item_id: null, qbo_line_description: null,
      aggregate_group: null, invoice_slot: "main",
      tax_override: null, line_desc_style: null,
      export_excluded: true },
    // MiLB Breakfast: normal mapping, will produce a real line.
    { service_id: bfstMilbId, account_key: "TBR - FL",
      qbo_item_id: "3293", qbo_line_description: "TBR MiLB - Breakfast",
      aggregate_group: null, invoice_slot: "milb",
      tax_override: null, line_desc_style: null,
      export_excluded: false },
  ];
  // Same day: B&G Lunch 120 (would be $780 revenue but is excluded)
  // + MiLB Breakfast 80 (produces a real line).
  const rows = [
    scRow({
      service_date: "2026-07-27",
      service_id: bgServiceId,
      service_name: "B&G Lunch",
      account_key: "TBR - FL",
      actual_count: 120, price: 6.50,
    }),
    scRow({
      service_date: "2026-07-27",
      service_id: bfstMilbId,
      service_name: "Breakfast - MiLB",
      account_key: "TBR - FL",
      actual_count: 80, price: 17.83,
    }),
  ];
  const result = buildInvoicePayload({
    accountKey: "TBR - FL",
    weekStart: "2026-07-27",   // Monday
    rows, accountMap: tbrAccountMap, serviceMap: tbrServiceMap,
  });
  // Exactly one invoice (milb slot). B&G lives on 'main' but produces
  // no lines so no 'main' invoice appears.
  assert.equal(result.invoices.length, 1, "expected exactly one invoice (milb slot)");
  assert.equal(result.invoices[0]._slot, "milb");
  // Exactly one line: MiLB Breakfast. B&G suppressed.
  assert.equal(result.invoices[0].Line.length, 1, "expected exactly one line (MiLB Bfst)");
  const line = result.invoices[0].Line[0];
  assert.equal(line.SalesItemLineDetail.ItemRef.value, "3293");
  assert.equal(line.SalesItemLineDetail.Qty, 80);
  // Verify no B&G item id or description leaked into the line.
  assert.notEqual(line.SalesItemLineDetail.ItemRef.value, null);
  assert.ok(!/B&G/.test(line.Description || ""));
  // Verify no warning about unmapped B&G - it's mapped, just excluded.
  assert.ok(
    !result.warnings.some((w) => /B&G/.test(w)),
    `expected no warning about B&G; got: ${JSON.stringify(result.warnings)}`
  );
});

// sc-41: buildInvoicePayload throws when accountMap.qbo_class_id is
// missing. Parity with the existing qbo_customer_id required-field
// pattern. Class is per-account and every line carries it.
test("negative: buildInvoicePayload throws when accountMap.qbo_class_id is missing", () => {
  const rows = [
    scRow({
      service_date: "2026-07-27",
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: 10, price: 14.29,
      period: "8", week_label: "Week 3",
    }),
  ];
  const mapWithoutClass = { ...TXR_AZ_ACCOUNT_MAP };
  delete mapWithoutClass.qbo_class_id;
  assert.throws(
    () => buildInvoicePayload({
      accountKey: "TXR - AZ", weekStart: "2026-07-27",
      rows, accountMap: mapWithoutClass, serviceMap: TXR_AZ_SERVICE_MAP,
    }),
    /qbo_class_id missing for TXR - AZ/,
  );
});

// sc-41: builder emits ClassRef on every line. Positive assertion so
// a future refactor that drops the emit is caught immediately, not
// at deploy time when unclassed invoices land in QBO.
test("positive: buildInvoicePayload emits ClassRef.value on every line", () => {
  const rows = [
    scRow({
      service_date: "2026-07-27",
      service_id: "5d626ec9-2505-470f-abe6-d7f3168ddf8f",
      service_name: "Breakfast",
      account_key: "TXR - AZ",
      actual_count: 10, price: 14.29,
      period: "8", week_label: "Week 3",
    }),
    scRow({
      service_date: "2026-07-27",
      service_id: "b5b0d24b-1162-4a80-a546-42bb6231470d",
      service_name: "Regular Snack",
      account_key: "TXR - AZ",
      actual_count: 20, price: 5.89,
      period: "8", week_label: "Week 3",
    }),
  ];
  const { invoices } = buildInvoicePayload({
    accountKey: "TXR - AZ", weekStart: "2026-07-27",
    rows, accountMap: TXR_AZ_ACCOUNT_MAP, serviceMap: TXR_AZ_SERVICE_MAP,
  });
  assert.equal(invoices.length, 1, "one invoice for main slot");
  for (const ln of invoices[0].Line) {
    assert.equal(
      ln.SalesItemLineDetail.ClassRef?.value,
      "1200000000000411132",
      `line ${ln.SalesItemLineDetail.ItemRef.value} on ${ln.SalesItemLineDetail.ServiceDate} carries the TXR class id`,
    );
  }
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
