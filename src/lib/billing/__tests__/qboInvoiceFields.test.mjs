// qboInvoiceFields.test.mjs
//
// Focused coverage for the fields Kevin's CC prompt adds / enforces:
//   - SalesTermRef.value === QBO_TERM_ID_NET30 on every generated invoice
//   - DueDate is NOT emitted (QBO computes from TxnDate + Term.DueDays)
//   - DocNumber is NEVER emitted (would collide with Sebastian's manual K300 sequence)
//   - CustomerMemo present on every invoice (mechanism; wording TBD)
//   - Test-mode override still overwrites CustomerMemo with TEST_MEMO
//
// The DocNumber test is the load-bearing "never send this" fence -
// a collision with Sebastian's K300... sequence would be discovered
// by him, not by us.

import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePayload, QBO_TERM_ID_NET30 } from "../buildInvoicePayload.js";
import { markPayloadAsTest, TEST_MEMO } from "../qboAdapter.js";
import { buildInvoiceMemo } from "../invoiceMemo.js";
import {
  TXR_AZ_ACCOUNT_MAP, TXR_AZ_SERVICE_MAP,
  CIN_AZ_ACCOUNT_MAP, CIN_AZ_SERVICE_MAP,
} from "./_helpers.mjs";

// ─── Minimal fixture ─────────────────────────────────────────────
// Row shape mirrors _helpers.mjs / negative.test.mjs (scRow) so the
// builder recognises them the same way it does the parity fixtures.

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

// TXR - AZ weekly: one row per service day (7-day week 2026-07-27..08-02).
function txrWeeklyRows() {
  const dates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
                 "2026-07-31", "2026-08-01", "2026-08-02"];
  return dates.map((d) => scRow({
    service_date: d,
    // Continental Breakfast is a non-aggregated line - one service_id,
    // one line per day. Simpler for this test than an aggregate group.
    service_id: "6871d41e-08a8-4603-92c4-ba399a3a3674",
    service_name: "Continental Breakfast",
    account_key: "TXR - AZ",
    actual_count: 100,
    price: 17.83,
    period: "8",
    week_label: "Week 3",
  }));
}

// CIN - AZ biweekly: 14-day span 2026-07-13..07-26 (Weeks 1-2 of P8).
function cinBiweeklyRows() {
  const dates = [];
  const start = new Date("2026-07-13T12:00:00Z");
  for (let i = 0; i < 14; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates.map((d) => scRow({
    service_date: d,
    service_id: CIN_AZ_SERVICE_MAP[0].service_id,
    service_name: "Breakfast",
    account_key: "CIN - AZ",
    actual_count: 50,
    price: 12.90,
    period: "8",
    week_label: d <= "2026-07-19" ? "Week 1" : "Week 2",
  }));
}

function buildTxrWeeklyInvoices() {
  const { invoices } = buildInvoicePayload({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    accountMap: TXR_AZ_ACCOUNT_MAP,
    serviceMap: TXR_AZ_SERVICE_MAP,
    rows:       txrWeeklyRows(),
  });
  return invoices;
}

function buildCinBiweeklyInvoices() {
  const { invoices } = buildInvoicePayload({
    accountKey: "CIN - AZ",
    weekStart:  "2026-07-13",
    accountMap: CIN_AZ_ACCOUNT_MAP,
    serviceMap: CIN_AZ_SERVICE_MAP,
    rows:       cinBiweeklyRows(),
  });
  return invoices;
}

// ─── SalesTermRef ────────────────────────────────────────────────

test("SalesTermRef.value === QBO_TERM_ID_NET30 on every weekly invoice", () => {
  const invoices = buildTxrWeeklyInvoices();
  assert.ok(invoices.length > 0, "test setup: at least one invoice");
  for (const inv of invoices) {
    assert.deepEqual(inv.SalesTermRef, { value: QBO_TERM_ID_NET30 },
      `invoice slot=${inv._slot} missing SalesTermRef Net 30`);
  }
});

test("SalesTermRef.value === QBO_TERM_ID_NET30 on every biweekly invoice (CIN - AZ)", () => {
  // CIN - AZ is the account whose live customer record has NO
  // default term set today. This test proves the payload carries
  // it explicitly, so CIN's invoices get Net 30 without relying on
  // the missing customer default.
  const invoices = buildCinBiweeklyInvoices();
  assert.ok(invoices.length > 0);
  for (const inv of invoices) {
    assert.deepEqual(inv.SalesTermRef, { value: QBO_TERM_ID_NET30 });
  }
});

test("QBO_TERM_ID_NET30 is the string '7' (matches tenant Term list)", () => {
  // Guard against a typo drift; the ID was verified live 2026-09-09.
  assert.equal(QBO_TERM_ID_NET30, "7");
});

// ─── DueDate NOT emitted ─────────────────────────────────────────

test("DueDate is NOT emitted (QBO computes from SalesTermRef + TxnDate)", () => {
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    assert.ok(!("DueDate" in inv),
      "payload must omit DueDate so QBO's TxnDate + Term.DueDays computation stays authoritative");
  }
});

// ─── DocNumber NEVER emitted (Kevin's load-bearing fence) ────────

test("DocNumber is NEVER emitted (weekly)", () => {
  // Kevin fence: Sebastian's manual sequence is K300... and QBO
  // continues it. A DocNumber in our payload would override that
  // and could collide with an invoice he raised by hand. Discovery
  // path would be him noticing a duplicate, not us.
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    assert.ok(!("DocNumber" in inv),
      `invoice slot=${inv._slot} emitted DocNumber - would collide with Sebastian's K300 sequence`);
  }
});

test("DocNumber is NEVER emitted (biweekly)", () => {
  const invoices = buildCinBiweeklyInvoices();
  for (const inv of invoices) {
    assert.ok(!("DocNumber" in inv));
  }
});

test("DocNumber is NEVER emitted even after markPayloadAsTest", () => {
  // The test-mode override rewrites CustomerRef + TxnDate + memos.
  // Confirm it does NOT introduce a DocNumber inadvertently.
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    const marked = markPayloadAsTest(inv, {
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27",
      weekEnd:   "2026-08-02",
    });
    assert.ok(!("DocNumber" in marked));
  }
});

// ─── CustomerMemo present + wording sourced from invoiceMemo ─────

test("CustomerMemo present on every generated invoice (weekly)", () => {
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    assert.ok(inv.CustomerMemo?.value,
      `invoice slot=${inv._slot} missing CustomerMemo`);
    // Wording sourced from invoiceMemo.js - assert the exact
    // template output so a copy change surfaces here.
    const expected = buildInvoiceMemo({
      weekStart: "2026-07-27",
      weekEnd:   "2026-08-02",
      isBiweekly: false,
    });
    assert.equal(inv.CustomerMemo.value, expected);
  }
});

test("CustomerMemo present on every generated invoice (biweekly, span form)", () => {
  const invoices = buildCinBiweeklyInvoices();
  for (const inv of invoices) {
    assert.ok(inv.CustomerMemo?.value);
    const expected = buildInvoiceMemo({
      weekStart: "2026-07-13",
      weekEnd:   "2026-07-26",
      isBiweekly: true,
    });
    assert.equal(inv.CustomerMemo.value, expected);
  }
});

// ─── Test-mode override still wins on CustomerMemo ───────────────

test("markPayloadAsTest overwrites CustomerMemo with TEST_MEMO (test-mode marker preserved)", () => {
  // Kevin fence: the test-mode marker on CustomerMemo must still win.
  // If the live-path memo somehow slipped through into a test-mode
  // draft, Sebastian's Friday samples would lose their [TEST] markers
  // and could be mistaken for real invoices.
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    // Sanity: live memo emitted (before override).
    assert.ok(inv.CustomerMemo?.value);
    assert.notEqual(inv.CustomerMemo.value, TEST_MEMO,
      "test setup: live payload should not already carry TEST_MEMO");
    // Apply override.
    const marked = markPayloadAsTest(inv, {
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27",
      weekEnd:   "2026-08-02",
    });
    assert.deepEqual(marked.CustomerMemo, { value: TEST_MEMO },
      "test-mode override must replace CustomerMemo with TEST_MEMO");
  }
});

test("markPayloadAsTest preserves SalesTermRef unchanged", () => {
  // The override rewrites customer-facing fields but must not touch
  // SalesTermRef - test drafts still need to render with Net 30 so
  // Sebastian's Friday samples look complete.
  const invoices = buildTxrWeeklyInvoices();
  for (const inv of invoices) {
    const marked = markPayloadAsTest(inv, {
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27",
      weekEnd:   "2026-08-02",
    });
    assert.deepEqual(marked.SalesTermRef, { value: QBO_TERM_ID_NET30 });
  }
});
