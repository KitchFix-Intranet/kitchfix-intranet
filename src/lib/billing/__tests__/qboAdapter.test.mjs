// qboAdapter unit tests. Covers PR-C acceptance C2 + C3 + C4 and the
// test-marking + hash + shift helpers.
//
// Run via: node --test src/lib/billing/__tests__/qboAdapter.test.mjs

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
  _internals,
} from "../qboAdapter.js";
import { makeSupaMock } from "./_supa-mock.mjs";

const BASE_CTX = {
  accountKey:  "TXR - AZ",
  weekStart:   "2026-07-27",
  weekEnd:     "2026-08-02",
  cadenceUnit: "weekly",
  createdBy:   "k.fietek@kitchfix.com",
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
  // 2026-07-27 is a Monday (getUTCDay = 1). Same-weekday 2029 Monday
  // should land on 2029-01-01 (Monday) or the next same-weekday.
  const shifted = shiftTxnDateToTestYear("2026-07-27");
  assert.equal(shifted.slice(0, 4), "2029", "year moved to 2029");
  const srcDow = new Date("2026-07-27T12:00:00Z").getUTCDay();
  const tgtDow = new Date(`${shifted}T12:00:00Z`).getUTCDay();
  assert.equal(srcDow, tgtDow, "weekday preserved");
});

test("payloadHash is stable across identical payloads", () => {
  const p1 = fakePayload();
  const p2 = fakePayload();
  assert.equal(payloadHash(p1), payloadHash(p2), "same content = same hash");
  assert.match(payloadHash(p1), /^[a-f0-9]{64}$/, "sha256 hex shape");
});

test("markPayloadAsTest rewrites CustomerRef + TxnDate + descriptions", () => {
  const original = fakePayload();
  const marked = markPayloadAsTest(original, {
    accountKey: "TXR - AZ", weekStart: "2026-07-27", weekEnd: "2026-08-02",
  });
  assert.equal(marked.CustomerRef.value, TEST_CUSTOMER_ID);
  assert.equal(marked.CustomerRef.name, "ZZ TEST - KitchFix Intranet");
  assert.equal(marked.TxnDate.slice(0, 4), "2029", "TxnDate moved to 2029");
  assert.match(marked.CustomerMemo.value, /TEST - NOT A REAL INVOICE/);
  assert.match(marked.PrivateNote, /account=TXR - AZ/);
  assert.match(marked.PrivateNote, /real_week=2026-07-27\.\.2026-08-02/);
  for (const line of marked.Line) {
    assert.ok(line.Description.startsWith("TEST - "), `line desc has TEST prefix: ${line.Description}`);
  }
  // Original untouched.
  assert.equal(original.CustomerRef.value, "19000");
  assert.equal(original.TxnDate, "2026-08-02");
  assert.equal(original.Line[0].Description, "Regular Snack");
});

// ─── C3: Fence refuses real customers ─────────────────────────────

test("C3 fence: real customer id 19000 is refused and writes failed ledger", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  const fetchImpl = async () => { throw new Error("must not reach network"); };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "19000", name: "Texas Rangers" } }), {
      ...BASE_CTX,
      isTest: false,
      deps: { supa, fetchImpl },
    }),
    (err) => {
      assert.ok(err instanceof NotAllowlistedError, "throws NotAllowlistedError");
      assert.equal(err.customerId, "19000");
      return true;
    },
  );

  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 1, "one ledger row written");
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].is_test, false);
  assert.match(rows[0].error, /NotAllowlistedError.*19000/);
});

test("C3 fence: CIN customer 17752 also refused", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  const fetchImpl = async () => { throw new Error("must not reach network"); };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "17752", name: "Cincinnati Reds" } }), {
      ...BASE_CTX,
      accountKey: "CIN - AZ",
      isTest: false,
      deps: { supa, fetchImpl },
    }),
    NotAllowlistedError,
  );
  assert.equal(supa._dump("sc_export_ledger").length, 1);
  assert.equal(supa._dump("sc_export_ledger")[0].status, "failed");
});

test("C3 fence: only 22463 is in the allow-list constant", () => {
  assert.equal(ALLOWED_CUSTOMER_IDS.size, 1);
  assert.ok(ALLOWED_CUSTOMER_IDS.has("22463"));
  assert.ok(!ALLOWED_CUSTOMER_IDS.has("19000"));
  assert.ok(!ALLOWED_CUSTOMER_IDS.has("17752"));
});

// ─── C2: Idempotency ─────────────────────────────────────────────

test("C2 idempotency: second post for same (account, week, slot) is a no-op", async () => {
  // Pre-seed the ledger with a 'created' row.
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

  // Adapter should short-circuit BEFORE the fetch.
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; throw new Error("must not reach network"); };

  const result = await postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
    ...BASE_CTX,
    accountKey: "TEST - AZ",
    isTest: false,
    deps: { supa, fetchImpl },
  });

  assert.equal(fetchCalled, false, "network never called");
  assert.equal(result.wasNoOp, true, "wasNoOp=true");
  assert.equal(result.qboInvoiceId, "INV-999");
  assert.equal(result.qboDocNumber, "K300999999");
  assert.equal(result.ledgerRowId, "row-existing");
  // No new ledger row inserted.
  assert.equal(supa._dump("sc_export_ledger").length, 1);
});

// ─── C4: Failure path ────────────────────────────────────────────

test("C4 failure: 500 response writes failed ledger + throws QboPostError", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  // Both attempts (initial + retry) return 500.
  const fetchImpl = async () => ({ ok: false, status: 500, body: "QBO internal error 500" });

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      isTest: false,
      deps: { supa, fetchImpl },
    }),
    (err) => {
      assert.ok(err instanceof QboPostError);
      assert.equal(err.status, 500);
      return true;
    },
  );

  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].is_test, false);
  assert.match(rows[0].error, /QBO internal error 500/);
});

test("C4: 400 does NOT retry, writes failed ledger", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let callCount = 0;
  const fetchImpl = async () => { callCount++; return { ok: false, status: 400, body: "bad payload" }; };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      isTest: false,
      deps: { supa, fetchImpl },
    }),
    QboPostError,
  );
  assert.equal(callCount, 1, "4xx: exactly one call, no retry");
  assert.equal(supa._dump("sc_export_ledger")[0].status, "failed");
});

test("C4: 5xx retries exactly once", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let callCount = 0;
  const fetchImpl = async () => { callCount++; return { ok: false, status: 502, body: "bad gateway" }; };

  await assert.rejects(
    () => postInvoiceDraft(fakePayload({ CustomerRef: { value: "22463", name: "ZZ TEST" } }), {
      ...BASE_CTX,
      isTest: false,
      deps: { supa, fetchImpl },
    }),
    QboPostError,
  );
  assert.equal(callCount, 2, "5xx: one retry (2 total calls)");
});

test("test post: successful call writes status='test' + is_test=true", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: JSON.stringify({ Invoice: { Id: "TEST-INV-1", DocNumber: "K300TEST01" } }),
  });

  const result = await postInvoiceDraft(fakePayload({
    CustomerRef: { value: "19000", name: "Texas Rangers" },  // rewritten by test-marking
  }), {
    ...BASE_CTX,
    isTest: true,
    deps: { supa, fetchImpl },
  });

  assert.equal(result.status, "test");
  assert.equal(result.qboInvoiceId, "TEST-INV-1");
  assert.equal(result.qboDocNumber, "K300TEST01");
  const row = supa._dump("sc_export_ledger")[0];
  assert.equal(row.status, "test");
  assert.equal(row.is_test, true);
  assert.equal(row.qbo_invoice_id, "TEST-INV-1");
});

test("test post: idempotency guard is SKIPPED for isTest (allows re-runs)", async () => {
  const supa = makeSupaMock({
    tables: {
      sc_export_ledger: [{
        id: "prior-test-row",
        account_key: "TXR - AZ",
        week_start: "2026-07-27",
        invoice_slot: "main",
        status: "test",
        is_test: true,
        qbo_invoice_id: "PRIOR-1",
        qbo_doc_number: "K3PRIOR",
        attempt: 1,
      }],
    },
  });
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: JSON.stringify({ Invoice: { Id: "NEW-TEST", DocNumber: "K3NEW" } }),
  });

  const result = await postInvoiceDraft(fakePayload({
    CustomerRef: { value: "19000", name: "Texas Rangers" },
  }), {
    ...BASE_CTX,
    isTest: true,
    deps: { supa, fetchImpl },
  });

  assert.equal(result.wasNoOp, false, "test posts always re-fire");
  assert.equal(result.qboInvoiceId, "NEW-TEST");
  // Two rows now (prior + new), new attempt = 2.
  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 2);
  const newest = rows.find((r) => r.qbo_invoice_id === "NEW-TEST");
  assert.equal(newest.attempt, 2);
});

// ─── C7 corrections (owner 2026-08-11) ───────────────────────────

test("URL is composed from QBO_PROXY_BASE + QBO_REALM_ID (trailing slash safe, realm URI-encoded)", () => {
  // Canonical shape from Kevin's .env.local.
  assert.equal(
    composeInvoiceUrl("https://chief.ngrok.app/qbo", "1219933770"),
    "https://chief.ngrok.app/qbo/v3/company/1219933770/invoice?minorversion=75",
  );
  // Trailing slash on base gets stripped.
  assert.equal(
    composeInvoiceUrl("https://chief.ngrok.app/qbo/", "1219933770"),
    "https://chief.ngrok.app/qbo/v3/company/1219933770/invoice?minorversion=75",
  );
  // Multiple trailing slashes collapsed.
  assert.equal(
    composeInvoiceUrl("https://chief.ngrok.app/qbo///", "1219933770"),
    "https://chief.ngrok.app/qbo/v3/company/1219933770/invoice?minorversion=75",
  );
  // Realm is URI-encoded (safe if it ever carries a non-ASCII char).
  assert.equal(
    composeInvoiceUrl("https://example/qbo", "abc def"),
    "https://example/qbo/v3/company/abc%20def/invoice?minorversion=75",
  );
  // Missing args throw with the field named.
  assert.throws(() => composeInvoiceUrl("", "1"), /proxyBase required/);
  assert.throws(() => composeInvoiceUrl("https://x", ""), /realmId required/);
});

test("no key beginning with underscore survives into a posted payload", async () => {
  // Capture the exact body the adapter would POST. The adapter's
  // fetchImpl receives (url, apiKey, payload); we inspect the
  // payload object for any `_`-prefixed key at any depth.
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let capturedPayload = null;
  const fetchImpl = async (_url, _key, payload) => {
    capturedPayload = payload;
    return { ok: true, status: 200, body: JSON.stringify({ Invoice: { Id: "X", DocNumber: "K3X" } }) };
  };

  // Payload starts with _slot and _preTaxSubtotal (builder markers).
  const payload = fakePayload({
    _slot: "main",
    _preTaxSubtotal: 12345,
    CustomerRef: { value: "22463", name: "ZZ TEST" },
  });

  await postInvoiceDraft(payload, {
    ...BASE_CTX,
    isTest: false,
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
  assert.ok(capturedPayload, "fetchImpl received the payload");
  const hit = hasUnderscoreKey(capturedPayload);
  assert.equal(hit, false, `underscore-prefixed key survived into POST: ${hit}`);
});

test("payload_hash is computed on the stripped (wire-shape) payload", () => {
  // Two payloads that differ ONLY in the internal markers - they
  // must produce the SAME hash after stripping.
  const withMarkers = {
    _slot: "main",
    _preTaxSubtotal: 999,
    CustomerRef: { value: "22463", name: "ZZ TEST" },
    TxnDate: "2029-01-01",
    Line: [
      { DetailType: "SalesItemLineDetail", Amount: 10,
        SalesItemLineDetail: { ItemRef: { value: "3338" }, UnitPrice: 5, Qty: 2 } },
    ],
  };
  const withoutMarkers = {
    CustomerRef: { value: "22463", name: "ZZ TEST" },
    TxnDate: "2029-01-01",
    Line: [
      { DetailType: "SalesItemLineDetail", Amount: 10,
        SalesItemLineDetail: { ItemRef: { value: "3338" }, UnitPrice: 5, Qty: 2 } },
    ],
  };
  const h1 = payloadHash(stripInternalMarkers(withMarkers));
  const h2 = payloadHash(withoutMarkers);
  assert.equal(h1, h2, "stripped hash matches marker-less hash");
});

test("ledger row's payload_hash matches the stripped payload sent to fetchImpl", async () => {
  const supa = makeSupaMock({ tables: { sc_export_ledger: [] } });
  let capturedPayload = null;
  const fetchImpl = async (_url, _key, payload) => {
    capturedPayload = payload;
    return { ok: true, status: 200, body: JSON.stringify({ Invoice: { Id: "X", DocNumber: "K3X" } }) };
  };

  await postInvoiceDraft(fakePayload({
    _slot: "main",
    _preTaxSubtotal: 12345,
    CustomerRef: { value: "22463", name: "ZZ TEST" },
  }), {
    ...BASE_CTX,
    isTest: false,
    deps: { supa, fetchImpl },
  });

  const rows = supa._dump("sc_export_ledger");
  assert.equal(rows.length, 1);
  const ledgerHash = rows[0].payload_hash;
  const wireHash = payloadHash(capturedPayload);
  assert.equal(ledgerHash, wireHash,
    "ledger's payload_hash is the sha256 of the exact bytes POSTed to QBO");
});
