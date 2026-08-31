#!/usr/bin/env node
// scripts/probes/_probe_kpi_css_token_gate.mjs
//
// V30-5 static CSS token gate. Static portion of the older
// scripts/_audit_kpi_scale.mjs, standalone so CI can run it without
// a browser. Owner ruling 2026-08-24: the older gate was never wired
// - no npm script, no CI, no hook - and 68 raw px violations shipped
// unnoticed. HS FB1 PR-1 wires it.
//
// What this checks
//   [d1] raw px literals for type/spacing outside the .kpi-app token
//        block (target: 0). Excludes borders (px <= 3) and the
//        rad-pill sentinel (px === 999). Excludes literals inside
//        @media queries (per the older gate's rule).
//   [d2] font-weight numeric literals inside the .kpi-hs-* section
//        (informational). PR-2 will normalise these to match the
//        period board's role weights; this surface counts them so
//        the drift is visible on every run.
//
// Baseline
//   BASELINE_D1 is the CURRENT literal count as of PR-1 (68). PR-2
//   drops the count; edit BASELINE_D1 in the same PR to lock the new
//   floor. The gate FAILS when the actual count > BASELINE_D1 - so
//   PR-1 does not block itself but a fresh literal added later does.
//
// Usage
//   node scripts/probes/_probe_kpi_css_token_gate.mjs
//   npm run audit:kpi-scale

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
// Overview Phase 3 (2026-08-31): overview.css joins the gate in the
// same PR the stylesheet lands, per §5 charter 6 ("gates extended at
// file-add"). Each stylesheet is scanned independently; the token
// block bounds are its own .kpi-app declaration if present, else the
// whole file. Multi-file scan keeps a per-file drift count and sums
// to the total d1 count.
const CSS_PATHS = [
  path.join(REPO_ROOT, "src/app/kpi/kpi.css"),
  path.join(REPO_ROOT, "src/app/kpi/overview/overview.css"),
];

// HS FB1 PR-2 (2026-08-24) drove d1 from 68 to 0 and locks the floor
// here. Do NOT bump this to accommodate a new violation - fix the
// violation instead. Every new declaration in .kpi-hs-* (or anywhere
// outside the .kpi-app token block) must author against a token.
const BASELINE_D1 = 0;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function scanFile(cssPath) {
  const raw = fs.readFileSync(cssPath, "utf8");
  const src = stripComments(raw);

  // .kpi-app { --tokens... } block bounds - excluded from the count
  // since token declarations legitimately carry px literals. If the
  // file does not declare .kpi-app (overview.css does not - kpi.css
  // holds the canonical token block), the whole file is subject to
  // the scan; that is correct because a satellite stylesheet should
  // never redeclare tokens.
  const appIdx = src.indexOf(".kpi-app");
  const brace = appIdx < 0 ? -1 : src.indexOf("{", appIdx);
  let tokenStart = -1, tokenEnd = -1;
  if (brace >= 0) {
    let depth = 0, i = brace;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    tokenStart = brace;
    tokenEnd = i;
  }
  const inTokenBlock = (pos) => pos >= tokenStart && pos < tokenEnd;

  // @media { ... } bounds - excluded per the older gate's rule so a
  // responsive breakpoint override with a raw px cutoff doesn't count
  // as drift.
  const media = [...src.matchAll(/@media[^{]*\{/g)].map(m => {
    const openAt = m.index + m[0].length - 1;
    let d = 0, j = openAt;
    for (; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}") { d--; if (d === 0) { j++; break; } }
    }
    return { start: m.index, end: j };
  });
  const inMedia = (pos) => media.some(mm => pos >= mm.start && pos < mm.end);

  const literalRe = /(?:^|[\s;{])(font-size|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap)\s*:\s*([^;]+);/g;

  function posToLine(pos) {
    return src.slice(0, pos).split("\n").length;
  }

  const d1 = { total: 0, samples: [] };
  let m;
  while ((m = literalRe.exec(src)) !== null) {
    if (inTokenBlock(m.index)) continue;
    if (inMedia(m.index)) continue;
    const val = m[2];
    const pxMatches = [...val.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1]));
    for (const n of pxMatches) {
      if (n <= 3) continue;
      if (n === 999) continue;
      d1.total++;
      if (d1.samples.length < 15) {
        d1.samples.push({ file: cssPath, line: posToLine(m.index), prop: m[1], n, snippet: m[0].trim().slice(0, 90) });
      }
    }
  }

  // [d2] font-weight literals inside the .kpi-hs-* section (from the
  // first .kpi-hs- selector to end of file).
  const hsStart = src.search(/\.kpi-hs-[a-z-]+/);
  const hsSection = hsStart >= 0 ? src.slice(hsStart) : "";
  const fwMatches = [...hsSection.matchAll(/font-weight\s*:\s*(\d{3})/g)];
  const d2 = { total: fwMatches.length, byValue: {} };
  for (const fw of fwMatches) {
    d2.byValue[fw[1]] = (d2.byValue[fw[1]] || 0) + 1;
  }

  return { d1, d2 };
}

function scan() {
  const merged = { d1: { total: 0, samples: [] }, d2: { total: 0, byValue: {} } };
  for (const p of CSS_PATHS) {
    const one = scanFile(p);
    merged.d1.total += one.d1.total;
    merged.d1.samples.push(...one.d1.samples.slice(0, 15 - merged.d1.samples.length));
    merged.d2.total += one.d2.total;
    for (const [k, v] of Object.entries(one.d2.byValue)) {
      merged.d2.byValue[k] = (merged.d2.byValue[k] || 0) + v;
    }
  }
  return merged;
}

function report() {
  const { d1, d2 } = scan();

  console.log("=".repeat(72));
  console.log("V30-5 static CSS token gate (HS FB1 PR-1 wiring)");
  console.log("=".repeat(72));
  console.log("");
  console.log(`[d1] raw px literals for type/spacing outside token block`);
  console.log(`     count:    ${d1.total}`);
  console.log(`     baseline: ${BASELINE_D1}   (PR-2 drops this to 0)`);
  if (d1.samples.length > 0) {
    console.log(`     sample of ${Math.min(d1.samples.length, 15)}:`);
    for (const s of d1.samples) {
      console.log(`       L${s.line}  [${s.prop}]  ${s.n}px  ${s.snippet}`);
    }
  }
  console.log("");
  console.log(`[d2] font-weight literals in .kpi-hs-* section (informational)`);
  console.log(`     count:    ${d2.total}`);
  console.log(`     by value: ${JSON.stringify(d2.byValue)}`);
  console.log(`     (period-board weights should drive HS role weights;`);
  console.log(`      PR-2 normalises. This counter surfaces the drift.)`);
  console.log("");
  console.log("=".repeat(72));
  const fail = d1.total > BASELINE_D1;
  if (fail) {
    console.log(`V30-5 GATE FAIL - d1 count ${d1.total} > baseline ${BASELINE_D1}`);
    console.log(`If this is a new violation, replace the literal with a token.`);
    console.log(`If the fix genuinely lowers the count, drop BASELINE_D1 in the same PR.`);
  } else if (d1.total > 0) {
    console.log(`V30-5 gate PASS at baseline (${d1.total} <= ${BASELINE_D1})`);
    console.log(`No new drift. Existing count carried forward per PR-1 wiring.`);
  } else {
    console.log(`V30-5 gate PASS (0 violations)`);
  }
  console.log("=".repeat(72));
  process.exit(fail ? 1 : 0);
}

report();
