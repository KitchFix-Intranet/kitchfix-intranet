#!/usr/bin/env node
/*
 * R16 screenshot sweep: three cells × three widths = 9 screenshots.
 *   STL - MO FYTD          (pass-through; P0 + P1 + P2 evidence)
 *   CIN - AZ this_period   (pass-through; P0 + P2 evidence)
 *   ALL FYTD               (aggregate; regression coverage)
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const BASE = process.env.KPI_BASE || "http://localhost:3022";
const OUT = process.env.HOME + "/Downloads";
const CELLS = [
  { name: "STL-MO-fytd",         url: `${BASE}/kpi/purchasing?account=STL+-+MO&preset=fytd` },
  { name: "CIN-AZ-this_period",  url: `${BASE}/kpi/purchasing?account=CIN+-+AZ&preset=this_period` },
  { name: "ALL-fytd",            url: `${BASE}/kpi/purchasing?account=ALL&preset=fytd` },
];
const WIDTHS = [1680, 1456, 900];

const results = [];
for (const c of CELLS) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1400 }, extraHTTPHeaders: { "X-Test-Mode": "1" } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
    await page.goto(c.url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector('[data-card]', { timeout: 60000 });
    await page.waitForTimeout(1500);
    const file = `${OUT}/r16-${c.name}-${w}.png`;
    await page.screenshot({ path: file, fullPage: true });
    // Also grab card-purchases numbers from DOM at this width
    const cpData = await page.evaluate(() => {
      const cp = document.querySelector('[data-card="card-purchases"]');
      if (!cp) return null;
      return {
        title: cp.querySelector('.kpi-p-cardtitle')?.textContent?.trim() || null,
        hero_amount: cp.querySelector('.kpi-p-cpstat .kpi-p-n')?.textContent?.trim() || null,
        hero_sub:    cp.querySelector('.kpi-p-cpstat .kpi-p-s')?.textContent?.trim() || null,
        footer:      cp.querySelector('.kpi-p-cplist > div:last-child')?.textContent?.trim() || null,
        list_rows:   cp.querySelectorAll('.kpi-p-rw').length,
      };
    });
    results.push({ cell: c.name, width: w, file, cp: cpData, errors: errors.slice(0, 5) });
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
