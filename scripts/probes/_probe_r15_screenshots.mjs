#!/usr/bin/env node
/**
 * R15 verification: preset URLs now resolve correctly + projection
 * outline renders on the period card.
 *
 * S2 CORRECTED (BUILD_ACCURACY_PROTOCOL 2026-08-27): before comparing
 * anything visual, this probe asserts the API-returned range is
 * IDENTICAL between the two URL shapes.  If they differ, it stops
 * and reports the divergence.  Only if the two ranges match may the
 * screenshots be considered comparable evidence.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const BASE = "http://localhost:3020";
const OUT  = process.env.HOME + "/Downloads";
const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });

async function collectRange(url) {
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    extraHTTPHeaders: { "X-Test-Mode": "1" },
  });
  const page = await ctx.newPage();
  let range = null;
  page.on("response", async r => {
    if (r.url().includes("/api/kpi/purchasing")) {
      try { const b = await r.json(); range = { start: b.range?.start, end: b.range?.end }; } catch {}
    }
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await ctx.close();
  return range;
}

async function shoot(url, file) {
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    extraHTTPHeaders: { "X-Test-Mode": "1" },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('.kpi-p-b-per, .kpi-p-mf, .failwrap', { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: file, fullPage: false });
  const projs = await page.evaluate(() => {
    const per = document.querySelector('[data-card="period"]');
    return {
      period_projs: per ? per.querySelectorAll('.kpi-p-proj').length : 0,
      period_bars:  per ? per.querySelectorAll('.kpi-p-bar').length  : 0,
      all_projs:    document.querySelectorAll('.kpi-p-proj').length,
    };
  });
  await ctx.close();
  return projs;
}

const SCENES = [
  { key: "ALL-FYTD",       preset: "fytd",         start: "2025-12-29", end: null, account: "ALL" },
  { key: "TBJFL-FYTD",     preset: "fytd",         start: "2025-12-29", end: null, account: "TBJ - FL" },
  { key: "TBJFL-thisper",  preset: "this_period",  start: "2026-08-10", end: "2026-09-06", account: "TBJ - FL" },
  { key: "TBJFL-lastper",  preset: "last_period",  start: "2026-07-13", end: "2026-08-09", account: "TBJ - FL" },
];

console.log("\n=== S2-CORRECTED sanity check: do both URL shapes resolve to the same range? ===\n");
try {
  for (const s of SCENES) {
    // Preset URL: resolve today client-side to build the equivalent dates URL
    const today = new Date().toISOString().slice(0, 10);
    const datesEnd = s.end || today;
    const presetURL = `${BASE}/kpi/purchasing?account=${encodeURIComponent(s.account)}&preset=${s.preset}`;
    const datesURL  = `${BASE}/kpi/purchasing?account=${encodeURIComponent(s.account)}&start=${s.start}&end=${datesEnd}`;
    const presetRange = await collectRange(presetURL);
    const datesRange  = await collectRange(datesURL);
    const match = presetRange?.start === datesRange?.start && presetRange?.end === datesRange?.end;
    console.log(`  ${s.key.padEnd(15)}  preset=${JSON.stringify(presetRange)}  dates=${JSON.stringify(datesRange)}  match=${match}`);
    if (!match) {
      console.log(`    RANGES DIVERGE - visual comparison for ${s.key} is not evidence`);
      continue;
    }
    // Ranges match.  Take both screenshots and compare projection counts.
    const preFile = `${OUT}/r15-${s.key}-preset.png`;
    const datFile = `${OUT}/r15-${s.key}-dates.png`;
    const pre = await shoot(presetURL, preFile);
    const dat = await shoot(datesURL, datFile);
    console.log(`    preset: ${JSON.stringify(pre)} -> ${preFile}`);
    console.log(`    dates:  ${JSON.stringify(dat)} -> ${datFile}`);
    const projMatch = pre.period_projs === dat.period_projs && pre.all_projs === dat.all_projs;
    console.log(`    projection-count match: ${projMatch}`);
  }
} finally {
  await browser.close();
}
