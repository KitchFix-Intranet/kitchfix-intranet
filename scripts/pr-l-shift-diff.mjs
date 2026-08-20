// Reducer for the typography-shift probe. Reads the pre/post
// captures written by tests/pre-l/shift-diff-probe.spec.ts, pairs
// elements by (surface, viewport, selector, index), computes width
// shift %, and prints a table of every shift at or above the
// threshold (default 5%) filtered to the buckets that matter:
// nav pills, headings, and elements inside fixed grid-template-
// columns tracks.
//
// Written for PR-L (Mulish -> Inter flip) but retained for the
// next typography change. Not part of any CI gate.
//
// How to run: see the header of
// tests/pre-l/shift-diff-probe.spec.ts. Short version: run the
// spec twice with SHIFT_DIFF_LABEL=pre and =post, then:
//   node scripts/pr-l-shift-diff.mjs
//
// A shift measured here on an element whose font-family was
// opted-back to Inter pre-change and inherits Inter post-change
// is a transient-state artifact (not user-visible). Cross-check
// the flagged selector against the CSS rules that changed before
// treating a number here as a real regression.

import { readFile } from "node:fs/promises";

const THRESHOLD_PCT = 5;

const pre  = JSON.parse(await readFile("/tmp/pr-l-shift-diff-pre.json",  "utf8"));
const post = JSON.parse(await readFile("/tmp/pr-l-shift-diff-post.json", "utf8"));

function keyFor(cap) { return `${cap.surface}@${cap.width}`; }
const postMap = new Map(post.map(c => [keyFor(c), c]));

function pairElements(preArr, postArr) {
  const map = new Map();
  for (const e of preArr) map.set(`${e.sel}#${e.idx}`, { pre: e });
  for (const e of postArr) {
    const k = `${e.sel}#${e.idx}`;
    if (map.has(k)) map.get(k).post = e;
    else map.set(k, { post: e });
  }
  return Array.from(map.values()).filter(p => p.pre && p.post);
}

function pctShift(a, b) {
  if (!a || a === 0) return null;
  return ((b - a) / a) * 100;
}

const bigShifts = [];
for (const preCap of pre) {
  const postCap = postMap.get(keyFor(preCap));
  if (!postCap) continue;
  const buckets = [
    { name: "nav-pill",  pairs: pairElements(preCap.navPills, postCap.navPills) },
    { name: "heading",   pairs: pairElements(preCap.headings, postCap.headings) },
    { name: "grid-row",  pairs: pairElements(preCap.gridRows, postCap.gridRows) },
  ];
  for (const b of buckets) {
    for (const p of b.pairs) {
      const preW  = p.pre.box?.width;
      const postW = p.post.box?.width;
      const shift = pctShift(preW, postW);
      if (shift == null) continue;
      if (Math.abs(shift) >= THRESHOLD_PCT) {
        bigShifts.push({
          surface: preCap.surface,
          width: preCap.width,
          bucket: b.name,
          sel: p.pre.sel,
          idx: p.pre.idx,
          text: (p.post.text || p.pre.text || "").slice(0, 40),
          preW: preW.toFixed(1),
          postW: postW.toFixed(1),
          shiftPct: shift.toFixed(2),
          wrappedNow: p.post.wrapped,
        });
      }
    }
  }
}

if (bigShifts.length === 0) {
  console.log(`No shifts >=${THRESHOLD_PCT}% found across nav pills, headings, or fixed-grid rows.`);
  process.exit(0);
}

bigShifts.sort((a, b) => Math.abs(Number(b.shiftPct)) - Math.abs(Number(a.shiftPct)));

console.log(`\nPR-L shift diff (pre vs post Mulish->Inter flip)`);
console.log(`Threshold: |shift| >= ${THRESHOLD_PCT}%`);
console.log(`Buckets: nav-pill, heading, grid-row (fixed grid-template-columns tracks)\n`);

const header = ["surface", "vp", "bucket", "sel", "idx", "text", "preW", "postW", "shift%", "wrap"];
const rows = bigShifts.map(s => [
  s.surface, String(s.width), s.bucket, s.sel, String(s.idx),
  s.text, s.preW, s.postW, s.shiftPct, s.wrappedNow ? "YES" : "",
]);
const cols = header.map((_, i) => Math.max(header[i].length, ...rows.map(r => (r[i] || "").length)));
const fmt = (row) => row.map((c, i) => (c || "").padEnd(cols[i])).join("  ");
console.log(fmt(header));
console.log(cols.map(w => "-".repeat(w)).join("  "));
for (const r of rows) console.log(fmt(r));
console.log(`\n${bigShifts.length} rows above threshold.`);
