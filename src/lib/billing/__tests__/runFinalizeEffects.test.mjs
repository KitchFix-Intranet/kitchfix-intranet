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
  qbo_class_id: "1200000000000411132",  // PFS:TXR - AZ (sc-41)
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
  qbo_class_id: "1200000000000130911",  // PFS:CIN - AZ (REDS) (sc-41)
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

function makeSeedTables({ map = TXR_MAP, people = [] } = {}) {
  return {
    // sc-46 (#1161): N1/chase recipients derive from `people`, not from
    // sc_qbo_account_map.salaried_manager_emails. Tests that expect a
    // non-empty salariedManagerEmails must seed rows here - seeding the
    // dead map column proves nothing.
    people,
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
        email: { result: "sent" },
        slack: { text: "[TEST] *Invoice draft ready* ...", result: { sent: true } },
      };
    },
    fireN2: async () => { throw new Error("N2 must not fire on happy path"); },
    logger: { info: () => {}, warn: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, true, "test-mode post succeeded via injected fake");
  assert.equal(n1Args.qboMode, "test", "qboMode threaded through to fireN1");
  assert.deepEqual(n1Args.accountMap, {
    salariedManagerEmails: [], rdoEmail: null, notifyOperators: true,
  });
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
      // 2026-09-16 fix: seed now carries account_key so the scoped
      // meta query in runFinalizeEffects finds the row. Pre-fix, the
      // query was un-scoped and the mock silently returned rows[0];
      // both bugs cancelled out. The scoped query + tightened
      // maybeSingle mock exercises the correct path.
      sc_day_metadata: [
        { account_key: "CIN - AZ", service_date: "2026-07-13", period: "8", week_label: "Week 1" },
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
  const supa = makeSupaMock({ tables: makeSeedTables({
    map: liveMap,
    people: [{
      account_key: "TXR - AZ", status: "ACTIVE", is_salaried: true,
      work_email: "l.ochoa@kitchfix.com", display_name: "L Ochoa",
      is_site_leader: true,
    }],
  }) });

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
        html: "",
        email: { result: "sent" },
        slack: { text: "*Invoice draft ready* ...", result: { sent: true } },
      };
    },
    fireN2: () => { throw new Error("N2 must not fire"); },
    logger: { info: () => {}, warn: () => {} },
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
    notifyOperators: true,   // sc-45: defaults true; pilots set it false explicitly
  });
  assert.doesNotMatch(n1Args.subject || result.n1.subject, /\[TEST\]/,
    "live-mode subject has no [TEST] prefix");
});

// ─── PRETAX_MISMATCH guard (2026-09-16) ───────────────────────────
//
// The seed row is 10 units * $5.89 = $58.90 = 5890 cents. Guard
// compares ctx.confirmedPretaxCents against the payload total and
// stops the push on mismatch. Soft rollout: absent value skips.

test("guard: confirmedPretaxCents matches payload -> proceeds normally", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables() });
  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp: false, ledgerRowId: "led-match", qboInvoiceId: "TEST-INV-M",
      qboDocNumber: "K3MATCH", status: "test",
    }),
    fireN1: async () => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject: "[TEST] Invoice ready", html: "",
      email: { result: "sent" },
      slack: { text: "ok", result: { sent: true } },
    }),
    fireN2: () => { throw new Error("N2 must not fire on matching confirmed cents"); },
    logger: { info: () => {}, warn: () => {} },
  };
  const result = await runFinalizeEffects(
    { ...baseCtx(), confirmedPretaxCents: 5890 },
    deps
  );
  assert.equal(result.pushed, true, "matching confirmed total lets the push proceed");
});

test("guard: confirmedPretaxCents mismatch -> PRETAX_MISMATCH failure + N2 + push_failed", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables() });
  let n2Args = null;
  let postCalled = false;
  const deps = {
    supa,
    postInvoiceDraft: async () => { postCalled = true; return {}; },
    fireN1: () => { throw new Error("N1 must not fire on pretax mismatch"); },
    fireN2: async (args) => {
      n2Args = args;
      return {
        recipients: { to: [KEVIN_EMAIL], cc: [] },
        subject: "[TEST] Invoice send failed",
        preheader: "", html: "",
        email: { result: "sent" },
        slack: { text: "fail", result: { sent: true } },
      };
    },
    logger: { info: () => {}, warn: () => {} },
  };
  const result = await runFinalizeEffects(
    // Operator saw $50.00 (5000 cents); payload built at $58.90 (5890 cents).
    { ...baseCtx(), confirmedPretaxCents: 5000 },
    deps
  );
  assert.equal(result.pushed, false, "mismatch stops the push");
  assert.equal(result.failure.code, "PRETAX_MISMATCH");
  assert.match(
    result.failure.message,
    /amount on screen did not match the amount about to bill/,
    "failure message reads in operator language, not pretax=X/Y",
  );
  assert.equal(result.failure.diagnostic.confirmedCents, 5000);
  assert.equal(result.failure.diagnostic.payloadCents, 5890);
  assert.equal(result.failure.diagnostic.deltaCents, 890);
  assert.equal(postCalled, false, "postInvoiceDraft never called on mismatch");
  assert.ok(n2Args, "N2 was fired");
  assert.match(
    n2Args.errorText,
    /amount on screen did not match the amount about to bill/,
    "N2 carries the operator-language message",
  );
});

test("guard: confirmedPretaxCents absent -> guard skipped (soft rollout)", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables() });
  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp: false, ledgerRowId: "led-absent", qboInvoiceId: "TEST-INV-A",
      qboDocNumber: "K3ABSENT", status: "test",
    }),
    fireN1: async () => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject: "[TEST] Invoice ready", html: "",
      email: { result: "sent" },
      slack: { text: "ok", result: { sent: true } },
    }),
    fireN2: () => { throw new Error("N2 must not fire when guard is skipped"); },
    logger: { info: () => {}, warn: () => {} },
  };
  // No confirmedPretaxCents on ctx - the older-client shape.
  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, true, "absent confirmed total is a no-op for the guard");
});

test("guard: null confirmedPretaxCents also skips (soft rollout - explicit null)", async () => {
  const supa = makeSupaMock({ tables: makeSeedTables() });
  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp: false, ledgerRowId: "led-null", qboInvoiceId: "TEST-INV-N",
      qboDocNumber: "K3NULL", status: "test",
    }),
    fireN1: async () => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject: "[TEST] Invoice ready", html: "",
      email: { result: "sent" },
      slack: { text: "ok", result: { sent: true } },
    }),
    fireN2: () => { throw new Error("N2 must not fire when guard is skipped"); },
    logger: { info: () => {}, warn: () => {} },
  };
  const result = await runFinalizeEffects(
    { ...baseCtx(), confirmedPretaxCents: null },
    deps
  );
  assert.equal(result.pushed, true, "explicit null skips the guard");
});

// ─── Biweekly account-scope regression (2026-09-16 hotfix) ────────
//
// The bug: runFinalizeEffects' pair-alignment lookup at
// scWeekFinalize.js line 520-525 queried sc_day_metadata by
// service_date alone, matching every account with a row for that
// date. .maybeSingle() errored with PGRST116; the destructure
// dropped the error; meta became null; weekIdx became null; the
// weekIdx=2|4 branch never fired; pairStart stayed at weekStart.
// The downstream buildInvoicePayload threw on rows spanning two
// non-paired fiscal weeks (Week 2 + Week 3 instead of Week 1 + 2).
//
// CIN-AZ was the only biweekly account and this was the first time
// anyone ran a biweekly finalize in production - so the defect had
// been latent as long as the code existed.
//
// These tests seed rows for multiple accounts on the same
// service_date to reproduce the collision, and assert that the
// scoped query resolves the caller's account cleanly.

test("biweekly close-week: multi-account rows on same date resolve correctly (regression for pairStart bug)", async () => {
  // Seed the full CIN-AZ close-week pair span with metadata,
  // plus rows for TXR-AZ + TBR-FL + TBJ-FL on the same close-week
  // Monday so the un-scoped query would produce a PGRST116 collision.
  //
  // Also seed sc_daily_revenue for Aug 10-23 with the right week
  // labels so buildInvoicePayload's period-alignment guard doesn't
  // trip. The point of the test is the meta lookup path; keep the
  // downstream small but valid.
  const closeMonday   = "2026-08-17";
  const partnerMonday = "2026-08-10";
  const revenueRows = [];
  // Two dates in each week, one row each, non-zero. Enough for the
  // build to produce an invoice; keeps test fixture small.
  for (const d of ["2026-08-11", "2026-08-13", "2026-08-18", "2026-08-20"]) {
    const week = d < closeMonday ? "Week 1" : "Week 2";
    revenueRows.push({
      service_date: d, service_id: "svc-1", service_name: "Regular Snack",
      account_key: "CIN - AZ",
      is_flat_fee: false, is_tax_free: false, is_non_revenue: false,
      actual_count: 10, actual_price_at_date: 5.89, price_at_date: 5.89,
      period: "9", week_label: week,
      has_actuals: true, has_projection: false,
    });
  }
  const supa = makeSupaMock({
    tables: {
      sc_qbo_account_map: [CIN_MAP],
      sc_qbo_service_map: [
        { service_id: "svc-1", account_key: "CIN - AZ", qbo_item_id: "3338",
          qbo_line_description: "CIN-AZ - Regular Snack", aggregate_group: null,
          invoice_slot: "main", tax_override: null, line_desc_style: null, active: true },
      ],
      sc_daily_revenue: revenueRows,
      sc_week_finalize: [{ id: "fin-row-1", account_key: "CIN - AZ", week_start: closeMonday, status: "finalized", finalized_by: "leader@kitchfix.com" }],
      sc_day_metadata: [
        // The close-week Monday row for the caller.
        { account_key: "CIN - AZ", service_date: closeMonday, period: "9", week_label: "Week 2" },
        // The exact multi-account collision shape that broke production:
        // three other accounts carry rows for the same service_date.
        // Pre-fix: .maybeSingle() errors PGRST116 on 4 matches, error
        // was swallowed, weekIdx=null, pairStart NOT decremented.
        { account_key: "TXR - AZ", service_date: closeMonday, period: "9", week_label: "Week 2" },
        { account_key: "TBR - FL", service_date: closeMonday, period: "9", week_label: "Week 2" },
        { account_key: "TBJ - FL", service_date: closeMonday, period: "9", week_label: "Week 2" },
      ],
    },
  });

  let postedInvoices = 0;
  let capturedSpan = null;
  const deps = {
    supa,
    postInvoiceDraft: async (invoice, ctx) => {
      postedInvoices += 1;
      capturedSpan = { weekStart: ctx.weekStart, weekEnd: ctx.weekEnd };
      return {
        wasNoOp: false, ledgerRowId: `led-${postedInvoices}`,
        qboInvoiceId: `TEST-INV-${postedInvoices}`, qboDocNumber: `K3TEST${postedInvoices}`,
        status: "test",
      };
    },
    fireN1: async () => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject: "[TEST] Invoice ready", html: "",
      email: { result: "sent" },
      slack: { text: "ok", result: { sent: true } },
    }),
    fireN2: () => { throw new Error("N2 must not fire on the happy path"); },
    logger: { info: () => {}, warn: () => {} },
  };
  const result = await runFinalizeEffects(
    baseCtx({ accountKey: "CIN - AZ", weekStart: closeMonday }),
    deps,
  );
  assert.equal(result.pushed, true, "close-week finalize succeeds - pairStart correctly decremented");
  assert.equal(capturedSpan.weekStart, partnerMonday,
    "pairStart resolved to close-week Monday - 7 (pair start), not close-week Monday");
  assert.equal(capturedSpan.weekEnd, "2026-08-23",
    "pairEnd resolved to pairStart + 13 (pair end), not close-week Sunday");
});

test("biweekly close-week: metaErr on lookup is surfaced (not swallowed)", async () => {
  // Force a query error by seeding SIX rows for the same date and
  // relying on the tightened maybeSingle mock (matches production
  // PGRST116 semantics). This proves the destructure surfaces the
  // error instead of dropping it into meta=null.
  //
  // The seed intentionally omits the CIN-AZ row for the queried date
  // so that even WITH the account_key filter, no row matches and the
  // query returns cleanly. But then we swap the mock to inject an
  // error at the metadata table to prove the error path throws.
  //
  // Simpler: seed ONE row but with a different account_key, so the
  // scoped query finds zero rows -> meta=null (clean, not an error).
  // Then override supa.from("sc_day_metadata") to force an error.
  const supa = makeSupaMock({
    tables: {
      ...makeSeedTables({ map: CIN_MAP }),
      sc_day_metadata: [
        // Not the caller's account - the scoped query finds zero
        // rows; base case. We inject an error via the wrapper below.
        { account_key: "OTHER - X", service_date: "2026-07-13", period: "8", week_label: "Week 1" },
      ],
    },
  });
  const wrappedSupa = {
    ...supa,
    from(name) {
      if (name === "sc_day_metadata") {
        // Return an object that mimics the query chain but errors on
        // maybeSingle(). This exercises the metaErr destructure path.
        const api = {
          select: () => api,
          eq: () => api,
          maybeSingle: async () => ({ data: null, error: { code: "PGRST999", message: "simulated DB error" } }),
        };
        return api;
      }
      return supa.from(name);
    },
  };
  const deps = {
    supa: wrappedSupa,
    postInvoiceDraft: () => { throw new Error("must not attempt post"); },
    fireN1: () => { throw new Error("N1 must not fire"); },
    fireN2: () => { throw new Error("N2 must not fire (uncaught throw propagates)"); },
    logger: { info: () => {}, warn: () => {} },
  };
  await assert.rejects(
    () => runFinalizeEffects(baseCtx({ accountKey: "CIN - AZ", weekStart: "2026-07-13" }), deps),
    /load sc_day_metadata for pair alignment: simulated DB error/,
    "metaErr must be surfaced as a thrown error, not swallowed",
  );
});

// ─── FIX 1 (2026-09-23): adapter idempotency short-circuit ─────────
//
// Live incident 2026-09-14 (TXR-AZ): operator resubmitted a week that
// had been reverted in the UI but whose `created` ledger row was still
// on file. postInvoiceDraft honestly returned wasNoOp:true; N1 fired
// anyway, telling everyone the invoice was sent when nothing existed
// in QuickBooks. FIX 1 (Kevin ruling 2026-09-23):
//   D1: suppress operator N1; Kevin alone gets email + Slack
//   D2: return { pushed: false, reason: "already_invoiced", ... }
//       matching the two sibling pushed:false outcomes
//   D3: sc_week_finalize row still transitions to 'finalized'
//   D4: banner copy names the dead end

test("no-op (FIX 1): wasNoOp=true -> pushed:false, reason:already_invoiced, priorInvoiceRecords populated", async () => {
  const liveMap = { ...TXR_MAP, qbo_mode: "live" };
  const supa = makeSupaMock({ tables: makeSeedTables({ map: liveMap }) });

  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp:      true,
      ledgerRowId:  "led-existing",
      qboInvoiceId: "INV-42",
      qboDocNumber: "KF000000042",
      status:       "created",
    }),
    fireN1: () => { throw new Error("N1 must NOT fire on no-op path"); },
    fireN2: () => { throw new Error("N2 must NOT fire on no-op path"); },
    fireNoOpAlert: async (args) => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject:    `[SC no-op] ${args.accountKey} week of Jul 27 - operator resubmitted; existing invoice KF000000042 on file`,
      preheader:  "",
      html:       "<html>...</html>",
      slack:      { text: "*SC no-op alert* ...", result: { sent: true } },
      email:      { result: "sent" },
    }),
    logger: { info: () => {}, warn: () => {} },
  };

  const result = await runFinalizeEffects(baseCtx(), deps);
  assert.equal(result.pushed, false,
    "D2 ruling: PRIMARY flag is honest - nothing was pushed");
  assert.equal(result.reason, "already_invoiced",
    "D2 ruling: reason matches sibling pushed:false outcomes");
  assert.equal(Array.isArray(result.priorInvoiceRecords), true);
  assert.equal(result.priorInvoiceRecords.length, 1);
  assert.equal(result.priorInvoiceRecords[0].qbo_doc_number, "KF000000042");
  assert.equal(result.priorInvoiceRecords[0].qbo_invoice_id, "INV-42");
  assert.equal(result.priorInvoiceRecords[0].ledger_row_id, "led-existing");
  assert.ok(result.kevinAlert, "kevinAlert attached to result for consumers");
  assert.deepEqual(result.kevinAlert.recipients.to, [KEVIN_EMAIL],
    "D1 ruling: Kevin alone on the alert, no operator or Sebastian");
});

test("no-op (FIX 1): fireN1 NOT called; fireNoOpAlert called with account/week/submitter/priorInvoices", async () => {
  const liveMap = { ...TXR_MAP, qbo_mode: "live" };
  const supa = makeSupaMock({ tables: makeSeedTables({ map: liveMap }) });

  let n1Called = false;
  let noOpArgs = null;
  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp:      true,
      ledgerRowId:  "led-existing",
      qboInvoiceId: "INV-42",
      qboDocNumber: "KF000000042",
      status:       "created",
    }),
    fireN1: async () => { n1Called = true; return {}; },
    fireN2: () => { throw new Error("N2 must NOT fire on no-op path"); },
    fireNoOpAlert: async (args) => {
      noOpArgs = args;
      return {
        recipients: { to: [KEVIN_EMAIL], cc: [] },
        subject:    "[SC no-op] ...",
        html:       "",
        slack:      { text: "", result: { sent: true } },
        email:      { result: "sent" },
      };
    },
    logger: { info: () => {}, warn: () => {} },
  };

  await runFinalizeEffects(baseCtx(), deps);
  assert.equal(n1Called, false,
    "D1 ruling: operator N1 suppressed - a truthful N1 was the bug the fix removes");
  assert.ok(noOpArgs, "fireNoOpAlert MUST fire on the no-op path");
  assert.equal(noOpArgs.accountKey, "TXR - AZ");
  assert.equal(noOpArgs.weekStart, "2026-07-27");
  assert.equal(noOpArgs.weekEnd, "2026-08-02",
    "weekEnd is Sunday of the same week (weekly cadence)");
  assert.equal(Array.isArray(noOpArgs.priorInvoices), true);
  assert.equal(noOpArgs.priorInvoices.length, 1);
  assert.equal(noOpArgs.priorInvoices[0].qbo_doc_number, "KF000000042",
    "Kevin's alert receives the KF number so it can name it in email + Slack");
});

test("no-op (FIX 1): sc_week_finalize row stays 'finalized' (D3 ruling)", async () => {
  const liveMap = { ...TXR_MAP, qbo_mode: "live" };
  const supa = makeSupaMock({ tables: makeSeedTables({ map: liveMap }) });

  const deps = {
    supa,
    postInvoiceDraft: async () => ({
      wasNoOp: true, ledgerRowId: "led-existing",
      qboInvoiceId: "INV-42", qboDocNumber: "KF000000042", status: "created",
    }),
    fireN1: () => { throw new Error("N1 must NOT fire on no-op path"); },
    fireN2: () => { throw new Error("N2 must NOT fire on no-op path"); },
    fireNoOpAlert: async () => ({
      recipients: { to: [KEVIN_EMAIL], cc: [] },
      subject: "", html: "", slack: { text: "", result: { sent: true } },
      email: { result: "sent" },
    }),
    logger: { info: () => {}, warn: () => {} },
  };

  await runFinalizeEffects(baseCtx(), deps);
  assert.equal(supa._dump("sc_week_finalize")[0].status, "finalized",
    "D3 ruling: the operator did finalize; the row records their action");
});

