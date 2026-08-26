#!/usr/bin/env node
/**
 * R13 acceptance screenshots.  Three viewports (1680, 1456, 900) x
 * three scenes (ALL FYTD, TBJ-FL P8 closed, TBJ-FL this period).
 * Runs against local dev at KPI_BASE.  Writes PNGs to ~/Downloads.
 *
 * The three-width sweep catches R11's failure - two items passed at
 * 1680 and failed at 1456 because we each tested one width.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = process.env.KPI_BASE || "http://localhost:3015";
const OUT  = process.env.HOME + "/Downloads";

function findChromium() {
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

const chromePath = findChromium();
if (!chromePath) { console.error("no chromium binary found"); process.exit(1); }

const SCENES = [
  { key: "ALL_FYTD",       path: "/kpi/purchasing?account=ALL&preset=fytd" },
  // preset=last_period fails to resolve on cold nav (accountPeriods
  // not yet loaded); use explicit dates for P8 = 2026-07-13 to 08-09.
  { key: "TBJ-FL_P8",      path: "/kpi/purchasing?account=TBJ+-+FL&start=2026-07-13&end=2026-08-09" },
  { key: "TBJ-FL_current", path: "/kpi/purchasing?account=TBJ+-+FL&preset=this_period" },
];
const WIDTHS = [1680, 1456, 900];

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
try {
  for (const scene of SCENES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        extraHTTPHeaders: { "X-Test-Mode": "1" },
      });
      const page = await ctx.newPage();
      const url = BASE + scene.path;
      console.log(`  ${scene.key} @ ${w}x900 -> ${url}`);
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        // Wait for at least the period card to render
        await page.waitForSelector('[data-card="period"], [data-card="period-passthru"], .kpi-p-b-per, .failwrap', { timeout: 30000 });
        await page.waitForTimeout(500);   // let bars settle
        const file = `${OUT}/r13-${scene.key}-${w}.png`;
        await page.screenshot({ path: file, fullPage: false });
        console.log(`    -> ${file}`);
      } catch (e) {
        console.log(`    FAIL: ${e.message}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log("\ndone.");
