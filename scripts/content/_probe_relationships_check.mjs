#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_relationships_check.mjs
// F6 relationship-graph check. Two outputs:
//
//   1. Orphan list - docs with 0 inbound relationships. Some are legitimately
//      standalone (POSTERs derived from anchors; reference cards).
//
//   2. Missing-edge list - the body of a doc references another doc by ID,
//      but the doc's `relationships` block has no entry for that target.
//      Mechanical proposals; Kevin confirms the batch.
//
// Surface only. No edges added.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitMdx } from "./lib/frontmatter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

// Doc IDs follow PREFIX-NNN (with optional -ES suffix on translations)
const DOC_ID_RE = /\b(PB|STD|POL|SOP|TPL|CHK|REF|AGR|FORM|POST|POSTER)-\d{3}(?:-[A-Z]+)?\b/g;

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();
const docs = new Map();
const inbound = new Map(); // doc -> Set of docs that point TO it

for (const f of docFiles) {
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  try {
    const { frontmatter, body } = splitMdx(src);
    if (!frontmatter.id) continue;
    docs.set(frontmatter.id, { frontmatter, body, file: f });
    if (!inbound.has(frontmatter.id)) inbound.set(frontmatter.id, new Set());
  } catch (e) {
    // skip parse errors (shouldn't happen post-F5)
  }
}

// Build inbound map
for (const [id, doc] of docs) {
  for (const rel of doc.frontmatter.relationships || []) {
    if (!rel.to) continue;
    if (!inbound.has(rel.to)) inbound.set(rel.to, new Set());
    inbound.get(rel.to).add(id);
  }
  if (doc.frontmatter.supersedes) {
    if (!inbound.has(doc.frontmatter.supersedes)) inbound.set(doc.frontmatter.supersedes, new Set());
    inbound.get(doc.frontmatter.supersedes).add(id);
  }
}

// Orphans: docs in /content/documents with 0 inbound. Exclude Retired docs
// (they're not load-bearing) and Placeholder/Pending docs (catalog rows only).
const orphans = [];
for (const [id, doc] of docs) {
  const inboundSet = inbound.get(id) || new Set();
  if (inboundSet.size > 0) continue;
  const fm = doc.frontmatter;
  // Skip Retired (out of corpus regardless) and Placeholders (no body)
  if (fm.status === "Retired" || fm.status === "Placeholder") continue;
  orphans.push({
    id,
    status: fm.status,
    doc_class: fm.doc_class,
    title: fm.title,
    in_corpus: fm.in_corpus !== false,
  });
}

console.log("─".repeat(80));
console.log(`Orphan docs (0 inbound relationships; excluding Retired + Placeholder)`);
console.log("─".repeat(80));
console.log("  status      class  in_corpus  id                title");
for (const o of orphans.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`  ${o.status.padEnd(11)} ${o.doc_class.padEnd(6)} ${(o.in_corpus ? "yes" : "no ").padEnd(10)} ${o.id.padEnd(17)} ${o.title}`);
}
console.log(`  -- ${orphans.length} orphan(s)`);

// Missing edges: body references another doc by ID but no relationships entry.
console.log("");
console.log("─".repeat(80));
console.log(`Missing edges (body cites doc ID but no relationships entry)`);
console.log("─".repeat(80));
console.log("  doc            cites      sample context");

const missing = [];
for (const [id, doc] of docs) {
  const fm = doc.frontmatter;
  // Build set of already-declared targets
  const declared = new Set();
  for (const rel of fm.relationships || []) {
    if (rel.to) declared.add(rel.to);
  }
  if (fm.supersedes) declared.add(fm.supersedes);
  if (fm.translation_of) declared.add(fm.translation_of);
  // Scan body for doc IDs, skip refs to self
  const bodyHits = new Map(); // target -> first sample line
  const lines = doc.body.split("\n");
  let inNC = false;
  for (let i = 0; i < lines.length; i++) {
    if (/<NonCanonical>/.test(lines[i])) inNC = true;
    if (/<\/NonCanonical>/.test(lines[i])) { inNC = false; continue; }
    if (inNC) continue;
    // Skip lines inside markdown table separator
    let m;
    DOC_ID_RE.lastIndex = 0;
    while ((m = DOC_ID_RE.exec(lines[i])) !== null) {
      const target = m[0];
      if (target === id) continue;
      if (!docs.has(target)) continue; // can't add edge to non-existent doc
      if (declared.has(target)) continue;
      if (!bodyHits.has(target)) {
        bodyHits.set(target, { line: i + 1, sample: lines[i].trim().slice(0, 100) });
      }
    }
  }
  for (const [target, info] of bodyHits) {
    missing.push({ from: id, to: target, line: info.line, sample: info.sample });
  }
}

for (const m of missing.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
  console.log(`  ${m.from.padEnd(14)} ${m.to.padEnd(10)} L${m.line}: ${m.sample.slice(0, 70)}`);
}
console.log(`  -- ${missing.length} missing edge(s) proposed`);
