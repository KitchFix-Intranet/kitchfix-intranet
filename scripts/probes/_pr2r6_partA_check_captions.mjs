// Check chart caption widths at 847 to find collision.
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 847, height: 900 } })).newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });
  const rows = await page.evaluate(() => {
    const out = [];
    const periodRow = document.querySelector('[data-card="period"]');
    const chartCard = periodRow.querySelectorAll('.kpi-p-card')[1];
    const wcs = chartCard.querySelectorAll('.kpi-p-wc');
    for (const wc of wcs) {
      const val = wc.querySelector('.kpi-p-v');
      const d = wc.querySelector('.kpi-p-d');
      const vr = val?.getBoundingClientRect();
      const dr = d?.getBoundingClientRect();
      out.push({
        val: val?.textContent.trim() || '',
        vw: vr?.width,
        vsW: val?.scrollWidth,
        vOverflows: val ? val.scrollWidth > val.clientWidth + 1 : null,
        wcW: wc.getBoundingClientRect().width,
      });
    }
    return out;
  });
  console.log(JSON.stringify(rows, null, 2));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
