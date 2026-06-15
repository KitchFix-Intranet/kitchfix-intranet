#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/generate_placeholders.mjs
// F2 step: generate Placeholder frontmatter stubs for tracker-only docs.
//
// Per the F2 brief: "The ~30 tracker-only docs (no file, not authored -
// Queued / Staged / Not started per PUBLISH_READINESS.md §5): create
// Placeholder frontmatter stubs (catalog row, status: Placeholder, no body).
// Not body-conversion work."
//
// Reads a built-in list of tracker-only IDs (compiled from PUBLISH_READINESS.md
// section 5 + the audit MANIFEST.md "tracker-only entries"). Writes a stub
// frontmatter-only .mdx per ID. Skips any that already exist (idempotent).
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

// Tracker-only catalog rows (no on-disk source, no body conversion needed)
// Compiled from PUBLISH_READINESS.md §5 and MANIFEST.md tracker reconciliation.
// id, title, doc_class, shelf, status, tracker_status_note, owner, approver, audience
const stubs = [
  // Leadership cycle - tabled-until-August batch (Staged in tracker)
  { id: "SOP-007", title: "Hourly Performance System", doc_class: "SOP", shelf: "Operations", status: "In Build", owner: "Human Resources", approver: "Senior Director of Operations", audience: "corporate", desc: "Hourly track parallel to SOP-001. Site Leader is reviewer; no Oversight calibration. 30-Day Check plus Annual Cycle Review. Tabled until August per tracker (staged v0.1 drafted)." },
  { id: "TPL-001", title: "Site Leader Scorecard", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "corporate", desc: "Period-level performance tracking for Site Leaders. Inputs to Cycle Review. Staged v0.1; tabled until August." },
  { id: "TPL-002", title: "RDO Scorecard", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "VP of Operations", audience: "corporate", desc: "Period-level performance tracking for RDOs. Inputs to RDO Cycle Review. Staged v0.1; tabled until August." },
  { id: "TPL-003", title: "Cycle Performance Review (master + role addenda)", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "corporate", desc: "Master review instrument with 5 role addenda. Staged v0.2; awaiting Kevin redline." },
  { id: "TPL-004", title: "90-Day WOW Plan (master + role addenda)", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "corporate", desc: "Master onboarding plan with 5 role addenda. Staged v0.2; awaiting Kevin redline." },
  { id: "TPL-010", title: "Period-End Scorecard", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "VP of Operations", audience: "corporate", desc: "Site-level period close. Operations metrics, variance, compliance rollup. Staged v0.1; tabled until August." },
  { id: "TPL-012", title: "Hourly Cycle Review", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "Human Resources", audience: "operator", desc: "9-factor / 1-5 scale review for hourly staff. Annual cadence. Staged v0.1; tabled until August. Source: legacy Frontline Performance Assessment." },
  { id: "TPL-013", title: "Hourly 30-Day Check", doc_class: "TPL", shelf: "Operations", status: "In Build", owner: "Senior Director of Operations", approver: "Human Resources", audience: "operator", desc: "30-day check-in for new hourly hires. Four-outcome decision. Staged v0.1; tabled until August." },

  // Operations Hub - queued
  { id: "TPL-007", title: "Daily Site Log", doc_class: "TPL", shelf: "Operations", status: "Pending", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "EC daily check-in artifact. Implements SOP-001 section 7 daily cadence. Pending Operations Hub build." },
  { id: "TPL-008", title: "Weekly Site Report", doc_class: "TPL", shelf: "Operations", status: "Pending", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "EC to RDO weekly rollup. Implements SOP-001 section 7 weekly cadence. Pending Operations Hub build." },
  { id: "TPL-009", title: "Weekly RDO Rollup", doc_class: "TPL", shelf: "Operations", status: "Pending", owner: "Senior Director of Operations", approver: "VP of Operations", audience: "corporate", desc: "RDO to VP Ops weekly rollup. Implements SOP-001 section 7 weekly cadence. Pending Operations Hub build." },
  { id: "TPL-011", title: "Client Check-In Log", doc_class: "TPL", shelf: "Site & Client", status: "Pending", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "Standing log of client touchpoints. Inputs to Cycle Review Client theme. Pending Operations Hub build." },

  // Onboarding queued (gated)
  { id: "TPL-016", title: "Onboarding Checklist", doc_class: "TPL", shelf: "HR & People", status: "Pending", owner: "Human Resources", approver: "Senior Director of Operations", audience: "operator", desc: "The checklist PB-004 references for receipt confirmation. Employee signs at hire. Gated on SOP-005 / SOP-001 v2.1." },

  // Reference / supporting
  { id: "REF-001", title: "Workers Comp State Annex", doc_class: "REF", shelf: "Safety", status: "Pending", owner: "Human Resources", approver: "Senior Director of Operations", audience: "corporate", desc: "Multi-state workers comp filing details. Currently a placeholder shell (tracker v0.1) pending content from the carrier and counsel. Referenced by SOP-002 section 10." },
  { id: "REF-004", title: "Org Chart", doc_class: "REF", shelf: "HR & People", status: "Pending", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "One-page visual org chart. High onboarding value for new employees and managers." },

  // Culinary baseline
  { id: "PB-011", title: "Culinary Operations Manual", doc_class: "PB", shelf: "Culinary", status: "Placeholder", owner: "Director of Culinary", approver: "SLT", audience: "operator", desc: "Standalone Culinary Operations Manual referencing PB-006 Culinary OS. Recipe/menu standard, dietitian/nutrition workflow, player special-diets, production/pars, FOH service standards. Not started; placeholder per tracker." },

  // -ES translations as catalog rows; bodies live with their EN sources or in separate ES files later
  { id: "PB-004-ES", title: "Hourly Employee Handbook (ES)", doc_class: "PB", shelf: "HR & People", status: "In Build", lang: "es", in_corpus: false, translation_of: "PB-004", source_version: "1.2", owner: "Human Resources", approver: "SLT", audience: "operator", desc: "Full Spanish translation of PB-004 v1.2. All 10 sections. Requires Mariela review before distribution. Draft per tracker (Mariela review pending)." },

  // Retired set as catalog rows for audit + relationships
  { id: "POL-005", title: "Social Media Policy", doc_class: "POL", shelf: "HR & People", status: "Retired", owner: "Human Resources", approver: "SLT + counsel", audience: "operator", desc: "Retired - PB-004 section 06 coverage sufficient. Not building." },
  { id: "POL-012", title: "Work Authorization (I-9 / E-Verify) Policy", doc_class: "POL", shelf: "HR & People", status: "Retired", owner: "Human Resources", approver: "SLT + counsel", audience: "operator", desc: "Retired (on hold) per Kevin 2026-06-12. Parked pending E-Verify/Arizona compliance resolution. NOT superseded by another doc; temporary hold, revivable. ID POL-012 reserved." },
  { id: "POL-016", title: "Record Retention & Destruction", doc_class: "POL", shelf: "HR & People", status: "Retired", owner: "Human Resources", approver: "SLT + counsel", audience: "corporate", desc: "Retired 2026-06-12 per Kevin. No superseding doc. Was the single home for the retention schedule, secure-destruction, and legal-hold rules. If a retention/legal-hold policy is needed later, ID POL-016 is reserved to revive. AUDIT FLAGGED: POL-009 currently still references this retired doc." },
  { id: "POL-017", title: "Paid Sick Leave Policy", doc_class: "POL", shelf: "HR & People", status: "Retired", owner: "Human Resources", approver: "SLT + counsel", audience: "operator", desc: "Retired 2026-06-12. Consolidated into POL-015 Leave Policies. Superseded-by POL-015. Never published.", supersedes_by: "POL-015" },
  { id: "POL-018", title: "FMLA Policy", doc_class: "POL", shelf: "HR & People", status: "Retired", owner: "Human Resources", approver: "SLT + counsel", audience: "operator", desc: "Retired 2026-06-12. Consolidated into POL-015 Leave Policies. Superseded-by POL-015. Never published.", supersedes_by: "POL-015" },
  { id: "SOP-003", title: "Quality & Service Recovery Process", doc_class: "SOP", shelf: "Operations", status: "Retired", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "Retired - replaced by PB-003 Service Recovery Playbook.", supersedes_by: "PB-003" },
  { id: "SOP-011", title: "OSHA 300 Recordkeeping SOP", doc_class: "SOP", shelf: "Safety", status: "Retired", owner: "Human Resources", approver: "SLT", audience: "corporate", desc: "Retired 2026-06-12. Routine OSHA 300/300A/301 recordkeeping not required for partially-exempt food-service establishments. Universal severe-incident OSHA reporting moved to SOP-002.", supersedes_by: "SOP-002" },
  { id: "SOP-013", title: "(reserved - reusable)", doc_class: "SOP", shelf: null, status: "Retired", owner: null, approver: null, audience: "internal", desc: "Number reserved 2026-06-12. Vomit/Diarrhea Cleanup SOP removed from scope - not a document KitchFix will maintain. Never published. Number reusable for future SOP assignments." },
  { id: "SOP-016", title: "Foodborne-Illness Response SOP", doc_class: "SOP", shelf: "Safety", status: "Retired", owner: "Director of Culinary", approver: "SLT", audience: "operator", desc: "Retired 2026-06-12. Redundant with SOP-002 section 07.4 (Suspected Foodborne Illness). Superseded-by SOP-002. Never published.", supersedes_by: "SOP-002" },
  { id: "REF-008", title: "Permit & License Tracker", doc_class: "REF", shelf: null, status: "Retired", owner: "Senior Director of Operations", approver: "SLT", audience: "corporate", desc: "Retired 2026-06-12. Reclassified as a generic policy - a frozen docx tracker is the wrong medium for a living permit register. Superseded-by POL-019.", supersedes_by: "POL-019" },
  { id: "REF-009", title: "ServSafe / Cert Tracker", doc_class: "REF", shelf: null, status: "Retired", owner: "Human Resources", approver: "SLT", audience: "corporate", desc: "Retired 2026-06-12. Certification tracking lives in Rippling - a standalone KitchFix cert tracker is redundant. Superseded-by Rippling (external HR system). Never published; draft removed." },
  { id: "TPL-017", title: "Site Incident Log", doc_class: "TPL", shelf: "Safety", status: "Retired", owner: "Senior Director of Operations", approver: "Senior Director of Operations", audience: "operator", desc: "Retired - superseded by the intranet incident log. SOP-002 / POST-001 point to the intranet log; AUDIT FLAGGED: SOP-002 frontmatter still names TPL-017 in relationships." },
];

function emit(stub) {
  const out = join(DOCS_DIR, `${stub.id}.mdx`);
  if (existsSync(out)) {
    console.log(`  SKIP ${stub.id} (exists)`);
    return;
  }
  const lines = ["---"];
  lines.push(`id: ${stub.id}`);
  lines.push(`title: ${JSON.stringify(stub.title)}`);
  lines.push(`doc_class: ${stub.doc_class}`);
  if (stub.shelf !== null && stub.shelf !== undefined) lines.push(`shelf: ${JSON.stringify(stub.shelf)}`);
  lines.push(`status: ${stub.status}`);
  lines.push(`version: null`);
  lines.push(`card_line: null`);
  lines.push(`summary: ${JSON.stringify(stub.desc)}`);
  if (stub.owner !== null && stub.owner !== undefined) lines.push(`owner: ${JSON.stringify(stub.owner)}`);
  if (stub.approver !== null && stub.approver !== undefined) lines.push(`approver: ${JSON.stringify(stub.approver)}`);
  lines.push(`audience: ${stub.audience}`);
  lines.push(`classification: "KitchFix Internal"`);
  lines.push(`lang: ${stub.lang || "en"}`);
  lines.push(`in_corpus: ${stub.in_corpus === false ? "false" : (stub.status === "Retired" ? "false" : "false")}`);
  if (stub.translation_of) lines.push(`translation_of: ${stub.translation_of}`);
  if (stub.source_version) lines.push(`source_version: ${JSON.stringify(stub.source_version)}`);
  lines.push(`applies_to: company-wide`);
  if (stub.supersedes_by) {
    lines.push(`relationships:`);
    lines.push(`  - { to: ${stub.supersedes_by}, type: superseded_by, from_section: "retired, superseded by ${stub.supersedes_by}" }`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${stub.status} (catalog row only)`);
  lines.push("");
  lines.push(`Frontmatter-only stub for ${stub.id}. ${stub.desc}`);
  lines.push("");
  lines.push("This document has no body content. The catalog row exists so cross-references resolve and the dependency graph stays complete. Excluded from the SousAI corpus.");
  writeFileSync(out, lines.join("\n") + "\n", "utf8");
  console.log(`  WROTE ${stub.id}.mdx`);
}

console.log(`Generating Placeholder/In-Build/Retired stubs for ${stubs.length} tracker-only IDs...`);
for (const s of stubs) emit(s);
console.log(`\nDone.`);
