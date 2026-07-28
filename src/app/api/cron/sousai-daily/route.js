// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/sousai-daily · R1.5 daily Slack digest for SousAI
// ═══════════════════════════════════════════════════════════════════════════
//
// Schedule: 12:00 UTC daily via vercel.json.
// Which is: 07:00 AM CDT (summer, Mar-Nov) and 06:00 AM CST (winter, Nov-Mar).
// Vercel cron is UTC and cannot follow DST - the arrival hour drifts by 1h
// between the seasons. Stated plainly per binding.
//
// Content: yesterday's Sous digest (rowsForDay window = yesterday, not today).
// Zero-activity yesterdays still send a one-line "No questions" digest -
// silence is indistinguishable from a broken cron.
//
// Endpoint protection: Vercel cron sends `Authorization: Bearer $CRON_SECRET`.
// Unauthorized requests return the same 404-shaped response as /api/sousai
// disabled - never leak that the endpoint exists.
//
// Failure isolation: Slack POST failures log to Vercel logs and exit 200 OK.
// A broken webhook must NOT produce a failing cron that masks tomorrow's
// run. Formatter errors also caught + logged.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { fetchReportRows } from "@/app/sousai/reports/data.js";
import { isoDay, daysAgo, serverToday } from "@/app/sousai/reports/aggregate.js";
import { formatSlackDaily } from "@/lib/sousai/reports/formatDigests.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 404-shaped for unauthorized (never leak that the endpoint exists).
function unauthorized() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized();
  }

  const webhook = process.env.SLACK_SOUSAI_WEBHOOK_URL;
  if (!webhook) {
    console.error("[sousai-daily] SLACK_SOUSAI_WEBHOOK_URL not set - nothing to post");
    return NextResponse.json({ ok: false, reason: "no webhook configured" });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  const now = new Date();
  const today = serverToday(now);
  const yesterdayISO = isoDay(daysAgo(today, 1));

  const { rows, error } = await fetchReportRows(now);
  if (error) {
    console.error("[sousai-daily] fetchReportRows failed:", error);
    return NextResponse.json({ ok: false, reason: "fetch failed", error }, { status: 200 });
  }

  let payload;
  try {
    payload = formatSlackDaily(rows, yesterdayISO, { baseUrl });
  } catch (e) {
    console.error("[sousai-daily] formatter threw:", e?.message || e);
    return NextResponse.json({ ok: false, reason: "format failed" }, { status: 200 });
  }

  try {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "(no body)");
      console.error(`[sousai-daily] slack post failed status=${resp.status} body=${body.slice(0, 200)}`);
      return NextResponse.json({ ok: false, reason: `slack ${resp.status}` }, { status: 200 });
    }
  } catch (e) {
    console.error("[sousai-daily] slack post threw:", e?.message || e);
    return NextResponse.json({ ok: false, reason: "post threw" }, { status: 200 });
  }

  const questionsInDigest = (payload.attachments || []).length > 0 ? "sent" : "sent-empty";
  console.log(`[sousai-daily] posted for ${yesterdayISO} - ${questionsInDigest}`);
  return NextResponse.json({ ok: true, dayISO: yesterdayISO, sent: 1 });
}
