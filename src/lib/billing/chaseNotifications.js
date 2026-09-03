// ═══════════════════════════════════════════════════════════════════
// chaseNotifications - N3.1 / N3.2 / N3.3 chase ladder senders.
// PR-G of the SC -> QBO billing arc (2026-08-14).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5 (test/live),
// §A6 (matrix + RDO cc on N3.3), §A6b (Slack channel), §A7 (copy).
// Copy + hierarchy come from docs/design/KF_NOTIFICATION_RENDERS.html
// (lines 325-464). Production email is table-based inline-styled markup;
// the render's CSS does NOT carry over.
//
// ─── Test-mode structural override ────────────────────────────────
//
// Recipient resolution flows through resolveRecipients (recipients.js)
// which returns Kevin only in test mode, structurally. This module
// never composes recipients any other way. Every send is prefixed
// [TEST] in test mode.
//
// Slack fires ONLY on N3.3 (addendum §A6). In test mode the Slack
// message opens with [TEST] and closes with TEST_SLACK_FOOTER (same
// hardening rule as N2, addendum §A5 amend 2026-08-13).
//
// ─── Empty salaried_manager_emails semantics ──────────────────────
//
// Addendum §A6 rule: "an empty recipient list is not an error and
// not a silent skip." Live mode with an empty salaried list sends
// to the cc list (promoted into To) with a body note stating no
// site recipient is configured. Test mode never trips this branch
// because to = [KEVIN_EMAIL] always.
//
// ─── Shared helpers ───────────────────────────────────────────────
//
// emailShell / escapeHtml / sendSlack / fmtWeekTitle / fmtWeekRange
// live in qboNotifications._internals - the intentional escape hatch
// for sibling billing modules. Consuming via that surface keeps the
// PR-F code untouched.

import { resolveRecipients, NOTIFICATION_TYPES, KEVIN_EMAIL } from "./recipients.js";
import { sendEmailSA } from "../gmail.js";
import { _internals as qboInternals, TEST_SLACK_FOOTER } from "./qboNotifications.js";

const { emailShell, escapeHtml, sendSlack, fmtWeekTitle, fmtWeekRange } = qboInternals;

// Sender identity matches qboNotifications. Switched 2026-09-03
// from support@ to kitchfix.admin@ after support@kitchfix.com was
// identified as deactivated. See qboNotifications.js:46 for the
// full sender history + Gmail SA deactivated-target failure mode.
// N3.1 + N3.2 had been silently failing since chase-ladder merge
// because they are email-only (no Slack redundancy). Rotation
// restores delivery; consider adding Slack to N3.1 + N3.2 as a
// separate PR (parallel to what fireN1 gained 2026-09-03).
const EMAIL_SENDER       = "kitchfix.admin@kitchfix.com";
const EMAIL_DISPLAY_NAME = "KitchFix Ops Hub";

// ─── Copy helpers ─────────────────────────────────────────────────

// "Sat Aug 1 needs entry" chip text for one missing date.
function dayChipText(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} needs entry`;
}

// PR-G1 (2026-08-17): daychips carry a per-stage tone token so the
// urgent + past-due stages read as actionable amber rather than
// disabled grey. N3.1 keeps the quiet register per the render.
const CHIP_TONE = {
  quiet: { bg: "#F1F5F9", border: "#E2E8F0", fg: "#334155" }, // slate
  amber: { bg: "#FDF1E4", border: "#D9892F", fg: "#8A5A16" }, // amber on cream
};

function daychipsHtml(missingDates, tone = "quiet") {
  if (!Array.isArray(missingDates) || missingDates.length === 0) return "";
  const t = CHIP_TONE[tone] || CHIP_TONE.quiet;
  const chips = missingDates.map(iso =>
    `<span style="display:inline-block;padding:6px 10px;margin:4px 6px 0 0;font-size:12px;background:${t.bg};border:1px solid ${t.border};border-radius:14px;color:${t.fg};font-weight:600">${escapeHtml(dayChipText(iso))}</span>`
  ).join("");
  return `<tr><td style="padding-top:12px">${chips}</td></tr>`;
}

// Panel-row skeleton reused by all three stages.
function panelRow(k, v, borderColor = "#E2E8F0") {
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid ${borderColor};font-size:13px;color:#64748B">${escapeHtml(k)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid ${borderColor};font-size:13px;color:#0F172A;text-align:right;font-weight:600">${v}</td>
  </tr>`;
}

// "Tomorrow, Tue Aug 4" for the N3.2 "Bills" row (weekEnd + 2 days).
function fmtBillsDate(weekEndIso) {
  if (!weekEndIso) return "";
  const d = new Date(`${weekEndIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);           // Sun weekEnd + 2 = Tuesday
  return `Tue ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

// "The week of Jul 27" phrasing.
function fmtWeekOfPhrase(weekStartIso) {
  return `week of ${fmtWeekTitle(weekStartIso)}`;
}

// No-site-recipient note. Emitted at the top of the body when
// live-mode salaried_manager_emails is empty. Kevin + Sebastian
// (and RDO for N3.3) still receive because the cc gets promoted
// to To for delivery.
function noSiteRecipientNote(accountKey) {
  return `<tr><td style="padding:0 0 12px 0;font-size:12px;color:#8A5A16;background:#FDF6EC;border-left:3px solid #D9892F;padding:10px 12px;border-radius:4px">
    <b>No site recipient is configured for ${escapeHtml(accountKey)}.</b>
    Populate <code>sc_qbo_account_map.salaried_manager_emails</code> in Studio
    so the chase reaches the site next week.
  </td></tr>`;
}

// ─── N3.1 body: Friday reminder (quiet register) ──────────────────

function n31Body({ accountKey, weekStart, weekEnd, complete, total, missingDates, scWeekLink, isTest, noSiteRecipient }) {
  const kickBg = "#F1F5F9";
  const kickFg = "#475569";
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - reminder was routed to Kevin only; no site leader was contacted ***</td></tr>`
    : "";
  const rows = [
    panelRow("Account",       escapeHtml(accountKey)),
    panelRow("Service week",  escapeHtml(fmtWeekRange(weekStart, weekEnd))),
    panelRow("Entered so far", `<b>${complete} of ${total} days</b>`),
  ].join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  ${noSiteRecipient ? noSiteRecipientNote(accountKey) : ""}
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${kickFg};background:${kickBg};padding:6px 10px;border-radius:4px;display:inline-block">Weekly reminder</td></tr>
  <tr><td style="padding-top:12px;font-size:20px;line-height:1.2;font-weight:bold;color:#0F172A">This week closes Sunday</td></tr>
  <tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#475569">
    Enter the rest of the week's counts and finalize by <b>Monday at noon</b> so AP can bill on Tuesday.
  </td></tr>
  <tr><td style="padding-top:16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
      ${rows}
    </table>
  </td></tr>
  ${daychipsHtml(missingDates, "quiet")}
  <tr><td style="padding-top:20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:inline-block;padding:10px 18px;background:#153968;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Open the week</a>
  </td></tr>
  <tr><td style="padding-top:16px;font-size:11px;color:#64748B;line-height:1.5;border-top:1px solid #E2E8F0;padding-top:12px">
    A day with no service still needs marking - use <b>Mark day as no service</b> so the week can close.
  </td></tr>
  ${testLine}
</table>`;
}

// ─── N3.2 body: Monday urgent (amber) ─────────────────────────────

function n32Body({ accountKey, weekStart, weekEnd, complete, total, missingDates, scWeekLink, isTest, noSiteRecipient }) {
  const kickBg = "#FDF6EC";
  const kickFg = "#8A5A16";
  const borderAmber = "#F0D8AF";
  // PR-G1 (2026-08-17): button token was the ad-hoc dark amber-brown
  // #8A5A16 (Kevin flag "not in the token set"). Render intent is
  // amber (#D9892F). Measured WCAG contrast on the cream panel bg
  // (#FDF6EC): amber = 2.51:1 (FAILS AA even for large-bold text);
  // navy = 9.90:1 (passes AAA). Per Kevin's fallback rule ("navy if
  // contrast fails AA"), N3.2 button is navy. Ratio calculated with
  // WCAG 2.1 relative-luminance formula against the sRGB values.
  const btnBg = "#153968";
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - urgent chase was routed to Kevin only; no site leader was contacted ***</td></tr>`
    : "";
  const rows = [
    panelRow("Account",       escapeHtml(accountKey),                                borderAmber),
    panelRow("Service week",  escapeHtml(fmtWeekRange(weekStart, weekEnd)),          borderAmber),
    panelRow("Entered",       `<b>${complete} of ${total} days</b>`,                 borderAmber),
    panelRow("Bills",         `Tomorrow, ${escapeHtml(fmtBillsDate(weekEnd))}`,      borderAmber),
  ].join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  ${noSiteRecipient ? noSiteRecipientNote(accountKey) : ""}
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${kickFg};background:${kickBg};padding:6px 10px;border-radius:4px;display:inline-block">Action needed today</td></tr>
  <tr><td style="padding-top:12px;font-size:20px;line-height:1.2;font-weight:bold;color:#0F172A">Last week is not finalized yet</td></tr>
  <tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#475569">
    Billing runs <b>tomorrow morning</b>. ${missingDates.length} day${missingDates.length === 1 ? "" : "s"} still need entry for the ${escapeHtml(fmtWeekOfPhrase(weekStart))}.
  </td></tr>
  <tr><td style="padding-top:16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${borderAmber};border-radius:10px;overflow:hidden;background:${kickBg}">
      ${rows}
    </table>
  </td></tr>
  ${daychipsHtml(missingDates, "amber")}
  <tr><td style="padding-top:20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:inline-block;padding:10px 18px;background:${btnBg};color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Finish the week</a>
  </td></tr>
  <tr><td style="padding-top:16px;font-size:11px;color:#64748B;line-height:1.5;border-top:1px solid #E2E8F0;padding-top:12px">
    Kevin and Sebastian are copied on this message.
  </td></tr>
  ${testLine}
</table>`;
}

// ─── N3.3 body: Tuesday past due (red) ────────────────────────────

function n33Body({ accountKey, weekStart, weekEnd, complete, total, missingDates, scWeekLink, isTest, noSiteRecipient }) {
  const kickBg = "#FCEEED";
  const kickFg = "#B3261E";
  const borderRed = "#F0C9C6";
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - past-due chase was routed to Kevin only; no site leader was contacted ***</td></tr>`
    : "";
  const rows = [
    panelRow("Account",       escapeHtml(accountKey),                       borderRed),
    panelRow("Service week",  escapeHtml(fmtWeekRange(weekStart, weekEnd)), borderRed),
    panelRow("Entered",       `<b>${complete} of ${total} days</b>`,        borderRed),
    panelRow("Days past due", `<b>1</b>`,                                    borderRed),
  ].join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  ${noSiteRecipient ? noSiteRecipientNote(accountKey) : ""}
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${kickFg};background:${kickBg};padding:6px 10px;border-radius:4px;display:inline-block">Past due</td></tr>
  <tr><td style="padding-top:12px;font-size:20px;line-height:1.2;font-weight:bold;color:#0F172A">AP cannot bill this week</td></tr>
  <tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#475569">
    The ${escapeHtml(fmtWeekOfPhrase(weekStart))} for ${escapeHtml(accountKey)} should have been finalized by yesterday at noon. Billing runs this morning and this account will be skipped.
  </td></tr>
  <tr><td style="padding-top:16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${borderRed};border-radius:10px;overflow:hidden;background:${kickBg}">
      ${rows}
    </table>
  </td></tr>
  ${daychipsHtml(missingDates, "amber")}
  <tr><td style="padding-top:20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:inline-block;padding:10px 18px;background:${kickFg};color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Finish the week now</a>
  </td></tr>
  <tr><td style="padding-top:16px;font-size:11px;color:#64748B;line-height:1.5;border-top:1px solid #E2E8F0;padding-top:12px">
    Posted to <b>#service-calendar-invoices</b> as well.
    If the week genuinely had no service on those days, mark them as no service and finalize - the week will bill correctly.
  </td></tr>
  ${testLine}
</table>`;
}

// ─── N3.x Slack payloads ──────────────────────────────────────────
//
// All three chase stages post to Slack as of 2026-09-03. Prior to
// that date only N3.3 posted; N3.1 + N3.2 were email-only, which is
// the class of redundancy gap that hid the support@-deactivated
// sender bug for weeks (silent email failure with no redundant
// signal). Kevin's ruling 2026-09-03: chase failure is higher-cost
// than N1 failure, so redundancy on chase matters more than on N1.
//
// All three payloads: test mode opens with [TEST] prefix + closes
// with TEST_SLACK_FOOTER (same hardening rule as N2 + N3.3, addendum
// §A5 amend 2026-08-13). Kevin decision on channel: keep the single
// SLACK_SC_BILLING_WEBHOOK_URL - operational simplicity, one channel
// Kevin already watches for N2. Reaching site leaders directly via
// Slack is a follow-up (per-user DMs or a dedicated site-leaders
// channel; both require Slack workspace admin work outside code).

// Format `missingDates` as a compact `Fri Sep 5 and Sat Sep 6` list.
function fmtMissingDates(missingDates) {
  return (missingDates || []).map(iso => {
    const d = new Date(`${iso}T12:00:00Z`);
    return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }).join(" and ");
}

// N3.1 - Friday noon reminder. Tone: reminder, not urgent yet.
function n31SlackText({ accountKey, weekStart, complete, total, missingDates, isTest }) {
  const dayList = fmtMissingDates(missingDates);
  const headPrefix = isTest ? "[TEST] " : "";
  const head = `${headPrefix}Reminder: *${accountKey}* has ${complete} of ${total} days entered for the ${fmtWeekOfPhrase(weekStart)}. Finalize by Monday at noon.`;
  const detail = dayList ? `${dayList} still need entry` : "All days entered; finalize the week to confirm.";
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return `${head}\n${detail}${foot}`;
}

// N3.2 - Monday noon urgent. Tone: last-call. Billing runs tomorrow.
function n32SlackText({ accountKey, weekStart, complete, total, missingDates, isTest }) {
  const dayList = fmtMissingDates(missingDates);
  const headPrefix = isTest ? "[TEST] " : "";
  const head = `${headPrefix}Action needed: *${accountKey}* still has ${(missingDates || []).length} day${(missingDates || []).length === 1 ? "" : "s"} unentered for the ${fmtWeekOfPhrase(weekStart)}. Billing runs tomorrow.`;
  const detail = `${complete} of ${total} days entered${dayList ? ` · ${dayList} still need entry` : ""}`;
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return `${head}\n${detail}${foot}`;
}

// N3.3 - Tuesday morning past-due. Tone: billing is running, this
// account is being skipped. Only stage that carries siteLeadNames
// (populated for the resolver at N3.3 fire-time so the Slack post
// can name whose escalation this is).
function n33SlackText({ accountKey, weekStart, weekEnd, complete, total, missingDates, siteLeadNames, isTest }) {
  const dayList = fmtMissingDates(missingDates);
  const headPrefix = isTest ? "[TEST] " : "";
  const head = `${headPrefix}*${accountKey}* has not finalized the ${fmtWeekOfPhrase(weekStart)}. Billing runs this morning and this account will be skipped.`;
  const detail = `${complete} of ${total} days entered${dayList ? ` · ${dayList} still need entry` : ""}`;
  const leads = (siteLeadNames && siteLeadNames.length > 0)
    ? `\nSite leads: ${siteLeadNames.join(", ")}`
    : "\nNo site recipient configured";
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return `${head}\n${detail}${leads}${foot}`;
}

// ─── Subject line composer ────────────────────────────────────────

function subjectFor(stage, accountKey, weekStart, isTest) {
  const testPrefix = isTest ? "[TEST] " : "";
  const wk = fmtWeekTitle(weekStart);
  if (stage === NOTIFICATION_TYPES.N3_1) return `${testPrefix}Reminder: ${accountKey}, week of ${wk}`;
  if (stage === NOTIFICATION_TYPES.N3_2) return `${testPrefix}Action needed: ${accountKey}, week of ${wk}`;
  if (stage === NOTIFICATION_TYPES.N3_3) return `${testPrefix}Past due: ${accountKey}, week of ${wk}`;
  throw new Error(`chaseNotifications.subjectFor: unknown stage ${JSON.stringify(stage)}`);
}

// ─── fireN3: main entrypoint ──────────────────────────────────────

/**
 * Build and (optionally) send one chase stage.
 *
 * Empty-salaried edge case: when live-mode resolveRecipients returns
 * to=[], we promote cc into to for delivery (SMTP requires >= 1 To),
 * emit the no-site-recipient note in the body, and record the swap
 * in the returned shape.
 *
 * @param {Object} args
 * @param {"N3.1"|"N3.2"|"N3.3"} args.stage
 * @param {"test"|"live"} args.qboMode
 * @param {string} args.accountKey
 * @param {string} args.weekStart     ISO Monday
 * @param {string} args.weekEnd       ISO Sunday
 * @param {number} args.complete      Days entered (or planned off-day marked)
 * @param {number} args.total         Total days in the week (7 for full weeks)
 * @param {string[]} args.missingDates ISO dates still needing entry
 * @param {string} args.scWeekLink    Deep link to the Service Calendar week
 * @param {Object} [args.accountMap]  { salariedManagerEmails, rdoEmail }
 * @param {string[]} [args.siteLeadNames] Names for the N3.3 Slack "Site leads" line
 * @param {boolean} [args.send=true]  When false, returns render without dispatching
 * @param {Object} [args.deps]        { emailSender, sendSlack, slackWebhookUrl } for tests
 * @returns {Promise<{recipients, subject, preheader, html, email:{result}, slack?:{text,result}, noSiteRecipient:boolean}>}
 */
export async function fireN3(args) {
  const {
    stage, qboMode, accountKey, weekStart, weekEnd,
    complete, total, missingDates, scWeekLink,
    accountMap, siteLeadNames, send = true, deps,
  } = args;

  const isTest = qboMode === "test";
  const stageKeys = [NOTIFICATION_TYPES.N3_1, NOTIFICATION_TYPES.N3_2, NOTIFICATION_TYPES.N3_3];
  if (!stageKeys.includes(stage)) {
    throw new Error(`fireN3: stage must be one of ${stageKeys.join("/")}, got ${JSON.stringify(stage)}`);
  }

  const recipients = resolveRecipients({
    notification: stage, accountKey, mode: qboMode, accountMap,
  });

  // Empty-salaried edge case. resolveRecipients returned to=[] because
  // live-mode salaried_manager_emails is empty. Promote cc to to and
  // flag the no-site-recipient path so the body carries the note.
  let sendTo = recipients.to;
  let sendCc = recipients.cc;
  const noSiteRecipient = !isTest && recipients.to.length === 0 && recipients.cc.length > 0;
  if (noSiteRecipient) {
    sendTo = recipients.cc;
    sendCc = [];
  }

  const subject = subjectFor(stage, accountKey, weekStart, isTest);
  const preheaders = {
    [NOTIFICATION_TYPES.N3_1]: `${complete} of ${total} days entered so far. Finalize by Monday at noon.`,
    [NOTIFICATION_TYPES.N3_2]: `Billing runs tomorrow. ${missingDates.length} day${missingDates.length === 1 ? "" : "s"} still need entry.`,
    [NOTIFICATION_TYPES.N3_3]: `AP cannot bill this week. ${complete} of ${total} days entered.`,
  };
  const preheader = preheaders[stage];

  const bodyBuilders = {
    [NOTIFICATION_TYPES.N3_1]: n31Body,
    [NOTIFICATION_TYPES.N3_2]: n32Body,
    [NOTIFICATION_TYPES.N3_3]: n33Body,
  };
  const body = bodyBuilders[stage]({
    accountKey, weekStart, weekEnd, complete, total, missingDates,
    scWeekLink, isTest, noSiteRecipient,
  });
  const html = emailShell({ preheader, body });

  // Pick the stage's Slack composer once. 2026-09-03: all three
  // stages post to Slack; previously only N3.3. See "N3.x Slack
  // payloads" section above for the tone-per-stage rationale + the
  // Kevin ruling on redundancy priority.
  const slackComposers = {
    [NOTIFICATION_TYPES.N3_1]: n31SlackText,
    [NOTIFICATION_TYPES.N3_2]: n32SlackText,
    [NOTIFICATION_TYPES.N3_3]: n33SlackText,
  };
  const composeSlack = () => slackComposers[stage]({
    accountKey, weekStart, weekEnd, complete, total, missingDates,
    siteLeadNames, isTest,
  });

  // Send.
  let emailResult = "not_sent";
  let slackOut = null;
  if (send) {
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
    }
    const slackText = composeSlack();
    const webhookUrl = deps?.slackWebhookUrl || process.env.SLACK_SC_BILLING_WEBHOOK_URL;
    const slackResult = await (deps?.sendSlack || sendSlack)({ webhookUrl, text: slackText });
    slackOut = { text: slackText, result: slackResult };
  } else {
    // Render-only: build the slack text so tests can assert it.
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
  n31Body, n32Body, n33Body,
  n31SlackText, n32SlackText, n33SlackText,
  subjectFor, daychipsHtml, dayChipText, fmtBillsDate,
};
