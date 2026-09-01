// scripts/probes/_probe_overview_p2_defect_shots.mjs
//
// P2 defect batch (fix/overview-p2-defects-2026-09-01) verification
// screenshots. Captures live paint of each of the five P2 fixes:
//   P2-1  rail descriptions on all 11 accounts (corporate posture)
//   P2-2  card hero size parity with labor at 1680x1050
//   P2-3  range chip reads "FYTD" (not "Custom 12/29/25 - 09/01/26")
//   P2-4  sources line: "Sun 08/30" format, all three sources shown,
//         freshness chip not red
//   P2-5  revenue card shows full-year budget on FYTD
//
// USAGE:
//   TEST_MODE=true PORT=3299 npm run dev &
//   node --env-file=.env.local scripts/probes/_probe_overview_p2_defect_shots.mjs
//
// Screenshots land in /tmp/overview_p2_*.png.

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3299";
const OUT = "/tmp";
const acct = (k) => encodeURIComponent(k);

async function loadReady(page, url) {
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  await page.waitForSelector('[data-kpi-ov="board"], .kpi-statebox', { timeout: 15000 });
  // Small settle for CSS animations
  await page.waitForTimeout(400);
}

async function loadLabor(page, url) {
  // Labor may or may not fire the API on first URL visit depending
  // on client-side redirect state. Poll for the DOM instead of the
  // network so we don't block on a request that already resolved.
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector('.kpi-app', { timeout: 30000 });
  // Wait for either a signal-card hero or a homestand hero to land.
  await page.waitForFunction(
    () => document.querySelectorAll('.kpi-sig-hero-val, .kpi-hs-hero').length > 0,
    null,
    { timeout: 30000 },
  ).catch(() => { /* keep going if none landed */ });
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const path = `${OUT}/overview_p2_${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  [shot] ${name} -> ${path}`);
  return path;
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await context.newPage();

  console.log("─".repeat(70));
  console.log("P2 defect batch - live paint verification");
  console.log(`BASE: ${BASE}   VIEWPORT: 1680x1050`);
  console.log("─".repeat(70));

  const results = {};

  // P2-1 rail descriptions (corporate posture, ALL account)
  console.log("");
  console.log("[P2-1] rail descriptions on all 11 accounts");
  await loadReady(page, `${BASE}/kpi/overview?account=ALL`);
  await page.waitForTimeout(400);
  const railDesc = await page.evaluate(() => {
    const rows = document.querySelectorAll('.kpi-acct-desc');
    const out = [];
    for (const r of rows) {
      out.push({
        key: r.parentElement?.querySelector('.kpi-acct-key')?.textContent?.trim() || '?',
        desc: r.textContent.trim(),
        len: r.textContent.length,
      });
    }
    return out;
  });
  console.log(`  found ${railDesc.length} rail rows`);
  for (const r of railDesc) {
    console.log(`    ${r.key}  ->  "${r.desc}"  (len=${r.len})`);
  }
  const emptyCount = railDesc.filter(r => r.desc.length <= 1).length;
  console.log(`  empty descriptions (len<=1): ${emptyCount}  (target: 0 for P2-1)`);
  results.p2_1_all_11 = emptyCount === 0 && railDesc.length === 11;
  results.p2_1_shot = await shot(page, "1_rail_desc_all_accounts");

  // P2-3 range chip reads FYTD not Custom
  console.log("");
  console.log("[P2-3] range chip reads FYTD");
  await loadReady(page, `${BASE}/kpi/overview?account=CIN%20-%20AZ`);
  await page.waitForTimeout(400);
  const rangeChip = await page.evaluate(() => {
    // The RangeMenu button carries the primary label
    const btn = document.querySelector('.kpi-ctl-sel[aria-haspopup="menu"]');
    // find the range chip button - it's the one that isn't the section menu
    const buttons = document.querySelectorAll('.kpi-ctl');
    const out = [];
    for (const b of buttons) {
      out.push({
        text: b.textContent.trim().slice(0, 120),
        cls: b.className,
      });
    }
    return out;
  });
  console.log(`  found ${rangeChip.length} .kpi-ctl buttons`);
  for (const c of rangeChip) console.log(`    "${c.text}"`);
  const anyFYTD = rangeChip.some(c => /FYTD/i.test(c.text));
  const anyCustom = rangeChip.some(c => /Custom/i.test(c.text));
  console.log(`  contains FYTD: ${anyFYTD}   contains Custom: ${anyCustom}   (target: FYTD=true, Custom=false)`);
  results.p2_3_fytd_shown = anyFYTD && !anyCustom;
  results.p2_3_shot = await shot(page, "3_range_chip_fytd");

  // P2-4 sources line format + freshness
  console.log("");
  console.log("[P2-4] sources line + freshness chip");
  const sourcesLine = await page.evaluate(() => {
    const s = document.querySelector('[data-kpi-ov="sources-line"]');
    if (!s) return null;
    const spans = s.querySelectorAll('span[data-kpi-ov]');
    const out = [];
    for (const sp of spans) {
      out.push({
        kind: sp.getAttribute('data-kpi-ov'),
        text: sp.textContent.trim(),
      });
    }
    return out;
  });
  console.log(`  found ${sourcesLine ? sourcesLine.length : 0} source spans`);
  if (sourcesLine) {
    for (const s of sourcesLine) console.log(`    [${s.kind}]  "${s.text}"`);
  }
  const hasLabor = sourcesLine?.some(s => s.kind === 'src-labor');
  const hasPurchases = sourcesLine?.some(s => s.kind === 'src-purchases');
  const hasSc = sourcesLine?.some(s => s.kind === 'src-sc');
  const anyISOFormat = sourcesLine?.some(s => /\d{4}-\d{2}-\d{2}/.test(s.text));
  const anyDayFormat = sourcesLine?.some(s => /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}\/\d{2}/.test(s.text));
  console.log(`  labor present: ${hasLabor}   purchases: ${hasPurchases}   sc: ${hasSc}`);
  console.log(`  ISO format present: ${anyISOFormat}  (target: false)`);
  console.log(`  Day format ("Sun 08/30") present: ${anyDayFormat}  (target: true)`);
  results.p2_4_all_three_sources = hasLabor && hasPurchases && hasSc;
  results.p2_4_dayformat = anyDayFormat && !anyISOFormat;

  const freshnessChip = await page.evaluate(() => {
    const f = document.querySelector('.kpi-fresh');
    if (!f) return null;
    return {
      label: f.textContent.trim(),
      classes: f.className,
    };
  });
  console.log(`  freshness chip: label="${freshnessChip?.label}"   class="${freshnessChip?.classes}"`);
  const chipRed = /No recent walk|stale/i.test(freshnessChip?.label || '') ||
                  /kpi-chip-stale/i.test(freshnessChip?.classes || '');
  console.log(`  chip reads red/stale: ${chipRed}  (target: false)`);
  results.p2_4_freshness_not_red = !chipRed;
  results.p2_4_shot = await shot(page, "4_sources_line");

  // P2-5 revenue card full-year budget label
  console.log("");
  console.log("[P2-5] revenue card full-year budget on FYTD");
  const revCard = await page.evaluate(() => {
    const c = document.querySelector('[data-kpi-ov="card-revenue"]');
    if (!c) return null;
    return { text: c.textContent.trim().slice(0, 400) };
  });
  console.log(`  revenue card text: "${revCard?.text}"`);
  const hasFullYear = /full year/i.test(revCard?.text || '');
  const hasPeriodBudget = /period budget/i.test(revCard?.text || '');
  console.log(`  contains "full year": ${hasFullYear}   contains "period budget": ${hasPeriodBudget}`);
  console.log(`  (target: full year=true, period budget=false on FYTD)`);
  results.p2_5_full_year_shown = hasFullYear && !hasPeriodBudget;
  results.p2_5_shot = await shot(page, "5_revenue_card_fytd");

  // P2-2 side-by-side at 1680
  console.log("");
  console.log("[P2-2] card size parity at 1680x1050");
  const heroSizeOv = await page.evaluate(() => {
    const h = document.querySelector('.kpi-ov-hero');
    if (!h) return null;
    return getComputedStyle(h).fontSize;
  });
  console.log(`  overview .kpi-ov-hero font-size: ${heroSizeOv}`);
  results.p2_2_shot_overview = await shot(page, "2_overview_1680");

  // Labor side-by-side.
  //
  // Labor's client-side fetch is gated on session status ==
  // "authenticated" (see src/app/kpi/labor/page.js:233) which does not
  // resolve under Playwright + TEST_MODE (no OAuth flow), so the DOM
  // never contains .kpi-hs-hero / .kpi-sig-hero-val for direct
  // computed-style comparison. Instead, we compare against the labor
  // role token by injecting a scratch element into the labor page's
  // .kpi-app scope (which does exist) that uses the same role, and
  // read that back. Same --kf-scale, same font-size role, same
  // resolved px.
  await loadLabor(page, `${BASE}/kpi/labor?account=CIN%20-%20AZ`);
  const heroSizeLab = await page.evaluate(() => {
    const app = document.querySelector('.kpi-app');
    if (!app) return null;
    const scratch = document.createElement('span');
    scratch.style.fontSize = 'var(--kpi-t-value)';
    scratch.style.position = 'absolute';
    scratch.style.left = '-9999px';
    scratch.textContent = '$0';
    app.appendChild(scratch);
    const size = getComputedStyle(scratch).fontSize;
    app.removeChild(scratch);
    return size;
  });
  console.log(`  labor --kpi-t-value (the role .kpi-hs-hero + .kpi-sig-hero-val use): ${heroSizeLab}`);
  console.log(`  parity (should be equal): ${heroSizeOv === heroSizeLab}`);
  results.p2_2_size_parity = heroSizeOv === heroSizeLab;
  results.p2_2_shot_labor = await shot(page, "2_labor_1680");

  console.log("");
  console.log("─".repeat(70));
  console.log("SUMMARY");
  console.log("─".repeat(70));
  const summary = [
    ["P2-1  rail desc all 11 populated", results.p2_1_all_11],
    ["P2-2  hero size parity ov vs labor", results.p2_2_size_parity],
    ["P2-3  range chip reads FYTD", results.p2_3_fytd_shown],
    ["P2-4  all three sources shown", results.p2_4_all_three_sources],
    ["P2-4  day format (no ISO)", results.p2_4_dayformat],
    ["P2-4  freshness chip not red", results.p2_4_freshness_not_red],
    ["P2-5  revenue card 'full year' on FYTD", results.p2_5_full_year_shown],
  ];
  let allPass = true;
  for (const [name, ok] of summary) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) allPass = false;
  }
  console.log("");
  console.log(`Screenshots (${OUT}/):`);
  console.log(`  ${results.p2_1_shot}`);
  console.log(`  ${results.p2_2_shot_overview}   (overview 1680)`);
  console.log(`  ${results.p2_2_shot_labor}      (labor 1680)`);
  console.log(`  ${results.p2_3_shot}`);
  console.log(`  ${results.p2_4_shot}`);
  console.log(`  ${results.p2_5_shot}`);

  await browser.close();
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
