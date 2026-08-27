import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });

const scenes = [
  { name: "CIN-AZ-this", url: "http://localhost:3021/kpi/purchasing?account=CIN+-+AZ&preset=this_period" },
  { name: "ALL-FYTD",    url: "http://localhost:3021/kpi/purchasing?account=ALL&preset=fytd" },
];

for (const s of scenes) {
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1400 }, extraHTTPHeaders: { "X-Test-Mode": "1" } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(s.url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector('.kpi-p-b-per, .kpi-p-mf, .failwrap', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const shape = await page.evaluate(() => {
    const ledgerCards = [...document.querySelectorAll('[data-card^="ledger-"]')].map(c => ({
      key: c.dataset.card,
      height: Math.round(c.getBoundingClientRect().height),
    }));
    const cardPurch = document.querySelector('[data-card="card-purchases"]');
    const cpBtn = cardPurch?.querySelector('.kpi-p-cpact');
    const cpLink = cardPurch?.querySelector('.kpi-p-cplink');
    const vendorTgl = document.querySelector('.kpi-p-tbl-toolbar [aria-label="Row mode"]');
    const drillCard = document.querySelector('[data-card="drill-table"]');
    const drillStyle = drillCard ? window.getComputedStyle(drillCard) : null;
    const emptyRow = document.querySelector('.kpi-p-mf-empty-row');
    return {
      ledgerCards,
      cp_button_gone: !cpBtn,
      cp_link_present: !!cpLink,
      cp_link_text: cpLink?.textContent || null,
      vendor_toggle_present: !!vendorTgl,
      drill_bg: drillStyle?.background?.slice(0,50) || null,
      drill_border_left: drillStyle?.borderLeftWidth || null,
      empty_row_visible: !!emptyRow,
    };
  });
  console.log(`\n=== ${s.name} ===`);
  console.log(JSON.stringify(shape, null, 2));
  if (errors.length) console.log("ERRORS:", errors);
  await ctx.close();
}
await browser.close();
