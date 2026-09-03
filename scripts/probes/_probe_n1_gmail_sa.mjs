// ═══════════════════════════════════════════════════════════════════
// _probe_n1_gmail_sa.mjs
// 2026-09-03 (Ruling 2)
// ═══════════════════════════════════════════════════════════════════
//
// Isolated probe of the fireN1 -> sendEmailSA path. Reproduces the
// "N1 did not fire on successful test finalize" failure without
// running a real finalize.
//
// What it does:
//   1. Presence-checks the three env vars fireN1 depends on
//      (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY,
//      SLACK_SC_BILLING_WEBHOOK_URL). Prints PRESENT/ABSENT only,
//      never values (per USE-not-SEE env rule).
//   2. Calls sendEmailSA directly with a minimal test message to
//      Kevin. This isolates the Gmail SA impersonation layer.
//   3. Calls fireN1 end-to-end with a fake invoice record. This
//      exercises the sc-40 salaried/rdo lookup path + Slack post
//      + the new missing-env named error.
//   4. Prints the discriminated return object for each so Kevin
//      can see exactly which channel(s) worked and which didn't.
//
// Run with:
//   cd /Users/kevinfietek/dev/kf-sc-39
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_n1_gmail_sa.mjs
//
// Exit codes:
//   0 - both email and Slack delivered
//   1 - one or both failed (see stdout for details)
//   2 - env missing (never called Gmail / Slack)
// ═══════════════════════════════════════════════════════════════════

import { sendEmailSA } from "@/lib/gmail";
import { fireN1 } from "@/lib/billing/qboNotifications.js";
import { KEVIN_EMAIL } from "@/lib/billing/recipients.js";

const banner = (s) => console.log(`\n─── ${s} ───`);

// ─── Step 1: presence check ──────────────────────────────────────
banner("env presence");
const gsaEmail   = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const gsaKey     = !!process.env.GOOGLE_PRIVATE_KEY;
const slackHook  = !!process.env.SLACK_SC_BILLING_WEBHOOK_URL;
console.log(`GOOGLE_SERVICE_ACCOUNT_EMAIL:   ${gsaEmail ? "PRESENT" : "ABSENT"}`);
console.log(`GOOGLE_PRIVATE_KEY:             ${gsaKey ? "PRESENT" : "ABSENT"}`);
console.log(`SLACK_SC_BILLING_WEBHOOK_URL:   ${slackHook ? "PRESENT" : "ABSENT"}`);

if (!gsaEmail || !gsaKey) {
  console.log("\nHALT: Gmail SA env keys missing. sendEmailSA would fail silently, fireN1 would surface as 'missing_env:...'.");
  process.exit(2);
}

// ─── Step 2: isolated sendEmailSA ───────────────────────────────
// Sender must match the current EMAIL_SENDER in qboNotifications.js /
// chaseNotifications.js / people/route.js. Rotated 2026-09-03 from
// support@ (deactivated) to kitchfix.admin@. If you rotate again,
// update this string too.
banner("sendEmailSA isolated call");
const timestamp = new Date().toISOString();
const emailRes = await sendEmailSA({
  sender: "kitchfix.admin@kitchfix.com",
  displayName: "KitchFix Ops Hub",
  to: [KEVIN_EMAIL],
  subject: `[PROBE ${timestamp}] N1 gmail_sa isolated probe`,
  html: `<p>Probe timestamp: <code>${timestamp}</code></p>
         <p>If you're reading this, sendEmailSA works from this worktree's .env.local
         with sender kitchfix.admin@kitchfix.com. That mailbox is on the SA's DWD allowlist.</p>
         <p>If this ever regresses to <code>[Gmail SA] Send failed: invalid_grant</code>,
         first suspect a deactivated impersonation target - see
         docs/GOTCHAS.md "invalid_grant from a deactivated impersonation target".</p>`,
});
console.log(`sendEmailSA return value: ${JSON.stringify(emailRes)}`);
console.log(emailRes === "sent"
  ? "  -> Gmail SA path is functional. If N1 also fails from probe below, the bug is above the SA layer."
  : "  -> Gmail SA path is broken. Check stderr above for the swallowed error message.");

// ─── Step 3: full fireN1 ────────────────────────────────────────
banner("fireN1 end-to-end call");
const fakeInvoices = [
  { invoiceSlot: "milb", qboInvoiceId: "PROBE-1", qboDocNumber: null,
    pretaxTotalCents: 12345, lineCount: 3, isTest: true,
    qboLink: "https://qbo.example/probe/1", ledgerRowId: "probe-led-1" },
];
const n1Res = await fireN1({
  qboMode: "test",  // structural override -> Kevin only, no site leader ever contacted
  accountKey: "TXR - AZ",
  weekStart: "2026-07-27",
  weekEnd: "2026-08-02",
  submitterEmail: "k.fietek@kitchfix.com",
  invoiceRecords: fakeInvoices,
  scWeekLink: "https://intranet.example/service-calendar/season?a=TXR",
  accountMap: { salariedManagerEmails: [], rdoEmail: null },
});

console.log(`recipients.to:   ${JSON.stringify(n1Res.recipients.to)}`);
console.log(`subject:         ${n1Res.subject}`);
console.log(`email.result:    ${n1Res.email.result}`);
console.log(`slack.result:    ${JSON.stringify(n1Res.slack.result)}`);

const emailOk = n1Res.email.result === "sent";
const slackOk = n1Res.slack.result.sent === true;

banner("verdict");
if (emailOk && slackOk) {
  console.log("BOTH channels delivered. The 2026-09-03 miss was either a since-fixed transient or upstream of fireN1 (never called).");
  process.exit(0);
} else if (emailOk) {
  console.log("EMAIL delivered, SLACK did not. Kevin should have received the isolated probe email above.");
  console.log(`Slack failure detail: ${JSON.stringify(n1Res.slack.result)}`);
  process.exit(1);
} else if (slackOk) {
  console.log("SLACK delivered, EMAIL did not. This is the exact 2026-09-03 shape - Kevin got no signal because N1 had no Slack path.");
  console.log(`Email failure detail: email.result=${n1Res.email.result}`);
  process.exit(1);
} else {
  console.log("NEITHER channel delivered.");
  console.log(`  email.result: ${n1Res.email.result}`);
  console.log(`  slack.result: ${JSON.stringify(n1Res.slack.result)}`);
  process.exit(1);
}
