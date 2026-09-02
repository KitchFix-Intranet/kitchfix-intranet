#!/usr/bin/env node
// scripts/probes/_probe_range_composition_render.mjs
//
// Kevin blocker 2026-09-02 Items 1-6 DOM assertions.
//
//   Item 1  chip on FYTD reads "FYTD · P1-P9"
//   Item 2  revenue-lines pill on TBJ - FL FYTD reads "8 verified · 1 live"
//           on a single closed period reads "Verified"; single open "Live"
//   Item 3  revenue card sub-line renders composition summary on FYTD
//   Item 4  popover Revenue row names each source the payload used
//   Item 5  popover consequence sentence renders when will_change_at_close
//   Item 6  status-line renders third clause on FYTD mixed
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_range_composition_render.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function scrape(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);
  // Open the freshness pop by clicking the pill in the command bar.
  const chipPrimary = await page.locator(".kpi-rmenu-label-primary").first().innerText().catch(() => null);
  const revLinePill = await page.locator('[data-kpi-ov="revenue-lines-pill"]').first().innerText().catch(() => null);
  const revComposition = await page.locator('[data-kpi-ov="revenue-composition-summary"]').first().innerText().catch(() => null);
  const statusProgress = await page.evaluate(() => {
    // status line is rendered by StatusLine; find the third segment.
    const el = document.querySelector('[data-kpi-ov="status-line"]');
    if (!el) return null;
    return el.innerText.trim();
  });
  // Open freshness pop (Data current pill) - click and read.
  let popRevenueRow = null, popConsequence = null;
  const pill = page.locator('button.kpi-fresh').first();
  const pillCount = await pill.count();
  if (pillCount) {
    await pill.click().catch(() => null);
    await page.waitForTimeout(400);
    popRevenueRow = await page.evaluate(() => {
      const body = document.querySelector('[data-kpi-ov="data-current-pop"]');
      if (!body) return null;
      const rows = body.querySelectorAll('.kpi-fresh-pop-row');
      for (const r of rows) {
        const spans = r.querySelectorAll('span');
        const key = spans[0]?.innerText.trim();
        const val = r.querySelector('b')?.innerText.trim();
        if (key === 'Revenue') return val;
      }
      return null;
    });
    popConsequence = await page.evaluate(() => {
      const el = document.querySelector('[data-kpi-ov="revenue-consequence"]');
      return el ? el.innerText.trim() : null;
    });
    // Close the pop by pressing Escape (avoids stealing focus).
    await page.keyboard.press("Escape").catch(() => null);
  }
  return { chipPrimary, revLinePill, revComposition, statusProgress, popRevenueRow, popConsequence };
}

// Kevin 2026-09-02 PR-1 of language pass: FYTD ends at last closed
// period. Composition on FYTD is all-verified; no still-running tail,
// no consequence sentence, no "N of M periods verified" third clause
// (the range is closed, not partially closed). Chip reads "P1-P8".
const CASES = [
  {
    name: "TBJ - FL FYTD",
    url: (a) => `${BASE}/kpi/overview?account=${a}`,
    acct: "TBJ - FL",
    expect: {
      chipPrimaryContains: "FYTD · P1-P8",
      revLinePill: "8 verified",
      revCompositionContains: "P1-P8 verified",
      statusProgressAbsent: true,
      popRevenueRowContains: ["P1-P8 verified against the finance P&L"],
      popConsequenceAbsent: true,
    },
  },
  {
    name: "TBR - FL FYTD",
    url: (a) => `${BASE}/kpi/overview?account=${a}`,
    acct: "TBR - FL",
    expect: {
      chipPrimaryContains: "FYTD · P1-P8",
      revLinePill: "8 verified",
      revCompositionContains: "P1-P8 verified",
      statusProgressAbsent: true,
      popRevenueRowContains: ["P1-P8 verified against the finance P&L"],
      popConsequenceAbsent: true,
    },
  },
  {
    name: "TBJ - FL P8 (closed)",
    url: (a) => `${BASE}/kpi/overview?account=${a}&start=2026-07-13&end=2026-08-09`,
    acct: "TBJ - FL",
    expect: {
      revLinePill: "Verified",
      revCompositionAbsent: true,
      popRevenueRowContains: ["P8 verified against the finance P&L"],
      popConsequenceAbsent: true,
    },
  },
  {
    name: "TBJ - FL P9 (open)",
    url: (a) => `${BASE}/kpi/overview?account=${a}&start=2026-08-10&end=2026-09-06`,
    acct: "TBJ - FL",
    expect: {
      revLinePill: "Live",
      revCompositionAbsent: true,
      popRevenueRowContains: ["P9 live from Service Calendar"],
      popConsequenceContains: "will change when the period closes",
    },
  },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function main() {
  console.log(`# range_composition DOM - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  cases=${CASES.length}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);
  for (const c of CASES) {
    const before = FAILS.length;
    const scraped = await scrape(page, c.url(acct(c.acct)));
    console.log(`  case: ${c.name}`);
    console.log(`    chipPrimary: ${JSON.stringify(scraped.chipPrimary)}`);
    console.log(`    revLinePill: ${JSON.stringify(scraped.revLinePill)}`);
    console.log(`    revComposition: ${JSON.stringify(scraped.revComposition)}`);
    console.log(`    statusProgress: ${JSON.stringify(scraped.statusProgress)}`);
    console.log(`    popRevenueRow: ${JSON.stringify(scraped.popRevenueRow)}`);
    console.log(`    popConsequence: ${JSON.stringify(scraped.popConsequence)}`);
    const e = c.expect;
    if (e.chipPrimaryContains && !(scraped.chipPrimary || "").includes(e.chipPrimaryContains)) {
      fail(c.name, `chip primary missing "${e.chipPrimaryContains}" (got ${JSON.stringify(scraped.chipPrimary)})`);
    }
    // Pill CSS text-transforms to uppercase; assert case-insensitive.
    if (e.revLinePill && (scraped.revLinePill || "").toLowerCase() !== e.revLinePill.toLowerCase()) {
      fail(c.name, `revenue-lines pill "${scraped.revLinePill}" != "${e.revLinePill}" (case-insensitive)`);
    }
    if (e.revCompositionContains && !(scraped.revComposition || "").includes(e.revCompositionContains)) {
      fail(c.name, `revenue composition missing "${e.revCompositionContains}"`);
    }
    if (e.revCompositionAbsent && scraped.revComposition) {
      fail(c.name, `revenue composition should be absent, got "${scraped.revComposition}"`);
    }
    if (e.statusProgressContains && !(scraped.statusProgress || "").includes(e.statusProgressContains)) {
      fail(c.name, `status progress missing "${e.statusProgressContains}"`);
    }
    if (e.statusProgressAbsent) {
      // The third clause pattern is "N of M periods verified" or "N of
      // M weeks closed". Assert neither appears - FYTD closed-only
      // shouldn't advertise progress.
      if (/periods verified|weeks closed/.test(scraped.statusProgress || "")) {
        fail(c.name, `status progress should NOT contain a periods/weeks clause; got: ${JSON.stringify(scraped.statusProgress)}`);
      }
    }
    if (e.popRevenueRowContains) {
      for (const s of e.popRevenueRowContains) {
        if (!(scraped.popRevenueRow || "").includes(s)) {
          fail(c.name, `popover Revenue row missing "${s}"`);
        }
      }
    }
    if (e.popConsequenceContains && !(scraped.popConsequence || "").includes(e.popConsequenceContains)) {
      fail(c.name, `popover consequence missing "${e.popConsequenceContains}"`);
    }
    if (e.popConsequenceAbsent && scraped.popConsequence) {
      fail(c.name, `popover consequence should be absent, got "${scraped.popConsequence}"`);
    }
    const after = FAILS.length;
    console.log(`    ${after === before ? "OK" : "FAIL"} (${after - before} violation${after-before===1?"":"s"})`);
    console.log("");
  }
  await browser.close();
  if (FAILS.length === 0) {
    console.log(`Result: all four surfaces render composition correctly across ${CASES.length} cases.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
