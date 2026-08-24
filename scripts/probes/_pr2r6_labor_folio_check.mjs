// Check labor's folio rail behavior at 847px to verify F4 matches (Check 4).
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const results = {};
  for (const w of [1600, 1280, 1100, 900, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.kpi-folio', { timeout: 30000 });
    const info = await page.evaluate(() => {
      const folio = document.querySelector('.kpi-folio');
      if (!folio) return { err: 'no folio' };
      const r = folio.getBoundingClientRect();
      const cs = getComputedStyle(folio);
      return {
        scrollWidth: folio.scrollWidth,
        clientWidth: folio.clientWidth,
        rectW: r.width,
        rectH: r.height,
        flexDirection: cs.flexDirection,
        overflowX: cs.overflowX,
        horizontallyScrolls: folio.scrollWidth > folio.clientWidth + 1,
      };
    });
    results[w] = info;
    await ctx.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
