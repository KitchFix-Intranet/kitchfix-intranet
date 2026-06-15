#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_f5_sweeps.mjs
// F5 mechanical sweeps - the JD brand-promise drift tokenization, JD status
// fix, FOH Cafe Attendant role-name normalization, and the People Operations
// terminology sweep.
//
// Read-only on everything outside content/documents/ and content/facts/.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const FACTS_FILE = join(REPO_ROOT, "content", "facts", "operational-facts.yaml");

// (description, find, replace, docs filter (or null for all))
const SWEEPS = [
  // ───── JD TEMPLATE TPL-101..104 fixes ─────
  // Brand-promise drift: tokenize the full phrase including the surrounding language
  // so the rendered text reads naturally.
  {
    desc: "JD drift -> brand_promise token",
    find: "best-in-class hospitality through exceptional food and unmatched service",
    replace: '<Fact id="brand_promise" /> through exceptional food and unmatched service',
    docs: ["TPL-101", "TPL-102", "TPL-103", "TPL-104"],
  },
  // Status Placeholder -> In Build (full-body JDs)
  {
    desc: "JD status -> In Build",
    find: "status: Placeholder",
    replace: "status: In Build",
    docs: ["TPL-101", "TPL-102", "TPL-103", "TPL-104"],
  },
  // FOH Cafe Attendant role name (TPL-103 only - the other JDs name Cook / Dishwasher / Driver)
  {
    desc: "Cafe Attendant -> FOH Cafe Attendant",
    find: "Internal JD - Cafe Attendant",
    replace: "Internal JD - FOH Cafe Attendant",
    docs: ["TPL-103"],
  },
  {
    desc: "Cafe Attendant body -> FOH Cafe Attendant",
    find: "**Job Title:** Café Attendant",
    replace: "**Job Title:** FOH Cafe Attendant",
    docs: ["TPL-103"],
  },
  // ───── PB-010 recipe-reality blurb (insert under §05 Menu and Production header) ─────
  // (handled separately below - needs anchor finding)

  // ───── People Operations terminology sweep ─────
  // Owner field "Human Resources" -> "People Operations" across POL/SOP/PB/AGR/FORM/TPL
  {
    desc: "Owner field HR -> People Operations",
    find: 'owner: "Human Resources"',
    replace: 'owner: "People Operations"',
    docs: null, // all docs
  },
  {
    desc: "Owner field Director of Human Resources -> Director of People Operations",
    find: 'owner: "Director of Human Resources"',
    replace: 'owner: "Director of People Operations"',
    docs: null,
  },
];

// People Operations sweep also touches the facts YAML (Kevin's directive).
const FACTS_SWEEPS = [
  // sick_accrual owner
  { find: '  owner: "Human Resources"\n  description: "Floor confirmed. Per-state bumps', replace: '  owner: "People Operations"\n  description: "Floor confirmed. Per-state bumps' },
  // record_retention_disciplinary owner
  { find: '  owner: "Human Resources"\n  description: "Floor confirmed at 3 years', replace: '  owner: "People Operations"\n  description: "Floor confirmed at 3 years' },
  // pip_standard_days owner
  { find: '    authority: "SOP-004"\n  owner: "Human Resources"\n\n# ─────', replace: '    authority: "SOP-004"\n  owner: "People Operations"\n\n# ─────' },
  // ft_threshold_hours owner
  { find: '    value: "30 hrs/week"\n    authority: "POL-013"\n  owner: "Human Resources"', replace: '    value: "30 hrs/week"\n    authority: "POL-013"\n  owner: "People Operations"' },
  // wc_carrier owner
  { find: '    authority: "Confirmed (KitchFix workers compensation carrier)"\n  owner: "Human Resources"', replace: '    authority: "Confirmed (KitchFix workers compensation carrier)"\n  owner: "People Operations"' },
];

function applySweepToDocs(sweep, docFiles) {
  const matchingDocs = sweep.docs ? sweep.docs.map((d) => `${d}.mdx`) : docFiles;
  let totalCount = 0;
  for (const f of matchingDocs) {
    const path = join(DOCS_DIR, f);
    try {
      const src = readFileSync(path, "utf8");
      if (!src.includes(sweep.find)) continue;
      const updated = src.split(sweep.find).join(sweep.replace);
      const count = (src.length - updated.length) / Math.max(1, sweep.find.length - sweep.replace.length);
      writeFileSync(path, updated, "utf8");
      totalCount += Math.abs(count) || 1;
    } catch (e) {
      // file may not exist (sweep.docs entry); skip
    }
  }
  return totalCount;
}

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();
console.log("Applying F5 sweeps...\n");

for (const sw of SWEEPS) {
  const n = applySweepToDocs(sw, docFiles);
  console.log(`  ${n > 0 ? "OK " : "·· "} ${sw.desc.padEnd(50)}  ${n} file(s) touched`);
}

console.log("\nApplying facts.yaml owner sweeps...");
let factsSrc = readFileSync(FACTS_FILE, "utf8");
let factsCount = 0;
for (const sw of FACTS_SWEEPS) {
  if (factsSrc.includes(sw.find)) {
    factsSrc = factsSrc.replace(sw.find, sw.replace);
    factsCount++;
  }
}
writeFileSync(FACTS_FILE, factsSrc, "utf8");
console.log(`  ${factsCount} owner field(s) updated in facts.yaml`);

console.log("\nF5 sweeps complete.");
