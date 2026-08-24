// Verify CHECK 2 assertion actually fires in the browser when the
// component is seeded with a mismatch (source-patched for a single
// probe run - not shipped).

import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(String(e && e.message ? e.message : e)); });

  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`).catch(() => {});
  // Wait a beat for any React error boundary to render.
  await page.waitForTimeout(4000);

  const check2Fires = [
    ...consoleErrors.filter(l => l.includes('CHECK 2')),
    ...pageErrors.filter(l => l.includes('CHECK 2')),
  ];
  console.log('CHECK 2 console/page errors captured:', check2Fires.length);
  for (const l of check2Fires) console.log('>', l);
  await browser.close();
  if (check2Fires.length === 0) {
    console.error('EXPECTED CHECK 2 to fire on seeded mismatch. Did source patch not take effect?');
    process.exit(1);
  }
  console.log('PASS: CHECK 2 fires on seeded mismatch');
}
main().catch(e => { console.error(e); process.exit(2); });
