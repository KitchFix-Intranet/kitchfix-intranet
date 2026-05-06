import { NextResponse } from "next/server";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { TABS, WOW_PLAN_STATUS } from "@/lib/performanceSchema";
import {
  readChain,
  getChainForLeader,
  getLeadersReviewedBy,
  getLeadersOverseenBy,
  snapshotChain,
} from "@/lib/performanceChain";
import { isSystemViewer } from "@/lib/performanceAcl";
import {
  listWowPlansForUser,
  getWowPlan,
  createWowPlan,
  updateWowPlanStatus,
  updateWowPlanBodySection,
} from "@/lib/wowPlanActions";
import { logAudit, postPerformanceSlack, getFirstName } from "@/lib/performanceActions";
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

// ─── My Dugout: list active items for current user ────────────────────
    if (action === "list-active-instruments") {
      const wowPlans = await listWowPlansForUser(email);
      // Active = anything not Closed
      const active = wowPlans.filter((p) => p.status !== WOW_PLAN_STATUS.CLOSED);
      return NextResponse.json({
        ok: true,
        items: active.map((p) => ({
          type: "WowPlan",
          id: p.id,
          status: p.status,
          leader_name: p.leader_name,
          leader_email: p.leader_email,
          reviewer_email: p.reviewer_email,
          oversight_email: p.oversight_email,
          day1_date: p.day1_date,
          day30_date: p.day30_date,
          day60_date: p.day60_date,
          day90_date: p.day90_date,
        })),
      });
    }

    // Sprint 3 stubs (Cycle Review aggregations) — implemented in Chunk 4
    if (action === "list-pending-self-assessments" || action === "list-pending-manager-drafts") {
      return NextResponse.json({ ok: true, todo: action, items: [] });
    }

    // ─── WOW Plan: get single ─────────────────────────────────────────────
    if (action === "get-wow-plan") {
      const { plan_id } = body;
      if (!plan_id) return NextResponse.json({ ok: false, error: "Missing plan_id" }, { status: 400 });
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      // Access check: only Leader, Reviewer, Oversight, or system viewer can read
      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.leader_email.toLowerCase() === norm ||
        plan.header.reviewer_email.toLowerCase() === norm ||
        plan.header.oversight_email.toLowerCase() === norm ||
        (await isSystemViewer(email));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      return NextResponse.json({ ok: true, plan });
    }

    // ─── WOW Plan: create (system viewers only) ───────────────────────────
    if (action === "create-wow-plan") {
      if (!(await isSystemViewer(email))) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      const { leader_email, day1_date, trigger_type } = body;
      if (!leader_email || !day1_date) {
        return NextResponse.json({ ok: false, error: "leader_email and day1_date required" }, { status: 400 });
      }
      const chainEntry = await getChainForLeader(leader_email);
      if (!chainEntry) {
        return NextResponse.json({
          ok: false,
          error: `No active Performance_Chain entry for ${leader_email}. Add the leader to HUB__Performance_Chain first.`,
        }, { status: 400 });
      }
      const snapshot = snapshotChain(chainEntry);
      const plan = await createWowPlan({
        chainSnapshot: snapshot,
        day1Date: day1_date,
        triggerType: trigger_type,
        actorEmail: email,
      });

      // Slack notification (best-effort)
      await postPerformanceSlack({
        headerText: `🎯 New WOW Plan generated — ${snapshot.leader_name}`,
        fields: [
          { label: "Leader", value: `${snapshot.leader_name} (${snapshot.role})` },
          { label: "Account", value: snapshot.account },
          { label: "Day 1", value: day1_date },
          { label: "Reviewer", value: snapshot.reviewer_name },
          { label: "Oversight", value: snapshot.oversight_name },
        ],
        context: `Day 30 → ${plan.day30_date}  ·  Day 60 → ${plan.day60_date}  ·  Day 90 → ${plan.day90_date}`,
      });

      return NextResponse.json({ ok: true, plan_id: plan.id, ...plan });
    }

// ─── WOW Plan: mark a section complete (status transition) ───────────
    // Used by PreDay1 to flip Generated → PreDay1 once the leader's prep is done.
    // Day 1/30/60 status flips happen via submit-wow-checkpoint instead.
    if (action === "submit-wow-section-complete") {
      const { plan_id, section } = body;
      if (!plan_id || !section) {
        return NextResponse.json({ ok: false, error: "plan_id and section required" }, { status: 400 });
      }
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      const norm = email.toLowerCase().trim();
      const isLeader = plan.header.leader_email.toLowerCase() === norm;
      if (section === "pre_work_responses" && !isLeader) {
        return NextResponse.json({ ok: false, error: "Only Leader can mark pre-Day 1 complete" }, { status: 403 });
      }

      if (section === "pre_work_responses") {
        await updateWowPlanStatus({
          planId: plan_id,
          newStatus: WOW_PLAN_STATUS.PRE_DAY1,
          actorEmail: email,
        });
        await logAudit({
          instrument_type: "WowPlan",
          instrument_id: plan_id,
          action: "pre_day1_complete",
          actor_email: email,
          actor_role: "ReviewedParty",
          details: {},
        });
      }

      return NextResponse.json({ ok: true });
    }

    // ─── WOW Plan: save body section (autosave) ───────────────────────────
    if (action === "save-wow-section") {
      const { plan_id, column, value } = body;
      if (!plan_id || !column) {
        return NextResponse.json({ ok: false, error: "plan_id and column required" }, { status: 400 });
      }
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      // Access check
      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.leader_email.toLowerCase() === norm ||
        plan.header.reviewer_email.toLowerCase() === norm ||
        (await isSystemViewer(email));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }

      await updateWowPlanBodySection({
        planId: plan_id,
        columnLetter: column,
        jsonValue: value,
        actorEmail: email,
      });

      await logAudit({
        instrument_type: "WowPlan",
        instrument_id: plan_id,
        action: "section_saved",
        actor_email: email,
        actor_role: "Reviewer",
        details: { column },
      });

      return NextResponse.json({ ok: true });
    }

    // ─── WOW Plan: submit checkpoint (Day 1 / 30 / 60) ────────────────────
    if (action === "submit-wow-checkpoint") {
      const { plan_id, day } = body;
      if (!plan_id || !day) {
        return NextResponse.json({ ok: false, error: "plan_id and day required" }, { status: 400 });
      }
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.leader_email.toLowerCase() === norm ||
        plan.header.reviewer_email.toLowerCase() === norm;
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }

      const newStatus = day === 1 ? WOW_PLAN_STATUS.ACTIVE
                      : day === 30 ? WOW_PLAN_STATUS.DAY30
                      : day === 60 ? WOW_PLAN_STATUS.DAY60
                      : null;
      if (!newStatus) {
        return NextResponse.json({ ok: false, error: "day must be 1, 30, or 60" }, { status: 400 });
      }

      await updateWowPlanStatus({ planId: plan_id, newStatus, actorEmail: email, signedDay: day });
      await logAudit({
        instrument_type: "WowPlan",
        instrument_id: plan_id,
        action: `day${day}_signed`,
        actor_email: email,
        actor_role: "Reviewer",
        details: {},
      });

      await postPerformanceSlack({
        headerText: `✅ WOW Plan Day ${day} complete — ${plan.header.leader_name}`,
        fields: [{ label: "Status", value: newStatus }],
      });

      return NextResponse.json({ ok: true, status: newStatus });
    }

    // ─── WOW Plan: close (Day 90, all 3 sigs) ─────────────────────────────
    // PDF render (Chunk 6) is fired async after this returns.
    if (action === "close-wow-plan") {
      const { plan_id } = body;
      if (!plan_id) return NextResponse.json({ ok: false, error: "plan_id required" }, { status: 400 });
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.oversight_email.toLowerCase() === norm ||
        (await isSystemViewer(email));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Only Oversight or system viewer can close" }, { status: 403 });
      }

      await updateWowPlanStatus({
        planId: plan_id,
        newStatus: WOW_PLAN_STATUS.CLOSED,
        actorEmail: email,
        signedDay: 90,
      });
      await logAudit({
        instrument_type: "WowPlan",
        instrument_id: plan_id,
        action: "closed",
        actor_email: email,
        actor_role: "Oversight",
        details: {},
      });

      await postPerformanceSlack({
        headerText: `🏁 WOW Plan closed — ${plan.header.leader_name}`,
        fields: [
          { label: "Leader", value: plan.header.leader_name },
          { label: "Day 90", value: plan.header.day90_date },
        ],
        context: "Leader transitions to next Cycle Review on contract-type cadence.",
      });

      return NextResponse.json({ ok: true, status: WOW_PLAN_STATUS.CLOSED });
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