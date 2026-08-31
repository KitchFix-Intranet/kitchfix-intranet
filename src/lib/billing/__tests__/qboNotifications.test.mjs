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
  assert.equal(res.emailResult, "sent");
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
  assert.equal(res.emailResult, "not_sent");
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

// ═════════════════════════════════════════════════════════════════
// PR-F1 (2026-08-14): N1 Slack + display names + row shape polish
// ═════════════════════════════════════════════════════════════════

// Contacts fake: returns Kevin Fietek for k.fietek, empty for others.
function makeSupaContactsFake(rows = []) {
  return {
    from() {
      return {
        select() { return this; },
        in(_col, arr) {
          const set = new Set(arr.map((e) => String(e).toLowerCase()));
          return Promise.resolve({
            data: rows.filter((r) => set.has(String(r.email).toLowerCase())),
            error: null,
          });
        },
      };
    },
  };
}

test("PR-F1: fireN1 test mode fires Slack with [TEST] prefix + TEST_SLACK_FOOTER", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalDays: 7, totalMeals: 1555,
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  assert.equal(slack.calls.length, 1, "N1 dispatches one Slack post");
  const posted = slack.calls[0].text;
  assert.ok(posted.startsWith("[TEST] "), "test-mode N1 Slack opens with [TEST]");
  assert.ok(posted.includes(TEST_SLACK_FOOTER), "test-mode N1 Slack carries TEST_SLACK_FOOTER");
  assert.match(posted, /Invoice draft ready/);
  assert.match(posted, /Pre-tax total: \*\$19,238\.95\*/);
  assert.match(posted, /Days served: 6 of 7/);
  assert.match(posted, /Meals and snacks: 1,555/);
  assert.match(posted, /draft is in QuickBooks for AP review/);
  assert.equal(res.slack.result.sent, true);
});

test("PR-F1: fireN1 live mode Slack has NO [TEST] markers", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  const posted = slack.calls[0].text;
  assert.ok(!posted.startsWith("[TEST] "));
  assert.ok(!posted.includes(TEST_SLACK_FOOTER));
});

test("PR-F1: N1 email restores Days served + Meals rows; drops Finalized-by row; Pre-tax total emphasized", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalDays: 7, totalMeals: 1555,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  assert.match(res.html, /Days served/);
  assert.match(res.html, /Meals and snacks/);
  assert.match(res.html, /Pre-tax total/);
  assert.match(res.html, /\$19,238\.95/);
  // Emphasized total row: 20px font size + own visual band.
  assert.match(res.html, /font-size:20px[^"]*font-weight:800/);
  // Finalized-by row DROPPED from the table (lead + footer carry it).
  const rowsBlock = res.html.split("Sales tax is calculated")[0];
  assert.ok(!/Finalized by[^<]*<\/td>\s*<td[^>]*text-align:right/.test(rowsBlock),
    "'Finalized by' row should not appear in the summary table");
});

test("PR-F1: N1 Invoices row appears only when invoiceCount > 1", async () => {
  const email = makeFakeSender();
  const single = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  // Single invoice: no "Invoices" row in the summary table.
  const tableBlock = single.html.split("Open the week")[0];
  assert.ok(!/>Invoices</.test(tableBlock),
    "single-invoice N1 has no 'Invoices' row");

  // Two invoices (CIN-AZ main + rehab): row appears.
  const cin = await fireN1({
    ...N1_ARGS_BASE,
    accountKey: "CIN - AZ",
    qboMode: "live",
    invoiceRecords: [
      { ...N1_ARGS_BASE.invoiceRecords[0], invoiceSlot: "main",  pretaxTotalCents: 3500000 },
      { ...N1_ARGS_BASE.invoiceRecords[0], invoiceSlot: "rehab", pretaxTotalCents:  500000, qboInvoiceId: "INV-2" },
    ],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 14, totalDays: 14, totalMeals: 3200,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  const cinTable = cin.html.split("Open the week")[0];
  assert.ok(/>Invoices</.test(cinTable), "CIN-AZ two-invoice N1 shows 'Invoices' row");
  assert.match(cinTable, /2 \(main \+ rehab\)/);
});

test("PR-F1: N1 lead + footer use display name, not raw email; no email address in visible body", async () => {
  const email = makeFakeSender();
  const supa = makeSupaContactsFake([
    { name: "Kevin Fietek", email: "k.fietek@kitchfix.com" },
  ]);
  const res = await fireN1({
    ...N1_ARGS_BASE,
    submitterEmail: "k.fietek@kitchfix.com",
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, slackWebhookUrl: null, supa },
  });
  assert.equal(res.submitterName, "Kevin Fietek");
  assert.match(res.html, /<b>Kevin Fietek<\/b> finalized the week/);
  assert.match(res.html, /Finalized by Kevin Fietek/);
  // Gmail auto-link prevention: no raw email string in visible body.
  const visible = res.html.replace(/href="[^"]*"/g, "");
  assert.ok(!visible.includes("k.fietek@kitchfix.com"),
    "no raw email address in the visible body (Gmail would auto-link)");
});

test("PR-F1: N1 display name falls back to local-part titlecase when contacts miss", async () => {
  const email = makeFakeSender();
  const supa = makeSupaContactsFake([]); // no rows
  const res = await fireN1({
    ...N1_ARGS_BASE,
    submitterEmail: "l.ochoa@kitchfix.com",
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, slackWebhookUrl: null, supa },
  });
  assert.equal(res.submitterName, "L Ochoa");
  assert.match(res.html, /<b>L Ochoa<\/b> finalized the week/);
});

test("PR-F1: N1 email carries per-item summary table when rawLines present", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    invoiceRecords: [{
      ...N1_ARGS_BASE.invoiceRecords[0],
      rawLines: [
        { DetailType: "SalesItemLineDetail", Amount: 2858,
          SalesItemLineDetail: { ServiceDate: "2026-07-27", ItemRef: { value: "3333", name: "TXR-AZ MiLB - Breakfast/Lunch/Dinner" }, Qty: 200 } },
        { DetailType: "SalesItemLineDetail", Amount: 2858,
          SalesItemLineDetail: { ServiceDate: "2026-07-28", ItemRef: { value: "3333", name: "TXR-AZ MiLB - Breakfast/Lunch/Dinner" }, Qty: 200 } },
        { DetailType: "SalesItemLineDetail", Amount:  471.2,
          SalesItemLineDetail: { ServiceDate: "2026-07-27", ItemRef: { value: "3338", name: "TXR-AZ - Regular Snack" }, Qty: 80 } },
      ],
    }],
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 2, totalMeals: 480,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  assert.match(res.html, /TXR-AZ MiLB - Breakfast\/Lunch\/Dinner/);
  assert.match(res.html, /TXR-AZ - Regular Snack/);
  // MiLB item: 2 days, qty 400, amount $5,716.00
  assert.match(res.html, /400/);
  assert.match(res.html, /\$5,716\.00/);
});

test("PR-F1: preheader is a single line with pre-tax total + counts", async () => {
  const email = makeFakeSender();
  const res = await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "live",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, slackWebhookUrl: null },
  });
  assert.match(res.preheader, /6 of 7/);
  assert.match(res.preheader, /1,555 meals/);
  assert.match(res.preheader, /\$19,238\.95 pre-tax/);
  assert.match(res.preheader, /Ready for AP review\.$/);
});

test("PR-F1: fireN1 test mode still routes email to Kevin only (unchanged by Slack addition)", async () => {
  const email = makeFakeSender();
  const slack = makeFakeSlack();
  await fireN1({
    ...N1_ARGS_BASE,
    qboMode: "test",
    invoiceRecords: [{ ...N1_ARGS_BASE.invoiceRecords[0], isTest: true }],
    accountMap: {
      salariedManagerEmails: ["a@x.com", "b@x.com", "c@x.com"],
      rdoEmail: "s.lynch@kitchfix.com",
    },
    submitterEmail: "leader@kitchfix.com",
    daysServed: 6, totalMeals: 1555,
    deps: { emailSender: email.impl, sendSlack: slack.impl, slackWebhookUrl: "https://hooks/x" },
  });
  assert.equal(email.calls.length, 1);
  assert.deepEqual(email.calls[0].to, [KEVIN_EMAIL], "email fence held: Kevin only");
});
