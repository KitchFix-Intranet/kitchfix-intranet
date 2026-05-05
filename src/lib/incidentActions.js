// ═══════════════════════════════════════════════════════════════
// INCIDENT CENTER - Backend business logic
// ID generation, Drive folder management, Slack notifications,
// tier-based escalation. Imported by app/api/people/route.js
// ═══════════════════════════════════════════════════════════════

import { google } from "googleapis";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
  MARIELA_EMAIL,
  CEO_EMAIL,
  VPO_EMAIL,
  DIR_CULINARY_EMAIL,
  SR_DIR_OPS_EMAIL,
} from "./incidentSchema";

// ─────────────────────────────────────────────
// Drive client (service account)
// ─────────────────────────────────────────────
function getServiceAccountDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─────────────────────────────────────────────
// ID GENERATOR
// Format: INC-YYYY-MM-NNN (per-month sequence)
// Reads existing incident_ids from rows array (passed in by caller)
// ─────────────────────────────────────────────
export function generateIncidentId(existingRows, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `INC-${yyyy}-${mm}-`;
  let maxSeq = 0;
  for (const row of existingRows) {
    const id = row[0] || ""; // incident_id is column 0
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  const next = String(maxSeq + 1).padStart(3, "0");
  return `${prefix}${next}`;
}

// ─────────────────────────────────────────────
// DRIVE FOLDER MANAGEMENT
// Path: ROOT / YYYY / MM - MonthName / INC-... - SITE - Type /
// ─────────────────────────────────────────────
async function findOrCreateFolder(drive, name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  const q = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (res.data.files?.length) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

export async function ensureIncidentFolder({ incidentId, siteCode, incidentTypeLabel, date }) {
  const rootId = process.env.INCIDENTS_DRIVE_ROOT_ID;
  if (!rootId) {
    throw new Error("INCIDENTS_DRIVE_ROOT_ID env var not configured");
  }

  const drive = getServiceAccountDriveClient();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const monthName = MONTH_NAMES[date.getMonth()];

  const yearFolderId = await findOrCreateFolder(drive, yyyy, rootId);
  const monthFolderId = await findOrCreateFolder(drive, `${mm} - ${monthName}`, yearFolderId);
  const incidentFolderName = `${incidentId} - ${siteCode} - ${incidentTypeLabel}`;
  const incidentFolderId = await findOrCreateFolder(drive, incidentFolderName, monthFolderId);

  return {
    folderId: incidentFolderId,
    folderUrl: `https://drive.google.com/drive/folders/${incidentFolderId}`,
  };
}

// ─────────────────────────────────────────────
// FILE UPLOAD (base64 → Drive)
// Mirrors uploadInvoiceImage pattern from drive.js
// ─────────────────────────────────────────────
export async function uploadIncidentFile({ folderId, base64Data, filename, mimeType }) {
  const drive = getServiceAccountDriveClient();
  const rawBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(rawBase64, "base64");

  const { Readable } = await import("stream");
  const stream = Readable.from(buffer);

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: stream,
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  return {
    fileId: file.data.id,
    fileUrl: file.data.webViewLink || `https://drive.google.com/file/d/${file.data.id}/view`,
    filename,
  };
}

// ─────────────────────────────────────────────
// SLACK NOTIFICATIONS
// Channel post for all tiers + DM to Mariela for S1
// ─────────────────────────────────────────────
const SEV_EMOJI = { S1: "🔴", S2: "🟠", S3: "🟡", S4: "⚪" };

export async function postSlackChannel(incident, testMode = false) {
  // Slack always uses the production webhook — Kevin's keeping the
  // production channel private (no other members) until testing is done,
  // so test posts and real posts both land in the same isolated channel.
  // Test mode still adds [TEST] prefix + footer for visual distinction.
  const webhook = process.env.SLACK_INCIDENT_WEBHOOK;

  if (!webhook) {
    console.warn("[Incident] SLACK_INCIDENT_WEBHOOK not set; skipping channel post");
    return { ok: false, reason: "no-webhook" };
  }

  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const sevEmoji = SEV_EMOJI[incident.severity] || "⚪";
  const typeLabel = typeMeta?.label || incident.incident_type;

  // Test mode: prefix the header text so the message is unmistakable
  const headerText = testMode
    ? `[TEST] ${sevEmoji} ${incident.severity} - ${typeLabel}`
    : `${sevEmoji} ${incident.severity} - ${typeLabel}`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Incident ID:*\n${incident.incident_id}` },
        { type: "mrkdwn", text: `*Site:*\n${incident.site_code}` },
        { type: "mrkdwn", text: `*Submitted by:*\n${incident.submitted_by_name || incident.submitted_by_email}` },
        { type: "mrkdwn", text: `*Date / Time:*\n${incident.incident_date} ${incident.incident_time}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What happened:*\n${truncate(incident.what_happened, 400)}`,
      },
    },
  ];

  if (incident.drive_folder_url) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📂 <${incident.drive_folder_url}|Drive folder> · 📎 ${incident.attachment_count || 0} attachments`,
        },
      ],
    });
  }

  // Test mode: add a clearly-labeled context block at the bottom
  if (testMode) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "⚠️ *TEST MODE* — this is a test notification. In production it would post to the real channel.",
        },
      ],
    });
  }

  try {
    const fallbackText = testMode
      ? `[TEST] New ${incident.severity} incident: ${incident.incident_id}`
      : `New ${incident.severity} incident: ${incident.incident_id}`;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: fallbackText,
        blocks,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[Incident] Slack channel post failed:", res.status, body);
      return { ok: false, reason: "http", status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error("[Incident] Slack channel post error:", err.message);
    return { ok: false, reason: err.message };
  }
}

// ─────────────────────────────────────────────
// EMAIL NOTIFICATION (uses existing sendEmail from route.js)
// We accept sendEmail as a parameter to avoid coupling to route.js internals
// ─────────────────────────────────────────────
export function buildIncidentEmailBody(incident) {
  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const typeLabel = typeMeta?.label || incident.incident_type;
  const lines = [
    `New ${incident.severity} incident submitted.`,
    ``,
    `Incident ID: ${incident.incident_id}`,
    `Site: ${incident.site_code}`,
    `Type: ${typeLabel}`,
    `Submitted by: ${incident.submitted_by_name} (${incident.submitted_by_email})`,
    `Date / Time: ${incident.incident_date} ${incident.incident_time}`,
    `Location: ${incident.location_detail || "-"}`,
    `Manager aware: ${incident.manager_aware_date}`,
    ``,
    `What happened:`,
    incident.what_happened,
    ``,
  ];
  if (incident.witnesses) {
    lines.push(`Witnesses: ${incident.witnesses}`);
    lines.push(``);
  }
  if (incident.type_specific_data) {
    try {
      const ts = typeof incident.type_specific_data === "string"
        ? JSON.parse(incident.type_specific_data)
        : incident.type_specific_data;
      lines.push(`Type-specific details:`);
      Object.entries(ts).forEach(([k, v]) => {
        if (v) lines.push(`  ${prettify(k)}: ${v}`);
      });
      lines.push(``);
    } catch {}
  }
  if (incident.drive_folder_url) {
    lines.push(`Drive folder: ${incident.drive_folder_url}`);
    lines.push(``);
  }
  if (incident.severity === "S1") {
    lines.push(`S1 protocol: The Site Leader or Manager of Record is calling Mariela at (312) 548-1420 within 15 minutes once the person is safe. Mariela: expect a phone call. If no call by 15-min mark, dial that number directly. Voicemail counts only with callback number AND Slack message.`);
  }
  return lines.join("\n");
}

export function buildIncidentEmailHtml(incident) {
  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const sevMeta = SEVERITY_TIERS.find((s) => s.id === incident.severity);
  const typeLabel = typeMeta?.label || incident.incident_type;
  const isS1 = incident.severity === "S1";

  let typeSpecificHtml = "";
  if (incident.type_specific_data) {
    try {
      const ts = typeof incident.type_specific_data === "string"
        ? JSON.parse(incident.type_specific_data)
        : incident.type_specific_data;
      const rows = Object.entries(ts).filter(([, v]) => v).map(([k, v]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">${prettify(k)}</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(String(v))}</td></tr>`
      ).join("");
      if (rows) typeSpecificHtml = `<h3 style="margin:18px 0 6px; font-size:13px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em;">Type-specific details</h3><table style="border-collapse:collapse;">${rows}</table>`;
    } catch {}
  }

  return `<div style="font-family:Inter,system-ui,sans-serif; max-width:600px; color:#0f3057;">
    <div style="padding:14px 18px; background:${sevMeta?.color || "#64748b"}; color:white; border-radius:10px 10px 0 0;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; opacity:0.85;">${isS1 ? "🚨 IMMEDIATE ATTENTION" : "Incident notification"}</div>
      <div style="font-size:18px; font-weight:500; margin-top:2px;">${incident.severity} - ${escapeHtml(typeLabel)}</div>
    </div>
    <div style="padding:18px; border:0.5px solid #e2e8f0; border-top:none; border-radius:0 0 10px 10px;">
      <table style="border-collapse:collapse; width:100%;">
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px; width:130px;">Incident ID</td><td style="padding:4px 0; color:#0f3057; font-size:13px; font-family:monospace;">${escapeHtml(incident.incident_id)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Site</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(incident.site_code)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Submitted by</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(incident.submitted_by_name || "")} &lt;${escapeHtml(incident.submitted_by_email)}&gt;</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Date / Time</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(incident.incident_date)} ${escapeHtml(incident.incident_time)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Location</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(incident.location_detail || "-")}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Manager aware</td><td style="padding:4px 0; color:#0f3057; font-size:13px;">${escapeHtml(incident.manager_aware_date || "-")}</td></tr>
      </table>
      <h3 style="margin:18px 0 6px; font-size:13px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em;">What happened</h3>
      <div style="font-size:13px; line-height:1.5; color:#334155; white-space:pre-wrap;">${escapeHtml(incident.what_happened || "")}</div>
      ${incident.witnesses ? `<h3 style="margin:18px 0 6px; font-size:13px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em;">Witnesses</h3><div style="font-size:13px; color:#334155; white-space:pre-wrap;">${escapeHtml(incident.witnesses)}</div>` : ""}
      ${typeSpecificHtml}
      ${incident.drive_folder_url ? `<div style="margin-top:18px; padding-top:14px; border-top:0.5px solid #e2e8f0;"><a href="${incident.drive_folder_url}" style="color:#7c3aed; text-decoration:none; font-size:13px; font-weight:500;">📂 Open Drive folder (${incident.attachment_count || 0} attachments)</a></div>` : ""}
      ${isS1 ? `<div style="margin-top:18px; padding:12px; background:#fee2e2; border-radius:8px; color:#991b1b; font-size:13px; line-height:1.5;"><strong>⏱️ S1 protocol:</strong> The Site Leader or Manager of Record is calling Mariela at <strong>(312) 548-1420</strong> within 15 minutes (once the person is in a safe spot). Mariela: expect a phone call. If no call by 15-min mark, dial that number directly. Voicemail counts only with a callback number AND a Slack message.</div>` : ""}
    </div>
  </div>`;
}

// ─────────────────────────────────────────────
// TIER-BASED NOTIFICATION ORCHESTRATION
// Per SOP §06 Notification Matrix (v2.1):
//   S1, S2, S3 → Slack channel + email to:
//                HR + CEO + VPO + Dir Culinary + Sr Dir Ops + Regional Director
//                (S1 gets 🚨 prefix; S1 phone-to-HR is non-codable)
//   S4         → Slack channel only (weekly digest is Session 3 cron)
// Vehicle override (§7.2): VPO always cc'd regardless of tier — even S4.
//
// regionalEmail is resolved by route.js from HUB accounts sheet column F
// (East/West/CORP). CORP region passes null and skips Regional cc.
// ─────────────────────────────────────────────
export async function notifyIncident(incident, sendEmail, regionalEmail) {
  const sent = [];
  let s1EscalationAt = null;

  // ─── TEST MODE check ───
  // When INCIDENT_TEST_MODE=true, every notification gets:
  //   - Subject prefixed with [TEST]
  //   - Email recipients overridden to k.fietek@kitchfix.com only
  //   - Slack still uses production webhook (channel kept private during
  //     testing, no separate test channel needed). [TEST] prefix added
  //     to the message header for visual distinction.
  // Set in Vercel env vars. Default false (production behavior).
  const TEST_MODE_RAW = process.env.INCIDENT_TEST_MODE;
  const TEST_MODE = TEST_MODE_RAW === "true";
  // Always log the test mode status with the raw env var value so we can
  // diagnose env var issues (typos, wrong env, missed redeploy) from logs.
  console.log(`[Incident] notifyIncident called | TEST_MODE=${TEST_MODE} | INCIDENT_TEST_MODE env=${JSON.stringify(TEST_MODE_RAW)} | severity=${incident.severity} | id=${incident.incident_id}`);
  if (TEST_MODE) {
    console.log(`[Incident TEST MODE] active - all notifications redirected to ${SR_DIR_OPS_EMAIL}`);
  }

  // 1. Slack channel post for every tier
  const channelRes = await postSlackChannel(incident, TEST_MODE);
  if (channelRes.ok) sent.push(TEST_MODE ? "slack-test" : "slack-channel");

  // 2. Email recipient list per tier (SOP §06)
  let recipients = [];
  if (["S1", "S2", "S3"].includes(incident.severity)) {
    recipients = [
      MARIELA_EMAIL,        // HR
      CEO_EMAIL,            // Josh Katt
      VPO_EMAIL,            // Joe Lessard
      DIR_CULINARY_EMAIL,   // Britt
      SR_DIR_OPS_EMAIL,     // Kevin
    ];
    if (regionalEmail) recipients.push(regionalEmail);
  }
  // S4: no email — weekly digest handled by future cron (Session 3)

  // 3. Vehicle override (SOP §7.2): VPO cc'd for ALL vehicle incidents
  if (incident.incident_type === "vehicle" && !recipients.includes(VPO_EMAIL)) {
    recipients.push(VPO_EMAIL);
  }

  // Dedupe (regionalEmail could match an executive email in edge cases)
  recipients = [...new Set(recipients.filter(Boolean))];

  // ─── TEST MODE: capture intended recipients, override to Kevin only ───
  let intendedRecipients = [];
  if (TEST_MODE && recipients.length) {
    intendedRecipients = [...recipients];
    recipients = [SR_DIR_OPS_EMAIL]; // route everything to Kevin
    console.log(`[Incident TEST MODE] intended recipients: ${intendedRecipients.join(", ")}`);
    console.log(`[Incident TEST MODE] actual recipient: ${recipients[0]}`);
  }

  if (recipients.length && sendEmail) {
    const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
    const typeLabel = typeMeta?.label || incident.incident_type;
    // NOTE: regular hyphens in subject, no em-dashes (avoids encoding artifacts)
    const subjectBase = `${incident.severity} incident ${incident.incident_id} - ${typeLabel} at ${incident.site_code}`;
    let subject = incident.severity === "S1" ? `🚨 ${subjectBase}` : subjectBase;
    if (TEST_MODE) subject = `[TEST] ${subject}`;

    // In test mode, prepend a banner to the email body showing who would
    // have received it in production
    let htmlBody = buildIncidentEmailHtml(incident);
    if (TEST_MODE && intendedRecipients.length) {
      const banner = `
        <div style="background:#fef3c7; border:2px solid #d97706; border-radius:8px; padding:14px 18px; margin-bottom:20px; font-family:Arial,sans-serif;">
          <div style="font-size:14px; font-weight:700; color:#92400e; margin-bottom:6px;">⚠️ TEST MODE — this email was redirected</div>
          <div style="font-size:12px; color:#78350f; line-height:1.5;">
            In production, this email would have been sent to:<br/>
            <code style="font-family:Consolas,monospace; font-size:11px; color:#451a03;">${intendedRecipients.join(", ")}</code>
          </div>
        </div>
      `;
      htmlBody = banner + htmlBody;
    }

    const emailRes = await sendEmail(
      recipients.join(","),
      subject,
      htmlBody,
      incident.submitted_by_email
    );
    // sendEmail returns "sent" or "failed" (string)
    if (emailRes === "sent") {
      const tag = TEST_MODE ? "test" : `${incident.severity.toLowerCase()}-${intendedRecipients.length || recipients.length}rcpts`;
      sent.push(`email-${tag}`);
    }

    if (incident.severity === "S1") {
      s1EscalationAt = new Date().toISOString();
    }
  }

  return {
    notifications_sent: sent.join("|"),
    s1_escalation_at: s1EscalationAt,
  };
}

// ─────────────────────────────────────────────
// SOP §8.3 - Site Action Cadence deadlines
// Computed at submit time and stored on the incident row so that
// admin queue overdue badges and future cron alerts can query them
// without parsing dates inline. (Bucket D2.)
// ─────────────────────────────────────────────
export function computeIncidentDeadlines(submittedAt) {
  const sub = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  const rc = new Date(sub.getTime() + 48 * 60 * 60 * 1000);          // +48h
  const ca = new Date(sub.getTime() + 7 * 24 * 60 * 60 * 1000);      // +7 days
  return {
    rootCauseDueAt: rc.toISOString(),
    correctiveActionDueAt: ca.toISOString(),
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function prettify(k) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Compute 30-day employee check-in date (only for employee_injury type)
export function computeEmployeeCheckInDue(incidentType, incidentDateStr) {
  if (incidentType !== "employee_injury") return "";
  if (!incidentDateStr) return "";
  const [yyyy, mm, dd] = incidentDateStr.split("-").map(Number);
  if (!yyyy || !mm || !dd) return "";
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  d.setUTCDate(d.getUTCDate() + 30);
  const oy = d.getUTCFullYear();
  const om = String(d.getUTCMonth() + 1).padStart(2, "0");
  const od = String(d.getUTCDate()).padStart(2, "0");
  return `${oy}-${om}-${od}`;
}