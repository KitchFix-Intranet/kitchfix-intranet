#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/_probe_extract_doc_set_1.mjs
//
// Pass 0 prep: extract plain text from every .docx in Doc Set 1 (plus
// STD-002 if present). Outputs to ./.scratch/opd-audit/<ID>.txt so the main
// audit can read 60 short text files instead of 60 docx zips.
//
// Also: parses the Documentation Tracker xlsx to CSV at the same location.
//
// Read-only. Output is local scratch, not committed.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename, extname } from "node:path";

const LIB = "/Users/kevinfietek/Documents/OPD v2.0.SB/Doc Set 1";
const TRACKER = "/Users/kevinfietek/Downloads/Documentation_Tracker_v1_0 (9).xlsx";
const OUT = "/Users/kevinfietek/dev/kitchfix-opd/.scratch/opd-audit";

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "docs"), { recursive: true });

const files = readdirSync(LIB).filter((f) => extname(f).toLowerCase() === ".docx").sort();
console.log(`Extracting ${files.length} .docx files to ${OUT}/docs/`);

// ── Extract docx text via unzip + strip XML ──────────────────────────────────
function docxToText(docxPath) {
  const xml = execSync(`unzip -p "${docxPath}" word/document.xml`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  // Replace paragraph + line-break tags with \n, then strip all other tags.
  // <w:p> is paragraph, <w:br/> is line break, <w:tab/> is tab.
  let text = xml
    .replace(/<w:p\b[^>]*>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<\/w:p>/g, "\n");
  // Also capture style markers BEFORE stripping so we can prefix headings.
  text = text.replace(/<w:pStyle\s+w:val="([^"]+)"\/?>/g, (_, style) => {
    if (/^Heading(\d)$/i.test(style)) return `\n[H${style.match(/(\d)/)[1]}] `;
    if (/^Title$/i.test(style)) return `\n[TITLE] `;
    return "";
  });
  // Strip remaining XML tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common XML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  // Collapse runs of whitespace per line
  text = text.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

const extracted = [];
for (const f of files) {
  const fullPath = join(LIB, f);
  try {
    const text = docxToText(fullPath);
    // Output filename: keep original basename (without ext) for traceability
    const out = join(OUT, "docs", basename(f, ".docx") + ".txt");
    writeFileSync(out, text, "utf8");
    extracted.push({ file: f, out, bytes: text.length });
  } catch (e) {
    console.error(`  ERROR ${f}: ${e.message}`);
    extracted.push({ file: f, out: null, bytes: 0, err: e.message });
  }
}

// ── Parse tracker xlsx ───────────────────────────────────────────────────────
// xlsx is a zip; sharedStrings.xml + xl/worksheets/sheet1.xml contain data.
function parseXlsx(xlsxPath) {
  // Try python+pandas first (cheap, robust). Fall back to manual unzip.
  try {
    const csv = execSync(
      `python3 -c "import pandas as pd, sys; df = pd.read_excel(sys.argv[1], sheet_name=None); [df[s].to_csv(sys.stdout, index=False, sep='|') or print('---SHEET_BREAK---', sys.argv[2]) for s in df]" "${xlsxPath}" sheet`,
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    );
    return csv;
  } catch (e) {
    console.error(`  pandas path failed: ${e.message}; falling back to raw unzip`);
    // Fallback: dump sharedStrings.xml + sheet1.xml content
    const ss = execSync(`unzip -p "${xlsxPath}" xl/sharedStrings.xml`, { encoding: "utf8" });
    const s1 = execSync(`unzip -p "${xlsxPath}" xl/worksheets/sheet1.xml`, { encoding: "utf8" });
    return `--- sharedStrings.xml ---\n${ss}\n\n--- sheet1.xml ---\n${s1}`;
  }
}

if (existsSync(TRACKER)) {
  console.log(`Parsing tracker: ${basename(TRACKER)}`);
  try {
    const csv = parseXlsx(TRACKER);
    writeFileSync(join(OUT, "TRACKER.csv"), csv, "utf8");
  } catch (e) {
    console.error(`Tracker parse failed: ${e.message}`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log();
console.log(`Extracted: ${extracted.filter((r) => r.out).length}/${extracted.length}`);
console.log(`Errors:    ${extracted.filter((r) => r.err).length}`);
console.log(`Output:    ${OUT}/`);
console.log();
console.log(`Total bytes of text extracted: ${extracted.reduce((s, r) => s + r.bytes, 0)}`);
