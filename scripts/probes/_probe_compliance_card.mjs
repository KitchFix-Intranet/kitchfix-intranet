#!/usr/bin/env node
/*
 * PR 6 compliance card visual + numeric acceptance.
 *
 * 1. Screenshots the ALL/FYTD card at 1680, 1456, 900.
 * 2. Screenshots a single-account view (auto-expand).
 * 3. Screenshots an expanded site row.
 * 4. Fetches ALL / EAST / WEST payloads and asserts
 *      compliance_ALL.total_count === compliance_EAST.total_count + compliance_WEST.total_count
 *    (Check 2 = region parity, same shape as Check 3).
 *
 * ENV RULE: only executes via TEST_MODE=true.  Header X-Test-Mode: 1 is
 * a defence-in-depth marker; the middleware gates on env only.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chromePath) { console.error("chrome not found"); process.exit(1); }

const BASE = process.env.KPI_BASE || "http://localhost:3022";
const OUT = process.env.HOME + "/Downloads";
const WIDTHS = [1680, 1456, 900];

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

async function grab(name, url, width, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 1600 },
    extraHTTPHeaders: { "X-Test-Mode": "1" },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-card="compliance"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  if (opts.expandFirstSite) {
    await page.click('.kpi-p-cc-siterow'); // first site button
    await page.waitForTimeout(300);
  }
  const info = await page.evaluate(() => {
    const card = document.querySelector('[data-card="compliance"]');
    if (!card) return { present: false };
    const pill = card.querySelector('.kpi-p-pill');
    const hero = card.querySelector('.kpi-p-hero');
    const oldest = card.querySelector('.kpi-p-cc-sec .kpi-p-cc-stat:nth-child(1) .kpi-p-cc-v');
    const noReceipt = card.querySelector('.kpi-p-cc-sec .kpi-p-cc-stat:nth-child(2) .kpi-p-cc-v');
    const sites = [...card.querySelectorAll('.kpi-p-cc-siterow')].map(b => {
      const cells = [...b.querySelectorAll('.kpi-p-cc-r')].map(c => c.textContent.trim());
      const label = b.querySelector('.kpi-p-cc-k')?.textContent?.trim();
      return { label, cells };
    });
    const people = [...card.querySelectorAll('.kpi-p-cc-personrow')].map(b => {
      const cells = [...b.querySelectorAll('.kpi-p-cc-r')].map(c => c.textContent.trim());
      const label = b.querySelector('.kpi-p-cc-k')?.textContent?.trim();
      return { label, cells };
    });
    const footnotes = [...card.querySelectorAll('.kpi-p-cc-footnote')].map(f => f.textContent.trim());
    return {
      present: true,
      pill: pill?.textContent?.trim(),
      hero: hero?.textContent?.trim(),
      oldest: oldest?.textContent?.trim(),
      no_receipt: noReceipt?.textContent?.trim(),
      site_count: sites.length,
      first_site: sites[0],
      people_count: people.length,
      footnotes,
    };
  });
  const file = `${OUT}/r-compliance-${name}-${width}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ${name} ${width}px  present=${info.present} pill="${info.pill}" hero="${info.hero}" oldest="${info.oldest}" no_receipt="${info.no_receipt}" sites=${info.site_count} people_visible=${info.people_count}`);
  if (info.footnotes?.length) info.footnotes.forEach(f => console.log(`    footnote: ${f}`));
  await ctx.close();
  return info;
}

console.log("=== ALL / FYTD ===");
for (const w of WIDTHS) await grab("all-fytd", `${BASE}/kpi/purchasing?account=ALL&preset=fytd`, w);

console.log("\n=== Single-account (auto-expand) ===");
await grab("stl-mo-fytd", `${BASE}/kpi/purchasing?account=STL+-+MO&preset=fytd`, 1680);

console.log("\n=== ALL/FYTD, first site expanded ===");
await grab("all-fytd-expanded", `${BASE}/kpi/purchasing?account=ALL&preset=fytd`, 1680, { expandFirstSite: true });

// ─── Region parity smoke (S2 sweep at data layer) ──────────────────
console.log("\n=== EAST + WEST == ALL region-parity check ===");
async function fetchPayload(account) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Test-Mode": "1" } });
  const page = await ctx.newPage();
  const resp = await page.request.get(`${BASE}/api/kpi/purchasing?account=${encodeURIComponent(account)}`);
  const d = await resp.json();
  await ctx.close();
  return d;
}
const [all, east, west] = await Promise.all([
  fetchPayload("ALL"),
  fetchPayload("EAST"),
  fetchPayload("WEST"),
]);
const cAll = all.compliance, cE = east.compliance, cW = west.compliance;
const sumCount  = (cE?.total_count  || 0) + (cW?.total_count  || 0);
const sumAmount = Math.round(((cE?.total_amount || 0) + (cW?.total_amount || 0)) * 100) / 100;
console.log(`  ALL.total_count=${cAll?.total_count}  EAST+WEST=${sumCount}  ${cAll?.total_count === sumCount ? "OK" : "FAIL"}`);
console.log(`  ALL.total_amount=${cAll?.total_amount}  EAST+WEST=${sumAmount}  ${Math.abs((cAll?.total_amount || 0) - sumAmount) < 0.01 ? "OK" : "FAIL"}`);

await browser.close();
