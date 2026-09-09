// bgReportEmail.test.mjs
//
// Covers the two flag states (empty vs non-empty month) + Kevin's
// wording ruling on the empty-case lede. Would catch a regression
// where the copy silently drifts back to a version that doesn't
// name the cron-liveness reason.

import test from "node:test";
import assert from "node:assert/strict";
import { renderBgReportEmail } from "./bgReportEmail.js";

const NON_EMPTY = {
  monthLabel: "August 2026",
  daysServed: 3,
  meals: 375,
  revenueCents: 253125,
  isEmpty: false,
};

const EMPTY = {
  monthLabel: "September 2026",
  daysServed: 0,
  meals: 0,
  revenueCents: 0,
  isEmpty: true,
};

const RECON_SPAN = "August 2026 spans SC period P7 (X days) and SC period P8 (Y days).";
const RECON_SOLO = "September 2026 falls entirely inside SC period P9.";

// ─── Non-empty month: "Ready to bill" green flag ───────────────

test("non-empty: subject names account + month + meal count", () => {
  const { subject } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.equal(subject, "B&G report: TBR - FL, August 2026 - 375 meals");
});

test("non-empty: 'Ready to bill' flag with green tokens present", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.match(html, /Ready to bill/);
  assert.match(html, /#E8F5EC/, "green flag bg present");
  assert.match(html, /#2F7D4F/, "green flag fg present");
});

test("non-empty: fact table has month + days + meals + revenue", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.match(html, />Month</);
  assert.match(html, /August 2026/);
  assert.match(html, />Days served</);
  assert.match(html, /375/);
  assert.match(html, /Revenue/);
  assert.match(html, /\$2,531\.25/);
});

test("non-empty: reconciliation line appears in the amber recon block", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.match(html, /Reconciliation:/);
  assert.match(html, /spans SC period P7/);
  assert.match(html, /#FDF3E6/, "recon block amber bg present");
});

// ─── Empty month: "No B&G service this month" grey flag ────────

test("empty: subject names '(no service)' rather than a meal count", () => {
  const { subject } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: EMPTY,
    reconciliationLine: RECON_SOLO,
  });
  assert.equal(subject, "B&G report: TBR - FL, September 2026 (no service)");
});

test("empty: grey flag 'No B&G service this month' present", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: EMPTY,
    reconciliationLine: RECON_SOLO,
  });
  assert.match(html, /No B&amp;G service this month/);
  assert.match(html, /#F1F5F9/, "grey flag bg present");
});

test("empty: lede matches Kevin's exact plainer wording (2026-09-09 ruling)", () => {
  // Kevin ruled: "No Boys & Girls Club service was recorded in
  // {Month}. This report sends every month whether or not there
  // was service, so a quiet month and a broken report never look
  // the same." The wording is deliberate - names the cron-liveness
  // reason without opaque phrasing.
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: EMPTY,
    reconciliationLine: RECON_SOLO,
  });
  assert.match(
    html,
    /No Boys &amp; Girls Club service was recorded in September 2026\. This report sends every month whether or not there was service, so a quiet month and a broken report never look the same\./,
  );
});

test("empty: preheader carries the same 'quiet month vs broken cron' framing", () => {
  const { preheader } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: EMPTY,
    reconciliationLine: RECON_SOLO,
  });
  assert.match(preheader, /No Boys & Girls Club service was recorded for September 2026/);
  assert.match(preheader, /Report sent monthly so a quiet month and a broken cron never look the same/);
});

test("empty: fact-table still emits with zero values (factually correct)", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: EMPTY,
    reconciliationLine: RECON_SOLO,
  });
  // Days served = 0, Meals = 0, Revenue = $0.00 - all present.
  assert.match(html, />Days served<[\s\S]{0,200}>0</);
  assert.match(html, />Meals<[\s\S]{0,200}>0</);
  assert.match(html, /\$0\.00/);
});

// ─── Copy that should never appear ─────────────────────────────

test("no test-mode markers leak into the body", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.ok(!/\[TEST\]/.test(html));
  assert.ok(!/TEST_MEMO/.test(html));
});

test("footer names the recipient-list location (sc_qbo_account_map.bg_report_recipients)", () => {
  const { html } = renderBgReportEmail({
    accountKey: "TBR - FL",
    factTable: NON_EMPTY,
    reconciliationLine: RECON_SPAN,
  });
  assert.match(html, /sc_qbo_account_map\.bg_report_recipients/);
});
