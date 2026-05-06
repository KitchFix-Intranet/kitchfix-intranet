// ════════════════════════════════════════════════════════════════════════════
// performanceAcl — role detection, Section 10 gate, body filtering
//
// Module: People Portal · Leadership Dugout
// Sprint: 1
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
//
// CRITICAL: Section 10 access enforcement lives here. Server-side only.
// Never trust the client. Every API call routes its body through filterBody().
// ════════════════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "@/lib/sheets";
import { TABS, CONFIG_KEYS, INSTRUMENT_ROLES, CYCLE_REVIEW_STATUS } from "@/lib/performanceSchema";

// ─── Read flat key/value config tab ───
export async function readConfig() {
  try {
    const { rows } = await readSheetSA(SHEET_IDS.HUB, TABS.CONFIG);
    const config = {};
    (rows || []).forEach((r) => {
      const key = String(r[0] || "").trim();
      const value = String(r[1] || "").trim();
      if (key) config[key] = value;
    });
    return config;
  } catch (e) {
    console.error("[performanceAcl] readConfig failed:", e.message);
    return {};
  }
}

// ─── Is this user a system viewer (universal read across all instruments)? ───
// Reads from HUB!Performance_System_Config.system_viewer_emails (CSV).
// Logs the comparison so we can debug allowlist mismatches in console.
export async function isSystemViewer(email) {
  if (!email) {
    console.log("[performanceAcl] isSystemViewer: no email passed");
    return false;
  }
  const config = await readConfig();
  const csv = config[CONFIG_KEYS.SYSTEM_VIEWER_EMAILS] || "";
  const list = csv
    .split(",")
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  const normalized = email.toLowerCase().trim();
  const match = list.includes(normalized);
  if (!match) {
    console.log(
      `[performanceAcl] isSystemViewer: NO match for "${normalized}" in [${list.join(", ")}]`
    );
  }
  return match;
}

// ─── Get user's role for a specific Cycle Review or WOW Plan instance ───
// Pass the instance's snapshot chain (reviewed_party / reviewer / oversight emails).
export function getUserRoleForInstrument(userEmail, instanceChain, isSystemViewerFlag) {
  if (!userEmail) return INSTRUMENT_ROLES.NONE;
  const norm = userEmail.toLowerCase().trim();

  if (instanceChain.leader_email?.toLowerCase() === norm) {
    return INSTRUMENT_ROLES.REVIEWED_PARTY;
  }
  if (instanceChain.reviewer_email?.toLowerCase() === norm) {
    return INSTRUMENT_ROLES.REVIEWER;
  }
  if (instanceChain.oversight_email?.toLowerCase() === norm) {
    return INSTRUMENT_ROLES.OVERSIGHT;
  }
  if (isSystemViewerFlag) {
    return INSTRUMENT_ROLES.SYSTEM_VIEWER;
  }
  return INSTRUMENT_ROLES.NONE;
}

// ─── Filter Cycle Review body by user role ───
// THE single source of truth for what each role can see.
// Anywhere the body is returned to the client, it MUST go through this function.
export function filterCycleReviewBody(body, userRole, status) {
  if (!body) return null;
  const filtered = { ...body };

  // Section 10 — calibration notes
  // Visible ONLY to Reviewer + Oversight + SystemViewer. NEVER to ReviewedParty.
  if (
    userRole !== INSTRUMENT_ROLES.REVIEWER &&
    userRole !== INSTRUMENT_ROLES.OVERSIGHT &&
    userRole !== INSTRUMENT_ROLES.SYSTEM_VIEWER
  ) {
    delete filtered.calibration;
  }

  // Self-blind: ReviewedParty cannot see manager's draft until calibration complete
  if (
    userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
    !isPostCalibration(status)
  ) {
    delete filtered.themes_manager;
    delete filtered.composites_manager;
    delete filtered.top3_strengths;
    delete filtered.top3_dev_areas;
  }

  // Reviewer-blind: Reviewer cannot see self-assessment until they submit own draft
  if (
    userRole === INSTRUMENT_ROLES.REVIEWER &&
    status === CYCLE_REVIEW_STATUS.SELF_PENDING
  ) {
    // Status visible (handled by Header) but content gated
    delete filtered.themes_self;
    delete filtered.composites_self;
  }

  // section_locks is internal — don't expose
  delete filtered.section_locks;

  return filtered;
}

// ─── Helper: has the cycle progressed past calibration? ───
function isPostCalibration(status) {
  return [
    CYCLE_REVIEW_STATUS.CALIBRATED,
    CYCLE_REVIEW_STATUS.CONVERSATION_HELD,
    CYCLE_REVIEW_STATUS.AWAITING_RESPONSE,
    CYCLE_REVIEW_STATUS.SIGN_OFF_PENDING,
    CYCLE_REVIEW_STATUS.CLOSED,
  ].includes(status);
}

// ─── Can this user write to this section in current status? ───
export function canWriteSection(sectionKey, userRole, status) {
  // Section 10 (calibration) — Reviewer + Oversight only
  if (sectionKey === "calibration") {
    return (
      (userRole === INSTRUMENT_ROLES.REVIEWER || userRole === INSTRUMENT_ROLES.OVERSIGHT) &&
      status === CYCLE_REVIEW_STATUS.IN_CALIBRATION
    );
  }

  // Self sections — Reviewed Party only, before submitting
  if (sectionKey === "themes_self" || sectionKey === "composites_self") {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
      (status === CYCLE_REVIEW_STATUS.OPEN || status === CYCLE_REVIEW_STATUS.SELF_PENDING)
    );
  }

  // Manager sections — Reviewer only, in draft phase
  if (
    sectionKey === "themes_manager" ||
    sectionKey === "composites_manager" ||
    sectionKey === "top3_strengths" ||
    sectionKey === "top3_dev_areas"
  ) {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWER &&
      (status === CYCLE_REVIEW_STATUS.MANAGER_DRAFT ||
        status === CYCLE_REVIEW_STATUS.SENT_BACK)
    );
  }

  // Top 3 priorities — built jointly in conversation
  if (sectionKey === "top3_priorities") {
    return (
      (userRole === INSTRUMENT_ROLES.REVIEWER || userRole === INSTRUMENT_ROLES.REVIEWED_PARTY) &&
      status === CYCLE_REVIEW_STATUS.CONVERSATION_HELD
    );
  }

  // Response — Reviewed Party, awaiting-response window
  if (sectionKey === "response") {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
      status === CYCLE_REVIEW_STATUS.AWAITING_RESPONSE
    );
  }

  return false;
}