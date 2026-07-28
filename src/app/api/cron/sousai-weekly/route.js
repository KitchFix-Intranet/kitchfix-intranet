// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/sousai-weekly · R1.5 weekly email digest for SousAI
// ═══════════════════════════════════════════════════════════════════════════
//
// Schedule: Mondays 12:00 UTC. See sousai-daily for the UTC/DST caveat.
//
// Recipients: SOUSAI_REPORT_RECIPIENTS env var (comma-separated). Fail-closed
// default to k.fietek@kitchfix.com only when unset/empty/whitespace.
//
// Body: aggregate over last 7 days ending today. Reuses R1 aggregate functions
// verbatim (formatEmailWeekly is the pure formatter).
//
// Send failures never throw - sendEmailSA already returns "sent"|"failed".
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { fetchReportRows } from "@/app/sousai/reports/data.js";
import { isoDay, serverToday } from "@/app/sousai/reports/aggregate.js";
import { formatEmailWeekly } from "@/lib/sousai/reports/formatDigests.js";
import { sendEmailSA } from "@/lib/gmail";
import { resolveRecipients, senderIdentity } from "@/lib/sousai/reports/emailShared.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized();
  }

  const now = new Date();
  const today = serverToday(now);
  const endDayISO = isoDay(today);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";

  const { rows, error } = await fetchReportRows(now);
  if (error) {
    console.error("[sousai-weekly] fetchReportRows failed:", error);
    return NextResponse.json({ ok: false, reason: "fetch failed", error }, { status: 200 });
  }

  let msg;
  try {
    msg = formatEmailWeekly(rows, endDayISO, { baseUrl });
  } catch (e) {
    console.error("[sousai-weekly] formatter threw:", e?.message || e);
    return NextResponse.json({ ok: false, reason: "format failed" }, { status: 200 });
  }

  const recipients = resolveRecipients();
  const { sender, displayName } = senderIdentity();

  const result = await sendEmailSA({
    sender,
    displayName,
    to: recipients,
    subject: msg.subject,
    html: msg.html,
  });

  if (result !== "sent") {
    console.error(`[sousai-weekly] send failed to ${recipients.join(", ")}`);
    return NextResponse.json({ ok: false, reason: "send failed" }, { status: 200 });
  }

  console.log(`[sousai-weekly] sent to ${recipients.length} recipient(s) for endDay=${endDayISO}`);
  return NextResponse.json({ ok: true, endDayISO, sent: recipients.length });
}
