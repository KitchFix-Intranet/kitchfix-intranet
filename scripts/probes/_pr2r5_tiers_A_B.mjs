// PR 2 R5 Part A - verify tiers A and B use the same rule.
// Tier A: <= 6 weeks (single period selection). Tier B: 7-13 weeks.
// Loads the board with narrow (tier A) and mid (tier B) ranges,
// measures bar/line, verifies the ratio.

import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function measure(page, label, url) {
  console.log('---', label, '---');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });
  const strip = page.locator('[data-card="bucket-food"]').first().locator('.kpi-p-wks').first();
  const rows = await strip.evaluate((el) => {
    const out = [];
    for (const wc of el.querySelectorAll('.kpi-p-wc')) {
      const lab = wc.querySelector('.kpi-p-d')?.textContent?.trim() || '';
      const plot = wc.querySelector('.kpi-p-plot');
      const bar = wc.querySelector('.kpi-p-bar');
      const orig = wc.querySelector('.kpi-p-ln.orig');
      const adj = wc.querySelector('.kpi-p-ln.adj');
      out.push({
        label: lab,
        barStyle: bar ? bar.style.height : null,
        origStyle: orig ? orig.style.bottom : null,
        adjStyle: adj ? adj.style.bottom : null,
        state: bar ? Array.from(bar.classList).find(c => c.startsWith('st-')) || null : null,
      });
    }
    return out;
  });
  console.log('unit          barH%    origLine%  adjLine%   state');
  for (const r of rows) {
    console.log(
      r.label.padEnd(14),
      String(r.barStyle || '').padEnd(9),
      String(r.origStyle || '--').padEnd(11),
      String(r.adjStyle || '--').padEnd(11),
      String(r.state || '')
    );
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Tier A: single period (P8 = 07/13 - 08/09).
  await measure(page, 'TIER A - P8 (single period, 4 weeks)',
    `${BASE}/kpi/purchasing?account=ALL&start=2026-07-13&end=2026-08-09`);

  // Tier B: two periods (P7 + P8 = 8 weeks).
  await measure(page, 'TIER B - P7+P8 (2 periods, 8 weeks)',
    `${BASE}/kpi/purchasing?account=ALL&start=2026-06-15&end=2026-08-09`);

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
// (nothing appended - see _pr2r5_tiers_adj.mjs)
