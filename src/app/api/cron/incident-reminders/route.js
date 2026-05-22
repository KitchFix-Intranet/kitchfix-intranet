import { NextResponse } from "next/server";
import { SHEET_IDS, readSheetSA, updateCellSA } from "@/lib/sheets";
import { sendEmailSA } from "@/lib/gmail";
import { logEventSA } from "@/lib/analytics";
import {
  INCIDENT_COLUMNS,
  INCIDENT_TYPES,
  rowToIncident,
  MARIELA_EMAIL,
  SR_DIR_OPS_EMAIL,
  INCIDENTS_TAB,
} from "@/lib/incidentSchema";

// ═══════════════════════════════════════════════════════════════
// INCIDENT REMINDERS CRON (P4C)
// Schedule: daily at 9:00 AM Central (configured in vercel.json)
// Sends a reminder email 7 days before each incident's 30-day check-in.
// Recipients: Mariela + Kevin + the manager who submitted.
// Uses reminder_7day_sent_at to dedupe (never sends twice for the same incident).
// ═══════════════════════════════════════════════════════════════

// Sheets I/O + Gmail send both flow through canonical helpers from src/lib/sheets.js
// (readSheetSA, updateCellSA, etc., consolidated in PR #54) and src/lib/gmail.js
// (sendEmailSA, consolidated in PR A2b). Previously had a local Gmail client +
// MIME builder here that did SA-impersonated send for support@kitchfix.com;
// the canonical sendEmailSA preserves that exact behavior. See BUSINESS_NOTES
// "Gmail SA canonicalization (Bundle 3 PR A2b)".

// Convert a 1-indexed column number to spreadsheet letter (A, B, ..., Z, AA, AB...)
function colToLetter(col) {
  let s = "";
  while (col > 0) {
    const r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

export async function GET(request) {
  // Auth — Vercel cron sends Bearer CRON_SECRET, manual hits need to match too
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const log = [];

  try {
    // readSheetSA returns {headers, rows} with rows already header-stripped.
    const { rows: dataRows } = await readSheetSA(SHEET_IDS.COLLECTION, INCIDENTS_TAB);
    if (dataRows.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, sent: 0, log: ["No incident rows to scan"] });
    }
    log.push(`Scanned ${dataRows.length} incident rows`);

    // Index columns
    const colIdx = {};
    INCIDENT_COLUMNS.forEach((c, i) => { colIdx[c] = i; });

    // Today at start-of-day (UTC); we compare submitted_at + 23 days against today
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setHours(0, 0, 0, 0);

    let sent = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const inc = rowToIncident(row);
      if (!inc.incident_id) continue;

      // Skip if already closed (no need to remind for resolved incidents)
      if (String(inc.status || "").toLowerCase() === "closed") continue;

      // Skip if reminder already sent (dedupe)
      if (inc.reminder_7day_sent_at) continue;

      // Only fire reminders for incidents with a 30-day check-in scheduled.
      // Per 4C.3 scope, that's employee_injury + non_employee_injury only.
      if (!inc.employee_check_in_due) continue;

      // Compute reminder window: 7 days BEFORE check-in.
      // employee_check_in_due format is YYYY-MM-DD per computeEmployeeCheckInDue.
      const checkInDate = new Date(inc.employee_check_in_due);
      if (isNaN(checkInDate)) continue;
      const reminderDate = new Date(checkInDate);
      reminderDate.setDate(reminderDate.getDate() - 7);
      reminderDate.setHours(0, 0, 0, 0);

      // Fire if today is on or after the reminder date AND on or before the check-in.
      // (Belt-and-suspenders: catches up missed days if the cron didn't run on the exact date.)
      if (today < reminderDate) continue;
      if (today > checkInDate) continue;

      // Build recipients — Mariela + Kevin + submitter, deduplicated
      const submitterEmail = String(inc.submitted_by_email || "").trim();
      const recipientSet = new Set([MARIELA_EMAIL, SR_DIR_OPS_EMAIL]);
      if (submitterEmail) recipientSet.add(submitterEmail);
      const recipients = Array.from(recipientSet);

      // Build email
      const typeMeta = INCIDENT_TYPES.find((t) => t.id === inc.incident_type);
      const typeLabel = typeMeta?.label || inc.incident_type;
      const appUrl = process.env.AUTH_URL || "https://kitchfix-intranet.vercel.app";

      const subject = `Reminder — 30-day check-in due in 7 days · ${inc.incident_id}`;
      const html = `<div style="font-family:Inter,system-ui,sans-serif; max-width:600px; color:#153968;">
        <div style="padding:14px 18px; background:#d97706; color:white; border-radius:10px 10px 0 0;">
          <div style="font-size:18px; font-weight:600;">⏰ 30-day check-in reminder</div>
        </div>
        <div style="padding:18px; border:0.5px solid #e2e8f0; border-top:none; border-radius:0 0 10px 10px;">
          <p style="font-size:14px; line-height:1.55; color:#334155; margin:0 0 14px;">
            The 30-day check-in for incident <strong>${inc.incident_id}</strong> is scheduled for <strong>${inc.employee_check_in_due}</strong> — 7 days from today.
          </p>
          <table style="border-collapse:collapse; width:100%;">
            <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px; width:130px;">Incident ID</td><td style="padding:4px 0; color:#153968; font-size:13px; font-family:monospace;">${inc.incident_id}</td></tr>
            <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Type</td><td style="padding:4px 0; color:#153968; font-size:13px;">${inc.severity} · ${typeLabel}</td></tr>
            <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Site</td><td style="padding:4px 0; color:#153968; font-size:13px;">${inc.site_code}</td></tr>
            <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Submitted by</td><td style="padding:4px 0; color:#153968; font-size:13px;">${inc.submitted_by_name || inc.submitted_by_email}</td></tr>
            <tr><td style="padding:4px 8px 4px 0; color:#64748b; font-size:13px;">Check-in due</td><td style="padding:4px 0; color:#153968; font-size:13px; font-weight:600;">${inc.employee_check_in_due}</td></tr>
          </table>
          <p style="font-size:13px; line-height:1.55; color:#475569; margin:14px 0 0;">
            A calendar invite was created when this incident was submitted. Please review and prepare for the check-in.
          </p>
          <div style="margin-top:18px;">
            <a href="${appUrl}/people?view=admin" style="display:inline-block; background:#7c3aed; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:600;">Review in Admin Queue →</a>
          </div>
        </div>
        <div style="padding:14px 4px 0; font-size:11px; color:#94a3b8; text-align:center;">
          KitchFix Performance Food Service · Sent from People Portal
        </div>
      </div>`;

      try {
        const status = await sendEmailSA({
          sender: process.env.PEOPLE_OPS_FROM_EMAIL || "support@kitchfix.com",
          displayName: "KitchFix People Ops",
          to: recipients,
          subject,
          html,
        });
        if (status !== "sent") throw new Error("Gmail send failed (see [Gmail SA] log)");

        // Mark as sent (dedupe). Sheet row index = i + 2 (header + 0-indexed)
        const sheetRow = i + 2;
        const colNum = colIdx.reminder_7day_sent_at + 1; // 1-indexed
        const colLetter = colToLetter(colNum);
        await updateCellSA(SHEET_IDS.COLLECTION, `${INCIDENTS_TAB}!${colLetter}${sheetRow}`, new Date().toISOString());

        sent++;
        log.push(`Sent reminder for ${inc.incident_id} → ${recipients.join(", ")}`);

        logEventSA({
          email: "system",
          category: "people",
          action: "incident_7day_reminder_sent",
          page: "/api/cron/incident-reminders",
          detail: { incident_id: inc.incident_id, recipients },
        });
      } catch (e) {
        const msg = `Failed reminder for ${inc.incident_id}: ${e.message}`;
        console.error("[IncidentReminders]", msg);
        errors.push(msg);
        log.push(`✗ ${msg}`);
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    return NextResponse.json({
      ok: true,
      scanned: dataRows.length,
      sent,
      errors: errors.length,
      duration_ms: durationMs,
      log,
    });
  } catch (e) {
    console.error("[IncidentReminders] fatal:", e);
    return NextResponse.json(
      { ok: false, error: e.message, log },
      { status: 500 }
    );
  }
}