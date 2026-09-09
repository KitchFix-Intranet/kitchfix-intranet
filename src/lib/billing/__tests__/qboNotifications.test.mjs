// N1 + N2 tests. PR-F rebuild: recipient resolver goes through
// resolveRecipients (test-mode first branch returns Kevin only);
// live-send wired via injected email + slack fakes; Slack test-mode
// markers ([TEST] prefix + TEST_SLACK_FOOTER) asserted explicitly.

import test from "node:test";
import assert from "node:assert/strict";
import {
  fireN1, fireN2,
  renderN1, renderN2,
  N1_STATIC_RECIPIENTS, N2_RECIPIENTS,
  TEST_SLACK_FOOTER,
} from "../qboNotifications.js";
import { KEVIN_EMAIL, SEBASTIAN_EMAIL } from "../recipients.js";

// N1 rebuild 2026-09-09: invoiceRecords now MUST carry lineItems so
// the RECORD COPY PDF can render + assert email $ == PDF $. Fixture
// updated to a single-line slot with amountCents matching pretaxTotalCents.
const N1_ARGS_BASE = {
  accountKey: "TXR - AZ",
  weekStart:  "2026-07-27",
  weekEnd:    "2026-08-02",
  submitterEmail: "leader@kitchfix.com",
  invoiceRecords: [{
    invoiceSlot: "main",
    qboInvoiceId: "INV-1",
    qboDocNumber: "K300168954",
    pretaxTotalCents: 1923895,
    lineCount: 1,
    isTest: false,
    qboLink: "https://app.qbo.intuit.com/app/invoice?txnId=INV-1",
    ledgerRowId: "led-1",
    lineItems: [{
      serviceName: "TXR AZ - Full Week",
      serviceDate: "2026-07-27",
      qty: 1,
      rateCents: 1923895,
      amountCents: 1923895,
    }],
  }],
  scWeekLink: "https://intranet.example/service-calendar/season?a=TXR",
};

// Fake email sender: capture args, return "sent".
function makeFakeSender() {
  const calls = [];
  const impl = async (args) => { calls.push(args); return "sent"; };
  return { impl, calls };
}

// Fake Slack sender.
function makeFakeSlack() {
  const calls = [];
  const impl = async (args) => { calls.push(args); return { sent: true }; };
  return { impl, calls };
}

// ─── F4-shaped test: test mode -> Kevin only -> [TEST] subject ───

test("fireN1 test mode: routes to Kevin only, subject prefixed [TEST]", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: ["should-not-be-sent@x.com"], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  assert.deepEqual(res.recipients.to, [KEVIN_EMAIL], "test mode: Kevin only");
  assert.deepEqual(res.recipients.cc, []);
  assert.match(res.subject, /^\[TEST\] Sent to billing: TXR - AZ,/);
  assert.equal(email.calls.length, 1, "one email dispatched");
  assert.deepEqual(email.calls[0].to, [KEVIN_EMAIL]);
  assert.equal(res.email.result, "sent");
});

test("fireN1 live mode: routes to §A6 matrix (static + salaried + submitter)", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: ["l.ochoa@kitchfix.com"], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  const to = res.recipients.to;
  assert.ok(to.includes("sebastian@kitchfix.com"));
  assert.ok(to.includes(KEVIN_EMAIL));
  assert.ok(to.includes("joe@kitchfix.com"));
  assert.ok(to.includes("josh@kitchfix.com"));
  assert.ok(to.includes("l.ochoa@kitchfix.com"));
  assert.ok(to.includes("leader@kitchfix.com"));
  assert.match(res.subject, /^Sent to billing: TXR - AZ,/);
  assert.doesNotMatch(res.subject, /\[TEST\]/);
});

// ─── F5-shaped: N2 test mode -> Kevin only email + Slack with markers ───

test("fireN2 test mode: email Kevin only + Slack with [TEST] prefix + footer", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  const res = await fireN2({
    qboMode: "test",
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    weekEnd:    "2026-08-02",
    errorText:  "Required parameter Line is missing (code 2020)",
    retryLink:  "https://intranet.example/admin/retry",
    scWeekLink: "https://intranet.example/service-calendar/season?a=TXR",
    attempt:    2,
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks.slack.example/xxx" },
  });

  assert.deepEqual(res.recipients.to, [KEVIN_EMAIL], "email: Kevin only in test mode");
  assert.match(res.subject, /^\[TEST\] Push failed: TXR - AZ,/);

  assert.equal(email.calls.length, 1);
  assert.deepEqual(email.calls[0].to, [KEVIN_EMAIL]);

  assert.equal(slack.calls.length, 1, "one Slack post dispatched");
  const posted = slack.calls[0].text;
  assert.ok(posted.startsWith("[TEST] "),
    "test mode Slack post OPENS with [TEST] prefix");
  assert.ok(posted.includes(TEST_SLACK_FOOTER),
    "test mode Slack post carries the TEST_SLACK_FOOTER literal");
  assert.equal(res.slack.result.sent, true);
});

test("fireN2 live mode: Kevin + Sebastian, Slack has NO [TEST] markers", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  await fireN2({
    qboMode: "live",
    accountKey: "TXR - AZ",
    weekStart:  "2026-07-27",
    weekEnd:    "2026-08-02",
    errorText:  "boom",
    retryLink:  "https://x",
    attempt:    1,
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  const to = email.calls[0].to;
  assert.deepEqual([...to].sort(), [KEVIN_EMAIL, SEBASTIAN_EMAIL].sort());
  const posted = slack.calls[0].text;
  assert.ok(!posted.startsWith("[TEST] "), "live Slack post has no [TEST] prefix");
  assert.ok(!posted.includes(TEST_SLACK_FOOTER), "live Slack post has no test footer");
});

// ─── Slack webhook missing: silently skip, email unaffected ──────

test("fireN2 test mode: missing SLACK_SC_BILLING_WEBHOOK_URL silently skips Slack; email still sends", async () => {
  const email = makeFakeSender();
  // Use the REAL sendSlack helper so its null-webhook short-circuit
  // fires. Passing slackWebhookUrl: null through the real helper
  // must return { sent: false, skipped: "no webhook" }.
  const res = await fireN2({
    qboMode: "test",
    accountKey: "TXR - AZ",
    weekStart: "2026-07-27",
    weekEnd:   "2026-08-02",
    errorText: "boom",
    retryLink: "",
    attempt:   1,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  assert.equal(email.calls.length, 1, "email still sent");
  assert.equal(res.slack.result.sent, false, "reports not sent (no webhook)");
  assert.ok(res.slack.result.skipped, "skipped reason present");
});

// ─── Content invariants ──────────────────────────────────────────

test("N1 HTML carries preheader + pre-tax total + Sent-to-billing flag + Open-the-week CTA", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  assert.match(res.preheader, /\$19,238\.95/);
  assert.match(res.html, /Pre-tax/);
  assert.match(res.html, /\$19,238\.95/);
  assert.match(res.html, /Open the week/);
  // 2026-09-09 rebuild: green "Sent to billing" flag replaces "READY
  // FOR REVIEW"; H1 is "The week is finalized".
  assert.match(res.html, /Sent to billing/);
  assert.match(res.html, /The week is finalized/);
  // Attached-copy footer callout
  assert.match(res.html, /attached copy is for your records/);
  // Sebastian named (not "AP")
  assert.match(res.html, /Sebastian reviews it in QuickBooks/);
});

test("N1 email HTML uses table-based markup (survives Outlook)", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  assert.ok(res.html.includes("<table"), "html uses <table>");
  assert.ok(res.html.includes('role="presentation"'), "table role=presentation for AT + Outlook");
  assert.ok(res.html.includes('style="'), "inline styles present");
});

// ─── send=false path (compose without dispatching) ───────────────

test("fireN1 send=false: composes but does not dispatch", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    send: false,
    deps: { emailSender: email.impl },
  });
  assert.equal(email.calls.length, 0);
  assert.equal(res.email.result, "not_sent");
  assert.equal(res.slack.result.sent, false);
  assert.ok(res.slack.result.skipped, "slack skipped when send=false");
});

// ─── Ruling 2 (2026-09-03): fireN1 gains Slack + env presence check ───

test("fireN1 test mode: Slack fires with [TEST] prefix + TEST_SLACK_FOOTER", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks.slack.example/n1" },
  });
  assert.equal(slack.calls.length, 1, "one Slack post dispatched");
  const posted = slack.calls[0].text;
  assert.ok(posted.startsWith("[TEST] "),
    "test mode Slack post OPENS with [TEST] prefix (parity with N2)");
  assert.ok(posted.includes(TEST_SLACK_FOOTER),
    "test mode Slack post carries the TEST_SLACK_FOOTER literal (parity with N2)");
  assert.equal(res.slack.result.sent, true);
});

test("fireN1 live mode: Slack fires WITHOUT [TEST] markers", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: ["l.ochoa@kitchfix.com"], rdoEmail: null },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks.slack.example/n1" },
  });
  assert.equal(slack.calls.length, 1);
  const posted = slack.calls[0].text;
  assert.ok(!posted.startsWith("[TEST] "), "live Slack post has no [TEST] prefix");
  assert.ok(!posted.includes(TEST_SLACK_FOOTER), "live Slack post has no test footer");
  assert.equal(res.slack.result.sent, true);
});

test("fireN1 missing SLACK_SC_BILLING_WEBHOOK_URL silently skips Slack; email still sends", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  assert.equal(email.calls.length, 1, "email still sent when Slack webhook is absent");
  assert.equal(res.email.result, "sent");
  assert.equal(res.slack.result.sent, false);
  assert.equal(res.slack.result.skipped, "no webhook");
});

test("fireN1 test mode: Slack text enumerates per-slot QBO deep-links", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  // 2026-09-09 rebuild: invoiceRecords now require lineItems that
  // sum to pretaxTotalCents. Each slot carries a single line so the
  // per-slot Slack enumeration assertion still holds.
  await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [
      { invoiceSlot: "milb", qboLink: "https://qbo.example/inv/1", pretaxTotalCents: 10000, lineCount: 1, isTest: true,
        lineItems: [{ serviceName: "MiLB", serviceDate: "2026-07-27", qty: 1, rateCents: 10000, amountCents: 10000 }] },
      { invoiceSlot: "mlb",  qboLink: "https://qbo.example/inv/2", pretaxTotalCents: 20000, lineCount: 1, isTest: true,
        lineItems: [{ serviceName: "MLB",  serviceDate: "2026-07-27", qty: 1, rateCents: 20000, amountCents: 20000 }] },
      { invoiceSlot: "ssm",  qboLink: "https://qbo.example/inv/3", pretaxTotalCents: 5000,  lineCount: 1, isTest: true,
        lineItems: [{ serviceName: "SSM",  serviceDate: "2026-07-27", qty: 1, rateCents: 5000,  amountCents: 5000  }] },
    ],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  const posted = slack.calls[0].text;
  assert.ok(posted.includes("milb: https://qbo.example/inv/1"), "milb link enumerated");
  assert.ok(posted.includes("mlb: https://qbo.example/inv/2"),  "mlb link enumerated");
  assert.ok(posted.includes("ssm: https://qbo.example/inv/3"),  "ssm link enumerated");
});

// ─── Pretax-mismatch fence (Kevin ruling 2026-09-09) ───────────
//
// The email's fact-table $ and the PDF's footer $ MUST match. A
// mismatch is worse than no attachment. fireN1 throws before any
// dispatch to force loud failure over silent divergence.

test("fireN1 THROWS when pretaxTotalCents disagrees with sum of lineItems", async () => {
  const email = makeFakeSender();
  await assert.rejects(
    () => fireN1({
      ...N1_ARGS_BASE,
      qboMode: "test",
      invoiceRecords: [{
        ...N1_ARGS_BASE.invoiceRecords[0],
        isTest: true,
        pretaxTotalCents: 1000000,     // claim $10,000
        lineItems: [
          { serviceName: "X", serviceDate: "2026-07-27",
            qty: 1, rateCents: 500000, amountCents: 500000 }, // actual $5,000
        ],
      }],
      accountMap: { salariedManagerEmails: [], rdoEmail: null },
      deps: { emailSender: email.impl },
    }),
    /pretax mismatch/,
  );
  assert.equal(email.calls.length, 0, "must not dispatch on mismatch");
});

test("fireN1: approvedByLede names ALL approvers when the week had multiple (Kevin ruling)", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    submitterEmail: "joe@kitchfix.com",
    submitterName: "Joe Coppolino",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    reviewRows: [
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-07-31T22:00:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-07-31T22:01:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-07-31T22:02:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-07-31T22:03:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-07-31T22:04:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-07-31T22:05:00Z" },
    ],
    deps: { emailSender: email.impl },
  });
  assert.match(res.html, /Joe Coppolino and Desiree Colone approved the week/,
    "multi-approver week must NOT claim a single person approved every day");
  assert.deepEqual(res.approvers, ["Joe Coppolino", "Desiree Colone"]);
});

test("fireN1: single approver == finalizer uses render's exact wording", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    submitterEmail: "joe@kitchfix.com",
    submitterName: "Joe Coppolino",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    reviewRows: [
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-07-31T22:00:00Z" },
    ],
    deps: { emailSender: email.impl },
  });
  assert.match(res.html, /Joe Coppolino approved every day and sent TXR - AZ to billing/);
});

test("fireN1: return includes pdf metadata (filename + byteLength + pretaxCents)", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  assert.equal(res.pdf.filename, "TXR-AZ_week-of-Jul-27_record-copy.pdf");
  assert.equal(res.pdf.pretaxCents, 1923895);
  assert.ok(res.pdf.byteLength > 1000);
  // Confirm the attachment reached the send layer.
  assert.equal(email.calls[0].attachments?.length, 1);
  assert.equal(email.calls[0].attachments[0].filename, "TXR-AZ_week-of-Jul-27_record-copy.pdf");
  assert.equal(email.calls[0].attachments[0].mimeType, "application/pdf");
});

// ─── Legacy render entry points (PR-C tests preserve) ────────────

test("legacy renderN1: still works (dry-run, isTest triggers TEST subject)", () => {
  const n1 = renderN1({
    accountKey: "TXR - AZ",
    weekStart: "2026-07-27", weekEnd: "2026-08-02",
    submitterEmail: "k.fietek@kitchfix.com",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    scWeekLink: "https://x",
  });
  assert.equal(n1.mode, "dryrun");
  assert.match(n1.subject, /^TEST - Sent to billing:/);
});

test("legacy renderN2: still returns email + slack dry-run objects", () => {
  const n2 = renderN2({
    accountKey: "TXR - AZ",
    weekStart: "2026-07-27", weekEnd: "2026-08-02",
    errorText: "boom", retryLink: "https://x",
  });
  assert.equal(n2.email.mode, "dryrun");
  assert.equal(n2.slack.mode, "dryrun");
  assert.match(n2.email.subject, /QBO push FAILED/);
});

// ─── F6: grep proof helper (surface the structural override) ────

test("F6 structural override: test mode returns Kevin only regardless of accountMap contents", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  // Even with a fully-populated accountMap that would normally
  // fan out to a dozen live recipients, test mode must collapse
  // to Kevin only.
  await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: {
      salariedManagerEmails: [
        "a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com",
      ],
      rdoEmail: "s.lynch@kitchfix.com",
    },
    submitterEmail: "leader@kitchfix.com",
    deps: { emailSender: email.impl },
  });
  await fireN2({
    qboMode: "test", accountKey: "TXR - AZ",
    weekStart: "2026-07-27", weekEnd: "2026-08-02",
    errorText: "boom", retryLink: "", attempt: 1,
    accountMap: {
      salariedManagerEmails: ["a@x.com", "b@x.com"],
      rdoEmail: "r.moore@kitchfix.com",
    },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  // Both emails: Kevin only.
  for (const c of email.calls) {
    assert.deepEqual(c.to, [KEVIN_EMAIL], `structural override held: to=${JSON.stringify(c.to)}`);
  }
});

// Sanity: the two exported constants are what the tests expect.
test("static exports: N1_STATIC_RECIPIENTS + N2_RECIPIENTS + TEST_SLACK_FOOTER", () => {
  assert.ok(N1_STATIC_RECIPIENTS.includes(KEVIN_EMAIL));
  assert.ok(N1_STATIC_RECIPIENTS.includes("sebastian@kitchfix.com"));
  assert.ok(N2_RECIPIENTS.includes(KEVIN_EMAIL));
  assert.ok(N2_RECIPIENTS.includes("sebastian@kitchfix.com"));
  assert.equal(typeof TEST_SLACK_FOOTER, "string");
  assert.ok(TEST_SLACK_FOOTER.length > 0);
});
