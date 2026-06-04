// ════════════════════════════════════════════════════════════════════════════
// dataStore/opd.js — Project OPD · The Playbook (document catalog)
// ════════════════════════════════════════════════════════════════════════════
//
// PG-ONLY DOMAIN. No Sheets predecessor, no dual-write, no cutover flag.
// CUTOVER_PLAYBOOK.md scopes greenfield PG-only out of the dual-write window;
// this module is exactly that case. We talk to Postgres via getServiceClient
// directly and skip the dispatch primitives in ./shared.js.
//
// Module name (opts.module) is 'playbook'. Every function accepts opts = {}
// so callers can pass { module: 'playbook' } uniformly across the dataStore
// surface. The arg is ignored internally today because there is no Sheets
// fallback to dispatch around; it is preserved on the signature so that
// (a) callers don't special-case OPD, and (b) any future cross-cutting
// concern (per-module logging, instrumentation, an eventual second backend)
// has a place to land without breaking call sites.
//
// data_provenance defaults to 'manual_entry' in the schema (pr-7-1-opd-schema.sql)
// for app writes; this file does not set it explicitly. Seeded/historical
// rows are marked 'batch_rebuild' + is_historical=TRUE by the seed (pr-7-2).
// ════════════════════════════════════════════════════════════════════════════

import { getServiceClient } from "@/lib/supabase";

const DOCUMENTS_TABLE     = "documents";
const RELATIONSHIPS_TABLE = "document_relationships";
const SURFACES_TABLE      = "document_surfaces";
const ISSUES_TABLE        = "document_issues";

// Doc IDs are stable text handles (PB-006, SOP-002, REF-005-A, LEGACY-PR ...).
// Strict A-Z/0-9/hyphen pattern. Used to gate the only place we interpolate
// an id into a PostgREST .or() filter string (getRelationships). The Supabase
// JS client escapes parameter values for .eq() / .in() / .ilike() etc., but
// .or() accepts a single filter expression as a raw string, so we validate
// before composing instead of trusting the caller.
const DOC_ID_RE = /^[A-Z0-9-]+$/;

// ─── Reads ────────────────────────────────────────────────────────────────

/**
 * List documents on a shelf (or across all shelves), filtered to a status set.
 *
 * Two mutually-exclusive modes via `archivedOnly`:
 *   - archivedOnly: false (default) - operator/admin worklist view. Excludes
 *     archived docs and Retired status. Filters by `statuses` (defaults to
 *     ['Live'] if absent so the failure mode is the most restrictive view).
 *     Ordering: pinned DESC, sort_order ASC, title ASC.
 *   - archivedOnly: true - admin archive view. Returns ONLY archived docs.
 *     Ordering: archived_at DESC (most-recently-archived first), id ASC.
 *
 * No "both" mode - the operator view always wants active docs, the archive
 * view always wants archived docs. Mixing them would muddle the UX.
 *
 * Retired is never returned in the active mode — STD-005 §3.5. The caller
 * passes the visible statuses from opdAcl.visibleStatuses(isCorporate);
 * archived docs are excluded in active mode regardless of status (the
 * `archived` flag is orthogonal to status by design).
 */
export async function listDocuments(
  { shelf, statuses, archivedOnly = false } = {},
  opts = {}
) {
  const sb = getServiceClient();
  let q = sb.from(DOCUMENTS_TABLE).select("*");

  if (archivedOnly) {
    q = q
      .eq("archived", true)
      .order("archived_at", { ascending: false })
      .order("id",          { ascending: true });
  } else {
    const stats = statuses && statuses.length ? statuses : ["Live"];
    q = q
      .eq("archived", false)
      .neq("status", "Retired")
      .in("status", stats);
    if (shelf) q = q.eq("shelf", shelf);
    q = q
      .order("pinned",     { ascending: false })
      .order("sort_order", { ascending: true })
      .order("title",      { ascending: true });
  }

  const { data, error } = await q;
  if (error) throw new Error(`opd.listDocuments: ${error.message}`);
  return data || [];
}

/**
 * Fetch a single document by ID. Returns null if not found.
 */
export async function getDocument(id, opts = {}) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(DOCUMENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`opd.getDocument: ${error.message}`);
  return data;
}

/**
 * Get all relationships touching a document — both directions
 * (from_doc = id OR to_doc = id). Returns the full edge rows so the
 * caller can render the "other" side and the rel_type.
 *
 * The id is validated against DOC_ID_RE before interpolation. PostgREST's
 * .or() filter takes a raw expression string (no parameter binding), so
 * the validation IS the escape. Throws on invalid input rather than
 * silently returning [] — a malformed id is a caller bug we want to
 * surface, not paper over.
 */
export async function getRelationships(id, opts = {}) {
  if (!DOC_ID_RE.test(String(id || ""))) {
    throw new Error(
      `opd.getRelationships: invalid document id "${id}" (must match ${DOC_ID_RE})`
    );
  }
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(RELATIONSHIPS_TABLE)
    .select("*")
    .or(`from_doc.eq.${id},to_doc.eq.${id}`);
  if (error) throw new Error(`opd.getRelationships: ${error.message}`);
  return data || [];
}

/**
 * Return the list of surface names a document appears on.
 * Strings only — callers that need the full row should query directly.
 */
export async function getSurfaces(id, opts = {}) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(SURFACES_TABLE)
    .select("surface")
    .eq("doc_id", id);
  if (error) throw new Error(`opd.getSurfaces: ${error.message}`);
  return (data || []).map((r) => r.surface);
}

/**
 * Inverse of getSurfaces: return the documents that appear on a given
 * surface. Uses the document_surfaces.doc_id FK to embed the documents
 * row via Supabase's PostgREST join syntax.
 */
export async function getDocumentsForSurface(surface, opts = {}) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(SURFACES_TABLE)
    .select(`doc_id, documents (*)`)
    .eq("surface", surface);
  if (error) throw new Error(`opd.getDocumentsForSurface: ${error.message}`);
  return (data || []).map((r) => r.documents).filter(Boolean);
}

/**
 * Triage queue read for the issues table. Filter by status when provided.
 * Newest first.
 */
export async function listIssues({ status } = {}, opts = {}) {
  const sb = getServiceClient();
  let q = sb.from(ISSUES_TABLE).select("*");
  if (status) q = q.eq("status", status);
  q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(`opd.listIssues: ${error.message}`);
  return data || [];
}

// ─── Writes ───────────────────────────────────────────────────────────────

/**
 * Insert a new document row. The caller supplies the TEXT primary key
 * (e.g. 'PB-007') — there is no surrogate UUID. Schema defaults fire for
 * data_provenance ('manual_entry'), is_historical (false), created_at,
 * and updated_at when those keys are absent from `data`.
 *
 * Throws on FK / CHECK / chk_live_complete violations — callers should
 * pre-validate or surface the PG error to the operator.
 */
export async function createDocument(data, opts = {}) {
  const sb = getServiceClient();
  const { data: row, error } = await sb
    .from(DOCUMENTS_TABLE)
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(`opd.createDocument: ${error.message}`);
  return row;
}

/**
 * Partial update. Stamps updated_at = now() at the orchestrator (the schema
 * default only fires on INSERT). Caller's patch can override updated_at
 * if a specific timestamp is needed; otherwise we set it from JS clock.
 */
export async function updateDocument(id, patch, opts = {}) {
  const sb = getServiceClient();
  const withTimestamp = { updated_at: new Date().toISOString(), ...patch };
  const { data, error } = await sb
    .from(DOCUMENTS_TABLE)
    .update(withTimestamp)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`opd.updateDocument: ${error.message}`);
  return data;
}

/**
 * File an issue against a document. The route handler is responsible
 * for the Slack ping (STD-005 §7.3); this function only inserts the row
 * and returns it so the route has the issue id for the Slack message.
 *
 * Schema defaults fire for id (UUID), status ('open'), created_at,
 * updated_at, data_provenance ('manual_entry'), is_historical (false).
 */
export async function createIssue(
  { doc_id, reporter_email, issue_text },
  opts = {}
) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(ISSUES_TABLE)
    .insert({ doc_id, reporter_email, issue_text })
    .select()
    .single();
  if (error) throw new Error(`opd.createIssue: ${error.message}`);
  return data;
}
