// ═══════════════════════════════════════════════════════════════
// INCIDENT CENTER - Shared schema constants
// Source of truth for: 9 incident types, 4 severity tiers,
// 5 status states, 13 site codes, sheet column order.
// Imported by both server (api/people/route.js) and client
// (IncidentCenter.js, IncidentAdminQueue.js).
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// 9 INCIDENT TYPES
// id, label, desc, color (drives type-card stripe + admin avatar bg)
// ─────────────────────────────────────────────
export const INCIDENT_TYPES = [
  {
    id: "employee_injury",
    label: "Employee Injury / Illness",
    desc: "Cut, burn, slip, strain, heat illness",
    color: "#dc2626",
  },
  {
    id: "vehicle",
    label: "Vehicle",
    desc: "Accident, damage, moving violation",
    color: "#ea580c",
  },
  {
    id: "allergen_reaction",
    label: "Allergen Reaction",
    desc: "Player or staff reaction at meal",
    color: "#dc2626",
  },
  {
    id: "foodborne_illness",
    label: "Foodborne Illness",
    desc: "GI symptoms after meal, single or cluster",
    color: "#dc2626",
  },
  {
    id: "food_safety",
    label: "Food Safety Incident",
    desc: "Temp breach, contamination, HACCP deviation",
    color: "#d97706",
  },
  {
    id: "property_damage",
    label: "Property / Equipment",
    desc: "Damage with no injury",
    color: "#d97706",
  },
  {
    id: "non_employee_injury",
    label: "Non-Employee Injury",
    desc: "Player, guest, visitor, contractor",
    color: "#ea580c",
  },
  {
    id: "near_miss",
    label: "Near-Miss / Hazard",
    desc: "Almost-incident or unsafe condition",
    color: "#6b7280",
  },
  {
    id: "security_altercation",
    label: "Security / Altercation",
    desc: "Threat, fight, theft, trespass",
    color: "#ea580c",
  },
];

// ─────────────────────────────────────────────
// 4 SEVERITY TIERS
// Matches the Incident Reporting Guide PDF exactly
// ─────────────────────────────────────────────
export const SEVERITY_TIERS = [
  {
    id: "S1",
    label: "Life-Safety / Regulatory",
    color: "#dc2626",
    deadline: "Phone Mariela in 15 min",
    examples:
      "Hospitalization or 911 transport · Regulatory inspector on-site · Anaphylaxis",
  },
  {
    id: "S2",
    label: "Medical / Significant",
    color: "#ea580c",
    deadline: "Phone Mariela in 30 min",
    examples:
      "Injury requiring offsite medical care · Vehicle accident with damage · Allergen reaction (no 911)",
  },
  {
    id: "S3",
    label: "First Aid / Minor",
    color: "#d97706",
    deadline: "Email within 2 hr",
    examples:
      "First aid only, no offsite care · Minor property damage · Minor food safety, contained",
  },
  {
    id: "S4",
    label: "Near-Miss / Hazard",
    color: "#6b7280",
    deadline: "Submit via report URL",
    examples:
      "Almost-burn caught · Cross-contact noticed before service · Slip without injury",
  },
];

// ─────────────────────────────────────────────
// 5-STATE STATUS FLOW
// Per Decision 9
// ─────────────────────────────────────────────
export const STATUS_FLOW = [
  "submitted",
  "acknowledged",
  "investigating",
  "corrective_action",
  "closed",
];

export const STATUS_LABELS = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  corrective_action: "Corrective",
  closed: "Closed",
};

// ─────────────────────────────────────────────
// SITE CODES (13)
// Adjust if your operational sites change
// ─────────────────────────────────────────────
export const SITES = [
  { code: "STL-MO", label: "Cardinals — STL Stadium" },
  { code: "STL-FL", label: "Cardinals — Spring Training (FL)" },
  { code: "CIN-OH", label: "Reds — CIN Stadium" },
  { code: "CIN-AZ", label: "Reds — Spring Training (Goodyear AZ)" },
  { code: "CIN-KY", label: "Reds — Affiliate (KY)" },
  { code: "TXR-TX-H", label: "Rangers — TXR (TX H)" },
  { code: "TXR-TX-V", label: "Rangers — TXR (TX V)" },
  { code: "TXR-AZ", label: "Rangers — Spring Training (AZ)" },
  { code: "PIT", label: "Pirates — PIT" },
  { code: "TBR-FL", label: "Rays — TBR (FL)" },
  { code: "TBJ-FL", label: "Blue Jays — Spring Training (FL)" },
  { code: "TBJ-NY", label: "Blue Jays — Affiliate (Buffalo NY)" },
  { code: "CORP", label: "Corporate HQ — Chicago" },
];

// ─────────────────────────────────────────────
// SHEET COLUMNS (42 total)
// Order matters - this defines the column layout in the Incidents tab
// ─────────────────────────────────────────────
export const INCIDENT_COLUMNS = [
  // Identity (5)
  "incident_id",
  "submitted_at",
  "submitted_by_name",
  "submitted_by_email",
  "submitter_role",

  // Universal incident (9)
  "incident_type",
  "severity",
  "site_code",
  "incident_date",
  "incident_time",
  "location_detail",
  "manager_aware_date",
  "what_happened",
  "witnesses",

  // Type-specific JSON (1)
  "type_specific_data",

  // Attachments (4)
  "drive_folder_id",
  "drive_folder_url",
  "attachment_count",
  "attachment_summary",

  // Notification log (2)
  "notifications_sent",
  "s1_escalation_at",

  // Status & lifecycle (12)
  "status",
  "acknowledged_by",
  "acknowledged_at",
  "investigating_assignee",
  "investigating_started_at",
  "root_cause",
  "corrective_action",
  "corrective_action_owner",
  "corrective_action_due",
  "corrective_action_completed_at",
  "closed_by",
  "closed_at",

  // Employee check-in (2)
  "employee_check_in_due",
  "employee_check_in_completed_at",

  // Workers' Comp (4) - admin-only fields, preserved from old form
  "claim_submitted_date",
  "claim_number",
  "claim_handler_name",
  "claim_handler_contact",

  // Internal admin (3)
  "internal_notes",
  "last_updated_at",
  "last_updated_by",
];

// ─────────────────────────────────────────────
// CONFIG / CONSTANTS
// ─────────────────────────────────────────────
export const INCIDENTS_TAB = "Incidents";
export const SLACK_CHANNEL_NAME = "opshub-incident-submissions";
export const MARIELA_EMAIL = "m.chavez@kitchfix.com";
export const CORPORATE_CC = [
  "joe@kitchfix.com",
  "britt@kitchfix.com",
  "k.fietek@kitchfix.com",
];

// Helper: convert array row → object keyed by column name
export function rowToIncident(row) {
  const obj = {};
  INCIDENT_COLUMNS.forEach((col, i) => {
    obj[col] = row[i] ?? "";
  });
  return obj;
}

// Helper: convert incident object → array row in column order
export function incidentToRow(incident) {
  return INCIDENT_COLUMNS.map((col) => {
    const v = incident[col];
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}