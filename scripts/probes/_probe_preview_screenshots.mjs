#!/usr/bin/env node
/*
 * Purchasing preview + freshness popover screenshots.
 *   Cell 1: no preview, ALL account -> rail visible
 *   Cell 2: ?preview=CIN - AZ (corporate test-mode) -> rail hidden, banner present
 *   Cell 3: freshness popover open (click the pill)
 * Three widths.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const BASE = process.env.KPI_BASE || "http://localhost:3022";
const OUT = process.env.HOME + "/Downloads";
const WIDTHS = [1680, 1456, 900];

const CELLS = [
  { name: "no-preview-ALL",     url: `${BASE}/kpi/purchasing?account=ALL&preset=fytd` },
  { name: "preview-CIN-AZ",     url: `${BASE}/kpi/purchasing?account=ALL&preview=CIN+-+AZ&preset=fytd` },
];

for (const c of CELLS) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1400 }, extraHTTPHeaders: { "X-Test-Mode": "1" } });
    const page = await ctx.newPage();
    await page.goto(c.url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector('[data-card]', { timeout: 60000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const chip = document.querySelector('.kpi-fresh');
      const banner = document.querySelector('.kpi-preview-banner');
      const bannerText = banner?.textContent?.trim() || null;
      const cols = document.querySelector('.kpi-cols');
      const hasFolioAttr = cols?.hasAttribute('data-no-folio') || false;
      const folio = document.querySelector('.kpi-folio');
      return {
        chip_text: chip?.textContent?.trim() || null,
        banner_present: !!banner,
        banner_text: bannerText,
        rail_hidden_via_attr: hasFolioAttr,
        rail_dom_present: !!folio,
      };
    });
    const file = `${OUT}/r-preview-${c.name}-${w}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ${c.name} ${w}px  chip="${info.chip_text}"  banner=${info.banner_present}  rail_hidden_attr=${info.rail_hidden_via_attr}  rail_dom=${info.rail_dom_present}`);
    // For the second cell only, at 1680 width, also capture the pill popover open
    if (c.name === "preview-CIN-AZ" && w === 1680) {
      await page.click('.kpi-fresh');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/r-preview-freshness-pop-${w}.png`, fullPage: false });
      console.log("    freshness popover captured");
    }
    await ctx.close();
  }
}

// Also capture: freshness popover on the no-preview / ALL cell at 1680
{
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1400 }, extraHTTPHeaders: { "X-Test-Mode": "1" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&preset=fytd`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-card]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.click('.kpi-fresh');
  await page.waitForTimeout(400);
  const popText = await page.evaluate(() => document.querySelector('.kpi-fresh-pop')?.innerText?.trim() || null);
  console.log("\n--- Freshness popover text (ALL/FYTD) ---");
  console.log(popText);
  await page.screenshot({ path: `${OUT}/r-preview-freshness-pop-ALL-1680.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
