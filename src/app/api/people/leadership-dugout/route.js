import { NextResponse } from "next/server";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { TABS } from "@/lib/performanceSchema";
import {
  readChain,
  getChainForLeader,
  getLeadersReviewedBy,
  getLeadersOverseenBy,
} from "@/lib/performanceChain";
import { isSystemViewer } from "@/lib/performanceAcl";
import { logEventSA } from "@/lib/analytics";

// ════════════════════════════════════════════════════════════════════════════
// PEOPLE PORTAL · LEADERSHIP DUGOUT API
//
// Sprint: 1 — bootstrap, library-list, library-get implemented.
//             All other actions stubbed (return { ok: true, todo: action }).
//
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// All Sheets/Drive writes via service account (sheets.js helpers).
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, email = "" } = body;

    // ─── bootstrap ────────────────────────────────────────────────────────
    if (action === "bootstrap") {
      logEventSA({
        email,
        category: "leadership-dugout",
        action: "page_view",
        page: "/people/leadership-dugout",
      });

      const [chain, leadersReviewed, leadersOverseen, sysViewer] = await Promise.all([
        getChainForLeader(email),
        getLeadersReviewedBy(email),
        getLeadersOverseenBy(email),
        isSystemViewer(email),
      ]);

      // System viewers get a chain preview for the Admin tab
      let fullChainPreview = [];
      if (sysViewer) {
        fullChainPreview = (await readChain()).filter((c) => c.chain_status === "Active");
      }

      return NextResponse.json({
        ok: true,
        email,
        chain,
        leaders_reviewed: leadersReviewed,
        leaders_overseen: leadersOverseen,
        is_system_viewer: sysViewer,
        full_chain_preview: fullChainPreview,
      });
    }

    // ─── library-list ─────────────────────────────────────────────────────
    // Reads from HUB!ldug_library_manifest tab.
    // Same column structure as existing library_manifest:
    //   A drive_file_id  B category  C title  D version  E updated_at
    //   F description    G pinned    H critical  I sort_order  J active
    if (action === "library-list") {
      let rows;
      try {
        const result = await readSheetSA(SHEET_IDS.HUB, TABS.LIBRARY);
        rows = result?.rows;
      } catch (e) {
        console.log("[ldug] library tab not found - returning empty");
        return NextResponse.json({ ok: true, documents: [] });
      }

      if (!rows || rows.length === 0) {
        return NextResponse.json({ ok: true, documents: [] });
      }

      const documents = rows
        .map((row, idx) => {
          const driveFileId = String(row[0] || "").trim();
          const category = String(row[1] || "").trim().toLowerCase();
          const title = String(row[2] || "").trim();
          const version = String(row[3] || "").trim();
          const updatedAt = String(row[4] || "").trim();
          const description = String(row[5] || "").trim();
          const pinned = String(row[6] || "").trim().toUpperCase() === "TRUE";
          const critical = String(row[7] || "").trim().toUpperCase() === "TRUE";
          const sortOrder = Number(row[8]) || 100;
          const active = String(row[9] || "").trim().toUpperCase() !== "FALSE";

          return {
            id: `ldug-lib-${idx}-${driveFileId.slice(-8)}`,
            drive_file_id: driveFileId,
            category,
            title,
            version,
            updated_at: updatedAt,
            description,
            pinned,
            critical,
            sort_order: sortOrder,
            active,
            view_url: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
            thumbnail_url: driveFileId ? `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w400` : null,
          };
        })
        .filter((d) => d.active && d.drive_file_id && d.title);

      // Sort: pinned first, then sort_order asc, then title asc
      documents.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.title.localeCompare(b.title);
      });

      return NextResponse.json({ ok: true, documents });
    }

    // ─── library-get (returns view URL by drive file id) ──────────────────
    if (action === "library-get") {
      const { drive_file_id } = body;
      if (!drive_file_id) {
        return NextResponse.json({ ok: false, error: "Missing drive_file_id" }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        view_url: `https://drive.google.com/file/d/${drive_file_id}/view`,
      });
    }

    // ─── Sprint 2 stubs (scorecards) ──────────────────────────────────────
    if (action === "save-scorecard" || action === "submit-scorecard" || action === "acknowledge-scorecard") {
      return NextResponse.json({ ok: true, todo: action });
    }

    // ─── Sprint 3 stubs (My Dugout aggregations) ──────────────────────────
    if (action === "list-active-instruments" || action === "list-pending-self-assessments" || action === "list-pending-manager-drafts") {
      return NextResponse.json({ ok: true, todo: action, items: [] });
    }

    // ─── Sprint 4 stubs (WOW Plan) ────────────────────────────────────────
    if (action === "create-wow-plan" || action === "submit-wow-checkpoint" || action === "close-wow-plan") {
      return NextResponse.json({ ok: true, todo: action });
    }

    // ─── Sprint 5 stubs (Cycle Review + calibration) ──────────────────────
    if ([
      "get-instrument",
      "save-instrument-section",
      "submit-self-assessment",
      "submit-manager-draft",
      "submit-calibration",
      "mark-conversation-held",
      "submit-response",
      "sign-off",
      "list-calibration-queue",
      "heartbeat-section",
      "check-co-editor",
    ].includes(action)) {
      return NextResponse.json({ ok: true, todo: action });
    }

    // ─── Sprint 6 stubs (admin) ───────────────────────────────────────────
    if (["admin-update-chain", "admin-publish-cycle", "admin-render-pdf", "admin-list-audit-log"].includes(action)) {
      return NextResponse.json({ ok: true, todo: action });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[leadership-dugout] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}