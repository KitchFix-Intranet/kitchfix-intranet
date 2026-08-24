// PR 2 R5 Part A - pixel measurement.
// Loads the purchasing board at ALL/FYTD/tier-C in a headless browser
// and reads the computed style + client rect of every bar and target
// line inside the Food chart. Reports per-period expected vs actual
// heights and positions.

import { chromium } from 'playwright';

const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Navigate. TEST_MODE bypass is enabled server-side so we land authed.
  // FYTD forces tier C. Start of FY 2026 -> today.
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  // Ensure FYTD range and tier C are the current selection - the
  // default board landing has range=FYTD and >13 weeks -> tier C.
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });

  // Take a screenshot of the Food card area.
  const foodCard = page.locator('[data-card="bucket-food"]').first();
  await foodCard.waitFor({ state: 'visible', timeout: 30000 });
  const foodStrip = foodCard.locator('.kpi-p-wks').first();
  await foodStrip.waitFor({ state: 'visible', timeout: 30000 });

  const measurements = await foodStrip.evaluate((strip) => {
    const rows = [];
    const wcs = strip.querySelectorAll('.kpi-p-wc');
    for (const wc of wcs) {
      const label = wc.querySelector('.kpi-p-d')?.textContent?.trim() || '';
      const plot = wc.querySelector('.kpi-p-plot');
      const plotRect = plot?.getBoundingClientRect();
      const bar = wc.querySelector('.kpi-p-bar');
      const barRect = bar?.getBoundingClientRect();
      const orig = wc.querySelector('.kpi-p-ln.orig');
      const origStyle = orig ? orig.style.bottom : null;
      const origRect = orig?.getBoundingClientRect();
      const barStyleHeight = bar ? bar.style.height : null;
      rows.push({
        label,
        plotH: plotRect?.height ?? null,
        barH: barRect?.height ?? null,
        barStyleHeight,
        origBottomStyle: origStyle,
        origPxFromBottom: origRect && plotRect ? (plotRect.bottom - origRect.top) : null,
      });
    }
    return rows;
  });

  console.log('per-period measurements (Food, FYTD, tier C, ALL):');
  console.log('');
  console.log('label   plotH  barH   bar%      lineStyle   linePx-from-bottom  line%');
  console.log('------  -----  -----  --------  ----------  ------------------  -----');
  for (const m of measurements) {
    const barPct = m.plotH ? ((m.barH / m.plotH) * 100).toFixed(1) : '--';
    const linePct = m.plotH && m.origPxFromBottom != null
      ? ((m.origPxFromBottom / m.plotH) * 100).toFixed(1)
      : '--';
    console.log(
      m.label.padEnd(7),
      String(m.plotH?.toFixed(1)).padEnd(6),
      String(m.barH?.toFixed(1)).padEnd(6),
      barPct.padEnd(9),
      String(m.barStyleHeight).padEnd(10),
      String(m.origBottomStyle || '').padEnd(9),
      String(m.origPxFromBottom?.toFixed(1) || '').padEnd(18),
      linePct
    );
  }

  // Screenshot the strip zoomed in.
  await foodStrip.screenshot({ path: '/tmp/pr2r5_food_strip_before.png' });
  await foodCard.screenshot({ path: '/tmp/pr2r5_food_before.png' });
  console.log('screenshots:', '/tmp/pr2r5_food_before.png', '/tmp/pr2r5_food_strip_before.png');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
