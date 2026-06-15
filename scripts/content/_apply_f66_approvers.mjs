#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_f66_approvers.mjs
// F6.6: add Counsel as co-approver on 11 docs per Kevin's reconciliation
// decision. Content-anchored swaps - asserts the expected current line
// appears exactly once before swapping, so any drift breaks the sweep loudly.
// Capitalized "Counsel" to match the active-doc convention.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "content", "documents");

const UPDATES = [
  { doc: "POL-002",    from: `approver: "People Operations"`,                  to: `approver: "People Operations + Counsel"` },
  { doc: "POL-006",    from: `approver: null`,                                 to: `approver: "SLT + Counsel"` },
  { doc: "POL-006-ES", from: `approver: null`,                                 to: `approver: "SLT + Counsel"` },
  { doc: "POL-019",    from: `approver: "SLT"`,                                to: `approver: "SLT + Counsel"` },
  { doc: "SOP-004",    from: `approver: "SLT + People Operations"`,            to: `approver: "SLT + People Operations + Counsel"` },
  { doc: "SOP-005",    from: `approver: "Pending - HR + SLT"`,                 to: `approver: "Pending - HR + SLT + Counsel"` },
  { doc: "AGR-002",    from: `approver: "Senior Director of Operations"`,      to: `approver: "Senior Director of Operations + Counsel"` },
  { doc: "TPL-101",    from: `approver: "SLT"`,                                to: `approver: "SLT + Counsel"` },
  { doc: "TPL-102",    from: `approver: "SLT"`,                                to: `approver: "SLT + Counsel"` },
  { doc: "TPL-103",    from: `approver: "SLT"`,                                to: `approver: "SLT + Counsel"` },
  { doc: "TPL-104",    from: `approver: "SLT"`,                                to: `approver: "SLT + Counsel"` },
];

let applied = 0;
let failed = 0;
const log = [];

for (const u of UPDATES) {
  const file = join(DOCS_DIR, `${u.doc}.mdx`);
  const src = readFileSync(file, "utf8");
  const count = src.split(u.from).length - 1;
  if (count === 0) {
    console.log(`  MISS  ${u.doc}  expected: ${u.from}`);
    failed++;
    continue;
  }
  if (count > 1) {
    console.log(`  AMBIG ${u.doc}  matched ${count}x: ${u.from}`);
    failed++;
    continue;
  }
  const next = src.replace(u.from, u.to);
  writeFileSync(file, next, "utf8");
  log.push({ doc: u.doc, before: u.from.replace("approver: ", "").replace(/"/g, "") || "null", after: u.to.replace("approver: ", "").replace(/"/g, "") });
  applied++;
}

console.log(`\nF6.6 approver updates applied: ${applied} / ${UPDATES.length} (${failed} failed)`);
for (const e of log) {
  console.log(`  ${e.doc.padEnd(12)} '${e.before}' -> '${e.after}'`);
}

if (failed > 0) process.exit(1);
