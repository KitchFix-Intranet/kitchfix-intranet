// scripts/probes/_probe_labor_ot_card_shots.mjs
//
// R-38 OT card verification screenshots. Captures the card at:
//   1. account with recent OT movement (STL - FL P8)
//   2. account with no OT (TXR - AZ P8)
//   3. salaried-only account (CIN - KY - buildBoard applies=false)
//   4. FYTD baseline (STL - FL FYTD)
//   5. no-closed-weeks edge (single upcoming period stub)

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const OUT = "/tmp";

async function ready(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('.kpi-sig-card, .kpi-statebox', { timeout: 20000 });
  await page.waitForTimeout(800);
}
async function shot(page, name) {
  const p = `${OUT}/labor_ot_${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  [shot] ${name} -> ${p}`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1200 } });
  const page = await ctx.newPage();
  const cases = [
    { name: "stlfl_p8_recent_ot",   url: `${BASE}/kpi/labor?account=STL%20-%20FL&start=2026-07-13&end=2026-08-09` },
    { name: "txraz_p8_no_ot",       url: `${BASE}/kpi/labor?account=TXR%20-%20AZ&start=2026-07-13&end=2026-08-09` },
    { name: "cinky_salaried_only",  url: `${BASE}/kpi/labor?account=CIN%20-%20KY&start=2026-07-13&end=2026-08-09` },
    { name: "stlfl_fytd",           url: `${BASE}/kpi/labor?account=STL%20-%20FL&start=2025-12-29&end=2026-09-01` },
  ];
  for (const c of cases) {
    await ready(page, c.url);
    await shot(page, c.name);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
