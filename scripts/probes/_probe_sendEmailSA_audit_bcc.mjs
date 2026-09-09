#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_sendEmailSA_audit_bcc.mjs
// Verify the BCC audit trail added to sendEmailSA.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Sends two real test messages via the SA-impersonated Gmail path,
// then prints message IDs + timestamps so Kevin can confirm the BCC
// copy lands in kitchfix.admin@kitchfix.com.
//
// Test A: sender=kitchfix.admin@  to=k.fietek@  (production shape)
//   The important case. Every production notification sender is
//   kitchfix.admin@; if Gmail dedupes this into "Sent" only, no
//   audit copy lands and the whole feature is silently broken.
//
// Test B: sender=kitchfix.admin@  to=<unique test address>
//   Same-sender scenario without the same-recipient. Confirms the
//   Bcc reaches kitchfix.admin@ when the visible To is elsewhere.
//
// Kevin's post-run checklist:
//   1. Open kitchfix.admin@kitchfix.com Inbox.
//   2. Search for the unique subject IDs printed below.
//   3. Confirm one Inbox entry per test message.
//      - If both present: BCC audit trail works, PR is good to ship.
//      - If either missing: SWAP the audit address (do not workaround);
//        the fix is a different mailbox, e.g. k.fietek@ or a new
//        kitchfix.audit@.
//
// Also asks the recipient to check the To/Cc line of the DELIVERED
// message for a leaked Bcc header - a site leader seeing an admin
// address on their chase email is a small thing that reads as a
// mistake.
//
// Run with:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_sendEmailSA_audit_bcc.mjs

import { sendEmailSA, AUDIT_BCC_EMAIL } from "../../src/lib/gmail.js";

// Presence check per CLAUDE.md USE-vs-SEE rule.
const req = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) {
    console.error(`\nABORT: ${k} missing. Run with --env-file=.env.local`);
    process.exit(2);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runId = Math.random().toString(36).slice(2, 8);

const sender = "kitchfix.admin@kitchfix.com";
const displayName = "KitchFix Ops Hub";

async function run(label, to) {
  const subject = `[BCC AUDIT PROBE ${runId}/${label}] ${stamp}`;
  const html = `
    <p><b>BCC audit probe.</b></p>
    <p>Run id: <code>${runId}</code> - variant <code>${label}</code></p>
    <p>Sender: <code>${sender}</code></p>
    <p>Visible To: <code>${to}</code></p>
    <p>Expected Bcc: <code>${AUDIT_BCC_EMAIL}</code></p>
    <p>If you are reading this in <code>${to}</code>'s inbox: check the message
       headers (View Original / Show Original) - confirm there is NO Bcc line
       visible. If there is one, the audit address is leaking and needs a fix.</p>
    <p>If you are reading this in <code>${AUDIT_BCC_EMAIL}</code>'s inbox: the
       BCC audit trail is delivering. Report Y for this run.</p>
  `;
  console.log(`\n[${label}] sending "${subject}" -> ${to}`);
  const result = await sendEmailSA({
    sender,
    displayName,
    to,
    subject,
    html,
  });
  console.log(`[${label}] sendEmailSA returned: ${result}`);
  return { label, subject, to, result };
}

const results = [];
// One test message. sender=kitchfix.admin@ + to=k.fietek@ - matches
// the production shape where a chase / N1 goes to a site leader.
// The BCC in this shape is the same-domain, same-account case
// Kevin flagged: Gmail may dedupe it into "Sent" only.
results.push(await run("prod_shape", "k.fietek@kitchfix.com"));

console.log("\n═══ SUMMARY ═══");
console.log(`Run id: ${runId}`);
console.log(`Audit BCC target: ${AUDIT_BCC_EMAIL}`);
for (const r of results) {
  console.log(`  ${r.label}: ${r.result} - subject "${r.subject}"`);
}
console.log(`\nNext: check ${AUDIT_BCC_EMAIL} Inbox for both subjects.`);
