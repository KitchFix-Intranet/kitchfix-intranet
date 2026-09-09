// ═══════════════════════════════════════════════════════════════════
// chaseNotifications - N3.reminder + N3.urgent chase ladder senders.
// Rebuilt 2026-09-09 to the approved render.
// ═══════════════════════════════════════════════════════════════════
//
// Design authority: docs/design/KF_CHASE_EMAILS_RENDER.html.
// Brief: CC_PROMPT_CHASE_REBUILD.md (Kevin, 2026-09-09).
//
// Two stages replace the prior three-stage ladder:
//   N3.reminder - Sunday 18:00 account-local. Quiet register.
//                 Salaried list only. Both email + Slack.
//   N3.urgent   - Monday 15:00 account-local. Escalated register.
//                 Salaried + Sebastian + Kevin + RDO (all TO).
//                 Both email + Slack.
//
// The prior three stages (N3.1 Friday reminder, N3.2 Monday urgent,
// N3.3 Tuesday past-due) are retired. Kevin dropped the Friday
// nudge entirely; the Tuesday past-due named a fictional cron
// deadline ("billing runs tomorrow morning") that never existed.
// New copy names the real consequence: Sebastian cannot invoice
// until the week is complete, so the client is billed late.
//
// ─── Test-mode structural override ────────────────────────────────
//
// Recipient resolution flows through resolveRecipients (recipients.js)
// which returns Kevin only in test mode, structurally. This module
// never composes recipients any other way. Every send is prefixed
// [TEST] in test mode.
//
// ─── Empty salaried_manager_emails semantics ──────────────────────
//
// Addendum §A6 rule: "an empty recipient list is not an error and
// not a silent skip." For Sunday reminder (salaried-only), an empty
// salaried list produces to=[]; the sender surfaces this as a
// noSiteRecipient warning and skips the email. Slack still fires
// so Kevin's monitoring surface reports the gap. For Monday urgent
// (salaried + Sebastian + Kevin + RDO), an empty salaried list is
// benign - the escalation recipients are always present.
//
// ─── Person-name derivation for Slack "Chased X" line ─────────────
//
// The Slack line names ONE person - "Reminder sent to Joe Coppolino"
// or "Chased Joe Coppolino". The resolver derives this scalar from
// the same submitter-chain the earlier report described, kept ONLY
// for the Slack line (recipient TO fields use the salaried list per
// Kevin's ruling). Chain: most recent operator-email in
// sc_daily_actuals for the target week -> site leader of record ->
// first salaried manager. Falls back to "the site's team" if none
// resolve, which cannot happen given every SC account has at least
// one salaried manager.
//
// ─── Shared helpers ───────────────────────────────────────────────
//
// emailShell / escapeHtml / sendSlack / fmtWeekRange live in
// qboNotifications._internals - the intentional escape hatch for
// sibling billing modules. Consuming via that surface keeps the
// PR-F code untouched. Subject line uses fmtCompactWeek defined
// below (matches the render's compact date form).

import { resolveRecipients, NOTIFICATION_TYPES } from "./recipients.js";
import { sendEmailSA } from "../gmail.js";
import { _internals as qboInternals, TEST_SLACK_FOOTER } from "./qboNotifications.js";

const { emailShell, escapeHtml, sendSlack, fmtWeekRange } = qboInternals;

// Sender identity matches qboNotifications. Switched 2026-09-03
// from support@ to kitchfix.admin@ after support@kitchfix.com was
// identified as deactivated.
const EMAIL_SENDER       = "kitchfix.admin@kitchfix.com";
const EMAIL_DISPLAY_NAME = "KitchFix Ops Hub";

// ─── Copy helpers ─────────────────────────────────────────────────

// Panel-row skeleton reused by both stages.
function panelRow(k, v, borderColor = "#E2E8F0", valueClass = "") {
  const valueStyle = valueClass === "amber"
    ? "color:#8A5A16"
    : valueClass === "red"
      ? "color:#B3261E"
      : "color:#0F172A";
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid ${borderColor};font-size:13px;color:#64748B">${escapeHtml(k)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid ${borderColor};font-size:13px;${valueStyle};text-align:right;font-weight:600">${v}</td>
  </tr>`;
}

// No-site-recipient note. Emitted at the top of the body when
// live-mode salaried_manager_emails is empty. Reminder-only concern
// (Sunday sends to salaried only); Urgent has escalation fallbacks.
function noSiteRecipientNote(accountKey) {
  return `<tr><td style="padding:0 0 12px 0;font-size:12px;color:#8A5A16;background:#FDF6EC;border-left:3px solid #D9892F;padding:10px 12px;border-radius:4px">
    <b>No site recipient is configured for ${escapeHtml(accountKey)}.</b>
    Populate <code>sc_qbo_account_map.salaried_manager_emails</code> in Studio
    so the chase reaches the site next week.
  </td></tr>`;
}

// ─── Reminder body (Sunday 18:00 - amber "Needs entry" flag) ──────
//
// Structure per render:
//   navy KitchFix Ops Hub header
//   amber "Needs entry" flag
//   H1: "Last week isn't entered yet"
//   Lede: one sentence naming Sebastian + late-to-client consequence
//   Two-row fact table: Week + Missing (amber count)
//   One button: "Enter the week"
//   Footer: no-service reminder + escalation hint
function reminderBody({ accountKey, weekStart, weekEnd, missingDates, scWeekLink, isTest, noSiteRecipient }) {
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - reminder was routed to Kevin only; no site leader was contacted ***</td></tr>`
    : "";
  const missingCount = (missingDates || []).length;
  const missingLabel = `${missingCount} of 7 days`;
  const rows = [
    panelRow("Week",    escapeHtml(fmtWeekRange(weekStart, weekEnd))),
    panelRow("Missing", escapeHtml(missingLabel), "#E2E8F0", "amber"),
  ].join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  ${noSiteRecipient ? noSiteRecipientNote(accountKey) : ""}
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#8A5A16;background:#FDF3E6;border-bottom:1px solid #F0D9B5;padding:7px 20px;display:block">Needs entry</td></tr>
  <tr><td style="padding-top:12px;padding-left:20px;padding-right:20px;font-size:17px;line-height:1.35;font-weight:bold;color:#0F172A">Last week isn&#39;t entered yet</td></tr>
  <tr><td style="padding:8px 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    Sebastian can&#39;t invoice ${escapeHtml(accountKey)} until every day is entered or marked no-service. Until then the client is billed late.
  </td></tr>
  <tr><td style="padding:0 20px 15px 20px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 13px 20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:block;text-align:center;padding:11px;background:#1A3050;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700">Enter the week</a>
  </td></tr>
  <tr><td style="padding:12px 20px 0 20px;font-size:11px;line-height:1.55;color:#94A3B8;border-top:1px solid #F1F5F9">
    <b style="color:#64748B;font-weight:600">No service that day?</b> Open the day and use Mark day as no service &mdash; a blank day keeps the week open. If it&#39;s still open tomorrow it goes to Sebastian and your RDO.
  </td></tr>
  ${testLine}
</table>`;
}

// ─── Urgent body (Monday 15:00 - red "Past due" flag) ─────────────
//
// Structure per render:
//   navy KitchFix Ops Hub header
//   red "Past due" flag
//   H1: "Last week is still open"
//   Lede: same shape as Sunday, escalated wording
//   Two-row fact table: Week + Missing (red count)
//   One button: "Enter the week"
//   Footer: "Can't finish today?" reply-with-reason + no-service reminder
function urgentBody({ accountKey, weekStart, weekEnd, missingDates, scWeekLink, isTest, rdoFirstName, noSiteRecipient }) {
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - urgent chase was routed to Kevin only; no site leader was contacted ***</td></tr>`
    : "";
  const missingCount = (missingDates || []).length;
  const missingLabel = `${missingCount} of 7 days`;
  const rows = [
    panelRow("Week",    escapeHtml(fmtWeekRange(weekStart, weekEnd))),
    panelRow("Missing", escapeHtml(missingLabel), "#E2E8F0", "red"),
  ].join("");
  const rdoDisplay = rdoFirstName ? escapeHtml(rdoFirstName) : "your RDO";

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  ${noSiteRecipient ? noSiteRecipientNote(accountKey) : ""}
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#B3261E;background:#FCEEED;border-bottom:1px solid #F0C9C6;padding:7px 20px;display:block">Past due</td></tr>
  <tr><td style="padding-top:12px;padding-left:20px;padding-right:20px;font-size:17px;line-height:1.35;font-weight:bold;color:#0F172A">Last week is still open</td></tr>
  <tr><td style="padding:8px 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    Sebastian can&#39;t invoice ${escapeHtml(accountKey)} until it&#39;s complete. Every day it stays open is another day the client&#39;s invoice is late.
  </td></tr>
  <tr><td style="padding:0 20px 15px 20px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 13px 20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:block;text-align:center;padding:11px;background:#1A3050;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700">Enter the week</a>
  </td></tr>
  <tr><td style="padding:12px 20px 0 20px;font-size:11px;line-height:1.55;color:#94A3B8;border-top:1px solid #F1F5F9">
    <b style="color:#64748B;font-weight:600">Can&#39;t finish today?</b> Reply with the reason so Sebastian and ${rdoDisplay} know. If a day had no service, mark it no-service &mdash; a blank day keeps the week open.
  </td></tr>
  ${testLine}
</table>`;
}

// ─── Slack payloads ────────────────────────────────────────────────
//
// Both stages post to Slack (Kevin ruling 2026-09-09 - reversed the
// prior Monday-only decision). Channel is his monitoring surface;
// seeing the quiet nudge fire is useful.
//
// No @-mention. The site leaders are not in the channel, so a
// mention would fail silently or render as raw text. Name the
// person as plain text - "Reminder sent to Joe Coppolino" on
// Sunday, "Chased Joe Coppolino" on Monday.
//
// Three-difference scan pattern (quieter Sunday, louder Monday):
//   1. Warning icon: none / "⚠️"
//   2. Count verb: "not entered" / "open"
//   3. Person verb: "Reminder sent to" / "Chased"

function reminderSlackText({ accountKey, weekStart, weekEnd, missingDates, chasedPersonName, isTest }) {
  const range = fmtWeekRange(weekStart, weekEnd);
  const missingCount = (missingDates || []).length;
  const headPrefix = isTest ? "[TEST] " : "";
  const personLine = chasedPersonName
    ? `Reminder sent to ${chasedPersonName}.`
    : "No site recipient configured.";
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return `${headPrefix}*${accountKey}* - week of ${range}, *${missingCount} of 7 days* not entered. ${personLine}${foot}`;
}

function urgentSlackText({ accountKey, weekStart, weekEnd, missingDates, chasedPersonName, isTest }) {
  const range = fmtWeekRange(weekStart, weekEnd);
  const missingCount = (missingDates || []).length;
  const headPrefix = isTest ? "[TEST] " : "";
  const personLine = chasedPersonName
    ? `Chased ${chasedPersonName}.`
    : "No site recipient configured.";
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return `${headPrefix}:warning: *${accountKey}* - week of ${range}, *${missingCount} of 7 days* open. ${personLine}${foot}`;
}

// ─── Subject line composer ────────────────────────────────────────
//
// Compact date form for the subject: "Aug 25 - 31" when the week
// stays in one month, "Aug 30 - Sep 5" when it crosses. Matches
// the render's subject (design/KF_CHASE_EMAILS_RENDER.html). The
// email body uses the longer fmtWeekRange with weekdays; the
// subject uses this compact form so the inbox line reads clean.
function fmtCompactWeek(weekStart, weekEnd) {
  if (!weekStart) return "";
  const startDate = new Date(`${weekStart}T12:00:00Z`);
  const endDate   = weekEnd ? new Date(`${weekEnd}T12:00:00Z`) : startDate;
  const startMonth = startDate.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const startDay   = startDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const endMonth   = endDate.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const endDay     = endDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  if (!weekEnd) return `${startMonth} ${startDay}`;
  if (startMonth === endMonth) return `${startMonth} ${startDay} - ${endDay}`;
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

function subjectFor(stage, accountKey, weekStart, weekEnd, isTest) {
  const testPrefix = isTest ? "[TEST] " : "";
  const wk = fmtCompactWeek(weekStart, weekEnd);
  if (stage === NOTIFICATION_TYPES.N3_REMINDER) {
    return `${testPrefix}Reminder: ${accountKey} week of ${wk} needs entry`;
  }
  if (stage === NOTIFICATION_TYPES.N3_URGENT) {
    return `${testPrefix}Action needed today: ${accountKey} week of ${wk} past due`;
  }
  throw new Error(`chaseNotifications.subjectFor: unknown stage ${JSON.stringify(stage)}`);
}

// ─── fireN3: main entrypoint ──────────────────────────────────────

/**
 * Build and (optionally) send one chase stage.
 *
 * Empty-salaried edge case: when live-mode resolveRecipients returns
 * to=[] (Sunday reminder path with no salaried), we set noSiteRecipient
 * and skip the email send but still fire Slack so Kevin's monitoring
 * surface reports the gap. Kevin's ruling 2026-09-09: "if an account's
 * salaried list ever comes back empty, the chase would send to nobody
 * and report success. Log the count and the source so a silent
 * no-recipient case is visible."
 *
 * @param {Object} args
 * @param {"N3.reminder"|"N3.urgent"} args.stage
 * @param {"test"|"live"} args.qboMode
 * @param {string} args.accountKey
 * @param {string} args.weekStart     ISO Monday
 * @param {string} args.weekEnd       ISO Sunday
 * @param {number} args.complete      Days entered (or planned off-day marked)
 * @param {number} args.total         Total days in the week (7 for full weeks)
 * @param {string[]} args.missingDates ISO dates still needing entry
 * @param {string} args.scWeekLink    Deep link to the Service Calendar week
 * @param {Object} [args.accountMap]  { salariedManagerEmails, rdoEmail }
 * @param {string} [args.chasedPersonName] Display name for the Slack "Chased X" line
 * @param {string} [args.rdoFirstName]    Display first name for the urgent email body
 * @param {boolean} [args.send=true]  When false, returns render without dispatching
 * @param {Object} [args.deps]        { emailSender, sendSlack, slackWebhookUrl } for tests
 * @returns {Promise<{recipients, subject, preheader, html, email:{result}, slack:{text,result}, noSiteRecipient:boolean}>}
 */
export async function fireN3(args) {
  const {
    stage, qboMode, accountKey, weekStart, weekEnd,
    complete, total, missingDates, scWeekLink,
    accountMap, chasedPersonName, rdoFirstName,
    send = true, deps,
  } = args;

  const isTest = qboMode === "test";
  const stageKeys = [NOTIFICATION_TYPES.N3_REMINDER, NOTIFICATION_TYPES.N3_URGENT];
  if (!stageKeys.includes(stage)) {
    throw new Error(`fireN3: stage must be one of ${stageKeys.join("/")}, got ${JSON.stringify(stage)}`);
  }

  const recipients = resolveRecipients({
    notification: stage, accountKey, mode: qboMode, accountMap,
  });

  // Empty-recipient edge case. The urgent stage always has Sebastian
  // + Kevin + RDO on the TO line, so `to` is never empty there under
  // live mode. The reminder stage is salaried-only; empty salaried
  // means empty TO. Under the new shape we flag this + skip the email
  // (Slack still fires for observability).
  const noSiteRecipient = !isTest
    && stage === NOTIFICATION_TYPES.N3_REMINDER
    && recipients.to.length === 0;

  const sendTo = recipients.to;
  const sendCc = recipients.cc;

  const subject = subjectFor(stage, accountKey, weekStart, weekEnd, isTest);
  const preheaders = {
    [NOTIFICATION_TYPES.N3_REMINDER]: `${(missingDates || []).length} of 7 days not entered for ${accountKey}. Enter to close.`,
    [NOTIFICATION_TYPES.N3_URGENT]:   `${(missingDates || []).length} of 7 days open for ${accountKey}. Sebastian can't invoice until it's complete.`,
  };
  const preheader = preheaders[stage];

  const html = emailShell({
    preheader,
    body: stage === NOTIFICATION_TYPES.N3_REMINDER
      ? reminderBody({ accountKey, weekStart, weekEnd, missingDates, scWeekLink, isTest, noSiteRecipient })
      : urgentBody({ accountKey, weekStart, weekEnd, missingDates, scWeekLink, isTest, rdoFirstName, noSiteRecipient }),
  });

  const composeSlack = () => (stage === NOTIFICATION_TYPES.N3_REMINDER
    ? reminderSlackText({ accountKey, weekStart, weekEnd, missingDates, chasedPersonName, isTest })
    : urgentSlackText  ({ accountKey, weekStart, weekEnd, missingDates, chasedPersonName, isTest }));

  // Send.
  let emailResult = "not_sent";
  let slackOut = null;
  if (send) {
    // Email only fires when there is at least one TO address.
    // noSiteRecipient=true means we deliberately skip (Sunday +
    // empty salaried); log the reason on the result.
    if (sendTo.length > 0) {
      const sender = deps?.emailSender || sendEmailSA;
      emailResult = await sender({
        sender: EMAIL_SENDER,
        displayName: EMAIL_DISPLAY_NAME,
        to: sendTo,
        cc: sendCc,
        subject,
        html,
      });
    } else {
      emailResult = "skipped_no_recipients";
    }
    // Slack always posts (both stages, both modes). The channel is
    // Kevin's monitoring surface; a silent no-recipient case must
    // surface there even when email is skipped.
    const slackText = composeSlack();
    const webhookUrl = deps?.slackWebhookUrl || process.env.SLACK_SC_BILLING_WEBHOOK_URL;
    const slackResult = await (deps?.sendSlack || sendSlack)({ webhookUrl, text: slackText });
    slackOut = { text: slackText, result: slackResult };
  } else {
    slackOut = {
      text: composeSlack(),
      result: { sent: false, skipped: "send=false" },
    };
  }

  return {
    recipients: { to: sendTo, cc: sendCc, resolvedTo: recipients.to, resolvedCc: recipients.cc },
    subject, preheader, html,
    email: { result: emailResult },
    slack: slackOut,
    noSiteRecipient,
  };
}

// Test hooks so unit tests can reach the render helpers without a
// real SA send.
export const _internals = {
  reminderBody, urgentBody,
  reminderSlackText, urgentSlackText,
  subjectFor,
};
