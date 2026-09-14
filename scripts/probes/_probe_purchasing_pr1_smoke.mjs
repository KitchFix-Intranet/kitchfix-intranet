#!/usr/bin/env node
// Purchasing PR 1 · smoke check. Browser-load every account × range
// combo, assert no page errors + presence of new PR 1 elements
// (coding strip + where-it-went + drill table) and absence of the
// removed elements (bucket cards + card compliance + folio rail).

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const RANGES = [
  { key: "CY", start: "", end: "", preset: "fytd" },
  { key: "LP", start: "", end: "", preset: "last_period" },
  { key: "CP", start: "", end: "", preset: "this_period" },
  { key: "NP", start: "2026-10-05", end: "2026-11-01", preset: null },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
});
const page = await context.newPage();

let fails = 0;
for (const account of ["TBJ - FL", "TBR - FL"]) {
  const enc = encodeURIComponent(account);
  for (const rng of RANGES) {
    const qs = rng.preset ? `&preset=${rng.preset}` : `&start=${rng.start}&end=${rng.end}`;
    const url = `${BASE}/kpi/purchasing?account=${enc}${qs}`;
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/sentry|CORS|net::|Failed to load resource: net::/i.test(t)) return;
      errs.push("console: " + t.slice(0, 200));
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const board = await page.locator(".kpi-p-board").count();
    const codingStrip = await page.locator(".kpi-p-codestrip").count();
    const wig = await page.locator(".kpi-p-wig").count();
    const drill = await page.locator("[data-card='drill-table']").count();
    // Removed:
    const bucketCard = await page.locator("[data-card='bucket-food'], [data-card='bucket-packaging'], .kpi-p-bc").count().catch(() => 0);
    const cardCompliance = await page.locator("[data-card='compliance']").count();
    const folioRail = await page.locator("[data-testid='folio-rail'], .kpi-folio").count().catch(() => 0);
    const showFilter = await page.locator("[aria-label='Show filter']").count();
    const targetLine = await page.locator(".kpi-p-ln.orig, .kpi-p-ln.adj").count().catch(() => 0);

    const pass = board > 0 && codingStrip > 0 && wig > 0 && drill > 0
      && bucketCard === 0 && cardCompliance === 0 && folioRail === 0
      && showFilter === 0 && targetLine === 0 && errs.length === 0;
    if (!pass) fails++;
    console.log(`${pass ? "PASS" : "FAIL"} ${account} ${rng.key.padEnd(3)} board=${board} strip=${codingStrip} wig=${wig} drill=${drill} bc=${bucketCard} comp=${cardCompliance} rail=${folioRail} showFilter=${showFilter} targetLn=${targetLine} err=${errs.length}`);
    for (const e of errs.slice(0, 3)) console.log(`     ${e}`);
    page.removeAllListeners("pageerror");
    page.removeAllListeners("console");
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
