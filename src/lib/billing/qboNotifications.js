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
import { buildRecordCopyPdf, computeApproverPhrase } from "./recordCopyPdf.js";

// ─── Copy constants ───────────────────────────────────────────────

// Sender identity for outbound. Switched 2026-09-03 from support@
// to kitchfix.admin@ after the 2026-09-03 fireN1 probe caught
// `invalid_grant: Invalid email or User ID` from Gmail SA and Kevin
// identified support@kitchfix.com as deactivated. The error text
// reads like a permissions problem but is actually "impersonation
// target does not exist as an active mailbox" - see docs/GOTCHAS.md
// entry "invalid_grant from a deactivated impersonation target".
//
// Prior sender history:
//   - support@kitchfix.com: worked historically; deactivated at some
//     unknown date before 2026-09-03. Silent failure until the probe.
//   - ops-hub@kitchfix.com: tried 2026-08-13, also failed with
//     invalid_grant. That was the same class of failure and would
//     have shown up on the probe too, but wasn't run. Deleted/never-
//     created status unknown; do not resurrect without verifying.
//
// Display name remains "KitchFix Ops Hub" so recipients still see
// the ops-hub brand in the From header even though the underlying
// mailbox is kitchfix.admin@.
const EMAIL_SENDER       = "kitchfix.admin@kitchfix.com";
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

// N1 body table (intranet-shell rebuild 2026-09-09).
//
// Design authority: docs/design/KF_CONFIRMATION_EMAIL_RENDER.html.
// Same shell as the chase emails - navy KitchFix Ops Hub brand,
// status flag, fact table, one button, instructions in the footer.
// Copy names Sebastian (not "AP") because a chef who has never met
// the AP function needs a specific person to associate with the
// downstream step.
//
// approvedByLede is the pre-computed sentence from computeApproverPhrase -
// handles the 1/2/3+/finalizer-vs-approver combinations. Never claims
// one person did all of it when the data says otherwise (Kevin ruling
// 2026-09-09).
//
// mealsCount comes from the sum of qty across every line item (not
// invoiceRecords.length which is the invoice-slot count). "Meals" in
// the fact table is per the render.
function n1Body({ accountKey, weekStart, weekEnd, approvedByLede, mealsCount, daysServed, daysInWeek, pretaxCents, scWeekLink, isTest }) {
  const flagBg    = isTest ? "#FDF3E6" : "#E8F5EC";
  const flagFg    = isTest ? "#8A5A16" : "#2F7D4F";
  const flagBd    = isTest ? "#F0D9B5" : "#A6D3B8";
  const flagLabel = isTest ? "Test send" : "Sent to billing";
  const testLine  = isTest
    ? `<tr><td style="padding-top:16px;font-size:12px;color:#8A5A16;font-weight:bold">*** TEST - not a real invoice; no client will be billed ***</td></tr>`
    : "";

  const rows = [
    ["Week",         escapeHtml(fmtWeekRange(weekStart, weekEnd))],
    ["Days served",  `${daysServed} of ${daysInWeek}`],
    ["Meals",        (mealsCount || 0).toLocaleString("en-US")],
  ].map(([k, v]) => `<tr>
    <td style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;color:#64748B">${k}</td>
    <td style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;color:#0F172A;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${v}</td>
  </tr>`).join("");

  const totalRow = `<tr>
    <td style="padding:10px 0;border-top:2px solid #E2E8F0;font-size:14px;color:#64748B">Pre-tax</td>
    <td style="padding:10px 0;border-top:2px solid #E2E8F0;font-size:14px;color:#0F172A;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${escapeHtml(formatCents(pretaxCents))}</td>
  </tr>`;

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${flagFg};background:${flagBg};border-bottom:1px solid ${flagBd};padding:7px 20px;display:block">${flagLabel}</td></tr>
  <tr><td style="padding-top:12px;padding-left:20px;padding-right:20px;font-size:17px;line-height:1.35;font-weight:bold;color:#0F172A">The week is finalized</td></tr>
  <tr><td style="padding:8px 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    ${approvedByLede} Sebastian reviews it in QuickBooks and sends it to the client.
  </td></tr>
  <tr><td style="padding:0 20px 15px 20px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      ${rows}
      ${totalRow}
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 13px 20px">
    <a href="${escapeHtml(scWeekLink || "#")}" style="display:block;text-align:center;padding:11px;background:#1A3050;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700">Open the week</a>
  </td></tr>
  <tr><td style="padding:12px 20px 0 20px;font-size:11px;line-height:1.55;color:#94A3B8;border-top:1px solid #F1F5F9">
    <b style="color:#64748B;font-weight:600">The attached copy is for your records.</b> It shows every line as billed. It is not the invoice &mdash; Sebastian sends that from QuickBooks. The week is locked; Kevin, Joe or Sebastian can unlock it if something needs correcting.
  </td></tr>
  ${testLine}
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

// Slack payload for N1. Mirror of n2SlackText - test mode carries
// [TEST] prefix + TEST_SLACK_FOOTER; live mode carries neither.
// Enumerates every invoice's QBO deep-link (matches the email body's
// per-slot enumeration added 2026-09-02 for TBJ's 3-8 invoices).
function n1SlackText({ accountKey, weekStart, invoiceRecords, isTest, scWeekLink }) {
  const totalCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const count = invoiceRecords.length;
  const head = isTest
    ? `[TEST] *Invoice draft ready* for \`${accountKey}\`, week of ${fmtWeekTitle(weekStart)}. ${count} invoice(s), ${formatCents(totalCents)} pre-tax. AP reviews and sends.`
    : `*Invoice draft ready* for \`${accountKey}\`, week of ${fmtWeekTitle(weekStart)}. ${count} invoice(s), ${formatCents(totalCents)} pre-tax. AP reviews and sends.`;
  const linkList = invoiceRecords
    .filter((r) => r.qboLink)
    .map((r) => `• ${r.invoiceSlot || "invoice"}: ${r.qboLink}`)
    .join("\n");
  const foot = isTest ? `\n${TEST_SLACK_FOOTER}` : "";
  return (
    `${head}\n` +
    (linkList ? `${linkList}\n` : "") +
    (scWeekLink ? `Service Calendar: ${scWeekLink}\n` : "") +
    foot
  );
}

// Presence check for the Gmail service-account impersonation env
// vars. sendEmailSA in src/lib/gmail.js swallows exceptions and
// returns "failed" on any error - including missing env - which
// silently hides misconfiguration. Check at fire-time so the caller
// gets a named-block signal ("missing_env:GOOGLE_PRIVATE_KEY")
// rather than a generic "failed". Both keys must be present for
// the JWT construction to succeed.
function checkGmailSaEnv() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return { ok: false, missing: "GOOGLE_SERVICE_ACCOUNT_EMAIL" };
  }
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    return { ok: false, missing: "GOOGLE_PRIVATE_KEY" };
  }
  return { ok: true };
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
 * Return shape (matches fireN2 as of 2026-09-03 Ruling 2):
 *   { recipients, subject, preheader, html,
 *     email: { result: 'sent'|'failed'|'not_sent'|'missing_env:<key>' },
 *     slack: { text, result: {sent, error?, skipped?} } }
 *
 * The email.result value 'missing_env:GOOGLE_PRIVATE_KEY' (or
 * '_EMAIL') distinguishes "we did not try because the env is missing"
 * from "we tried and Gmail said no". This is the failure mode
 * that silently killed every N1 on 2026-09-03 - the SA layer
 * swallowed the exception and returned 'failed' with no operator
 * signal. Presence-check at fire-time surfaces the miss as a
 * named error instead.
 *
 * Slack posts in both modes (parallel to fireN2), which is the
 * redundant signal for Gmail SA failures - had Slack been wired
 * to N1 on 2026-09-03, Kevin would have known immediately that the
 * email path was broken instead of waiting for AP to notice no
 * mail arrived.
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
 * @param {Object} [args.deps]        { emailSender, sendSlack, slackWebhookUrl } for tests.
 * @returns {Promise<{recipients:{to:string[],cc:string[]}, subject:string, html:string, preheader:string, email:{result:string}, slack:{text:string, result:object}}>}
 */
export async function fireN1(args) {
  const {
    qboMode, accountKey, accountLabel, weekStart, weekEnd, submitterEmail,
    submitterName, invoiceRecords, scWeekLink, accountMap, finalizedDateISO,
    reviewRows, send = true, deps,
  } = args;
  const isTest = qboMode === "test";
  const recipients = resolveRecipients({
    notification: NOTIFICATION_TYPES.N1,
    accountKey, mode: qboMode,
    submitterEmail, accountMap,
  });

  // Aggregate lines across every slot. Meals = sum of qty across
  // "meal-like" services (breakfast/lunch/dinner/road-sandwich).
  // For accounts where every line is a meal, sum of qty is fine;
  // for those with extras (protein add-ons, labor fees), we need
  // to filter. Simplest correct definition: sum qty for lines whose
  // service name doesn't match {Labor Fee, Extra Protein, ...} which
  // are per-day one-offs. Fall back to sum-of-qty if the filter
  // matches nothing (defensive).
  const allLines = [];
  for (const r of invoiceRecords || []) for (const li of r.lineItems || []) allLines.push(li);
  const isMealLine = (li) => {
    const n = String(li?.serviceName || "").toLowerCase();
    if (n.includes("labor")) return false;
    if (n.includes("extra ")) return false;
    if (n.includes("fee")) return false;
    return true;
  };
  const mealLines = allLines.filter(isMealLine);
  const mealsCount = (mealLines.length > 0 ? mealLines : allLines)
    .reduce((s, li) => s + (Number(li.qty) || 0), 0);

  // Days served = count of distinct service dates that carry at least
  // one meal-like line. Days-in-week = the account's configured week
  // length (fall back to 7 if we can't derive it from the input).
  const uniqueDates = new Set(mealLines.map((li) => li.serviceDate).filter(Boolean));
  const daysServed = uniqueDates.size;
  const daysInWeek = Number(args?.daysInWeek) || 7;

  // Resolve approver phrase. reviewRows is passed in by the caller
  // when the review-gate ships the week's rows; the resolver produces
  // both the email lede + the PDF's meta row from the same source.
  // If no reviewRows are provided (early callers / tests), fall back
  // to the submitter as the approver.
  const finalizerName = submitterName || submitterEmail || "";
  const approverPhrase = computeApproverPhrase({
    reviewRows: reviewRows || (finalizerName
      ? [{ reviewedBy: finalizerName, reviewedAt: finalizedDateISO || weekStart }]
      : []),
    finalizerName,
    accountKey,
  });

  // Build the RECORD COPY PDF.
  //
  // 2026-09-16: degrade gracefully. Original shape threw on any PDF
  // failure or on a pretax mismatch, which then killed the send
  // entirely - the operator got no email, no Slack, and no signal
  // anything had gone wrong. That was the fourth silent-failure of
  // this arc and it happened because a guard on an ATTACHMENT was
  // gating the MESSAGE. A guard on an attachment must never gate the
  // message.
  //
  // New contract:
  //   - PDF build throws -> pdfError captured, pdf=null, email + slack
  //     still dispatch (without the attachment; no warning in the
  //     email body per Kevin's ruling).
  //   - PDF built but pretax !== email sum -> same pdfError shape,
  //     pdf discarded, email + slack still dispatch. The mismatch
  //     no longer refuses the send - it just refuses the attachment.
  //   - No pdfError -> attachment goes as normal.
  //
  // Failure reaches Kevin via (a) a log.warn tier in the caller,
  // (b) an appended line on the Slack post (chef reads the success
  // subject; ops reads the Slack line). Deliberately NOT in the
  // email body so the chef never reads a confidence-eroding warning
  // on a message that is otherwise correct.
  const emailPretaxCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const buildPdf = deps?.buildRecordCopyPdf || buildRecordCopyPdf;
  let pdf = null;
  let pdfError = null;
  try {
    const built = await buildPdf({
      accountKey,
      accountLabel,
      weekStart,
      weekEnd,
      finalizedDateISO: finalizedDateISO || null,
      approvedByLabel: approverPhrase.meta,
      invoiceRecords,
    });
    if (built.pretaxCents !== emailPretaxCents) {
      pdfError = `pretax mismatch: email records sum to ${formatCents(emailPretaxCents)} but the record-copy PDF computed ${formatCents(built.pretaxCents)}. Attachment omitted; totals in the email body are the invoice-record totals and are correct.`;
    } else {
      pdf = built;
    }
  } catch (err) {
    pdfError = `record-copy PDF failed: ${err?.message || String(err)}`;
  }

  const testPrefix = isTest ? "[TEST] " : "";
  const subject = `${testPrefix}Sent to billing: ${accountKey}, week of ${fmtWeekTitle(weekStart)}`;
  // Preheader + body always render the emailPretaxCents (sum of the
  // invoice records), never the PDF's own count. That way a PDF
  // failure never changes the numbers the chef reads.
  const preheader = pdf
    ? `${daysServed} of ${daysInWeek} days · ${mealsCount.toLocaleString("en-US")} meals · ${formatCents(emailPretaxCents)} pre-tax. Record copy attached.`
    : `${daysServed} of ${daysInWeek} days · ${mealsCount.toLocaleString("en-US")} meals · ${formatCents(emailPretaxCents)} pre-tax.`;
  const html = emailShell({
    preheader,
    body: n1Body({
      accountKey, weekStart, weekEnd,
      approvedByLede: approverPhrase.lede,
      mealsCount, daysServed, daysInWeek,
      pretaxCents: emailPretaxCents,
      scWeekLink, isTest,
    }),
  });
  const baseSlackText = n1SlackText({ accountKey, weekStart, invoiceRecords, isTest, scWeekLink });
  // Slack carries the PDF failure as an appended line so ops sees it
  // without touching the operator-facing email body.
  const slackText = pdfError
    ? `${baseSlackText}\n:warning: Record copy PDF not attached - ${pdfError}`
    : baseSlackText;

  let emailResult = "not_sent";
  let slackResult = { sent: false, skipped: "not sent (send=false)" };

  if (send) {
    // Email. Presence-check env vars first when running the real
    // sendEmailSA (test-injected senders skip the check by design so
    // unit tests don't need to stub env). A missing env yields
    // 'missing_env:<KEY>' so the operator log tier surfaces WHICH
    // key is absent, not just "failed".
    //
    // 2026-09-16: attachments is empty when pdf is null (degrade path).
    // The email dispatches without a record copy rather than being
    // suppressed.
    const attachments = pdf
      ? [{
          filename: pdf.filename,
          mimeType: "application/pdf",
          base64: pdf.pdfBase64,
        }]
      : [];
    if (recipients.to.length > 0) {
      const injectedSender = deps?.emailSender;
      if (!injectedSender) {
        const envCheck = checkGmailSaEnv();
        if (!envCheck.ok) {
          emailResult = `missing_env:${envCheck.missing}`;
        } else {
          emailResult = await sendEmailSA({
            sender: EMAIL_SENDER,
            displayName: EMAIL_DISPLAY_NAME,
            to: recipients.to,
            subject,
            html,
            attachments,
          });
        }
      } else {
        emailResult = await injectedSender({
          sender: EMAIL_SENDER,
          displayName: EMAIL_DISPLAY_NAME,
          to: recipients.to,
          subject,
          html,
          attachments,
        });
      }
    }

    // Slack. Parallel to fireN2 - posts in both modes when webhook
    // is set. Missing webhook returns {sent:false, skipped:"no webhook"}
    // from sendSlack; not a bug, but a signal Kevin should see.
    const slackWebhook = deps?.slackWebhookUrl || process.env.SLACK_SC_BILLING_WEBHOOK_URL;
    slackResult = await (deps?.sendSlack || sendSlack)({
      webhookUrl: slackWebhook,
      text: slackText,
    });
  }

  return {
    recipients, subject, preheader, html,
    email: { result: emailResult },
    slack: { text: slackText, result: slackResult },
    // pdf is either the built PDF's summary or null (degrade path).
    // pdfError carries the reason so the caller can log at warn tier -
    // absent when the PDF built and the pretax comparison passed.
    pdf: pdf
      ? {
          filename: pdf.filename,
          pretaxCents: pdf.pretaxCents,
          lineCount: pdf.lineCount,
          byteLength: pdf.pdfBuffer.length,
        }
      : null,
    pdfError,
    approvers: approverPhrase.approvers,
  };
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

// ═══════════════════════════════════════════════════════════════════
// fireNoOpAlert - operator resubmitted a week that already has a
// live invoice on file. 2026-09-23, after the TXR-AZ 2026-09-14
// silent-lie incident.
// ═══════════════════════════════════════════════════════════════════
//
// Fires when `postInvoiceDraft` returns `wasNoOp: true` on the
// idempotency short-circuit at qboAdapter.js:491. Nothing was sent;
// the ledger already holds a `created` row for this (account, week,
// slot). Under FIX 1 (Kevin ruling 2026-09-23):
//   - The operator does NOT get an N1 email. Nothing was sent, and
//     the operator is not authorized to fix a no-op.
//   - Kevin alone gets both an email and a Slack post naming what
//     resubmitted, what existed, and what the next action is.
//   - Sebastian is NOT looped in - the invoice he already knows
//     about still stands, so nothing has changed on his side. Kevin
//     triages and pulls him in only if the existing amount is stale.
//
// Copy content per Kevin's D4 ruling. Subject uses a hyphen not an
// em-dash (docs/GOTCHAS.md: some mail clients render em-dashes in
// subjects as `=?UTF-8?...` garbage). Body may use em-dashes freely.
function noOpAlertBody({ accountKey, weekStart, weekEnd, submitterEmail, priorInvoices, finalizedAt }) {
  const rows = priorInvoices.map((inv) => `
    <tr>
      <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px">Slot</td>
      <td style="padding:4px 0;color:#0F172A;font-size:13px;font-weight:600">${escapeHtml(inv.invoice_slot || inv.invoiceSlot || "-")}</td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px">Existing DocNumber</td>
      <td style="padding:4px 0;color:#0F172A;font-size:13px;font-weight:600">${escapeHtml(inv.qbo_doc_number || inv.qboDocNumber || "(none)")}</td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px">QBO Invoice ID</td>
      <td style="padding:4px 0;color:#0F172A;font-size:13px;font-weight:600">${escapeHtml(inv.qbo_invoice_id || inv.qboInvoiceId || "(none)")}</td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0;color:#64748B;font-size:13px">Ledger Row</td>
      <td style="padding:4px 0;color:#0F172A;font-size:13px;font-family:monospace">${escapeHtml(inv.ledger_row_id || inv.ledgerRowId || "(none)")}</td>
    </tr>
  `).join("");
  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#8A5A16;background:#FDF3E6;border-bottom:1px solid #F0D9B5;padding:7px 20px;display:block">Idempotency short-circuit</td></tr>
  <tr><td style="padding:12px 20px 8px 20px;font-size:17px;line-height:1.35;font-weight:bold;color:#0F172A">Operator resubmitted a week that already has an invoice on file</td></tr>
  <tr><td style="padding:0 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    <strong>${escapeHtml(submitterEmail || "(unknown submitter)")}</strong> pressed finalize on <strong>${escapeHtml(accountKey)}</strong> week ${escapeHtml(fmtWeekRange(weekStart, weekEnd))}${finalizedAt ? ` at ${escapeHtml(finalizedAt)}` : ""}. The adapter's idempotency check found an existing ledger row for the same (account, week, slot) and did not send a new invoice. QuickBooks was not touched.
  </td></tr>
  <tr><td style="padding:0 20px 15px 20px">
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#F8FAFC;border-radius:6px;padding:8px 12px">
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    <strong>Action required:</strong> verify the existing invoice in QuickBooks matches the intended amount for this week. If it does not, supersede the ledger row in Studio and revert the week — the operator will re-finalize.
  </td></tr>
  <tr><td style="padding:0 20px 14px 20px;font-size:12px;line-height:1.55;color:#94A3B8">
    The operator was NOT told the finalize succeeded — the confirm screen showed an amber banner naming the dead end. No follow-up from them is expected.
  </td></tr>
</table>`;
}

function noOpAlertSlackText({ accountKey, weekStart, submitterEmail, priorInvoices }) {
  const kfList = priorInvoices
    .map(inv => inv.qbo_doc_number || inv.qboDocNumber || "(no KF)")
    .join(", ");
  const idList = priorInvoices
    .map(inv => inv.qbo_invoice_id || inv.qboInvoiceId || "(no id)")
    .join(", ");
  return [
    `*[SC no-op]* ${accountKey} · week of ${fmtWeekTitle(weekStart)}`,
    `> submitter: ${submitterEmail || "(unknown)"}`,
    `> existing DocNumber: ${kfList}`,
    `> QBO invoice id: ${idList}`,
    `> action: verify amount in QuickBooks. If stale, supersede the ledger row + revert; the operator will re-finalize.`,
  ].join("\n");
}

/**
 * Fire the no-op alert. Email + Slack, Kevin only.
 *
 * @param {Object} args
 * @param {string} args.accountKey
 * @param {string} args.weekStart      ISO Monday (pair start for biweekly)
 * @param {string} args.weekEnd        ISO closing Sunday
 * @param {string} [args.submitterEmail]  Who pressed finalize
 * @param {string} [args.finalizedAt]     ISO string for the finalize timestamp
 * @param {Array<{invoice_slot, qbo_doc_number, qbo_invoice_id, ledger_row_id}>} args.priorInvoices
 * @param {boolean} [args.send=true]   Set false in tests to render only
 * @param {Object}  [args.deps]        { emailSender, sendSlack, slackWebhookUrl } for injection
 * @returns {{ recipients, subject, preheader, html, slack, email }}
 */
export async function fireNoOpAlert(args) {
  const {
    accountKey, weekStart, weekEnd, submitterEmail, finalizedAt,
    priorInvoices = [], send = true, deps,
  } = args;
  const kfLabel = priorInvoices.length > 0
    ? priorInvoices.map(i => i.qbo_doc_number || i.qboDocNumber || "(no KF)").join(", ")
    : "(no KF on file)";
  // D4 ruling: subject uses hyphen not em-dash. docs/GOTCHAS.md
  // "Em-dashes in email subjects break encoding" - some clients
  // render `=?UTF-8?...` garbage.
  const subject = `[SC no-op] ${accountKey} week of ${fmtWeekTitle(weekStart)} - operator resubmitted; existing invoice ${kfLabel} on file`;
  const preheader = `Operator ${submitterEmail || "(unknown)"} pressed finalize but the adapter short-circuited. Verify existing invoice in QBO.`;
  const html = emailShell({
    preheader,
    body: noOpAlertBody({ accountKey, weekStart, weekEnd, submitterEmail, priorInvoices, finalizedAt }),
  });
  const slackText = noOpAlertSlackText({ accountKey, weekStart, submitterEmail, priorInvoices });

  // Kevin-only recipients. Sebastian is NOT included: the invoice he
  // already knows about still stands, and Kevin triages before
  // looping him in.
  const recipients = { to: [KEVIN_EMAIL], cc: [] };

  let emailResult = "not_sent";
  let slackResult = { sent: false, skipped: "not sent (send=false)" };
  if (send) {
    const sender = deps?.emailSender || sendEmailSA;
    emailResult = await sender({
      sender: EMAIL_SENDER,
      displayName: EMAIL_DISPLAY_NAME,
      to: recipients.to,
      subject,
      html,
    });
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
  const subject = `${testPrefix}Sent to billing: ${accountKey} ${weekStart}..${weekEnd}`;

  // Derive n1Body inputs from invoiceRecords - legacy render path has
  // no reviewRows / accountLabel / PDF, so approvedByLede falls back
  // to a submitter-only sentence. Sufficient for the legacy dry-run
  // callers that only need HTML rendering.
  const allLines = [];
  for (const r of invoiceRecords || []) for (const li of r.lineItems || []) allLines.push(li);
  const pretaxCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);
  const mealsCount = allLines.reduce((s, li) => s + (Number(li.qty) || 0), 0);
  const uniqueDates = new Set(allLines.map((li) => li.serviceDate).filter(Boolean));
  const daysServed = uniqueDates.size;
  const submitterName = submitterEmail || "The site leader";
  const approvedByLede = `${submitterName} approved every day and sent ${accountKey} to billing.`;

  const html = emailShell({
    preheader: `${daysServed} of 7 days · ${mealsCount.toLocaleString("en-US")} meals · ${formatCents(pretaxCents)} pre-tax.`,
    body: n1Body({
      accountKey, weekStart, weekEnd,
      approvedByLede, mealsCount, daysServed, daysInWeek: 7,
      pretaxCents, scWeekLink, isTest,
    }),
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
