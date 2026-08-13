// runFinalizeEffects tests. PR-F: qbo_mode wire + fireN1/fireN2 live-send
// via injected fakes. Every path asserts recipients + mode threading.
//
// Run via: node --import ./scripts/_setup/register-aliases.mjs --test \
//          src/lib/billing/__tests__/runFinalizeEffects.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { runFinalizeEffects } from "../../scWeekFinalize.js";
import { NotAllowlistedError } from "../qboAdapter.js";
import { KEVIN_EMAIL } from "../recipients.js";
import { makeSupaMock } from "./_supa-mock.mjs";

const TXR_MAP = {
  account_key: "TXR - AZ",
  qbo_customer_id: "19000",
  qbo_customer_name: "Texas Rangers - Surprise, AZ",
  qbo_taxcode_id: "36",
  cadence: "weekly",
  qbo_mode: "test",
  salaried_manager_emails: [],
  rdo_email: null,
  active: true,
};

const CIN_MAP = {
  ...TXR_MAP,
  account_key: "CIN - AZ",
  qbo_customer_id: "17752",
  qbo_customer_name: "Cincinnati Reds (Goodyear, AZ)",
  qbo_taxcode_id: "37",
  cadence: "biweekly",
  biweekly_anchor: "2026-05-31",
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

function makeSeedTables({ map = TXR_MAP } = {}) {
  return {
    sc_qbo_account_map: [map],
    sc_qbo_service_map: [
      { service_id: "svc-1", account_key: map.account_key, qbo_item_id: "3338",
        qbo_line_description: "TXR-AZ - Regular Snack", aggregate_group: null,
        invoice_slot: "main", tax_override: null, line_desc_style: null, active: true },
    ],
    sc_daily_revenue: [
      { service_date: "2026-07-27", service_id: "svc-1", service_name: "Regular Snack",
        account_key: map.account_key, is_flat_fee: false, is_tax_free: false,
        is_non_revenue: false, actual_count: 10, actual_price_at_date: 5.89,
        price_at_date: 5.89, period: "8", week_label: "Week 3",
        has_actuals: true, has_projection: false },
    ],
    sc_week_finalize: [{
      id: "fin-row-1", account_key: map.account_key, week_start: "2026-07-27",
      status: "finalized", finalized_by: "leader@kitchfix.com",
    }],
    sc_export_ledger: [],
  };
}

// ─── F4: real test finalize -> N1 to Kevin only, subject [TEST] ────

test("F4 shape: test-mode finalize on TXR - AZ fires N1 to Kevin only, subject [TEST]", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables({ map: { ...TXR_MAP, qbo_mode: "test" } }) });

  let n1Args = null;
  const deps = {
    supa,
    postInvoiceDraft: async (_payload, _ctx) => ({
      wasNoOp: false,
      ledgerRowId: "led-test-happy",
      qboInvoiceId: "TEST-INV-9",
      qboDocNumber: "K3TESTHAPPY",
      status: "test",
    }),
    fireN1: async (args) => {
      n1Args = args;
      return {
        recipients: { to: [KEVIN_EMAIL], cc: [] },
        subject: `[TEST] Invoice ready: ${args.accountKey}, week of Jul 27`,
        preheader: "1 invoice, $58.90 pre-tax. Ready for AP review.",
        html: "<html>...</html>",
        emailResult: "sent",
      };
    },
    fireN2: async () => { throw new Error("N2 must not fire on happy path"); },
    logger: { info: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, true, "test-mode post succeeded via injected fake");
  assert.equal(n1Args.qboMode, "test", "qboMode threaded through to fireN1");
  assert.deepEqual(n1Args.accountMap, { salariedManagerEmails: [], rdoEmail: null });
  assert.deepEqual(result.n1.recipients.to, [KEVIN_EMAIL], "N1 to Kevin only in test mode");
  assert.match(result.n1.subject, /^\[TEST\] Invoice ready:/);
});

// ─── F5: failure -> PUSH_FAILED + N2 (Kevin email + Slack markers) ─

test("F5 shape: failure path fires N2 with qboMode=test threaded (markers via notifications module)", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables({ map: { ...TXR_MAP, qbo_mode: "test" } }) });

  let n2Args = null;
  const deps = {
    supa,
    postInvoiceDraft: async () => {
      // Force failure - adapter rejects at fence or QBO 500. Simulate
      // NotAllowlistedError with a customerId that would not match test allowlist.
      const err = new NotAllowlistedError("99999", "test", new Set(["22463"]));
      err.ledgerRowId = "led-failed";
      throw err;
    },
    fireN1: async () => { throw new Error("N1 must not fire on failure"); },
    fireN2: async (args) => {
      n2Args = args;
      return {
        recipients: { to: [KEVIN_EMAIL], cc: [] },
        subject: `[TEST] Push failed: ${args.accountKey}, week of Jul 27`,
        html: "<html>...</html>",
        slack: {
          text: `[TEST] *QBO push failed* for \`${args.accountKey}\`\n... test footer here`,
          result: { sent: true },
        },
        email: { result: "sent" },
      };
    },
    logger: { info: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, false);
  assert.equal(result.failure.code, "NOT_ALLOWLISTED");
  assert.equal(n2Args.qboMode, "test", "N2 receives qboMode=test");
  assert.equal(supa._dump("sc_week_finalize")[0].status, "push_failed",
    "sc_week_finalize transitioned to push_failed");
});

// ─── Biweekly first-week: no post, no notification ─────────────────

test("biweekly: first week of pair returns awaiting_pair_close (no post, no notification)", async () => {
  const supa = makeSupaMock({
    tables: {
      ...makeSeedTables({ map: CIN_MAP }),
      sc_day_metadata: [
        { service_date: "2026-07-13", period: "8", week_label: "Week 1" },
      ],
      sc_week_finalize: [{ id: "fin-row-1", account_key: "CIN - AZ", week_start: "2026-07-13", status: "finalized", finalized_by: "leader@kitchfix.com" }],
    },
  });
  const deps = {
    supa,
    postInvoiceDraft: () => { throw new Error("must not attempt post"); },
    fireN1: () => { throw new Error("N1 must not fire"); },
    fireN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {} },
  };
  const result = await runFinalizeEffects(
    baseCtx({ accountKey: "CIN - AZ", weekStart: "2026-07-13" }),
    deps,
  );
  assert.equal(result.reason, "awaiting_pair_close");
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized");
});

// ─── Config missing: push_failed + N2 (test-mode fallback) ────────

test("config missing: no account_map -> push_failed + N2, qboMode falls back to test", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [],
      sc_qbo_service_map: [],
      sc_daily_revenue: [],
      sc_week_finalize: [{
        id: "fin-row-1", account_key: "UNK - XX", week_start: "2026-07-27",
        status: "finalized", finalized_by: "leader@kitchfix.com",
      }],
      sc_export_ledger: [],
    },
  });
  let n2Args = null;
  const deps = {
    supa,
    fireN2: async (args) => {
      n2Args = args;
      return {
        recipients: { to: [KEVIN_EMAIL], cc: [] },
        subject: "[TEST] Push failed: UNK - XX, week of Jul 27",
        html: "",
        slack: { text: "[TEST] ...", result: { sent: true } },
        email: { result: "sent" },
      };
    },
    fireN1: () => { throw new Error("N1 must not fire on config missing"); },
    logger: { info: () => {} },
  };
  const result = await runFinalizeEffects(baseCtx({ accountKey: "UNK - XX" }), deps);
  assert.equal(result.pushed, false);
  assert.equal(result.failure.code, "CONFIG_MISSING");
  assert.equal(n2Args.qboMode, "test",
    "config-missing path falls back to qboMode=test so N2 stays inside the fence");
});

// ─── No billable actuals: nothing fires ────────────────────────────

test("no billable actuals: week stays finalized, no ledger, no notification", async () => {
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
    fireN1: () => { throw new Error("N1 must not fire"); },
    fireN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {} },
  });
  assert.equal(result.reason, "no_billable_actuals");
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized");
});

// ─── qboMode threading: live-mode accountMap flows through ────────

test("live mode: qboMode='live' + accountMap threaded to postInvoiceDraft and fireN1", async () => {
  const liveMap = {
    ...TXR_MAP,
    qbo_mode: "live",
    salaried_manager_emails: ["l.ochoa@kitchfix.com"],
    rdo_email: "s.lynch@kitchfix.com",
  };
  const supa = makeSupaMock({ tables: makeSeedTables({ map: liveMap }) });

  let postCtx = null;
  let n1Args = null;
  const deps = {
    supa,
    postInvoiceDraft: async (_payload, ctx) => {
      postCtx = ctx;
      return {
        wasNoOp: false, ledgerRowId: "led-live",
        qboInvoiceId: "LIVE-1", qboDocNumber: "K3LIVE",
        status: "created",
      };
    },
    fireN1: async (args) => {
      n1Args = args;
      return {
        recipients: { to: ["sebastian@kitchfix.com", KEVIN_EMAIL, "joe@kitchfix.com", "josh@kitchfix.com", "l.ochoa@kitchfix.com", "leader@kitchfix.com"], cc: [] },
        subject: `Invoice ready: ${args.accountKey}, week of Jul 27`,
        html: "", emailResult: "sent",
      };
    },
    fireN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {} },
  };
  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, true);
  assert.equal(postCtx.qboMode, "live", "postInvoiceDraft got qboMode=live");
  assert.equal(postCtx.accountMap.qbo_customer_id, "19000",
    "postInvoiceDraft got the full accountMap for the live fence");
  assert.equal(n1Args.qboMode, "live");
  assert.deepEqual(n1Args.accountMap, {
    salariedManagerEmails: ["l.ochoa@kitchfix.com"],
    rdoEmail: "s.lynch@kitchfix.com",
  });
  assert.doesNotMatch(n1Args.subject || result.n1.subject, /\[TEST\]/,
    "live-mode subject has no [TEST] prefix");
});
