#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_extract_new_files.mjs
// F2 prep: extract text from the newly-provided files.
//
// Sources:
//   /Users/kevinfietek/Downloads/<various docx>
//   /Users/kevinfietek/Documents/KitchFix/Policies (SOPS & More)/SLA OS Handbook/<docx>
//   PDFs via pdftotext (macOS provides this via brew or comes with TeX Live; we
//   try `pdftotext` first, fall back to `mdfind`-style metadata extract if absent).
//
// Output goes to .scratch/opd-audit/docs/<basename>.txt to match the F0 extract.
// Read-only.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";

const OUT_DIR = "/Users/kevinfietek/dev/kitchfix-opd/.scratch/opd-audit/docs";
mkdirSync(OUT_DIR, { recursive: true });

const sources = [
  // newly-provided docx
  "/Users/kevinfietek/Downloads/Vehicle_Incident_Worksheet_FORM-002_v1_0.docx",
  "/Users/kevinfietek/Downloads/REF-002_Uniform_Standards_Catalog_v1.0.docx",
  "/Users/kevinfietek/Downloads/SLA_Template_Blank_Fill-In_TPL-014_v0_1.docx",
  "/Users/kevinfietek/Downloads/Legacy_SOP_Intake_Worksheet_TPL-015_v1_0.docx",
  "/Users/kevinfietek/Downloads/STD-003_Internal_Communication_Standard_v1.0.docx",
  "/Users/kevinfietek/Downloads/SOP-009_NSF_Certified_for_Sport_Sourcing_v1_0.docx",
  // SLA OS Handbook folder
  "/Users/kevinfietek/Documents/KitchFix/Policies (SOPS & More)/SLA OS Handbook/SLA_OS_Handbook_PB-005_v1_0.docx",
  "/Users/kevinfietek/Documents/KitchFix/Policies (SOPS & More)/SLA OS Handbook/SLA_Example_PDC_Sea_Slugs_REF-005-A_v1_0.docx",
  "/Users/kevinfietek/Documents/KitchFix/Policies (SOPS & More)/SLA OS Handbook/SLA_Example_MLB_Sasquatches_REF-005-B_v1_0.docx",
];

const pdfSources = [
  "/Users/kevinfietek/Downloads/Leadership Performance System SOP-001 v2.0.pdf",
  "/Users/kevinfietek/Downloads/files/Incident_Reporting_POST-001_v1_2.pdf",
  "/Users/kevinfietek/Downloads/files/Incident_Reporting_POST-001_ES_v1_2.pdf",
];

function docxToText(docxPath) {
  const xml = execSync(`unzip -p "${docxPath}" word/document.xml`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  let text = xml
    .replace(/<w:p\b[^>]*>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<\/w:p>/g, "\n");
  text = text.replace(/<w:pStyle\s+w:val="([^"]+)"\/?>/g, (_, style) => {
    if (/^Heading(\d)$/i.test(style)) return `\n[H${style.match(/(\d)/)[1]}] `;
    if (/^Title$/i.test(style)) return `\n[TITLE] `;
    return "";
  });
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  text = text.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function pdfToText(pdfPath) {
  // Try common tools in order. mdimport / mdls give metadata; not body text.
  // pdftotext is the standard.
  for (const cmd of [`pdftotext -enc UTF-8 -nopgbrk -layout "${pdfPath}" -`, `/opt/homebrew/bin/pdftotext -enc UTF-8 -nopgbrk -layout "${pdfPath}" -`, `/usr/local/bin/pdftotext -enc UTF-8 -nopgbrk -layout "${pdfPath}" -`]) {
    try {
      return execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      // try next
    }
  }
  // Fallback: tell the caller
  throw new Error(`No pdftotext available; install with 'brew install poppler' to extract from PDFs`);
}

console.log(`Extracting ${sources.length} docx + ${pdfSources.length} PDFs...`);
let ok = 0, err = 0;
for (const src of sources) {
  try {
    const text = docxToText(src);
    const out = join(OUT_DIR, basename(src, ".docx") + ".txt");
    writeFileSync(out, text, "utf8");
    console.log(`  OK  ${basename(src)}  -> ${text.length}c`);
    ok++;
  } catch (e) {
    console.log(`  ERR ${basename(src)}: ${e.message}`);
    err++;
  }
}
for (const src of pdfSources) {
  try {
    const text = pdfToText(src);
    const out = join(OUT_DIR, basename(src, ".pdf") + ".txt");
    writeFileSync(out, text, "utf8");
    console.log(`  OK  ${basename(src)}  -> ${text.length}c (PDF)`);
    ok++;
  } catch (e) {
    console.log(`  ERR ${basename(src)}: ${e.message}`);
    err++;
  }
}
console.log(`\nDone: ${ok} OK, ${err} ERR`);
