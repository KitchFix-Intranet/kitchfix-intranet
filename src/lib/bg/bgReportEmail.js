// ═══════════════════════════════════════════════════════════════════
// bgReportEmail - intranet-shell HTML for the monthly B&G report.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Same shell as the chase + N1 confirmation emails: navy header,
// status flag, fact table, one button (attachment reference), copy
// in the footer. Kevin's ask: "not a bare email with a file on it."
//
// Two flag states:
//   Non-empty month: green "Ready to bill"
//   Empty month:     grey "No B&G service this month"
//
// Fact table shows: Month / Days served / Meals / Revenue (green
// "Ready to bill" case) OR the empty-state marker (grey case). The
// numbers come from the SAME factTable object bgReport returns, so
// the email and the workbook cannot show different figures.

import { _internals as qboInternals } from "@/lib/billing/qboNotifications";

const { emailShell, escapeHtml, formatCents } = qboInternals;

// ─── Public renderer ────────────────────────────────────────────
//
// @param {Object} args
// @param {string} args.accountKey        e.g. "TBR - FL"
// @param {Object} args.factTable         { monthLabel, daysServed, meals, revenueCents, isEmpty }
// @param {string} args.reconciliationLine
// @param {Date}   [args.generatedAt]
// @returns {{ subject: string, html: string, preheader: string }}

export function renderBgReportEmail({ accountKey, factTable, reconciliationLine, generatedAt }) {
  const { monthLabel, daysServed, meals, revenueCents, isEmpty } = factTable;

  const subject = isEmpty
    ? `B&G report: ${accountKey}, ${monthLabel} (no service)`
    : `B&G report: ${accountKey}, ${monthLabel} - ${meals.toLocaleString("en-US")} meals`;

  const preheader = isEmpty
    ? `No Boys & Girls Club service was recorded for ${monthLabel}. Report sent monthly so a quiet month and a broken cron never look the same.`
    : `${daysServed} day${daysServed === 1 ? "" : "s"} served, ${meals.toLocaleString("en-US")} meals, ${formatCents(revenueCents)} revenue. Workbook attached.`;

  const html = emailShell({
    preheader,
    body: bodyHtml({ accountKey, factTable, reconciliationLine, generatedAt }),
  });

  return { subject, html, preheader };
}

// ─── Body composer (intranet shell) ─────────────────────────────

function bodyHtml({ accountKey, factTable, reconciliationLine, generatedAt }) {
  const { monthLabel, daysServed, meals, revenueCents, isEmpty } = factTable;

  const flagBg    = isEmpty ? "#F1F5F9" : "#E8F5EC";
  const flagFg    = isEmpty ? "#64748B" : "#2F7D4F";
  const flagBd    = isEmpty ? "#E2E8F0" : "#A6D3B8";
  const flagLabel = isEmpty ? "No B&amp;G service this month" : "Ready to bill";
  const h1Text    = isEmpty ? `${monthLabel}: no service recorded` : `${monthLabel} is ready to bill`;

  // Empty-case lede per Kevin ruling 2026-09-09 (plainer wording).
  const ledeText = isEmpty
    ? `No Boys &amp; Girls Club service was recorded in ${escapeHtml(monthLabel)}. This report sends every month whether or not there was service, so a quiet month and a broken report never look the same.`
    : `Boys &amp; Girls Club meal-count report for ${escapeHtml(accountKey)}, ${escapeHtml(monthLabel)}. Numbers below match the attached workbook exactly. Use the workbook to invoice B&amp;G.`;

  const rows = [
    ["Month",       escapeHtml(monthLabel)],
    ["Days served", `${daysServed}`],
    ["Meals",       (meals || 0).toLocaleString("en-US")],
  ].map(([k, v]) => `<tr>
    <td style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;color:#64748B">${k}</td>
    <td style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;color:#0F172A;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${v}</td>
  </tr>`).join("");

  const revenueRow = `<tr>
    <td style="padding:10px 0;border-top:2px solid #E2E8F0;font-size:14px;color:#64748B">Revenue</td>
    <td style="padding:10px 0;border-top:2px solid #E2E8F0;font-size:14px;color:#0F172A;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${escapeHtml(formatCents(revenueCents))}</td>
  </tr>`;

  const generatedAtLine = generatedAt
    ? `Generated ${generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}.`
    : "";

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td style="padding-bottom:8px;font-size:10px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${flagFg};background:${flagBg};border-bottom:1px solid ${flagBd};padding:7px 20px;display:block">${flagLabel}</td></tr>
  <tr><td style="padding-top:12px;padding-left:20px;padding-right:20px;font-size:17px;line-height:1.35;font-weight:bold;color:#0F172A">${escapeHtml(h1Text)}</td></tr>
  <tr><td style="padding:8px 20px 14px 20px;font-size:13px;line-height:1.55;color:#475569">
    ${ledeText}
  </td></tr>
  <tr><td style="padding:0 20px 15px 20px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      ${rows}
      ${revenueRow}
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 13px 20px;font-size:12px;line-height:1.5;color:#8A5A16;background:#FDF3E6;border-left:3px solid #D9892F;padding:10px 12px;border-radius:4px;margin-bottom:12px">
    <b>Reconciliation:</b> ${escapeHtml(reconciliationLine)}
  </td></tr>
  <tr><td style="padding:12px 20px 0 20px;font-size:11px;line-height:1.55;color:#94A3B8;border-top:1px solid #F1F5F9">
    <b style="color:#64748B;font-weight:600">Workbook attached.</b> Daily detail, weekly subtotals, and monthly total on three sheets. ${generatedAtLine} Sends every month whether or not there was service; if you want the recipient list changed, update <code>sc_qbo_account_map.bg_report_recipients</code> in Studio.
  </td></tr>
</table>`;
}
