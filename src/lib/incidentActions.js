// ═══════════════════════════════════════════════════════════════
// INCIDENT CENTER - Backend business logic
// ID generation, Drive folder management, Slack notifications,
// tier-based escalation. Imported by app/api/people/route.js
// ═══════════════════════════════════════════════════════════════

import { google } from "googleapis";
// P4 fix: static top-level import of Readable. The previous pattern
// `const { Readable } = await import("stream")` was returning undefined for
// Readable in this route's bundle (despite working in src/lib/drive.js — likely
// a Webpack module-resolution edge case in Next.js 16). Static import is
// universally reliable and matches Node.js best practice.
import { Readable } from "stream";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
  MARIELA_EMAIL,
  CEO_EMAIL,
  VPO_EMAIL,
  DIR_CULINARY_EMAIL,
  SR_DIR_OPS_EMAIL,
  formatAttachmentLabel,
} from "./incidentSchema";
import { getServiceAccountDriveClient } from "@/lib/sheets";

// ─────────────────────────────────────────────
// Calendar client (service account, P4C)
// Calendar API requires its own scope. Service account must have domain-wide
// delegation enabled in Google Workspace admin to impersonate Mariela for
// "organizer" purposes (see deploy guide for one-time setup steps).
// If delegation isn't configured, events still create but are organized
// by the service account itself (functional fallback, just looks weird).
// ─────────────────────────────────────────────
const INCIDENT_CALENDAR_ORGANIZER = process.env.INCIDENT_CALENDAR_ORGANIZER || "m.chavez@kitchfix.com";

function getServiceAccountCalendarClient() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  };
  const scopes = ["https://www.googleapis.com/auth/calendar"];

  // Try to impersonate Mariela (subject) so events appear organized by her.
  // Requires domain-wide delegation. If delegation is not granted, the JWT
  // creation succeeds but the API call fails with 403 — we catch that and
  // fall back to non-impersonated SA-organized events.
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
    subject: INCIDENT_CALENDAR_ORGANIZER,
  });
  return google.calendar({ version: "v3", auth });
}

// Fallback: SA-organized event (no impersonation). Used when domain-wide
// delegation isn't configured. The event still creates and invites work,
// it just shows the SA email as organizer instead of Mariela.
function getServiceAccountCalendarClientNoImpersonation() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
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

  // P4 fix: Readable is now imported statically at the top of this file.
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
// CALENDAR — 30-day follow-up event (P4C)
// Creates a Google Calendar event 30 days from incident submission for the
// HR follow-up check-in. Attendees: Mariela + Kevin + manager who submitted.
// Scoped to employee_injury and non_employee_injury only — other incident
// types (vehicle, property damage, near-miss, etc.) don't need 30-day reviews.
// Failure here NEVER blocks incident submission. We log and continue.
// Returns { eventId } on success or null on failure / out-of-scope.
// ─────────────────────────────────────────────
const CALENDAR_ELIGIBLE_TYPES = new Set(["employee_injury", "non_employee_injury"]);

export async function createIncident30DayEvent(incident, appUrl) {
  // Out-of-scope incident types skip event creation cleanly
  if (!CALENDAR_ELIGIBLE_TYPES.has(incident.incident_type)) {
    return null;
  }

  // Compute event datetime: 30 days from submission, 10:00 AM Central.
  // We anchor to the submitted_at date and shift by 30 days. America/Chicago
  // is the operational timezone for KitchFix HQ.
  const submittedDate = new Date(incident.submitted_at || Date.now());
  const eventDate = new Date(submittedDate);
  eventDate.setDate(eventDate.getDate() + 30);
  // Set to 10:00 in local representation, then format with TZ
  // (Google's startTime uses ISO + timeZone — we send wall-clock + TZ separately)
  const yyyy = eventDate.getFullYear();
  const mm = String(eventDate.getMonth() + 1).padStart(2, "0");
  const dd = String(eventDate.getDate()).padStart(2, "0");
  const startWall = `${yyyy}-${mm}-${dd}T10:00:00`;
  const endWall = `${yyyy}-${mm}-${dd}T10:30:00`;

  // Attendees: Mariela + Kevin + the manager who submitted (deduplicated)
  const attendeeEmails = new Set([
    MARIELA_EMAIL,
    SR_DIR_OPS_EMAIL, // Kevin
    incident.submitted_by_email,
  ]);
  attendeeEmails.delete(""); // safety
  attendeeEmails.delete(undefined);
  const attendees = Array.from(attendeeEmails).map((email) => ({ email }));

  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const typeLabel = typeMeta?.label || incident.incident_type;

  const summary = `Incident 30-day follow-up · ${incident.incident_id}`;
  const adminLink = appUrl ? `${appUrl}/people?view=admin` : "";
  const description = [
    `30-day check-in for incident ${incident.incident_id}.`,
    ``,
    `Type: ${typeLabel}`,
    `Severity: ${incident.severity}`,
    `Site: ${incident.site_code}`,
    `Submitted by: ${incident.submitted_by_name || incident.submitted_by_email}`,
    `Original date: ${incident.incident_date}`,
    ``,
    `What happened:`,
    incident.what_happened || "(no description)",
    ``,
    adminLink ? `Review in admin queue: ${adminLink}` : "",
  ].filter(Boolean).join("\n");

  const eventBody = {
    summary,
    description,
    start: { dateTime: startWall, timeZone: "America/Chicago" },
    end: { dateTime: endWall, timeZone: "America/Chicago" },
    attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 7 * 24 * 60 }, // 7 days before
        { method: "popup", minutes: 60 },           // 1 hour before
      ],
    },
  };

  // Try impersonated client first (events organized by Mariela). If domain-wide
  // delegation isn't configured, that throws; fall through to SA-organized.
  let calendarClient;
  let usingImpersonation = true;
  try {
    calendarClient = getServiceAccountCalendarClient();
  } catch (e) {
    console.warn("[Incident] Calendar JWT init failed, using SA-organized fallback:", e.message);
    calendarClient = getServiceAccountCalendarClientNoImpersonation();
    usingImpersonation = false;
  }

  try {
    const calendarId = usingImpersonation ? INCIDENT_CALENDAR_ORGANIZER : "primary";
    const res = await calendarClient.events.insert({
      calendarId,
      requestBody: eventBody,
      sendUpdates: "all",
    });
    console.log(`[Incident] Created 30-day event ${res.data.id} for ${incident.incident_id} (impersonation=${usingImpersonation})`);
    return { eventId: res.data.id, eventUrl: res.data.htmlLink };
  } catch (e) {
    // If impersonation 403'd, retry without impersonation. This makes the
    // feature still work even if delegation hasn't been set up yet.
    if (usingImpersonation && (e.code === 403 || e.code === 401)) {
      console.warn(`[Incident] Calendar impersonation rejected (${e.code}); retrying as SA:`, e.message);
      try {
        const fallback = getServiceAccountCalendarClientNoImpersonation();
        const res = await fallback.events.insert({
          calendarId: "primary",
          requestBody: eventBody,
          sendUpdates: "all",
        });
        console.log(`[Incident] Created 30-day event ${res.data.id} for ${incident.incident_id} (SA-organized fallback)`);
        return { eventId: res.data.id, eventUrl: res.data.htmlLink };
      } catch (e2) {
        console.error("[Incident] Calendar SA fallback also failed:", e2.message);
        return null;
      }
    }
    console.error(`[Incident] Calendar event creation failed for ${incident.incident_id}:`, e.message);
    return null;
  }
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

  // P4B Slack expansion — add operational context fields so leadership can
  // triage from the Slack message alone without opening the email or admin queue.
  // Type-specific fields (Person Injured, Body Part) only render when present.
  let typeSpecific = {};
  try {
    typeSpecific = typeof incident.type_specific_data === "string"
      ? JSON.parse(incident.type_specific_data || "{}")
      : (incident.type_specific_data || {});
  } catch {}
  const personInjured = typeSpecific.person_injured;
  const bodyPart = typeSpecific.body_part;

  const fields = [
    { type: "mrkdwn", text: `*Incident ID:*\n${incident.incident_id}` },
    { type: "mrkdwn", text: `*Site:*\n${incident.site_code}` },
    { type: "mrkdwn", text: `*Submitted by:*\n${incident.submitted_by_name || incident.submitted_by_email}` },
    { type: "mrkdwn", text: `*Date / Time:*\n${incident.incident_date} ${incident.incident_time}` },
  ];
  // Location within site (e.g., "FOH", "walk-in cooler")
  if (incident.location_detail) {
    fields.push({ type: "mrkdwn", text: `*Location:*\n${incident.location_detail}` });
  }
  // Manager aware date — compliance signal
  if (incident.manager_aware_date) {
    fields.push({ type: "mrkdwn", text: `*Manager aware:*\n${incident.manager_aware_date}` });
  }
  // Person injured + body part (only on injury-type incidents where filled)
  if (personInjured) {
    fields.push({ type: "mrkdwn", text: `*Person injured:*\n${personInjured}` });
  }
  if (bodyPart) {
    fields.push({ type: "mrkdwn", text: `*Body part:*\n${bodyPart}` });
  }

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
      fields,
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What happened:*\n${truncate(incident.what_happened, 400)}`,
      },
    },
  ];

  // P4B: surface immediate actions so leadership knows what's already been done.
  // Most important field after "what happened" — answers "do I need to call?"
  if (incident.immediate_actions_taken) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Immediate actions taken:*\n${truncate(incident.immediate_actions_taken, 400)}`,
      },
    });
  }

  if (incident.drive_folder_url) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
text: `📂 <${incident.drive_folder_url}|${formatAttachmentLabel(incident.attachment_count)}>`,
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

export function buildIncidentEmailHtml(incident, appUrl) {
  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const sevMeta = SEVERITY_TIERS.find((s) => s.id === incident.severity);
  const typeLabel = typeMeta?.label || incident.incident_type;
  const isS1 = incident.severity === "S1";

  // P4B email polish:
  // - Removed redundant eyebrow ("INCIDENT NOTIFICATION") — title already says severity+type
  // - Field labels darkened from #94a3b8 → #64748b for WCAG AA safety
  // - Primary CTA "Review in Admin Queue" promoted above Drive folder link (which is now plain text below)
  // - CTA button enlarged (12×24 padding, 14px font) so it's clearly the primary action
  // - Footer added: KitchFix branding line in muted text below the card

  const adminCta = appUrl
    ? `<div style="margin-top:20px;"><a href="${appUrl}/people?view=admin" style="display:inline-block; background:#7c3aed; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:600;">Review in Admin Queue →</a></div>`
    : "";

  let typeSpecificHtml = "";
  if (incident.type_specific_data) {
    try {
      const ts = typeof incident.type_specific_data === "string"
        ? JSON.parse(incident.type_specific_data)
        : incident.type_specific_data;
      const rows = Object.entries(ts).filter(([, v]) => v).map(([k, v]) =>
        `<tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">${prettify(k)}</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(String(v))}</td></tr>`
      ).join("");
      if (rows) typeSpecificHtml = `<h3 style="margin:18px 0 6px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Type-specific details</h3><table style="border-collapse:collapse;">${rows}</table>`;
    } catch {}
  }

  return `<div style="font-family:Inter,system-ui,sans-serif; max-width:600px; color:#153968;">
    <div style="padding:14px 18px; background:${sevMeta?.color || "#64748b"}; color:white; border-radius:10px 10px 0 0;">
      ${isS1 ? `<div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; opacity:0.9; font-weight:600;">🚨 IMMEDIATE ATTENTION</div>` : ""}
      <div style="font-size:18px; font-weight:600; margin-top:${isS1 ? "2px" : "0"};">${incident.severity} — ${escapeHtml(typeLabel)}</div>
    </div>
    <div style="padding:18px; border:0.5px solid #e2e8f0; border-top:none; border-radius:0 0 10px 10px;">
      <table style="border-collapse:collapse; width:100%;">
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px; width:130px;">Incident ID</td><td style="padding:4px 0; color:#153968; font-size:13px; font-family:monospace;">${escapeHtml(incident.incident_id)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Site</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(incident.site_code)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Submitted by</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(incident.submitted_by_name || "")} &lt;${escapeHtml(incident.submitted_by_email)}&gt;</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Date / Time</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(incident.incident_date)} ${escapeHtml(incident.incident_time)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Location</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(incident.location_detail || "-")}</td></tr>
        <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Manager aware</td><td style="padding:4px 0; color:#153968; font-size:13px;">${escapeHtml(incident.manager_aware_date || "-")}</td></tr>
      </table>
      <h3 style="margin:18px 0 6px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">What happened</h3>
      <div style="font-size:13px; line-height:1.5; color:#334155; white-space:pre-wrap;">${escapeHtml(incident.what_happened || "")}</div>
      ${incident.witnesses ? `<h3 style="margin:18px 0 6px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; font-weight:700;">Witnesses</h3><div style="font-size:13px; color:#334155; white-space:pre-wrap;">${escapeHtml(incident.witnesses)}</div>` : ""}
      ${typeSpecificHtml}
      ${isS1 ? `<div style="margin-top:18px; padding:12px; background:#fee2e2; border-radius:8px; color:#991b1b; font-size:13px; line-height:1.5;"><strong>⏱️ S1 protocol:</strong> The Site Leader or Manager of Record is calling Mariela at <strong>(312) 548-1420</strong> within 15 minutes (once the person is in a safe spot). Mariela: expect a phone call. If no call by 15-min mark, dial that number directly. Voicemail counts only with a callback number AND a Slack message.</div>` : ""}
      ${adminCta}
      ${incident.drive_folder_url ? `<div style="margin-top:14px; padding-top:14px; border-top:0.5px solid #e2e8f0;"><a href="${incident.drive_folder_url}" style="color:#7c3aed; text-decoration:none; font-size:12px; font-weight:500;">📂 Open ${formatAttachmentLabel(incident.attachment_count)}</a></div>` : ""}
    </div>
    <div style="padding:14px 4px 0; font-size:11px; color:#94a3b8; text-align:center;">
      KitchFix Performance Food Service · Sent from People Portal
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
export async function notifyIncident(incident, sendEmail, regionalEmail, appUrl) {
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
  // ─── TEMPORARY HARDCODED OVERRIDE ──────────────────────────────────
  // The INCIDENT_TEST_MODE env var is set in Vercel but isn't reading at
  // runtime for reasons not yet diagnosed. Until root cause is fixed,
  // force test mode ON unconditionally so every incident email routes
  // to Kevin only and never blasts leadership.
  //
  // TO RESTORE PROD ROUTING: change the line below back to:
  //   const TEST_MODE = TEST_MODE_RAW === "true";
  // ────────────────────────────────────────────────────────────────────
  const TEST_MODE = true;
  console.log(`[Incident] notifyIncident called | TEST_MODE=${TEST_MODE} (HARDCODED) | env=${JSON.stringify(TEST_MODE_RAW)} | severity=${incident.severity} | id=${incident.incident_id}`);

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
let htmlBody = buildIncidentEmailHtml(incident, appUrl);
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
      recipients,
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
// W5 — STATUS TRANSITION NOTIFICATIONS
// Fired by /api/people action=incident-status-update after the sheet
// row's status column is rewritten. Posts a short status-change card to
// the Slack incident channel AND emails the original submitter so they
// know their report is being acted on.
//
// Per Kevin's spec: Slack the channel + email to submitter (not full
// leadership distribution — that's the submission notification's job).
//
// Test-mode aware: in test mode, email recipient is overridden to Kevin
// and the Slack header gets a [TEST] prefix.
// ─────────────────────────────────────────────
const STATUS_LABEL_MAP = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  // P4C: investigated = past tense (post-Save Investigation).
  // investigating kept for backward compat with any pre-existing rows.
  investigated: "Investigated",
  investigating: "Investigating",
  corrective_action: "Corrective Action",
  closed: "Closed",
};

const STATUS_EMOJI_MAP = {
  submitted: "📥",
  acknowledged: "👀",
  investigated: "🔍",
  investigating: "🔍",
  corrective_action: "🛠️",
  closed: "✅",
};

export async function notifyStatusChange({
  incident,
  oldStatus,
  newStatus,
  adminEmail,
  sendEmail,
  appUrl,
}) {
  const TEST_MODE = process.env.INCIDENT_TEST_MODE === "true";
  const sent = [];

  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const typeLabel = typeMeta?.label || incident.incident_type;
  const oldLabel = STATUS_LABEL_MAP[oldStatus] || oldStatus;
  const newLabel = STATUS_LABEL_MAP[newStatus] || newStatus;
  const newEmoji = STATUS_EMOJI_MAP[newStatus] || "🔔";

  // ───────────── 1. Slack channel post ─────────────
  const webhook = process.env.SLACK_INCIDENT_WEBHOOK;
  if (webhook) {
    const headerPrefix = TEST_MODE ? "[TEST] " : "";
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${headerPrefix}${newEmoji} Status update: ${newLabel}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Incident:*\n${incident.incident_id}` },
          { type: "mrkdwn", text: `*Type:*\n${incident.severity} · ${typeLabel}` },
          { type: "mrkdwn", text: `*Site:*\n${incident.site_code}` },
          { type: "mrkdwn", text: `*Updated by:*\n${adminEmail}` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `*${oldLabel}* → *${newLabel}*` },
        ],
      },
    ];
    if (TEST_MODE) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "⚠️ *TEST MODE* — submitter email redirected to test inbox." }],
      });
    }
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${headerPrefix}Incident ${incident.incident_id} → ${newLabel}`,
          blocks,
        }),
      });
      if (res.ok) sent.push(TEST_MODE ? "slack-status-test" : "slack-status");
      else console.warn(`[Incident] Slack status post failed: ${res.status}`);
    } catch (e) {
      console.error("[Incident] Slack status post error:", e.message);
    }
  } else {
    console.warn("[Incident] SLACK_INCIDENT_WEBHOOK not set; skipping status Slack post");
  }

  // ───────────── 2. Email to submitter ─────────────
  const submitterEmail = String(incident.submitted_by_email || "").trim();
  if (submitterEmail && sendEmail) {
    let recipient = submitterEmail;
    let intendedRecipient = submitterEmail;
    if (TEST_MODE) {
      recipient = SR_DIR_OPS_EMAIL; // redirect to Kevin in test mode
    }

    const subjectBase = `Your incident ${incident.incident_id} — status: ${newLabel}`;
    const subject = TEST_MODE ? `[TEST] ${subjectBase}` : subjectBase;

    // Per-status submitter-facing copy
    const STATUS_BODY_COPY = {
      acknowledged: "Your report has been acknowledged. A reviewer is preparing to investigate. You don't need to do anything — we'll follow up if we need more information.",
      investigating: "An investigator has been assigned and is actively reviewing your report. We may reach out for additional context.",
      // P4C: investigated = HR has completed the investigation.
      investigated: "The investigation on your incident has been completed. Root cause and corrective actions have been recorded. The incident will move to closure once preventive steps are documented and the 30-day check-in is complete.",
      corrective_action: "The team has identified a corrective action and is working through it. The incident will be closed once preventive steps are documented.",
      closed: "Your incident has been closed. Thank you for reporting it — these reports keep our teams safe. The full record is on file and the closure summary is in the incident's Drive folder.",
      submitted: "Your incident has been recorded. Submission status reset to Submitted.",
    };
    const bodyCopy = STATUS_BODY_COPY[newStatus] || `Status changed to ${newLabel}.`;

    const driveLine = incident.drive_folder_url
      ? `<div style="margin-top:14px;"><a href="${incident.drive_folder_url}" style="color:#7c3aed; text-decoration:none; font-size:13px; font-weight:500;">📂 Open Drive folder</a></div>`
      : "";

    const portalLink = appUrl ? `${appUrl}/people?view=activity` : null;
    const portalCta = portalLink
      ? `<div style="margin-top:18px;"><a href="${portalLink}" style="display:inline-block; background:#7c3aed; color:white; padding:9px 16px; border-radius:6px; text-decoration:none; font-size:13px; font-weight:500;">View in your Action Center</a></div>`
      : "";

    const testBanner = TEST_MODE
      ? `<div style="background:#fef3c7; border:2px solid #d97706; border-radius:8px; padding:12px 16px; margin-bottom:18px; font-family:Arial,sans-serif;">
           <div style="font-size:13px; font-weight:700; color:#92400e; margin-bottom:4px;">⚠️ TEST MODE</div>
           <div style="font-size:12px; color:#78350f;">In production this would have been sent to: <code style="font-family:Consolas,monospace; font-size:11px;">${escapeHtml(intendedRecipient)}</code></div>
         </div>`
      : "";

    const html = `<div style="font-family:Inter,system-ui,sans-serif; max-width:600px; color:#153968;">
      ${testBanner}
      <div style="padding:14px 18px; background:#7c3aed; color:white; border-radius:10px 10px 0 0;">
        <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; opacity:0.85;">Status update</div>
        <div style="font-size:18px; font-weight:500; margin-top:2px;">${newEmoji} ${escapeHtml(newLabel)}</div>
      </div>
      <div style="padding:18px; border:0.5px solid #e2e8f0; border-top:none; border-radius:0 0 10px 10px;">
        <table style="border-collapse:collapse; width:100%;">
          <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px; width:130px;">Incident ID</td><td style="padding:4px 0; font-family:monospace; font-size:13px;">${escapeHtml(incident.incident_id)}</td></tr>
          <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Type</td><td style="padding:4px 0; font-size:13px;">${incident.severity} · ${escapeHtml(typeLabel)}</td></tr>
          <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Site</td><td style="padding:4px 0; font-size:13px;">${escapeHtml(incident.site_code)}</td></tr>
          <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Previous status</td><td style="padding:4px 0; font-size:13px; color:#94a3b8;">${escapeHtml(oldLabel)}</td></tr>
        </table>
        <div style="margin-top:14px; font-size:13px; line-height:1.55; color:#334155;">
          ${escapeHtml(bodyCopy)}
        </div>
        ${driveLine}
        ${portalCta}
      </div>
      <div style="font-size:11px; color:#94a3b8; margin-top:10px; text-align:center;">
        Updated by ${escapeHtml(adminEmail)}
      </div>
    </div>`;

    try {
      const status = await sendEmail([recipient], subject, html, adminEmail);
      if (status === "sent") {
        sent.push(TEST_MODE ? "email-status-test" : "email-status-submitter");
      }
    } catch (e) {
      console.error("[Incident] Status email send error:", e.message);
    }
  }

  return { notifications_sent: sent.join("|") };
}

// ─────────────────────────────────────────────
// SOP §8.3 - Site Action Cadence deadlines
// // Computed at submit time and stored on the incident row so that
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
// ─────────────────────────────────────────────
// PDF EXPORT (P4C)
// Generates a printable PDF of an incident report. Returns a Buffer that can be:
//   - Returned as base64 in the API response (so client can download to device)
//   - Uploaded to the Drive folder (so the folder contains both attachments + report PDF)
// Filenames only for v1 — attachment thumbnails not included (they're already in the folder).
// ─────────────────────────────────────────────
export async function buildIncidentPdf(incident, attachmentNames = []) {
  // Dynamic import to avoid loading pdf-lib at module init (saves ~150KB cold start
  // for routes that never produce PDFs).
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  // Brand colors (PFS navy + KitchFix purple)
  const navy = rgb(0x15 / 255, 0x39 / 255, 0x68 / 255);
  const grey = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
  const slate = rgb(0x33 / 255, 0x41 / 255, 0x55 / 255);
  const lightBorder = rgb(0xe2 / 255, 0xe8 / 255, 0xf0 / 255);

  const sevColors = {
    S1: rgb(0xdc / 255, 0x26 / 255, 0x26 / 255),
    S2: rgb(0xd9 / 255, 0x77 / 255, 0x06 / 255),
    S3: rgb(0xea / 255, 0xa8 / 255, 0x08 / 255),
    S4: rgb(0x64 / 255, 0x74 / 255, 0x8b / 255),
  };
  const sevColor = sevColors[incident.severity] || grey;

  // Helpers
  const drawText = (text, x, yPos, opts = {}) => {
    page.drawText(text || "", {
      x,
      y: yPos,
      size: opts.size || 10,
      font: opts.bold ? helvBold : (opts.italic ? helvOblique : helv),
      color: opts.color || slate,
    });
  };

  const drawWrapped = (text, x, yPos, maxWidth, opts = {}) => {
    const size = opts.size || 10;
    const font = opts.bold ? helvBold : helv;
    const words = String(text || "").replace(/\r\n/g, "\n").split(/(\s+)/);
    const lines = [];
    let line = "";
    for (const w of words) {
      if (w === "\n") {
        lines.push(line);
        line = "";
        continue;
      }
      const test = line + w;
      const wWidth = font.widthOfTextAtSize(test, size);
      if (wWidth > maxWidth && line) {
        lines.push(line);
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    let cursor = yPos;
    const lineHeight = size * 1.4;
    for (const ln of lines) {
      drawText(ln.trimStart(), x, cursor, opts);
      cursor -= lineHeight;
    }
    return cursor; // return where caller should continue
  };

  const drawRow = (label, value, yPos) => {
    drawText(label, margin, yPos, { size: 9, color: grey });
    drawText(String(value || "—"), margin + 130, yPos, { size: 10, color: navy });
    return yPos - 16;
  };

  const drawDivider = (label, yPos) => {
    yPos -= 6;
    drawText(label.toUpperCase(), margin, yPos, { size: 9, bold: true, color: grey });
    const labelWidth = helvBold.widthOfTextAtSize(label.toUpperCase(), 9);
    page.drawLine({
      start: { x: margin + labelWidth + 8, y: yPos + 3 },
      end: { x: width - margin, y: yPos + 3 },
      thickness: 0.5,
      color: lightBorder,
    });
    return yPos - 14;
  };

  // ── HEADER — Title bar ──
  drawText("KitchFix Performance Food Service", margin, y, { size: 9, color: grey });
  y -= 14;
  drawText(`Incident Report — ${incident.incident_id || ""}`, margin, y, {
    size: 18, bold: true, color: navy,
  });
  y -= 24;

  // Severity chip + type label
  const typeMeta = INCIDENT_TYPES.find((t) => t.id === incident.incident_type);
  const typeLabel = typeMeta?.label || incident.incident_type || "";
  const sevMeta = SEVERITY_TIERS.find((s) => s.id === incident.severity);
  const sevLabel = sevMeta?.label || incident.severity || "";

  // Severity chip
  const chipText = incident.severity || "—";
  const chipWidth = helvBold.widthOfTextAtSize(chipText, 11) + 14;
  page.drawRectangle({
    x: margin, y: y - 4, width: chipWidth, height: 18,
    color: sevColor, borderWidth: 0,
  });
  drawText(chipText, margin + 7, y, { size: 11, bold: true, color: rgb(1, 1, 1) });
  drawText(`${typeLabel}  ·  ${sevLabel}`, margin + chipWidth + 10, y, {
    size: 11, bold: true, color: navy,
  });
  y -= 28;

  // ── WHEN & WHERE ──
  y = drawDivider("When & where", y);
  y = drawRow("Site", incident.site_code, y);
  y = drawRow("Date", incident.incident_date, y);
  y = drawRow("Time", incident.incident_time, y);
  y = drawRow("Location", incident.location_detail, y);
  y = drawRow("Manager aware", incident.manager_aware_date, y);
  y = drawRow("Submitted by", `${incident.submitted_by_name || ""} <${incident.submitted_by_email || ""}>`, y);
  y = drawRow("Submitted at", incident.submitted_at, y);

  // ── NARRATIVE ──
  y = drawDivider("Narrative", y);
  drawText("What happened", margin, y, { size: 9, bold: true, color: grey });
  y -= 14;
  y = drawWrapped(incident.what_happened, margin, y, width - 2 * margin, { size: 10, color: slate });
  y -= 8;

  if (incident.immediate_actions_taken) {
    drawText("Immediate actions", margin, y, { size: 9, bold: true, color: grey });
    y -= 14;
    y = drawWrapped(incident.immediate_actions_taken, margin, y, width - 2 * margin, { size: 10, color: slate });
    y -= 8;
  }

  if (incident.witnesses) {
    drawText("Witnesses", margin, y, { size: 9, bold: true, color: grey });
    y -= 14;
    y = drawWrapped(incident.witnesses, margin, y, width - 2 * margin, { size: 10, color: slate });
    y -= 8;
  }

  // ── TYPE-SPECIFIC DETAILS ──
  let tsData = {};
  try {
    tsData = typeof incident.type_specific_data === "string" && incident.type_specific_data
      ? JSON.parse(incident.type_specific_data)
      : (incident.type_specific_data || {});
  } catch {
    tsData = {};
  }
  const tsEntries = Object.entries(tsData).filter(([, v]) => v);
  if (tsEntries.length > 0) {
    y = drawDivider("Type-specific details", y);
    for (const [k, v] of tsEntries) {
      const prettyLabel = String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      y = drawRow(prettyLabel, String(v), y);
      if (y < margin + 80) {
        // out of room — paginate
        const newPage = pdfDoc.addPage([612, 792]);
        page.drawText("(continued)", { x: margin, y: 30, size: 9, color: grey, font: helvOblique });
        // switch page reference is awkward in this simple script — just stop adding here
        break;
      }
    }
  }

  // ── ATTACHMENTS (filenames only) ──
  if (attachmentNames && attachmentNames.length > 0) {
    y = drawDivider("Photos & documents", y);
    drawText(`${attachmentNames.length} file${attachmentNames.length === 1 ? "" : "s"} attached:`, margin, y, {
      size: 9, color: grey,
    });
    y -= 14;
    for (const name of attachmentNames) {
      drawText(`•  ${name}`, margin + 8, y, { size: 10, color: slate });
      y -= 14;
      if (y < margin + 50) break;
    }
  }

  // ── FOOTER (disclaimer) ──
  const disclaimer = "This report is the official record submitted via People Portal. Mariela Chavez (HR) follows up if more information is needed.";
  drawWrapped(disclaimer, margin, margin + 30, width - 2 * margin, {
    size: 8, color: grey, italic: true,
  });
  drawText(`KitchFix Performance Food Service · Generated ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}`,
    margin, margin, { size: 8, color: grey });

  return Buffer.from(await pdfDoc.save());
}