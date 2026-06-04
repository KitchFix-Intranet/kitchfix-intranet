// ════════════════════════════════════════════════════════════════════════════
// /api/playbook · Project OPD · The Playbook
// ════════════════════════════════════════════════════════════════════════════
//
// Three actions:
//   GET  ?action=bootstrap            → { email, isOwner, shelves, documents }
//   GET  ?action=document&id=<DOC-ID> → { document, relationships, surfaces,
//                                          drive_view_url, drive_preview_url }
//   POST ?action=report-issue         → { ok, issue_id }   (writes document_issues
//                                          + Slack ping; reporter_email from session,
//                                          NEVER from client body — mirrors page gate's
//                                          actual-email asymmetry)
//
// Auth: middleware.js redirects unauthenticated requests to /login already.
// Page gate: canViewPlaybook(session.user.email) — non-owner gets a minimal
// bootstrap payload so the client can render the coming-soon stub in one
// round-trip. document/report-issue return 403 to non-owners.
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  listDocuments,
  getDocument,
  getRelationships,
  getSurfaces,
  createIssue,
  createDocument,
  updateDocument,
} from "@/lib/dataStore";
import {
  canViewPlaybook,
  isCorporateEmail,
  visibleStatuses,
  filterDocuments,
} from "@/lib/opdAcl";
import { getServiceClient } from "@/lib/supabase";
import {
  embedDocument,
  embedPosterStub,
  restoreDocument,
  SKIP_TEXT_EXTRACTION_CLASSES,
} from "@/lib/sousai";
import { validateCreatePayload } from "@/lib/playbookValidation";

// Locked shelf order - Safety first, Site & Client last. Brand & Standards
// + Finance sit together as the internal/meta pair before Site & Client;
// Finance still renders empty/short.
const SHELVES = [
  "Safety",
  "Operations",
  "HR & People",
  "Culinary",
  "Brand & Standards",
  "Finance",
  "Site & Client",
];

const MODULE = "playbook";

// ─── Editing allowlist + validation sets (action=update-document) ───────────
//
// The owner edits catalog fields directly from /playbook/admin's worklist:
//   Part A (auto-commit, optimistic):  title, shelf, doc_class, status, version, pinned
//   Part B (explicit Save, confirmed): source_drive_id, source_drive_id_es
//
// The set is HARD - `id` is still explicitly NOT in here so an attempt to
// write it returns 400 even if the client forges it. ID renames stay a
// deliberate scripted operation (see pr-7-5 atomic POST-003 -> POSTER-001).
//
// Per-field value validators mirror the schema CHECK constraints + the
// implicit "Drive ID is a string or null" shape. The schema
// (pr-7-1-opd-schema.sql + pr-7-4 bilingual columns) is still the source of
// truth; these sets just cache the same allowed values for fast 400s instead
// of round-tripping a Postgres constraint violation. Drive IDs have no
// schema-side format check - any string is a valid catalog value (a wrong
// or unshared ID is a SEMANTIC failure that the test-render link in the
// dashboard surfaces, not a DB error).
const WRITABLE_FIELDS_A = new Set([
  "title", "shelf", "doc_class", "status", "version", "pinned",
  "source_drive_id", "source_drive_id_es",
]);
const VALID_SHELVES_SET = new Set(SHELVES);
const VALID_CLASSES = new Set([
  "PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK",
]);
const VALID_STATUSES = new Set([
  "Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired",
]);

function validatePatch(patch) {
  // Returns { ok: true, clean } on success or { ok: false, error } on failure.
  // `clean` is the canonicalized patch (whitespace-trimmed strings, etc.) so
  // the caller can pass it straight to updateDocument without re-massaging.
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "patch must be a non-null object" };
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return { ok: false, error: "patch is empty - no fields to update" };
  }
  for (const k of keys) {
    if (!WRITABLE_FIELDS_A.has(k)) {
      // Hard reject - covers id, source_drive_id*, storage_path*, anything else
      // not in the Part A allowlist. The reason `id` lands here is structural,
      // not stylistic: renaming the PK is a multi-table transaction (pr-7-5),
      // not a single .update().
      return { ok: false, error: `field '${k}' is not writable via this action` };
    }
  }
  const clean = {};
  if ("title" in patch) {
    if (typeof patch.title !== "string" || !patch.title.trim()) {
      return { ok: false, error: "title must be a non-empty string" };
    }
    clean.title = patch.title.trim();
  }
  if ("shelf" in patch) {
    if (patch.shelf !== null && !VALID_SHELVES_SET.has(patch.shelf)) {
      return { ok: false, error: `invalid shelf '${patch.shelf}'` };
    }
    clean.shelf = patch.shelf;
  }
  if ("doc_class" in patch) {
    if (!VALID_CLASSES.has(patch.doc_class)) {
      return { ok: false, error: `invalid doc_class '${patch.doc_class}'` };
    }
    clean.doc_class = patch.doc_class;
  }
  if ("status" in patch) {
    if (!VALID_STATUSES.has(patch.status)) {
      return { ok: false, error: `invalid status '${patch.status}'` };
    }
    clean.status = patch.status;
  }
  if ("version" in patch) {
    if (patch.version === null) {
      clean.version = null;
    } else if (typeof patch.version === "string") {
      const trimmed = patch.version.trim();
      clean.version = trimmed.length === 0 ? null : trimmed;
    } else {
      return { ok: false, error: "version must be a string or null" };
    }
  }
  if ("pinned" in patch) {
    if (typeof patch.pinned !== "boolean") {
      return { ok: false, error: "pinned must be a boolean" };
    }
    clean.pinned = patch.pinned;
  }
  // Drive ID fields (Part B): nullable strings. Empty / whitespace-only
  // values get canonicalized to NULL so an "unlink" is the natural result
  // of clearing the input. No format validation - Drive IDs vary in length
  // and shape across Drive's URL generations, and the test-render link in
  // the dashboard catches semantically wrong values much better than any
  // regex would.
  if ("source_drive_id" in patch) {
    if (patch.source_drive_id === null) {
      clean.source_drive_id = null;
    } else if (typeof patch.source_drive_id === "string") {
      const trimmed = patch.source_drive_id.trim();
      clean.source_drive_id = trimmed.length === 0 ? null : trimmed;
    } else {
      return { ok: false, error: "source_drive_id must be a string or null" };
    }
  }
  if ("source_drive_id_es" in patch) {
    if (patch.source_drive_id_es === null) {
      clean.source_drive_id_es = null;
    } else if (typeof patch.source_drive_id_es === "string") {
      const trimmed = patch.source_drive_id_es.trim();
      clean.source_drive_id_es = trimmed.length === 0 ? null : trimmed;
    } else {
      return { ok: false, error: "source_drive_id_es must be a string or null" };
    }
  }
  return { ok: true, clean };
}

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const actualEmail = session.user.email.toLowerCase().trim();
  const isOwner = canViewPlaybook(actualEmail);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    // ── bootstrap ────────────────────────────────────────────────────────
    if (action === "bootstrap") {
      // Non-owner: minimal payload, client shows coming-soon stub.
      if (!isOwner) {
        return NextResponse.json({
          email: actualEmail,
          isOwner: false,
          shelves: SHELVES,
          documents: [],
        });
      }

      // Owner: full visible-doc set with audience filter applied server-side.
      const isCorp = await isCorporateEmail(actualEmail);
      const allDocs = await listDocuments(
        { statuses: visibleStatuses(isCorp) },
        { module: MODULE }
      );
      const visible = filterDocuments(allDocs, isCorp);
      return NextResponse.json({
        email: actualEmail,
        isOwner: true,
        shelves: SHELVES,
        documents: visible,
      });
    }

    // ── document detail ─────────────────────────────────────────────────
    if (action === "document") {
      if (!isOwner) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }
      const [doc, rels, surfs] = await Promise.all([
        getDocument(id, { module: MODULE }),
        getRelationships(id, { module: MODULE }),
        getSurfaces(id, { module: MODULE }),
      ]);
      if (!doc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // Enrich each relationship with the "other" doc's title + class for
      // display. One batched read per call.
      const otherIds = [
        ...new Set(
          rels.flatMap((r) => [r.from_doc, r.to_doc]).filter((x) => x !== id)
        ),
      ];
      const otherDocs = await Promise.all(
        otherIds.map((oid) => getDocument(oid, { module: MODULE }))
      );
      const otherMap = Object.fromEntries(
        otherDocs.filter(Boolean).map((d) => [d.id, d])
      );
      const enriched = rels.map((r) => {
        const otherId = r.from_doc === id ? r.to_doc : r.from_doc;
        const direction = r.from_doc === id ? "out" : "in";
        const other = otherMap[otherId];
        return {
          rel_type: r.rel_type,
          direction,
          other_id: otherId,
          other_title: other?.title || otherId,
          other_class: other?.doc_class || null,
          other_status: other?.status || null,
        };
      });

      const driveViewUrl = doc.source_drive_id
        ? `https://drive.google.com/file/d/${doc.source_drive_id}/view`
        : null;
      const drivePreviewUrl = doc.source_drive_id
        ? `https://drive.google.com/file/d/${doc.source_drive_id}/preview`
        : null;
      // ES URLs mirror the EN ones for bilingual docs (POSTER-001 is the
      // first). Both are null on the vast majority of rows; the reader
      // only renders an EN/ES toggle when both EN + ES previews exist.
      const driveViewUrlEs = doc.source_drive_id_es
        ? `https://drive.google.com/file/d/${doc.source_drive_id_es}/view`
        : null;
      const drivePreviewUrlEs = doc.source_drive_id_es
        ? `https://drive.google.com/file/d/${doc.source_drive_id_es}/preview`
        : null;

      return NextResponse.json({
        document: doc,
        relationships: enriched,
        surfaces: surfs,
        drive_view_url: driveViewUrl,
        drive_preview_url: drivePreviewUrl,
        drive_view_url_es: driveViewUrlEs,
        drive_preview_url_es: drivePreviewUrlEs,
      });
    }

    // ── list-archived ────────────────────────────────────────────────────
    // Admin archive view: owner-only. Returns just archived docs, ordered
    // archived_at DESC (most-recently-archived first). Lazy-loaded by the
    // admin client when the user clicks the Archive tab.
    if (action === "list-archived") {
      if (!isOwner) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const archived = await listDocuments(
        { archivedOnly: true },
        { module: MODULE }
      );
      return NextResponse.json({ documents: archived });
    }

    // ── archive-impact ───────────────────────────────────────────────────
    // Read-only inspection: returns incoming relationships (other docs that
    // point AT this one) + chunk count for the confirmation dialog. No
    // state change. The relationships are FYI - archive preserves them
    // because the doc row stays in the table; the references aren't broken,
    // they just point to a hidden doc.
    if (action === "archive-impact") {
      if (!isOwner) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }
      const doc = await getDocument(id, { module: MODULE });
      if (!doc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const allRels = await getRelationships(id, { module: MODULE });
      const incoming = allRels.filter((r) => r.to_doc === id);
      const fromIds = [...new Set(incoming.map((r) => r.from_doc))];
      const fromDocs = await Promise.all(
        fromIds.map((fid) => getDocument(fid, { module: MODULE }))
      );
      const fromMap = Object.fromEntries(
        fromDocs.filter(Boolean).map((d) => [d.id, d])
      );
      const incoming_relationships = incoming.map((r) => ({
        rel_type: r.rel_type,
        from_doc: r.from_doc,
        from_title: fromMap[r.from_doc]?.title || r.from_doc,
        from_class: fromMap[r.from_doc]?.doc_class || null,
      }));

      const sb = getServiceClient();
      const { count: chunks_count } = await sb
        .from("document_chunks")
        .select("*", { count: "exact", head: true })
        .eq("doc_id", id);

      return NextResponse.json({
        document_id: id,
        title: doc.title,
        incoming_relationships,
        chunks_count: chunks_count || 0,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[playbook GET]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const actualEmail = session.user.email.toLowerCase().trim();
  if (!canViewPlaybook(actualEmail)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // ── report-issue ────────────────────────────────────────────────────
    if (action === "report-issue") {
      const { doc_id, issue_text } = body;
      if (!doc_id || !issue_text || !String(issue_text).trim()) {
        return NextResponse.json(
          { error: "Missing doc_id or issue_text" },
          { status: 400 }
        );
      }

      const issue = await createIssue(
        {
          doc_id,
          // reporter_email comes from the authenticated session — NEVER from
          // the client body. Mirrors the page-gate's actual-email asymmetry.
          reporter_email: actualEmail,
          issue_text: String(issue_text).trim(),
        },
        { module: MODULE }
      );

      // Slack ping (non-blocking, best-effort). Prefers OPD-specific channel;
      // falls back to the existing help channel so report-issue works out of
      // the box even before SLACK_OPD_WEBHOOK is set in Vercel env.
      const webhook =
        process.env.SLACK_OPD_WEBHOOK || process.env.SLACK_HELP_WEBHOOK;
      if (webhook) {
        const doc = await getDocument(doc_id, { module: MODULE }).catch(
          () => null
        );
        const docTitle = doc?.title || doc_id;
        fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Playbook issue filed: ${docTitle}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Playbook issue filed*\n*Document:* \`${doc_id}\` — ${docTitle}\n*Reporter:* ${actualEmail}\n*Issue:* ${String(
                    issue_text
                  ).trim()}`,
                },
              },
            ],
          }),
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true, issue_id: issue.id });
    }

    // ── update-document ─────────────────────────────────────────────────
    // Owner-gated catalog editing path used by /playbook/admin's worklist.
    // The owner gate (canViewPlaybook) is enforced at the TOP of the POST
    // handler, server-side, against session.user.email - it is re-checked
    // on every request. A client cannot bypass it by lying about isOwner.
    if (action === "update-document") {
      const { id, patch } = body;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
      }
      const v = validatePatch(patch);
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
      // updateDocument throws on PG errors (FK / CHECK / row-not-found surfaces
      // an error.message that bubbles up). It also stamps updated_at and runs
      // .select().single() so the returned row reflects the actual post-write
      // state - that's our read-validate.
      let updated;
      try {
        updated = await updateDocument(id, v.clean, { module: MODULE });
      } catch (e) {
        // Distinguish "row missing" from generic write errors so the client
        // can react sensibly (e.g. dropdown still showed a stale id).
        const msg = e?.message || "update failed";
        if (/no rows|0 rows|PGRST116/i.test(msg)) {
          return NextResponse.json({ error: `Document ${id} not found` }, { status: 404 });
        }
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      return NextResponse.json({ ok: true, document: updated });
    }

    // ── archive ──────────────────────────────────────────────────────────
    // Calls the archive_document(p_doc_id) RPC. The RPC atomically flips
    // archived=true AND deletes all document_chunks for the doc in ONE
    // transaction (pr-7-7). Either both happen or both fail - there is no
    // possible state where Sous can still cite a doc that's hidden from
    // the catalog, or vice versa.
    if (action === "archive") {
      const { id } = body;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
      }
      // Existence pre-check so we return a clear 404 instead of the RPC's
      // generic "0 rows returned".
      const existing = await getDocument(id, { module: MODULE });
      if (!existing) {
        return NextResponse.json({ error: `Document ${id} not found` }, { status: 404 });
      }

      const sb = getServiceClient();
      const { data, error } = await sb.rpc("archive_document", { p_doc_id: id });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rpcRow = data?.[0] || {};

      // Re-fetch to return the full post-archive document row (archived
      // flag, archived_at timestamp).
      const updatedDoc = await getDocument(id, { module: MODULE });
      return NextResponse.json({
        ok: true,
        document: updatedDoc,
        chunks_deleted: rpcRow.chunks_deleted ?? 0,
      });
    }

    // ── restore ──────────────────────────────────────────────────────────
    // Delegates to sousai.restoreDocument which dispatches re-embed by
    // doc_class (POST -> stub, else+Drive -> full extract, else -> no
    // content), then flips archived=false LAST so we never have a
    // visible-but-not-embedded half-state.
    if (action === "restore") {
      const { id } = body;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
      }
      const existing = await getDocument(id, { module: MODULE });
      if (!existing) {
        return NextResponse.json({ error: `Document ${id} not found` }, { status: 404 });
      }
      if (!existing.archived) {
        return NextResponse.json(
          { error: `Document ${id} is not archived` },
          { status: 400 }
        );
      }

      let result;
      try {
        result = await restoreDocument({ docId: id });
      } catch (e) {
        return NextResponse.json(
          { error: `Restore failed: ${e.message}. Doc remains archived.` },
          { status: 500 }
        );
      }

      const updatedDoc = await getDocument(id, { module: MODULE });
      return NextResponse.json({
        ok: true,
        document: updatedDoc,
        restore_path: result.restorePath,
        chunks_inserted: result.chunksInserted,
      });
    }

    // ── create-document ──────────────────────────────────────────────────
    // Strict validation: ID format regex, prefix↔doc_class consistency,
    // uniqueness, plus the existing shelf/class/status sets. Defaults:
    // status=Pending if omitted, version=null (per spec - a brand-new doc
    // with no content shouldn't claim a version it doesn't have).
    if (action === "create-document") {
      const v = validateCreatePayload(body, {
        validShelves: VALID_SHELVES_SET,
        validClasses: VALID_CLASSES,
        validStatuses: VALID_STATUSES,
      });
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
      // Uniqueness: surface a clear "id already exists: <title>" instead
      // of the raw PG unique-violation message.
      const existing = await getDocument(v.clean.id, { module: MODULE });
      if (existing) {
        return NextResponse.json(
          { error: `id '${v.clean.id}' already exists: ${existing.title}` },
          { status: 400 }
        );
      }
      let created;
      try {
        created = await createDocument(v.clean, { module: MODULE });
      } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, document: created });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[playbook POST]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
