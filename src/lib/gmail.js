/**
 * GMAIL HELPER — Invoice Email Sender
 *
 * Sends invoice submission emails via Gmail API using user's OAuth token.
 * Supports PDF attachment (stamped invoice) with image fallback.
 *
 * Install: gmail.js → src/lib/gmail.js
 */

import { google } from "googleapis";

const AP_EMAIL = process.env.INVOICE_AP_EMAIL || "k.fietek@kitchfix.com";
const AP_CC = ["k.fietek@kitchfix.com"];

function getGmailClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

/**
 * Send invoice submission email to AP
 *
 * @param {string} accessToken - User OAuth token (sends as user)
 * @param {string} senderEmail - User's email address
 * @param {Object} data - Invoice metadata
 * @param {string} data.account
 * @param {string} data.vendor
 * @param {string} data.vendorId
 * @param {string} data.invoiceNumber
 * @param {string} data.invoiceDate
 * @param {number} data.totalAmount
 * @param {Array<{code:string, amount:string}>} data.glRows
 * @param {string[]} data.driveUrls
 * @param {number} data.pageCount
 * @param {string} data.formType - "invoice" | "credit" | "cc_receipt"
 * @param {string} [data.pdfBase64] - Stamped PDF as base64 (preferred attachment)
 * @param {string} [data.pdfFilename] - PDF filename
 * @param {string} [data.ccSelf] - CC the submitter
 * @param {string|null} fallbackImageBase64 - First page image (used only if no PDF)
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
export async function sendInvoiceEmail(accessToken, senderEmail, data, fallbackImageBase64 = null) {
  const gmail = getGmailClient(accessToken);

  try {
    const typeLabel = data.formType === "credit" ? "Credit / Return"
      : data.formType === "cc_receipt" ? "CC Receipt"
      : "Vendor Invoice";

    const subject = buildSubject(data);
    const htmlBody = buildEmailHtml(data, typeLabel, senderEmail);
    const toList = [AP_EMAIL];
    const ccList = AP_CC.filter((e) => e !== AP_EMAIL && e !== senderEmail);
        
    // Build MIME message
    let rawMessage;

    if (data.pdfBase64 && data.pdfFilename) {
      // ── Attach stamped PDF ──
      rawMessage = buildMimeWithAttachment({
        from: senderEmail,
        to: toList,
        cc: ccList,
        subject,
        html: htmlBody,
        attachmentBase64: data.pdfBase64,
        attachmentFilename: data.pdfFilename,
        attachmentMimeType: "application/pdf",
      });
    } else if (fallbackImageBase64) {
      // ── Fallback: attach first page image ──
      const raw = fallbackImageBase64.includes(",")
        ? fallbackImageBase64.split(",")[1]
        : fallbackImageBase64;
      const mimeType = fallbackImageBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
      const ext = mimeType === "image/png" ? "png" : "jpg";

      rawMessage = buildMimeWithAttachment({
        from: senderEmail,
        to: toList,
        cc: ccList,
        subject,
        html: htmlBody,
        attachmentBase64: raw,
        attachmentFilename: `invoice_page1.${ext}`,
        attachmentMimeType: mimeType,
      });
    } else {
      // ── No attachment ──
      rawMessage = buildMimeSimple({
        from: senderEmail,
        to: toList,
        cc: ccList,
        subject,
        html: htmlBody,
      });
    }

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawMessage,
      },
    });

    return { success: true, messageId: result.data.id };
  } catch (error) {
    console.error("[Gmail] Send failed:", error.message);
    return { success: false, error: error.message };
  }
}

// ── Subject Line ──
function buildSubject(data) {
  const parts = ["[KitchFix]"];
  if (data.formType === "credit") parts.push("CREDIT");
  if (data.formType === "cc_receipt") parts.push("CC RECEIPT");
  parts.push(data.account);
  parts.push(data.vendor);
  if (data.invoiceNumber) parts.push(`#${data.invoiceNumber}`);
  parts.push(`$${Number(data.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  return parts.join(" | ");
}

// ── HTML Email Body ──
function buildEmailHtml(data, typeLabel, submitter) {
  const formattedTotal = `$${Number(data.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const formattedDate = formatDate(data.invoiceDate);

  const accentColor = data.formType === "credit" ? "#6366f1"
    : data.formType === "cc_receipt" ? "#0ea5e9"
    : "#d97706";

  // GL rows table
  let glRowsHtml = "";
  let glTotal = 0;
  for (const row of data.glRows || []) {
    const amount = Number(row.amount) || 0;
    glTotal += amount;
    glRowsHtml += `
      <tr>
        <td style="padding:6px 12px;font-family:monospace;font-weight:700;color:#0f3057;border-bottom:1px solid #f1f5f9;">${row.code}</td>
        <td style="padding:6px 12px;color:#475569;border-bottom:1px solid #f1f5f9;">${row.name || row.code}</td>
        <td style="padding:6px 12px;text-align:right;font-weight:700;color:#0f3057;border-bottom:1px solid #f1f5f9;">$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      </tr>`;
  }

  // Drive links
  let driveLinksHtml = "";
  if (data.driveUrls && data.driveUrls.length > 0) {
    const links = data.driveUrls.map((url, i) => `<a href="${url}" style="color:${accentColor};">View in Drive${data.driveUrls.length > 1 ? ` (${i + 1})` : ""}</a>`).join(" &nbsp;|&nbsp; ");
    driveLinksHtml = `<p style="margin:12px 0 0;">${links}</p>`;
  }

  return `
    <div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;">
      <!-- Header Bar -->
      <div style="background:#0f3057;padding:16px 24px;border-radius:12px 12px 0 0;">
        <span style="color:#fff;font-size:14px;font-weight:700;letter-spacing:0.5px;">KITCHFIX OPS HUB</span>
        <span style="float:right;color:${accentColor};font-size:12px;font-weight:700;">${typeLabel.toUpperCase()}</span>
      </div>

      <!-- Body -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <h2 style="margin:0 0 4px;color:#0f3057;font-size:18px;">${data.vendor}</h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:13px;">
          ${data.account} · ${formattedDate}${data.invoiceNumber ? ` · #${data.invoiceNumber}` : ""} · <strong style="color:#0f3057;">${formattedTotal}</strong>
        </p>

        <!-- GL Breakdown -->
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:700;">GL Code</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:700;">Description</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;font-weight:700;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${glRowsHtml}
            <tr style="background:#f8fafc;">
              <td colspan="2" style="padding:8px 12px;font-weight:700;color:#64748b;font-size:12px;">TOTAL</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700;color:#0f3057;font-size:14px;">$${glTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        ${driveLinksHtml}

        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">
          Submitted by ${submitter} · ${data.pageCount} page${data.pageCount > 1 ? "s" : ""} · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>
    </div>`;
}

// ── MIME Message Builders ──

// RFC 2047 encode subject for non-ASCII safety
function encodeSubject(subject) {
  // If pure ASCII, no encoding needed
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  // Base64-encode the UTF-8 bytes
  const encoded = Buffer.from(subject, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function buildMimeSimple({ from, to, cc, subject, html }) {
  const toStr = Array.isArray(to) ? to.join(", ") : to;

  const headers = [
    `From: ${from}`,
    `To: ${toStr}`,
  ];
  if (cc && cc.length > 0) {
    headers.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
  }
  headers.push(
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
  );

  const message = [...headers, ``, html].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

function buildMimeWithAttachment({ from, to, cc, subject, html, attachmentBase64, attachmentFilename, attachmentMimeType }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const toStr = Array.isArray(to) ? to.join(", ") : to;

  const headers = [
    `From: ${from}`,
    `To: ${toStr}`,
  ];
  if (cc && cc.length > 0) {
    headers.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
  }
  headers.push(
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  );

  const message = [
    ...headers,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    `--${boundary}`,
    `Content-Type: ${attachmentMimeType}; name="${attachmentFilename}"`,
    `Content-Disposition: attachment; filename="${attachmentFilename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    // Break base64 into 76-char lines (RFC 2045)
    chunkString(attachmentBase64, 76),
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

// Break a string into lines of maxLen characters
function chunkString(str, maxLen) {
  const lines = [];
  for (let i = 0; i < str.length; i += maxLen) {
    lines.push(str.slice(i, i + maxLen));
  }
  return lines.join("\r\n");
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ═══════════════════════════════════════
// REJECTION NOTIFICATION EMAIL
// ═══════════════════════════════════════

/**
 * Send rejection notification email to the original invoice submitter.
 * Sent FROM the AP reviewer TO the operator.
 *
 * @param {string} accessToken - AP reviewer's OAuth token
 * @param {string} senderEmail - AP reviewer's email
 * @param {string} recipientEmail - Original submitter's email
 * @param {Object} data - Rejection details
 */
export async function sendRejectionEmail(accessToken, senderEmail, recipientEmail, data) {
  const gmail = getGmailClient(accessToken);

  try {
    const totalFmt = `$${Number(data.totalAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const reasonList = (data.reasons || []).length > 0 ? data.reasons.join(", ") : "See note below";

    const subject = `[KitchFix] Invoice Returned - ${data.vendor} #${data.invoiceNumber || "N/A"} ${data.account}`;

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #0f3057;">
  <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px; padding: 16px; margin-bottom: 16px;">
    <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 4px;">Invoice Returned - Action Required</div>
    <div style="font-size: 12px; color: #b91c1c;">An invoice you submitted has been returned by AP and needs to be corrected.</div>
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
    <tr><td style="padding: 6px 0; color: #64748b; font-weight: 600; width: 100px;">Vendor</td><td style="padding: 6px 0; font-weight: 700;">${data.vendor}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b; font-weight: 600;">Invoice #</td><td style="padding: 6px 0;">${data.invoiceNumber || "N/A"}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b; font-weight: 600;">Account</td><td style="padding: 6px 0;">${data.account}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b; font-weight: 600;">Total</td><td style="padding: 6px 0; font-weight: 700;">${totalFmt}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b; font-weight: 600;">Issue</td><td style="padding: 6px 0; color: #dc2626; font-weight: 600;">${reasonList}</td></tr>
  </table>
  <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
    <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a3412; margin-bottom: 4px;">Note from AP</div>
    <div style="font-size: 13px; color: #0f3057; font-weight: 500;">${data.note}</div>
  </div>
  <div style="font-size: 12px; color: #64748b;">
    <a href="https://kitchfix-intranet.vercel.app/ops" style="color: #d97706; font-weight: 700; text-decoration: none;">Open Invoice Capture</a> to fix and resubmit this invoice.
  </div>
  <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
    Returned by ${data.rejectedBy?.split("@")[0] || "AP"} - KitchFix Ops Hub
  </div>
</div>`;

    const ccList = AP_CC.filter((e) => e !== recipientEmail && e !== senderEmail);

    const rawMessage = buildMimeSimple({
      from: senderEmail,
      to: [recipientEmail],
      cc: ccList,
      subject,
      html,
    });

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: rawMessage },
    });

    console.log(`[Gmail] Rejection notification sent to ${recipientEmail}, messageId: ${result.data.id}`);
    return { success: true, messageId: result.data.id };
  } catch (error) {
    console.error("[Gmail] Rejection email failed:", error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────
// SA-IMPERSONATED GMAIL (system notifications)
// Different auth model from the user-OAuth helpers above. The service
// account uses domain-wide delegation to send AS the `sender` mailbox
// (subject of the JWT). The recipient sees `From: <displayName> <sender>`.
// Used for system emails: PAF/new-hire notifications, incident alerts,
// 7-day check-in reminders. Requires the SA to be on the Workspace
// admin's domain-wide-delegation list for the `gmail.send` scope.
// ─────────────────────────────────────────────

// Byte-exact port of the subject encoder that lived in people/route.js's
// sendEmail (PR A2b). Intentionally distinct from gmail.js's existing
// `encodeSubject` above: that one uses a stricter "printable ASCII only"
// test (0x20-0x7E), which would encode control chars; this one matches
// the original sendEmail's looser "any non-ASCII" test (> 0x7F), which
// passes control chars through unencoded.
//
// Equivalence proof for the base64 step:
//   btoa(unescape(encodeURIComponent(s)))      // original, Web idiom
//   === Buffer.from(s, "utf-8").toString("base64")  // Node-native idiom
// Both produce base64 (with padding) of the UTF-8 byte representation of `s`.
//
// Follow-up cleanup tracked in BUSINESS_NOTES: unify with encodeSubject once
// the invoice-email path can absorb the stricter-test behavior change.
function encodeSubjectSA(subject) {
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  const encoded = Buffer.from(subject, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * Send a system email via service-account-impersonated Gmail.
 *
 * Faithful port of the MIME logic that previously lived in
 * `src/app/api/people/route.js` sendEmail (RFC 2047 subject encoding,
 * multipart/alternative + base64-encoded HTML body, optional Reply-To).
 * Returns "sent" | "failed" string (NOT object) to match the legacy
 * contract that incidentActions.js relies on via the sendEmail-by-reference
 * pattern.
 *
 * Added in PR A2b (Bundle 3) - canonicalizes the SA-impersonated Gmail
 * pattern that previously had two separate implementations in
 * people/route.js (hand-rolled crypto.subtle JWT + raw fetch) and
 * cron/incident-reminders (google.auth.JWT + googleapis client).
 *
 * @param {Object} args
 * @param {string} args.sender - impersonated mailbox (e.g. "support@kitchfix.com"). Must be on the SA's domain-wide-delegation list.
 * @param {string} args.displayName - From header display name (e.g. "KitchFix People Ops")
 * @param {string|string[]} args.to - recipient(s)
 * @param {string} args.subject - subject (auto-RFC-2047-encoded for non-ASCII via encodeSubjectSA)
 * @param {string} args.html - HTML body (base64-encoded inside multipart/alternative)
 * @param {string} [args.replyTo] - optional Reply-To header
 * @returns {Promise<"sent"|"failed">}
 */
export async function sendEmailSA({ sender, displayName, to, subject, html, replyTo }) {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      subject: sender,
    });
    const gmail = google.gmail({ version: "v1", auth });

    const recipients = Array.isArray(to) ? to : [to];
    const boundary = "boundary_" + Date.now();
    const htmlBody = Buffer.from(html).toString("base64");

    const mimeLines = [
      `From: ${displayName} <${sender}>`,
      `To: ${recipients.join(", ")}`,
      `Subject: ${encodeSubjectSA(subject)}`,
      ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlBody,
      `--${boundary}--`,
    ];
    const rawMessage = mimeLines.join("\r\n");
    const raw = Buffer.from(rawMessage).toString("base64url");

    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    console.log(`[Gmail SA] Email sent to ${recipients.join(", ")}: ${subject}`);
    return "sent";
  } catch (e) {
    console.error("[Gmail SA] Send failed:", e.message);
    return "failed";
  }
}