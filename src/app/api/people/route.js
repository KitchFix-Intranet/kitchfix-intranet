import { NextResponse } from "next/server";
import { logEventSA } from "@/lib/analytics";
import { generateReport } from "@/lib/peopleReport";

// ═══════════════════════════════════════
// PEOPLE PORTAL API
// Uses Google Service Account for Sheets + Gmail access
// ═══════════════════════════════════════

const SHEET_IDS = {
  HUB: process.env.MASTER_HUB_SHEET_ID,
  DB: process.env.PEOPLE_DB_SHEET_ID || process.env.MASTER_HUB_SHEET_ID,
};

const SHEETS = {
  HERO: "hero_images",
  ACCOUNTS: "accounts",
  CONTACTS: "contacts",
  ADMINS: "admins",
  NOTIFICATIONS: "notifications",
  SUBMISSIONS: "submissions",
  DRAFTS: "drafts",
  NOTIFICATION_LOG: "notification_log",
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
// Sheet helpers
// ═══════════════════════════════════════
async function readSheet(spreadsheetId, sheetName) {
  try {
    if (!spreadsheetId) {
      console.error(`[People] Missing spreadsheetId for sheet: ${sheetName}`);
      return { rows: [] };
    }
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[People] Sheet read failed (${sheetName}):`, res.status, errText);
      return { rows: [] };
    }
    const json = await res.json();
    const rows = json.values || [];
    return { rows: rows.slice(1) };
  } catch (e) {
    console.error(`[People] Sheet read error (${sheetName}):`, e.message);
    return { rows: [] };
  }
}

async function appendRow(spreadsheetId, sheetName, rowData) {
  try {
    const token = await getAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [rowData] }),
    });
    return { success: res.ok };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// Update an entire existing row in-place (for Fix & Resubmit)
async function updateRow(spreadsheetId, sheetName, rowIndex, rowData) {
  try {
    const token = await getAccessToken();
    // Calculate end column letter
    const numCols = rowData.length;
    let endCol;
    if (numCols <= 26) {
      endCol = String.fromCharCode(64 + numCols);
    } else {
      const first = Math.floor((numCols - 1) / 26);
      const second = ((numCols - 1) % 26) + 1;
      endCol = String.fromCharCode(64 + first) + String.fromCharCode(64 + second);
    }
    const range = `${sheetName}!A${rowIndex}:${endCol}${rowIndex}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [rowData] }),
    });
    return { success: res.ok };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function updateCell(spreadsheetId, sheetName, row, col, value) {
  try {
    const token = await getAccessToken();
    // Handle columns beyond Z (e.g., col 27 = AA, col 30 = AD)
    let colLetter;
    if (col <= 26) {
      colLetter = String.fromCharCode(64 + col);
    } else {
      const first = Math.floor((col - 1) / 26);
      const second = ((col - 1) % 26) + 1;
      colLetter = String.fromCharCode(64 + first) + String.fromCharCode(64 + second);
    }
    const range = `${sheetName}!${colLetter}${row}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [[value]] }),
    });
  } catch (e) {
    console.error(`[People] Cell update error:`, e.message);
  }
}

// Clear a row's contents (used for deleting drafts)
async function clearRow(spreadsheetId, sheetName, rowIndex, numCols) {
  try {
    const token = await getAccessToken();
    const endCol = String.fromCharCode(64 + numCols);
    const range = `${sheetName}!A${rowIndex}:${endCol}${rowIndex}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`[People] Clear row error:`, e.message);
  }
}

// ═══════════════════════════════════════
// NOTIFICATION ENGINE
// ═══════════════════════════════════════

// Read notification recipients from the notifications sheet
// Sheet format: [actionKey, enabled1, email1, enabled2, email2, enabled3, email3, enabled4, email4]
async function getNotificationRecipients(actionKey) {
  try {
    const { rows } = await readSheet(SHEET_IDS.HUB, SHEETS.NOTIFICATIONS);
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

    // Build RFC 2822 MIME message
    const boundary = "boundary_" + Date.now();
    const mimeLines = [
      `From: ${GMAIL_SENDER_NAME} <${GMAIL_SENDER}>`,
      `To: ${recipients.join(", ")}`,
      `Subject: ${subject}`,
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
    await appendRow(SHEET_IDS.DB, SHEETS.NOTIFICATION_LOG, [
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
         logEventSA({ email: userEmail, category: "people", action: "page_view", page: "/people" });
         const [accounts, contacts, admins, submissions, heroImages, drafts] = await Promise.all([
                  readSheet(SHEET_IDS.HUB, SHEETS.ACCOUNTS),
        readSheet(SHEET_IDS.HUB, SHEETS.CONTACTS),
        readSheet(SHEET_IDS.HUB, SHEETS.ADMINS),
        readSheet(SHEET_IDS.DB, SHEETS.SUBMISSIONS),
        readSheet(SHEET_IDS.HUB, SHEETS.HERO),
        readSheet(SHEET_IDS.DB, SHEETS.DRAFTS),
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
      });
    }

    if (action === "history") {
      const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.SUBMISSIONS);

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

      history.sort((a, b) => new Date(b.date) - new Date(a.date));
      return NextResponse.json({ success: true, history });
    }

    // ─── Draft: Load ───
    if (action === "load-draft") {
      const module = searchParams.get("module"); // "nh" or "paf"
      const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.DRAFTS);
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
      const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.NOTIFICATION_LOG);
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
      const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.SUBMISSIONS);

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

      queue.sort((a, b) => new Date(a.date) - new Date(b.date));
      return NextResponse.json({ success: true, queue });
    }

// ─── Email Reports (Vercel Cron) ───
    if (action === "generate-report") {
      const authHeader = request.headers.get("authorization");
      const cronSecret = process.env.CRON_SECRET;
      const manual = searchParams.get("manual") === "true";

      if (!manual && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      const period = searchParams.get("period") || "weekly";
      try {
        const result = await generateReport(period, {
          readSheet: (id, name) => readSheet(id, name),
          sendEmail,
          logNotification,
          sheetIds: { DB: SHEET_IDS.DB },
        });
        return NextResponse.json(result);
      } catch (e) {
        console.error("[Report] Generation failed:", e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
      }
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
         logEventSA({ email: f.submitterEmail, category: "people", action: "submit_newhire", page: "/people", detail: { name: employeeName, operation: isEdit ? "edit" : "new", isEdit: !!isEdit } });
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
        ? await updateRow(SHEET_IDS.DB, SHEETS.SUBMISSIONS, f.rowIndex, row)
        : await appendRow(SHEET_IDS.DB, SHEETS.SUBMISSIONS, row);

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

       logEventSA({ email: f.submitterEmail, category: "people", action: "submit_paf", page: "/people", detail: { actionType: f.actionType, employeeName: `${f.firstName || ""} ${f.lastName || ""}`.trim(), location: f.location } });

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
        ? await updateRow(SHEET_IDS.DB, SHEETS.SUBMISSIONS, f.rowIndex, row)
        : await appendRow(SHEET_IDS.DB, SHEETS.SUBMISSIONS, row);

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
          details += `\n*Type:* ${f.actionGroup || "N/A"}\n*Reason:* ${f.separationReason || "N/A"}\n*Rehire Eligible:* ${f.rehireEligible || "N/A"}`;
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
       logEventSA({ email, category: "people", action: "draft_save", page: "/people", detail: { module } });
       const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.DRAFTS);
      const existingIdx = rows.findIndex(
        (r) => String(r[0] || "").toLowerCase().trim() === email.toLowerCase() && String(r[1]) === module
      );

      const newRow = [email, module, new Date().toISOString(), JSON.stringify(payload)];
      if (existingIdx >= 0) {
        await updateRow(SHEET_IDS.DB, SHEETS.DRAFTS, existingIdx + 2, newRow); // +2 for header + 0-index
      } else {
        await appendRow(SHEET_IDS.DB, SHEETS.DRAFTS, newRow);
      }
      return NextResponse.json({ success: true });
    }

    // ─── Draft: Delete ───
if (action === "delete-draft") {
       const { email, module } = body;
       logEventSA({ email, category: "people", action: "draft_delete", page: "/people", detail: { module } });
       const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.DRAFTS);

      const existingIdx = rows.findIndex(
        (r) => String(r[0] || "").toLowerCase().trim() === email.toLowerCase() && String(r[1]) === module
      );
      if (existingIdx >= 0) {
        await clearRow(SHEET_IDS.DB, SHEETS.DRAFTS, existingIdx + 2, 4);
      }
      return NextResponse.json({ success: true });
    }

    // ─── Notification Center: Mark one as read ───
if (action === "mark-notification-read") {
       const { notificationId } = body;
       logEventSA({ category: "people", action: "notif_read", page: "/people", detail: { notificationId } });
       await updateCell(SHEET_IDS.DB, SHEETS.NOTIFICATION_LOG, notificationId, 8, "TRUE");
      return NextResponse.json({ success: true });
    }

    // ─── Notification Center: Mark all as read ───
if (action === "mark-all-read") {
       const { email } = body;
       logEventSA({ email, category: "people", action: "notif_read", page: "/people", detail: { count: "all" } });
       const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.NOTIFICATION_LOG);
      const updates = [];
rows.forEach((row, i) => {
        const recipients = String(row[1] || "").toLowerCase().trim();
        const isMatch = recipients === "all" || recipients.includes(email.toLowerCase());
        if (isMatch && String(row[7] || "").toUpperCase() !== "TRUE") {
                    updates.push(updateCell(SHEET_IDS.DB, SHEETS.NOTIFICATION_LOG, i + 2, 8, "TRUE"));
        }
      });
      await Promise.all(updates);
      return NextResponse.json({ success: true });
    }

    if (action === "admin-process") {
      const { itemId, adminAction, reason, adminEmail } = body;
      // Unified format: sub-{rowIndex}
      const rowIndex = parseInt(itemId.split("-")[1]);
const newStatus = adminAction === "approve" ? "Complete" : "Rejected";
       logEventSA({ email: adminEmail, category: "people", action: adminAction === "approve" ? "admin_approve" : "admin_reject", page: "/people", detail: { itemId, adminAction, reason: reason || "" } });
        await updateCell(SHEET_IDS.DB, SHEETS.SUBMISSIONS, rowIndex, SUB.STATUS_COL, newStatus);
              const noteText = reason
        ? `[${newStatus} by ${adminEmail}] ${reason}`
        : `[${newStatus} by ${adminEmail}]`;
await updateCell(SHEET_IDS.DB, SHEETS.SUBMISSIONS, rowIndex, SUB.NOTES_COL, noteText);
      await updateCell(SHEET_IDS.DB, SHEETS.SUBMISSIONS, rowIndex, SUB.ADMIN_ACTION_COL, new Date().toISOString());

      // 🔔 Notification: admin approved/rejected
      try {
        const { rows } = await readSheet(SHEET_IDS.DB, SHEETS.SUBMISSIONS);
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

if (action === "submit-help") {
        const { userEmail, message } = body;

        logEventSA({ email: userEmail, category: "people", action: "help_request", page: "/people", detail: { email: userEmail } });

        //       🔔 Notification: help request

      notify("help_request_hr", {
        submitterEmail: userEmail,
        message,
      }).catch(() => {});

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

      await logNotification(
        email || "unknown",
        "email",
        `[HELP] Help request sent from ${pageDisplay}`,
        "help_request_global",
        status,
        pageDisplay
      );

      await logNotification(
        email || "unknown",
        "email",
        `[HELP] Help request sent from ${pageDisplay}`,
        "help_request_global",
        status,
        pageDisplay
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
