// ════════════════════════════════════════════════════════════════════════════
// performanceAcl — role detection, Section 10 gate, body filtering, test mode
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 7 — test mode added)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
//
// CRITICAL: Section 10 access enforcement lives here. Server-side only.
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
      if (!key) return;
      if (key.toLowerCase() === "field") return;
      config[key] = value;
    });
    return config;
  } catch (e) {
    console.error("[performanceAcl] readConfig failed:", e.message);
    return {};
  }
}

// ─── Test mode flag (read fresh per request — not cached) ───
export async function isTestModeEnabled() {
  const config = await readConfig();
  const val = (config.test_mode_enabled || "false").toLowerCase().trim();
  return val === "true" || val === "1" || val === "yes";
}

// ─── Calendar recipient when test mode is on ───
export async function getTestCalendarRecipient() {
  const config = await readConfig();
  return (config.test_calendar_recipient || "k.fietek@kitchfix.com").trim();
}

// ─── Resolve effective email (impersonation only when test mode + system viewer) ───
// `actualEmail` = the authenticated user's real email.
// `impersonateHeader` = X-Impersonate-Email request header (optional).
// Returns { effective_email, is_impersonating, actual_email }.
export async function resolveEffectiveEmail(actualEmail, impersonateHeader) {
  if (!impersonateHeader) {
    return { effective_email: actualEmail, is_impersonating: false, actual_email: actualEmail };
  }

  // Two gates: test mode must be ON, and actual user must be a system viewer
  const [testMode, sysViewer] = await Promise.all([
    isTestModeEnabled(),
    isSystemViewer(actualEmail),
  ]);

  if (!testMode || !sysViewer) {
    // Silently ignore impersonation if not allowed
    return { effective_email: actualEmail, is_impersonating: false, actual_email: actualEmail };
  }

  return {
    effective_email: impersonateHeader.toLowerCase().trim(),
    is_impersonating: true,
    actual_email: actualEmail,
  };
}

// ─── System viewer check ───
export async function isSystemViewer(email) {
  if (!email) return false;
  const config = await readConfig();
  const csv = config[CONFIG_KEYS.SYSTEM_VIEWER_EMAILS] || "";
  const list = csv.split(",").map((e) => e.toLowerCase().trim()).filter(Boolean);
  return list.includes(email.toLowerCase().trim());
}

// ─── Get user's role for an instrument ───
export function getUserRoleForInstrument(userEmail, instanceChain, isSystemViewerFlag) {
  if (!userEmail) return INSTRUMENT_ROLES.NONE;
  const norm = userEmail.toLowerCase().trim();
  if (instanceChain.leader_email?.toLowerCase() === norm) return INSTRUMENT_ROLES.REVIEWED_PARTY;
  if (instanceChain.reviewer_email?.toLowerCase() === norm) return INSTRUMENT_ROLES.REVIEWER;
  if (instanceChain.oversight_email?.toLowerCase() === norm) return INSTRUMENT_ROLES.OVERSIGHT;
  if (isSystemViewerFlag) return INSTRUMENT_ROLES.SYSTEM_VIEWER;
  return INSTRUMENT_ROLES.NONE;
}

// ─── Filter Cycle Review body by user role ───
export function filterCycleReviewBody(body, userRole, status) {
  if (!body) return null;
  const filtered = { ...body };

  if (
    userRole !== INSTRUMENT_ROLES.REVIEWER &&
    userRole !== INSTRUMENT_ROLES.OVERSIGHT &&
    userRole !== INSTRUMENT_ROLES.SYSTEM_VIEWER
  ) {
    delete filtered.calibration;
  }

  if (
    userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
    !isPostCalibration(status)
  ) {
    delete filtered.themes_manager;
    delete filtered.composites_manager;
    delete filtered.top3_strengths;
    delete filtered.top3_dev_areas;
  }

  if (
    userRole === INSTRUMENT_ROLES.REVIEWER &&
    status === CYCLE_REVIEW_STATUS.SELF_PENDING
  ) {
    delete filtered.themes_self;
    delete filtered.composites_self;
  }

  delete filtered.section_locks;
  return filtered;
}

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
  if (sectionKey === "calibration") {
    return (
      (userRole === INSTRUMENT_ROLES.REVIEWER || userRole === INSTRUMENT_ROLES.OVERSIGHT) &&
      status === CYCLE_REVIEW_STATUS.IN_CALIBRATION
    );
  }
  if (sectionKey === "themes_self" || sectionKey === "composites_self") {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
      (status === CYCLE_REVIEW_STATUS.OPEN || status === CYCLE_REVIEW_STATUS.SELF_PENDING)
    );
  }
  if (
    sectionKey === "themes_manager" ||
    sectionKey === "composites_manager" ||
    sectionKey === "top3_strengths" ||
    sectionKey === "top3_dev_areas"
  ) {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWER &&
      (status === CYCLE_REVIEW_STATUS.MANAGER_DRAFT ||
        status === CYCLE_REVIEW_STATUS.SENT_BACK ||
        status === CYCLE_REVIEW_STATUS.SELF_SUBMITTED)
    );
  }
  if (sectionKey === "top3_priorities") {
    return (
      (userRole === INSTRUMENT_ROLES.REVIEWER || userRole === INSTRUMENT_ROLES.REVIEWED_PARTY) &&
      (status === CYCLE_REVIEW_STATUS.CALIBRATED ||
        status === CYCLE_REVIEW_STATUS.CONVERSATION_HELD)
    );
  }
  if (sectionKey === "conversation_notes") {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWER &&
      status === CYCLE_REVIEW_STATUS.CALIBRATED
    );
  }
  if (sectionKey === "response") {
    return (
      userRole === INSTRUMENT_ROLES.REVIEWED_PARTY &&
      status === CYCLE_REVIEW_STATUS.AWAITING_RESPONSE
    );
  }
  return false;
}