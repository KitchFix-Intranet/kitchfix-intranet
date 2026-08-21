#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/_probe_docx_chunking_readiness.mjs
//
// Charter §5E pre-upload check: scan .docx files for real Word heading styles
// vs bold-text-only structure. The SousAI chunker is structure-aware on
// HEADING_1..6 (Google Docs) which maps from "Heading 1".."Heading 6"
// (Word). A doc with no heading styles falls back to size-based chunking
// and retrieves badly. This probe catches those BEFORE upload to Drive.
//
// Read-only. Walks a directory tree, unpacks each .docx (which is a zip),
// reads word/document.xml, counts paragraphs by style.
//
// Usage:
//   node scripts/_probe_docx_chunking_readiness.mjs "/path/to/dir"
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/_probe_docx_chunking_readiness.mjs <dir>");
  process.exit(1);
}

// ── Walk dir, collect .docx files ────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (extname(entry).toLowerCase() === ".docx") out.push(full);
  }
  return out;
}

const files = walk(root).sort();

console.log("═══════════════════════════════════════════════════════════════════════════════════════");
console.log("  Chunking-readiness check - Charter §5E");
console.log("═══════════════════════════════════════════════════════════════════════════════════════");
console.log(`  scanning: ${root}`);
console.log(`  .docx files found: ${files.length}`);
console.log();

// ── Per-file inspection ──────────────────────────────────────────────────────
const results = [];

const tmpRoot = mkdtempSync(join(tmpdir(), "docx-probe-"));

for (const file of files) {
  const name = basename(file);
  let xml = "";
  try {
    // `unzip -p` writes file contents to stdout. word/document.xml is the body.
    xml = execSync(`unzip -p "${file}" word/document.xml`, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    results.push({
      name,
      heading1: 0,
      heading2: 0,
      heading3: 0,
      heading4plus: 0,
      title: 0,
      totalParas: 0,
      boldRuns: 0,
      verdict: "ERROR",
      note: "could not unzip word/document.xml",
    });
    continue;
  }

  // Count paragraph styles. The docx XML uses <w:pStyle w:val="Heading1"/> etc.
  // The "Title" style maps to TITLE in Google Docs. Built-in heading styles
  // in Word are "Heading1".."Heading9" (no space).
  const styleMatches = [...xml.matchAll(/<w:pStyle\s+w:val="([^"]+)"/g)].map((m) => m[1]);
  const heading1 = styleMatches.filter((s) => /^Heading1$/i.test(s)).length;
  const heading2 = styleMatches.filter((s) => /^Heading2$/i.test(s)).length;
  const heading3 = styleMatches.filter((s) => /^Heading3$/i.test(s)).length;
  const heading4plus = styleMatches.filter((s) => /^Heading[4-9]$/i.test(s)).length;
  const title = styleMatches.filter((s) => /^Title$/i.test(s)).length;

  const totalParas = (xml.match(/<w:p\b/g) || []).length;
  const boldRuns = (xml.match(/<w:b\b/g) || []).length;

  const totalHeadings = heading1 + heading2 + heading3 + heading4plus + title;

  // Verdict:
  //   GOOD       -> >=3 real headings AND multi-level (H1 + H2 ideally)
  //   THIN       -> 1-2 real headings (single-section doc; may be intentional)
  //   FLAT       -> 0 real headings AND any bold runs (suspect bold-as-heading)
  //   FLAT-OK    -> 0 real headings AND minimal bold (short form, fine for size-fallback)
  let verdict = "FLAT-OK";
  let note = "";
  if (heading1 + heading2 + heading3 + heading4plus >= 3) {
    verdict = "GOOD";
    if (heading2 === 0 && heading3 === 0) note = "all H1 - no sub-structure (may chunk coarsely)";
  } else if (totalHeadings >= 1) {
    verdict = "THIN";
    note = "few real headings - check if doc is single-section by design";
  } else if (boldRuns > 5) {
    verdict = "FLAT-RISK";
    note = "no Heading styles + lots of bold runs - bold-as-heading risk (size-based fallback expected)";
  } else {
    verdict = "FLAT-OK";
    note = "no Heading styles + low bold - short doc; size-based fallback fine";
  }

  results.push({
    name,
    heading1,
    heading2,
    heading3,
    heading4plus,
    title,
    totalParas,
    boldRuns,
    verdict,
    note,
  });
}

rmSync(tmpRoot, { recursive: true, force: true });

// ── Print table ──────────────────────────────────────────────────────────────
console.log("  Per-file verdict (Charter §5E):");
console.log();
console.log("    Verdict       H1  H2  H3  H4+ Title  Bold   Paras  File");
console.log("    -----------   --  --  --  --- -----  ----   -----  ----");
for (const r of results) {
  const v = r.verdict.padEnd(11);
  const h1 = String(r.heading1).padStart(2);
  const h2 = String(r.heading2).padStart(2);
  const h3 = String(r.heading3).padStart(2);
  const h4 = String(r.heading4plus).padStart(3);
  const t = String(r.title).padStart(5);
  const b = String(r.boldRuns).padStart(4);
  const p = String(r.totalParas).padStart(5);
  console.log(`    ${v}  ${h1}  ${h2}  ${h3}  ${h4}  ${t}  ${b}  ${p}   ${r.name}`);
}
console.log();

// ── Summary buckets ──────────────────────────────────────────────────────────
const buckets = {};
for (const r of results) {
  buckets[r.verdict] = (buckets[r.verdict] || 0) + 1;
}
console.log("  Summary by verdict:");
for (const [v, n] of Object.entries(buckets).sort()) {
  console.log(`    ${v.padEnd(11)} ${String(n).padStart(3)}`);
}
console.log();

// ── Flag rows that need attention ────────────────────────────────────────────
const flagged = results.filter((r) => r.verdict === "FLAT-RISK" || r.verdict === "ERROR");
if (flagged.length > 0) {
  console.log("  Needs attention before upload (FLAT-RISK or ERROR):");
  for (const r of flagged) {
    console.log(`    [${r.verdict}] ${r.name}`);
    console.log(`        -> ${r.note}`);
  }
  console.log();
}

console.log("═══════════════════════════════════════════════════════════════════════════════════════");
console.log("  Done.");
console.log("═══════════════════════════════════════════════════════════════════════════════════════");
