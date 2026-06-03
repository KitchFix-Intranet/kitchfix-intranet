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
} from "@/lib/dataStore";
import {
  canViewPlaybook,
  isCorporateEmail,
  visibleStatuses,
  filterDocuments,
} from "@/lib/opdAcl";

// Locked shelf order — Safety first, Site & Client last (Finance renders
// empty/short between Culinary and Site & Client).
const SHELVES = [
  "Safety",
  "Operations",
  "HR & People",
  "Culinary",
  "Finance",
  "Site & Client",
];

const MODULE = "playbook";

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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[playbook POST]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
