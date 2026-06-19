#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_apply_tokens.mjs
// F3 surgical tokenization. Per-fact pass with explicit per-doc substitutions.
//
// Each entry below names: the fact_id, the literal to find, the doc list, and
// any per-doc replacement notes. Exclusions:
//   - Lines inside <NonCanonical>...</NonCanonical> blocks (never touched)
//   - Lines that are already <Fact id="..." /> tokens
//   - SOP-015 §03 body (preserved-error table)
//   - TPL-101..104 brand-promise drift wording (not matched by canonical pattern)
//
// Read-only on everything outside content/documents/. Writes to documents/ only.
// Per F3 rule: "this is a per-fact, reviewed pass." Each substitution listed
// here was vetted from the _probe_fact_candidates.mjs output by the main session.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

// (fact_id, find, replace, optionalDocFilter)
// docFilter: if present, applies only to these doc IDs. Otherwise all docs.
const SUBSTITUTIONS = [
  // brand_promise - 12 canonical occurrences across 11 docs (TPL-101..104 have
  // both canonical and drifted wording; we tokenize the canonical, the drift
  // stays literal as a preserved finding for F5)
  { id: "brand_promise", find: "Best Food, Best Service, Best Hospitality", replace: '<Fact id="brand_promise" />' },

  // wc_carrier - PB-007 §15 says "The Hartford" once
  { id: "wc_carrier", find: "The Hartford", replace: '<Fact id="wc_carrier" />', docs: ["PB-007"] },

  // reheat_rule - SOP-008 / TPL-018 / CHK-003 all say "165F within 2 hours"
  { id: "reheat_rule", find: "165F within 2 hours", replace: '<Fact id="reheat_rule" />' },

  // tphc_clock - TPL-018 says "SOP-008 TPHC 4-hour clock"
  { id: "tphc_clock", find: "TPHC 4-hour clock", replace: 'TPHC <Fact id="tphc_clock" /> clock', docs: ["TPL-018"] },

  // quat_ppm - SOP-008, TPL-018, POST-003 all say "200-400 ppm" or "200 to 400 ppm"
  { id: "quat_ppm", find: "200-400 ppm", replace: '<Fact id="quat_ppm" />' },
  { id: "quat_ppm", find: "200 to 400 ppm", replace: '<Fact id="quat_ppm" />' },

  // warewash_rinse - TPL-018 dish-machine row
  { id: "warewash_rinse", find: "180F manifold (~160F surface)", replace: '<Fact id="warewash_rinse" />' },

  // storage_off_floor - SOP-012 §03
  { id: "storage_off_floor", find: "6 inches off the floor", replace: '<Fact id="storage_off_floor" />' },

  // operating_states - SOP-002 §10 "eight states"; TPL-101..104 JD "8 states"
  { id: "operating_states", find: "operates in eight states", replace: 'operates in <Fact id="operating_states" />', docs: ["SOP-002"] },
  // TPL-101..104 mention "across 8 states" in the JD context
  { id: "operating_states", find: "across 8 states", replace: 'across <Fact id="operating_states" />', docs: ["TPL-101", "TPL-102", "TPL-103", "TPL-104"] },

  // ft_threshold_hours - POL-013 §02
  { id: "ft_threshold_hours", find: "fewer than an average of 30 hours per week", replace: 'fewer than an average of <Fact id="ft_threshold_hours" />', docs: ["POL-013"] },

  // pip_standard_days - SOP-004 §03 (the canonical "30 days, with a 60-day option")
  { id: "pip_standard_days", find: "30 days, with a 60-day option", replace: '<Fact id="pip_standard_days" />', docs: ["SOP-004"] },

  // sick_accrual (Tier 2 floor) - POL-015 uses several phrasings; tokenize
  // the formal canonical "1 hour per 30 hours worked" form only.
  { id: "sick_accrual", find: "1 hour per 30 hours worked", replace: '<Fact id="sick_accrual" />', docs: ["POL-015"] },
  { id: "sick_accrual", find: "one hour per 30 hours worked", replace: '<Fact id="sick_accrual" />', docs: ["POL-015"] },

  // overtime_threshold (Tier 2 floor) - POL-008 carries the FLSA 40hr threshold
  // Source says "over 40 in a workweek" and "1.5x overtime over 40 in a workweek"
  { id: "overtime_threshold", find: "over 40 in a workweek", replace: 'over <Fact id="overtime_threshold" />', docs: ["POL-008"] },

  // record_retention_disciplinary (Tier 2 floor) - SOP-004 §06 "3 years"
  { id: "record_retention_disciplinary", find: "minimum of three years", replace: 'minimum of <Fact id="record_retention_disciplinary" />', docs: ["SOP-004"] },

  // pip_standard_days - SOP-004 §03 "standard PIP timeline is 30 days with a 60-day option"
  { id: "pip_standard_days", find: "30 days with a 60-day option", replace: '<Fact id="pip_standard_days" />', docs: ["SOP-004"] },

  // Cook temps - SOP-008 §05 cooking temperatures table
  { id: "cook_temp_poultry", find: "165F (15 seconds)", replace: '<Fact id="cook_temp_poultry" />', docs: ["SOP-008"] },
  { id: "cook_temp_ground", find: "155F (17 seconds)", replace: '<Fact id="cook_temp_ground" />', docs: ["SOP-008"] },
  { id: "cook_temp_wholemuscle_fish", find: "145F (15 seconds)", replace: '<Fact id="cook_temp_wholemuscle_fish" />', docs: ["SOP-008"] },

  // bac_limit - POL-003 §02 + §03 (two occurrences)
  { id: "bac_limit", find: "BAC) of 0.08% or higher", replace: 'BAC) of <Fact id="bac_limit" /> or higher', docs: ["POL-003"] },
  { id: "bac_limit", find: "BAC of 0.08% or higher", replace: 'BAC of <Fact id="bac_limit" /> or higher', docs: ["POL-003"] },

  // POST-001 severity matrix
  { id: "incident_S1_window", find: "| S1 | 15 minutes |", replace: '| S1 | <Fact id="incident_S1_window" /> |', docs: ["POST-001"] },
  { id: "incident_S2_window", find: "| S2 | 30 minutes |", replace: '| S2 | <Fact id="incident_S2_window" /> |', docs: ["POST-001"] },
  { id: "incident_S3_window", find: "| S3 | 4 hours |", replace: '| S3 | <Fact id="incident_S3_window" /> |', docs: ["POST-001"] },

  // SOP-002 S3 row in notification matrix
  { id: "incident_S3_window", find: "| S3 | Within 4 hours |", replace: '| S3 | Within <Fact id="incident_S3_window" /> |', docs: ["SOP-002"] },

  // date_mark_max - SOP-008 §06: "maximum of 7 days at 41F or below"
  { id: "date_mark_max", find: "maximum of 7 days at 41F or below", replace: 'maximum of <Fact id="date_mark_max" />', docs: ["SOP-008"] },

  // fmla_worksite_threshold - POL-015 §03 CRITICAL + §03 eligibility
  { id: "fmla_worksite_threshold", find: "50+ employees within 75 miles", replace: '<Fact id="fmla_worksite_threshold" />', docs: ["POL-015"] },
];

// Temperature tokens - need narrow per-doc/per-line tokenization since "41F",
// "135F" etc. appear in multiple contexts. We tokenize only the unambiguous
// forms that explicitly invoke the temperature (e.g. "≤ 41F" with the
// inequality sign means cold_hold_temp). Doc filters scope to the food-safety
// cluster only.
const TEMP_SUBS = [
  // cold_hold_temp - "≤ 41F" canonical form (with Unicode comparator)
  { id: "cold_hold_temp", find: "≤ 41F", replace: '<Fact id="cold_hold_temp" />' },
  // hot_hold_temp - "≥ 135F" canonical form
  { id: "hot_hold_temp", find: "≥ 135F", replace: '<Fact id="hot_hold_temp" />' },
  // frozen_temp - "≤ 0F"
  { id: "frozen_temp", find: "≤ 0F", replace: '<Fact id="frozen_temp" />' },
  // threecomp_wash_temp - "≥ 110F"
  { id: "threecomp_wash_temp", find: "≥ 110F", replace: '<Fact id="threecomp_wash_temp" />' },
];

// helpers

function buildLineSkipSet(body) {
  // Returns a Set of zero-indexed line numbers to skip (NonCanonical blocks +
  // already-tokenized lines).
  const lines = body.split("\n");
  const skip = new Set();
  let inNonCanonical = false;
  for (let i = 0; i < lines.length; i++) {
    if (/<NonCanonical>/.test(lines[i])) {
      inNonCanonical = true;
      skip.add(i);
    } else if (/<\/NonCanonical>/.test(lines[i])) {
      skip.add(i);
      inNonCanonical = false;
    } else if (inNonCanonical) {
      skip.add(i);
    }
    // Already a Fact token in this line: don't touch
    if (/<Fact\s+id\s*=\s*"[^"]+"\s*\/>/.test(lines[i])) {
      // We can still tokenize OTHER literals on the same line; only skip if
      // the find target IS the token. For safety, do not skip these here.
    }
  }
  return skip;
}

function findSOP015Sec3Range(docId, body) {
  if (docId !== "SOP-015") return null;
  const lines = body.split("\n");
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+0?3\b/.test(lines[i]) && s === -1) s = i;
    else if (s !== -1 && /^#\s+0?4\b/.test(lines[i])) { e = i; break; }
  }
  return s === -1 ? null : { start: s, end: e === -1 ? lines.length : e };
}

function applySub(docFile, sub, results) {
  const docId = basename(docFile, ".mdx");
  if (sub.docs && !sub.docs.includes(docId)) return;
  const path = join(DOCS_DIR, docFile);
  const src = readFileSync(path, "utf8");
  // Split frontmatter / body so we only touch body
  const fmEnd = src.indexOf("\n---\n", 4);
  if (fmEnd < 0) return;
  const fm = src.slice(0, fmEnd + 5);
  const body = src.slice(fmEnd + 5);

  const skip = buildLineSkipSet(body);
  const sop015 = findSOP015Sec3Range(docId, body);
  const lines = body.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    if (sop015 && i >= sop015.start && i < sop015.end) continue;
    if (!lines[i].includes(sub.find)) continue;
    // Replace only outside any existing <Fact ... /> token on this line:
    // simple approach is fine because find target is unique enough.
    const before = lines[i];
    lines[i] = lines[i].split(sub.find).join(sub.replace);
    if (lines[i] !== before) {
      // Count each instance replaced on this line
      const occurrences = (before.split(sub.find).length - 1);
      count += occurrences;
    }
  }
  if (count > 0) {
    writeFileSync(path, fm + lines.join("\n"), "utf8");
    results.push({ fact: sub.id, doc: docId, count });
  }
}

const results = [];
const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();

console.log("Applying Tier 1 global facts + Tier 2 floor-confirmed facts...\n");

for (const sub of [...SUBSTITUTIONS, ...TEMP_SUBS]) {
  for (const f of docFiles) {
    applySub(f, sub, results);
  }
}

// Roll up by fact
const byFact = {};
for (const r of results) {
  byFact[r.fact] = byFact[r.fact] || { docs: 0, count: 0 };
  byFact[r.fact].docs += 1;
  byFact[r.fact].count += r.count;
}

console.log("Per-fact tokenization counts:");
console.log("──────────────────────────────────────────────");
console.log("fact_id                              docs  count");
console.log("──────────────────────────────────────────────");
const orderedIds = [...new Set([...SUBSTITUTIONS, ...TEMP_SUBS].map((s) => s.id))];
for (const id of orderedIds) {
  const r = byFact[id];
  if (r) {
    console.log(`  ${id.padEnd(36)} ${String(r.docs).padStart(4)}  ${String(r.count).padStart(5)}`);
  } else {
    console.log(`  ${id.padEnd(36)}    0      0   (no canonical literal occurrences found)`);
  }
}
console.log("──────────────────────────────────────────────");
console.log(`\nTotal: ${results.length} per-doc substitutions across ${Object.keys(byFact).length} facts.`);
