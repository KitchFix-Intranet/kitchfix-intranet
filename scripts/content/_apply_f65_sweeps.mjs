#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_f65_sweeps.mjs
// F6.5 mechanical sweep: "Human Resources" -> "People Operations" on the 19
// Kevin-approved sweep lines (org/team references). The 9 carve-outs (WC,
// claim-coordinator, named process, named section, named table cell) stay
// "Human Resources" - they are not touched by this script.
//
// Each edit is content-anchored, not line-anchored. The script asserts each
// expected pattern appears exactly once in its target file before swapping,
// so any drift breaks the sweep loudly rather than silently changing the wrong
// line.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "content", "documents");

const SWEEPS = [
  { doc: "AGR-001", from: "6. Human Resources.", to: "6. People Operations." },
  { doc: "AGR-001", from: "raised directly to Human Resources at any point in the chain", to: "raised directly to People Operations at any point in the chain" },
  { doc: "AGR-001", from: "contact your RDO or Human Resources.", to: "contact your RDO or People Operations." },
  { doc: "PB-003",  from: "- HR-grade conduct concern - directly to Human Resources per AGR-001 section 06.", to: "- HR-grade conduct concern - directly to People Operations per AGR-001 section 06." },
  { doc: "PB-008",  from: "- Notify Human Resources and corporate as soon as it is safe.", to: "- Notify People Operations and corporate as soon as it is safe." },
  { doc: "PB-008",  from: "Site Leader notifies Human Resources and corporate before any outside communication.", to: "Site Leader notifies People Operations and corporate before any outside communication." },
  { doc: "PB-013",  from: "- Human Resources - owns the program - the certification matrix, tracking in Rippling, and compliance.", to: "- People Operations - owns the program - the certification matrix, tracking in Rippling, and compliance." },
  { doc: "SOP-002", from: "**Human Resources** - Operational owner of this SOP. Triages every report. Coordinates the workers compensation carrier.", to: "**People Operations** - Operational owner of this SOP. Triages every report. Coordinates the workers compensation carrier." },
  { doc: "SOP-002", from: "Triage by Human Resources confirms or downgrades the tier.", to: "Triage by People Operations confirms or downgrades the tier." },
  { doc: "SOP-002", from: "participates in root-cause review with Human Resources.", to: "participates in root-cause review with People Operations." },
  { doc: "SOP-002", from: "At 30 days, Human Resources checks in with any injured employee.", to: "At 30 days, People Operations checks in with any injured employee." },
  { doc: "SOP-002", from: "2. Call Human Resources directly. Voicemail acceptable only with a callback number left along with a Slack message.", to: "2. Call People Operations directly. Voicemail acceptable only with a callback number left along with a Slack message." },
  { doc: "SOP-002", from: "Employee involved as either party means notify Human Resources before any further action.", to: "Employee involved as either party means notify People Operations before any further action." },
  { doc: "SOP-002", from: "**Paper (exception)** - PDF maintained by Human Resources. Manually entered into the Portal on receipt.", to: "**Paper (exception)** - PDF maintained by People Operations. Manually entered into the Portal on receipt." },
  { doc: "SOP-002", from: "Annual review by Human Resources and Senior Director of Operations.", to: "Annual review by People Operations and Senior Director of Operations." },
  { doc: "SOP-005", from: "- **Human Resources** - owns compliance - work authorization, paperwork, policy acknowledgments, and the Rippling record.", to: "- **People Operations** - owns compliance - work authorization, paperwork, policy acknowledgments, and the Rippling record." },
  { doc: "SOP-010", from: "- **Valid license** - a current, valid driver's license for the vehicle class, on file with Human Resources.", to: "- **Valid license** - a current, valid driver's license for the vehicle class, on file with People Operations." },
  { doc: "SOP-010", from: "| 5 - Notify | Notify Human Resources and the VP of Operations - the VPO is notified for all vehicle incidents regardless of severity. |", to: "| 5 - Notify | Notify People Operations and the VP of Operations - the VPO is notified for all vehicle incidents regardless of severity. |" },
  { doc: "STD-002", from: "Translation workflow: AI drafts, Sr Director Operations reviews, Human Resources approves, both languages publish together.", to: "Translation workflow: AI drafts, Sr Director Operations reviews, People Operations approves, both languages publish together." },
];

const touched = new Map();
let applied = 0;
let failed = 0;

for (const sweep of SWEEPS) {
  const file = join(DOCS_DIR, `${sweep.doc}.mdx`);
  const src = readFileSync(file, "utf8");
  const count = src.split(sweep.from).length - 1;
  if (count === 0) {
    console.log(`  MISS  ${sweep.doc}  expected: "${sweep.from.slice(0, 60)}..."`);
    failed++;
    continue;
  }
  if (count > 1) {
    console.log(`  AMBIG ${sweep.doc}  matched ${count}x: "${sweep.from.slice(0, 60)}..."`);
    failed++;
    continue;
  }
  const next = src.replace(sweep.from, sweep.to);
  writeFileSync(file, next, "utf8");
  touched.set(sweep.doc, (touched.get(sweep.doc) || 0) + 1);
  applied++;
}

console.log(`\nF6.5 HR sweep applied: ${applied} edits across ${touched.size} docs (${failed} failed)`);
for (const [doc, n] of [...touched].sort()) {
  console.log(`  ${doc.padEnd(10)} ${n} edit${n === 1 ? "" : "s"}`);
}

if (failed > 0) process.exit(1);
