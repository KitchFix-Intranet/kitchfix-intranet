#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/_probe_parse_tracker.mjs
//
// Parses the Documentation Tracker xlsx (inline-string format, no
// sharedStrings.xml because it was exported from Google Sheets).
// Writes one CSV per sheet to .scratch/opd-audit/tracker_<sheetName>.csv.
//
// Inline-string cells look like:
//   <c r="A1" t="inlineStr"><is><t>cell value</t></is></c>
// Numeric cells look like:
//   <c r="A1"><v>42</v></c>
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const TRACKER = "/Users/kevinfietek/Downloads/Documentation_Tracker_v1_0 (9).xlsx";
const OUT = "/Users/kevinfietek/dev/kitchfix-opd/.scratch/opd-audit";

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Get sheet list from workbook.xml
const workbookXml = execSync(`unzip -p "${TRACKER}" xl/workbook.xml`, { encoding: "utf8" });
const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+sheetId="(\d+)"/g)];
const sheets = sheetMatches.map(([_, name, id]) => ({ name, id: parseInt(id, 10) }));

console.log(`Found ${sheets.length} sheets:`);
sheets.forEach((s) => console.log(`  ${s.id}. ${s.name}`));
console.log();

// Excel column letter -> index. A=0, B=1, ..., Z=25, AA=26, AB=27, ...
function colLetterToIndex(letter) {
  let idx = 0;
  for (const c of letter) {
    idx = idx * 26 + (c.charCodeAt(0) - 64);
  }
  return idx - 1;
}

// Parse a sheet's XML into rows of cell values.
function parseSheet(xml) {
  // Extract each <row>...</row> block
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const rows = new Map();
  let maxCol = 0;
  let m;
  while ((m = rowRe.exec(xml)) !== null) {
    const rowNum = parseInt(m[1], 10);
    const rowXml = m[2];
    const cells = [];
    // Each <c r="A1" t="inlineStr"><is><t>...</t></is></c>
    // or       <c r="A1"><v>42</v></c>
    const cellRe = /<c\s+r="([A-Z]+)\d+"(?:[^>]*\bt="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g;
    let c;
    while ((c = cellRe.exec(rowXml)) !== null) {
      const col = colLetterToIndex(c[1]);
      if (col > maxCol) maxCol = col;
      const t = c[2];
      const inner = c[3];
      let value = "";
      if (t === "inlineStr") {
        // <is>(<t>...</t>)+</is>; concatenate all <t> blocks
        const tMatches = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
        value = tMatches.map((tm) => tm[1]).join("");
      } else {
        // <v>NUMBER</v> or numeric inline
        const vMatch = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (vMatch) value = vMatch[1];
      }
      // Decode entities
      value = value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
      cells[col] = value;
    }
    rows.set(rowNum, cells);
  }
  // Build the matrix in row-order, padding empty cells
  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  const matrix = sortedRows.map((rn) => {
    const cells = rows.get(rn);
    const row = [];
    for (let i = 0; i <= maxCol; i++) row.push(cells[i] ?? "");
    return row;
  });
  return matrix;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Process each sheet
for (const sheet of sheets) {
  const xml = execSync(`unzip -p "${TRACKER}" xl/worksheets/sheet${sheet.id}.xml`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  const matrix = parseSheet(xml);
  const csv = matrix.map((row) => row.map(csvEscape).join(",")).join("\n");
  const outPath = join(OUT, `tracker_${safeFilename(sheet.name)}.csv`);
  writeFileSync(outPath, csv, "utf8");
  console.log(`  wrote ${outPath}  (${matrix.length} rows)`);
}

console.log();
console.log(`Done. CSVs at ${OUT}/tracker_*.csv`);
