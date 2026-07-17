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
const PINS_TABLE          = "document_pins";
const CONTENT_TABLE       = "document_content";

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
    // Pin sort is now overlay-sourced (post-query). Keep stable secondary
    // ordering at the DB level; the JS pass below re-sorts to put pinned
    // first while preserving the secondary order within each group.
    q = q
      .order("sort_order", { ascending: true })
      .order("title",      { ascending: true });
  }

  const { data, error } = await q;
  if (error) throw new Error(`opd.listDocuments: ${error.message}`);
  const rows = data || [];
  await decoratePinned(rows, archivedOnly ? "preserve" : "sort");
  await decorateHasContent(rows);
  return rows;
}

/**
 * Attach `has_content` (boolean) to each row, sourced from document_content.
 * True iff at least one document_content row exists for the doc in any lang
 * (bilingual docs have one EN + one ES row; either counts). One batched query
 * for the whole set - no N+1. Mirrors decoratePinned's shape.
 *
 * Used by the operator catalog's alive-test (PlaybookClient.js) to decide
 * whether a Live doc is openable. Replaces the prior Drive-keyed proxy
 * (`!!source_drive_id`) - Drive is retired as an OPD content source; content
 * presence in document_content is the real signal.
 */
async function decorateHasContent(rows) {
  if (rows.length === 0) return rows;
  const sb = getServiceClient();
  const ids = rows.map((r) => r.id);
  const { data: content, error } = await sb
    .from(CONTENT_TABLE)
    .select("doc_id")
    .in("doc_id", ids);
  if (error) throw new Error(`opd.decorateHasContent: ${error.message}`);
  const contentSet = new Set((content || []).map((c) => c.doc_id));
  for (const r of rows) r.has_content = contentSet.has(r.id);
  return rows;
}

/**
 * Attach overlay-sourced `pinned` to each row, sourced from document_pins.
 * Pre-pr-7-9 the documents.pinned column was authoritative; post-pr-7-9 the
 * presence of a document_pins row is. This helper overwrites documents.pinned
 * on the returned row so the rest of the read path (and any UI rendering it)
 * sees the overlay value. documents.pinned stays in the DB but is no longer
 * read; the column drop is deferred to a later PR.
 *
 * mode:
 *   - "sort": after attaching pinned, re-sort with pinned DESC as the
 *     primary key while preserving the input ordering for ties. The DB
 *     query intentionally drops `order("pinned")` so this is the only
 *     place pinned affects ordering.
 *   - "preserve": attach pinned but do NOT re-sort (used by the archive
 *     view which has its own archived_at-first ordering and where
 *     pinned-up-top would be wrong).
 *   - "skip": attach pinned but do not query the overlay; just stamp
 *     pinned=false on every row. Used when the caller already has the
 *     overlay set (e.g., from a batched bootstrap fetch).
 */
async function decoratePinned(rows, mode = "sort") {
  if (rows.length === 0) return rows;
  const sb = getServiceClient();
  const ids = rows.map((r) => r.id);
  const { data: pins, error } = await sb
    .from(PINS_TABLE)
    .select("doc_id")
    .in("doc_id", ids);
  if (error) throw new Error(`opd.decoratePinned: ${error.message}`);
  const pinSet = new Set((pins || []).map((p) => p.doc_id));
  for (const r of rows) r.pinned = pinSet.has(r.id);
  if (mode === "sort") {
    // Stable sort: pinned first, then preserve the DB ordering (sort_order
    // ASC, title ASC) for both pinned and unpinned groups.
    rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }
  return rows;
}

/**
 * Fetch a single document by ID. Returns null if not found.
 * pinned is sourced from document_pins (the overlay), not documents.pinned.
 */
export async function getDocument(id, opts = {}) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(DOCUMENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`opd.getDocument: ${error.message}`);
  if (!data) return data;
  const { data: pin } = await sb.from(PINS_TABLE).select("doc_id").eq("doc_id", id).maybeSingle();
  data.pinned = !!pin;
  // has_content = at least one document_content row in any lang (bilingual
  // docs may have EN + ES rows; either counts). Don't use maybeSingle here -
  // it errors when count > 1. .limit(1) + array-check is safer.
  const { data: content } = await sb
    .from(CONTENT_TABLE)
    .select("doc_id")
    .eq("doc_id", id)
    .limit(1);
  data.has_content = Array.isArray(content) && content.length > 0;
  return data;
}

/**
 * Fetch rendered display HTML from document_content. Returns null when no
 * row exists for the (doc_id, lang) pair - the reader falls back to the
 * Drive iframe in that case (Phase A3 dual-path; the fallback is removed
 * in A7 once Drive retires). Populated by the A4 projection apply.
 */
export async function getDocumentContent(id, lang = "en", opts = {}) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(CONTENT_TABLE)
    .select("html, content_hash, rendered_at")
    .eq("doc_id", id)
    .eq("lang", lang)
    .maybeSingle();
  if (error) throw new Error(`opd.getDocumentContent: ${error.message}`);
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
 * Partial update. Stamps updated_at = now() at the orchestrator (the schema
 * default only fires on INSERT). Caller's patch can override updated_at
 * if a specific timestamp is needed; otherwise we set it from JS clock.
 *
 * Post-pr-7-9: `pinned` is NOT a valid field here. Pin moved to the
 * document_pins overlay; route handlers redirect `pinned` patches to
 * setPinned / clearPinned before calling this function. If a caller still
 * passes `pinned`, it lands on the documents.pinned column (kept for
 * rollback) but is no longer read.
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
  // Re-source pinned from the overlay so the returned row reflects the
  // canonical post-pr-7-9 truth (not the deprecated documents.pinned column).
  const { data: pin } = await sb.from(PINS_TABLE).select("doc_id").eq("doc_id", id).maybeSingle();
  data.pinned = !!pin;
  // Decorate has_content so callers doing an optimistic row-replace (the admin
  // worklist) don't blank the content chip on a status/pin write. Mirrors
  // getDocument. has_content = at least one document_content row in any lang.
  const { data: content } = await sb
    .from(CONTENT_TABLE)
    .select("doc_id")
    .eq("doc_id", id)
    .limit(1);
  data.has_content = Array.isArray(content) && content.length > 0;
  return data;
}

/**
 * Pin a document. Idempotent (ON CONFLICT DO NOTHING). The `pinned_by`
 * email is captured for an eventual audit / "who pinned this" surface.
 */
export async function setPinned(id, pinned_by, opts = {}) {
  const sb = getServiceClient();
  const { error } = await sb
    .from(PINS_TABLE)
    .upsert({ doc_id: id, pinned_by, pinned_at: new Date().toISOString() }, { onConflict: "doc_id" });
  if (error) throw new Error(`opd.setPinned: ${error.message}`);
}

/**
 * Unpin a document. Idempotent (no-op if not pinned).
 */
export async function clearPinned(id, opts = {}) {
  const sb = getServiceClient();
  const { error } = await sb.from(PINS_TABLE).delete().eq("doc_id", id);
  if (error) throw new Error(`opd.clearPinned: ${error.message}`);
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

// Issue status workflow (matches the document_issues CHECK constraint in
// pr-7-1-opd-schema.sql). Centralized so the route's validator + this
// orchestrator + future surfaces all read from the same source.
export const ISSUE_STATUSES = ["open", "triaged", "in_progress", "closed"];

/**
 * Triage update for an issue row. Only `status` is allowed through; the
 * status string is validated against ISSUE_STATUSES (defense in depth -
 * the route validates too) and updated_at is stamped at the orchestrator
 * because the schema default only fires on INSERT (mirrors updateDocument).
 */
export async function updateIssue(id, patch, opts = {}) {
  if (!id) throw new Error("opd.updateIssue: missing id");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("opd.updateIssue: patch must be an object");
  }
  const clean = {};
  if ("status" in patch) {
    if (!ISSUE_STATUSES.includes(patch.status)) {
      throw new Error(`opd.updateIssue: invalid status "${patch.status}"`);
    }
    clean.status = patch.status;
  }
  if (Object.keys(clean).length === 0) {
    throw new Error("opd.updateIssue: no allowed fields in patch");
  }
  clean.updated_at = new Date().toISOString();
  const sb = getServiceClient();
  const { data, error } = await sb
    .from(ISSUES_TABLE)
    .update(clean)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`opd.updateIssue: ${error.message}`);
  return data;
}
