import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 847, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-nums', { timeout: 30000 });
  const info = await page.evaluate(() => {
    const rows = [];
    const nums = document.querySelectorAll('.kpi-p-nums');
    for (const n of nums) {
      const cs = getComputedStyle(n);
      rows.push({
        gridColumns: cs.gridTemplateColumns,
        rectW: n.getBoundingClientRect().width,
      });
    }
    // Also check the row
    const row = document.querySelector('.kpi-p-row');
    const rowCs = row ? getComputedStyle(row) : null;
    // Media query support
    return { numsRows: rows, rowGridColumns: rowCs?.gridTemplateColumns, viewportW: window.innerWidth, matches1300: window.matchMedia('(max-width: 1300px)').matches };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
