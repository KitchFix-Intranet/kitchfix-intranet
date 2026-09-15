#!/usr/bin/env node
// Verify CY vendor table follow-ups:
//   1. Source toggle (All / bill.com / Cards) is present + wired.
//   2. Vio Brands (reimb-only) is absent from the vendor table
//      and present in the reimbursables table below.

import { chromium } from "playwright";
const BASE = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
});
const page = await context.newPage();
let fails = 0;

for (const account of ["TBJ - FL", "TBR - FL"]) {
  const enc = encodeURIComponent(account);
  const url = `${BASE}/kpi/purchasing?account=${enc}&preset=fytd`;
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

  const toggle = await page.locator("[aria-label='Source filter']").count();
  const btnAll = await page.locator("[aria-label='Source filter'] button:has-text('All')").count();
  const btnBill = await page.locator("[aria-label='Source filter'] button:has-text('bill.com')").count();
  const btnCard = await page.locator("[aria-label='Source filter'] button:has-text('Cards')").count();
  const vt = await page.locator("[data-card='vendor-table']").count();
  const rt = await page.locator("[data-card='reimbursables-table']").count();
  const vtRows = await page.locator("[data-card='vendor-table'] tbody tr").count();
  const rtRows = await page.locator("[data-card='reimbursables-table'] tbody tr").count();

  // Row-name presence: check Vio only in reimbursables, not vendor table.
  const vtRowNames = await page.$$eval("[data-card='vendor-table'] tbody tr td:first-child",
    els => els.map(el => (el.textContent || "").trim()));
  const rtRowNames = await page.$$eval("[data-card='reimbursables-table'] tbody tr td:first-child",
    els => els.map(el => (el.textContent || "").trim()));
  const vioInVT = vtRowNames.some(n => n.includes("Vio"));
  const vioInRT = rtRowNames.some(n => n.includes("Vio"));

  // Toggle click test: click Cards, count vendor rows before + after.
  const rowCountBefore = vtRows;
  await page.locator("[aria-label='Source filter'] button:has-text('Cards')").click().catch(() => {});
  await page.waitForTimeout(500);
  const rowCountAfterCard = await page.locator("[data-card='vendor-table'] tbody tr").count();
  await page.locator("[aria-label='Source filter'] button:has-text('All')").click().catch(() => {});
  await page.waitForTimeout(300);

  const pass = toggle === 1 && btnAll === 1 && btnBill === 1 && btnCard === 1
    && vt === 1 && rt === 1
    && !vioInVT
    && (account !== "TBJ - FL" || vioInRT)   // TBJ has Vio; TBR may not
    && vtRows > 0 && rtRows > 0
    && rowCountAfterCard !== rowCountBefore   // toggle filters
    && errs.length === 0;
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${account.padEnd(10)}: toggle=${toggle} vt=${vt}(${vtRows} rows) rt=${rt}(${rtRows} rows) vioInVT=${vioInVT} vioInRT=${vioInRT} rowsAll=${rowCountBefore} rowsCards=${rowCountAfterCard} err=${errs.length}`);
  for (const e of errs.slice(0, 2)) console.log(`     ${e}`);
  page.removeAllListeners("pageerror");
  page.removeAllListeners("console");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
