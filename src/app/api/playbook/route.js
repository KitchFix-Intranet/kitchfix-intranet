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
  getDocumentContent,
  getRelationships,
  getSurfaces,
  createIssue,
  updateDocument,
  setPinned,
  clearPinned,
} from "@/lib/dataStore";
import {
  canViewPlaybook,
  isCorporateEmail,
  visibleStatuses,
  filterDocuments,
  viewerTier,
  canSeeDoc,
} from "@/lib/opdAcl";
import { getServiceClient } from "@/lib/supabase";
import {
  embedDocument,
  embedPosterStub,
  restoreDocument,
  SKIP_TEXT_EXTRACTION_CLASSES,
} from "@/lib/sousai";

// Locked shelf order - operational domains first, references at the end.
// A6 6-domain taxonomy: Safety (food + workplace consolidated) -> Ops -> People
// -> Culinary -> Service Delivery -> Brand standards. Finance dissolved into
// Operations (PB-009 moved). HR sub-sections inside People & Conduct are
// carried per-doc on a `subshelf` frontmatter field; the rail expansion that
// consumes that field lands in a follow-up PR.
const SHELVES = [
  "Safety, Health & Incident",
  "Operations & Leadership",
  "People & Conduct",
  "Culinary & Kitchen Operations",
  "Service Delivery & Client Accounts",
  "Brand & Documentation Standards",
];

const MODULE = "playbook";

// ─── Hero image · global pool (team_key IS NULL) ────────────────────────────
// Mirrors the pattern used by sibling pages (home, Directory, Service Calendar,
// Financial). Query the hero_images PG table for global-pool rows, pick one
// at random on each bootstrap load. Returns null when the table is empty or
// the lookup fails - the client renders the flat navy hero in that case.
async function pickHeroImage() {
  try {
    const supa = getServiceClient();
    const { data, error } = await supa
      .from("hero_images")
      .select("url")
      .is("team_key", null);
    if (error) return null;
    const urls = (data || [])
      .map((r) => r.url)
      .filter((u) => u && String(u).includes("http"));
    if (urls.length === 0) return null;
    return urls[Math.floor(Math.random() * urls.length)];
  } catch {
    return null;
  }
}

// ─── Editing allowlist + validation sets (action=update-document) ───────────
//
// Overlay-only allowlist. The dashboard only writes fields the projection
// PRESERVES (status, pinned, access_level) - the operational lifecycle the
// owner controls without a deploy. MDX-authored fields (title, shelf,
// doc_class, version, etc.) are NOT in the set: a write to them would land
// in PG and then be silently overwritten on the next projection apply, so
// the API hard-rejects them here. The UI enforces the same boundary; this
// closes the same gap at the API layer.
//
// Removed in PR C (Drive retired): source_drive_id, source_drive_id_es.
// `id` is NOT writable - renaming the PK is a multi-table transaction
// (see pr-7-5 atomic POST-003 -> POSTER-001), not an in-row UPDATE.
//
// Per-field validators mirror the schema CHECK constraints
// (pr-7-1-opd-schema.sql + pr-7-11 access_level) so we 400 fast instead of
// round-tripping a Postgres constraint violation.
const WRITABLE_FIELDS_A = new Set([
  "status", "pinned", "access_level",
]);
const VALID_STATUSES = new Set([
  "Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired",
]);
const VALID_ACCESS_LEVELS = new Set(["unrestricted", "restricted", "slt"]);

function validatePatch(patch) {
  // Returns { ok: true, clean } on success or { ok: false, error } on failure.
  // `clean` is the canonicalized patch so callers can pass it straight to
  // updateDocument.
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "patch must be a non-null object" };
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return { ok: false, error: "patch is empty - no fields to update" };
  }
  for (const k of keys) {
    if (!WRITABLE_FIELDS_A.has(k)) {
      return { ok: false, error: `field '${k}' is not writable via this action` };
    }
  }
  const clean = {};
  if ("status" in patch) {
    if (!VALID_STATUSES.has(patch.status)) {
      return { ok: false, error: `invalid status '${patch.status}'` };
    }
    clean.status = patch.status;
  }
  if ("pinned" in patch) {
    if (typeof patch.pinned !== "boolean") {
      return { ok: false, error: "pinned must be a boolean" };
    }
    clean.pinned = patch.pinned;
  }
  if ("access_level" in patch) {
    if (!VALID_ACCESS_LEVELS.has(patch.access_level)) {
      return { ok: false, error: `invalid access_level '${patch.access_level}'` };
    }
    clean.access_level = patch.access_level;
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

      // Owner: full visible-doc set with status + access_level filters applied
      // server-side. The access_level filter (pr-7-11) drops docs the viewer's
      // tier can't see; restricted / slt cards never reach an unrestricted
      // viewer's bootstrap response.
      //
      // A6 admin/operator split: by default Retired is excluded for everyone
      // (operator reader). The admin dashboard passes include_retired=true so
      // the owner can see + manage retired docs from the worklist. Non-owners
      // were already rejected above; the param is a no-op for them.
      const isCorp = await isCorporateEmail(actualEmail);
      const includeRetired = searchParams.get("include_retired") === "true";
      const baseStatuses = visibleStatuses(isCorp);
      const statuses = includeRetired ? [...baseStatuses, "Retired"] : baseStatuses;
      const [allDocs, heroImage] = await Promise.all([
        listDocuments({ statuses }, { module: MODULE }),
        pickHeroImage(),
      ]);
      // If admin requested retired, skip the unconditional Retired-strip in
      // filterDocuments and just trust the status list we pulled.
      const statusVisible = includeRetired
        ? allDocs.filter((d) => statuses.includes(d.status))
        : filterDocuments(allDocs, isCorp);
      const tier = viewerTier(actualEmail);
      const visible = statusVisible.filter((d) => canSeeDoc(tier, d.access_level));
      return NextResponse.json({
        email: actualEmail,
        isOwner: true,
        shelves: SHELVES,
        documents: visible,
        heroImage,
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
      // Phase A3: pull rendered HTML from document_content alongside the
      // legacy Drive URLs. Both en + es rows are best-effort - null when
      // unpopulated; the reader falls back to the Drive iframe per-language
      // when content_html is missing. Populated by the A4 projection apply.
      const [doc, rels, surfs, contentEn, contentEs] = await Promise.all([
        getDocument(id, { module: MODULE }),
        getRelationships(id, { module: MODULE }),
        getSurfaces(id, { module: MODULE }),
        getDocumentContent(id, "en", { module: MODULE }),
        getDocumentContent(id, "es", { module: MODULE }),
      ]);
      if (!doc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // pr-7-11 access-tier gate. The owner-only check above protects /playbook
      // as a whole; this per-doc check closes the direct-ID bypass at the
      // detail handler. We return 404 (not 403) so a viewer without the right
      // tier cannot probe for which IDs exist - the doc looks indistinguishable
      // from a non-existent one.
      const tier = viewerTier(actualEmail);
      if (!canSeeDoc(tier, doc.access_level)) {
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
        // Phase A3 dual-path: content_html when present, else the reader
        // falls back to the Drive iframe via drive_preview_url. A7 retires
        // the Drive fallback once every Live doc has a content row.
        content_html: contentEn?.html || null,
        content_html_es: contentEs?.html || null,
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
      // pr-7-9: pin moves to the document_pins overlay. Intercept pinned
      // from the validated patch, route it to setPinned / clearPinned, and
      // remove it from the catalog patch before updateDocument runs. If the
      // patch is pinned-only, we still need to return the post-write row
      // shape so the client sees the canonical pinned value.
      const pinChange = ("pinned" in v.clean) ? v.clean.pinned : undefined;
      const catalogPatch = { ...v.clean };
      delete catalogPatch.pinned;

      try {
        if (pinChange === true) {
          await setPinned(id, actualEmail, { module: MODULE });
        } else if (pinChange === false) {
          await clearPinned(id, { module: MODULE });
        }
      } catch (e) {
        return NextResponse.json({ error: e?.message || "pin write failed" }, { status: 400 });
      }

      // If the catalog patch is empty (pin-only change), re-fetch the row so
      // the response carries the overlay-derived pinned value.
      let updated;
      if (Object.keys(catalogPatch).length === 0) {
        updated = await getDocument(id, { module: MODULE });
        if (!updated) {
          return NextResponse.json({ error: `Document ${id} not found` }, { status: 404 });
        }
        return NextResponse.json({ ok: true, document: updated });
      }
      try {
        updated = await updateDocument(id, catalogPatch, { module: MODULE });
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[playbook POST]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
