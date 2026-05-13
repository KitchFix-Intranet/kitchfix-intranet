import { NextResponse } from "next/server";
import { google } from "googleapis";
import { SHEET_IDS } from "@/lib/sheets";

/**
 * BACKUP CRON — Daily Sheets Snapshot
 *
 * Creates dated copies of operationally critical Google Sheets into the
 * Drive backup folder. Runs nightly at 2am UTC (9pm CT) via Vercel cron.
 *
 * Coverage (5 sheets):
 *   - HUB             — vendor data, accounts, config
 *   - COLLECTION      — submissions, inventory, labor, invoices
 *   - GL_CODES        — financial codes
 *   - AI_LINE_ITEMS   — invoice OCR catalog
 *   - INVENTORY       — inventory submissions & item catalog
 *
 * Deliberately skips ANALYTICS — that's generated data, recoverable from
 * source events, and the sheet that hit cell-quota issues.
 *
 * Auth: service account (drive.files scope must be enabled on the SA).
 * Auth gate: Bearer ${CRON_SECRET} required on inbound request.
 *
 * Retention: NONE — all backups kept indefinitely. Add retention policy
 * in a future PR once we know the right window (probably ~90 days).
 */

// Map logical names to sheet IDs from the source of truth.
const SHEETS_TO_BACKUP = [
  { name: "HUB",            id: SHEET_IDS.HUB },
  { name: "COLLECTION",     id: SHEET_IDS.COLLECTION },
  { name: "GL_CODES",       id: SHEET_IDS.GL_CODES },
  { name: "AI_LINE_ITEMS",  id: SHEET_IDS.AI_LINE_ITEMS },
  { name: "INVENTORY",      id: SHEET_IDS.INVENTORY },
];

function getServiceAccountAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

function todayStamp() {
  // YYYY-MM-DD in UTC (deterministic regardless of cron host TZ)
  return new Date().toISOString().slice(0, 10);
}

async function postSlack(text) {
  const webhook = process.env.SLACK_RECAP_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error("[backup-sheets] Slack post failed:", e?.message || e);
  }
}

export async function GET(request) {
  // Auth — Vercel cron sends Bearer CRON_SECRET; manual hits must match too.
  const authHeader = request.headers.get("authorization") || "";
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folderId = process.env.BACKUP_FOLDER_ID;
  if (!folderId) {
    return NextResponse.json(
      { error: "BACKUP_FOLDER_ID env var is not set" },
      { status: 500 }
    );
  }

  const auth = getServiceAccountAuth();
  const drive = google.drive({ version: "v3", auth });
  const stamp = todayStamp();

  const results = [];
  const errors = [];

  for (const sheet of SHEETS_TO_BACKUP) {
    if (!sheet.id) {
      errors.push({ name: sheet.name, error: "Sheet ID is undefined" });
      continue;
    }
    const backupName = `${sheet.name}-backup-${stamp}`;
    try {
const { data } = await drive.files.copy({
        fileId: sheet.id,
        requestBody: {
          name: backupName,
          parents: [folderId],
        },
        fields: "id, name, createdTime",
        supportsAllDrives: true,
      });
            results.push({
        name: sheet.name,
        backupName: data.name,
        backupId: data.id,
        createdTime: data.createdTime,
      });
    } catch (e) {
      const msg = e?.errors?.[0]?.message || e?.message || String(e);
      console.error(`[backup-sheets] FAILED ${sheet.name}:`, msg);
      errors.push({ name: sheet.name, error: msg });
    }
  }

  const ok = errors.length === 0;
  const summary = `${results.length}/${SHEETS_TO_BACKUP.length} sheets backed up`;

  // Slack ping — success or failure.
  if (ok) {
    const lines = results.map((r) => `• ${r.backupName}`).join("\n");
    await postSlack(`✅ Daily Sheets backup complete — ${summary}\n${lines}`);
  } else {
    const failLines = errors.map((e) => `• ${e.name}: ${e.error}`).join("\n");
    await postSlack(
      `⚠️ Daily Sheets backup completed with errors — ${summary}\n*Failures:*\n${failLines}`
    );
  }

  return NextResponse.json(
    { success: ok, stamp, summary, results, errors },
    { status: ok ? 200 : 207 }
  );
}
