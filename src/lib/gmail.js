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
    const recipients = [AP_EMAIL];
    if (data.ccSelf) recipients.push(senderEmail);

    // Build MIME message
    let rawMessage;

    if (data.pdfBase64 && data.pdfFilename) {
      // ── Attach stamped PDF ──
      rawMessage = buildMimeWithAttachment({
        from: senderEmail,
        to: recipients,
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
        to: recipients,
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
        to: recipients,
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

function buildMimeSimple({ from, to, subject, html }) {
  const toStr = Array.isArray(to) ? to.join(", ") : to;

  const message = [
    `From: ${from}`,
    `To: ${toStr}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

function buildMimeWithAttachment({ from, to, subject, html, attachmentBase64, attachmentFilename, attachmentMimeType }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const toStr = Array.isArray(to) ? to.join(", ") : to;

  const message = [
    `From: ${from}`,
    `To: ${toStr}`,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
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