#!/usr/bin/env node
// Guard 0 probe (Kevin 2026-09-16). Reads src/app/kpi/current-period.css
// and asserts every rule selector is scoped to `.kpi-app .kpi-ov-cp-*`.
// A single unprefixed selector (e.g. `.sub`, `.grid`, `.bar`) leaks into
// 47+ other files across the app because this stylesheet is imported by
// three page.js files. Exit non-zero on any violation.
//
// Method: parse rule blocks (top-level, ignoring at-rules and their
// nested contents apart from selector list on the outer rule head),
// split selectors on commas, walk each selector; every non-pseudo
// simple selector must be inside a chain that includes `.kpi-app` AND a
// class starting with `.kpi-ov-cp-`. Comments and whitespace stripped
// before parsing.

import { readFileSync } from "fs";

const CSS_PATH = new URL("../../src/app/kpi/current-period.css", import.meta.url).pathname;
const src = readFileSync(CSS_PATH, "utf8");

// Strip block comments.
const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "");

// Walk top-level, tracking brace depth. Emit each depth-1 selector list.
const selectorLists = [];
let i = 0;
let depth = 0;
let selBuf = "";
while (i < noComments.length) {
  const c = noComments[i];
  if (c === "{") {
    if (depth === 0) {
      const s = selBuf.trim();
      if (s && !s.startsWith("@")) selectorLists.push(s);
      selBuf = "";
    }
    depth++;
    i++;
    continue;
  }
  if (c === "}") { depth--; i++; continue; }
  if (depth === 0) selBuf += c;
  i++;
}

// Split selectors by top-level commas (there are no parens/brackets in
// this file so a naive split is safe).
const selectors = [];
for (const list of selectorLists) {
  for (const s of list.split(",")) {
    const t = s.trim();
    if (t) selectors.push(t);
  }
}

// A selector is compliant if it contains BOTH `.kpi-app` and a token
// starting with `.kpi-ov-cp-` somewhere in the chain. Descendant/child/
// sibling combinators are honoured because we only require presence.
const bad = [];
for (const s of selectors) {
  const hasAppScope = /\.kpi-app(\s|>|\+|~|\.|:|\[|$)/.test(s);
  const hasCpPrefix = /\.kpi-ov-cp-/.test(s);
  if (!hasAppScope || !hasCpPrefix) bad.push(s);
}

console.log(`current-period.css: ${selectors.length} selectors scanned`);
if (bad.length === 0) {
  console.log("PASS · every selector is scoped to `.kpi-app` AND carries `.kpi-ov-cp-`");
  process.exit(0);
} else {
  console.error(`FAIL · ${bad.length} selectors violate the Guard 0 prefix rule:`);
  for (const s of bad) console.error("  ", s);
  process.exit(1);
}
