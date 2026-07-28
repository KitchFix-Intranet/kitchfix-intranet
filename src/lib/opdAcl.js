// ─────────────────────────────────────────────────────────────────────────────
// src/lib/opdAcl.js
// Project OPD · access control for The Playbook (/playbook)
// ─────────────────────────────────────────────────────────────────────────────
//
// Enforces three things, all app-layer (Postgres uses the service-role client,
// which bypasses RLS — so RLS cannot be the boundary today):
//
//   1. PAGE GATE — the whole /playbook route is owner-only until launch.
//   2. STATUS VISIBILITY — CORP sees in-build/draft etc.; everyone else sees
//      Live only. Retired is never shown to any operator view (STD-005 §3.5).
//   3. ACCESS TIER (pr-7-11) — hierarchical 3-tier gate on documents.access_level
//      (unrestricted / restricted / slt). Membership lists are HARDCODED here
//      so changes are auditable through git. Resolver functions below; called
//      by the bootstrap filter, the document detail handler, and the SousAI
//      retrieval RPC's allowed_levels argument.
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

// ── Sous Reports viewer allowlist ─────────────────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for who sees /sousai/reports. Both the page gate
// (src/app/sousai/reports/page.js) and the profile-dropdown nav link
// (src/components/TopNav.js, resolved server-side in src/app/layout.js) call
// canViewSousReports(email). Widening happens here or in the env var; there
// is no third surface to keep in sync. A link that renders for someone who
// then gets a 404 would be a bug, and two independent gates guarantee that
// bug eventually - so there is only one gate.
//
// Env var: SOUSAI_REPORTS_VIEWERS
//   Comma-separated emails. Case-insensitive compare, per-item trimmed.
//   Empty items dropped. Whitespace-only value treated as unset.
//
// Fail-closed default: when SOUSAI_REPORTS_VIEWERS is unset, empty, or
// whitespace-only, the allowlist collapses to SOUS_REPORTS_DEFAULT_VIEWERS
// (Kevin only). A missing env var must never widen access.

export const SOUS_REPORTS_DEFAULT_VIEWERS = Object.freeze(['k.fietek@kitchfix.com']);

function parseSousReportsViewers(raw) {
  if (typeof raw !== 'string') return SOUS_REPORTS_DEFAULT_VIEWERS;
  const items = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : SOUS_REPORTS_DEFAULT_VIEWERS;
}

export function canViewSousReports(actualEmail) {
  const email = (actualEmail || '').toLowerCase().trim();
  if (!email) return false;
  const allowlist = parseSousReportsViewers(process.env.SOUSAI_REPORTS_VIEWERS);
  return allowlist.includes(email);
}

// ── pr-7-11: 3-tier access gate ─────────────────────────────────────────────
//
// Hierarchical. A viewer sees their tier AND all tiers below:
//   slt          - SLT group only
//   restricted   - Restricted group + SLT group
//   unrestricted - any authenticated @kitchfix.com session
//
// Membership is intentionally hardcoded so changes are visible in git diffs
// and rolled out via the same review process as any other code change. Adding
// a person to either group is a 1-line PR. The Sets MUST stay lowercased so
// the comparison against session.user.email.toLowerCase() is straightforward.
//
// Identity = authenticated session email only, NEVER a self-reported value.
// Callers pass the same `actualEmail` the page-gate consumes.

// SLT - sees all three tiers (the apex of the hierarchy).
// 6 members confirmed against contacts.team_key='CORP' 2026-06-16.
export const SLT_EMAILS = Object.freeze(new Set([
  'k.fietek@kitchfix.com',     // Kevin Fietek - Director of Operations
  'josh@kitchfix.com',         // Joshua Katt - CEO
  'joe@kitchfix.com',          // Joseph Lessard - VP Operations
  'britt@kitchfix.com',        // Brittany Chernikovich - Director of Culinary
  'm.chavez@kitchfix.com',     // Mariela Chavez - Human Resources
  's.castro@kitchfix.com',     // Sebastian Castro - Staff Accountant
]));

// Restricted (additional, NOT including SLT - viewerTier returns the highest
// tier the email qualifies for, and the hierarchy is enforced by numeric
// comparison, not by duplicating people across lists).
// 3 members confirmed against contacts.team_key='CORP' 2026-06-16.
export const RESTRICTED_EMAILS = Object.freeze(new Set([
  'r.moore@kitchfix.com',      // Ryan Moore - Regional Director West
  's.lynch@kitchfix.com',      // Shane Lynch - Regional Director East
  'd.inthavone@kitchfix.com',  // Dec Inthavone - Corporate Field Chef
]));

// Numeric order is what makes the gate hierarchical. canSeeDoc compares
// viewer tier ORDER to doc access_level ORDER; viewer >= doc => allowed.
// Frozen so a runtime override mistake is loud.
export const ACCESS_ORDER = Object.freeze({
  unrestricted: 1,
  restricted:   2,
  slt:          3,
});

/**
 * Resolve the highest tier an authenticated email qualifies for.
 * Always lowercases the input so the caller can pass session.user.email raw.
 * Returns 'unrestricted' for any falsy or unknown email - the page-gate
 * (canViewPlaybook) is what enforces "is this a logged-in @kitchfix.com
 * session at all"; this function answers "given they're logged in, what
 * tier do they see?".
 */
export function viewerTier(email) {
  const lower = (email || '').toLowerCase().trim();
  if (SLT_EMAILS.has(lower)) return 'slt';
  if (RESTRICTED_EMAILS.has(lower)) return 'restricted';
  return 'unrestricted';
}

/**
 * Hierarchical gate decision.
 * Returns true iff the viewer's tier rank is >= the doc's access_level rank.
 * A null/undefined docAccessLevel defaults to 'unrestricted' (safe default;
 * matches the schema's NOT NULL DEFAULT 'unrestricted'). Unknown values on
 * either side return false (fail-closed).
 *
 * This is the ONLY place the tier comparison is performed. The three
 * enforcement call sites (bootstrap filter, detail handler, SousAI RPC
 * via allowedAccessLevels) all delegate here so the rule has one home.
 */
export function canSeeDoc(viewerT, docAccessLevel) {
  const dLevel = docAccessLevel || 'unrestricted';
  const v = ACCESS_ORDER[viewerT];
  const d = ACCESS_ORDER[dLevel];
  if (!v || !d) return false;
  return v >= d;
}

/**
 * The set of access_level values a viewer is permitted to see, in the shape
 * the match_document_chunks RPC expects (allowed_levels TEXT[]). Lets the
 * SousAI retrieval call site pass a single resolver-produced array.
 */
export function allowedAccessLevels(viewerT) {
  return Object.entries(ACCESS_ORDER)
    .filter(([, rank]) => rank <= (ACCESS_ORDER[viewerT] || 0))
    .map(([level]) => level);
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
