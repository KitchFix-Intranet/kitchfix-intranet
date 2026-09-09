// ═══════════════════════════════════════════════════════════════════
// bgRecipients - pure helpers for the B&G report cron.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Extracted from the route handler so unit tests exercise the
// recipient-validation + month-resolution logic without spinning up
// a Next request. Route handler imports from here.

// ─── normalizeRecipients ────────────────────────────────────────
//
// Input: sc_qbo_account_map.bg_report_recipients (TEXT[]).
// Output: deduped, lowercased, trimmed, syntactically-valid list.
//
// An address is dropped if it:
//   - is null/undefined
//   - is empty after trim
//   - fails a bare `\S+@\S+\.\S+` shape check
//
// The shape check is intentionally permissive: Gmail SA either
// delivers or bounces at send time; we do not aim to be a full email
// validator. The check exists to catch typos ("sebastian" without
// the domain) before they reach Gmail's error path.

export function normalizeRecipients(raw) {
  const seen = new Set();
  const out = [];
  for (const entry of raw || []) {
    const trimmed = String(entry || "").trim().toLowerCase();
    if (!trimmed) continue;
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ─── splitToAndCc ───────────────────────────────────────────────
//
// Kevin ruling 2026-09-09: first slot is TO (Sebastian, currently),
// remainder is CC (TBR leadership + Kevin). Empty input returns
// empty TO + empty CC; caller checks TO length and fails loudly
// if empty.

export function splitToAndCc(normalized) {
  if (!Array.isArray(normalized) || normalized.length === 0) {
    return { to: [], cc: [] };
  }
  return { to: [normalized[0]], cc: normalized.slice(1) };
}

// ─── previousCalendarMonthISO ───────────────────────────────────
//
// The cron fires on day 4 of month M; the report covers month M-1.
// Handles year rollover (December -> November of same year;
// January -> December of previous year). All arithmetic in UTC
// because Vercel cron fires in UTC and month bounds are calendar,
// not local.

export function previousCalendarMonthISO(nowUtc = new Date()) {
  const y = nowUtc.getUTCFullYear();
  const m = nowUtc.getUTCMonth(); // 0-11
  const target = new Date(Date.UTC(y, m - 1, 1)); // JS handles rollover
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return `${ty}-${String(tm).padStart(2, "0")}`;
}
