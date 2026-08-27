#!/usr/bin/env node
/**
 * R14 acceptance screenshots.  Three pass-through accounts x three
 * ranges x two URL shapes x three widths, plus two at-risk accounts x
 * two URL shapes x three widths as before/after proof of no regression.
 *
 * S2 STANDING RULE (BUILD_ACCURACY_PROTOCOL 2026-08-27): every sweep
 * runs BOTH URL shapes - preset AND explicit-dates - because they
 * hydrate on different timing paths.  R13 shipped a TDZ that fired
 * only on explicit-dates URLs; its preset-only sweep missed it.
 *
 * Args:
 *   --label=<name>  a tag appended to the file name so we can capture
 *                   two rounds (before / after) without collision.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = process.env.KPI_BASE || "http://localhost:3019";
const OUT  = process.env.HOME + "/Downloads";

function findChromium() {
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

let label = "after";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--label=")) label = a.slice("--label=".length);
}

const chromePath = findChromium();
if (!chromePath) { console.error("no chromium binary found"); process.exit(1); }

const PASS_THROUGH_ACCOUNTS = ["CIN - OH", "STL - FL", "STL - MO"];
const PT_RANGES = [
  { key: "FYTD", preset: "fytd",         start: "2025-12-29", end: "2026-08-26" },
  { key: "P8",   preset: "last_period",  start: "2026-07-13", end: "2026-08-09" },
  { key: "P9",   preset: "this_period",  start: "2026-08-10", end: "2026-09-06" },
];
const AT_RISK_ACCOUNTS = ["ALL", "TBJ - FL"];
const AR_RANGES = [{ key: "FYTD", preset: "fytd", start: "2025-12-29", end: "2026-08-26" }];
const WIDTHS = [1680, 1456, 900];

// URL builders for the two shapes.
function presetURL(base, acct, r)  { return `${base}/kpi/purchasing?account=${encodeURIComponent(acct)}&preset=${r.preset}`; }
function datesURL(base, acct, r)   { return `${base}/kpi/purchasing?account=${encodeURIComponent(acct)}&start=${r.start}&end=${r.end}`; }
const URL_SHAPES = [
  { tag: "pre",  build: presetURL },   // preset URL shape
  { tag: "dat",  build: datesURL  },   // explicit-dates URL shape
];

async function shoot(page, url, selector, file) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(selector, { timeout: 45000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
try {
  for (const acct of PASS_THROUGH_ACCOUNTS) {
    for (const r of PT_RANGES) {
      for (const shape of URL_SHAPES) {
        for (const w of WIDTHS) {
          const ctx = await browser.newContext({
            viewport: { width: w, height: 900 },
            extraHTTPHeaders: { "X-Test-Mode": "1" },
          });
          const page = await ctx.newPage();
          const url = shape.build(BASE, acct, r);
          const safe = acct.replace(/ /g, "").replace(/[^A-Za-z0-9_-]/g, "");
          const file = `${OUT}/r14-pt-${safe}-${r.key}-${shape.tag}-${w}-${label}.png`;
          console.log(`  ${safe}-${r.key}-${shape.tag}-${w} -> ${url}`);
          try {
            await shoot(page, url, '.kpi-p-b-per, [data-card="mgmt-fee"], .kpi-p-mf, .failwrap', file);
            console.log(`    -> ${file}`);
          } catch (e) {
            console.log(`    FAIL: ${e.message.split("\n")[0]}`);
          }
          await ctx.close();
        }
      }
    }
  }
  for (const acct of AT_RISK_ACCOUNTS) {
    for (const r of AR_RANGES) {
      for (const shape of URL_SHAPES) {
        for (const w of WIDTHS) {
          const ctx = await browser.newContext({
            viewport: { width: w, height: 900 },
            extraHTTPHeaders: { "X-Test-Mode": "1" },
          });
          const page = await ctx.newPage();
          const url = shape.build(BASE, acct, r);
          const safe = acct.replace(/ /g, "").replace(/[^A-Za-z0-9_-]/g, "");
          const file = `${OUT}/r14-ar-${safe}-${r.key}-${shape.tag}-${w}-${label}.png`;
          console.log(`  ${safe}-${r.key}-${shape.tag}-${w} -> ${url}`);
          try {
            await shoot(page, url, '.kpi-p-b-per, .failwrap', file);
            console.log(`    -> ${file}`);
          } catch (e) {
            console.log(`    FAIL: ${e.message.split("\n")[0]}`);
          }
          await ctx.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log("\ndone.");
