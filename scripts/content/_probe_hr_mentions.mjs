#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_hr_mentions.mjs
// F6 surface every body mention of "Human Resources" so Kevin can decide
// whether to fully uniform to "People Operations" or leave the legal/benefits-
// context mentions where "Human Resources" is the named function.
//
// Skips frontmatter (the owner sweep at F5 already moved fields). Skips
// content inside <NonCanonical>...</NonCanonical> blocks (those don't enter
// the corpus). Skips lines that read as "People Operations (HR)" parenthetical
// because that's the canonical first-reference convention.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

function splitFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: "", body: src };
}

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();
const hits = [];

for (const f of docFiles) {
  const id = basename(f, ".mdx");
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  const { body } = splitFrontmatter(src);
  const lines = body.split("\n");
  let inNonCanonical = false;
  for (let i = 0; i < lines.length; i++) {
    if (/<NonCanonical>/.test(lines[i])) inNonCanonical = true;
    if (/<\/NonCanonical>/.test(lines[i])) { inNonCanonical = false; continue; }
    if (inNonCanonical) continue;
    if (!/Human Resources/.test(lines[i])) continue;
    // Skip if line uses the canonical "People Operations (HR)" first-reference form
    if (/People Operations\s*\(\s*HR\s*\)/i.test(lines[i])) continue;
    hits.push({
      doc: id,
      line: i + 1,
      text: lines[i].trim(),
    });
  }
}

// Group by doc for readability
const byDoc = {};
for (const h of hits) {
  byDoc[h.doc] = byDoc[h.doc] || [];
  byDoc[h.doc].push(h);
}

console.log(`HR-body-mentions sweep: ${hits.length} mentions across ${Object.keys(byDoc).length} docs.\n`);

for (const doc of Object.keys(byDoc).sort()) {
  console.log(`── ${doc} (${byDoc[doc].length} mention${byDoc[doc].length === 1 ? "" : "s"}) ──`);
  for (const h of byDoc[doc]) {
    const snip = h.text.length > 140 ? h.text.slice(0, 137) + "..." : h.text;
    console.log(`  L${h.line.toString().padStart(4)}  ${snip}`);
  }
  console.log("");
}
