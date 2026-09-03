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
    lineCount: 12,
    isTest: false,
    qboLink: "https://app.qbo.intuit.com/app/invoice?txnId=INV-1",
    ledgerRowId: "led-1",
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
  assert.match(res.subject, /^\[TEST\] Invoice ready: TXR - AZ,/);
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
  assert.match(res.subject, /^Invoice ready: TXR - AZ,/);
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

test("N1 HTML carries preheader + pre-tax total + CTA to Service Calendar", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl },
  });
  assert.match(res.preheader, /\$19,238\.95/);
  assert.match(res.html, /Pre-tax total/);
  assert.match(res.html, /\$19,238\.95/);
  assert.match(res.html, /Open the week in the Service Calendar/);
  assert.match(res.html, /Ready for review|READY FOR REVIEW/);
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
  await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [
      { invoiceSlot: "milb", qboLink: "https://qbo.example/inv/1", pretaxTotalCents: 10000, lineCount: 5, isTest: true },
      { invoiceSlot: "mlb",  qboLink: "https://qbo.example/inv/2", pretaxTotalCents: 20000, lineCount: 8, isTest: true },
      { invoiceSlot: "ssm",  qboLink: "https://qbo.example/inv/3", pretaxTotalCents: 5000,  lineCount: 3, isTest: true },
    ],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  const posted = slack.calls[0].text;
  assert.ok(posted.includes("milb: https://qbo.example/inv/1"), "milb link enumerated");
  assert.ok(posted.includes("mlb: https://qbo.example/inv/2"),  "mlb link enumerated");
  assert.ok(posted.includes("ssm: https://qbo.example/inv/3"),  "ssm link enumerated");
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
  assert.match(n1.subject, /^TEST - Invoice draft ready:/);
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
