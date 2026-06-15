#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/project_pilot.mjs
// F1.5 pilot: project the whole /content/documents/ set end to end.
//
// For each doc:
//   - parse MDX (gray-matter)
//   - validate schema (ajv) + audit-specific checks
//   - resolve Fact tokens (company-wide ctx)
//   - flatten for corpus
//   - write the flattened text to .scratch/opd-audit/projected-texts/<ID>.txt
//   - compute SHA-256 content hash (for future idempotent re-embed)
//   - print a one-line summary
//
// Then a roll-up: per-doc verdict, chunk preview counts, validation summary.
// Read-only - does NOT call the embed script. Re-embedding would overwrite the
// 8 currently-embedded Live docs and needs explicit Kevin sign-off (per brief
// guardrail "branch-and-PR; no Danger Zone edits").
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { splitMdx, loadYaml } from "./lib/frontmatter.mjs";
import { resolveFactTokens, resolveIncludeTokens, flattenForCorpus, stripNonCanonical } from "./resolver.mjs";
import { validateOne } from "./validate.mjs";
import { projectDocumentRow, projectRelationships } from "./project_catalog.mjs";
import { previewChunks } from "./project_corpus.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CONTENT_DIR = join(REPO_ROOT, "content");
const DOCS_DIR = join(CONTENT_DIR, "documents");
const FACTS_FILE = join(CONTENT_DIR, "facts", "operational-facts.yaml");
const OUT_DIR = join(REPO_ROOT, ".scratch", "opd-audit", "projected-texts");

const bar = (label) => {
  console.log("\n" + "═".repeat(76));
  console.log("  " + label);
  console.log("═".repeat(76));
};

// Clear stale projections
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const facts = loadYaml(readFileSync(FACTS_FILE, "utf8"));

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();
console.log(`Projecting ${docFiles.length} docs from ${DOCS_DIR.replace(REPO_ROOT + "/", "")}/\n`);

const allDocIds = new Set();
const docs = [];
for (const f of docFiles) {
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  const { frontmatter, body } = splitMdx(src);
  docs.push({ basename: f, frontmatter, body });
  if (frontmatter.id) allDocIds.add(frontmatter.id);
}

// Build the cross-doc map the Include resolver needs. F6.5: holds raw bodies;
// the per-doc projection below runs Fact resolution AFTER Include inlining so
// any Fact tokens carried in by an Include resolve in the calling doc's ctx.
// For F6.5's only Include (POL-003 §06 -> SOP-009 §03), the source section has
// no Fact tokens so the choice does not affect output.
const docsMap = {};
for (const d of docs) {
  if (d.frontmatter.id) docsMap[d.frontmatter.id] = d.body;
}

const summary = [];
let totalErrors = 0;
let totalWarns = 0;
let totalChunksPreviewed = 0;
let totalFactTokensResolved = 0;
let totalNonCanonicalStripped = 0;

bar("Per-doc projection");

for (const d of docs) {
  const fm = d.frontmatter;
  const factCtx = { applies_to: fm.applies_to || "company-wide" };

  // Resolve Include tokens FIRST, then Fact tokens, so any Fact tokens carried
  // in by an Include resolve in the calling doc's ctx.
  const r1 = resolveIncludeTokens(d.body, docsMap, factCtx);
  const r2 = resolveFactTokens(r1.mdx, facts, factCtx);
  // Strip NonCanonical pre-flatten + count for inspection
  const nc = stripNonCanonical(r2.mdx);
  const flattenedText = flattenForCorpus(r2.mdx, fm);

  // Compute content hash for future idempotent re-embed
  const hash = createHash("sha256").update(flattenedText).digest("hex").slice(0, 16);

  // Write the projected text
  const outPath = join(OUT_DIR, `${fm.id}.txt`);
  writeFileSync(outPath, flattenedText, "utf8");

  // Chunk preview
  const chunks = previewChunks(flattenedText, fm);

  // Catalog projection
  const docRow = projectDocumentRow(fm);
  const relRows = projectRelationships(fm);

  // Validation
  const findings = await validateOne({ frontmatter: fm, body: d.body }, facts, allDocIds);
  const errors = findings.filter((x) => x.severity === "ERROR").length;
  const warns = findings.filter((x) => x.severity === "WARN").length;
  totalErrors += errors;
  totalWarns += warns;
  totalFactTokensResolved += r2.resolutions.length;
  totalNonCanonicalStripped += nc.stripped;
  totalChunksPreviewed += chunks.length;

  const includesResolved = r1.includes.filter((x) => x.resolved).length;
  const statusBadge = errors > 0 ? "ERR " : warns > 0 ? "WARN" : "PASS";
  console.log(`  ${statusBadge}  ${fm.id.padEnd(11)}  ${fm.title.slice(0, 30).padEnd(30)}  v${fm.version || "—"}  ${flattenedText.length.toString().padStart(6)}c  ${chunks.length.toString().padStart(3)}chunks  ${r2.resolutions.length}fact  ${includesResolved}/${r1.includes.length}inc  ${nc.stripped}nc  ${errors}E/${warns}W  hash=${hash}`);

  summary.push({
    id: fm.id,
    title: fm.title,
    status: fm.status,
    version: fm.version,
    flatten_chars: flattenedText.length,
    chunk_preview: chunks.length,
    fact_tokens: r2.resolutions.length,
    includes: r1.includes,
    non_canonical_stripped: nc.stripped,
    relationships: relRows.length,
    errors,
    warns,
    content_hash: hash,
    out_path: outPath.replace(REPO_ROOT + "/", ""),
  });
}

bar("Roll-up");
console.log(`  docs:                ${docs.length}`);
console.log(`  total errors:        ${totalErrors}  (TPL-017 retired pointer is the audit CRITICAL #1, caught structurally)`);
console.log(`  total warnings:      ${totalWarns}  (most are cross-doc relationships to docs not yet converted)`);
console.log(`  chunks previewed:    ${totalChunksPreviewed}  (existing 8-doc Sous corpus has 190 chunks)`);
console.log(`  fact tokens resolved: ${totalFactTokensResolved}`);
console.log(`  non-canonical blocks stripped: ${totalNonCanonicalStripped}  (STD-001 callout examples + PB-003 TRY THIS / NOT THIS coaching)`);
console.log(`  projected text out:  ${OUT_DIR.replace(REPO_ROOT + "/", "")}/`);
console.log();
console.log("  Next: confirm baseline retrieval regression still passes against the");
console.log("        currently-embedded corpus. The actual re-embed against projected");
console.log("        text needs explicit Kevin sign-off (it overwrites prod chunks).");

// Write a JSON summary the CK-B report can reference
const summaryFile = join(REPO_ROOT, ".scratch", "opd-audit", "pilot-summary.json");
writeFileSync(summaryFile, JSON.stringify({ docs: summary, totals: { docs: docs.length, errors: totalErrors, warns: totalWarns, chunks_previewed: totalChunksPreviewed, fact_tokens: totalFactTokensResolved, non_canonical_stripped: totalNonCanonicalStripped } }, null, 2));
console.log(`  summary JSON: ${summaryFile.replace(REPO_ROOT + "/", "")}`);
