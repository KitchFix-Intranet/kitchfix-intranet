// Tier A with a running week - verify adj line renders and both marks
// share the same scale (rule holds when both orig + adj + spent all
// contribute to maxSample).
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // P9: 08/10 - 09/06, current week 08/24 - 08/30 is running.
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2026-08-10&end=2026-09-06`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });
  const strip = page.locator('[data-card="bucket-food"]').first().locator('.kpi-p-wks').first();
  const rows = await strip.evaluate(el => {
    const out = [];
    for (const wc of el.querySelectorAll('.kpi-p-wc')) {
      const lab = wc.querySelector('.kpi-p-d')?.textContent?.trim() || '';
      const bar = wc.querySelector('.kpi-p-bar');
      const orig = wc.querySelector('.kpi-p-ln.orig');
      const adj  = wc.querySelector('.kpi-p-ln.adj');
      out.push({
        label: lab,
        barStyle: bar ? bar.style.height : null,
        origStyle: orig ? orig.style.bottom : null,
        adjStyle: adj ? adj.style.bottom : null,
        stateCls: bar ? Array.from(bar.classList).find(c => c.startsWith('st-')) || null : null,
      });
    }
    return out;
  });
  console.log('TIER A - P9 running');
  for (const r of rows) {
    console.log(r.label.padEnd(14), 'bar:', String(r.barStyle||'').padEnd(9),
      'orig:', String(r.origStyle||'--').padEnd(11),
      'adj:', String(r.adjStyle||'--').padEnd(11),
      r.stateCls || '');
  }
  await strip.screenshot({ path: '/tmp/pr2r5_tierA_running.png' });
  console.log('screenshot: /tmp/pr2r5_tierA_running.png');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
