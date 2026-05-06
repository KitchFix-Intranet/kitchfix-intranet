import { NextResponse } from "next/server";
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { TABS, WOW_PLAN_STATUS, COLLECTION_TABS } from "@/lib/performanceSchema";
import {
  readChain,
  getChainForLeader,
  getLeadersReviewedBy,
  getLeadersOverseenBy,
  snapshotChain,
} from "@/lib/performanceChain";
import {
  isSystemViewer,
  isTestModeEnabled,
  getTestCalendarRecipient,
  resolveEffectiveEmail,
} from "@/lib/performanceAcl";
import {
  listAllWowPlans,
  listWowPlansForUser,
  getWowPlan,
  createWowPlan,
  updateWowPlanStatus,
  updateWowPlanBodySection,
  createCalendarInvites,
} from "@/lib/wowPlanActions";
import { logAudit, postPerformanceSlack } from "@/lib/performanceActions";
import { renderWowPlanPdf } from "@/lib/performancePdf";
import { logEventSA } from "@/lib/analytics";

// ════════════════════════════════════════════════════════════════════════════
// PEOPLE PORTAL · LEADERSHIP DUGOUT API
//
// Sprint: 1-3 (WOW Plan live) + Chunk 7 (test mode + impersonation)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// All Sheets/Drive writes via service account.
// Cycle Review actions are stubbed; backend lands when Chunks 4-5 ship.
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, email: rawEmail = "" } = body;

    // ─── Resolve effective email + test mode (once per request) ──────────
    const impersonateHeader = request.headers.get("x-impersonate-email") || "";
    const [resolved, testMode] = await Promise.all([
      resolveEffectiveEmail(rawEmail, impersonateHeader),
      isTestModeEnabled(),
    ]);
    const email = resolved.effective_email;
    const actualEmail = resolved.actual_email;
    const isImpersonating = resolved.is_impersonating;

    // ─── bootstrap ────────────────────────────────────────────────────────
    if (action === "bootstrap") {
      logEventSA({
        email: actualEmail,
        category: "leadership-dugout",
        action: "page_view",
        page: "/people/leadership-dugout",
      });

      const [chain, leadersReviewed, leadersOverseen, sysViewer] = await Promise.all([
        getChainForLeader(email),
        getLeadersReviewedBy(email),
        getLeadersOverseenBy(email),
        isSystemViewer(actualEmail), // gate based on REAL identity
      ]);

      let fullChainPreview = [];
      if (sysViewer) {
        fullChainPreview = (await readChain()).filter((c) => c.chain_status === "Active");
      }

      return NextResponse.json({
        ok: true,
        email,
        actual_email: actualEmail,
        is_impersonating: isImpersonating,
        test_mode: testMode,
        chain,
        leaders_reviewed: leadersReviewed,
        leaders_overseen: leadersOverseen,
        is_system_viewer: sysViewer,
        full_chain_preview: fullChainPreview,
      });
    }

    // ─── library-list ─────────────────────────────────────────────────────
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
            category, title, version, updated_at: updatedAt, description,
            pinned, critical, sort_order: sortOrder, active,
            view_url: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null,
            thumbnail_url: driveFileId ? `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w400` : null,
          };
        })
        .filter((d) => d.active && d.drive_file_id && d.title);

      documents.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.title.localeCompare(b.title);
      });

      return NextResponse.json({ ok: true, documents });
    }

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

    // ─── My Dugout: list active items ─────────────────────────────────────
    if (action === "list-active-instruments") {
      const wowPlans = await listWowPlansForUser(email);
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

    // ─── WOW Plan: get single ─────────────────────────────────────────────
    if (action === "get-wow-plan") {
      const { plan_id } = body;
      if (!plan_id) return NextResponse.json({ ok: false, error: "Missing plan_id" }, { status: 400 });
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.leader_email.toLowerCase() === norm ||
        plan.header.reviewer_email.toLowerCase() === norm ||
        plan.header.oversight_email.toLowerCase() === norm ||
        (await isSystemViewer(actualEmail));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      return NextResponse.json({ ok: true, plan });
    }

    // ─── WOW Plan: create (system viewers only — gate on REAL identity) ──
    if (action === "create-wow-plan") {
      if (!(await isSystemViewer(actualEmail))) {
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
          error: `No active Performance_Chain entry for ${leader_email}.`,
        }, { status: 400 });
      }
      const snapshot = snapshotChain(chainEntry);
      const plan = await createWowPlan({
        chainSnapshot: snapshot,
        day1Date: day1_date,
        triggerType: trigger_type,
        actorEmail: testMode ? `[TEST] ${actualEmail}` : actualEmail,
      });

      // Calendar invites — test mode routes to single recipient
      try {
        const testRecipient = testMode ? await getTestCalendarRecipient() : "";
        const eventIds = await createCalendarInvites({
          planId: plan.id,
          header: {
            ...snapshot,
            day30_date: plan.day30_date,
            day60_date: plan.day60_date,
            day90_date: plan.day90_date,
          },
          testMode,
          testRecipient,
        });
        if (eventIds.length > 0) {
          const { updateRangeSA } = await import("@/lib/sheets");
          const all = await listAllWowPlans();
          const idx = all.findIndex((p) => p.id === plan.id);
          if (idx !== -1) {
            await updateRangeSA(
              SHEET_IDS.COLLECTION,
              `${COLLECTION_TABS.WOW_PLANS_HEADER}!R${idx + 4}`,
              [[eventIds.join(",")]]
            );
          }
        }
      } catch (e) {
        console.warn("[ldug] calendar invites failed (non-blocking):", e.message);
      }

      await postPerformanceSlack({
        test_mode: testMode,
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
          actorEmail: testMode ? `[TEST] ${email}` : email,
        });
        await logAudit({
          test_mode: testMode,
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

      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.leader_email.toLowerCase() === norm ||
        plan.header.reviewer_email.toLowerCase() === norm ||
        (await isSystemViewer(actualEmail));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }

      await updateWowPlanBodySection({
        planId: plan_id,
        columnLetter: column,
        jsonValue: value,
        actorEmail: testMode ? `[TEST] ${email}` : email,
      });

      await logAudit({
        test_mode: testMode,
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

      await updateWowPlanStatus({
        planId: plan_id, newStatus,
        actorEmail: testMode ? `[TEST] ${email}` : email,
        signedDay: day,
      });
      await logAudit({
        test_mode: testMode,
        instrument_type: "WowPlan", instrument_id: plan_id,
        action: `day${day}_signed`,
        actor_email: email, actor_role: "Reviewer", details: {},
      });

      await postPerformanceSlack({
        test_mode: testMode,
        headerText: `✅ WOW Plan Day ${day} complete — ${plan.header.leader_name}`,
        fields: [{ label: "Status", value: newStatus }],
      });

      return NextResponse.json({ ok: true, status: newStatus });
    }

    // ─── WOW Plan: close (Day 90) ─────────────────────────────────────────
    if (action === "close-wow-plan") {
      const { plan_id } = body;
      if (!plan_id) return NextResponse.json({ ok: false, error: "plan_id required" }, { status: 400 });
      const plan = await getWowPlan(plan_id);
      if (!plan) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

      const norm = email.toLowerCase().trim();
      const allowed =
        plan.header.oversight_email.toLowerCase() === norm ||
        (await isSystemViewer(actualEmail));
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Only Oversight or system viewer can close" }, { status: 403 });
      }

      await updateWowPlanStatus({
        planId: plan_id,
        newStatus: WOW_PLAN_STATUS.CLOSED,
        actorEmail: testMode ? `[TEST] ${email}` : email,
        signedDay: 90,
      });
      await logAudit({
        test_mode: testMode,
        instrument_type: "WowPlan", instrument_id: plan_id,
        action: "closed", actor_email: email, actor_role: "Oversight", details: {},
      });

      await postPerformanceSlack({
        test_mode: testMode,
        headerText: `🏁 WOW Plan closed — ${plan.header.leader_name}`,
        fields: [
          { label: "Leader", value: plan.header.leader_name },
          { label: "Day 90", value: plan.header.day90_date },
        ],
        context: "Leader transitions to next Cycle Review on contract-type cadence.",
      });

      // Fire-and-forget PDF render (silently no-ops if Railway not configured)
      (async () => {
        try {
          const fresh = await getWowPlan(plan_id);
          const renderResult = await renderWowPlanPdf(fresh, testMode);
          if (renderResult?.ok && renderResult.drive_file_id) {
            const { updateRangeSA } = await import("@/lib/sheets");
            const all = await listAllWowPlans();
            const idx = all.findIndex((p) => p.id === plan_id);
            if (idx !== -1) {
              await updateRangeSA(
                SHEET_IDS.COLLECTION,
                `${COLLECTION_TABS.WOW_PLANS_HEADER}!Q${idx + 4}`,
                [[renderResult.drive_file_id]]
              );
            }
          }
        } catch (e) {
          console.error("[ldug] WOW PDF render failed:", e.message);
        }
      })();

      return NextResponse.json({ ok: true, status: WOW_PLAN_STATUS.CLOSED });
    }

    // ─── ADMIN: toggle test mode (system viewers only — REAL identity) ────
    if (action === "admin-toggle-test-mode") {
      if (!(await isSystemViewer(actualEmail))) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }
      const { enabled } = body;
      const { updateRangeSA } = await import("@/lib/sheets");

      const configResult = await readSheetSA(SHEET_IDS.HUB, TABS.CONFIG);
      const configRows = configResult?.rows || [];
      let rowNumber = -1;
      for (let i = 0; i < configRows.length; i++) {
        if (String(configRows[i][0] || "").trim() === "test_mode_enabled") {
          rowNumber = i + 1;
          break;
        }
      }
      if (rowNumber === -1) {
        return NextResponse.json({
          ok: false,
          error: "test_mode_enabled row not found in HUB__Performance_System_Config. Add it first."
        }, { status: 400 });
      }

      await updateRangeSA(SHEET_IDS.HUB, `${TABS.CONFIG}!B${rowNumber}`, [[enabled ? "true" : "false"]]);
      return NextResponse.json({ ok: true, test_mode: !!enabled });
    }

    // ─── ADMIN: wipe test data ────────────────────────────────────────────
    if (action === "admin-wipe-test-data") {
      if (!(await isSystemViewer(actualEmail))) {
        return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
      }

      const { batchUpdateRangesSA } = await import("@/lib/sheets");
      const wipedCounts = {};

      const wipeTab = async (tabName, lastActionByColIndex, totalCols) => {
        const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, tabName);
        const dataRows = rows || [];
        const toWipe = [];
        for (let i = 0; i < dataRows.length; i++) {
          const val = String(dataRows[i][lastActionByColIndex] || "");
          if (val.startsWith("[TEST]")) {
            toWipe.push(i + 1);
          }
        }
        if (toWipe.length === 0) return 0;

        const emptyRow = new Array(totalCols).fill("");
        const updates = toWipe.map((rowNum) => ({
          range: `${tabName}!A${rowNum}:${columnLetter(totalCols)}${rowNum}`,
          values: [emptyRow],
        }));
        await batchUpdateRangesSA(SHEET_IDS.COLLECTION, updates);
        return toWipe.length;
      };

      // WOW Plans Header: last_action_by col T (idx 19), 21 cols total
      wipedCounts.wow_plans_header = await wipeTab(COLLECTION_TABS.WOW_PLANS_HEADER, 19, 21);
      // Audit log: actor_email col E (idx 4), 8 cols total
      wipedCounts.audit_log = await wipeTab(COLLECTION_TABS.AUDIT_LOG, 4, 8);

      return NextResponse.json({ ok: true, wiped: wipedCounts });
    }

    // ─── Stubs (Cycle Review backend not yet shipped) ─────────────────────
    if (action === "save-scorecard" || action === "submit-scorecard" || action === "acknowledge-scorecard") {
      return NextResponse.json({ ok: true, todo: action });
    }
    if (action === "list-pending-self-assessments" || action === "list-pending-manager-drafts") {
      return NextResponse.json({ ok: true, todo: action, items: [] });
    }
    if ([
      "get-instrument", "get-cycle-review",
      "save-instrument-section", "save-cycle-review-section",
      "submit-self-assessment", "submit-manager-draft",
      "submit-calibration", "mark-conversation-held",
      "submit-response", "sign-off", "sign-off-cycle-review",
      "list-calibration-queue", "heartbeat-section", "check-co-editor",
    ].includes(action)) {
      return NextResponse.json({ ok: true, todo: action });
    }
    if (["admin-update-chain", "admin-publish-cycle", "admin-render-pdf", "admin-list-audit-log", "admin-list-cycles"].includes(action)) {
      return NextResponse.json({ ok: true, todo: action });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("[leadership-dugout] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ─── Column letter helper (1-based: 1→A, 27→AA) ──────────────────────────
function columnLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}