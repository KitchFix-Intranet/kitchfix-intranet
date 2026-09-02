#!/usr/bin/env node
// scripts/probes/_probe_pace_removed_render.mjs
//
// R-52 (Kevin, 2026-09-02):
//
//   PacePanel is deleted. Verify at DOM level that:
//     A1  [data-kpi-ov="pace-panel"] never renders on any range.
//     A2  the single-account right column has exactly two cards -
//         Revenue lines + Also tracked - and their order.
//     A3  counts-without-dollars state renders on the Revenue card:
//         hero em-dash, pill "Not yet reporting", sub-line with
//         row count and dates. Fabricated via a page.route intercept
//         on /api/kpi/overview so the state is exercised even when
//         no live account is in it.
//     A4  measure right-column heights at 1680 and 1366; report only
//         (per Kevin's rule "do not adjust the grid ratio on your
//         own judgement").
//   Also captures screenshots to /tmp/kpi-overview-pace-removed/
//   for the PR body.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_pace_removed_render.mjs

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3311";
const OUT = "/tmp/kpi-overview-pace-removed";
fs.mkdirSync(OUT, { recursive: true });

const acct = (k) => encodeURIComponent(k);

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

const CASES = [
  { name: "TBJ - FL FYTD",           account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P8 (verified)",  account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBJ - FL P9 (open)",      account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBR - FL FYTD (flag-off)", account: "TBR - FL", qs: "" },
  { name: "CIN - OH FYTD (fee)",     account: "CIN - OH", qs: "" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function screenshotAndAudit(page, c, viewport) {
  await page.setViewportSize({ width: viewport, height: 1050 });
  const url = c.qs
    ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/kpi/overview?account=${acct(c.account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);
  const paceCount = await page.locator('[data-kpi-ov="pace-panel"]').count();
  if (paceCount !== 0) fail(`${c.name} @${viewport}`, `pace-panel still in DOM (count=${paceCount})`);
  const rightCards = await page.evaluate(() => {
    const right = document.querySelector('.kpi-ov-split-right');
    if (!right) return null;
    // Children card names via data attributes.
    const kids = [...right.children].map(el => {
      return el.getAttribute("data-kpi-ov") || el.className || null;
    });
    const rect = right.getBoundingClientRect();
    return { kids, height: Math.round(rect.height) };
  });
  const leftRect = await page.evaluate(() => {
    const left = document.querySelector('.kpi-ov-split-left');
    if (!left) return null;
    const rect = left.getBoundingClientRect();
    return { height: Math.round(rect.height) };
  });
  const slug = c.name.replace(/[^A-Za-z0-9]+/g, "-");
  const shotPath = `${OUT}/${slug}-${viewport}.png`;
  await page.screenshot({ path: shotPath, fullPage: true });
  return { paceCount, rightCards, leftRect, shotPath };
}

async function auditCountsWithoutDollars(page, viewport) {
  await page.setViewportSize({ width: viewport, height: 1050 });
  // Intercept /api/kpi/overview and mutate the response to force the
  // sc_counts_without_dollars state. The interception mirrors what
  // the resolver would produce naturally when TBJ - FL had zero
  // revenue but SC counts landed.
  await page.route("**/api/kpi/overview**", async route => {
    const resp = await route.fetch();
    const j = await resp.json();
    j.sc_counts_without_dollars = {
      row_count: 22,
      dates_covered: { first: "2026-08-10", last: "2026-08-31" },
    };
    // Flip Revenue card into absence state.
    const rev = (j.cards || []).find(c => c.key === "revenue");
    if (rev) {
      rev.pill = { label: "Not yet reporting", tone: "neutral" };
      rev.hero_reported = false;
      rev.hero_actual = null;
      rev.hero_actual_display = null;
    }
    await route.fulfill({ response: resp, body: JSON.stringify(j) });
  });
  const url = `${BASE}/kpi/overview?account=${acct("TBJ - FL")}&start=2026-08-10&end=2026-09-06`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1400);
  // Verify Revenue card state.
  const scAbsent = await page.evaluate(() => {
    const card = document.querySelector('[data-kpi-ov="card-revenue"]');
    if (!card) return null;
    const hero = card.querySelector('[data-kpi-ov="hero-revenue"]');
    const heroText = hero ? hero.innerText.trim() : null;
    const pill = card.querySelector('[data-kpi-ov="pill"]');
    const pillText = pill ? pill.innerText.trim() : null;
    const sub = card.querySelector('[data-kpi-ov="revenue-sub-sc-absent"]');
    const subText = sub ? sub.innerText.trim() : null;
    return { heroText, pillText, subText };
  });
  const shot = `${OUT}/counts-without-dollars-${viewport}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  await page.unroute("**/api/kpi/overview**");
  return { scAbsent, shot };
}

async function main() {
  console.log(`# pace-removed DOM + screenshots - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}   OUT=${OUT}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockAuthSession(page);

  const heights = { 1680: [], 1366: [] };
  for (const viewport of [1680, 1366]) {
    for (const c of CASES) {
      const r = await screenshotAndAudit(page, c, viewport);
      const rightH = r.rightCards?.height ?? null;
      const leftH = r.leftRect?.height ?? null;
      heights[viewport].push({ name: c.name, right: rightH, left: leftH, diff: (leftH != null && rightH != null) ? leftH - rightH : null });
      console.log(`  ${c.name} @${viewport}px  right kids=${JSON.stringify(r.rightCards?.kids)}  L=${leftH} R=${rightH} diff=${leftH != null && rightH != null ? (leftH - rightH) : "?"}  shot=${r.shotPath}`);
    }
    console.log("");
  }
  // A2 - right column has exactly two children (Revenue lines +
  // Also tracked) in that order on single-account view (skip FYTD
  // aggregate cases).
  for (const viewport of [1680, 1366]) {
    for (const c of CASES) {
      const url = c.qs
        ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
        : `${BASE}/kpi/overview?account=${acct(c.account)}`;
      await page.setViewportSize({ width: viewport, height: 1050 });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(400);
      const kids = await page.evaluate(() => {
        const right = document.querySelector('.kpi-ov-split-right');
        if (!right) return null;
        return [...right.children].map(el => el.getAttribute("data-kpi-ov"));
      });
      if (kids) {
        const expected = ["revenue-lines", "also-tracked"];
        if (JSON.stringify(kids) !== JSON.stringify(expected)) {
          fail(`${c.name} @${viewport}`, `right column kids=${JSON.stringify(kids)} != ${JSON.stringify(expected)}`);
        }
      }
    }
  }

  // Counts-without-dollars via route intercept.
  console.log(`  --- counts-without-dollars intercept ---`);
  for (const viewport of [1680, 1366]) {
    const r = await auditCountsWithoutDollars(page, viewport);
    console.log(`  @${viewport}px  hero=${JSON.stringify(r.scAbsent?.heroText)}  pill=${JSON.stringify(r.scAbsent?.pillText)}  sub=${JSON.stringify(r.scAbsent?.subText)}  shot=${r.shot}`);
    if (!r.scAbsent?.heroText || !/^—/.test(r.scAbsent.heroText)) {
      fail(`counts-without-dollars @${viewport}`, `hero does not lead with em-dash: ${JSON.stringify(r.scAbsent?.heroText)}`);
    }
    if (!/Not yet reporting/i.test(r.scAbsent?.pillText || "")) {
      fail(`counts-without-dollars @${viewport}`, `pill missing "Not yet reporting": ${JSON.stringify(r.scAbsent?.pillText)}`);
    }
    if (!/service days/i.test(r.scAbsent?.subText || "")) {
      fail(`counts-without-dollars @${viewport}`, `sub-line missing "service days": ${JSON.stringify(r.scAbsent?.subText)}`);
    }
  }

  await browser.close();

  console.log("");
  console.log("## Column heights summary (Kevin's ruling asked for measurement only)");
  for (const v of [1680, 1366]) {
    console.log(`  @${v}px:`);
    for (const h of heights[v]) {
      console.log(`    ${h.name.padEnd(30)}  L=${String(h.left).padStart(4)}  R=${String(h.right).padStart(4)}  diff=${h.diff}`);
    }
  }
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: PacePanel gone, right column is Revenue lines then Also tracked, counts-without-dollars renders on Revenue card.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
