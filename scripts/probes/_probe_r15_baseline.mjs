#!/usr/bin/env node
/**
 * R15 BEFORE state.  CIN-AZ current period is check 12: measure the
 * 300px void + card-height variance before we start.  Also grab
 * baselines at ALL FYTD and ALL P8 for reference.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const BASE = process.env.KPI_BASE || "http://localhost:3021";
const OUT  = process.env.HOME + "/Downloads";
const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });

async function measure(url, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 1400 },
    extraHTTPHeaders: { "X-Test-Mode": "1" },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('.kpi-p-b-per, .failwrap', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const summary = await page.evaluate(() => {
    // Everything below the packaging card (identity ".kpi-p-b-pkg")
    const board = document.querySelector('.kpi-p-board');
    if (!board) return { error: "no .kpi-p-board" };
    const pkgCard = board.querySelector('.kpi-p-card.kpi-p-b-pkg');
    if (!pkgCard) return { error: "no pkg card" };
    const pkgBottom = pkgCard.getBoundingClientRect().bottom;
    const cards = [...board.querySelectorAll('.kpi-p-card, .kpi-p-flatrow, .kpi-p-reimbrow, .kpi-p-mf, .kpi-p-tbl-wrap, [data-card]')];
    const lower = cards
      .filter(c => c.getBoundingClientRect().top >= pkgBottom - 5)
      .map(c => {
        const r = c.getBoundingClientRect();
        return {
          tag:    c.tagName,
          data:   c.getAttribute('data-card') || null,
          klass:  c.className.split(/\s+/).filter(k => k.startsWith('kpi-p-')).slice(0, 3),
          top:    Math.round(r.top),
          height: Math.round(r.height),
          empty:  c.textContent.trim().length < 5,
        };
      });
    // Compute vertical gaps between adjacent rows
    return {
      pkg_bottom: Math.round(pkgBottom),
      lower_cards: lower,
      total_cards: lower.length,
      total_lower_height: Math.round(document.body.getBoundingClientRect().height - pkgBottom),
    };
  });
  const safe = label.replace(/[^A-Za-z0-9_-]/g, "");
  const file = `${OUT}/r15-BEFORE-${safe}.png`;
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  return { file, summary };
}

const SCENES = [
  { label: "CIN-AZ-this",  url: `${BASE}/kpi/purchasing?account=CIN+-+AZ&preset=this_period` },
  { label: "CIN-AZ-last",  url: `${BASE}/kpi/purchasing?account=CIN+-+AZ&preset=last_period` },
  { label: "CIN-AZ-FYTD",  url: `${BASE}/kpi/purchasing?account=CIN+-+AZ&preset=fytd` },
  { label: "ALL-FYTD",     url: `${BASE}/kpi/purchasing?account=ALL&preset=fytd` },
  { label: "ALL-P8",       url: `${BASE}/kpi/purchasing?account=ALL&start=2026-07-13&end=2026-08-09` },
];

try {
  for (const s of SCENES) {
    console.log(`\n=== ${s.label}: ${s.url}`);
    const { file, summary } = await measure(s.url, s.label);
    if (summary.error) { console.log(`  ${summary.error}`); continue; }
    console.log(`  saved: ${file}`);
    console.log(`  packaging bottom @ y=${summary.pkg_bottom}, total lower height=${summary.total_lower_height}px, ${summary.total_cards} cards`);
    for (const c of summary.lower_cards) {
      console.log(`    y=${String(c.top).padStart(5)}  h=${String(c.height).padStart(4)}  ${c.klass.join('.')}  ${c.data ? `data-card="${c.data}"` : ''}`);
    }
  }
} finally { await browser.close(); }
