// ════════════════════════════════════════════════════════════════════════════
// performanceSchema — shape definitions, status enums, JSON helpers
//
// Module: People Portal · Leadership Dugout
// Sprint: 1
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// Sibling: src/lib/incidentSchema.js
// ════════════════════════════════════════════════════════════════════════════

// ─── HUB tab names ───
// Tab names match what's seeded in the HUB sheet from the Leadership_Dugout_
// Sheet_Structures.xlsx. HUB__ prefix denotes hub-side config tabs;
// COLL__ prefix denotes collection-side actuals tabs.
export const TABS = {
  CHAIN: "HUB__Performance_Chain",
  CALENDAR: "HUB__Cycle_Calendar",
  CONFIG: "HUB__Performance_System_Config",
  LIBRARY: "ldug_library_manifest",
};

// ─── COLLECTION tab names ───
export const COLLECTION_TABS = {
  CYCLE_REVIEW_HEADER: "COLL__Cycle_Review_Header",
  CYCLE_REVIEW_BODY: "COLL__Cycle_Review_Body",
  WOW_PLANS_HEADER: "COLL__WOW_Plans_Header",
  WOW_PLANS_BODY: "COLL__WOW_Plans_Body",
  SCORECARDS: "COLL__Scorecards",
  AUDIT_LOG: "COLL__Performance_Audit_Log",
};

// ─── Cycle Review status state machine ───
export const CYCLE_REVIEW_STATUS = {
  OPEN: "Open",
  SELF_PENDING: "SelfPending",
  SELF_SUBMITTED: "SelfSubmitted",
  MANAGER_DRAFT: "ManagerDraft",
  IN_CALIBRATION: "InCalibration",
  CALIBRATED: "Calibrated",
  SENT_BACK: "SentBack",
  CONVERSATION_HELD: "ConversationHeld",
  AWAITING_RESPONSE: "AwaitingResponse",
  SIGN_OFF_PENDING: "SignOffPending",
  CLOSED: "Closed",
};

// ─── WOW Plan status state machine ───
export const WOW_PLAN_STATUS = {
  GENERATED: "Generated",
  PRE_DAY1: "PreDay1",
  ACTIVE: "Active",
  DAY30: "Day30",
  DAY60: "Day60",
  DAY90: "Day90",
  CLOSED: "Closed",
};

// ─── Calibration outcomes ───
export const CALIBRATION_OUTCOMES = {
  APPROVED: "Approved",
  APPROVED_WITH_NOTES: "ApprovedWithNotes",
  SENT_BACK: "SentBack",
};

// ─── Roles per instrument (computed at runtime, not stored) ───
export const INSTRUMENT_ROLES = {
  REVIEWED_PARTY: "ReviewedParty",
  REVIEWER: "Reviewer",
  OVERSIGHT: "Oversight",
  SYSTEM_VIEWER: "SystemViewer",
  NONE: "None",
};

// ─── Leadership roles in the chain ───
export const CHAIN_ROLES = {
  RDO: "RDO",
  EC: "EC",
  SOUS: "Sous",
  HM: "HM",
  FIELD_CHEF: "FieldChef",
};

// ─── Contract types drive cycle assignment ───
export const CONTRACT_TYPES = {
  PDC: "PDC",
  MLB: "MLB",
  MILB: "MiLB",
};

// ─── Six Themes (from SOP-001 §5.2, inherited from Cadence Matrix in PB-001) ───
export const THEMES = [
  { id: "people", label: "People" },
  { id: "operations", label: "Operations" },
  { id: "financial", label: "Financial" },
  { id: "client", label: "Client" },
  { id: "culinary", label: "Culinary" },
  { id: "compliance", label: "Compliance" },
];

// ─── Three Composites ───
export const COMPOSITES = [
  { id: "team_health", label: "Leadership Team Health" },
  { id: "client_health", label: "Client Relationship Health" },
  { id: "trajectory", label: "Development Trajectory" },
];

// ─── Rating scale (1=worst, 5=best per SOP-001; v2 hourly normalized to match) ───
export const RATING_SCALE = [
  { value: 1, label: "Unsatisfactory" },
  { value: 2, label: "Below Standard" },
  { value: 3, label: "Meets Standard" },
  { value: 4, label: "Exceeds Standard" },
  { value: 5, label: "Exceptional" },
];

// ─── Default scale direction (future-proofed for v2) ───
export const DEFAULT_SCALE_DIRECTION = "1-low";

// ─── Performance_Chain column indices ───
export const CHAIN_COL = {
  LEADER_EMAIL: 0,
  LEADER_NAME: 1,
  ROLE: 2,
  ACCOUNT: 3,
  CONTRACT_TYPE: 4,
  REVIEWER_EMAIL: 5,
  REVIEWER_NAME: 6,
  OVERSIGHT_EMAIL: 7,
  OVERSIGHT_NAME: 8,
  CHAIN_EFFECTIVE_DATE: 9,
  CHAIN_STATUS: 10,
  NOTES: 11,
};

// ─── Performance_System_Config — flat key/value tab (col A=field, col B=value) ───
export const CONFIG_KEYS = {
  SYSTEM_VIEWER_EMAILS: "system_viewer_emails",
  HR_EMAIL: "hr_email",
  VP_OPS_EMAIL: "vp_ops_email",
  SR_DIR_OPS_EMAIL: "sr_dir_ops_email",
  DIRECTOR_CULINARY_EMAIL: "director_culinary_email",
  DELTA_FLAG_THRESHOLD: "delta_flag_threshold",
  RESPONSE_WINDOW_DAYS: "response_window_days",
  CALIBRATION_SLA_DAYS: "calibration_sla_days",
  WOW_PLAN_PRE_DAY1_DAYS: "wow_plan_pre_day1_days",
  WOW_PLAN_SHARE_DAYS: "wow_plan_share_days",
  CO_EDITOR_WARN_MINUTES: "co_editor_warn_minutes",
  SECTION10_LOCK_SECONDS: "section10_lock_seconds",
  CELL_SIZE_WARN_PCT: "cell_size_warn_pct",
  CELL_SIZE_BLOCK_PCT: "cell_size_block_pct",
  SEASON_TRACKER_STALE_HOURS: "season_tracker_stale_hours",
};

// ─── Cycle Review status → which tab is "current actor" ───
export function getCurrentActorRole(status) {
  switch (status) {
    case CYCLE_REVIEW_STATUS.OPEN:
    case CYCLE_REVIEW_STATUS.SELF_PENDING:
      return INSTRUMENT_ROLES.REVIEWED_PARTY;
    case CYCLE_REVIEW_STATUS.SELF_SUBMITTED:
    case CYCLE_REVIEW_STATUS.MANAGER_DRAFT:
    case CYCLE_REVIEW_STATUS.SENT_BACK:
      return INSTRUMENT_ROLES.REVIEWER;
    case CYCLE_REVIEW_STATUS.IN_CALIBRATION:
      return INSTRUMENT_ROLES.OVERSIGHT;
    case CYCLE_REVIEW_STATUS.CALIBRATED:
    case CYCLE_REVIEW_STATUS.CONVERSATION_HELD:
      return INSTRUMENT_ROLES.REVIEWER;
    case CYCLE_REVIEW_STATUS.AWAITING_RESPONSE:
      return INSTRUMENT_ROLES.REVIEWED_PARTY;
    case CYCLE_REVIEW_STATUS.SIGN_OFF_PENDING:
      return INSTRUMENT_ROLES.REVIEWED_PARTY; // first signature
    default:
      return INSTRUMENT_ROLES.NONE;
  }
}