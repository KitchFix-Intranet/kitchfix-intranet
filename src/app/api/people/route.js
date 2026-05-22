import { NextResponse } from "next/server";
import {
  INCIDENT_COLUMNS,
  INCIDENTS_TAB,
  INCIDENT_TYPES,
  STATUS_FLOW,
  REGIONAL_DIRECTORS,
  rowToIncident,
  incidentToRow,
} from "@/lib/incidentSchema";
import {
  generateIncidentId,
  ensureIncidentFolder,
  uploadIncidentFile,
  notifyIncident,
  notifyStatusChange,
  computeIncidentDeadlines,
  computeEmployeeCheckInDue,
  createIncident30DayEvent,
  buildIncidentPdf,
} from "@/lib/incidentActions";
import { readSheetSA, appendRowSA, updateRangeSA, updateCellByRowColSA, clearRangeSA, getServiceAccountSheetsClient, SHEET_IDS } from "@/lib/sheets";

// ═══════════════════════════════════════
// PEOPLE PORTAL API
// Uses Google Service Account for Sheets + Gmail access
// ═══════════════════════════════════════

// Allow longer execution for incident submissions that include
// multiple file uploads to Drive (default 10s, bumping to 60s).
// Note: Vercel's body size limit is platform-level (~4.5MB) and cannot
// be raised here — large uploads are handled by the chunking strategy
// described in the incident submission handler.
export const maxDuration = 60;

const SHEETS = {
  HERO: "hero_images",
  ACCOUNTS: "accounts",
  CONTACTS: "contacts",
  ADMINS: "admins",
  NOTIFICATIONS: "notifications",
  SUBMISSIONS: "submissions",
  DRAFTS: "drafts",
  NOTIFICATION_LOG: "notification_log",
  INCIDENTS: INCIDENTS_TAB,
  LIBRARY_MANIFEST: "library_manifest",
};

// Named column indices for submissions sheet (1-indexed for Sheets API)
const SUB = {
  TIMESTAMP: 0,    // Col A (0-indexed for row arrays)
  SUBMITTER: 1,    // Col B
  MODULE: 2,       // Col C
  EMPLOYEE: 3,     // Col D
  LOCATION: 4,     // Col E
  ACTION_TYPE: 5,  // Col F
  EFFECTIVE: 6,    // Col G
  PAYLOAD: 7,      // Col H
  STATUS: 8,       // Col I
  NOTES: 9,        // Col J
  // 1-indexed versions for updateCell API
STATUS_COL: 9,   // Column I (1-indexed)
  NOTES_COL: 10,   // Column J (1-indexed)
  ADMIN_ACTION_COL: 11, // Column K (1-indexed)
};

// Gmail API: send as support@kitchfix.com via domain-wide delegation
const GMAIL_SENDER = "support@kitchfix.com";
const GMAIL_SENDER_NAME = "KitchFix People Ops";

// ═══════════════════════════════════════
// Auth: Service Account → Access Token
// ═══════════════════════════════════════
async function getAccessToken() {
  return getServiceToken("https://www.googleapis.com/auth/spreadsheets");
}

async function getGmailToken() {
  return getServiceToken("https://www.googleapis.com/auth/gmail.send", GMAIL_SENDER);
}

// Shared JWT flow — optional `sub` for domain-wide delegation (impersonation)
async function getServiceToken(scope, sub) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !keyRaw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in .env.local");
  }

  const privateKey = keyRaw.replace(/\\n/g, "\n");
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (sub) claims.sub = sub; // impersonate this user
  const claimSet = btoa(JSON.stringify(claims));
  const unsignedJwt = `${header}.${claimSet}`;
  const cryptoKey = await importPrivateKey(privateKey);
  const signature = await signJwt(unsignedJwt, cryptoKey);
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Token exchange failed (${scope}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signJwt(input, key) {
  const encoded = new TextEncoder().encode(input);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoded);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ═══════════════════════════════════════
// NOTIFICATION ENGINE
// ═══════════════════════════════════════

// Read notification recipients from the notifications sheet
// Sheet format: [actionKey, enabled1, email1, enabled2, email2, enabled3, email3, enabled4, email4]
async function getNotificationRecipients(actionKey) {
  try {
    const { rows } = await readSheetSA(SHEET_IDS.HUB, SHEETS.NOTIFICATIONS);
    const searchKey = String(actionKey).trim().toLowerCase().replace(/\s+/g, "_");
    const recipients = [];

    for (const row of rows) {
      const rowKey = String(row[0] || "").trim().toLowerCase().replace(/\s+/g, "_");
      if (rowKey === searchKey) {
        // Up to 4 toggle/email pairs: cols [1,2], [3,4], [5,6], [7,8]
        for (let i = 0; i < 4; i++) {
          const enabled = String(row[1 + i * 2] || "").trim().toUpperCase();
          const emails = String(row[2 + i * 2] || "");
          if (enabled === "TRUE" || enabled === "1") {
            emails.split(/[,;]+/).forEach((e) => {
              const trimmed = e.trim();
              if (trimmed.includes("@")) recipients.push(trimmed);
            });
          }
        }
        break;
      }
    }
    return recipients;
  } catch (e) {
    console.error("[Notifications] Failed to get recipients:", e.message);
    return [];
  }
}

// Send email via Gmail API — returns "sent" or "failed"
async function sendEmail(to, subject, html, replyTo) {
  try {
    const token = await getGmailToken();
    const recipients = Array.isArray(to) ? to : [to];

    // MIME-encode Subject if it contains non-ASCII (emoji, accented chars, etc.)
    // Without this, Gmail/Outlook fall back to Latin-1 interpretation and the
    // subject renders as mojibake (e.g. 🚨 becomes "Ã°ÂŸÂ¨").
    // Per RFC 2047: =?UTF-8?B?<base64>?= for non-ASCII.
    const hasNonAscii = /[^\x00-\x7F]/.test(subject);
    const subjectHeader = hasNonAscii
      ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`
      : subject;

    // Build RFC 2822 MIME message
    const boundary = "boundary_" + Date.now();
    const mimeLines = [
      `From: ${GMAIL_SENDER_NAME} <${GMAIL_SENDER}>`,
      `To: ${recipients.join(", ")}`,
      `Subject: ${subjectHeader}`,
      ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      btoa(unescape(encodeURIComponent(html))),
      `--${boundary}--`,
    ];
    const rawMessage = mimeLines.join("\r\n");

    // Gmail API requires URL-safe base64
    const encoded = btoa(unescape(encodeURIComponent(rawMessage)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${GMAIL_SENDER}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("[Notifications] Gmail API error:", res.status, err);
      return "failed";
    }

    console.log(`[Notifications] Email sent to ${recipients.join(", ")}: ${subject}`);
    return "sent";
  } catch (e) {
    console.error("[Notifications] Send failed:", e.message);
    return "failed";
  }
}

// ─── Email Templates ───
const EmailTemplates = {
  row(label, value) {
    if (!value && value !== 0) return "";
    return `<tr><td style="padding:8px 0;color:#64748b;font-size:12px;font-weight:bold;width:140px;vertical-align:top;">${label.toUpperCase()}</td><td style="padding:8px 0;color:#0f3057;font-weight:bold;border-bottom:1px solid #f1f5f9;">${value}</td></tr>`;
  },

  money(val) {
    if (val === "" || val == null || isNaN(val)) return "-";
    return "$" + parseFloat(val).toFixed(2);
  },

  wrapper(content, buttonUrl, buttonLabel, buttonColor) {
    const appUrl = process.env.AUTH_URL || "http://localhost:3000";
    const url = buttonUrl || `${appUrl}/people`;
    const label = buttonLabel || "View Portal";
    const color = buttonColor || "#2563eb";

    return `<div style="background-color:#f4f7f6;padding:40px 0;font-family:sans-serif;color:#0f3057;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.05);">
    <div style="background:#0f3057;padding:20px 40px;text-align:center;">
      <span style="color:#ffffff;font-weight:800;letter-spacing:1px;font-size:18px;">KITCHFIX PEOPLE OPS</span>
    </div>
    <div style="padding:40px;">
      ${content}
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="font-size:11px;font-weight:bold;color:#94a3b8;text-transform:uppercase;margin-bottom:16px;">Quick Actions</p>
        <div style="display:flex;justify-content:center;">
          <a href="${url}" style="background:${color};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;display:inline-block;">${label}</a>
        </div>
      </div>
    </div>
  </div>
</div>`;
  },

  // ─── New Hire Template ───
  newHire(data) {
    const tools = [];
    if (data.needsCard === "Yes") tools.push("Company Card");
    if (data.needsLaptop === "Yes") tools.push("Laptop");
    if (data.needsEmail === "Yes") tools.push("Email");
    if (data.needsCell === "Yes") tools.push("Cell Reimbursement");
    const toolsStr = tools.length > 0 ? tools.join(", ") : "Standard Access";
    const statusLabel = data.isRehire === "Yes" ? "Rehire (Returning)" : "New Hire";
    const prefix = data._isResubmit ? "[RESUBMITTED]" : "[NEW HIRE]";

    const subject = `${prefix} ${data.firstName} ${data.lastName} - ${data.operation}`;
    const body = `
      <h2 style="color:#0f3057;margin-top:0;">New Teammate Incoming!</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${this.row("Type", statusLabel)}
        ${this.row("Candidate", `${data.firstName} ${data.lastName}`)}
        ${this.row("Role", data.jobTitle)}
        ${this.row("Location", data.operation)}
        ${this.row("Start Date", data.startDate)}
        ${this.row("Compensation", `$${data.payRate} (${data.payType})`)}
        ${this.row("Equipment", toolsStr)}
      </table>`;
    return { subject, body };
  },

  // ─── Status Update Template (Approve/Reject) ───
  statusUpdate(data) {
    const color = data.status === "Rejected" ? "#dc2626" : "#16a34a";
    const statusText = data.status === "Rejected" ? "Action Required" : "Approved";
    const subject = `[${statusText.toUpperCase()}] ${data.actionType} - ${data.employeeName}`;
    const body = `
      <h2 style="color:${color};margin-top:0;">Request ${data.status}</h2>
      <p style="color:#0f3057;font-size:16px;">
        The request for <strong>${data.employeeName}</strong> has been marked as <strong>${data.status}</strong>.
      </p>
      <div style="background:#f8fafc;padding:15px;border-left:4px solid ${color};margin:20px 0;">
        <div style="font-size:11px;font-weight:bold;color:#64748b;margin-bottom:4px;">ADMIN NOTES</div>
        <div style="color:#0f3057;">${data.adminNotes || "No specific notes provided."}</div>
      </div>
      <p style="font-size:14px;color:#64748b;">
        ${data.status === "Rejected" ? "Please log in to the Action Center to review and resubmit." : "No further action is required."}
      </p>`;
    return { subject, body };
  },

  // ─── Help Request Template ───
  helpRequest(data) {
    const subject = `[HELP] Request from ${data.submitterEmail}`;
    const body = `
      <h2 style="color:#0f3057;">Help Request</h2>
      <p><strong>User:</strong> ${data.submitterEmail}</p>
      <div style="background:#f1f5f9;padding:15px;border-left:4px solid #2563eb;">
        ${(data.message || "").replace(/\n/g, "<br>")}
      </div>`;
    return { subject, body };
  },

  // ─── PAF Template (all action types) ───
  paf(actionKey, data) {
    const title = actionKey.replace(/_/g, " ").toUpperCase();
    const loc = data.locationName ? ` (${data.locationName})` : "";
    const prefix = data._isResubmit ? "[RESUBMITTED]" : "[PAF]";
    const subject = `${prefix} ${title} - ${data.employeeName}${loc}`;

    let body = `<h2 style="color:#0f3057;margin-top:0;">Personnel Action: ${title}</h2>
      <table style="width:100%;border-collapse:collapse;">
      ${this.row("Employee", data.employeeName)}
      ${this.row("Effective", data.effectiveDate)}`;

    if (actionKey === "rate_change") {
      body += this.row("Old Rate", this.money(data.oldRate));
      body += this.row("New Rate", this.money(data.newRate));
} else if (actionKey === "separation") {
      body += this.row("Type", data.actionGroup);
      body += this.row("Reason", data.separationReason);
      if (data.lastDayWorked) body += this.row("Last Day Worked", data.lastDayWorked);
      body += this.row("Rehire?", data.rehireEligible);
        } else if (actionKey === "title_change") {
      body += this.row("Old Title", data.oldTitle);
      body += this.row("New Title", data.newTitle);
      if (data.reclassChangeRate === "Yes") body += this.row("New Rate", this.money(data.newRate));
    } else if (actionKey === "reclassification") {
      body += this.row("From", data.reclassFrom);
      body += this.row("To", data.reclassTo);
      if (data.reclassChangeRate === "Yes") body += this.row("New Rate", this.money(data.newRate));
    } else if (actionKey === "status_change") {
      body += this.row("Direction", data.statusChangeDirection);
    } else if (actionKey === "travel_reimbursement") {
      body += this.row("Travel Dates", `${data.travelStartDate} to ${data.travelEndDate}`);
      body += this.row("Total Days", data.travelTotalDays);

      // Fix #21: Detailed per diem breakdown
      const tierLabels = [
        { key: "perDiem_noMeals", label: "No Meals Provided", rate: 80 },
        { key: "perDiem_bkfstProvided", label: "Breakfast Provided", rate: 65 },
        { key: "perDiem_lunchProvided", label: "Lunch Provided", rate: 60 },
        { key: "perDiem_dinnerProvided", label: "Dinner Provided", rate: 45 },
        { key: "perDiem_bkfstLunch", label: "Breakfast & Lunch", rate: 45 },
        { key: "perDiem_bkfstDinner", label: "Breakfast & Dinner", rate: 30 },
        { key: "perDiem_lunchDinner", label: "Lunch & Dinner", rate: 25 },
        { key: "perDiem_allMeals", label: "All Meals Provided", rate: 10 },
      ];
      const perDiemLines = tierLabels
        .filter((t) => parseInt(data[t.key]) > 0)
        .map((t) => `${t.label}: ${data[t.key]} day${parseInt(data[t.key]) !== 1 ? "s" : ""} × $${t.rate} = ${this.money(parseInt(data[t.key]) * t.rate)}`)
        .join("<br>");
      if (perDiemLines) {
        body += `<tr><td style="padding:12px 16px;font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;width:140px;vertical-align:top;">Per Diem</td><td style="padding:12px 16px;font-size:13px;color:#1e293b;">${perDiemLines}</td></tr>`;
      }
      body += this.row("Per Diem Total", this.money(data.perDiemTotal));
      if (parseInt(data.travelSupplementTotal) > 0) {
        body += this.row("Supplement", `${this.money(data.travelSupplementTotal)} (taxable)`);
      }
      body += this.row("Grand Total", `<strong style="font-size:16px;color:#7c3aed;">${this.money(data.travelGrandTotal)}</strong>`);
    } else if (actionKey === "add_cell_phone") {
      body += this.row("Frequency", data.cellFrequency);
    } else if (data.amount) {
      body += this.row("Amount", this.money(data.amount));
    }

    body += `</table>`;

    if (data.uploadUrl) {
      body += `<div style="margin-top:20px;text-align:center;">
        <a href="${data.uploadUrl}" style="background:#e0e7ff;color:#2563eb;padding:10px 20px;text-decoration:none;border-radius:50px;font-weight:bold;font-size:12px;">📷 View Attached Receipt</a>
      </div>`;
    }

    if (data.explanation) {
      body += `<div style="margin-top:20px;background:#f8fafc;padding:15px;border-left:4px solid #2563eb;">
        <div style="font-size:11px;font-weight:bold;color:#64748b;margin-bottom:4px;">NOTES</div>
        <div style="color:#0f3057;">${(data.explanation || "").replace(/\n/g, "<br>")}</div>
      </div>`;
    }

    return { subject, body };
  },
};

// ─── Notification Dispatcher ───
// Log a notification to the notification_log sheet
async function logNotification(recipient, channel, subject, eventType, status, relatedInfo) {
  try {
    await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.NOTIFICATION_LOG, [
      new Date().toISOString(),
      Array.isArray(recipient) ? recipient.join(", ") : recipient,
      channel,
      subject,
      eventType,
      status,
      relatedInfo || "",
    ]);
  } catch (e) {
    console.error("[Notifications] Failed to log:", e.message);
  }
}

// Mirrors OG split pipeline: admin recipients + submitter confirmation
async function notify(actionKey, data) {
  try {
    const appUrl = process.env.AUTH_URL || "http://localhost:3000";
    const adminRecipients = await getNotificationRecipients(actionKey);
    const submitter = data.submitterEmail;
    const employeeName = data.employeeName || data.firstName ? `${data.firstName || ""} ${data.lastName || ""}`.trim() : "Unknown";

    let template;
    if (actionKey === "new_hire") {
      template = EmailTemplates.newHire(data);
    } else if (actionKey === "status_update") {
      template = EmailTemplates.statusUpdate(data);
    } else if (actionKey === "help_request_hr") {
      template = EmailTemplates.helpRequest(data);
    } else {
      template = EmailTemplates.paf(actionKey, data);
    }

    // 1. ADMIN PIPELINE — purple "Reject or Approve" button
    if (adminRecipients.length > 0) {
      const adminHtml = EmailTemplates.wrapper(
        template.body,
        `${appUrl}/people?view=admin`,
        "Reject or Approve",
        "#7c3aed"
      );
      const status = await sendEmail(
        adminRecipients,
        template.subject,
        adminHtml,
        submitter
      );
      await logNotification(adminRecipients, "email", template.subject, actionKey, status, employeeName);
    }

    // 2. SUBMITTER PIPELINE — blue "View Submissions" button
    // Only if submitter exists and isn't already an admin recipient
    if (submitter && !adminRecipients.includes(submitter)) {
      const userHtml = EmailTemplates.wrapper(
        template.body,
        `${appUrl}/people?view=activity`,
        "View Submissions",
        "#2563eb"
      );
      const status = await sendEmail(
        submitter,
        template.subject,
        userHtml
      );
      await logNotification(submitter, "email", template.subject, actionKey, status, employeeName);
    }

    console.log(`[Notifications] Processed: ${actionKey}`);
  } catch (e) {
    console.error("[Notifications] Error:", e.message);
    // Don't throw — notifications should never block the main action
  }
}

// ═══════════════════════════════════════
// GET: Bootstrap data
// ═══════════════════════════════════════
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "bootstrap";
    const userEmail = searchParams.get("email") || "";

if (action === "bootstrap") {
         const [accounts, contacts, admins, submissions, heroImages, drafts] = await Promise.all([
                  readSheetSA(SHEET_IDS.HUB, SHEETS.ACCOUNTS),
        readSheetSA(SHEET_IDS.HUB, SHEETS.CONTACTS),
        readSheetSA(SHEET_IDS.HUB, SHEETS.ADMINS),
        readSheetSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS),
        readSheetSA(SHEET_IDS.HUB, SHEETS.HERO),
        readSheetSA(SHEET_IDS.COLLECTION, SHEETS.DRAFTS),
      ]);

      // Admin = email in admins tab with hr column (C) set to TRUE
      const isAdmin = admins.rows.some(
        (r) =>
          String(r[0]).toLowerCase().trim() === userEmail.toLowerCase() &&
          String(r[2]).toUpperCase() === "TRUE"
      );

      const counts = { paf: 0, newHire: 0, actionRequired: 0, completedTotal: 0 };
      submissions.rows.forEach((row) => {
        if (String(row[SUB.SUBMITTER] || "").toLowerCase().trim() !== userEmail.toLowerCase()) return;
        const module = String(row[SUB.MODULE] || "");
        const status = String(row[SUB.STATUS] || "Pending");
        if (/Rejected|Action/i.test(status)) counts.actionRequired++;
        else if (/Pending/i.test(status)) {
          if (module === "newhire") counts.newHire++;
          else counts.paf++;
        } else if (/Complete|Approved/i.test(status)) {
          counts.completedTotal++;
        }
      });

      let firstName = "Team";
      contacts.rows.forEach((row) => {
        if (
          String(row[3] || "").toLowerCase().trim() === userEmail.toLowerCase() &&
          row[2]
        ) {
          firstName = String(row[2]).split(" ")[0];
        }
      });

      const locations = accounts.rows
        .filter((r) => r[0])
        .map((r) => ({ key: r[0], name: r[1] || r[0] }));
      const managers = contacts.rows
        .filter((r) => r[2])
        .map((r) => ({ teamKey: r[0], name: r[2] }));

      const heroUrls = heroImages.rows
        .flat()
        .filter((u) => u && String(u).includes("http"));
      const heroImage = heroUrls.length
        ? heroUrls[Math.floor(Math.random() * heroUrls.length)]
        : "";

      const pafConfig = {
        actionTypes: [
          { key: "separation", label: "Separation", category: "HR Actions" },
          { key: "title_change", label: "Change in Title", category: "HR Actions" },
          { key: "status_change", label: "Change Part-Time/Full-Time", category: "HR Actions" },
          { key: "reclassification", label: "Reclassification (Dept Change)", category: "HR Actions" },
          { key: "rate_change", label: "Change in Rate of Pay", category: "Payroll" },
          { key: "add_bonus", label: "Add One-Time Bonus", category: "Payroll" },
          { key: "add_deduction", label: "Add One-Time Deduction", category: "Payroll" },
          { key: "add_gratuity", label: "Add Gratuity", category: "Payroll" },
          { key: "add_cell_phone", label: "Cell Phone Reimbursement", category: "Expenses" },
          { key: "travel_reimbursement", label: "Travel Reimbursement", category: "Expenses" },
          { key: "other_reimbursement", label: "Other Reimbursement", category: "Expenses" },
        ],
        travelRates: {
          supplementRate: 50,
          perDiemRates: {
            noMeals: 80,
            breakfastOnly: 65,
            lunchOnly: 60,
            dinnerOnly: 45,
            breakfastLunch: 45,
            breakfastDinner: 30,
            lunchDinner: 25,
            allMeals: 10,
          },
        },
      };

// Check for server-side drafts for this user
      const userDrafts = {};
      drafts.rows.forEach((r) => {
        if (String(r[0] || "").toLowerCase().trim() === userEmail.toLowerCase() && r[3]) {
          userDrafts[String(r[1])] = r[3]; // key: "nh" or "paf", value: JSON string
        }
      });

      // ─── W8: Surface Appendix C (Refusal of Medical Treatment) URL ───
      // Read the library_manifest tab and look for the Appendix C entry by
      // title. If found, expose its Drive viewer URL so the wizard can
      // turn the "Appendix C required" callouts into clickable links.
      // Fails silently — wizard falls back to a Library tab link if no URL.
      let appendixCUrl = null;
      try {
        const libResult = await readSheetSA(SHEET_IDS.HUB, SHEETS.LIBRARY_MANIFEST);
        const libRows = libResult?.rows || [];
        const match = libRows.find((row) => {
          const title = String(row[2] || "").toLowerCase();
          const active = String(row[9] || "").trim().toUpperCase() !== "FALSE";
          const fileId = String(row[0] || "").trim();
          return active && fileId && (
            title.includes("appendix c") ||
            title.includes("refusal of medical")
          );
        });
        if (match) {
          appendixCUrl = `https://drive.google.com/file/d/${String(match[0]).trim()}/view`;
        }
      } catch (e) {
        // Manifest tab missing or unreadable — wizard handles fallback gracefully
        console.log("[Bootstrap] Appendix C lookup skipped:", e.message);
      }

      return NextResponse.json({
        success: true,
        userEmail,
        firstName,
        heroImage,
        locations,
        managers,
        pafConfig,
        counts,
        isAdmin,
        drafts: userDrafts,
        appendixCUrl,
      });
    }

    if (action === "history") {
      const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS);

      const history = [];

      rows.forEach((row, i) => {
        if (String(row[SUB.SUBMITTER] || "").toLowerCase().trim() !== userEmail.toLowerCase()) return;
        const module = String(row[SUB.MODULE] || "paf");
        const employeeName = String(row[SUB.EMPLOYEE] || "");
        const actionType = String(row[SUB.ACTION_TYPE] || "");
        const status = String(row[SUB.STATUS] || "Pending");
        const notes = String(row[SUB.NOTES] || "");
        const payload = row[SUB.PAYLOAD] && String(row[SUB.PAYLOAD]).startsWith("{") ? row[SUB.PAYLOAD] : "{}";

        // Build subtitle from action type or module
        let subtitle = actionType;
        if (module === "newhire") subtitle = "New Hire Onboarding";

        history.push({
          id: "sub-" + (i + 2),
          rowIndex: i + 2,
          module,
          date: row[SUB.TIMESTAMP] ? new Date(row[SUB.TIMESTAMP]).toISOString() : new Date().toISOString(),
          title: employeeName || "Request",
          subtitle,
          status,
          notes,
          payload,
        });
      });

      // ─── Append user's incidents (Bucket A4: own submissions only) ───
      try {
        let { rows: incRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
        if (!incRows) incRows = [];
        incRows.forEach((r) => {
          const inc = rowToIncident(r);
          if (!inc.incident_id) return;
          if (String(inc.submitted_by_email || "").toLowerCase() !== userEmail.toLowerCase()) return;

          const typeMeta = INCIDENT_TYPES.find((t) => t.id === inc.incident_type);
          const typeLabel = typeMeta?.label || inc.incident_type;

          history.push({
            id: `inc-${inc.incident_id}`,
            module: "incident",
            date: inc.submitted_at || new Date().toISOString(),
            title: typeLabel,
            subtitle: `${inc.severity} · ${inc.site_code}`,
            status: inc.status,
            notes: "",
            payload: "{}",
            // Incident-specific fields used by ActionCenter list rendering
            incident: inc,
            incidentId: inc.incident_id,
            incidentType: inc.incident_type,
            severity: inc.severity,
            typeColor: typeMeta?.color || "#6b7280",
          });
        });
      } catch (e) {
        console.error("[history] Failed to merge incidents:", e.message);
      }

      history.sort((a, b) => new Date(b.date) - new Date(a.date));
      return NextResponse.json({ success: true, history });
    }

    // ─── Draft: Load ───
    if (action === "load-draft") {
      const module = searchParams.get("module"); // "nh" or "paf"
      const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.DRAFTS);
      const match = rows.find(
        (r) => String(r[0] || "").toLowerCase().trim() === userEmail.toLowerCase() && String(r[1]) === module
      );
      if (match && match[3]) {
        return NextResponse.json({ success: true, draft: match[3] });
      }
      return NextResponse.json({ success: true, draft: null });
    }

    // ─── Notification Center: Get user's notifications ───
    if (action === "my-notifications") {
      const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.NOTIFICATION_LOG);
      const notifications = [];
      const email = userEmail.toLowerCase();

rows.forEach((row, i) => {
        const recipients = String(row[1] || "").toLowerCase().trim();
        if (recipients !== "all" && !recipients.includes(email)) return;

        notifications.push({
          id: i + 2, // sheet row index (1-indexed + header)
          timestamp: row[0] || "",
          subject: String(row[3] || ""),
          eventType: String(row[4] || ""),
          related: String(row[6] || ""),
          read: String(row[7] || "").toUpperCase() === "TRUE",
        });
      });

      // Most recent first, cap at 30
      notifications.reverse();
      const unreadCount = notifications.filter((n) => !n.read).length;

      return NextResponse.json({
        success: true,
        notifications: notifications.slice(0, 30),
        unreadCount,
      });
    }

    if (action === "admin-queue") {
      const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS);

      const queue = [];

      rows.forEach((row, i) => {
        const status = String(row[SUB.STATUS] || "Pending").trim().toLowerCase();
        if (status !== "pending") return;

        const module = String(row[SUB.MODULE] || "paf");
        const employeeName = String(row[SUB.EMPLOYEE] || "");
        const actionType = String(row[SUB.ACTION_TYPE] || "");
        const payload = row[SUB.PAYLOAD] && String(row[SUB.PAYLOAD]).startsWith("{") ? row[SUB.PAYLOAD] : "{}";

        // Build subtitle
        let subtitle = actionType;
        if (module === "newhire") {
          try {
            const p = JSON.parse(payload);
            subtitle = `New Hire (${p.jobTitle || "Unknown"})`;
          } catch (e) { subtitle = "New Hire Onboarding"; }
        }

        queue.push({
          id: "sub-" + (i + 2),
          type: module,
          submitter: String(row[SUB.SUBMITTER] || ""),
          location: String(row[SUB.LOCATION] || "Unknown"),
          title: employeeName || "Request",
          subtitle,
          date: row[SUB.TIMESTAMP] ? new Date(row[SUB.TIMESTAMP]).toISOString() : new Date().toISOString(),
          details: payload,
        });
      });

      // ─── Append all open (non-closed) incidents (Bucket B5: location filter respects site) ───
      try {
        let { rows: incRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
        if (!incRows) incRows = [];
        incRows.forEach((r) => {
          const inc = rowToIncident(r);
          if (!inc.incident_id) return;
          if (inc.status === "closed") return;  // closed incidents not in active queue

          const typeMeta = INCIDENT_TYPES.find((t) => t.id === inc.incident_type);
          const typeLabel = typeMeta?.label || inc.incident_type;

          queue.push({
            id: `inc-${inc.incident_id}`,
            type: "incident",
            submitter: inc.submitted_by_email,
            location: inc.site_code,  // matches existing location filter
            title: typeLabel,
            subtitle: `${inc.severity} · ${inc.site_code}`,
            date: inc.submitted_at || new Date().toISOString(),
            details: "{}",
            // Incident-specific fields for AdminQueue list rendering
            incident: inc,
            incidentType: inc.incident_type,
            severity: inc.severity,
            typeColor: typeMeta?.color || "#6b7280",
          });
        });
      } catch (e) {
        console.error("[admin-queue] Failed to merge incidents:", e.message);
      }

      // Sort: incidents with S1 first, then everything by date (oldest first - normal queue behavior)
      queue.sort((a, b) => {
        // Severity priority for incidents (B2: flat list, sorted by date first then severity)
        // Date desc (newest first), then severity within same date
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        const sevOrder = { S1: 0, S2: 1, S3: 2, S4: 3 };
        const sa = sevOrder[a.severity] ?? 99;
        const sb = sevOrder[b.severity] ?? 99;
        return sa - sb;
      });
return NextResponse.json({ success: true, queue });
    }

// ─── W4: Admin queue (CLOSED view) ───
    // Returns incidents with status === "closed" so admins can find/review
    // historical incidents after they've been closed out. Mirrors the open
    // queue payload shape so the UI can render the same list/detail pane.
    if (action === "admin-queue-closed") {
      const queue = [];

      // ── Submissions: PAFs + New Hires that are no longer pending ──
      // (Approved / Complete / Rejected — anything that's left the active queue)
      try {
        const { rows: subRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS);
        if (subRows) {
          subRows.forEach((row, i) => {
            const status = String(row[SUB.STATUS] || "Pending").trim();
            const statusLower = status.toLowerCase();
            // Closed = not pending. Action Required is still an open state.
            if (statusLower === "pending" || /action/i.test(status)) return;

            const module = String(row[SUB.MODULE] || "paf");
            const employeeName = String(row[SUB.EMPLOYEE] || "");
            const actionType = String(row[SUB.ACTION_TYPE] || "");
            const payload = row[SUB.PAYLOAD] && String(row[SUB.PAYLOAD]).startsWith("{") ? row[SUB.PAYLOAD] : "{}";

            let subtitle = actionType;
            if (module === "newhire") {
              try {
                const p = JSON.parse(payload);
                subtitle = `New Hire (${p.jobTitle || "Unknown"})`;
              } catch (e) { subtitle = "New Hire Onboarding"; }
            }

            queue.push({
              id: "sub-" + (i + 2),
              type: module,
              submitter: String(row[SUB.SUBMITTER] || ""),
              location: String(row[SUB.LOCATION] || "Unknown"),
              title: employeeName || "Request",
              subtitle,
              date: row[SUB.TIMESTAMP] ? new Date(row[SUB.TIMESTAMP]).toISOString() : new Date().toISOString(),
              details: payload,
              // W4 — surface terminal status so the closed-list UI can show "Approved" vs "Rejected"
              closedStatus: status,
            });
          });
        }
      } catch (e) {
        console.error("[admin-queue-closed] Failed to read submissions:", e.message);
      }

      // ── Incidents: status === "closed" ──
      try {
        let { rows: incRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
        if (!incRows) incRows = [];
        incRows.forEach((r) => {
          const inc = rowToIncident(r);
          if (!inc.incident_id) return;
          if (inc.status !== "closed") return;

          const typeMeta = INCIDENT_TYPES.find((t) => t.id === inc.incident_type);
          const typeLabel = typeMeta?.label || inc.incident_type;

          queue.push({
            id: `inc-${inc.incident_id}`,
            type: "incident",
            submitter: inc.submitted_by_email,
            location: inc.site_code,
            title: typeLabel,
            subtitle: `${inc.severity} · ${inc.site_code}`,
            // Use closed_at when available so closed list sorts by close date, not submit date
            date: inc.closed_at || inc.submitted_at || new Date().toISOString(),
            details: "{}",
            incident: inc,
            incidentType: inc.incident_type,
            severity: inc.severity,
            typeColor: typeMeta?.color || "#6b7280",
            closedStatus: "Closed",
          });
        });
      } catch (e) {
        console.error("[admin-queue-closed] Failed to read incidents:", e.message);
      }
      // Newest closures first
      queue.sort((a, b) => new Date(b.date) - new Date(a.date));
      return NextResponse.json({ success: true, queue });
    }


    // ─── Incident: list all (admin queue) ───
    if (action === "incident-list") {
      let { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
      if (!rows) rows = [];
      const incidents = rows
        .map(rowToIncident)
        .filter((i) => i.incident_id);
      return NextResponse.json({ success: true, incidents });
    }

    // ─── Library: list documents from manifest sheet ───
    // Manifest tab "library_manifest" lives in HUB sheet. Columns (10):
    //   A drive_file_id   B category   C title         D version      E updated_at
    //   F description     G pinned     H critical      I sort_order   J active
    //
    // Returns [] if tab doesn't exist OR has no rows; client renders demo cards.
    // Tab is created manually by Kevin/Mariela; no auto-create here.
    if (action === "library-list") {
      let rows;
      try {
        const result = await readSheetSA(SHEET_IDS.HUB, SHEETS.LIBRARY_MANIFEST);
        rows = result?.rows;
      } catch (e) {
        // Tab missing - that's fine, return empty so client shows stub
        console.log("[Library] manifest tab not found - returning empty");
        return NextResponse.json({ success: true, documents: [] });
      }

      if (!rows || rows.length === 0) {
        return NextResponse.json({ success: true, documents: [] });
      }

      const documents = rows
        .map((row, idx) => {
          const driveFileId = String(row[0] || "").trim();
          const category = String(row[1] || "").trim().toLowerCase();
          const title = String(row[2] || "").trim();
          const version = String(row[3] || "").trim();
          const updatedAt = String(row[4] || "").trim();
          const description = String(row[5] || "").trim();
          const pinned = String(row[6] || "").trim().toUpperCase() === "TRUE";
          const critical = String(row[7] || "").trim().toUpperCase() === "TRUE";
          const sortOrder = Number(row[8]) || 100;
          const active = String(row[9] || "").trim().toUpperCase() !== "FALSE"; // default true

          return {
            id: `lib-${idx}-${driveFileId.slice(-8)}`,
            drive_file_id: driveFileId,
            category,
            title,
            version,
            updated_at: updatedAt,
            description,
            pinned,
            critical,
            sort_order: sortOrder,
            active,
            // Drive viewer + free thumbnail (no auth needed when folder is shared
            // anyone-with-link, viewer)
            view_url: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
            thumbnail_url: driveFileId ? `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w400` : null,
          };
        })
        .filter((d) => d.active && d.drive_file_id && d.title); // skip inactive/incomplete rows

      // Sort: pinned first, then by sort_order asc, then by title asc
      documents.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.title.localeCompare(b.title);
      });

      return NextResponse.json({ success: true, documents });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[People API] Error:", error.message);
        return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════
// POST: Submit new hire, PAF, admin action, help
// ═══════════════════════════════════════
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "submit-newhire") {
      const f = body.form;
      const isEdit = f.isEdit && f.rowIndex;

      // Strip edit metadata, stamp schema version
      const cleanPayload = { ...f, _v: 2 };
      delete cleanPayload.isEdit;
      delete cleanPayload.rowIndex;

const employeeName = `${f.firstName} ${f.lastName}`.trim();
    const row = [
              new Date().toISOString(),        // Timestamp
        f.submitterEmail,                // Submitter Email
        "newhire",                       // Module
        employeeName,                    // Employee Name
        f.operation || "",               // Location
        "new_hire",                      // Action Type
        f.startDate || "",               // Effective Date
        JSON.stringify(cleanPayload),    // JSON Payload
        "Pending",                       // Status
        "",                              // HR Notes
      ];

      const result = isEdit
        ? await updateRangeSA(SHEET_IDS.COLLECTION, `${SHEETS.SUBMISSIONS}!A${f.rowIndex}:${String.fromCharCode(64 + row.length)}${f.rowIndex}`, [row])
        : await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, row);

      // 🔔 Notification: new hire submitted or resubmitted
if (result.success) {
        notify("new_hire", { ...cleanPayload, submitterEmail: f.submitterEmail, _isResubmit: !!isEdit }).catch(() => {});

        // Slack notification to #people-new-hire
        if (process.env.SLACK_NEWHIRE_WEBHOOK) {
          const tools = [];
          if (f.needsCard === "Yes") tools.push("Company Card");
          if (f.needsLaptop === "Yes") tools.push("Laptop");
          if (f.needsEmail === "Yes") tools.push("Email");
          if (f.needsCell === "Yes") tools.push("Cell Reimbursement");
          const toolsStr = tools.length > 0 ? tools.join(", ") : "Standard Access";
          const prefix = isEdit ? "Resubmitted" : "New Submission";
          fetch(process.env.SLACK_NEWHIRE_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `New Hire ${prefix}: ${f.firstName} ${f.lastName}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
text: `*New Hire - ${prefix}*\n*Name:* ${f.firstName} ${f.lastName}\n*Role:* ${f.jobTitle || "TBD"}\n*Location:* ${f.operation || "TBD"}\n*Start Date:* ${f.startDate || "TBD"}\n*Pay:* $${f.payRate || "0"} (${f.payType || "Hourly"})\n*Full-Time:* ${f.isFullTime ? "Yes" : "No"}\n*Equipment:* ${toolsStr}\n*Submitted by:* ${f.submitterEmail}`,                  },
                },
              ],
            }),
          }).catch(() => {});
        }
      }

      return NextResponse.json(result);
        }

if (action === "submit-paf") {
       const f = body.form;
       const isEdit = f.isEdit && f.rowIndex;

       // Strip edit metadata, stamp schema version

      const cleanPayload = { ...f, _v: 2 };
      delete cleanPayload.isEdit;
      delete cleanPayload.rowIndex;

      const row = [
        new Date().toISOString(),                                          // Timestamp
        f.submitterEmail,                                                  // Submitter Email
        "paf",                                                             // Module
        f.employeeName || "",                                              // Employee Name
        f.locationName ? `${f.locationKey} - ${f.locationName}` : f.locationKey || "",  // Location
        f.actionType || "",                                                // Action Type
        f.effectiveDate || "",                                             // Effective Date
        JSON.stringify(cleanPayload),                                      // JSON Payload
        "Pending",                                                         // Status
        "",                                                                // HR Notes
      ];

      const result = isEdit
        ? await updateRangeSA(SHEET_IDS.COLLECTION, `${SHEETS.SUBMISSIONS}!A${f.rowIndex}:${String.fromCharCode(64 + row.length)}${f.rowIndex}`, [row])
        : await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, row);

      // 🔔 Notification: PAF submitted or resubmitted
if (result.success) {
        notify(f.actionType, { ...cleanPayload, submitterEmail: f.submitterEmail, _isResubmit: !!isEdit }).catch(() => {});

        // Slack notification to #people-paf
        if (process.env.SLACK_PAF_WEBHOOK) {
          const actionLabel = (f.actionType || "").replace(/_/g, " ").toUpperCase();
          const prefix = isEdit ? "Resubmitted" : "New Submission";
          let details = `*PAF - ${prefix}*\n*Type:* ${actionLabel}\n*Employee:* ${f.employeeName || "Unknown"}\n*Location:* ${f.locationName || f.locationKey || "TBD"}\n*Effective:* ${f.effectiveDate || "TBD"}`;

if (f.actionType === "rate_change") {
          details += `\n*Old Rate:* $${f.oldRate || "0"}\n*New Rate:* $${f.newRate || "0"}`;
          if (f.explanation) details += `\n*Reason:* ${f.explanation}`;
} else if (f.actionType === "separation") {
          details += `\n*Type:* ${f.actionGroup || "N/A"}\n*Reason:* ${f.separationReason || "N/A"}`;
          if (f.lastDayWorked) details += `\n*Last Day Worked:* ${f.lastDayWorked}`;
          details += `\n*Rehire Eligible:* ${f.rehireEligible || "N/A"}`;
                    if (f.explanation) details += `\n*Notes:* ${f.explanation}`;
        } else if (f.actionType === "title_change") {
          details += `\n*Old Title:* ${f.oldTitle || "N/A"}\n*New Title:* ${f.newTitle || "N/A"}`;
          if (f.reclassChangeRate === "Yes" && f.newRate) details += `\n*New Rate:* $${f.newRate}`;
          if (f.explanation) details += `\n*Reason:* ${f.explanation}`;
        } else if (f.actionType === "status_change") {
          details += `\n*Direction:* ${f.statusChangeDirection || "N/A"}`;
        } else if (f.actionType === "reclassification") {
          details += `\n*From:* ${f.reclassFrom || "N/A"}\n*To:* ${f.reclassTo || "N/A"}`;
          if (f.reclassTitleChange === "Yes") details += `\n*Old Title:* ${f.oldTitle || "N/A"}\n*New Title:* ${f.newTitle || "N/A"}`;
          if (f.reclassChangeRate === "Yes" && f.newRate) details += `\n*New Rate:* $${f.newRate}`;
          if (f.explanation) details += `\n*Reason:* ${f.explanation}`;
        } else if (f.actionType === "travel_reimbursement") {
          details += `\n*Travel Dates:* ${f.travelStartDate || ""} to ${f.travelEndDate || ""}\n*Total:* $${f.travelGrandTotal || "0"}`;
          if (f.travelSupplementEnabled === "Yes") details += `\n*Supplement:* $${f.travelSupplementTotal || "0"} (taxable)`;
          if (f.explanation) details += `\n*Purpose:* ${f.explanation}`;
        } else if (f.actionType === "add_bonus" || f.actionType === "add_deduction" || f.actionType === "add_gratuity" || f.actionType === "other_reimbursement") {
          details += `\n*Amount:* $${f.amount || "0"}`;
          if (f.explanation) details += `\n*Notes:* ${f.explanation}`;
        } else if (f.actionType === "add_cell_phone") {
          details += `\n*Frequency:* ${f.cellFrequency || "N/A"}`;
        }

          details += `\n*Submitted by:* ${f.submitterEmail}`;

          fetch(process.env.SLACK_PAF_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `PAF ${prefix}: ${actionLabel} - ${f.employeeName || "Unknown"}`,
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: details },
                },
              ],
            }),
          }).catch(() => {});
        }
      }

      return NextResponse.json(result);
        }

    // ─── Draft: Save (upsert) ───
if (action === "save-draft") {
       const { email, module, payload } = body; // module: "nh" or "paf"
       const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.DRAFTS);
      const existingIdx = rows.findIndex(
        (r) => String(r[0] || "").toLowerCase().trim() === email.toLowerCase() && String(r[1]) === module
      );

      const newRow = [email, module, new Date().toISOString(), JSON.stringify(payload)];
      if (existingIdx >= 0) {
        await updateRangeSA(SHEET_IDS.COLLECTION, `${SHEETS.DRAFTS}!A${existingIdx + 2}:${String.fromCharCode(64 + newRow.length)}${existingIdx + 2}`, [newRow]); // +2 for header + 0-index
      } else {
        await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.DRAFTS, newRow);
      }
      return NextResponse.json({ success: true });
    }

    // ─── Draft: Delete ───
if (action === "delete-draft") {
       const { email, module } = body;
       const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.DRAFTS);

      const existingIdx = rows.findIndex(
        (r) => String(r[0] || "").toLowerCase().trim() === email.toLowerCase() && String(r[1]) === module
      );
      if (existingIdx >= 0) {
        await clearRangeSA(SHEET_IDS.COLLECTION, `${SHEETS.DRAFTS}!A${existingIdx + 2}:D${existingIdx + 2}`);
      }
      return NextResponse.json({ success: true });
    }

    // ─── Notification Center: Mark one as read ───
if (action === "mark-notification-read") {
       const { notificationId } = body;
       await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.NOTIFICATION_LOG, notificationId, 8, "TRUE");
      return NextResponse.json({ success: true });
    }

    // ─── Notification Center: Mark all as read ───
if (action === "mark-all-read") {
       const { email } = body;
       const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.NOTIFICATION_LOG);
      const updates = [];
rows.forEach((row, i) => {
        const recipients = String(row[1] || "").toLowerCase().trim();
        const isMatch = recipients === "all" || recipients.includes(email.toLowerCase());
        if (isMatch && String(row[7] || "").toUpperCase() !== "TRUE") {
                    updates.push(updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.NOTIFICATION_LOG, i + 2, 8, "TRUE"));
        }
      });
      await Promise.all(updates);
      return NextResponse.json({ success: true });
    }

// ─── Withdraw / Cancel: submitter removes their own item ───
    if (action === "withdraw-submission" || action === "cancel-submission") {
      const { itemId, email } = body;
      const rowIndex = parseInt(itemId.split("-")[1]);
      const newStatus = action === "cancel-submission" ? "Cancelled" : "Withdrawn";
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.STATUS_COL, newStatus);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.NOTES_COL, `[${newStatus} by ${email}]`);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.ADMIN_ACTION_COL, new Date().toISOString());
      return NextResponse.json({ success: true });
    }
    
    if (action === "admin-process") {
      const { itemId, adminAction, reason, adminEmail } = body;
      // Unified format: sub-{rowIndex}
      const rowIndex = parseInt(itemId.split("-")[1]);
const newStatus = adminAction === "approve" ? "Complete" : "Rejected";
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.STATUS_COL, newStatus);
              const noteText = reason
        ? `[${newStatus} by ${adminEmail}] ${reason}`
        : `[${newStatus} by ${adminEmail}]`;
await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.NOTES_COL, noteText);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS, rowIndex, SUB.ADMIN_ACTION_COL, new Date().toISOString());

      // 🔔 Notification: admin approved/rejected
      try {
        const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.SUBMISSIONS);
        const row = rows[rowIndex - 2]; // rows array is 0-indexed, sheet is 1-indexed + header
        if (row) {
          notify("status_update", {
            submitterEmail: row[SUB.SUBMITTER],
            employeeName: row[SUB.EMPLOYEE],
            actionType: row[SUB.ACTION_TYPE],
            status: newStatus,
            adminNotes: reason || "",
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[Notifications] Failed to read row for notification:", e.message);
      }

      return NextResponse.json({ success: true });
    }

    // ─── Global Help FAB — send to k.fietek@kitchfix.com ───
    if (action === "submit-help-global") {
      const { email, message, page } = body;
      const userDisplay = email || "Unknown user";
      const pageDisplay = page || "Unknown page";

      const html = EmailTemplates.wrapper(
        `<h2 style="color:#0f3057;font-size:18px;margin:0 0 16px;">Help Request</h2>
         <table style="width:100%;border-collapse:collapse;">
           ${EmailTemplates.row("From", userDisplay)}
           ${EmailTemplates.row("Page", pageDisplay)}
           ${EmailTemplates.row("Message", message)}
           ${EmailTemplates.row("Submitted", new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }))}
         </table>`,
        undefined,
        "Open Intranet",
        "#2563eb"
      );

      const status = await sendEmail(
        "k.fietek@kitchfix.com",
`[HELP] Request from ${userDisplay} - ${pageDisplay}`,
        html,
        email || undefined
      );

      // Slack notification to #help-submission
      if (process.env.SLACK_HELP_WEBHOOK) {
        fetch(process.env.SLACK_HELP_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Help Request from ${userDisplay}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Help Request*\n*From:* ${userDisplay}\n*Page:* ${pageDisplay}\n*Message:* ${message}`,
                },
              },
            ],
          }),
        }).catch(() => {});
      }

      return NextResponse.json({ success: status === "sent" });
    }

    // ─── Incident: submit new ───
    if (action === "submit-incident") {
      const f = body.form || {};

      // Server-side defense (frontend already validates)
      if (!f.incident_type || !f.severity || !f.site_code || !f.incident_date || !f.what_happened) {
        return NextResponse.json(
          { success: false, error: "Missing required fields" },
          { status: 400 }
        );
      }

      // Read existing rows for ID sequence
      let { rows: existingRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
      if (!existingRows) existingRows = [];

      const submittedAt = new Date();
      const incidentId = generateIncidentId(existingRows, submittedAt);

      const typeMeta = INCIDENT_TYPES.find((t) => t.id === f.incident_type);
      const typeLabel = typeMeta?.label || f.incident_type;

      // Resolve region → Regional Director (SOP §02)
      const region = await getSiteRegion(f.site_code);
      const regionalEmail = getRegionalDirectorEmail(region);

      // Compute SOP §8.3 cadence deadlines (Bucket D2)
      const deadlines = computeIncidentDeadlines(submittedAt);

      // Drive folder (best-effort: failure logs but doesn't block submission)
      let driveFolderId = "";
      let driveFolderUrl = "";
      try {
        const folder = await ensureIncidentFolder({
          incidentId,
          siteCode: f.site_code,
          incidentTypeLabel: typeLabel,
          date: submittedAt,
        });
        driveFolderId = folder.folderId;
        driveFolderUrl = folder.folderUrl;
      } catch (e) {
        console.error("[Incident] Drive folder creation failed:", e.message);
      }

// Upload attachments
      const attachments = Array.isArray(f.attachments) ? f.attachments : [];
      // Compute total payload size up front for diagnostics
      const totalAttachBytes = attachments.reduce((s, a) => s + (a?.base64?.length || 0), 0);
      console.log(`[Incident] Submit received ${attachments.length} attachments for ${incidentId} (total b64=${totalAttachBytes} bytes, ~${Math.round(totalAttachBytes*0.75/1024)}KB)`);
      if (attachments.length) {
        attachments.forEach((a, i) => {
          const b64Len = (a?.base64 || "").length;
          const sizeKb = Math.round(b64Len * 0.75 / 1024);
          console.log(`[Incident]   attachment[${i}] name=${a?.name} mime=${a?.mimeType} base64Len=${b64Len} (~${sizeKb}KB)`);
        });
      }
      const uploadedFiles = [];
      // P4 diagnostic: collect upload errors so we can return them to the client
      // and surface in the success screen instead of silently failing.
      const uploadErrors = [];
      if (driveFolderId && attachments.length) {
        for (const att of attachments) {
          try {
            const up = await uploadIncidentFile({
              folderId: driveFolderId,
              base64Data: att.base64,
              filename: att.name,
              mimeType: att.mimeType,
            });
            uploadedFiles.push(up);
            console.log(`[Incident]   uploaded ${att.name} -> ${up.fileId}`);
          } catch (e) {
            console.error(`[Incident] File upload failed (${att.name}):`, e.message, e.stack);
            uploadErrors.push({ name: att.name, error: e.message || "unknown" });
          }
        }
      } else if (attachments.length && !driveFolderId) {
        console.warn(`[Incident] Cannot upload ${attachments.length} attachment(s) — no Drive folder ID`);
        attachments.forEach((a) => uploadErrors.push({ name: a?.name || "?", error: "no Drive folder" }));
      }
      console.log(`[Incident] Upload complete: ${uploadedFiles.length}/${attachments.length} succeeded`);

    
      // Build incident object (all 42 columns, server-set timestamps)
      const incident = {
        incident_id: incidentId,
        submitted_at: submittedAt.toISOString(),
        submitted_by_name: f.submitterName || "",
        submitted_by_email: f.submitterEmail || "",
        submitter_role: "",
        incident_type: f.incident_type,
        severity: f.severity,
        site_code: f.site_code,
        incident_date: f.incident_date,
        incident_time: f.incident_time || "",
        location_detail: f.location_detail || "",
        manager_aware_date: f.manager_aware_date || "",
        what_happened: f.what_happened,
        witnesses: f.witnesses || "",
        type_specific_data: f.type_specific_data ? JSON.stringify(f.type_specific_data) : "",
        drive_folder_id: driveFolderId,
        drive_folder_url: driveFolderUrl,
        attachment_count: uploadedFiles.length,
        attachment_summary: uploadedFiles.map((u) => u.filename).join(" | "),
        notifications_sent: "",
        s1_escalation_at: "",
        status: "submitted",
        acknowledged_by: "",
        acknowledged_at: "",
        investigating_assignee: "",
        investigating_started_at: "",
        root_cause: "",
        corrective_action: "",
        corrective_action_owner: "",
        corrective_action_due: "",
        corrective_action_completed_at: "",
        closed_by: "",
        closed_at: "",
        employee_check_in_due: computeEmployeeCheckInDue(f.incident_type, f.incident_date),
        employee_check_in_completed_at: "",
        claim_submitted_date: "",
        claim_number: "",
        claim_handler_name: "",
        claim_handler_contact: "",
        internal_notes: "",
        last_updated_at: submittedAt.toISOString(),
        last_updated_by: f.submitterEmail || "",
        // SOP v2.1 additions (Bucket B + D2)
        immediate_actions_taken: f.immediate_actions_taken || "",  // §8.2
        preventive_action: "",                                     // §8.4 - admin-edited
        preventive_action_owner: "",
        preventive_action_completed_at: "",
        root_cause_due_at: deadlines.rootCauseDueAt,               // §8.3 - 48h
        corrective_action_due_at: deadlines.correctiveActionDueAt, // §8.3 - 7d
      };

// Notifications (SOP §06 tier-based routing + Regional Director)
      try {
        // P3 — Phase 3: pass appUrl so the email body can render a deep-link
        // CTA back to the admin queue (existing pattern, see lines 386/570/1780).
        const appUrl = process.env.AUTH_URL || "http://localhost:3000";
        const notifResult = await notifyIncident(incident, sendEmail, regionalEmail, appUrl);
        incident.notifications_sent = notifResult.notifications_sent || "";
        incident.s1_escalation_at = notifResult.s1_escalation_at || "";
      } catch (e) {
        console.error("[Incident] Notification orchestration failed:", e.message);
      }

      // 30-day calendar event (P4C — employee_injury & non_employee_injury only).
      // Failure NEVER blocks submission; we log and proceed. Event ID is stored
      // on the row so we could update/cancel later if needed.
      try {
        const appUrl = process.env.AUTH_URL || "http://localhost:3000";
        const calResult = await createIncident30DayEvent(incident, appUrl);
        incident.calendar_event_id = calResult?.eventId || "";
      } catch (e) {
        console.error("[Incident] 30-day calendar event creation failed:", e.message);
        incident.calendar_event_id = "";
      }

      // Append row (with tab-create fallback)
      const row = incidentToRow(incident);
      let appendOk = (await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, row)).success;
      if (!appendOk) {
        console.log(`[Incident] First append failed, trying to create "${INCIDENTS_TAB}" tab`);
        const tabOk = await ensureIncidentsTab(SHEET_IDS.COLLECTION);
        if (tabOk) {
          appendOk = (await appendRowSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, row)).success;
        }
      }
      if (!appendOk) {
        return NextResponse.json(
          {
            success: false,
            error: "Sheet write failed (Drive folder + notifications may have succeeded)",
            incident_id: incidentId,
            drive_folder_url: driveFolderUrl,
          },
          { status: 500 }
        );
      }

      // Audit log
      await logNotification(
        f.submitterEmail || "unknown",
        "system",
        `${incident.severity} incident ${incidentId} submitted`,
        "incident_submit",
        "sent",
        `${incident.severity} | ${incident.site_code} | ${typeLabel}`
      );

      // P4C: generate PDF report and upload to Drive folder.
      // Also returned as base64 in the response so the client can offer a
      // "Download report PDF" action on the success screen.
      // Failure NEVER blocks the response — PDF is supplementary, not critical path.
      let pdfBase64 = "";
      let pdfDriveUrl = "";
      try {
        const attachmentNames = (attachments || []).map((a) => a?.name).filter(Boolean);
        const pdfBuffer = await buildIncidentPdf(incident, attachmentNames);
        pdfBase64 = pdfBuffer.toString("base64");
        // Upload to Drive folder if we have one
        if (driveFolderId) {
          try {
            const pdfFilename = `${incidentId}_Report.pdf`;
            const up = await uploadIncidentFile({
              folderId: driveFolderId,
              base64Data: pdfBase64,
              filename: pdfFilename,
              mimeType: "application/pdf",
            });
            pdfDriveUrl = up.fileUrl || "";
            console.log(`[Incident] PDF uploaded to Drive: ${pdfFilename}`);
          } catch (e) {
            console.error("[Incident] PDF Drive upload failed:", e.message);
          }
        }
      } catch (e) {
        console.error("[Incident] PDF generation failed:", e.message);
      }

      return NextResponse.json({
        success: true,
        incident_id: incidentId,
        drive_folder_url: driveFolderUrl,
        notifications_sent: incident.notifications_sent,
        // P4 diagnostic: attachment outcomes surfaced to client so the success
        // screen can show "2 of 3 attachments uploaded" instead of silently
        // hiding upload failures.
        attachments_total: attachments.length,
        attachments_uploaded: uploadedFiles.length,
        attachment_errors: uploadErrors,
        // P4C: PDF export — returned as base64 for client-side download trigger.
        // pdf_drive_url is the Drive-hosted copy if upload succeeded.
        pdf_base64: pdfBase64,
        pdf_drive_url: pdfDriveUrl,
      });
        }

    // ─── Incident: status update (honest gaps - skipped stages stay empty) ───
    if (action === "incident-status-update") {
      const { incidentId, newStatus, adminEmail } = body;
      if (!incidentId || !newStatus || !adminEmail) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }
      if (!STATUS_FLOW.includes(newStatus)) {
        return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
      }

      let { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
      if (!rows) rows = [];
      const idx = rows.findIndex((r) => (r[0] || "") === incidentId);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Incident not found" }, { status: 404 });
      }
      const sheetRow = idx + 2; // +1 header, +1 1-indexed

      const previousStatus = rowToIncident(rows[idx]).status;
      const currentIncident = rowToIncident(rows[idx]);
      const nowIso = new Date().toISOString();

      // SOP §8.4: closure requires both corrective AND preventive action documented
      if (newStatus === "closed") {
        const ca = String(currentIncident.corrective_action || "").trim();
        const pa = String(currentIncident.preventive_action || "").trim();
        if (!ca || !pa) {
          const missing = [];
          if (!ca) missing.push("corrective action");
          if (!pa) missing.push("preventive action");
          return NextResponse.json({
            success: false,
            error: `SOP §8.4: Cannot close until ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} documented. Use the Investigation panel to fill in.`,
          }, { status: 400 });
        }
      }

      // 1-indexed col map for updateCell
      const col = {};
      INCIDENT_COLUMNS.forEach((c, i) => { col[c] = i + 1; });

      // Always: status + last_updated audit
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.status, newStatus);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_at, nowIso);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_by, adminEmail);

      // Stage-entry timestamps (only the stage being entered — no backfill)
      if (newStatus === "acknowledged") {
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.acknowledged_by, adminEmail);
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.acknowledged_at, nowIso);
      } else if (newStatus === "investigating") {
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.investigating_assignee, adminEmail);
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.investigating_started_at, nowIso);
      } else if (newStatus === "closed") {
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.closed_by, adminEmail);
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.closed_at, nowIso);
        // Edge case: leaving CA stage means CA is by definition complete.
        // Only stamp when we ACTUALLY came from CA (honest gaps for jumps).
        if (previousStatus === "corrective_action") {
          await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.corrective_action_completed_at, nowIso);
        }
      }
      // submitted, corrective_action: no stage-specific timestamps

      // ── W5: Status transition notifications ──
      // Slack the channel + email the original submitter so they know the
      // incident is being acted on. Best-effort — failure here doesn't roll
      // back the status change (which is already persisted to the sheet).
      try {
        // Re-read the row so the notification reflects the freshly-saved state
        // (status, timestamps, etc) rather than the pre-update snapshot.
        const { rows: postRows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
        const updated = postRows && postRows[idx] ? rowToIncident(postRows[idx]) : { ...currentIncident, status: newStatus };
        const appUrl = process.env.AUTH_URL || "http://localhost:3000";
        await notifyStatusChange({
          incident: updated,
          oldStatus: previousStatus,
          newStatus,
          adminEmail,
          sendEmail,
          appUrl,
        });
      } catch (e) {
        console.error("[Incident] Status notification failed:", e.message);
      }

      return NextResponse.json({ success: true });
    }

    // ─── Incident: add internal note (append-only audit log) ───
    if (action === "incident-add-note") {
      const { incidentId, note, adminEmail } = body;
      if (!incidentId || !note || !adminEmail) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }

      let { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
      if (!rows) rows = [];
      const idx = rows.findIndex((r) => (r[0] || "") === incidentId);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Incident not found" }, { status: 404 });
      }
      const sheetRow = idx + 2;

      const col = {};
      INCIDENT_COLUMNS.forEach((c, i) => { col[c] = i + 1; });

      // Append (preserve chronological order — never overwrite)
      const currentNotes = rows[idx][col.internal_notes - 1] || "";
      const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
      const newEntry = `[${stamp} by ${adminEmail}] ${String(note).trim()}`;
      const updatedNotes = currentNotes ? `${currentNotes}\n${newEntry}` : newEntry;

      const nowIso = new Date().toISOString();
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.internal_notes, updatedNotes);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_at, nowIso);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_by, adminEmail);

      return NextResponse.json({ success: true });
    }

    // ─── Incident: edit investigation/closure fields (admin pane) ───
    // SOP §8.4 - root cause, corrective + preventive action, owners, dates.
    // Whitelist enforced server-side; unknown fields silently dropped.
    if (action === "incident-update-investigation") {
      const { incidentId, fields, adminEmail } = body;
      if (!incidentId || !fields || typeof fields !== "object" || !adminEmail) {
        return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
      }

      const EDITABLE = [
        "root_cause",
        "corrective_action",
        "corrective_action_owner",
        "corrective_action_due",
        "preventive_action",
        "preventive_action_owner",
        "preventive_action_completed_at",
      ];

      let { rows } = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS);
      if (!rows) rows = [];
      const idx = rows.findIndex((r) => (r[0] || "") === incidentId);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Incident not found" }, { status: 404 });
      }
      const sheetRow = idx + 2;

      const col = {};
      INCIDENT_COLUMNS.forEach((c, i) => { col[c] = i + 1; });

      // P4C: detect first save vs re-edit by inspecting investigation_saved_at.
      // Empty = first save (fires status auto-advance + notifications).
      // Populated = re-edit (silent update + audit log entry).
      const existingIncident = rowToIncident(rows[idx]);
      const isFirstSave = !existingIncident.investigation_saved_at;
      const oldStatus = existingIncident.status || "submitted";

      // Update only whitelisted, provided fields
      const updated = [];
      for (const key of EDITABLE) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          const val = fields[key] == null ? "" : String(fields[key]);
          await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col[key], val);
          updated.push(key);
        }
      }

      const nowIso = new Date().toISOString();
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_at, nowIso);
      await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.last_updated_by, adminEmail);

      // P4C: lifecycle actions
      let statusAdvanced = false;
      if (isFirstSave) {
        // First save — record investigation_saved_at and auto-advance to investigated
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.investigation_saved_at, nowIso);
        await updateCellByRowColSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS, sheetRow, col.status, "investigated");
        statusAdvanced = true;

        // Fire Slack + email-to-submitter via existing notifyStatusChange.
        // Build a fresh incident object reflecting the updated fields so the
        // notifications carry the latest data (especially status).
        try {
          const updatedRow = await readSheetSA(SHEET_IDS.COLLECTION, SHEETS.INCIDENTS).then((r) => (r.rows || [])[idx]);
          const refreshedIncident = updatedRow ? rowToIncident(updatedRow) : { ...existingIncident, status: "investigated" };
          const appUrl = process.env.AUTH_URL || "http://localhost:3000";
          await notifyStatusChange({
            incident: refreshedIncident,
            oldStatus,
            newStatus: "investigated",
            adminEmail,
            sendEmail,
            appUrl,
          });
        } catch (e) {
          console.error("[Incident] Investigation save notification failed:", e.message);
        }
      } else {
        // Re-edit — append to JSON edit log (audit trail), no notifications
        let log = [];
        try {
          log = JSON.parse(existingIncident.investigation_edit_log || "[]");
          if (!Array.isArray(log)) log = [];
        } catch {
          log = [];
        }
        log.push({ at: nowIso, by: adminEmail });
        await updateCellByRowColSA(
          SHEET_IDS.COLLECTION,
          SHEETS.INCIDENTS,
          sheetRow,
          col.investigation_edit_log,
          JSON.stringify(log)
        );
      }

      return NextResponse.json({
        success: true,
        updated,
        first_save: isFirstSave,
        status_advanced: statusAdvanced,
        new_status: statusAdvanced ? "investigated" : oldStatus,
      });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[People API POST] Error:", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════
// INCIDENT HELPERS
// ═══════════════════════════════════════

// Look up a site's region from HUB accounts sheet (column T).
// Returns "East" | "West" | "CORP" | null. Normalizes whitespace because
// accounts sheet uses "STL - MO" but our SITES uses "STL-MO".
async function getSiteRegion(siteCode) {
  try {
    const { rows } = await readSheetSA(SHEET_IDS.HUB, SHEETS.ACCOUNTS);
    const target = String(siteCode || "").replace(/\s+/g, "").toUpperCase();
    if (!target) return null;
    for (const row of rows) {
      const rowKey = String(row[0] || "").replace(/\s+/g, "").toUpperCase();
      if (rowKey === target) {
        const region = String(row[19] || "").trim();  // col T (was col F)
        return region || null;
      }
    }
    return null;
  } catch (e) {
    console.error(`[Incident] Region lookup failed for ${siteCode}:`, e.message);
    return null;
  }
}

// Resolve region → Regional Director email per SOP §02.
// CORP and unknown regions return null (no regional cc).
function getRegionalDirectorEmail(region) {
  if (!region) return null;
  return REGIONAL_DIRECTORS[region] || null;
}

// UTC-safe date parser for "YYYY-MM-DD" strings (avoids Vercel UTC drift)
function parseIncidentDate(str) {
  if (!str) return null;
  const [yyyy, mm, dd] = String(str).split("-").map(Number);
  if (!yyyy || !mm || !dd) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

// Auto-create the Incidents tab with 42 column headers if missing.
// Called as a fallback when first append fails (likely cause: tab doesn't exist).
async function ensureIncidentsTab(spreadsheetId) {
  try {
    // Step 1: addSheet with frozen header row.
    // Inline batchUpdate (not createTabSA) because we need gridProperties.frozenRowCount,
    // which createTabSA deliberately omits. Per D2, createTabSA's signature stays minimal.
    const sheets = getServiceAccountSheetsClient();
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: INCIDENTS_TAB,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          }],
        },
      });
    } catch (e) {
      // Race condition: another writer just created it - treat as success.
      if (String(e?.message || "").includes("already exists")) {
        console.log(`[Incident] Tab "${INCIDENTS_TAB}" already exists, skipping create`);
      } else {
        console.error(`[Incident] Failed to create tab "${INCIDENTS_TAB}":`, e.message);
        return false;
      }
    }

    // Step 2: write 42 column headers as row 1
    const numCols = INCIDENT_COLUMNS.length;
    let endCol;
    if (numCols <= 26) {
      endCol = String.fromCharCode(64 + numCols);
    } else {
      const first = Math.floor((numCols - 1) / 26);
      const second = ((numCols - 1) % 26) + 1;
      endCol = String.fromCharCode(64 + first) + String.fromCharCode(64 + second);
    }
    const headerRange = `${INCIDENTS_TAB}!A1:${endCol}1`;
    const headerResult = await updateRangeSA(spreadsheetId, headerRange, [INCIDENT_COLUMNS]);
    if (!headerResult.success) {
      console.error(`[Incident] Failed to write headers:`, headerResult.error);
      return false;
    }

    console.log(`[Incident] Created "${INCIDENTS_TAB}" tab with ${numCols} columns`);
    return true;
  } catch (e) {
    console.error(`[Incident] ensureIncidentsTab error:`, e.message);
    return false;
  }
}