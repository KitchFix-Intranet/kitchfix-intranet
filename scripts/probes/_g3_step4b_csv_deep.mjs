#!/usr/bin/env node
/* G3 4b: proper CSV probe of first data rows */

import fs from "node:fs";
const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// The CSV uses `=HYPERLINK("url","label")` in some cells. Cross-line records need to be joined.
// Try line-by-line then merge if a line has an odd number of unescaped quotes...
// simpler: read whole file and parse as a proper stream

const raw = fs.readFileSync(CSV, "utf8");
// use a proper record-oriented parser: split into records at newlines OUTSIDE quotes
const records = [];
{
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (inQuote && raw[i + 1] === '"') { cur += '""'; i++; }
      else { cur += c; inQuote = !inQuote; }
    } else if (c === "\n" && !inQuote) {
      records.push(cur);
      cur = "";
    } else if (c === "\r" && !inQuote) {
      // skip
    } else {
      cur += c;
    }
  }
  if (cur.length) records.push(cur);
}
console.log(`records: ${records.length}`);

const header = parseCsvLine(records[0]);
console.log("header:", header.length, "cols");
for (let i = 0; i < header.length; i++) console.log(`  ${i}: ${header[i]}`);

// print first 3 data records fully
for (let n = 1; n <= 3; n++) {
  const cells = parseCsvLine(records[n]);
  console.log(`\n--- record ${n} (${cells.length} cells) ---`);
  for (let i = 0; i < cells.length; i++) {
    let v = cells[i]; if (v.length > 200) v = v.slice(0,200) + "...";
    console.log(`  [${i}] ${header[i]}: ${JSON.stringify(v)}`);
  }
}
