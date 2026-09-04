#!/usr/bin/env node
// Standalone Playwright screenshotter for the KPI Overview band
// treatment (Prompt 1 item 2, 2026-09-04). Bypasses tests/auth.setup.ts
// entirely so a stale user.json doesn't block a visual check against
// a TEST_MODE-friendly dev server.
//
// Usage:
//   PLAYWRIGHT_BASE_URL=http://localhost:3399 \
//     node scripts/probes/_screenshot_kpi_bands.mjs
//
// Outputs to /tmp/kpi-band-<account>-<range>-*.png.

import { chromium } from "playwright";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3399";
const OUT_DIR = "/tmp";

// Kevin verification pass list: TBJ - FL, TBR - FL, CIN - KY, CIN - OH.
// Ranges: this-period (open), last-period (closed), this-year (FYTD).
const ACCOUNTS = ["TBJ - FL", "TBR - FL", "CIN - KY", "CIN - OH"];
const RANGES = [
  { name: "this-period", qs: "&start=2026-08-10&end=2026-09-06" },
  { name: "last-period", qs: "&start=2026-07-13&end=2026-08-09" },
  { name: "fytd",        qs: "" },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 2200, height: 1200 },
});
const page = await context.newPage();

for (const account of ACCOUNTS) {
  for (const range of RANGES) {
    const slug = account.replace(/\s+/g, "_");
    const url = `${BASE}/kpi/overview?account=${encodeURIComponent(account)}${range.qs}`;
    console.log(`\n[${slug} ${range.name}]  ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Wait for the board to actually render (skeleton -> card).
    try {
      await page.waitForSelector('[data-kpi-ov="card-revenue"]', { timeout: 15_000 });
    } catch {
      console.log("  no card-revenue - board may be behind auth or skeleton didn't resolve");
      const shot = `${OUT_DIR}/kpi-band-${slug}-${range.name}-nocard.png`;
      await page.screenshot({ path: shot, fullPage: true });
      console.log(`  fallback screenshot: ${shot}`);
      continue;
    }
    await page.waitForSelector(".kpi-ov-tband", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500); // paint settle

    const full = `${OUT_DIR}/kpi-band-${slug}-${range.name}-full.png`;
    await page.screenshot({ path: full, fullPage: true });
    console.log(`  full: ${full}`);

    // Cards row screenshot (the new PeriodBlock lives on cards)
    const cardsRow = page.locator('[data-kpi-ov="cards-row"]').first();
    if (await cardsRow.count() > 0) {
      const c = `${OUT_DIR}/kpi-band-${slug}-${range.name}-cards.png`;
      await cardsRow.screenshot({ path: c });
      console.log(`  cards: ${c}`);
    }
    // Look for the PeriodBlock explicitly
    const perb = page.locator('[data-kpi-ov="card-period-block"]');
    const perbCount = await perb.count();
    console.log(`  period blocks found: ${perbCount}`);
    if (perbCount > 0) {
      for (let i = 0; i < perbCount; i++) {
        const p = perb.nth(i);
        const p2 = `${OUT_DIR}/kpi-band-${slug}-${range.name}-perb-${i}.png`;
        await p2 && await p.screenshot({ path: p2 });
      }
    } else {
      // Diagnose - dump the range meta + statement totals via a page.evaluate
      const diag = await page.evaluate(() => {
        return {
          periodState: document.querySelector('[data-kpi-ov="hero-revenue"]')?.closest('[data-kpi-ov="card-revenue"]')?.getAttribute('data-kpi-ov-period-state') || 'unknown',
          hasReactState: !!window.__NEXT_DATA__,
        };
      });
      console.log(`  diag: ${JSON.stringify(diag)}`);
    }
    const alsoTracked = page.locator('[data-kpi-ov="also-tracked"]').first();
    if (await alsoTracked.count() > 0) {
      const at = `${OUT_DIR}/kpi-band-${slug}-${range.name}-also-tracked.png`;
      await alsoTracked.screenshot({ path: at });
      console.log(`  also-tracked: ${at}`);
    }
    // Screenshot the specific known cards so each grabs its full width
    for (const [selector, name] of [
      ['[data-kpi-ov="cost-lines"]', "cost-lines"],
      ['[data-kpi-ov="revenue-lines"]', "revenue-lines"],
      ['[data-kpi-ov="also-tracked"]', "also-tracked-2"],
    ]) {
      const el = page.locator(selector).first();
      if (await el.count() > 0) {
        const shot = `${OUT_DIR}/kpi-band-${slug}-${range.name}-${name}.png`;
        await el.screenshot({ path: shot });
        console.log(`  ${name}: ${shot}`);
      }
    }
  }
}

await browser.close();
console.log("\nDone.");
