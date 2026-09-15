#!/usr/bin/env node
// Measure the CP table layout the way a screenshot would show it:
// each row's height, each lifted cell's box position + gap to the
// next row's lifted cell, and which cells wrap to a second line.
// Kevin 2026-09-15 - the shape-count probe missed this class because
// it counted DOM presence, not pixel geometry.

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const URL_TBJ = `${BASE}/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
  viewport: { width: 1440, height: 1200 },
});
const page = await ctx.newPage();
await page.goto(URL_TBJ, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3500);

// Row heights: read each row's ROW-HEADER cell height (the .kpi-ov-cp-rh)
// and the max cell height across that row's five cost/rev cells.
const rows = await page.$$eval(".kpi-ov-cp-grid .kpi-ov-cp-rh", els => els.map((rh, ri) => {
  const rhBox = rh.getBoundingClientRect();
  // The row is a slice of the grid - find the six sibling boxes that
  // share this row's top position.
  const grid = rh.parentElement;
  const allChildren = grid.querySelectorAll(":scope > *, :scope > .kpi-ov-cp-rowfrag > *");
  const rowTop = Math.round(rhBox.top);
  const rowCells = [];
  for (const el of allChildren) {
    const b = el.getBoundingClientRect();
    if (Math.abs(b.top - rowTop) < 3) {
      // Sibling of this row header.
      rowCells.push({
        cls: (el.className || "").slice(0, 60),
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        height: Math.round(b.height),
        text: (el.innerText || "").trim().slice(0, 60),
      });
    }
  }
  return {
    ri,
    rhHeight: Math.round(rhBox.height),
    rowCells,
    rowMaxHeight: Math.max(...rowCells.map(c => c.height)),
  };
}));

// Lifted-column ("now") cells: find each and report top/bottom gaps.
const nowCells = await page.$$eval(".kpi-ov-cp-grid .kpi-ov-cp-now", els => els.map(el => {
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    cls: (el.className || "").slice(0, 60),
    top: Math.round(b.top),
    bottom: Math.round(b.bottom),
    height: Math.round(b.height),
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    alignSelf: cs.alignSelf,
    text: (el.innerText || "").trim().slice(0, 40),
  };
}));

console.log("=== Row heights (should all be ~82) ===");
for (const r of rows) {
  const flag = r.rowMaxHeight > 90 ? " ⚠ over 82px" : "";
  console.log(`  row[${r.ri}]  rh=${r.rhHeight}px  max cell=${r.rowMaxHeight}px${flag}`);
  const tallCells = r.rowCells.filter(c => c.height > 82);
  for (const c of tallCells) {
    console.log(`    tall cell (${c.height}px): "${c.text}"`);
  }
}

console.log("\n=== Lifted 'now' column cells (should be flush - no gap) ===");
for (let i = 0; i < nowCells.length; i++) {
  const c = nowCells[i];
  const gap = i + 1 < nowCells.length ? nowCells[i + 1].top - c.bottom : null;
  console.log(`  cell[${i}] top=${c.top} bot=${c.bottom} h=${c.height}  mt=${c.marginTop} mb=${c.marginBottom} pt=${c.paddingTop} pb=${c.paddingBottom}  align-self=${c.alignSelf}  gap-to-next=${gap != null ? gap + "px" : "n/a"}  text="${c.text}"`);
}

// Screenshot the whole board at 1440 for the record.
const before = process.env.OUT || "/tmp/r109-cp-tbj-1440.png";
const board = await page.$(".kpi-ov-cp-card");
if (board) await board.screenshot({ path: before });
console.log(`\nScreenshot saved: ${before}`);

await browser.close();
