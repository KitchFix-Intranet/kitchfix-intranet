#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_chase_renders.mjs
// Mount-verify for the two-stage chase rebuild.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// What this proves without hitting the production cron:
//   1. Both N3.reminder + N3.urgent render HTML that expands every
//      variable (accountKey, week range, missing count, chased person,
//      RDO first name).
//   2. Slack composers emit the correct verb per stage (Reminder sent
//      / Chased) and the correct icon (none / warning).
//   3. resolveRecipients returns Kevin only under test mode.
//   4. Live-mode Sunday reminder with empty salaried returns to=[]
//      AND the body carries the noSiteRecipient warning (Kevin ruling
//      2026-09-09 - silent no-recipient case must be visible).
//   5. Live-mode urgent with null rdo drops it cleanly.
//   6. Retired stage vocab (N3.1/N3.2/N3.3) is rejected by fireN3
//      (positive-throw check).
//
// Writes 4 HTML files + 1 summary to ~/Downloads/ so Kevin can
// eyeball the render.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fireN3, _internals } from "../../src/lib/billing/chaseNotifications.js";
import { NOTIFICATION_TYPES } from "../../src/lib/billing/recipients.js";

const OUT_DIR = path.join(os.homedir(), "Downloads", `chase_renders_${new Date().toISOString().slice(0,10)}`);
await fs.mkdir(OUT_DIR, { recursive: true });

const summary = [];

async function run(label, args) {
  const res = await fireN3({ ...args, send: false });
  const file = path.join(OUT_DIR, `${label}.html`);
  await fs.writeFile(file, res.html);
  summary.push({
    label,
    subject: res.subject,
    to: res.recipients.to,
    cc: res.recipients.cc,
    noSiteRecipient: res.noSiteRecipient,
    slack: res.slack?.text,
    htmlBytes: res.html.length,
  });
}

const commonArgs = {
  accountKey: "TBR - FL",
  weekStart: "2026-08-25",
  weekEnd:   "2026-08-31",
  complete:  4,
  total:     7,
  missingDates: ["2026-08-28","2026-08-30","2026-08-31"],
  scWeekLink: "http://localhost:3000/service-calendar?account=TBR%20-%20FL&month=2026-08&day=2026-08-25",
};

// Case 1: TEST mode reminder - Kevin only.
await run("01_reminder_test", {
  stage: NOTIFICATION_TYPES.N3_REMINDER,
  qboMode: "test",
  ...commonArgs,
  accountMap: {
    salariedManagerEmails: ["joe.coppolino@example.com","desiree@example.com","steve@example.com"],
    rdoEmail: "s.lynch@kitchfix.com",
  },
  chasedPersonName: "Joe Coppolino",
  rdoFirstName: null,
});

// Case 2: LIVE mode reminder - salaried only.
await run("02_reminder_live", {
  stage: NOTIFICATION_TYPES.N3_REMINDER,
  qboMode: "live",
  ...commonArgs,
  accountMap: {
    salariedManagerEmails: ["joe.coppolino@example.com","desiree@example.com","steve@example.com"],
    rdoEmail: "s.lynch@kitchfix.com",
  },
  chasedPersonName: "Joe Coppolino",
  rdoFirstName: null,
});

// Case 3: LIVE mode reminder with EMPTY salaried - noSiteRecipient branch.
await run("03_reminder_live_empty_salaried", {
  stage: NOTIFICATION_TYPES.N3_REMINDER,
  qboMode: "live",
  ...commonArgs,
  accountMap: { salariedManagerEmails: [], rdoEmail: "s.lynch@kitchfix.com" },
  chasedPersonName: null,
  rdoFirstName: null,
});

// Case 4: TEST mode urgent - Kevin only, rdo first-name expansion.
await run("04_urgent_test", {
  stage: NOTIFICATION_TYPES.N3_URGENT,
  qboMode: "test",
  ...commonArgs,
  accountMap: {
    salariedManagerEmails: ["joe.coppolino@example.com","desiree@example.com","steve@example.com"],
    rdoEmail: "s.lynch@kitchfix.com",
  },
  chasedPersonName: "Joe Coppolino",
  rdoFirstName: "Shane",
});

// Case 5: LIVE mode urgent - full stack (salaried + Sebastian + Kevin + RDO).
await run("05_urgent_live", {
  stage: NOTIFICATION_TYPES.N3_URGENT,
  qboMode: "live",
  ...commonArgs,
  accountMap: {
    salariedManagerEmails: ["joe.coppolino@example.com","desiree@example.com","steve@example.com"],
    rdoEmail: "s.lynch@kitchfix.com",
  },
  chasedPersonName: "Joe Coppolino",
  rdoFirstName: "Shane",
});

// Case 6: LIVE mode urgent with NULL rdo - dedup drops the null.
await run("06_urgent_live_null_rdo", {
  stage: NOTIFICATION_TYPES.N3_URGENT,
  qboMode: "live",
  ...commonArgs,
  accountMap: {
    salariedManagerEmails: ["joe.coppolino@example.com","desiree@example.com","steve@example.com"],
    rdoEmail: null,
  },
  chasedPersonName: "Joe Coppolino",
  rdoFirstName: null,
});

// Positive throw check: retired stage vocab must be rejected.
let threwOnOldStage = false;
try {
  await fireN3({
    stage: "N3.1",
    qboMode: "test",
    ...commonArgs,
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
    send: false,
  });
} catch (e) {
  threwOnOldStage = /stage must be one of/.test(e.message);
}

// Write the summary.
const summaryFile = path.join(OUT_DIR, "SUMMARY.json");
await fs.writeFile(summaryFile, JSON.stringify({
  when: new Date().toISOString(),
  cases: summary,
  retiredStageRejected: threwOnOldStage,
  internalsExports: Object.keys(_internals),
}, null, 2));

console.log(`\nWrote ${summary.length} render files + SUMMARY.json to ${OUT_DIR}\n`);
for (const c of summary) {
  console.log(`- ${c.label}: to=[${c.to.join(",") || "EMPTY"}] noSite=${c.noSiteRecipient} bytes=${c.htmlBytes}`);
  console.log(`  subject: ${c.subject}`);
  console.log(`  slack:   ${c.slack}`);
}
console.log(`\nRetired stage (N3.1) rejected by fireN3: ${threwOnOldStage}`);
