// ═══════════════════════════════════════════════════════════════════
// chasePersonName - resolve ONE person to name in the chase Slack line.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Purpose: the chase Slack line reads "Reminder sent to Joe Coppolino"
// or "Chased Joe Coppolino" per the render. It names one person. This
// module derives that scalar; the email recipient TO field uses the
// full salaried list (Kevin ruling 2026-09-09).
//
// Chain (each step falls through on empty or invalid):
//   1. Most recent operator email in sc_daily_actuals for the target
//      week + account. "Operator email" = created_by matching `%@%`
//      (excludes 'spreadsheet_seed', 'import-script', 'invoice_reconcile',
//      and other non-person authors that dominate the ledger today -
//      96-97% of TBR/TBJ rows are seeded, not typed).
//   2. Site leader of record: people.work_email where
//      is_site_leader=true AND status='ACTIVE'. Every training-week
//      account has exactly one today (TBR=Joe Coppolino, TBJ=Diego Diaz).
//   3. First entry in sc_qbo_account_map.salaried_manager_emails
//      after active-staff filter. Guaranteed non-empty for every SC
//      account today.
//
// Active-staff validation is applied at every step: an email is
// only accepted if a matching ACTIVE row exists in people. A departed
// operator's address stays on old sc_daily_actuals rows forever;
// naming them in the Slack line would confuse Kevin about who
// actually got the email (which uses the salaried list, so a
// departed person doesn't get the email either - the mismatch would
// be Slack-only).
//
// Returns { email, displayName, source } or null if no fallback
// works (which cannot happen given every SC account has salaried
// managers). null return is treated by callers as "No site recipient
// configured" in the Slack body.

import { getServiceClient } from "@/lib/supabase";

/**
 * @param {object} args
 * @param {string} args.accountKey   e.g. "TBR - FL"
 * @param {string} args.weekStart    ISO YYYY-MM-DD Monday
 * @param {string} args.weekEnd      ISO YYYY-MM-DD Sunday
 * @param {string[]} args.salariedManagerEmails  fallback list
 * @returns {Promise<{ email: string, displayName: string, source: string } | null>}
 */
export async function resolveChasePersonName({ accountKey, weekStart, weekEnd, salariedManagerEmails = [] }) {
  const supa = getServiceClient();

  // Pull the two person-shaped tables in parallel:
  //   activePeople: every ACTIVE row for the account with a work_email
  //   siteLeader:   the account's is_site_leader=true row
  const [peopleRes, actualsRes] = await Promise.all([
    supa.from("people")
      .select("work_email, display_name, is_site_leader")
      .eq("account_key", accountKey)
      .eq("status", "ACTIVE")
      .not("work_email", "is", null),
    supa.from("sc_daily_actuals")
      .select("created_by, created_at")
      .eq("account_key", accountKey)
      .gte("service_date", weekStart)
      .lte("service_date", weekEnd)
      .like("created_by", "%@%")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const activeByEmail = new Map();
  const siteLeaderRow = { email: null, displayName: null };
  for (const p of peopleRes.data || []) {
    const email = String(p.work_email).toLowerCase();
    activeByEmail.set(email, { email, displayName: p.display_name });
    if (p.is_site_leader && !siteLeaderRow.email) {
      siteLeaderRow.email = email;
      siteLeaderRow.displayName = p.display_name;
    }
  }

  // Step 1 - most recent operator email for this week's actuals.
  const recentAuthorEmail = actualsRes.data?.[0]?.created_by
    ? String(actualsRes.data[0].created_by).toLowerCase()
    : null;
  if (recentAuthorEmail && activeByEmail.has(recentAuthorEmail)) {
    const p = activeByEmail.get(recentAuthorEmail);
    return { email: p.email, displayName: p.displayName || p.email, source: "recent_submitter" };
  }

  // Step 2 - site leader.
  if (siteLeaderRow.email) {
    return {
      email: siteLeaderRow.email,
      displayName: siteLeaderRow.displayName || siteLeaderRow.email,
      source: "site_leader",
    };
  }

  // Step 3 - first ACTIVE-validated entry in the salaried list.
  const salariedLower = (salariedManagerEmails || []).map((e) => String(e).toLowerCase());
  for (const email of salariedLower) {
    if (activeByEmail.has(email)) {
      const p = activeByEmail.get(email);
      return { email: p.email, displayName: p.displayName || p.email, source: "first_salaried" };
    }
  }

  // Nothing resolved. Callers render this as "No site recipient
  // configured" - a real signal that surfaces on Slack rather than
  // a silent no-recipient send.
  return null;
}
