// ════════════════════════════════════════════════════════════════════════════
// wowPlanActions — WOW Plan server-side helpers
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 + Chunk 7 (createCalendarInvites with test mode)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md  +  PB-001 §"The 90-Day WOW Plan"
//
// All Sheets writes via service account (sheets.js).
// State machine: Generated → PreDay1 → Active → Day30 → Day60 → Day90 → Closed
// ════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import {
  readSheetSA,
  appendRowSA,
  updateRangeSA,
  SHEET_IDS,
} from "@/lib/sheets";
import { COLLECTION_TABS, WOW_PLAN_STATUS, DEFAULT_SCALE_DIRECTION } from "@/lib/performanceSchema";
import { logAudit } from "@/lib/performanceActions";

// ─── Header column indices (matches xlsx schema) ───
export const WOW_HEADER_COL = {
  ID: 0,
  LEADER_EMAIL: 1,
  LEADER_NAME: 2,
  ROLE: 3,
  ACCOUNT: 4,
  REVIEWER_EMAIL: 5,
  OVERSIGHT_EMAIL: 6,
  DAY1_DATE: 7,
  DAY30_DATE: 8,
  DAY60_DATE: 9,
  DAY90_DATE: 10,
  STATUS: 11,
  DAY1_SIGNED_AT: 12,
  DAY30_SIGNED_AT: 13,
  DAY60_SIGNED_AT: 14,
  DAY90_SIGNED_AT: 15,
  PDF_DRIVE_ID: 16,
  CALENDAR_EVENT_IDS: 17,
  CREATED_AT: 18,
  LAST_ACTION_BY: 19,
  LAST_ACTION_AT: 20,
};

// ─── Body column indices ───
export const WOW_BODY_COL = {
  ID: 0,
  SCALE_DIRECTION: 1,
  PRE_WORK_RESPONSES: 2,
  DAY1_HIGH_LEVERAGE_QUESTION: 3,
  DAY1_TOP3_GOALS: 4,
  MANAGER_BRAND_EXPECTATIONS: 5,
  LEADER_STYLE_PREFERENCES: 6,
  KEY_INTERACTION_POINTS: 7,
  CADENCE_PLAN: 8,
  DAY30_DATA: 9,
  DAY60_DATA: 10,
  DAY90_DATA: 11,
};

function isHeaderRow(row) {
  const id = String(row[0] || "");
  return !id || id === "id" || id === "uuid" || !id.includes("-");
}

function rowToHeader(row) {
  return {
    id: String(row[WOW_HEADER_COL.ID] || "").trim(),
    leader_email: String(row[WOW_HEADER_COL.LEADER_EMAIL] || "").trim(),
    leader_name: String(row[WOW_HEADER_COL.LEADER_NAME] || "").trim(),
    role: String(row[WOW_HEADER_COL.ROLE] || "").trim(),
    account: String(row[WOW_HEADER_COL.ACCOUNT] || "").trim(),
    reviewer_email: String(row[WOW_HEADER_COL.REVIEWER_EMAIL] || "").trim(),
    oversight_email: String(row[WOW_HEADER_COL.OVERSIGHT_EMAIL] || "").trim(),
    day1_date: String(row[WOW_HEADER_COL.DAY1_DATE] || "").trim(),
    day30_date: String(row[WOW_HEADER_COL.DAY30_DATE] || "").trim(),
    day60_date: String(row[WOW_HEADER_COL.DAY60_DATE] || "").trim(),
    day90_date: String(row[WOW_HEADER_COL.DAY90_DATE] || "").trim(),
    status: String(row[WOW_HEADER_COL.STATUS] || "").trim(),
    day1_signed_at: String(row[WOW_HEADER_COL.DAY1_SIGNED_AT] || "").trim(),
    day30_signed_at: String(row[WOW_HEADER_COL.DAY30_SIGNED_AT] || "").trim(),
    day60_signed_at: String(row[WOW_HEADER_COL.DAY60_SIGNED_AT] || "").trim(),
    day90_signed_at: String(row[WOW_HEADER_COL.DAY90_SIGNED_AT] || "").trim(),
    pdf_drive_id: String(row[WOW_HEADER_COL.PDF_DRIVE_ID] || "").trim(),
    calendar_event_ids: String(row[WOW_HEADER_COL.CALENDAR_EVENT_IDS] || "").trim(),
    created_at: String(row[WOW_HEADER_COL.CREATED_AT] || "").trim(),
    last_action_by: String(row[WOW_HEADER_COL.LAST_ACTION_BY] || "").trim(),
    last_action_at: String(row[WOW_HEADER_COL.LAST_ACTION_AT] || "").trim(),
  };
}

function rowToBody(row) {
  const parseJson = (v, fallback) => {
    const s = String(v || "").trim();
    if (!s) return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  };
  return {
    id: String(row[WOW_BODY_COL.ID] || "").trim(),
    scale_direction: String(row[WOW_BODY_COL.SCALE_DIRECTION] || DEFAULT_SCALE_DIRECTION).trim(),
    pre_work_responses: parseJson(row[WOW_BODY_COL.PRE_WORK_RESPONSES], {}),
    day1_high_leverage_question: parseJson(row[WOW_BODY_COL.DAY1_HIGH_LEVERAGE_QUESTION], {}),
    day1_top3_goals: parseJson(row[WOW_BODY_COL.DAY1_TOP3_GOALS], []),
    manager_brand_expectations: parseJson(row[WOW_BODY_COL.MANAGER_BRAND_EXPECTATIONS], {}),
    leader_style_preferences: parseJson(row[WOW_BODY_COL.LEADER_STYLE_PREFERENCES], {}),
    key_interaction_points: parseJson(row[WOW_BODY_COL.KEY_INTERACTION_POINTS], []),
    cadence_plan: parseJson(row[WOW_BODY_COL.CADENCE_PLAN], {}),
    day30_data: parseJson(row[WOW_BODY_COL.DAY30_DATA], {}),
    day60_data: parseJson(row[WOW_BODY_COL.DAY60_DATA], {}),
    day90_data: parseJson(row[WOW_BODY_COL.DAY90_DATA], {}),
  };
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function listAllWowPlans() {
  try {
    const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.WOW_PLANS_HEADER);
    return (rows || [])
      .filter((r) => !isHeaderRow(r))
      .map(rowToHeader);
  } catch (e) {
    console.error("[wowPlan] listAllWowPlans failed:", e.message);
    return [];
  }
}

export async function listWowPlansForUser(userEmail) {
  if (!userEmail) return [];
  const all = await listAllWowPlans();
  const norm = userEmail.toLowerCase().trim();
  return all.filter(
    (p) =>
      p.leader_email.toLowerCase() === norm ||
      p.reviewer_email.toLowerCase() === norm ||
      p.oversight_email.toLowerCase() === norm
  );
}

export async function getWowPlan(planId) {
  if (!planId) return null;
  const all = await listAllWowPlans();
  const header = all.find((p) => p.id === planId);
  if (!header) return null;

  let body = null;
  try {
    const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.WOW_PLANS_BODY);
    const bodyRow = (rows || [])
      .filter((r) => !isHeaderRow(r))
      .find((r) => String(r[WOW_BODY_COL.ID] || "").trim() === planId);
    if (bodyRow) body = rowToBody(bodyRow);
  } catch (e) {
    console.error("[wowPlan] getWowPlan body read failed:", e.message);
  }

  return { header, body };
}

export async function createWowPlan({
  chainSnapshot,
  day1Date,
  triggerType,
  actorEmail,
}) {
  const id = randomUUID();
  const day30 = addDays(day1Date, 30);
  const day60 = addDays(day1Date, 60);
  const day90 = addDays(day1Date, 90);
  const now = new Date().toISOString();

  const headerRow = [
    id,
    chainSnapshot.leader_email,
    chainSnapshot.leader_name,
    chainSnapshot.role,
    chainSnapshot.account,
    chainSnapshot.reviewer_email,
    chainSnapshot.oversight_email,
    day1Date,
    day30,
    day60,
    day90,
    WOW_PLAN_STATUS.GENERATED,
    "", "", "", "",
    "",
    "",
    now,
    actorEmail,
    now,
  ];

  const bodyRow = [
    id,
    DEFAULT_SCALE_DIRECTION,
    JSON.stringify({ trigger_type: triggerType || "new_hire" }),
    "{}",
    "[]",
    "{}",
    "{}",
    "[]",
    "{}",
    "{}",
    "{}",
    "{}",
  ];

  await appendRowSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.WOW_PLANS_HEADER, headerRow);
  await appendRowSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.WOW_PLANS_BODY, bodyRow);

  await logAudit({
    instrument_type: "WowPlan",
    instrument_id: id,
    action: "created",
    actor_email: actorEmail,
    actor_role: "SystemViewer",
    details: { trigger_type: triggerType, day1_date: day1Date, chain: chainSnapshot },
  });

  return { id, day1_date: day1Date, day30_date: day30, day60_date: day60, day90_date: day90 };
}

export async function updateWowPlanStatus({ planId, newStatus, actorEmail, signedDay = null }) {
  const all = await listAllWowPlans();
  const idx = all.findIndex((p) => p.id === planId);
  if (idx === -1) throw new Error(`WOW Plan ${planId} not found`);

  const sheetRowNumber = idx + 4;
  const now = new Date().toISOString();

  const updates = [
    { range: `${COLLECTION_TABS.WOW_PLANS_HEADER}!L${sheetRowNumber}`, value: newStatus },
    { range: `${COLLECTION_TABS.WOW_PLANS_HEADER}!T${sheetRowNumber}`, value: actorEmail },
    { range: `${COLLECTION_TABS.WOW_PLANS_HEADER}!U${sheetRowNumber}`, value: now },
  ];

  if (signedDay) {
    const colMap = { 1: "M", 30: "N", 60: "O", 90: "P" };
    const col = colMap[signedDay];
    if (col) {
      updates.push({
        range: `${COLLECTION_TABS.WOW_PLANS_HEADER}!${col}${sheetRowNumber}`,
        value: now,
      });
    }
  }

  for (const u of updates) {
    await updateRangeSA(SHEET_IDS.COLLECTION, u.range, [[u.value]]);
  }
}

export async function updateWowPlanBodySection({ planId, columnLetter, jsonValue, actorEmail }) {
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.WOW_PLANS_BODY);
  const dataRows = (rows || []).filter((r) => !isHeaderRow(r));
  const idx = dataRows.findIndex((r) => String(r[WOW_BODY_COL.ID] || "").trim() === planId);
  if (idx === -1) throw new Error(`WOW Plan body ${planId} not found`);

  const sheetRowNumber = idx + 4;
  const range = `${COLLECTION_TABS.WOW_PLANS_BODY}!${columnLetter}${sheetRowNumber}`;
  const value = typeof jsonValue === "string" ? jsonValue : JSON.stringify(jsonValue);

  await updateRangeSA(SHEET_IDS.COLLECTION, range, [[value]]);

  try {
    const all = await listAllWowPlans();
    const headerIdx = all.findIndex((p) => p.id === planId);
    if (headerIdx !== -1) {
      const headerRowNum = headerIdx + 4;
      const now = new Date().toISOString();
      await updateRangeSA(
        SHEET_IDS.COLLECTION,
        `${COLLECTION_TABS.WOW_PLANS_HEADER}!T${headerRowNum}:U${headerRowNum}`,
        [[actorEmail, now]]
      );
    }
  } catch (e) {
    console.warn("[wowPlan] couldn't bump header last_action:", e.message);
  }
}

// ─── Calendar invite helper ───
// Creates Day 30 / 60 / 90 events on a shared calendar.
// In test mode, ALL attendees collapse to a single test recipient.
// Best-effort: never throws.
export async function createCalendarInvites({ planId, header, testMode = false, testRecipient = "" }) {
  const calendarId = process.env.PERFORMANCE_CALENDAR_ID || "primary";
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.warn("[wowPlan] Calendar invites skipped — service account creds missing");
    return [];
  }

  const realLeaderEmail = header.leader_email;
  const realReviewerEmail = header.reviewer_email;
  const realOversightEmail = header.oversight_email;

  const leaderAttendee = testMode ? testRecipient : realLeaderEmail;
  const reviewerAttendee = testMode ? testRecipient : realReviewerEmail;
  const oversightAttendee = testMode ? testRecipient : realOversightEmail;

  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = google.calendar({ version: "v3", auth });

    const buildAttendees = (includeOversight) => {
      const set = new Set([leaderAttendee, reviewerAttendee]);
      if (includeOversight) set.add(oversightAttendee);
      return Array.from(set).filter(Boolean).map((email) => ({ email }));
    };

    const titlePrefix = testMode ? "[TEST] " : "";
    const descriptionTestNote = testMode
      ? `\n\n[TEST MODE] Real chain: leader=${realLeaderEmail}, reviewer=${realReviewerEmail}, oversight=${realOversightEmail}\n`
      : "";

    const eventIds = [];
    for (const checkpoint of [
      { day: 30, date: header.day30_date, title: "Day 30", includeOversight: false },
      { day: 60, date: header.day60_date, title: "Day 60", includeOversight: false },
      { day: 90, date: header.day90_date, title: "Day 90 close-out", includeOversight: true },
    ]) {
      try {
        const event = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: `${titlePrefix}WOW Plan ${checkpoint.title} — ${header.leader_name}`,
            description: `${checkpoint.title} checkpoint for ${header.leader_name} (${header.role}, ${header.account}).\n\nReviewer: ${realReviewerEmail}\nOversight: ${realOversightEmail}\n\nPlan ID: ${planId}${descriptionTestNote}`,
            start: { date: checkpoint.date },
            end: { date: checkpoint.date },
            attendees: buildAttendees(checkpoint.includeOversight),
          },
          sendUpdates: "all",
          supportsAttachments: false,
        });
        eventIds.push(event.data.id);
      } catch (e) {
        console.warn(`[wowPlan] Calendar event Day ${checkpoint.day} failed:`, e.message);
      }
    }

    return eventIds;
  } catch (e) {
    console.error("[wowPlan] Calendar setup failed:", e.message);
    return [];
  }
}