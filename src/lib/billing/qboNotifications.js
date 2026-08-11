// ═══════════════════════════════════════════════════════════════════
// qboNotifications - N1 (invoice created) + N2 (push failed).
// PR-C of the SC -> QBO billing arc. 2026-08-11.
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §9. Kevin's recipients
// (2026-08-06 ruling K-1 / K-6):
//   N1 invoice created: Sebastian + Kevin + Joe + Josh + the
//                       account's salaried managers + the submitter
//   N2 push failed:     Kevin + Sebastian, email + Slack
//
// ─── DRY-RUN ONLY IN THIS PR (owner ruling PR-C prompt Step 4) ────
//
// This module NEVER sends. `dryRunOnly` defaults to true and is the
// only supported mode from PR-C. Both entry points render the
// message (subject + html body for email, text body for Slack) and
// return the rendered content plus recipient list. The wire from
// runFinalizeEffects logs the dry-run to console; unit tests
// snapshot the render.
//
// The moment owner + Sebastian sign off, a follow-up PR flips
// `dryRunOnly` to false and calls sendEmailSA + slack webhook. That
// live-send PR is scoped separately by design so this PR ships with
// zero live-send code paths.

// ─── Recipients ───────────────────────────────────────────────────
//
// Names + emails per K-10 + the account salaried-manager reference
// (BUSINESS_NOTES.md §5 salaried set, held here as a fallback until
// the org directory read path lands for finalize).
export const N1_STATIC_RECIPIENTS = Object.freeze([
  "sebastian@kitchfix.com",
  "k.fietek@kitchfix.com",
  "j.kim@kitchfix.com",         // Joe Kim
  "josh@kitchfix.com",
]);

export const N2_RECIPIENTS = Object.freeze([
  "k.fietek@kitchfix.com",
  "sebastian@kitchfix.com",
]);

// Account -> salaried manager email (BUSINESS_NOTES seed; TBD row
// count once directory join lands). Kept as a hardcoded seed so the
// dry-run render is deterministic in tests + reviewers can see the
// concrete recipient set without spinning up a DB call.
export const SALARIED_MANAGERS_BY_ACCOUNT = Object.freeze({
  "TXR - AZ": Object.freeze(["l.ochoa@kitchfix.com"]),
  "CIN - AZ": Object.freeze(["a.macias@kitchfix.com"]),
  "TBJ - FL": Object.freeze(["j.smith@kitchfix.com"]),
  "TBR - FL": Object.freeze(["s.perez@kitchfix.com"]),
  "CIN - KY": Object.freeze(["m.jones@kitchfix.com"]),
  "TBJ - NY": Object.freeze(["e.brown@kitchfix.com"]),
});

// Compose the N1 recipient list. Dedup preserving order.
export function n1Recipients({ accountKey, submitterEmail }) {
  const set = new Set();
  for (const e of N1_STATIC_RECIPIENTS) set.add(e);
  for (const e of (SALARIED_MANAGERS_BY_ACCOUNT[accountKey] || [])) set.add(e);
  if (submitterEmail) set.add(String(submitterEmail).toLowerCase());
  return [...set];
}

// ─── Formatters ───────────────────────────────────────────────────

function formatCents(cents) {
  if (typeof cents !== "number" || !isFinite(cents)) return "$?";
  const dollars = Math.round(cents) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

// One line per invoice. For CIN - AZ this is two lines (main+rehab).
function invoiceSummaryHtml(invoiceRecords) {
  const rows = invoiceRecords.map((r) => {
    const link = r.qboLink
      ? `<a href="${escapeHtml(r.qboLink)}">${escapeHtml(r.qboDocNumber || r.qboInvoiceId || "draft")}</a>`
      : escapeHtml(r.qboDocNumber || r.qboInvoiceId || "draft");
    const testMarker = r.isTest ? " <strong>TEST</strong>" : "";
    return `<tr><td>${escapeHtml(r.invoiceSlot)}${testMarker}</td><td>${link}</td><td style="text-align:right">${escapeHtml(formatCents(r.pretaxTotalCents))}</td><td style="text-align:right">${r.lineCount}</td></tr>`;
  }).join("");
  return `<table style="border-collapse:collapse; font-family:Arial,sans-serif; font-size:14px">
    <thead><tr style="background:#f4f4f4"><th style="text-align:left;padding:4px 8px">Slot</th><th style="text-align:left;padding:4px 8px">DocNumber</th><th style="text-align:right;padding:4px 8px">Pre-tax</th><th style="text-align:right;padding:4px 8px">Lines</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── N1: invoice created ──────────────────────────────────────────

/**
 * Render (dry-run) the "invoice(s) created in QBO" notification.
 *
 * @param {Object} args
 * @param {string} args.accountKey     e.g. "TXR - AZ"
 * @param {string} args.weekStart      ISO Monday of the real week
 * @param {string} args.weekEnd        ISO closing Sunday
 * @param {string} args.submitterEmail Site leader who finalized
 * @param {Array<{
 *   invoiceSlot: string, qboInvoiceId: string, qboDocNumber: string,
 *   pretaxTotalCents: number, lineCount: number, isTest: boolean,
 *   qboLink: string, ledgerRowId: string,
 * }>} args.invoiceRecords
 * @param {string} args.scWeekLink     Deep link to the SC week view
 * @param {boolean} [args.dryRunOnly=true]
 *
 * @returns {{ mode: 'dryrun'|'sent', to: string[], subject: string, html: string }}
 */
export function renderN1({ accountKey, weekStart, weekEnd, submitterEmail, invoiceRecords, scWeekLink, dryRunOnly = true }) {
  const to = n1Recipients({ accountKey, submitterEmail });
  const anyTest = invoiceRecords.some((r) => r.isTest);
  const testPrefix = anyTest ? "TEST - " : "";
  const subject = `${testPrefix}Invoice draft ready: ${accountKey} ${weekStart}..${weekEnd}`;

  const totalCents = invoiceRecords.reduce((s, r) => s + (r.pretaxTotalCents || 0), 0);

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222">
<p>Invoice draft ready in QuickBooks.</p>
<ul>
  <li><strong>Account:</strong> ${escapeHtml(accountKey)}</li>
  <li><strong>Week:</strong> ${escapeHtml(weekStart)} to ${escapeHtml(weekEnd)}</li>
  <li><strong>Pre-tax total:</strong> ${escapeHtml(formatCents(totalCents))}${anyTest ? " <strong>(TEST)</strong>" : ""}</li>
  <li><strong>Submitter:</strong> ${escapeHtml(submitterEmail || "(unknown)")}</li>
</ul>
<h4>Invoices</h4>
${invoiceSummaryHtml(invoiceRecords)}
<p><a href="${escapeHtml(scWeekLink || "")}">Open the week in Service Calendar</a></p>
<p style="color:#666;font-size:12px">The draft is NOT sent. Sebastian reviews and sends manually.</p>
${anyTest ? `<p style="color:#a00;font-weight:bold">*** TEST - NOT A REAL INVOICE - DO NOT SEND ***</p>` : ""}
</body></html>`;

  if (!dryRunOnly) {
    throw new Error("renderN1: live send not enabled in PR-C. dryRunOnly must be true.");
  }
  return { mode: "dryrun", to, subject, html };
}

// ─── N2: push failed ──────────────────────────────────────────────

/**
 * Render (dry-run) the "QBO push failed" notification. Email + Slack.
 *
 * @param {Object} args
 * @param {string} args.accountKey
 * @param {string} args.weekStart
 * @param {string} args.weekEnd
 * @param {string} args.errorText   Adapter's error message
 * @param {string} args.retryLink   Admin retry route (built by caller)
 * @param {boolean} [args.dryRunOnly=true]
 *
 * @returns {{
 *   email: { mode: 'dryrun', to: string[], subject: string, html: string },
 *   slack: { mode: 'dryrun', text: string },
 * }}
 */
export function renderN2({ accountKey, weekStart, weekEnd, errorText, retryLink, dryRunOnly = true }) {
  const to = [...N2_RECIPIENTS];
  const subject = `QBO push FAILED: ${accountKey} ${weekStart}..${weekEnd}`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222">
<p><strong>QBO invoice push failed.</strong> The week is frozen at <code>push_failed</code> until an override user retries.</p>
<ul>
  <li><strong>Account:</strong> ${escapeHtml(accountKey)}</li>
  <li><strong>Week:</strong> ${escapeHtml(weekStart)} to ${escapeHtml(weekEnd)}</li>
</ul>
<h4>Error</h4>
<pre style="background:#f4f4f4;padding:8px;border-radius:4px;overflow:auto;font-size:12px">${escapeHtml(errorText || "(no error text)")}</pre>
<p><a href="${escapeHtml(retryLink || "")}">Retry from admin</a></p>
</body></html>`;
  const slackText =
    `*QBO push FAILED*\n` +
    `• Account: \`${accountKey}\`\n` +
    `• Week: ${weekStart}..${weekEnd}\n` +
    `• Error: ${(errorText || "(no error)").replace(/`/g, "'").slice(0, 400)}\n` +
    (retryLink ? `• Retry: ${retryLink}\n` : "");

  if (!dryRunOnly) {
    throw new Error("renderN2: live send not enabled in PR-C. dryRunOnly must be true.");
  }
  return {
    email: { mode: "dryrun", to, subject, html },
    slack: { mode: "dryrun", text: slackText },
  };
}
