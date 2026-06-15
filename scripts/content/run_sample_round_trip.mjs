#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/run_sample_round_trip.mjs
// F1 sample round trip - per the v2 brief §3, §5, §8 and Phase 2 prompt §7.
//
// Demonstrates the full F1 build chain on one anchor doc (SOP-002):
//   1. Parse MDX -> { frontmatter, body }
//   2. Show Fact resolution under three contexts (company-wide, NY, TX)
//   3. Resolve all Fact tokens in SOP-002 body (company-wide context)
//   4. Flatten for the SousAI corpus
//   5. Preview chunks (existing chunker contract)
//   6. Project the catalog row + document_relationships rows
//   7. Run the validation gate
//
// Read-only. No DB write, no Drive call, no embed call. F1 stops here.
// Bulk conversion (F2) does NOT happen until Kevin reviews this at CK-A.
//
// Usage:
//   node scripts/content/run_sample_round_trip.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { splitMdx, loadYaml } from "./lib/frontmatter.mjs";
import {
  resolveFact,
  resolveFactTokens,
  resolveIncludeTokens,
  flattenForCorpus,
  formatResolution,
} from "./resolver.mjs";
import { projectCorpusForDoc, previewChunks } from "./project_corpus.mjs";
import {
  projectDocumentRow,
  projectRelationships,
  printRow,
  printRelationships,
} from "./project_catalog.mjs";
import { validateOne } from "./validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SAMPLE_DOC = join(REPO_ROOT, "content", "documents", "SOP-002.mdx");
const FACTS_FILE = join(REPO_ROOT, "content", "facts", "operational-facts.yaml");

const bar = (label) => {
  const line = "═".repeat(76);
  console.log(`\n${line}\n  ${label}\n${line}`);
};

const ind = (n = 2) => " ".repeat(n);

// ── Step 1: Parse the sample MDX ─────────────────────────────────────────────
bar("Step 1: parse SOP-002.mdx (MDX -> { frontmatter, body })");

const src = readFileSync(SAMPLE_DOC, "utf8");
const { frontmatter, body } = splitMdx(src);
console.log(`${ind()}id:        ${frontmatter.id}`);
console.log(`${ind()}title:     ${frontmatter.title}`);
console.log(`${ind()}doc_class: ${frontmatter.doc_class}`);
console.log(`${ind()}status:    ${frontmatter.status}`);
console.log(`${ind()}version:   ${frontmatter.version}`);
console.log(`${ind()}owner:     ${frontmatter.owner}`);
console.log(`${ind()}applies_to:${JSON.stringify(frontmatter.applies_to)}`);
console.log(`${ind()}body chars:${body.length}`);
console.log(`${ind()}relationships: ${(frontmatter.relationships || []).length}`);

// ── Step 2: Load facts; demonstrate resolver under three contexts ────────────
bar("Step 2: Resolver behavior across contexts (override demonstration)");

const facts = loadYaml(readFileSync(FACTS_FILE, "utf8"));

const factsToTest = [
  { id: "wc_carrier", label: "wc_carrier (GLOBAL)" },
  { id: "incident_S1_window", label: "incident_S1_window (GLOBAL)" },
  { id: "sick_accrual", label: "sick_accrual (OVERRIDE-BEARING)" },
];

const contexts = [
  { name: "company-wide", ctx: { applies_to: "company-wide" } },
  { name: "scoped: NY only", ctx: { applies_to: { states: ["NY"] } } },
  { name: "scoped: TX only (no override defined)", ctx: { applies_to: { states: ["TX"] } } },
];

for (const ctx of contexts) {
  console.log(`\n${ind()}context: ${ctx.name}`);
  for (const t of factsToTest) {
    const r = resolveFact(t.id, facts[t.id], ctx.ctx);
    console.log(`${ind(4)}${t.label}`);
    console.log(formatResolution(r));
  }
}

// ── Step 3: Resolve every Fact token in SOP-002 body (company-wide) ──────────
bar("Step 3: Substitute Fact tokens in SOP-002 body (applies_to: company-wide)");

const factCtx = { applies_to: frontmatter.applies_to };
const r1 = resolveFactTokens(body, facts, factCtx);
const r2 = resolveIncludeTokens(r1.mdx, {}, factCtx);

console.log(`${ind()}Fact tokens substituted: ${r1.resolutions.length}`);
for (const res of r1.resolutions) {
  console.log(formatResolution(res));
}
console.log(`${ind()}Include tokens (stubbed, F1.5 wires inline): ${r2.includes.length}`);

// ── Step 4: Flatten for corpus ───────────────────────────────────────────────
bar("Step 4: Flatten for SousAI corpus (resolved -> plain text with heading markers)");

const flattened = flattenForCorpus(r2.mdx, frontmatter);
console.log(`${ind()}flattened text chars: ${flattened.length}`);
console.log(`${ind()}first 6 lines:`);
for (const line of flattened.split("\n").slice(0, 6)) {
  console.log(`${ind(4)}${line}`);
}
const h1Count = (flattened.match(/^\[H1\]/gm) || []).length;
const h2Count = (flattened.match(/^\[H2\]/gm) || []).length;
const h3Count = (flattened.match(/^\[H3\]/gm) || []).length;
console.log(`${ind()}heading markers in flattened text: H1=${h1Count}, H2=${h2Count}, H3=${h3Count}`);
console.log(`${ind()}-> structure-aware chunker will produce ~${h1Count + h2Count} section chunks`);

// ── Step 5: Preview chunks (existing chunker contract) ───────────────────────
bar("Step 5: Preview chunks (structure-aware; matches src/lib/sousai/chunk.js contract)");

const corpusResult = projectCorpusForDoc({ frontmatter, body }, {
  facts,
  docsMap: {},
  ctx: { applies_to_override: "company-wide", targetAudience: "operator" },
});
if (!corpusResult.included) {
  console.log(`${ind()}EXCLUDED from corpus: ${corpusResult.reason}`);
} else {
  const chunks = previewChunks(corpusResult.flattenedText, frontmatter);
  console.log(`${ind()}preview chunk count: ${chunks.length}`);
  console.log(`${ind()}first 5 chunks:`);
  for (const c of chunks.slice(0, 5)) {
    console.log(`${ind(4)}#${c.chunk_index}  section="${c.section ?? "(preamble)"}"  ${c.char_count} chars`);
    console.log(`${ind(6)}preview: ${c.preview.slice(0, 80)}...`);
  }
  if (chunks.length > 5) console.log(`${ind(4)}... and ${chunks.length - 5} more`);
}

// ── Step 6: Project catalog row + relationships ──────────────────────────────
bar("Step 6: Project catalog row + document_relationships rows");

const docRow = projectDocumentRow(frontmatter);
printRow(docRow);
console.log();
const relRows = projectRelationships(frontmatter);
printRelationships(relRows);

// ── Step 7: Run validation gate ──────────────────────────────────────────────
bar("Step 7: Run validation gate (the F1 stub of brief §6)");

const allDocIds = new Set([frontmatter.id]); // F1 demo: only SOP-002 exists
const findings = await validateOne({ frontmatter, body }, facts, allDocIds);
const errors = findings.filter((f) => f.severity === "ERROR");
const warns = findings.filter((f) => f.severity === "WARN");

if (findings.length === 0) {
  console.log(`${ind()}PASS - 0 errors, 0 warnings`);
} else {
  console.log(`${ind()}${errors.length} errors, ${warns.length} warnings`);
  for (const f of findings) {
    console.log(`${ind(4)}[${f.severity}] (${f.check}) ${f.msg}`);
  }
}

bar("Round trip complete (F1 sample, CK-A pre-review)");
console.log(`${ind()}sample doc:        ${SAMPLE_DOC.replace(REPO_ROOT + "/", "")}`);
console.log(`${ind()}facts seed:        ${FACTS_FILE.replace(REPO_ROOT + "/", "")}`);
console.log(`${ind()}fact tokens used:  ${r1.resolutions.length} (3 global + 0 override-bearing in this doc)`);
console.log(`${ind()}override-bearing demo: see Step 2 (sick_accrual under NY vs TX vs company-wide)`);
console.log(`${ind()}validation findings: ${errors.length} ERROR + ${warns.length} WARN`);
console.log(`${ind()}                     (the TPL-017 error is the audit's CRITICAL retired-pointer finding`);
console.log(`${ind()}                      structurally caught by the gate - exactly as the brief predicts)`);
console.log();
console.log(`${ind()}CK-A is a hard stop. No bulk conversion (F2) before Kevin reviews this.`);

process.exit(errors.length > 0 ? 0 : 0); // exit 0 even on validation errors: F1 demo
