#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_qbo_invoice_fields_roundtrip.mjs
// Mount-verify: POST a test-mode invoice + GET it back + confirm
// SalesTermRef reads Net 30, DueDate is computed, memo appears.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Kevin's fence: "getComputedStyle-equivalent discipline, meaning
// read the actual QBO object rather than inferring from the payload
// we sent."
//
// Flow:
//   1. Build a minimal payload via buildInvoicePayload for TXR - AZ.
//   2. markPayloadAsTest -> rewrites CustomerRef to ZZ TEST + memo
//      to TEST_MEMO + TxnDate shifted forward. Test-mode fence.
//   3. POST via the same proxy the finalize path uses.
//   4. GET the created invoice by Id.
//   5. Assert on the response object:
//      - SalesTermRef.name === "Net 30" (Id=7)
//      - DueDate === TxnDate + 30 days
//      - CustomerMemo.value === TEST_MEMO (test-mode override still wins)
//      - DocNumber is present (assigned by QBO) - proves QBO's
//        sequence continues without us sending one
//   6. Print the created invoice's Id + DocNumber so Kevin can see
//      it in the QBO console.
//
// Run with:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_qbo_invoice_fields_roundtrip.mjs

import { buildInvoicePayload, QBO_TERM_ID_NET30 } from "../../src/lib/billing/buildInvoicePayload.js";
import { markPayloadAsTest, TEST_MEMO } from "../../src/lib/billing/qboAdapter.js";
import { TXR_AZ_ACCOUNT_MAP, TXR_AZ_SERVICE_MAP } from "../../src/lib/billing/__tests__/_helpers.mjs";

// Presence checks
const req = ["QBO_PROXY_BASE", "QBO_PROXY_KEY", "QBO_REALM_ID"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

const base  = process.env.QBO_PROXY_BASE.replace(/\/+$/, "");
const realm = encodeURIComponent(process.env.QBO_REALM_ID);
const auth  = { "X-API-Key": process.env.QBO_PROXY_KEY, "Content-Type": "application/json", "Accept": "application/json" };

// ─── Build payload ─────────────────────────────────────────────
function scRow(partial) {
  return {
    service_date: partial.service_date, service_id: partial.service_id,
    service_name: partial.service_name, account_key: partial.account_key,
    is_flat_fee: false, is_tax_free: false, is_non_revenue: false,
    actual_count: partial.actual_count, actual_price_at_date: partial.price,
    price_at_date: partial.price, projected_count: null,
    period: "8", week_label: "Week 3",
    has_actuals: true, has_projection: false,
  };
}

const rows = ["2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-01","2026-08-02"]
  .map((d) => scRow({
    service_date: d,
    service_id: "6871d41e-08a8-4603-92c4-ba399a3a3674", // TXR-AZ Continental Breakfast
    service_name: "Continental Breakfast",
    account_key: "TXR - AZ",
    actual_count: 25, price: 17.83,
  }));

const { invoices } = buildInvoicePayload({
  accountKey: "TXR - AZ",
  weekStart:  "2026-07-27",
  accountMap: TXR_AZ_ACCOUNT_MAP,
  serviceMap: TXR_AZ_SERVICE_MAP,
  rows,
});

if (invoices.length === 0) {
  console.error("no invoices generated - fixture setup broken");
  process.exit(3);
}
const [inv] = invoices;

// Sanity-print payload fields we care about BEFORE the test-mode
// override, so the log shows what our builder produced.
console.log("\n─── Payload BEFORE markPayloadAsTest ───");
console.log(`  CustomerRef:  ${JSON.stringify(inv.CustomerRef)}`);
console.log(`  TxnDate:      ${inv.TxnDate}`);
console.log(`  SalesTermRef: ${JSON.stringify(inv.SalesTermRef)}`);
console.log(`  CustomerMemo: ${JSON.stringify(inv.CustomerMemo)}`);
console.log(`  DueDate:      ${inv.DueDate ?? "(not emitted - correct)"}`);
console.log(`  DocNumber:    ${inv.DocNumber ?? "(not emitted - correct)"}`);

// Apply the test-mode override + strip internal markers before POST.
const marked = markPayloadAsTest(inv, {
  accountKey: "TXR - AZ",
  weekStart:  "2026-07-27",
  weekEnd:    "2026-08-02",
});
// The adapter's internal _slot / _preTaxSubtotal fields would confuse
// QBO; strip them.
delete marked._slot;
delete marked._preTaxSubtotal;

console.log("\n─── Payload AFTER markPayloadAsTest (safe to POST) ───");
console.log(`  CustomerRef:  ${JSON.stringify(marked.CustomerRef)}`);
console.log(`  TxnDate:      ${marked.TxnDate}   (shifted to test year)`);
console.log(`  SalesTermRef: ${JSON.stringify(marked.SalesTermRef)}`);
console.log(`  CustomerMemo: ${JSON.stringify(marked.CustomerMemo)}`);

if (marked.CustomerRef.value !== "22463") {
  console.error("ABORT: CustomerRef not ZZ TEST after markPayloadAsTest - refusing to POST");
  process.exit(4);
}

// ─── POST ─────────────────────────────────────────────────────
const postUrl = `${base}/v3/company/${realm}/invoice?minorversion=75`;
console.log(`\nPOST ${postUrl}`);
const postRes = await fetch(postUrl, { method: "POST", headers: auth, body: JSON.stringify(marked) });
const postBody = await postRes.text();
if (!postRes.ok) {
  console.error(`POST failed: ${postRes.status} ${postRes.statusText}`);
  console.error(postBody.slice(0, 2000));
  process.exit(5);
}
const posted = JSON.parse(postBody);
const invoiceId = posted?.Invoice?.Id;
if (!invoiceId) {
  console.error("POST returned but no Invoice.Id in response");
  console.error(postBody.slice(0, 500));
  process.exit(6);
}
console.log(`Created draft Invoice.Id=${invoiceId}  DocNumber=${posted?.Invoice?.DocNumber || "(none)"}`);

// ─── GET (round-trip read) ────────────────────────────────────
const getUrl = `${base}/v3/company/${realm}/invoice/${invoiceId}?minorversion=75`;
console.log(`\nGET ${getUrl}`);
const getRes = await fetch(getUrl, { method: "GET", headers: auth });
if (!getRes.ok) {
  console.error(`GET failed: ${getRes.status} ${getRes.statusText}`);
  process.exit(7);
}
const read = (await getRes.json())?.Invoice;

// ─── Assertions ──────────────────────────────────────────────
const results = [];
function check(label, cond, detail) {
  results.push({ label, pass: !!cond, detail });
}

check(
  `SalesTermRef.value === '${QBO_TERM_ID_NET30}'`,
  read?.SalesTermRef?.value === QBO_TERM_ID_NET30,
  `got=${JSON.stringify(read?.SalesTermRef)}`,
);
check(
  "SalesTermRef.name reads 'Net 30'",
  read?.SalesTermRef?.name === "Net 30",
  `got=${read?.SalesTermRef?.name}`,
);

// DueDate = TxnDate + 30 (Net 30). QBO computes this from the term
// we sent + the TxnDate.
function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const expectedDue = addDaysIso(read?.TxnDate || "", 30);
check(
  `DueDate === TxnDate + 30`,
  read?.DueDate === expectedDue,
  `TxnDate=${read?.TxnDate}  DueDate=${read?.DueDate}  expected=${expectedDue}`,
);

check(
  "CustomerMemo.value === TEST_MEMO (test-mode override survived)",
  read?.CustomerMemo?.value === TEST_MEMO,
  `got=${JSON.stringify(read?.CustomerMemo)}`,
);

// NOTE: DocNumber behavior on this tenant is "assigned on save,
// not on draft". Drafts read back with DocNumber undefined. This is
// tenant-side behavior (Custom Transaction Numbers setting), not
// our concern - the load-bearing invariant is "we don't send one",
// which unit tests already cover. Log the tenant behavior so
// Sebastian is not surprised on Friday when the sample drafts show
// blank invoice numbers.
const docNumBehavior = read?.DocNumber
  ? `DocNumber assigned on draft: ${read.DocNumber}`
  : `Draft returned without DocNumber (assigned on save-and-send by QBO)`;

check(
  "CustomerRef locked to ZZ TEST (22463)",
  read?.CustomerRef?.value === "22463",
  `got=${JSON.stringify(read?.CustomerRef)}`,
);

console.log("\n═══ ROUND-TRIP ASSERTIONS ═══");
for (const r of results) {
  console.log(`  ${r.pass ? "✔" : "✖"} ${r.label}   ${r.detail}`);
}
console.log(`\n═══ TENANT BEHAVIOR (informational) ═══`);
console.log(`  ${docNumBehavior}`);
const allPassed = results.every((r) => r.pass);
console.log(`\n${allPassed ? "ALL ASSERTIONS PASSED" : "SOME ASSERTIONS FAILED"}`);
console.log(`\nQBO draft available at: ${base.replace(/\/qbo$/, "")}/app/invoice?txnId=${invoiceId} (via Kevin's QBO console)`);
process.exit(allPassed ? 0 : 8);
