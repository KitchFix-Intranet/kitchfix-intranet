#!/usr/bin/env node
// scripts/probes/_probe_overview_screenshots.mjs
//
// Kevin ruling 2026-09-03 Item 4 screenshot pass: capture the
// Overview at 1680, 1456, and 1366 to let Kevin judge legibility
// after the padding + min-width fix.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_overview_screenshots.mjs

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);
const OUT = "/tmp/kpi-overview-headers-2026-09-03";
fs.mkdirSync(OUT, { recursive: true });

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

const CASES = [
  { name: "TBJ - FL FYTD",     account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P9 open",  account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBR - FL FYTD",     account: "TBR - FL", qs: "" },
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockAuth(page);
  for (const w of [1680, 1456, 1366]) {
    await page.setViewportSize({ width: w, height: 1050 });
    for (const c of CASES) {
      const url = c.qs
        ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
        : `${BASE}/kpi/overview?account=${acct(c.account)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(1000);
      const slug = c.name.replace(/[^A-Za-z0-9]+/g, "-");
      const shot = `${OUT}/${slug}-${w}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      console.log(`  ${w}px  ${c.name}  ${shot}`);
    }
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
