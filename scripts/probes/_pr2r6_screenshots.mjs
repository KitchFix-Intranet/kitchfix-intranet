// Take PR-2 R6 Part A screenshots at 1600 / 1280 / 1100 / 900 / 768.
// Also produce a zoomed ledger card screenshot at 1600 for Part B.
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function main() {
  const browser = await chromium.launch();
  for (const w of [1600, 1280, 1100, 900, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1200 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });
    await page.waitForTimeout(500);
    const path = `/tmp/pr2r6_partA_${w}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(w + 'px ->', path);
    await ctx.close();
  }
  // Zoomed ledger screenshot at 1600
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-flatrow', { timeout: 30000 });
  await page.waitForTimeout(500);
  const flatrow = page.locator('.kpi-p-flatrow').first();
  await flatrow.screenshot({ path: '/tmp/pr2r6_partB_ledgers.png' });
  console.log('ledger zoom ->', '/tmp/pr2r6_partB_ledgers.png');
  const pair = page.locator('.kpi-p-pairrow').first();
  await pair.screenshot({ path: '/tmp/pr2r6_partB_cardpurchases_vendors.png' });
  console.log('cardp+vendor zoom ->', '/tmp/pr2r6_partB_cardpurchases_vendors.png');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
