// ════════════════════════════════════════════════════════════════════════════
// performanceActions — module-level helpers
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 7 — test mode)
// ════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { appendRowSA, SHEET_IDS } from "@/lib/sheets";
import { COLLECTION_TABS } from "@/lib/performanceSchema";
import { isTestModeEnabled } from "@/lib/performanceAcl";

// ─── Audit log writer (best-effort, never throws) ───
// In test mode, prepends [TEST] to actor_email so test rows can be wiped later.
export async function logAudit({
  instrument_type,
  instrument_id,
  action,
  actor_email,
  actor_role,
  details = {},
  test_mode = false, // pass through from caller for prefix
}) {
  try {
    const stamped = test_mode ? `[TEST] ${actor_email}` : (actor_email || "");
    const row = [
      randomUUID(),
      instrument_type,
      instrument_id,
      action,
      stamped,
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
// Continues to post in test mode (per your call) but adds a [TEST] tag in the
// header text so you can tell test posts from real ones in the channel.
export async function postPerformanceSlack({ headerText, fields = [], context, test_mode = false }) {
  const webhook = process.env.SLACK_PERFORMANCE_WEBHOOK;
  if (!webhook) {
    console.warn("[performance slack] SLACK_PERFORMANCE_WEBHOOK not set; skipping");
    return { ok: false, reason: "no-webhook" };
  }

  const stampedHeader = test_mode ? `[TEST] ${headerText}` : headerText;

  const blocks = [
    { type: "header", text: { type: "plain_text", text: stampedHeader } },
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

  if (test_mode) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "⚠️ *TEST MODE* — Leadership Dugout test, not a real performance event." }],
    });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: stampedHeader, blocks }),
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