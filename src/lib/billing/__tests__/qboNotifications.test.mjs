// N1 + N2 dry-run rendering tests. C6 acceptance.
//
// Run via: node --test src/lib/billing/__tests__/qboNotifications.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  renderN1, renderN2,
  n1Recipients,
  N1_STATIC_RECIPIENTS, N2_RECIPIENTS,
  SALARIED_MANAGERS_BY_ACCOUNT,
} from "../qboNotifications.js";

test("n1Recipients: includes static set + salaried manager + submitter, deduped", () => {
  const to = n1Recipients({
    accountKey: "TXR - AZ",
    submitterEmail: "l.ochoa@kitchfix.com", // same as salaried manager on purpose
  });
  for (const e of N1_STATIC_RECIPIENTS) {
    assert.ok(to.includes(e), `missing ${e}`);
  }
  for (const e of SALARIED_MANAGERS_BY_ACCOUNT["TXR - AZ"]) {
    assert.ok(to.includes(e), `missing salaried ${e}`);
  }
  // Deduped.
  const set = new Set(to);
  assert.equal(set.size, to.length, "no duplicates in recipient list");
});

test("renderN1 dry-run: subject, recipients, and body content", () => {
  const n1 = renderN1({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    weekEnd:    "2026-08-02",
    submitterEmail: "leader@kitchfix.com",
    invoiceRecords: [{
      invoiceSlot: "main",
      qboInvoiceId: "INV-1",
      qboDocNumber: "K300168954",
      pretaxTotalCents: 189234,
      lineCount: 12,
      isTest: false,
      qboLink: "https://app.qbo.intuit.com/app/invoice?txnId=INV-1",
      ledgerRowId: "led-1",
    }],
    scWeekLink: "https://intranet.example/service-calendar/season?a=TXR",
  });

  assert.equal(n1.mode, "dryrun");
  assert.match(n1.subject, /Invoice draft ready: TXR - AZ 2026-07-27\.\.2026-08-02/);
  assert.ok(n1.to.includes("leader@kitchfix.com"), "submitter included");
  assert.ok(n1.to.includes("sebastian@kitchfix.com"));
  assert.ok(n1.to.includes("k.fietek@kitchfix.com"));
  assert.match(n1.html, /Pre-tax total.*\$1,892\.34/);
  assert.match(n1.html, /K300168954/);
  assert.match(n1.html, /Service Calendar/);
});

test("renderN1 TEST posts prefix subject and add loud test banner", () => {
  const n1 = renderN1({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    weekEnd:    "2026-08-02",
    submitterEmail: "k.fietek@kitchfix.com",
    invoiceRecords: [{
      invoiceSlot: "main",
      qboInvoiceId: "TEST-1",
      qboDocNumber: "K300TEST",
      pretaxTotalCents: 189234,
      lineCount: 12,
      isTest: true,
      qboLink: "https://app.qbo.intuit.com/app/invoice?txnId=TEST-1",
      ledgerRowId: "led-t",
    }],
    scWeekLink: "https://x",
  });
  assert.match(n1.subject, /^TEST - Invoice draft ready:/);
  assert.match(n1.html, /TEST - NOT A REAL INVOICE - DO NOT SEND/);
});

test("renderN1: throws when dryRunOnly=false (send path disabled in PR-C)", () => {
  assert.throws(
    () => renderN1({
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27", weekEnd: "2026-08-02",
      submitterEmail: "x@y.com",
      invoiceRecords: [],
      scWeekLink: "",
      dryRunOnly: false,
    }),
    /live send not enabled in PR-C/,
  );
});

test("renderN2 dry-run: email + slack shape, recipients", () => {
  const n2 = renderN2({
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    weekEnd:    "2026-08-02",
    errorText:  "main [NOT_ALLOWLISTED]: CustomerRef.value=\"19000\" is not in ALLOWED_CUSTOMER_IDS.",
    retryLink:  "https://intranet.example/admin/service-calendar/finalize?action=retry-push",
  });

  assert.equal(n2.email.mode, "dryrun");
  assert.equal(n2.slack.mode, "dryrun");
  assert.deepEqual([...n2.email.to].sort(), [...N2_RECIPIENTS].sort());
  assert.match(n2.email.subject, /QBO push FAILED: TXR - AZ/);
  assert.match(n2.email.html, /push_failed/);
  assert.match(n2.email.html, /NOT_ALLOWLISTED/);
  assert.match(n2.email.html, /Retry from admin/);
  assert.match(n2.slack.text, /QBO push FAILED/);
  assert.match(n2.slack.text, /TXR - AZ/);
  assert.match(n2.slack.text, /2026-07-27\.\.2026-08-02/);
});

test("renderN2: throws when dryRunOnly=false", () => {
  assert.throws(
    () => renderN2({
      accountKey: "TXR - AZ",
      weekStart: "2026-07-27", weekEnd: "2026-08-02",
      errorText: "boom", retryLink: "",
      dryRunOnly: false,
    }),
    /live send not enabled in PR-C/,
  );
});
