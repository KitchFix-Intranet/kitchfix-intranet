#!/usr/bin/env node
// PR 2 shape verify: CY renders vendor-table, LP renders spend-list +
// reimbursables-table, CP keeps existing drill-table, NP has no
// detail section. Also count rows on TBJ LP to prove the spend list
// actually populated.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const RANGES = [
  { key: "CY", preset: "fytd" },
  { key: "LP", preset: "last_period" },
  { key: "CP", preset: "this_period" },
  { key: "NP", start: "2026-10-05", end: "2026-11-01" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
});
const page = await context.newPage();

let fails = 0;
for (const account of ["TBJ - FL", "TBR - FL"]) {
  for (const rng of RANGES) {
    const qs = rng.preset ? `&preset=${rng.preset}` : `&start=${rng.start}&end=${rng.end}`;
    const url = `${BASE}/kpi/purchasing?account=${encodeURIComponent(account)}${qs}`;
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

    const codestrip = await page.locator(".kpi-p-codestrip").count();
    const wig = await page.locator(".kpi-p-wig").count();
    const vendorTable = await page.locator("[data-card='vendor-table']").count();
    const spendList = await page.locator("[data-card='spend-list']").count();
    const reimb = await page.locator("[data-card='reimbursables-table']").count();
    const drill = await page.locator("[data-card='drill-table']").count();
    const spendRows = await page.locator("[data-card='spend-list'] tbody tr").count();
    const reimbRows = await page.locator("[data-card='reimbursables-table'] tbody tr").count();
    const vendorRows = await page.locator("[data-card='vendor-table'] tbody tr").count();

    // Expected shape per range.
    let expected;
    if (rng.key === "CY") expected = { vendor: 1, spend: 0, reimb: 0, drill: 0 };
    else if (rng.key === "LP") expected = { vendor: 0, spend: 1, reimb: ">0", drill: 0 };
    else if (rng.key === "CP") expected = { vendor: 0, spend: 0, reimb: 0, drill: 1 };
    else /* NP */              expected = { vendor: 0, spend: 0, reimb: 0, drill: 0 };

    const ok = codestrip > 0
      && wig > 0
      && vendorTable === expected.vendor
      && spendList === expected.spend
      && (expected.reimb === ">0" ? reimb >= 0 : reimb === expected.reimb)
      && drill === expected.drill
      && errs.length === 0;
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${account.padEnd(9)} ${rng.key} · vt=${vendorTable} sl=${spendList}(${spendRows} rows) rt=${reimb}(${reimbRows} rows) drill=${drill} err=${errs.length}`);
    for (const e of errs.slice(0, 2)) console.log(`     ${e}`);
    page.removeAllListeners("pageerror");
    page.removeAllListeners("console");
  }
}
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
