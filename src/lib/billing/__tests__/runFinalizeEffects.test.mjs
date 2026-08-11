// runFinalizeEffects tests. C4 acceptance: failure path writes
// failed ledger row, transitions sc_week_finalize to push_failed,
// and fires N2 (dry-run rendered).
//
// Run via: node --test src/lib/billing/__tests__/runFinalizeEffects.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { runFinalizeEffects } from "../../scWeekFinalize.js";
import { NotAllowlistedError } from "../qboAdapter.js";
import { makeSupaMock } from "./_supa-mock.mjs";

const TXR_MAP = {
  account_key: "TXR - AZ",
  qbo_customer_id: "19000",
  qbo_customer_name: "Texas Rangers - Surprise, AZ",
  qbo_taxcode_id: "36",
  cadence: "weekly",
  biweekly_anchor: null,
  active: true,
};

const CIN_MAP = {
  account_key: "CIN - AZ",
  qbo_customer_id: "17752",
  qbo_customer_name: "Cincinnati Reds (Goodyear, AZ)",
  qbo_taxcode_id: "37",
  cadence: "biweekly",
  biweekly_anchor: "2026-05-31",
  active: true,
};

function baseCtx({ accountKey = "TXR - AZ", weekStart = "2026-07-27" } = {}) {
  return {
    accountKey,
    weekStart,
    finalizedRow: {
      id: "fin-row-1",
      account_key: accountKey,
      week_start: weekStart,
      status: "finalized",
      finalized_by: "leader@kitchfix.com",
    },
  };
}

// ─── C4: full failure path (real customer rejected -> push_failed + N2)

test("C4 full failure path: real customer -> failed ledger + push_failed + N2 rendered", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [TXR_MAP],
      sc_qbo_service_map: [
        { service_id: "svc-1", account_key: "TXR - AZ", qbo_item_id: "3338", qbo_line_description: "TXR-AZ - Regular Snack", aggregate_group: null, invoice_slot: "main", tax_override: null, line_desc_style: null, active: true },
      ],
      sc_daily_revenue: [
        { service_date: "2026-07-27", service_id: "svc-1", service_name: "Regular Snack", account_key: "TXR - AZ", is_flat_fee: false, is_tax_free: false, is_non_revenue: false, actual_count: 10, actual_price_at_date: 5.89, price_at_date: 5.89, period: "8", week_label: "Week 3", has_actuals: true, has_projection: false },
      ],
      sc_week_finalize: [{
        id: "fin-row-1", account_key: "TXR - AZ", week_start: "2026-07-27",
        status: "finalized", finalized_by: "leader@kitchfix.com",
      }],
      sc_export_ledger: [],
    },
  });

  let n2Rendered = null;
  const deps = {
    supa,
    renderN2: (args) => {
      n2Rendered = { args, email: { to: ["k.fietek@kitchfix.com","sebastian@kitchfix.com"], subject: `QBO push FAILED: ${args.accountKey}` }, slack: { text: `slack-${args.accountKey}` } };
      return n2Rendered;
    },
    renderN1: () => { throw new Error("N1 must not fire on failure path"); },
    logger:   { info: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);

  assert.equal(result.pushed, false, "pushed=false on failure");
  assert.ok(result.failure, "failure summary present");
  assert.equal(result.failure.code, "NOT_ALLOWLISTED", "code names the fence");

  // Ledger row written for the refused post.
  const ledger = supa._dump("sc_export_ledger");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].status, "failed");
  assert.equal(ledger[0].is_test, false);
  assert.match(ledger[0].error, /NotAllowlistedError.*19000/);

  // sc_week_finalize transitioned to push_failed.
  const finRow = supa._dump("sc_week_finalize")[0];
  assert.equal(finRow.status, "push_failed", "week transitioned to push_failed");

  // N2 fired.
  assert.ok(n2Rendered, "N2 rendered");
  assert.equal(n2Rendered.args.accountKey, "TXR - AZ");
  assert.match(n2Rendered.email.subject, /QBO push FAILED/);
});

// ─── Biweekly first-week awaits pair close (no post attempted) ───

test("biweekly: first week of pair returns awaiting_pair_close without posting", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [CIN_MAP],
      sc_qbo_service_map: [],
      sc_daily_revenue: [],
      // Mock sc_day_metadata: week label 1 = first week of pair.
      sc_day_metadata: [
        { service_date: "2026-07-13", period: "8", week_label: "Week 1" },
      ],
      sc_week_finalize: [{ id: "fin-row-1", account_key: "CIN - AZ", week_start: "2026-07-13", status: "finalized", finalized_by: "leader@kitchfix.com" }],
      sc_export_ledger: [],
    },
  });

  const deps = {
    supa,
    postInvoiceDraft: () => { throw new Error("must not attempt post on first week"); },
    renderN1: () => { throw new Error("N1 must not fire"); },
    renderN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {} },
  };

  const result = await runFinalizeEffects(
    baseCtx({ accountKey: "CIN - AZ", weekStart: "2026-07-13" }),
    deps,
  );
  assert.equal(result.pushed, false);
  assert.equal(result.reason, "awaiting_pair_close");
  assert.equal(result.weekIndex, 1);
  // Finalize row untouched.
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized");
  // No ledger row.
  assert.equal(supa._dump("sc_export_ledger").length, 0);
});

// ─── Config missing (no account map) -> push_failed + N2 ─────────

test("config missing: no account_map row -> push_failed + N2 (CONFIG_MISSING)", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [],  // empty
      sc_qbo_service_map: [],
      sc_daily_revenue: [],
      sc_week_finalize: [{
        id: "fin-row-1", account_key: "UNK - XX", week_start: "2026-07-27",
        status: "finalized", finalized_by: "leader@kitchfix.com",
      }],
      sc_export_ledger: [],
    },
  });
  let n2fired = false;
  const result = await runFinalizeEffects(
    baseCtx({ accountKey: "UNK - XX" }),
    {
      supa,
      renderN2: (args) => { n2fired = true; return { email: { to: [], subject: "x" }, slack: { text: "y" } }; },
      renderN1: () => { throw new Error("N1 must not fire on config missing"); },
      logger:   { info: () => {} },
    },
  );
  assert.equal(result.pushed, false);
  assert.equal(result.failure.code, "CONFIG_MISSING");
  assert.ok(n2fired, "N2 rendered");
  assert.equal(supa._dump("sc_week_finalize")[0].status, "push_failed");
});

// ─── No billable actuals -> no_billable_actuals, week stays finalized

test("no billable actuals: returns no_billable_actuals, week stays finalized, no ledger", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [TXR_MAP],
      sc_qbo_service_map: [],
      sc_daily_revenue: [], // empty
      sc_week_finalize: [{
        id: "fin-row-1", account_key: "TXR - AZ", week_start: "2026-07-27",
        status: "finalized", finalized_by: "leader@kitchfix.com",
      }],
      sc_export_ledger: [],
    },
  });
  const result = await runFinalizeEffects(baseCtx(), {
    supa,
    renderN1: () => { throw new Error("N1 must not fire"); },
    renderN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {} },
  });
  assert.equal(result.pushed, false);
  assert.equal(result.reason, "no_billable_actuals");
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized", "week untouched");
  assert.equal(supa._dump("sc_export_ledger").length, 0);
});

// ─── Happy path (only reachable via test-marking in this PR) ─────

test("happy path (injected fake builder + adapter): success returns N1 render", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [TXR_MAP],
      sc_qbo_service_map: [],
      sc_daily_revenue:   [],
      sc_week_finalize:   [{
        id: "fin-row-1", account_key: "TXR - AZ", week_start: "2026-07-27",
        status: "finalized", finalized_by: "leader@kitchfix.com",
      }],
      sc_export_ledger:   [],
    },
  });

  let n1Args = null;
  const deps = {
    supa,
    buildInvoicePayload: () => ({
      invoices: [{
        _slot: "main",
        CustomerRef: { value: "22463", name: "ZZ TEST" },
        TxnDate: "2026-08-02",
        Line: [
          { DetailType: "SalesItemLineDetail", Amount: 100.00,
            SalesItemLineDetail: { ItemRef: { value: "3338" }, UnitPrice: 5.89, Qty: 17 } },
        ],
      }],
      warnings: [],
    }),
    postInvoiceDraft: async (_payload, _ctx) => ({
      wasNoOp: false,
      ledgerRowId: "led-happy",
      qboInvoiceId: "TEST-INV-9",
      qboDocNumber: "K3HAPPY",
      status: "created",
    }),
    renderN1: (args) => { n1Args = args; return { mode: "dryrun", to: ["x@y"], subject: "ok", html: "..." }; },
    renderN2: () => { throw new Error("N2 must not fire on happy path"); },
    logger:   { info: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, true);
  assert.equal(result.invoiceRecords.length, 1);
  assert.equal(result.invoiceRecords[0].qboInvoiceId, "TEST-INV-9");
  assert.equal(result.invoiceRecords[0].qboDocNumber, "K3HAPPY");
  assert.equal(result.invoiceRecords[0].pretaxTotalCents, 10000);
  assert.equal(n1Args.accountKey, "TXR - AZ");
  assert.equal(n1Args.submitterEmail, "leader@kitchfix.com");
  // Week stays finalized (billing state machine transitions to billed
  // in a follow-up PR; happy path in PR-C does NOT touch that yet).
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized");
});
