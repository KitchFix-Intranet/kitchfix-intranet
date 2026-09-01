// scripts/probes/_probe_overview_r40_shots.mjs
//
// R-40 verification screenshots. Captures:
//   1-3. corporate at CIN - AZ single-account across P9 / P8 / FYTD
//   4.   corporate at ALL (portfolio scope)
//   5.   site_leader at CIN - AZ / P9 - should be indistinguishable
//        from #1 apart from the missing portfolio panel

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";

async function ready(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-kpi-ov="board"], .kpi-statebox', { timeout: 20000 });
  await page.waitForTimeout(800);
}
async function shot(page, name) {
  const p = `/tmp/ov_r40_${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  [shot] ${name} -> ${p}`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
  const page = await ctx.newPage();
  const cases = [
    { name: "1680_corp_cinaz_p9",       url: `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9` },
    { name: "1680_corp_cinaz_p8",       url: `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:8` },
    { name: "1680_corp_cinaz_fytd",     url: `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=fytd` },
    { name: "1680_corp_ALL_p9",         url: `${BASE}/kpi/overview?account=ALL&range=period:9` },
    { name: "1680_site_cinaz_p9",       url: `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9&_test_role=site_leader&_test_scope=CIN%20-%20AZ` },
  ];
  for (const c of cases) {
    await ready(page, c.url);
    await shot(page, c.name);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
