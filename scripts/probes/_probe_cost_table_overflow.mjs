#!/usr/bin/env node
// Overview cost table overflow measurement (Kevin 2026-09-04).
//
// For each account × range, at 1680 (and 1366), measure:
//   - card inner width (padding-inclusive)
//   - table pixel width
//   - overflow = table_w - card_inner_w
//   - count of cells rendering on more than one line (wrapping cells)
//
// Reports the same six-row shape Kevin measured by hand.

import { chromium } from "playwright";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3399";

const CASES = [
  { account: "TBJ - FL", range_name: "This year",    qs: "" },
  { account: "TBJ - FL", range_name: "Last period",  qs: "start=2026-07-13&end=2026-08-09" },
  { account: "TBJ - FL", range_name: "This period",  qs: "start=2026-08-10&end=2026-09-06" },
  { account: "TBR - FL", range_name: "This year",    qs: "" },
  { account: "TBR - FL", range_name: "Last period",  qs: "start=2026-07-13&end=2026-08-09" },
  { account: "TBR - FL", range_name: "This period",  qs: "start=2026-08-10&end=2026-09-06" },
  { account: "CIN - KY", range_name: "This period",  qs: "start=2026-08-10&end=2026-09-06" },
  { account: "CIN - OH", range_name: "This period",  qs: "start=2026-08-10&end=2026-09-06" },
];

const VIEWPORTS = [
  { w: 1680, h: 1200 },
  { w: 1366, h:  900 },
];

const b = await chromium.launch();
for (const vp of VIEWPORTS) {
  console.log(`\n═══ viewport ${vp.w}x${vp.h} ═══`);
  console.log("| account | range | card_inner_w | table_w | overflow | wrapping_cells |");
  console.log("|---|---|---:|---:|---:|---:|");
  const c = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const p = await c.newPage();
  for (const cs of CASES) {
    const url = `${BASE}/kpi/overview?account=${encodeURIComponent(cs.account)}` + (cs.qs ? `&${cs.qs}` : "");
    await p.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    try { await p.waitForSelector('[data-kpi-ov="cost-lines"]', { timeout: 15_000 }); }
    catch { console.log(`| ${cs.account} | ${cs.range_name} | — | — | — | — |`); continue; }
    await p.waitForTimeout(400);

    const measurements = await p.evaluate(() => {
      const card = document.querySelector('[data-kpi-ov="cost-lines"]');
      if (!card) return null;
      const cardStyle = getComputedStyle(card);
      const cardW = card.clientWidth;
      const padL = parseFloat(cardStyle.paddingLeft) || 0;
      const padR = parseFloat(cardStyle.paddingRight) || 0;
      // The card body sits inside a .kpi-ov-cb wrapper - that's the inner box.
      const cb = card.querySelector('.kpi-ov-cb');
      const cbW = cb ? cb.clientWidth : cardW;
      const cbStyle = cb ? getComputedStyle(cb) : cardStyle;
      const cbPadL = parseFloat(cbStyle.paddingLeft) || 0;
      const cbPadR = parseFloat(cbStyle.paddingRight) || 0;
      const inner = cbW - cbPadL - cbPadR;
      const table = card.querySelector('table');
      const tableW = table ? table.scrollWidth : 0;

      // Count wrapping cells: cells whose scrollHeight > line-height * 1.4
      // (accounts for slight rounding). Read from every td + th.
      let wrapping = 0;
      let numericMultiLine = 0;
      if (table) {
        const cells = table.querySelectorAll('td, th');
        for (const cell of cells) {
          const lineH = parseFloat(getComputedStyle(cell).lineHeight) || 16;
          const contentH = cell.scrollHeight;
          const isMultiLine = contentH > lineH * 1.6;
          if (isMultiLine) {
            wrapping++;
            // Any numeric cell? Common indicators: .kpi-ov-num class,
            // starts with $ or ends with %.
            const txt = (cell.textContent || "").trim();
            const isNumeric = cell.classList.contains("kpi-ov-num") ||
              /^\$-?\d/.test(txt) || /%\s*$/.test(txt);
            if (isNumeric) numericMultiLine++;
          }
        }
      }
      return { cardW, inner, tableW, overflow: tableW - inner, wrapping, numericMultiLine };
    });
    if (!measurements) { console.log(`| ${cs.account} | ${cs.range_name} | ERR |||`); continue; }
    const sign = measurements.overflow >= 0 ? "+" : "";
    const verdict = measurements.overflow > 0 ? "OVERFLOW" : "fits";
    console.log(`| ${cs.account} | ${cs.range_name} | ${measurements.inner.toFixed(0)}px | ${measurements.tableW}px | ${sign}${measurements.overflow.toFixed(0)}px  ${verdict} | ${measurements.wrapping} (numeric: ${measurements.numericMultiLine}) |`);
  }
  await c.close();
}
await b.close();
