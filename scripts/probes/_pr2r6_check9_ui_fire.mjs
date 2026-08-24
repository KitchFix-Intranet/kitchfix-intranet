// Prove the LedgerCard Check 9 assertion fires end-to-end.
// Loads /kpi/purchasing with a fetch-intercept that mutates the
// ledgers.equipment.total_amount by +100 - if the client gate is
// wired, the render throws.
import { chromium } from 'playwright';
const BASE = process.env.KPI_BASE || 'http://localhost:3221';
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const consoleMsgs = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => {
    const t = m.type();
    const txt = m.text();
    if (t === 'error' || /Check 9|LedgerCard/.test(txt)) consoleMsgs.push(`[${t}] ${txt}`);
  });

  // Intercept the /api/kpi/purchasing response and tamper.
  await page.route('**/api/kpi/purchasing**', async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    if (json?.ledgers?.equipment?.total_amount != null) {
      json.ledgers.equipment.total_amount = Math.round((Number(json.ledgers.equipment.total_amount) + 100) * 100) / 100;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'domcontentloaded' });
  // Wait for potential render error.
  await page.waitForTimeout(5000);
  console.log('pageerror captured:', errors.length);
  for (const e of errors) console.log(' -', e.split('\n')[0]);
  console.log('console messages:');
  for (const m of consoleMsgs) console.log(' *', m.split('\n')[0]);
  const gotCheck9 =
    errors.some(e => /Check 9/i.test(e) || /LedgerCard/.test(e)) ||
    consoleMsgs.some(m => /Check 9/i.test(m) || /LedgerCard/.test(m));
  console.log(gotCheck9 ? 'CHECK 9 CLIENT ASSERTION FIRED' : 'no Check 9 error captured');
  await browser.close();
  process.exit(gotCheck9 ? 0 : 2);
}
main().catch(e => { console.error(e); process.exit(2); });
