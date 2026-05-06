// ════════════════════════════════════════════════════════════════════════════
// performanceActions — module-level helpers shared across instruments
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
//
// What lives here:
//   - logAudit (append-only audit trail per SOP-001 §6.1)
//   - postPerformanceSlack (Slack notifications to #opshub-performance)
// ════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { appendRowSA, SHEET_IDS } from "@/lib/sheets";
import { COLLECTION_TABS } from "@/lib/performanceSchema";

// ─── Audit log writer (best-effort; never throws) ───
export async function logAudit({
  instrument_type,
  instrument_id,
  action,
  actor_email,
  actor_role,
  details = {},
}) {
  try {
    const row = [
      randomUUID(),
      instrument_type,
      instrument_id,
      action,
      actor_email || "",
      actor_role || "",
      new Date().toISOString(),
      JSON.stringify(details),
    ];
    await appendRowSA(SHEET_IDS.COLLECTION, COLLECTION_TABS.AUDIT_LOG, row);
  } catch (e) {
    console.error("[performance audit] log failed:", e.message);
  }
}

// ─── Slack post to #opshub-performance ───
// Uses SLACK_PERFORMANCE_WEBHOOK env var. No-op if not set.
// Pattern matches src/lib/incidentActions.js postSlackChannel.
export async function postPerformanceSlack({ headerText, fields = [], context }) {
  const webhook = process.env.SLACK_PERFORMANCE_WEBHOOK;
  if (!webhook) {
    console.warn("[performance slack] SLACK_PERFORMANCE_WEBHOOK not set; skipping");
    return { ok: false, reason: "no-webhook" };
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: headerText } },
  ];

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({ type: "mrkdwn", text: `*${f.label}:*\n${f.value}` })),
    });
  }

  if (context) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: context }],
    });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: headerText, blocks }),
    });
    return { ok: res.ok };
  } catch (e) {
    console.error("[performance slack] post failed:", e.message);
    return { ok: false, error: e.message };
  }
}

// ─── First-name extractor for greetings ───
export function getFirstName(fullName, fallback = "there") {
  if (!fullName) return fallback;
  return String(fullName).trim().split(/\s+/)[0] || fallback;
}