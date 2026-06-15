#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_dedup_sweep.mjs
// F6 duplicate sweep. Node-native, no new deps.
//
// Two scans:
//   1. Doc-pair similarity (whole-doc Jaccard on 5-gram shingles)
//   2. Passage-level similarity (per-section Jaccard, surfaces the actual
//      shared passages)
//
// Normalization (applied before shingling):
//   - Strip frontmatter
//   - Strip <Fact id="..." /> tokens (already single-sourced; excluded)
//   - Strip <NonCanonical>...</NonCanonical> blocks (deliberately out of corpus)
//   - Strip <Include doc="..." section="..." />
//   - Strip <SourceGoverns ... />
//   - Strip markdown table syntax (| --- | becomes noise)
//   - Lowercase, collapse whitespace, remove punctuation
//   - Drop very short paragraphs (< 30 chars) - they create false positives on
//     section headers, "Related Documents" boilerplate, etc.
//
// Output: ranked pair list with score + a one-line read suggestion. Kevin
// decides each. No content changes.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const OUT_DIR = join(REPO_ROOT, ".scratch", "opd-audit");
const OUT_FILE = join(OUT_DIR, "f6-dedup-sweep.json");

const SHINGLE_N = 5;
const DOC_PAIR_THRESHOLD = 0.15;       // surface above this
const PASSAGE_PAIR_THRESHOLD = 0.35;   // surface above this; tighter
const MIN_PASSAGE_CHARS = 200;         // ignore tiny passages

function normalize(text) {
  // Strip JSX-style tokens
  let s = text.replace(/<Fact\s+id\s*=\s*"[^"]+"\s*\/>/g, " ");
  s = s.replace(/<NonCanonical>[\s\S]*?<\/NonCanonical>/g, " ");
  s = s.replace(/<Include\s+[^/]*\/>/g, " ");
  s = s.replace(/<SourceGoverns\s+[^/]*\/>/g, " ");
  // Strip markdown table syntax (pipes, dashes-only rows)
  s = s.replace(/^\s*\|[-:\|\s]+\|\s*$/gm, " ");
  s = s.replace(/\|/g, " ");
  // Strip code fences and inline code
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]+`/g, " ");
  // Strip markdown link/image syntax (keep the text)
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Strip markdown emphasis markers + heading markers + blockquote markers
  s = s.replace(/[*_>#]/g, " ");
  // Strip punctuation (keep alphanumerics + spaces)
  s = s.replace(/[^a-zA-Z0-9\s]/g, " ");
  // Lowercase + collapse whitespace
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  return s;
}

function splitMdx(src) {
  const m = src.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : src;
}

function splitSections(body) {
  // Split on H1 (# ) and H2 (## ) headers
  const lines = body.split("\n");
  const sections = [];
  let current = { title: "(preamble)", body: [] };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    if (h1 || h2) {
      if (current.body.length > 0) sections.push(current);
      current = { title: (h1 ? h1[1] : h2[1]).trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0) sections.push(current);
  return sections;
}

function shingles(text, n = SHINGLE_N) {
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length < n) return new Set();
  const out = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

// ── Load + normalize all docs ────────────────────────────────────────────────
const docs = [];
for (const f of readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort()) {
  const id = basename(f, ".mdx");
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  const body = splitMdx(src);
  const normalized = normalize(body);
  const shingleSet = shingles(normalized);
  const sections = splitSections(body)
    .map((s) => ({ title: s.title, normalized: normalize(s.body.join("\n")) }))
    .filter((s) => s.normalized.length >= MIN_PASSAGE_CHARS);
  for (const s of sections) s.shingles = shingles(s.normalized);
  docs.push({ id, normalized, shingles: shingleSet, sections, body_chars: body.length });
}

// ── Doc-pair similarity ──────────────────────────────────────────────────────
const docPairs = [];
for (let i = 0; i < docs.length; i++) {
  for (let j = i + 1; j < docs.length; j++) {
    const d1 = docs[i];
    const d2 = docs[j];
    // skip empty shingle sets (stubs)
    if (d1.shingles.size < 50 || d2.shingles.size < 50) continue;
    const sim = jaccard(d1.shingles, d2.shingles);
    if (sim >= DOC_PAIR_THRESHOLD) {
      docPairs.push({ a: d1.id, b: d2.id, score: sim, a_size: d1.shingles.size, b_size: d2.shingles.size });
    }
  }
}
docPairs.sort((x, y) => y.score - x.score);

// ── Passage-level similarity ─────────────────────────────────────────────────
const passagePairs = [];
for (let i = 0; i < docs.length; i++) {
  for (let j = i + 1; j < docs.length; j++) {
    const d1 = docs[i];
    const d2 = docs[j];
    for (const s1 of d1.sections) {
      if (s1.shingles.size < 20) continue;
      for (const s2 of d2.sections) {
        if (s2.shingles.size < 20) continue;
        const sim = jaccard(s1.shingles, s2.shingles);
        if (sim >= PASSAGE_PAIR_THRESHOLD) {
          passagePairs.push({
            a_doc: d1.id, a_section: s1.title,
            b_doc: d2.id, b_section: s2.title,
            score: sim,
            chars: Math.max(s1.normalized.length, s2.normalized.length),
          });
        }
      }
    }
  }
}
passagePairs.sort((x, y) => y.score - x.score);

// ── Report ───────────────────────────────────────────────────────────────────
const report = { generated_at: new Date().toISOString(), docPairs, passagePairs };
writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

console.log("─".repeat(80));
console.log(`DOC-PAIR similarity (Jaccard on ${SHINGLE_N}-gram shingles, threshold ${DOC_PAIR_THRESHOLD})`);
console.log("─".repeat(80));
console.log("  score  doc-a          doc-b          a-grams  b-grams");
for (const p of docPairs.slice(0, 30)) {
  console.log(`  ${p.score.toFixed(3)}  ${p.a.padEnd(14)} ${p.b.padEnd(14)} ${String(p.a_size).padStart(7)}  ${String(p.b_size).padStart(7)}`);
}
console.log(`  ... (${docPairs.length} pairs above threshold)`);

console.log("");
console.log("─".repeat(80));
console.log(`PASSAGE-LEVEL similarity (per-section Jaccard, threshold ${PASSAGE_PAIR_THRESHOLD})`);
console.log("─".repeat(80));
console.log("  score  a                                 b");
for (const p of passagePairs.slice(0, 40)) {
  const a = `${p.a_doc} / ${p.a_section.slice(0, 30)}`;
  const b = `${p.b_doc} / ${p.b_section.slice(0, 30)}`;
  console.log(`  ${p.score.toFixed(3)}  ${a.padEnd(40)}  ${b}`);
}
console.log(`  ... (${passagePairs.length} passages above threshold)`);

console.log("");
console.log(`Full report written to ${OUT_FILE.replace(REPO_ROOT + "/", "")}`);
