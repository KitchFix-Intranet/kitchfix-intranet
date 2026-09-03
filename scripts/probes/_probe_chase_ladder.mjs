// ═══════════════════════════════════════════════════════════════════
// _probe_chase_ladder.mjs
// 2026-09-03
// ═══════════════════════════════════════════════════════════════════
//
// Fires all three chase stages (N3.1, N3.2, N3.3) in test mode
// against Kevin's address and reports per-stage delivery. Mirrors
// _probe_n1_gmail_sa.mjs. Proves the sender rotation from support@
// to kitchfix.admin@ cured the chase-ladder email path that has
// silently failed since 2026-08-14 (PR-G merge).
//
// Kevin's design rule 2026-09-03: chase failure is HIGHER cost than
// N1 failure. N1 failing means an invoice exists and nobody was
// told. A chase failing means a site leader never knew they were
// late, Sebastian cannot bill, and the first signal is a missing
// invoice on Tuesday. Treat delivery confirmation on this path as
// more important than on N1, not less.
//
// Test mode means resolveRecipients.js:89 override returns Kevin
// only. No site leader receives anything from this probe.
//
// Run:
//   cd /Users/kevinfietek/dev/kf-sc-39
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_chase_ladder.mjs
//
// Exit codes:
//   0 - all three stages delivered email (and Slack where wired)
//   1 - any stage's email delivery failed
//   2 - env missing
// ═══════════════════════════════════════════════════════════════════

import { fireN3 } from "@/lib/billing/chaseNotifications.js";
import { NOTIFICATION_TYPES, KEVIN_EMAIL } from "@/lib/billing/recipients.js";

const banner = (s) => console.log(`\n─── ${s} ───`);

// Presence check env vars fireN3 depends on (via sendEmailSA +
// sendSlack). Same trio the N1 probe checks.
banner("env presence");
const gsaEmail   = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const gsaKey     = !!process.env.GOOGLE_PRIVATE_KEY;
const slackHook  = !!process.env.SLACK_SC_BILLING_WEBHOOK_URL;
console.log(`GOOGLE_SERVICE_ACCOUNT_EMAIL:   ${gsaEmail ? "PRESENT" : "ABSENT"}`);
console.log(`GOOGLE_PRIVATE_KEY:             ${gsaKey ? "PRESENT" : "ABSENT"}`);
console.log(`SLACK_SC_BILLING_WEBHOOK_URL:   ${slackHook ? "PRESENT" : "ABSENT"}`);
if (!gsaEmail || !gsaKey) {
  console.log("\nHALT: Gmail SA env keys missing.");
  process.exit(2);
}

// Common args every stage shares. weekStart 2026-08-31 (Monday),
// weekEnd 2026-09-06 (Sunday), 3 missing dates late in the week.
const commonArgs = {
  qboMode:    "test",
  accountKey: "TXR - AZ",
  weekStart:  "2026-08-31",
  weekEnd:    "2026-09-06",
  complete:   4,
  total:      7,
  missingDates: ["2026-09-04", "2026-09-05", "2026-09-06"],
  scWeekLink: "https://intranet.example/service-calendar/season?a=TXR",
  accountMap: { salariedManagerEmails: [], rdoEmail: null },
  siteLeadNames: [],
};

const stages = [
  { key: NOTIFICATION_TYPES.N3_1, label: "N3.1 (Fri noon reminder)" },
  { key: NOTIFICATION_TYPES.N3_2, label: "N3.2 (Mon noon urgent)" },
  { key: NOTIFICATION_TYPES.N3_3, label: "N3.3 (Tue AM past-due + RDO cc)" },
];

const results = [];

for (const stage of stages) {
  banner(stage.label);
  const res = await fireN3({ ...commonArgs, stage: stage.key });

  const emailOk = res.email?.result === "sent";
  const slackWired = res.slack !== null && res.slack !== undefined;
  const slackOk = slackWired && res.slack.result?.sent === true;

  console.log(`recipients.to:   ${JSON.stringify(res.recipients?.to)}`);
  console.log(`subject:         ${res.subject}`);
  console.log(`email.result:    ${res.email?.result}`);
  console.log(`slack:           ${slackWired ? JSON.stringify(res.slack.result) : "(not wired for this stage)"}`);

  results.push({ label: stage.label, emailOk, slackWired, slackOk });
}

// ─── Summary + verdict ────────────────────────────────────────────
banner("summary");
for (const r of results) {
  const email = r.emailOk ? "email OK" : "email FAIL";
  const slack = r.slackWired
    ? (r.slackOk ? "slack OK" : "slack FAIL")
    : "slack N/A";
  console.log(`  ${r.label.padEnd(40)}  ${email.padEnd(11)}  ${slack}`);
}

const allEmailsOk = results.every((r) => r.emailOk);
const allSlackWired = results.every((r) => r.slackWired);
const allSlackOk = results.filter((r) => r.slackWired).every((r) => r.slackOk);

banner("verdict");
if (allEmailsOk && allSlackWired && allSlackOk) {
  console.log("All three chase stages delivered email AND Slack. Redundancy is in place across the ladder.");
  process.exit(0);
} else if (allEmailsOk && !allSlackWired) {
  const missing = results.filter((r) => !r.slackWired).map((r) => r.label).join(", ");
  console.log(`All three chase stages delivered EMAIL. Slack is NOT wired for: ${missing}.`);
  console.log("This is a redundancy gap - the very failure class that hid the sender-deactivation bug for weeks.");
  console.log("Follow-up: extend Slack to the un-wired stages.");
  process.exit(0);  // email delivery works; missing Slack is a design gap, not a delivery failure
} else if (!allEmailsOk) {
  const failed = results.filter((r) => !r.emailOk).map((r) => r.label).join(", ");
  console.log(`EMAIL DELIVERY FAILED for: ${failed}. Chase ladder is still broken.`);
  process.exit(1);
} else {
  console.log("Mixed state. Read summary above.");
  process.exit(1);
}
