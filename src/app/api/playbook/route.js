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
import matter from "gray-matter";
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

// Owner-gated, live-data API route: every action either reads the live
// catalog or talks to GitHub. None of it is cacheable. Force-dynamic is a
// safety belt against Next's static-cache analysis ever marking a GET as
// cacheable; the mdx-source 409 stale-sha incident (commit-mdx returning
// 409 on every save because the editor's GET response was being served
// from a cached entry) is the reason this is explicit rather than
// implicit. Pair with Cache-Control: no-store on the mdx-source response.
export const dynamic = "force-dynamic";

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

// ─── Frontmatter date normalization ─────────────────────────────────────────
// YAML auto-types unquoted ISO dates to Date objects, but the schema declares
// these fields as YYYY-MM-DD strings (the form needs that shape for
// <input type="date">). Mirrors scripts/content/lib/frontmatter.mjs.
function normalizeDates(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString().slice(0, 10);
  if (Array.isArray(obj)) return obj.map(normalizeDates);
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeDates(v);
    return out;
  }
  return obj;
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

    // ── mdx-source ───────────────────────────────────────────────────────
    // OPD authoring A1: load the raw MDX for a doc from GitHub so the
    // cockpit's editor surface can show frontmatter + body. The save path
    // lands in A2; this action is read-only. The returned `sha` is the
    // staleness guard A2 will pass back on commit.
    //
    // Requires GITHUB_OPD_TOKEN (fine-grained PAT with contents read+write
    // on this repo). Degrades gracefully when the token is unset so this
    // ships before the env var lands.
    if (action === "mdx-source") {
      if (!isOwner) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const id = searchParams.get("id");
      if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }
      if (!/^[A-Z0-9-]+$/.test(id)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      const token = process.env.GITHUB_OPD_TOKEN;
      if (!token) {
        return NextResponse.json(
          { error: "GitHub token not configured" },
          { status: 503 }
        );
      }
      const url =
        `https://api.github.com/repos/KitchFix-Intranet/kitchfix-intranet` +
        `/contents/content/documents/${encodeURIComponent(id)}.mdx`;
      let ghRes;
      try {
        ghRes = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kitchfix-opd-authoring",
          },
          cache: "no-store",
        });
      } catch (e) {
        return NextResponse.json(
          { error: `GitHub fetch failed: ${e.message}` },
          { status: 502 }
        );
      }
      if (ghRes.status === 404) {
        return NextResponse.json(
          { error: `MDX file not found for ${id}` },
          { status: 404 }
        );
      }
      if (!ghRes.ok) {
        return NextResponse.json(
          { error: `GitHub ${ghRes.status}: ${await ghRes.text()}` },
          { status: 502 }
        );
      }
      const gh = await ghRes.json();
      if (!gh.content || !gh.sha) {
        return NextResponse.json(
          { error: "GitHub response missing content or sha" },
          { status: 502 }
        );
      }
      let source;
      try {
        source = Buffer.from(gh.content, "base64").toString("utf8");
      } catch (e) {
        return NextResponse.json(
          { error: `Decode failed: ${e.message}` },
          { status: 502 }
        );
      }
      // Same parser the projection uses (gray-matter via lib/frontmatter.mjs).
      // Inlined here because the projection script lives outside the Next
      // bundle; we use gray-matter directly and apply the same date
      // normalization (YAML auto-types ISO dates to Date objects; the schema
      // declares them as YYYY-MM-DD strings).
      let parsed;
      try {
        parsed = matter(source.replace(/\r\n/g, "\n"));
      } catch (e) {
        return NextResponse.json(
          { error: `MDX parse failed: ${e.message}` },
          { status: 502 }
        );
      }
      // Cache-Control: no-store, private is the load-bearing header here.
      // The commit-mdx staleness guard compares the sha returned here against
      // the sha GitHub returns at save time; if anything caches this response
      // (browser disk cache, Vercel edge), the editor saves with an old sha
      // and 409s forever. The 2026-06-19 incident is the reason this is
      // explicit. force-dynamic at the top is the route-level companion.
      return NextResponse.json(
        {
          id,
          sha: gh.sha,
          frontmatter: normalizeDates(parsed.data || {}),
          body: parsed.content || "",
        },
        {
          headers: {
            "Cache-Control": "no-store, private, max-age=0, must-revalidate",
          },
        }
      );
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

    // ── commit-mdx ───────────────────────────────────────────────────────
    // OPD authoring A2: validate the edited MDX and commit it to main on
    // GitHub. The PROJECTION STAYS MANUAL - this action only writes the
    // .mdx file; Kevin runs scripts/content/project-catalog.mjs --apply
    // afterwards to publish. Auto-projection is Part B, separately gated.
    //
    // Safety contract (non-negotiable):
    //   1. Validate frontmatter against the JSON Schema. Fail -> 422,
    //      no commit.
    //   2. Compile-check the body via @mdx-js/mdx. Fail -> 422, no commit.
    //   3. Round-trip-faithful serialize (serializeMdx) so unchanged saves
    //      are byte-identical and scalar edits produce one-line diffs.
    //   4. No-op detection: skip the commit when the serialized content
    //      equals the current file content.
    //   5. Stale-sha guard: GitHub PUT requires the sha the editor was
    //      opened with. A 409 from GitHub means the file moved under us.
    if (action === "commit-mdx") {
      const { id, frontmatter, body: mdxBody, sha } = body;
      if (!id || typeof id !== "string" || !/^[A-Z0-9-]+$/.test(id)) {
        return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
      }
      if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        return NextResponse.json({ error: "Missing or invalid frontmatter" }, { status: 400 });
      }
      if (typeof mdxBody !== "string") {
        return NextResponse.json({ error: "Missing or invalid body" }, { status: 400 });
      }
      if (!sha || typeof sha !== "string") {
        return NextResponse.json({ error: "Missing sha (staleness guard)" }, { status: 400 });
      }

      const token = process.env.GITHUB_OPD_TOKEN;
      if (!token) {
        return NextResponse.json(
          { error: "GitHub token not configured" },
          { status: 503 }
        );
      }

      // 1. Frontmatter validation.
      const { validateFrontmatter } = await import("@/lib/opd/validateFrontmatter");
      const fmResult = validateFrontmatter(frontmatter);
      if (!fmResult.ok) {
        return NextResponse.json(
          { error: "validation", details: fmResult.errors },
          { status: 422 }
        );
      }

      // 2. MDX compile check.
      try {
        const { compile } = await import("@mdx-js/mdx");
        await compile(mdxBody, { development: false });
      } catch (e) {
        return NextResponse.json(
          { error: "mdx-compile", message: e.message },
          { status: 422 }
        );
      }

      // 3+4. Fetch the current file (to anchor the round-trip + verify sha
      // staleness before any write), then serialize surgically and run the
      // no-op check.
      const contentsUrl =
        `https://api.github.com/repos/KitchFix-Intranet/kitchfix-intranet` +
        `/contents/content/documents/${encodeURIComponent(id)}.mdx`;
      let currentRes;
      try {
        currentRes = await fetch(contentsUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kitchfix-opd-authoring",
          },
          cache: "no-store",
        });
      } catch (e) {
        return NextResponse.json(
          { error: `GitHub fetch failed: ${e.message}` },
          { status: 502 }
        );
      }
      if (currentRes.status === 404) {
        return NextResponse.json(
          { error: `MDX file not found for ${id}` },
          { status: 404 }
        );
      }
      if (!currentRes.ok) {
        return NextResponse.json(
          { error: `GitHub ${currentRes.status}: ${await currentRes.text()}` },
          { status: 502 }
        );
      }
      const currentJson = await currentRes.json();
      if (currentJson.sha !== sha) {
        return NextResponse.json(
          {
            error: "stale",
            message: "This document changed since you opened it. Reload before saving.",
            expected_sha: sha,
            live_sha: currentJson.sha,
          },
          { status: 409 }
        );
      }
      const currentContent = Buffer.from(currentJson.content, "base64").toString("utf8");

      const { serializeMdx } = await import("@/lib/opd/serializeMdx");
      let serialized;
      try {
        serialized = serializeMdx({
          original: currentContent,
          userFm: frontmatter,
          userBody: mdxBody,
        });
      } catch (e) {
        return NextResponse.json(
          { error: `Serialize failed: ${e.message}` },
          { status: 500 }
        );
      }

      // No-op: data equals original AND body equals original. Skip commit.
      if (serialized.unchanged) {
        return NextResponse.json({ unchanged: true, sha });
      }

      // 5. Commit to main.
      const commitMessage = `opd: edit ${id} via cockpit`;
      const commitBody = {
        message: commitMessage,
        content: Buffer.from(serialized.content, "utf8").toString("base64"),
        sha,
        branch: "main",
        committer: {
          name: "OPD Authoring",
          email: "noreply@kitchfix.com",
        },
      };
      let putRes;
      try {
        putRes = await fetch(contentsUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "kitchfix-opd-authoring",
          },
          body: JSON.stringify(commitBody),
          cache: "no-store",
        });
      } catch (e) {
        return NextResponse.json(
          { error: `GitHub PUT failed: ${e.message}` },
          { status: 502 }
        );
      }
      if (!putRes.ok) {
        // Surface GitHub's actual error instead of mislabeling everything
        // as "stale". The prior code mapped 409/422 to a bare-body stale
        // 409 on the theory that a PUT failure had to be a sha race;
        // the 2026-06-19 audit found that repo ruleset 16364953's
        // pull_request rule on main was rejecting direct contents-API
        // PUTs (status 422 "Changes must be made through a pull request"),
        // and the old mapping made it look like an editor-side staleness
        // bug. Reflect the real GitHub response code + message so future
        // failures are debuggable from one Network-tab response.
        const rawText = await putRes.text();
        let githubMessage = rawText;
        try {
          const parsed = JSON.parse(rawText);
          if (parsed && typeof parsed.message === "string") {
            githubMessage = parsed.message;
          }
        } catch {
          // not JSON; keep raw text
        }
        if (githubMessage.length > 300) {
          githubMessage = githubMessage.slice(0, 300) + "...";
        }
        return NextResponse.json(
          {
            error: "github_write_failed",
            github_status: putRes.status,
            github_message: githubMessage,
          },
          { status: 502 }
        );
      }
      const putJson = await putRes.json();
      return NextResponse.json({
        ok: true,
        sha: putJson?.content?.sha || null,
        commit: putJson?.commit?.sha || null,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[playbook POST]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
