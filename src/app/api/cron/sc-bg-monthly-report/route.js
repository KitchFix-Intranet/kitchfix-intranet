// ═══════════════════════════════════════════════════════════════════
// /api/cron/sc-bg-monthly-report - Monthly B&G meal-count report.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Fires 1pm UTC on the 4th of every month (~8am ET summer / 7am ET
// winter). See vercel.json entry.
//
// The 4th (not the 1st) buffers past the last-week chase settle: a
// month ending mid-week has its final week's Monday-urgent chase
// firing on day 1-2 of the new month; the 4th gives 2-3 days for
// operator entry after that. Firing on the 1st misses the last
// week's counts. See PR body for the full trade rationale.
//
// ─── Loop shape ─────────────────────────────────────────────────
//
// For each account with sc_qbo_account_map.bg_report_recipients
// populated:
//   1. Validate + dedup recipients. If the array is empty after
//      validation, FAIL LOUDLY (log the source, skip the send).
//   2. Build the report via bgReport.buildBgReport() - reads
//      sc_daily_actuals directly (never the invoice builder, since
//      B&G services are export_excluded=true and would return zero
//      through the builder).
//   3. Compose the intranet-shell email + attach the xlsx.
//   4. Send via sendEmailSA (which BCCs kitchfix.admin@ for the
//      audit trail per PR #1091).
//
// ─── Fail-loud on empty recipients (Kevin ruling 2026-09-09) ─────
//
// Same fence as the chase system. If bg_report_recipients is
// populated but every entry fails validation (or the array is
// empty), the log line names the count + the source so a silent
// no-recipient case surfaces on the logs (and via the future cron-
// health track that reads them).
//
// ─── Empty-month behaviour ──────────────────────────────────────
//
// Always fire, always send, always attach. Kevin ruling: a skipped
// send on an empty month looks identical to a broken cron from
// Sebastian's inbox. The lede + flag change ("No B&G service this
// month" grey vs "Ready to bill" green) but the send always happens.

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendEmailSA } from "@/lib/gmail";
import { buildBgReport } from "@/lib/bg/bgReport";
import { renderBgReportEmail } from "@/lib/bg/bgReportEmail";
import {
  normalizeRecipients,
  splitToAndCc,
  previousCalendarMonthISO,
} from "@/lib/bg/bgRecipients";

export const dynamic     = "force-dynamic";
export const maxDuration = 120;

// Sender identity matches the confirmation + chase paths so audit
// BCC dedup + Kevin's inbox filters stay consistent.
const EMAIL_SENDER       = "kitchfix.admin@kitchfix.com";
const EMAIL_DISPLAY_NAME = "KitchFix Ops Hub";

// Recipient validation + month resolution live in @/lib/bg/bgRecipients
// so unit tests exercise them without spinning up a Next request.

// ─── The handler ────────────────────────────────────────────────

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const monthOverride  = url.searchParams.get("month");
  const accountOverride = url.searchParams.get("account");
  const dryRun         = url.searchParams.get("dry_run") === "1";
  const monthISO = monthOverride || previousCalendarMonthISO();

  const supa = getServiceClient();
  const log = [];
  const results = [];

  // 1. Load every account with recipients populated.
  const { data: mapRows, error: mapErr } = await supa
    .from("sc_qbo_account_map")
    .select("account_key, bg_report_recipients")
    .not("bg_report_recipients", "is", null);
  if (mapErr) {
    return NextResponse.json({ ok: false, phase: "sc_qbo_account_map", error: mapErr.message }, { status: 500 });
  }

  const targetAccounts = (mapRows || [])
    .filter((r) => !accountOverride || r.account_key === accountOverride);

  if (targetAccounts.length === 0) {
    log.push(`no accounts opted in (bg_report_recipients IS NULL on every row)${accountOverride ? ` OR account=${accountOverride} not found` : ""}`);
    return NextResponse.json({ ok: true, monthISO, scanned: 0, sent: 0, log });
  }

  for (const row of targetAccounts) {
    const accountKey = row.account_key;
    const rawRecipients = row.bg_report_recipients || [];
    const normalized = normalizeRecipients(rawRecipients);
    const { to, cc } = splitToAndCc(normalized);

    // Fail-loud fence per Kevin ruling 2026-09-09.
    if (to.length === 0) {
      const msg = `${accountKey}: SKIP - recipients resolved to empty (raw_count=${rawRecipients.length}, validated_count=${normalized.length}). Populate bg_report_recipients with a valid TO address.`;
      log.push(msg);
      console.error(`[sc-bg-monthly-report] ${msg}`);
      results.push({ accountKey, sent: false, reason: "no_valid_recipients", raw_count: rawRecipients.length });
      continue;
    }

    // 2. Build the report.
    let report;
    try {
      report = await buildBgReport({
        accountKey, monthISO,
        deps: { supa },
      });
    } catch (e) {
      log.push(`${accountKey}: BUILD FAILED - ${e.message || e}`);
      results.push({ accountKey, sent: false, reason: "build_failed", error: String(e.message || e) });
      continue;
    }

    // 3. Compose email + workbook attachment.
    const { subject, html, preheader } = renderBgReportEmail({
      accountKey,
      factTable: report.factTable,
      reconciliationLine: report.reconciliationLine,
      generatedAt: new Date(),
    });

    let workbookBase64;
    try {
      const buf = await report.workbook.xlsx.writeBuffer();
      workbookBase64 = Buffer.from(buf).toString("base64");
    } catch (e) {
      log.push(`${accountKey}: WORKBOOK SERIALIZE FAILED - ${e.message || e}`);
      results.push({ accountKey, sent: false, reason: "workbook_failed", error: String(e.message || e) });
      continue;
    }

    if (dryRun) {
      log.push(`${accountKey}: DRY-RUN would send to=${to.join(",")} cc=${cc.join(",")} subject="${subject}" workbook=${report.filename} (${workbookBase64.length} b64 chars)`);
      results.push({
        accountKey, sent: false, reason: "dry_run",
        subject, to, cc, filename: report.filename,
        factTable: report.factTable,
      });
      continue;
    }

    // 4. Send.
    const sendResult = await sendEmailSA({
      sender: EMAIL_SENDER,
      displayName: EMAIL_DISPLAY_NAME,
      to, cc,
      subject, html,
      attachments: [{
        filename: report.filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: workbookBase64,
      }],
    });

    const sent = sendResult === "sent";
    log.push(`${accountKey}: ${sent ? "sent" : "FAILED"} to=${to.length} cc=${cc.length} isEmpty=${report.factTable.isEmpty} meals=${report.factTable.meals}`);
    results.push({
      accountKey, sent,
      reason: sent ? "ok" : "send_failed",
      to, cc,
      subject, filename: report.filename,
      factTable: report.factTable,
      reconciliationLine: report.reconciliationLine,
    });
  }

  return NextResponse.json({
    ok: true,
    monthISO,
    scanned: targetAccounts.length,
    sent: results.filter((r) => r.sent).length,
    dryRun,
    log,
    results,
  });
}
