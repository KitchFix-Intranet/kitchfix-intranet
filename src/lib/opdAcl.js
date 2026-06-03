// ─────────────────────────────────────────────────────────────────────────────
// src/lib/opdAcl.js
// Project OPD · access control for The Playbook (/playbook)
// ─────────────────────────────────────────────────────────────────────────────
//
// v1 enforces exactly TWO things, both app-layer (Postgres uses the service-role
// client, which bypasses RLS — so RLS cannot be the boundary today):
//
//   1. PAGE GATE — the whole /playbook route is owner-only until launch.
//   2. DOCUMENT AUDIENCE — CORP sees Drafts (and other non-Live); everyone else
//      sees Live only. Retired is never shown to any operator view (STD-005 §3.5).
//
// Shape mirrors src/lib/performanceAcl.js: synchronous pure functions for the
// decisions, one isolated async function for the single DB lookup.
//
// SWAP POINT: audience is derived today from the live `contacts` table
// (team_key === 'CORP'). When AUTH_MODEL.md ships the `users` table, replace the
// body of isCorporateEmail() with a users.role lookup — nothing else changes.
// ─────────────────────────────────────────────────────────────────────────────

import { getServiceClient } from './supabase.js';

// ── Synchronous (pure) ───────────────────────────────────────────────────────

// Page gate. Owner-only for v1. Takes the ACTUAL authenticated email, never an
// impersonated/effective one — mirrors performanceAcl's system-viewer asymmetry so
// the gate can't be escalated if impersonation is ever added. Widen or remove at launch.
export const PLAYBOOK_OWNER = 'k.fietek@kitchfix.com';

export function canViewPlaybook(actualEmail) {
  return (actualEmail || '').toLowerCase() === PLAYBOOK_OWNER;
}

// Statuses a viewer may see. Retired is excluded for everyone (STD-005 §3.5).
export function visibleStatuses(isCorporate) {
  if (isCorporate) {
    return ['Live', 'In Build', 'Draft', 'Pending', 'Placeholder', 'Blocked'];
  }
  return ['Live'];
}

// Filter a list of catalog rows once the corporate flag is resolved.
export function filterDocuments(documents, isCorporate) {
  const allowed = new Set(visibleStatuses(isCorporate));
  return (documents || []).filter(
    (d) => d.status !== 'Retired' && allowed.has(d.status)
  );
}

// ── Async (single DB lookup) ─────────────────────────────────────────────────

// v1 audience source of truth: contacts.team_key === 'CORP'.
// Fails CLOSED (denies Drafts) on lookup error — never leak in-progress docs.
export async function isCorporateEmail(email) {
  if (!email) return false;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('contacts')
    .select('team_key')
    .ilike('email', email)
    .limit(1);
  if (error) {
    console.error('[opdAcl] isCorporateEmail lookup failed:', error.message);
    return false;
  }
  return (data?.[0]?.team_key || '').toUpperCase() === 'CORP';
}

// ── Convenience ──────────────────────────────────────────────────────────────

// Resolve audience + filter in one call (single DB hit for the flag).
export async function visibleDocumentsForUser(email, documents) {
  const corp = await isCorporateEmail(email);
  return filterDocuments(documents, corp);
}
