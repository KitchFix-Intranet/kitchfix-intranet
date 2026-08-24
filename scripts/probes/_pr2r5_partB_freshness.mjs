// PR 2 R5 Part B - verify freshness pill + note wording.
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-fresh', { timeout: 30000 });
  const pill = await page.locator('.kpi-fresh').first().evaluate(el => ({
    text: el.textContent?.trim(),
    classes: el.className,
  }));
  const note = await page.locator('.kpi-p-livenote').first().evaluate(el => ({
    text: el.textContent?.trim(),
    classes: el.className,
  }));
  console.log('PILL:', pill);
  console.log('NOTE:', note);
  await page.locator('.kpi-fresh').first().screenshot({ path: '/tmp/pr2r5_pill.png' });
  await page.locator('.kpi-p-livenote').first().screenshot({ path: '/tmp/pr2r5_note.png' });
  console.log('screenshots: /tmp/pr2r5_pill.png /tmp/pr2r5_note.png');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
