// qboAdapter unit tests. PR-C base + PR-F per-mode fence migration.
//
// Run via: node --import ./scripts/_setup/register-aliases.mjs --test \
//          src/lib/billing/__tests__/qboAdapter.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  postInvoiceDraft,
  NotAllowlistedError,
  QboPostError,
  ALLOWED_CUSTOMER_IDS,
  TEST_CUSTOMER_ID,
  markPayloadAsTest,
  shiftTxnDateToTestYear,
  payloadHash,
  composeInvoiceUrl,
  stripInternalMarkers,
  allowedCustomerIdsFor,
  _internals,
} from "../qboAdapter.js";
import { makeSupaMock } from "./_supa-mock.mjs";

const TXR_MAP = {
  account_key: "TXR - AZ",
  qbo_customer_id: "19000",
  qbo_customer_name: "Texas Rangers - Surprise, AZ",
  qbo_taxcode_id: "36",
  cadence: "weekly",
  qbo_mode: "test",           // PR-F sc-35 column
  salaried_manager_emails: [],
  rdo_email: null,
  active: true,
};

const BASE_CTX = {
  accountKey:  "TXR - AZ",
  weekStart:   "2026-07-27",
  weekEnd:     "2026-08-02",
  cadenceUnit: "weekly",
  createdBy:   "k.fietek@kitchfix.com",
  accountMap:  TXR_MAP,
};

function fakePayload(overrides = {}) {
  return {
    _slot: "main",
    CustomerRef: { value: "19000", name: "Texas Rangers - Surprise, AZ" },
    TxnDate:     "2026-08-02",
    TxnTaxDetail: { TxnTaxCodeRef: { value: "36" } },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount:     100.00,
        Description: "Regular Snack",
        SalesItemLineDetail: {
          ServiceDate: "2026-07-27",
          ItemRef: { value: "3338", name: "TXR-AZ - Regular Snack" },
          UnitPrice: 5.89, Qty: 17,
          TaxCodeRef: { value: "TAX" },
        },
      },
    ],
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

test("_internals.shiftTxnDateToTestYear keeps weekday, moves to 2029", () => {
  const shifted = shiftTxnDateToTestYear("2026-07-27");
  assert.equal(shifted.slice(0, 4), "2029");
  const srcDow = new Date("2026-07-27T12:00:00Z").getUTCDay();
  const tgtDow = new Date(`${shifted}T12:00:00Z`).getUTCDay();
  assert.equal(srcDow, tgtDow);
});

test("payloadHash is stable across identical payloads", () => {
  const p1 = fakePayload();
  const p2 = fakePayload();
  assert.equal(payloadHash(p1), payloadHash(p2));
  assert.match(payloadHash(p1), /^[a-f0-9]{64}$/);
});

test("markPayloadAsTest rewrites CustomerRef + TxnDate + descriptions", () => {
  const original = fakePayload();
  const marked = markPayloadAsTest(original, {
    accountKey: "TXR - AZ", weekStart: "2026-07-27", weekEnd: "2026-08-02",
  });
  assert.equal(marked.CustomerRef.value, TEST_CUSTOMER_ID);
  assert.equal(marked.CustomerRef.name, "ZZ TEST - KitchFix Intranet");
  assert.equal(marked.TxnDate.slice(0, 4), "2029");
  assert.match(marked.CustomerMemo.value, /TEST - NOT A REAL INVOICE/);
  assert.match(marked.PrivateNote, /account=TXR - AZ/);
  for (const line of marked.Line) {
    assert.ok(line.Description.startsWith("TEST - "));
  }
  assert.equal(original.CustomerRef.value, "19000");
});

// ─── Per-mode fence (PR-F) ────────────────────────────────────────

test("allowedCustomerIdsFor: test mode returns {22463} regardless of accountMap", () => {
  const s = allowedCustomerIdsFor("test", { qbo_customer_id: "19000" });
  assert.equal(s.size, 1);
  assert.ok(s.has("22463"));
  assert.ok(!s.has("19000"));
});

test("allowedCustomerIdsFor: live mode returns {accountMap.qbo_customer_id}", () => {
  const s = allowedCustomerIdsFor("live", { qbo_customer_id: "19000" });
  assert.equal(s.size, 1);
  assert.ok(s.has("19000"));
  assert.ok(!s.has("22463"));
});

test("allowedCustomerIdsFor: live mode without qbo_customer_id throws", () => {
  assert.throws(() => allowedCustomerIdsFor("live", {}), /qbo_customer_id/);
});

test("allowedCustomerIdsFor: unknown mode throws", () => {
  assert.throws(() => allowedCustomerIdsFor("wat", { qbo_customer_id: "1" }), /unknown mode/);
});

// ─── F7: test mode cannot reach a real customer id ────────────────

test("F7 fence: test mode CANNOT reach real customer id 19000", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  // Craft a raw payload with CustomerRef=19000. Test-marking will
  // rewrite it to 22463 BEFORE the fence, so this normally passes;
  // to prove the fence itself, we skip the test-mark step by
  // passing qboMode='live' with a mismatched CustomerRef. But the
  // F7 acceptance is specifically "test mode cannot reach 19000":
  // in test mode the rewrite forces 22463, so a real customer id
  // is structurally impossible on the wire.
  const fetchImpl = async (_url, _key, payload) => {
    // If the fence ever missed, this would fire with CustomerRef
    // holding 19000. Instead, test mode always sends 22463.
    return { ok: true, status: 200, body: JSON.stringify({ Invoice: { Id: "X", DocNumber: "K3X" } }) };
  };
  let captured = null;
  const captureFetch = async (u, k, p) => { captured = p; return fetchImpl(u, k, p); };

  await postInvoiceDraft(fakePayload({ CustomerRef: { value: "19000", name: "Texas Rangers" } }), {
    ...BASE_CTX,
    qboMode: "test",
    deps: { supa, fetchImpl: captureFetch },
  });

  assert.equal(captured.CustomerRef.value, "22463", "test mode ALWAYS routes to 22463");
  assert.notEqual(captured.CustomerRef.value, "19000");
});

// ─── F7: live mode cannot reach 22463 ─────────────────────────────

test("F7 fence: live mode CANNOT reach test customer 22463", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  // A caller mistakenly built a payload aimed at 22463 in live mode.
  // The fence refuses it; ledger records failed row with mode='live'
  // allowlist and NotAllowlistedError names the mode.
  const fetchImpl = async () => { throw new Error("must not reach network"); };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      accountMap: { ...TXR_MAP, qbo_mode: "live" },
      qboMode: "live",
      deps: { supa, fetchImpl },
    }),
    (err) => {
      assert.ok(err instanceof NotAllowlistedError);
      assert.equal(err.customerId, "22463");
      assert.equal(err.mode, "live");
      assert.deepEqual(err.allowlist, ["19000"]);
      return true;
    },
  );

  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.match(rows[0].error, /mode=live allowlist \[19000\]/);
});

// ─── C2: idempotency (non-test only) ──────────────────────────────

test("C2 idempotency: second post for (account, week, slot) is no-op", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_export_ledger: [{
        id: "row-existing",
        account_key: "TEST - AZ",
        week_start: "2026-07-27",
        invoice_slot: "main",
        status: "created",
        is_test: false,
        qbo_invoice_id: "INV-999",
        qbo_doc_number: "K300999999",
        attempt: 1,
      }],
    },
  });

  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; throw new Error("must not reach network"); };

  const result = await postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
    ...BASE_CTX,
    accountKey: "TEST - AZ",
    accountMap: { ...TXR_MAP, account_key: "TEST - AZ", qbo_mode: "live", qbo_customer_id: "22463" },
    qboMode: "live",
    deps: { supa, fetchImpl },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.wasNoOp, true);
  assert.equal(result.qboInvoiceId, "INV-999");
  assert.equal(supa._dump("sc_export_ledger").length, 1);
});

// ─── C4: 5xx retries once, 4xx no retry, ledger failed ────────────

test("C4 failure: 500 body writes failed ledger + throws QboPostError", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  const fetchImpl = async () => ({ ok: false, status: 500, body: "internal 500" });

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      qboMode: "test",
      deps: { supa, fetchImpl },
    }),
    QboPostError,
  );
  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].is_test, true);
  assert.match(rows[0].error, /internal 500/);
});

test("C4: 400 does NOT retry", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 400, body: "bad payload" }; };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      qboMode: "test",
      deps: { supa, fetchImpl },
    }),
    QboPostError,
  );
  assert.equal(calls, 1);
});

test("C4: 5xx retries exactly once", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 502, body: "bad gateway" }; };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      qboMode: "test",
      deps: { supa, fetchImpl },
    }),
    QboPostError,
  );
  assert.equal(calls, 2);
});

// ─── Test post success ────────────────────────────────────────────

test("qboMode='test': success writes status='test' + is_test=true", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: JSON.stringify({ Invoice: { Id: "TEST-INV-1", DocNumber: "K300TEST01" } }),
  });

  const result = await postInvoiceDraft(fakePayload({
    CustomerRef: { value: "19000", name: "Texas Rangers" },
  }), {
    ...BASE_CTX,
    qboMode: "test",
    deps: { supa, fetchImpl },
  });

  assert.equal(result.status, "test");
  assert.equal(result.qboInvoiceId, "TEST-INV-1");
  const row = supa._dump("sc_export_ledger")[0];
  assert.equal(row.status, "test");
  assert.equal(row.is_test, true);
});

// ─── URL composition (PR-C7 fixes) ────────────────────────────────

test("URL composed from QBO_PROXY_BASE + QBO_REALM_ID", () => {
  assert.equal(
    composeInvoiceUrl("https://chief.ngrok.app/qbo", "1219933770"),
    "https://chief.ngrok.app/qbo/v3/company/1219933770/invoice?minorversion=75",
  );
  assert.equal(
    composeInvoiceUrl("https://chief.ngrok.app/qbo/", "1219933770"),
    "https://chief.ngrok.app/qbo/v3/company/1219933770/invoice?minorversion=75",
  );
});

test("no key beginning with underscore survives into a posted payload", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let captured = null;
  const fetchImpl = async (_u, _k, p) => {
    captured = p;
    return { ok: true, status: 200, body: JSON.stringify({ Invoice: { Id: "X", DocNumber: "K3X" } }) };
  };
  await postInvoiceDraft(fakePayload({
    _slot: "main",
    _preTaxSubtotal: 12345,
    CustomerRef: { value: "22463", name: "ZZ TEST" },
  }), {
    ...BASE_CTX,
    accountMap: { ...TXR_MAP, qbo_mode: "live", qbo_customer_id: "22463" },
    qboMode: "live",
    deps: { supa, fetchImpl },
  });
  function hasUnderscoreKey(node) {
    if (Array.isArray(node)) return node.some(hasUnderscoreKey);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith("_")) return `_key:${k}`;
        const hit = hasUnderscoreKey(v);
        if (hit) return hit;
      }
    }
    return false;
  }
  assert.equal(hasUnderscoreKey(captured), false);
});

test("payload_hash is computed on the stripped (wire-shape) payload", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let captured = null;
  const fetchImpl = async (_u, _k, p) => {
    captured = p;
    return { ok: true, status: 200, body: JSON.stringify({ Invoice: { Id: "X", DocNumber: "K3X" } }) };
  };
  await postInvoiceDraft(fakePayload({
    _slot: "main", _preTaxSubtotal: 12345,
    CustomerRef: { value: "22463", name: "ZZ TEST" },
  }), {
    ...BASE_CTX,
    accountMap: { ...TXR_MAP, qbo_mode: "live", qbo_customer_id: "22463" },
    qboMode: "live",
    deps: { supa, fetchImpl },
  });
  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows[0].payload_hash, payloadHash(captured));
});

// ─── Required-arg guardrail ───────────────────────────────────────

test("qboMode required: missing throws with the field named", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  await assert.rejects(
    () => postInvoiceDraft(fakePayload(), {
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27",
      weekEnd: "2026-08-02",
      cadenceUnit: "weekly",
      createdBy: "x@y",
      accountMap: TXR_MAP,
      deps: { supa },
    }),
    /qboMode required/,
  );
});
