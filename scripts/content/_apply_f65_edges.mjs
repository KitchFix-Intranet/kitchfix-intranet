#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_f65_edges.mjs
// F6.5 mechanical relationship-edges add. Adds the high-confidence missing
// edges Kevin approved in CK-F.
//
// COUNT FLAG: the CK-F report headline said "11 edges" but the listed bullets
// actually sum to 14 specific source-target pairs. This script adds all 14
// (the listed high-confidence pairs); CK-G calls this out so Kevin can remove
// any he does not want.
//
// Each edge is added immediately after the last existing relationships entry
// (preserves the existing list ordering). Strategy: find the last
// "  - { to: ..." line under "relationships:" and insert the new entry after it.
// If no existing relationships, error (the docs we're touching all have at
// least one).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "content", "documents");

const EDGES = [
  // FORM-004 cites POL-002 in section 04 conduct categories
  { doc: "FORM-004", to: "POL-002",  type: "references",   from_section: "section 04 conduct categories list" },
  // FORM-007 cites both performance SOPs at "Performance Review on File"
  { doc: "FORM-007", to: "SOP-001",  type: "references",   from_section: "Performance Review on File (leadership track)" },
  { doc: "FORM-007", to: "SOP-007",  type: "references",   from_section: "Performance Review on File (hourly track)" },
  // PB-013 cites TPL-001 in section 5 cadence tools
  { doc: "PB-013",   to: "TPL-001",  type: "references",   from_section: "section 05 cadence tools" },
  // POST-003 derives from SOP-008 already; the SOP-002 connection is the
  // notification matrix, which is canonically a derived_from relationship too.
  // POST-001 is the related sibling poster.
  { doc: "POST-003", to: "PB-002",   type: "references",   from_section: "Allergens callout (PB-002 Top 9)" },
  { doc: "POST-003", to: "PB-007",   type: "references",   from_section: "Hot surfaces + kitchen-safety detail" },
  { doc: "POST-003", to: "POST-001", type: "related",      from_section: "Severity matrix - sibling poster" },
  { doc: "POST-003", to: "SOP-002",  type: "derived_from", from_section: "Notify per SOP-002 severity matrix" },
  { doc: "POST-003", to: "FORM-008", type: "references",   from_section: "Hygiene + sick-staff control" },
  // SOP-001 cites SOP-007 as the hourly-track parallel
  { doc: "SOP-001",  to: "SOP-007",  type: "related",      from_section: "section 06 hourly-track parallel" },
  // SOP-009 cites SOP-004 in section 05 Consequences
  { doc: "SOP-009",  to: "SOP-004",  type: "references",   from_section: "section 05 Consequences" },
  // STD-003 cites the disciplinary + termination forms
  { doc: "STD-003",  to: "FORM-003", type: "references",   from_section: "performance coaching forms" },
  { doc: "STD-003",  to: "FORM-004", type: "references",   from_section: "performance coaching forms" },
  { doc: "STD-003",  to: "FORM-006", type: "references",   from_section: "termination conversations" },
];

const touched = new Map();
let applied = 0;
let failed = 0;

for (const edge of EDGES) {
  const file = join(DOCS_DIR, `${edge.doc}.mdx`);
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  // Find "relationships:" line and the last "  - { to: ..." beneath it that is
  // still inside the relationships block (terminated by next non-indented YAML
  // key or "---" frontmatter end).
  let relStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("relationships:")) { relStartIdx = i; break; }
  }
  if (relStartIdx === -1) {
    console.log(`  MISS  ${edge.doc} -> ${edge.to}  no relationships: block`);
    failed++;
    continue;
  }
  let relEndIdx = lines.length;
  for (let i = relStartIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("---")) { relEndIdx = i; break; }
    if (lines[i].length > 0 && !lines[i].startsWith(" ") && !lines[i].startsWith("\t")) { relEndIdx = i; break; }
  }
  // Find the last "  - { to: ..." in [relStartIdx+1, relEndIdx)
  let lastEntryIdx = -1;
  for (let i = relStartIdx + 1; i < relEndIdx; i++) {
    if (/^\s+-\s*\{\s*to:/.test(lines[i])) lastEntryIdx = i;
  }
  if (lastEntryIdx === -1) {
    console.log(`  MISS  ${edge.doc} -> ${edge.to}  no existing entries in relationships:`);
    failed++;
    continue;
  }
  // Guard - if the edge already exists, skip
  const dupRegex = new RegExp(`to:\\s*${edge.to.replace(/-/g, "\\-")}[,\\s}]`);
  let alreadyExists = false;
  for (let i = relStartIdx + 1; i < relEndIdx; i++) {
    if (dupRegex.test(lines[i])) { alreadyExists = true; break; }
  }
  if (alreadyExists) {
    console.log(`  SKIP  ${edge.doc} -> ${edge.to}  already present`);
    continue;
  }
  const newLine = `  - { to: ${edge.to}, type: ${edge.type}, from_section: "${edge.from_section}" }`;
  lines.splice(lastEntryIdx + 1, 0, newLine);
  writeFileSync(file, lines.join("\n"), "utf8");
  touched.set(edge.doc, (touched.get(edge.doc) || 0) + 1);
  applied++;
}

console.log(`\nF6.5 relationship edges applied: ${applied} edges across ${touched.size} docs (${failed} failed)`);
for (const [doc, n] of [...touched].sort()) {
  console.log(`  ${doc.padEnd(10)} +${n} edge${n === 1 ? "" : "s"}`);
}

if (failed > 0) process.exit(1);
