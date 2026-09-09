// bgReport.test.mjs
//
// Coverage for the pure functions: monthBounds, filename, aggregate,
// composeReconciliationLineWithCounts. buildBgWorkbook is exercised
// via a smoke test (workbook shape) - the mount-verify probe opens
// the real xlsx for visual acceptance.

import test from "node:test";
import assert from "node:assert/strict";
import {
  monthBounds,
  buildBgReportFilename,
  aggregate,
  composeReconciliationLineWithCounts,
  buildBgWorkbook,
} from "./bgReport.js";

// ─── monthBounds ────────────────────────────────────────────────

test("monthBounds: standard month", () => {
  const b = monthBounds("2026-09");
  assert.equal(b.firstDay, "2026-09-01");
  assert.equal(b.lastDay,  "2026-09-30");
  assert.equal(b.monthLabel, "September 2026");
});

test("monthBounds: February in a non-leap year", () => {
  const b = monthBounds("2026-02");
  assert.equal(b.firstDay, "2026-02-01");
  assert.equal(b.lastDay,  "2026-02-28");
});

test("monthBounds: February in a leap year", () => {
  const b = monthBounds("2028-02");
  assert.equal(b.lastDay, "2028-02-29");
});

test("monthBounds: December (end-of-year rollover)", () => {
  const b = monthBounds("2026-12");
  assert.equal(b.firstDay, "2026-12-01");
  assert.equal(b.lastDay,  "2026-12-31");
});

test("monthBounds: bad input throws", () => {
  assert.throws(() => monthBounds("2026-9"),     /bad monthISO/);
  assert.throws(() => monthBounds("bad"),        /bad monthISO/);
  assert.throws(() => monthBounds(""),           /bad monthISO/);
  assert.throws(() => monthBounds(null),         /bad monthISO/);
});

// ─── filename normalization ─────────────────────────────────────

test("filename: strips spaces, prepends account, appends month + year", () => {
  assert.equal(
    buildBgReportFilename("TBR - FL", "2026-09"),
    "TBR-FL_BG_Sep-2026.xlsx",
  );
});

test("filename: MLB tri-part account", () => {
  assert.equal(
    buildBgReportFilename("TXR - TX - H", "2026-10"),
    "TXR-TX-H_BG_Oct-2026.xlsx",
  );
});

test("filename: THROWS on em-dash (positive test)", () => {
  assert.throws(
    () => buildBgReportFilename("TBR — FL", "2026-09"),
    /em-dash/i,
  );
});

// ─── aggregate ───────────────────────────────────────────────────

const BG_SVC = "svc-bg-lunch";
const OTHER_SVC = "svc-other";

function svcMap() {
  return [{ service_id: BG_SVC, service_name: "B&G Lunch" }];
}

function prices() {
  return [
    { service_id: BG_SVC, effective_date: "2026-01-01", price: "6.75" },
  ];
}

test("aggregate: filters actual_count <= 0 out of dailyRows", () => {
  const rows = [
    { service_id: BG_SVC, service_date: "2026-09-01", actual_count: 0 },
    { service_id: BG_SVC, service_date: "2026-09-02", actual_count: 100 },
    { service_id: BG_SVC, service_date: "2026-09-03", actual_count: 0 },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: prices(),
    monthBounds: monthBounds("2026-09"),
  });
  assert.equal(out.dailyRows.length, 1);
  assert.equal(out.dailyRows[0].date, "2026-09-02");
  assert.equal(out.dailyRows[0].count, 100);
  assert.equal(out.dailyRows[0].unitPrice, 6.75);
  assert.equal(out.dailyRows[0].revenueCents, 67500);
  assert.equal(out.monthlyTotal.daysServed, 1);
  assert.equal(out.monthlyTotal.count, 100);
  assert.equal(out.monthlyTotal.revenueCents, 67500);
  assert.equal(out.emptyMonth, false);
});

test("aggregate: empty month -> emptyMonth=true, zero totals, no daily rows", () => {
  const rows = [
    { service_id: BG_SVC, service_date: "2026-09-01", actual_count: 0 },
    { service_id: BG_SVC, service_date: "2026-09-02", actual_count: 0 },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: prices(),
    monthBounds: monthBounds("2026-09"),
  });
  assert.equal(out.emptyMonth, true);
  assert.equal(out.dailyRows.length, 0);
  assert.equal(out.weeklySubtotals.length, 0);
  assert.equal(out.monthlyTotal.count, 0);
  assert.equal(out.monthlyTotal.revenueCents, 0);
  assert.equal(out.monthlyTotal.daysServed, 0);
});

test("aggregate: multi-day, multi-service week rolls up correctly", () => {
  // 2026-08-25 (Mon) 125 @ 6.75 = 843.75 cents=84375
  // 2026-08-26 (Tue) 125 @ 6.75 = 843.75 cents=84375
  // 2026-08-27 (Wed) 125 @ 6.75 = 843.75 cents=84375
  // Total: 375 meals, 253125 cents ($2,531.25)
  const rows = [
    { service_id: BG_SVC, service_date: "2026-08-25", actual_count: 125 },
    { service_id: BG_SVC, service_date: "2026-08-26", actual_count: 125 },
    { service_id: BG_SVC, service_date: "2026-08-27", actual_count: 125 },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: prices(),
    monthBounds: monthBounds("2026-08"),
  });
  assert.equal(out.dailyRows.length, 3);
  assert.equal(out.monthlyTotal.count, 375);
  assert.equal(out.monthlyTotal.revenueCents, 253125);
  assert.equal(out.monthlyTotal.daysServed, 3);
  // All three dates fall in the same ISO-week (Aug 24-30).
  assert.equal(out.weeklySubtotals.length, 1);
  assert.equal(out.weeklySubtotals[0].count, 375);
  assert.equal(out.weeklySubtotals[0].revenueCents, 253125);
});

test("aggregate: month straddling first-week gets partial display range", () => {
  // Sep 1 = Tuesday. The week containing Sep 1 starts Aug 31 (Mon).
  // displayStart should clamp to Sep 1, not show Aug 31.
  const rows = [
    { service_id: BG_SVC, service_date: "2026-09-01", actual_count: 50 },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: prices(),
    monthBounds: monthBounds("2026-09"),
  });
  assert.equal(out.weeklySubtotals.length, 1);
  assert.equal(out.weeklySubtotals[0].weekStart, "2026-08-31",
    "underlying ISO week starts Mon Aug 31");
  assert.equal(out.weeklySubtotals[0].displayStart, "2026-09-01",
    "display range clamped to month bounds");
  assert.equal(out.weeklySubtotals[0].displayEnd, "2026-09-06",
    "display end is week end (Sun Sep 6) which IS in September");
});

test("aggregate: as-of price picks the most recent effective_date <= service_date", () => {
  const rows = [
    { service_id: BG_SVC, service_date: "2026-06-15", actual_count: 100 },
    { service_id: BG_SVC, service_date: "2026-07-15", actual_count: 100 },
  ];
  const stagedPrices = [
    { service_id: BG_SVC, effective_date: "2026-01-01", price: "5.00" },
    { service_id: BG_SVC, effective_date: "2026-07-01", price: "6.75" },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: stagedPrices,
    monthBounds: monthBounds("2026-07"),
  });
  const jun = out.dailyRows.find((r) => r.date === "2026-06-15");
  const jul = out.dailyRows.find((r) => r.date === "2026-07-15");
  assert.equal(jun.unitPrice, 5.00, "Jun 15 predates Jul 1 price change");
  assert.equal(jul.unitPrice, 6.75, "Jul 15 gets the new price");
});

test("aggregate: unmapped service_id renders as '(unmapped service)' rather than dropping the row", () => {
  const rows = [
    { service_id: "unmapped-svc", service_date: "2026-09-01", actual_count: 50 },
  ];
  const out = aggregate({
    actualRows: rows, serviceMap: svcMap(), prices: prices(),
    monthBounds: monthBounds("2026-09"),
  });
  assert.equal(out.dailyRows.length, 1);
  assert.equal(out.dailyRows[0].serviceName, "(unmapped service)");
  // Price defaults to 0 -> revenue 0 but count is still 50
  assert.equal(out.dailyRows[0].count, 50);
  assert.equal(out.dailyRows[0].revenueCents, 0);
});

// ─── reconciliation line ─────────────────────────────────────────

test("recon: month falls entirely in one period", () => {
  const line = composeReconciliationLineWithCounts({
    monthLabel: "October 2026",
    startPeriod: "10", endPeriod: "10",
    daysInStart: 31, daysInEnd: 31,
  });
  assert.match(line, /October 2026 falls entirely inside SC period P10/);
});

test("recon: month spans two periods, singular vs plural days", () => {
  const line = composeReconciliationLineWithCounts({
    monthLabel: "September 2026",
    startPeriod: "8", endPeriod: "9",
    daysInStart: 12, daysInEnd: 18,
  });
  assert.match(line, /spans SC period P8 \(12 days\) and SC period P9 \(18 days\)/);
  assert.match(line, /will not match the KPI dashboard/);
});

test("recon: singular day is 'day' not 'days'", () => {
  const line = composeReconciliationLineWithCounts({
    monthLabel: "Foo 2026",
    startPeriod: "1", endPeriod: "2",
    daysInStart: 1, daysInEnd: 30,
  });
  assert.match(line, /P1 \(1 day\)/);
  assert.match(line, /P2 \(30 days\)/);
});

test("recon: missing period metadata surfaces the state honestly", () => {
  const line = composeReconciliationLineWithCounts({
    monthLabel: "October 2026",
    startPeriod: null, endPeriod: null,
    daysInStart: 0, daysInEnd: 0,
  });
  assert.match(line, /SC period metadata missing/);
});

// ─── buildBgWorkbook smoke ───────────────────────────────────────

test("buildBgWorkbook: three sheets always present (empty month)", async () => {
  const wb = await buildBgWorkbook({
    accountKey: "TBR - FL",
    monthLabel: "September 2026",
    aggregated: {
      dailyRows: [], weeklySubtotals: [],
      monthlyTotal: { daysServed: 0, count: 0, revenueCents: 0 },
      emptyMonth: true,
    },
    reconciliationLine: "September 2026 falls entirely inside SC period P9.",
    generatedAt: new Date("2026-10-04T13:00:00Z"),
  });
  const names = wb.worksheets.map((s) => s.name);
  assert.deepEqual(names, ["Daily", "Weekly", "Monthly"]);
  // Empty daily -> header + one italic placeholder row
  assert.equal(wb.getWorksheet("Daily").rowCount, 2);
  // Monthly always has fields: Account/Month/Days/Meals/Revenue + spacer + Recon = 7
  assert.equal(wb.getWorksheet("Monthly").rowCount, 8);
});

test("buildBgWorkbook: non-empty month emits daily rows + weekly rows", async () => {
  const wb = await buildBgWorkbook({
    accountKey: "TBR - FL",
    monthLabel: "August 2026",
    aggregated: {
      dailyRows: [
        { date: "2026-08-25", serviceName: "B&G Lunch", count: 125, unitPrice: 6.75, revenueCents: 84375 },
        { date: "2026-08-26", serviceName: "B&G Lunch", count: 125, unitPrice: 6.75, revenueCents: 84375 },
      ],
      weeklySubtotals: [
        { weekStart: "2026-08-24", weekEnd: "2026-08-30",
          displayStart: "2026-08-24", displayEnd: "2026-08-30",
          count: 250, revenueCents: 168750 },
      ],
      monthlyTotal: { daysServed: 2, count: 250, revenueCents: 168750 },
      emptyMonth: false,
    },
    reconciliationLine: "August 2026 spans SC period P7 (X days) and SC period P8 (Y days).",
    generatedAt: new Date("2026-10-04T13:00:00Z"),
  });
  // Daily = header + 2 data rows
  assert.equal(wb.getWorksheet("Daily").rowCount, 3);
  // Weekly = header + 1 data row
  assert.equal(wb.getWorksheet("Weekly").rowCount, 2);
});

test("buildBgWorkbook: writable to Buffer without error", async () => {
  const wb = await buildBgWorkbook({
    accountKey: "TBR - FL",
    monthLabel: "September 2026",
    aggregated: {
      dailyRows: [], weeklySubtotals: [],
      monthlyTotal: { daysServed: 0, count: 0, revenueCents: 0 },
      emptyMonth: true,
    },
    reconciliationLine: "September 2026 falls entirely inside SC period P9.",
  });
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(Buffer.isBuffer(buf) || buf instanceof Uint8Array,
    "writeBuffer returns Buffer/Uint8Array");
  assert.ok(buf.length > 500, "xlsx has non-trivial bytes");
});
