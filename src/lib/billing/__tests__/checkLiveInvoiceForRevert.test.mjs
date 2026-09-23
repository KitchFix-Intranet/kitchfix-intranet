// checkLiveInvoiceForRevert unit tests. 2026-09-23.
//
// Guard for sc-revert-finalize. The 2026-09-14 TXR-AZ incident:
// revert -> AP-delete in QBO without superseding the ledger row ->
// re-finalize hit the adapter's idempotency short-circuit and
// silently reused the stale ledger row. N1 fired as success. Nothing
// existed in QuickBooks. Guard refuses the revert while a live
// ledger row is still on file, so the operator (or Kevin) has to
// deal with the ledger before re-finalize can silently short-
// circuit.
//
// Run via: node --import ./scripts/_setup/register-aliases.mjs --test \
//          src/lib/billing/__tests__/checkLiveInvoiceForRevert.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { checkLiveInvoiceForRevert } from "../../scWeekFinalize.js";
import { makeSupaMock } from "./_supa-mock.mjs";

const TXR_MAP    = { account_key: "TXR - AZ", cadence: "weekly" };
const CIN_MAP    = { account_key: "CIN - AZ", cadence: "biweekly" };
const WEEK_TXR   = "2026-09-14";   // the actual live-incident week
const WEEK_CIN_2 = "2026-05-25";   // biweekly close-week (Week 2)
const WEEK_CIN_1 = "2026-05-18";   // its pair partner (Week 1)

// ─── Refuse: created live row exists ─────────────────────────────

test("refuses when a created live row exists for the week (weekly)", async () => {
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [TXR_MAP],
    sc_export_ledger: [{
      account_key: "TXR - AZ",
      week_start:  WEEK_TXR,
      status:      "created",
      is_test:     false,
      qbo_doc_number: "KF000000001",
      qbo_invoice_id: "293638",
      invoice_slot: "main",
    }],
  } });
  const result = await checkLiveInvoiceForRevert("TXR - AZ", WEEK_TXR, supa);
  assert.ok(result, "guard fires when a created live row exists");
  assert.equal(result.code, "WEEK_HAS_LIVE_INVOICE");
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].qbo_doc_number, "KF000000001");
  assert.equal(result.spanStart, WEEK_TXR);
});

// ─── Allow: no ledger row ───────────────────────────────────────

test("allows when no ledger row exists (weekly)", async () => {
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [TXR_MAP],
    sc_export_ledger: [],   // empty
  } });
  const result = await checkLiveInvoiceForRevert("TXR - AZ", WEEK_TXR, supa);
  assert.equal(result, null, "no row -> null -> revert allowed");
});

// ─── Allow: superseded ──────────────────────────────────────────

test("allows when the ledger row status is 'superseded'", async () => {
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [TXR_MAP],
    sc_export_ledger: [{
      account_key: "TXR - AZ",
      week_start:  WEEK_TXR,
      status:      "superseded",   // the manual fix Kevin ran in Studio
      is_test:     false,
      qbo_doc_number: "KF000000001",
      invoice_slot: "main",
    }],
  } });
  const result = await checkLiveInvoiceForRevert("TXR - AZ", WEEK_TXR, supa);
  assert.equal(result, null, "superseded -> null -> revert allowed");
});

// ─── Allow: failed ──────────────────────────────────────────────

test("allows when the ledger row status is 'failed'", async () => {
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [TXR_MAP],
    sc_export_ledger: [{
      account_key: "TXR - AZ",
      week_start:  WEEK_TXR,
      status:      "failed",
      is_test:     false,
      qbo_doc_number: "KF000000042",
      invoice_slot: "main",
    }],
  } });
  const result = await checkLiveInvoiceForRevert("TXR - AZ", WEEK_TXR, supa);
  assert.equal(result, null, "failed -> null -> revert allowed");
});

// ─── Allow: is_test=true (test-mode ledger row) ─────────────────

test("allows when the ledger row is is_test=true (test-mode pushes)", async () => {
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [TXR_MAP],
    sc_export_ledger: [{
      account_key: "TXR - AZ",
      week_start:  WEEK_TXR,
      status:      "created",
      is_test:     true,   // test-mode push, not a live invoice
      qbo_doc_number: "KFT000000001",
      invoice_slot: "main",
    }],
  } });
  const result = await checkLiveInvoiceForRevert("TXR - AZ", WEEK_TXR, supa);
  assert.equal(result, null, "test-mode ledger row does not block revert");
});

// ─── Biweekly: reverting week 2 finds the pair-start invoice ────

test("biweekly close-week: refuses when the ledger row is keyed on the pair-start (week 1) Monday", async () => {
  // CIN - AZ pair: week 1 Monday = 2026-05-18, week 2 Monday = 2026-05-25.
  // Finalize is called for week 2; the ledger row lands with
  // week_start = 2026-05-18 (pair start). Reverting week 2 must
  // still find the invoice keyed on week 1.
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [CIN_MAP],
    sc_day_metadata: [
      { account_key: "CIN - AZ", service_date: WEEK_CIN_2, week_label: "Week 2" },
    ],
    sc_export_ledger: [{
      account_key: "CIN - AZ",
      week_start:  WEEK_CIN_1,   // pair start, not the reverted week
      status:      "created",
      is_test:     false,
      qbo_doc_number: "KF000000005",
      invoice_slot: "main",
    }],
  } });
  const result = await checkLiveInvoiceForRevert("CIN - AZ", WEEK_CIN_2, supa);
  assert.ok(result, "biweekly guard must find the pair-start ledger row");
  assert.equal(result.code, "WEEK_HAS_LIVE_INVOICE");
  assert.equal(result.spanStart, WEEK_CIN_1,
    "spanStart is the pair's first week (biweekly close-week semantics)");
  assert.equal(result.invoices[0].qbo_doc_number, "KF000000005");
});

// ─── Biweekly first-week: no invoice yet, revert allowed ────────

test("biweekly first-week: allows when no ledger row exists yet (pair not closed)", async () => {
  // First-week revert case. resolveFinalizeReviewSpan on a Week 1
  // input returns spanStart = own week (no pair adjustment - the
  // first week has not been finalized-and-billed by itself).
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [CIN_MAP],
    sc_day_metadata: [
      { account_key: "CIN - AZ", service_date: WEEK_CIN_1, week_label: "Week 1" },
    ],
    sc_export_ledger: [],   // no invoice yet - pair not closed
  } });
  const result = await checkLiveInvoiceForRevert("CIN - AZ", WEEK_CIN_1, supa);
  assert.equal(result, null, "first-week revert with no invoice is allowed");
});

// ─── Multiple slots on the same pair (CIN - AZ main + rehab) ────

test("multiple slots: all live rows for the week are surfaced in invoices[]", async () => {
  // CIN - AZ pair with two invoice slots both live. The guard must
  // return both so the error message can name each KF number rather
  // than picking one arbitrarily.
  const supa = makeSupaMock({ tables: {
    sc_qbo_account_map: [CIN_MAP],
    sc_day_metadata: [
      { account_key: "CIN - AZ", service_date: WEEK_CIN_2, week_label: "Week 2" },
    ],
    sc_export_ledger: [
      { account_key: "CIN - AZ", week_start: WEEK_CIN_1, status: "created", is_test: false,
        qbo_doc_number: "KF000000010", invoice_slot: "main" },
      { account_key: "CIN - AZ", week_start: WEEK_CIN_1, status: "created", is_test: false,
        qbo_doc_number: "KF000000011", invoice_slot: "rehab" },
    ],
  } });
  const result = await checkLiveInvoiceForRevert("CIN - AZ", WEEK_CIN_2, supa);
  assert.ok(result);
  assert.equal(result.invoices.length, 2, "both slots surfaced");
  const kfs = result.invoices.map(i => i.qbo_doc_number).sort();
  assert.deepEqual(kfs, ["KF000000010", "KF000000011"]);
});
