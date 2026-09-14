#!/usr/bin/env node
// Verify the where-it-went table shape after the Adjusted-column drop.
// Print column headers + total row for TBJ LP so the numbers can be
// eyeballed against Kevin's flagged case (spent > plan, variance vs
// plan not vs 0).

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const account = "TBJ - FL";
const enc = encodeURIComponent(account);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
});
const page = await context.newPage();

for (const rng of [
  { key: "CY", preset: "fytd" },
  { key: "LP", preset: "last_period" },
  { key: "CP", preset: "this_period" },
]) {
  const url = `${BASE}/kpi/purchasing?account=${enc}&preset=${rng.preset}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const headers = await page.$$eval(".kpi-p-wig-h", els => els.map(el => (el.textContent || "").trim()));
  const totalRow = await page.$$eval(".kpi-p-wig-tot", els => els.map(el => (el.textContent || "").trim()));
  const foodRow = await page.$$eval(".kpi-p-wig-grid > *", (els) => {
    // Find Food row cells: after headers (4), first data row is Food.
    const startIdx = 4;
    return els.slice(startIdx, startIdx + 4).map(el => (el.textContent || "").trim());
  });

  console.log(`\n=== TBJ · ${rng.key} · where-it-went ===`);
  console.log(`  headers: ${headers.join(" | ")}`);
  console.log(`  Food row: ${foodRow.join(" | ")}`);
  console.log(`  Total row: ${totalRow.join(" | ")}`);
}

await browser.close();
