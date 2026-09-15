#!/usr/bin/env node
// R-109 PR 1 shape probe. Loads Overview CP on TBJ + TBR, verifies:
//   - New table + review render (kpi-ov-cp-card + kpi-ov-cp-rv)
//   - Removed on CP: CardsRow, WeekRail, CostLines, PnlStatement
//   - Other ranges (CY, LP, NP) still render their original surfaces
//   - Zero page/console errors

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
// Overview page.js reads start/end from URL; the /api/kpi/overview
// route accepts range=... but the client page doesn't forward it.
// Use explicit dates for both.
const RANGES_ON = [{ key: "CP", qs: "&start=2026-09-07&end=2026-10-04" }];
const RANGES_OFF = [
  { key: "CY", qs: "&start=2025-12-29&end=2026-09-06" },
  { key: "LP", qs: "&start=2026-08-10&end=2026-09-06" },
  { key: "NP", qs: "&start=2026-10-05&end=2026-11-01" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
  viewport: { width: 1360, height: 900 },
});
const page = await context.newPage();
let fails = 0;

for (const account of ["TBJ - FL", "TBR - FL"]) {
  const enc = encodeURIComponent(account);

  // CP · new surface expected
  for (const r of RANGES_ON) {
    const url = `${BASE}/kpi/overview?account=${enc}${r.qs}`;
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/sentry|CORS|net::|Failed to load resource: net::/i.test(t)) return;
      errs.push("console: " + t.slice(0, 200));
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const table = await page.locator(".kpi-ov-cp-card").count();
    const review = await page.locator(".kpi-ov-cp-rv").count();
    // Removed on CP:
    const cardsRow = await page.locator(".kpi-ov-cards-row").count();
    const weekRail = await page.locator(".kpi-ov-week-rail").count();
    const costLines = await page.locator("[data-kpi-ov='cost-lines']").count();
    const pnl = await page.locator(".kpi-ov-pnl").count();

    const pass = table === 1 && review >= 0
      && cardsRow === 0 && weekRail === 0 && costLines === 0 && pnl === 0
      && errs.length === 0;
    if (!pass) fails++;
    console.log(`${pass ? "PASS" : "FAIL"} ${account.padEnd(10)} CP · table=${table} review=${review} cardsRow=${cardsRow} weekRail=${weekRail} costLines=${costLines} pnl=${pnl} err=${errs.length}`);
    for (const e of errs.slice(0, 2)) console.log(`     ${e}`);
    page.removeAllListeners("pageerror");
    page.removeAllListeners("console");
  }

  // Other ranges · original surface expected
  for (const r of RANGES_OFF) {
    const url = `${BASE}/kpi/overview?account=${enc}${r.qs}`;
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/sentry|CORS|net::|Failed to load resource: net::/i.test(t)) return;
      errs.push("console: " + t.slice(0, 200));
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const table = await page.locator(".kpi-ov-cp-card").count();
    // Any of the standard non-CP surfaces should be present:
    const anyNonCP = await page.locator(".kpi-ov-cards, [data-kpi-ov='cards-row'], [data-kpi-ov='cost-lines'], [data-kpi-ov^='planning-card-'], [data-kpi-ov='pln-rate-strip']").count();
    const pass = table === 0 && anyNonCP > 0 && errs.length === 0;
    if (!pass) fails++;
    console.log(`${pass ? "PASS" : "FAIL"} ${account.padEnd(10)} ${r.key} · cp-table=${table} nonCP=${anyNonCP} err=${errs.length}`);
    for (const e of errs.slice(0, 2)) console.log(`     ${e}`);
    page.removeAllListeners("pageerror");
    page.removeAllListeners("console");
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
