// ═══════════════════════════════════════════════════════════════════
// qboNotifications - N1 (invoice ready) + N2 (push failed) live send.
// PR-F of the SC -> QBO billing arc (2026-08-13).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5 (test/live
// switch), §A6 (matrix), §A6b (Slack channel), §A7 (copy + email
// markup rules). Content + hierarchy come from
// docs/design/KF_NOTIFICATION_RENDERS.html; the CSS in the render
// does NOT carry over - production email is table-based, inline-
// styled markup so it survives Outlook.
//
// ─── Test-mode structural override ────────────────────────────────
//
// Recipient resolution flows through src/lib/billing/recipients.js
// resolveRecipients() whose first branch returns Kevin only in test
// mode. This module never composes recipients any other way, so no
// test finalize can email a site leader by construction.
//
// Slack posts DO fire in test mode (addendum §A5, amended
// 2026-08-13) to `#service-calendar-invoices` because that channel
// has one member today. Every test-mode Slack post opens with a
// `[TEST]` prefix and closes with a test-no-client-impact footer -
// asserted by test, not by comment. If the channel ever gains a
// member, the markers make the copy unambiguous.
//
// ─── Slack webhook ────────────────────────────────────────────────
//
// `SLACK_SC_BILLING_WEBHOOK_URL` (addendum §A6b, added 2026-08-13).
// Distinct from `SLACK_SC_WEBHOOK_URL` (operational alerts). If the
// env var is missing, the Slack post is silently skipped and email
// delivery is unaffected - matches every other webhook in the
// codebase.
//
// ─── Live-mode disabled today ─────────────────────────────────────
//
// Both pilots (TXR - AZ, CIN - AZ) sit in test mode when this PR
// merges (sc-35 seeds qbo_mode='test'). Live-mode routing is built
// and unit-tested but no account exercises it in the wild.

import { resolveRecipients, NOTIFICATION_TYPES, KEVIN_EMAIL } from "./recipients.js";
import { sendEmailSA } from "@/lib/gmail";

// ─── Copy constants ───────────────────────────────────────────────

// Sender identity for outbound. Uses the same `support@kitchfix.com`
// impersonation as the incidents email path (`src/app/api/people/
// route.js:75`) which has proven Gmail SA domain-wide-delegation.
// A dedicated `ops-hub@kitchfix.com` sender was tried 2026-08-13 and
// failed at Gmail SA auth ("invalid_grant: Invalid email or User ID")
// - that address is not on the SA's DWD allowlist. Display name
// remains "KitchFix Ops Hub" so recipients still see the ops-hub
// brand in the From header.
const EMAIL_SENDER       = "support@kitchfix.com";
const EMAIL_DISPLAY_NAME = "KitchFix Ops Hub";

// Fixed literal for the test-mode footer. Kept as a constant so a
// unit test can assert the exact bytes rather than a fuzzy regex.
export const TEST_SLACK_FOOTER =
  "*This is a test post. No client was billed and no site leader was contacted.*";

// ─── Formatters ───────────────────────────────────────────────────

function formatCents(cents) {
  if (typeof cents !== "number" || !isFinite(cents)) return "$?";
  const dollars = Math.round(cents) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtWeekTitle(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtWeekRange(weekStart, weekEnd) {
  if (!weekStart) return "";
  const opts = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  const s = new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-US", opts);
  if (!weekEnd) return s;
  const e = new Date(`${weekEnd}T12:00:00Z`).toLocaleDateString("en-US", opts);
  return `${s} - ${e}`;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

// ─── Table-based email skeleton (Outlook-safe) ────────────────────

function emailShell({ preheader, body }) {
  // 600px table, inline styles only. Preheader is a hidden div that
  // Gmail + Outlook surface in the inbox list next to the subject.
  return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;color:#0F172A">
<div style="display:none;font-size:1px;color:#EEF1F5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader || "")}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EEF1F5;padding:24px 8px">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E2E8F0">
      <tr><td style="background:#153968;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff">
        KitchFix <span style="color:#D9892F">Ops Hub</span>
      </td></tr>
      <tr><td style="padding:24px">
        ${body}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// N1 body table.
function n1Body({ accountKey, weekStart, weekEnd, submitterEmail, invoiceRecords, scWeekLink, isTest }) {
  const totalCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const totalMeals = invoiceRecords.reduce((s, r) => s + (r.lineCount || 0), 0);
  const kickText = isTest ? "TEST - READY FOR REVIEW" : "READY FOR REVIEW";
  const kickBg   = isTest ? "#FDF6EC" : "#E8F5EC";
  const kickFg   = isTest ? "#8A5A16" : "#2F7D4F";
  const qboLink  = invoiceRecords.find((r) => r.qboLink)?.qboLink || "";
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - not a real invoice; no client will be billed ***</td></tr>`
    : "";

  const rows = [
    ["Account",         escapeHtml(accountKey)],
    ["Service week",    escapeHtml(fmtWeekRange(weekStart, weekEnd))],
    ["Invoices",        String(invoiceRecords.length)],
    ["Pre-tax total",   `<b>${escapeHtml(formatCents(totalCents))}</b>`],
    ["Finalized by",    escapeHtml(submitterEmail || "(unknown)")],
  ].map(([k, v]) => `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#64748B">${k}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#0F172A;text-align:right;font-weight:600">${v}</td>
  </tr>`).join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${kickFg};background:${kickBg};padding:6px 10px;border-radius:4px;display:inline-block">${kickText}</td></tr>
  <tr><td style="padding-top:12px;font-size:20px;line-height:1.2;font-weight:bold;color:#0F172A">Invoice draft ready for review</td></tr>
  <tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#475569">
    <b>${escapeHtml(submitterEmail || "The site leader")}</b> finalized the week of <b>${escapeHtml(fmtWeekRange(weekStart, weekEnd))}</b> for
    ${escapeHtml(accountKey)}. The intranet built the invoice from the Service Calendar and placed it in QuickBooks as a draft.
    <b>AP reviews it and sends it to the client.</b>
  </td></tr>
  <tr><td style="padding-top:16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding-top:20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:inline-block;padding:10px 18px;background:#153968;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Open the week in the Service Calendar</a>
  </td></tr>
  ${qboLink ? `<tr><td style="padding-top:8px;font-size:12px;color:#64748B">
    <a href="${escapeHtml(qboLink)}" style="color:#153968">AP and leadership: open the draft in QuickBooks</a>
  </td></tr>` : ""}
  ${testLine}
  <tr><td style="padding-top:16px;font-size:11px;color:#64748B;line-height:1.5;border-top:1px solid #E2E8F0;padding-top:12px;margin-top:12px">
    Sales tax is calculated by QuickBooks at send. QuickBooks access is AP and leadership only.
    This week is now locked - Kevin, Joe, or Sebastian can unlock it.
  </td></tr>
</table>`;
}

// N2 body table.
function n2Body({ accountKey, weekStart, weekEnd, errorText, retryLink, scWeekLink, isTest, attempt }) {
  const kickBg = "#FCEEED";
  const kickFg = "#B3261E";
  const testLine = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - not a real push; no client was contacted ***</td></tr>`
    : "";
  const rows = [
    ["Account",         escapeHtml(accountKey)],
    ["Service week",    escapeHtml(fmtWeekRange(weekStart, weekEnd))],
    ["Attempt",         escapeHtml(String(attempt || "?"))],
    ["What QuickBooks said",
      `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px">${escapeHtml((errorText || "(no error)").slice(0, 200))}</span>`],
  ].map(([k, v]) => `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #F0C9C6;font-size:13px;color:#64748B">${k}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #F0C9C6;font-size:13px;color:#0F172A;text-align:right;font-weight:600">${v}</td>
  </tr>`).join("");

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${kickFg};background:${kickBg};padding:6px 10px;border-radius:4px;display:inline-block">NEEDS ATTENTION</td></tr>
  <tr><td style="padding-top:12px;font-size:20px;line-height:1.2;font-weight:bold;color:#0F172A">QuickBooks did not accept the invoice</td></tr>
  <tr><td style="padding-top:8px;font-size:14px;line-height:1.5;color:#475569">
    The week of <b>${escapeHtml(fmtWeekRange(weekStart, weekEnd))}</b> for ${escapeHtml(accountKey)} is finalized and locked,
    but no invoice was created. <b>Nothing reached the client.</b> The numbers are safe and the push can be run again.
  </td></tr>
  <tr><td style="padding-top:16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #F0C9C6;border-radius:10px;overflow:hidden;background:#FCEEED">
      ${rows}
    </table>
  </td></tr>
  ${retryLink ? `<tr><td style="padding-top:20px">
    <a href="${escapeHtml(retryLink)}" style="display:inline-block;padding:10px 18px;background:#B3261E;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:bold">Retry the push</a>
  </td></tr>` : ""}
  ${scWeekLink ? `<tr><td style="padding-top:8px;font-size:12px;color:#64748B">
    <a href="${escapeHtml(scWeekLink)}" style="color:#153968">Open the week in the Service Calendar</a>
  </td></tr>` : ""}
  ${testLine}
</table>`;
}

// Slack payload for N2. Test-mode ALWAYS opens with [TEST] prefix
// AND closes with TEST_SLACK_FOOTER (addendum §A5 amend 2026-08-13).
function n2SlackText({ accountKey, weekStart, weekEnd, errorText, retryLink, isTest, attempt }) {
  const head = isTest
    ? `[TEST] *QBO push failed* for \`${accountKey}\`, week of ${fmtWeekTitle(weekStart)}. The week is finalized and locked; nothing reached the client.`
    : `*QBO push failed* for \`${accountKey}\`, week of ${fmtWeekTitle(weekStart)}. The week is finalized and locked; nothing reached the client.`;
  const err = String(errorText || "(no error)").slice(0, 400).replace(/`/g, "'");
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return (
    `${head}\n` +
    `QuickBooks: ${err} · attempt ${attempt || "?"}\n` +
    (retryLink ? `Retry: ${retryLink}\n` : "") +
    foot
  );
}

// ─── Live-send helpers ────────────────────────────────────────────

async function sendSlack({ webhookUrl, text }) {
  if (!webhookUrl) return { sent: false, skipped: "no webhook" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { sent: false, error: `HTTP ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e?.message || String(e) };
  }
}

// ─── N1: invoice created ──────────────────────────────────────────

/**
 * Build and (optionally) send N1. Recipients resolved via
 * resolveRecipients - test mode returns Kevin only, structurally.
 *
 * @param {Object} args
 * @param {"test"|"live"} args.qboMode
 * @param {string} args.accountKey
 * @param {string} args.weekStart
 * @param {string} args.weekEnd
 * @param {string} args.submitterEmail
 * @param {Array<{invoiceSlot,qboInvoiceId,qboDocNumber,pretaxTotalCents,lineCount,isTest,qboLink,ledgerRowId}>} args.invoiceRecords
 * @param {string} args.scWeekLink
 * @param {Object} [args.accountMap]  {salariedManagerEmails, rdoEmail}
 * @param {boolean} [args.send=true]  When false, returns the render
 *                                    without dispatching (for tests).
 * @param {Object} [args.deps]        { emailSender } for tests.
 * @returns {Promise<{recipients:{to:string[],cc:string[]}, subject:string, html:string, preheader:string, emailResult?:string}>}
 */
export async function fireN1(args) {
  const {
    qboMode, accountKey, weekStart, weekEnd, submitterEmail,
    invoiceRecords, scWeekLink, accountMap, send = true, deps,
  } = args;
  const isTest = qboMode === "test";
  const recipients = resolveRecipients({
    notification: NOTIFICATION_TYPES.N1,
    accountKey, mode: qboMode,
    submitterEmail, accountMap,
  });
  const totalCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const totalMeals = invoiceRecords.reduce((s, r) => s + (r.lineCount || 0), 0);
  const testPrefix = isTest ? "[TEST] " : "";
  const subject = `${testPrefix}Invoice ready: ${accountKey}, week of ${fmtWeekTitle(weekStart)}`;
  const preheader = `${invoiceRecords.length} invoice(s), ${formatCents(totalCents)} pre-tax. Ready for AP review.`;
  const html = emailShell({
    preheader,
    body: n1Body({ accountKey, weekStart, weekEnd, submitterEmail, invoiceRecords, scWeekLink, isTest }),
  });

  let emailResult = "not_sent";
  if (send && recipients.to.length > 0) {
    const sender = deps?.emailSender || sendEmailSA;
    emailResult = await sender({
      sender: EMAIL_SENDER,
      displayName: EMAIL_DISPLAY_NAME,
      to: recipients.to,
      subject,
      html,
    });
  }
  return { recipients, subject, preheader, html, emailResult };
}

// ─── N2: push failed ──────────────────────────────────────────────

/**
 * Build and (optionally) send N2 email + Slack. Recipients through
 * resolveRecipients. Slack posts in both modes; test mode always
 * carries [TEST] prefix + TEST_SLACK_FOOTER.
 */
export async function fireN2(args) {
  const {
    qboMode, accountKey, weekStart, weekEnd, errorText, retryLink,
    scWeekLink, attempt, accountMap, send = true, deps,
  } = args;
  const isTest = qboMode === "test";
  const recipients = resolveRecipients({
    notification: NOTIFICATION_TYPES.N2,
    accountKey, mode: qboMode, accountMap,
  });
  const testPrefix = isTest ? "[TEST] " : "";
  const subject = `${testPrefix}Push failed: ${accountKey}, week of ${fmtWeekTitle(weekStart)}`;
  const preheader = "The week is locked and nothing reached the client. The push can be run again.";
  const html = emailShell({
    preheader,
    body: n2Body({ accountKey, weekStart, weekEnd, errorText, retryLink, scWeekLink, isTest, attempt }),
  });
  const slackText = n2SlackText({ accountKey, weekStart, weekEnd, errorText, retryLink, isTest, attempt });

  let emailResult = "not_sent";
  let slackResult = { sent: false, skipped: "not sent (send=false)" };
  if (send) {
    if (recipients.to.length > 0) {
      const sender = deps?.emailSender || sendEmailSA;
      emailResult = await sender({
        sender: EMAIL_SENDER,
        displayName: EMAIL_DISPLAY_NAME,
        to: recipients.to,
        subject,
        html,
      });
    }
    const slackWebhook = deps?.slackWebhookUrl || process.env.SLACK_SC_BILLING_WEBHOOK_URL;
    slackResult = await (deps?.sendSlack || sendSlack)({
      webhookUrl: slackWebhook,
      text: slackText,
    });
  }
  return {
    recipients, subject, preheader, html,
    slack: { text: slackText, result: slackResult },
    email: { result: emailResult },
  };
}

// ─── Legacy render entry points (kept for existing unit tests) ────
//
// PR-C's tests call renderN1 / renderN2. Preserve those signatures
// as thin wrappers around fireN1 / fireN2 with send=false so no
// live send happens from a render-only path.

export function renderN1({ accountKey, weekStart, weekEnd, submitterEmail, invoiceRecords, scWeekLink, dryRunOnly }) {
  if (dryRunOnly === false) {
    throw new Error("renderN1 is render-only. Use fireN1 for live send.");
  }
  // Legacy contract: test-mode inference from invoiceRecords[].isTest.
  const inferredMode = invoiceRecords?.some((r) => r.isTest) ? "test" : "live";
  const isTest = inferredMode === "test";
  const testPrefix = isTest ? "TEST - " : "";
  const subject = `${testPrefix}Invoice draft ready: ${accountKey} ${weekStart}..${weekEnd}`;
  const totalCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const html = emailShell({
    preheader: `${invoiceRecords.length} invoice(s), ${formatCents(totalCents)} pre-tax.`,
    body: n1Body({ accountKey, weekStart, weekEnd, submitterEmail, invoiceRecords, scWeekLink, isTest }),
  });
  const to = isTest ? [KEVIN_EMAIL] : n1LegacyRecipients({ accountKey, submitterEmail });
  return { mode: "dryrun", to, subject, html };
}

export function renderN2({ accountKey, weekStart, weekEnd, errorText, retryLink, dryRunOnly }) {
  if (dryRunOnly === false) {
    throw new Error("renderN2 is render-only. Use fireN2 for live send.");
  }
  const subject = `QBO push FAILED: ${accountKey} ${weekStart}..${weekEnd}`;
  const html = emailShell({
    preheader: "The week is locked and nothing reached the client.",
    body: n2Body({ accountKey, weekStart, weekEnd, errorText, retryLink, isTest: false, attempt: 1 }),
  });
  const slackText = n2SlackText({ accountKey, weekStart, weekEnd, errorText, retryLink, isTest: false, attempt: 1 });
  return {
    email: { mode: "dryrun", to: [KEVIN_EMAIL, "sebastian@kitchfix.com"], subject, html },
    slack: { mode: "dryrun", text: slackText },
  };
}

// Legacy N1 recipients used only by renderN1 (the old dryRunOnly API).
// New code uses resolveRecipients + accountMap.
export const N1_STATIC_RECIPIENTS = Object.freeze([
  "sebastian@kitchfix.com",
  KEVIN_EMAIL,
  "joe@kitchfix.com",
  "josh@kitchfix.com",
]);
export const N2_RECIPIENTS = Object.freeze([KEVIN_EMAIL, "sebastian@kitchfix.com"]);
function n1LegacyRecipients({ accountKey, submitterEmail }) {
  const set = new Set(N1_STATIC_RECIPIENTS);
  if (submitterEmail) set.add(String(submitterEmail).toLowerCase());
  return [...set];
}

export const _internals = {
  emailShell, n1Body, n2Body, n2SlackText, sendSlack, formatCents,
  fmtWeekTitle, fmtWeekRange, escapeHtml,
};
