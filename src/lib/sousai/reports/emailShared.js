// ═══════════════════════════════════════════════════════════════════════════
// src/lib/sousai/reports/emailShared.js
// Shared helpers for the sousai-weekly and sousai-monthly cron routes.
// ═══════════════════════════════════════════════════════════════════════════
//
// resolveRecipients - reads SOUSAI_REPORT_RECIPIENTS with a fail-closed
// default to k.fietek@kitchfix.com. Same shape as opdAcl.js's
// canViewSousReports allowlist parser (per-item trim, empty-drop,
// whitespace-only treated as unset).
//
// senderIdentity - constant sender + display name for the digests. Uses the
// service-account mailbox setup Kevin has already configured (see the
// invoice-related sendEmailSA callers - they impersonate a fixed sender via
// GOOGLE_PRIVATE_KEY / GOOGLE_SERVICE_ACCOUNT_EMAIL).
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_RECIPIENTS = Object.freeze(["k.fietek@kitchfix.com"]);
const DEFAULT_SENDER = "k.fietek@kitchfix.com";
const DEFAULT_DISPLAY_NAME = "Sous Reports";

export function resolveRecipients() {
  const raw = process.env.SOUSAI_REPORT_RECIPIENTS;
  if (typeof raw !== "string") return [...DEFAULT_RECIPIENTS];
  const items = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : [...DEFAULT_RECIPIENTS];
}

export function senderIdentity() {
  return {
    sender: process.env.SOUSAI_REPORT_SENDER || DEFAULT_SENDER,
    displayName: DEFAULT_DISPLAY_NAME,
  };
}
