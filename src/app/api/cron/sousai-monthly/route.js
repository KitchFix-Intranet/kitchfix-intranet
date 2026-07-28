// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/sousai-monthly · R1.5 monthly email digest for SousAI
// ═══════════════════════════════════════════════════════════════════════════
//
// Schedule: 1st of month, 12:00 UTC. See sousai-daily for the UTC/DST caveat.
//
// Body: aggregate over last 30 days ending today. Reuses R1 aggregate
// functions verbatim (formatEmailMonthly is the pure formatter).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { fetchReportRows } from "@/app/sousai/reports/data.js";
import { isoDay, serverToday } from "@/app/sousai/reports/aggregate.js";
import { formatEmailMonthly } from "@/lib/sousai/reports/formatDigests.js";
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
    console.error("[sousai-monthly] fetchReportRows failed:", error);
    return NextResponse.json({ ok: false, reason: "fetch failed", error }, { status: 200 });
  }

  let msg;
  try {
    msg = formatEmailMonthly(rows, endDayISO, { baseUrl });
  } catch (e) {
    console.error("[sousai-monthly] formatter threw:", e?.message || e);
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
    console.error(`[sousai-monthly] send failed to ${recipients.join(", ")}`);
    return NextResponse.json({ ok: false, reason: "send failed" }, { status: 200 });
  }

  console.log(`[sousai-monthly] sent to ${recipients.length} recipient(s) for endDay=${endDayISO}`);
  return NextResponse.json({ ok: true, endDayISO, sent: recipients.length });
}
