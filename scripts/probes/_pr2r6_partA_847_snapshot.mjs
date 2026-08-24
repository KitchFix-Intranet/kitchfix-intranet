// Snapshot the purchasing board at 847px and dump the two hero rects
// on the period card + a few other diagnostics for the R6 spec claim.
import { chromium } from 'playwright';

const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 847, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24&_bust=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const periodRow = document.querySelector('[data-card="period"]');
    if (!periodRow) return { err: 'no period row' };
    const periodCard = periodRow.querySelector('.kpi-p-card.kpi-p-b-per');
    const nums = periodCard.querySelector('.kpi-p-nums');
    const numsRect = nums.getBoundingClientRect();
    const numsCS = getComputedStyle(nums);
    const stks = nums.querySelectorAll('.kpi-p-stk');
    const heroes = periodCard.querySelectorAll('.kpi-p-hero, .kpi-p-value');
    const heroRects = [];
    for (const h of heroes) {
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      heroRects.push({
        text: h.textContent.trim(),
        x: r.left, y: r.top, w: r.width, h: r.height,
        scrollW: h.scrollWidth, clientW: h.clientWidth,
        overflows: h.scrollWidth > h.clientWidth + 1,
        fontSize: cs.fontSize,
        whiteSpace: cs.whiteSpace,
      });
    }
    // Are the two hero rects on the same line? Same top?
    const [a, b] = heroRects;
    const sameLine = a && b && Math.abs(a.y - b.y) < 2;
    const overlap = a && b && (a.right > b.left && b.right > a.left);
    return {
      viewportW: window.innerWidth,
      periodCardW: periodCard.getBoundingClientRect().width,
      numsW: numsRect.width,
      numsGridColumns: numsCS.gridTemplateColumns,
      stkCount: stks.length,
      heroRects,
      sameLine,
      overlap,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: '/tmp/pr2r6_847_before.png', fullPage: true });
  console.log('screenshot: /tmp/pr2r6_847_before.png');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
