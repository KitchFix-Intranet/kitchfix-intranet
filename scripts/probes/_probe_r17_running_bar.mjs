#!/usr/bin/env node
/*
 * R17 acceptance: running-period bar + projection outline.
 *
 * 1. Screenshots ALL FYTD on BOTH URL shapes at 1680, 1456, 900.
 * 2. Asserts both URL shapes resolve to the same range (S2 rule).
 * 3. Sniffs the DOM for:
 *      - Running bar background color (should be --kpi-p-steel across
 *        all three charts).
 *      - Projection outline border color (should be --n-700, contrast
 *        >= 3.0:1 against white plot bg).
 *      - Projection outline geometry (bottom + height percentages).
 *      - Caption text ("N% through" preserved).
 * 4. Fires on both period card + Food + Packaging so all three
 *    read identically per Kevin's ruling.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chromePath) { console.error("chrome not found"); process.exit(1); }

const BASE = process.env.KPI_BASE || "http://localhost:3022";
const OUT = process.env.HOME + "/Downloads";
const WIDTHS = [1680, 1456, 900];

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

async function fetchRange(url) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Test-Mode": "1" } });
  const page = await ctx.newPage();
  const resp = await page.request.get(url);
  const d = await resp.json();
  await ctx.close();
  return d.range || null;
}

async function grab(name, url, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 1600 },
    extraHTTPHeaders: { "X-Test-Mode": "1" },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('.kpi-p-wc', { timeout: 60000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    // For each chart on the board, find the running bar (has st-running) + projection.
    const charts = [...document.querySelectorAll('[data-card]')];
    const results = [];
    for (const chart of charts) {
      const runningBar = chart.querySelector('.kpi-p-bar.st-running');
      if (!runningBar) continue;
      const proj = chart.querySelector('.kpi-p-proj');
      const cap = chart.querySelector('.kpi-p-wc:has(.st-running) .kpi-p-x');
      const style = getComputedStyle(runningBar);
      const projStyle = proj ? getComputedStyle(proj) : null;
      results.push({
        card: chart.getAttribute('data-card'),
        bar_bg: style.backgroundColor,
        proj_present: !!proj,
        proj_border_color: projStyle ? projStyle.borderTopColor : null,
        proj_bottom_pct: proj ? proj.style.bottom : null,
        proj_height_pct: proj ? proj.style.height : null,
        caption_text: cap ? cap.textContent.trim() : null,
      });
    }
    return results;
  });
  const file = `${OUT}/r-r17-${name}-${width}.png`;
  await page.screenshot({ path: file, fullPage: false });
  for (const r of info) {
    console.log(`  ${name} ${width}px [${r.card}]  bar=${r.bar_bg}  proj=${r.proj_present} border=${r.proj_border_color}  bottom=${r.proj_bottom_pct} height=${r.proj_height_pct}  cap="${r.caption_text}"`);
  }
  await ctx.close();
  return info;
}

// ─── S2: verify both URL shapes resolve to the same range ─────────────
const presetUrl = `${BASE}/api/kpi/purchasing?account=ALL&preset=fytd`;
const explicitUrl = `${BASE}/api/kpi/purchasing?account=ALL&start=2025-12-29&end=${new Date().toISOString().slice(0,10)}`;
const [presetRange, explicitRange] = await Promise.all([fetchRange(presetUrl), fetchRange(explicitUrl)]);
console.log("=== S2 range parity ===");
console.log(`  preset:   ${JSON.stringify(presetRange)}`);
console.log(`  explicit: ${JSON.stringify(explicitRange)}`);
const rangeMatch = presetRange && explicitRange
  && presetRange.start === explicitRange.start
  && presetRange.end === explicitRange.end;
if (!rangeMatch) {
  console.error("FAIL: URL shapes resolve to different ranges; visual comparison aborted");
  await browser.close();
  process.exit(1);
}
console.log("  OK: both URL shapes resolve to the same range");

console.log("\n=== Preset URL sweep ===");
for (const w of WIDTHS) {
  await grab("preset", `${BASE}/kpi/purchasing?account=ALL&preset=fytd`, w);
}
console.log("\n=== Explicit URL sweep ===");
for (const w of WIDTHS) {
  await grab("explicit", `${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=${new Date().toISOString().slice(0,10)}`, w);
}

await browser.close();
