#!/usr/bin/env node
// scripts/probes/_probe_cost_lines_row_hrefs.mjs
//
// PR-2 item 6 (Kevin, 2026-09-02): every cost row navigates,
// including billed-back and inactive ones. Labor (3100) →
// /kpi/labor; food, packaging, vehicle (3200/3400/3500) →
// /kpi/purchasing. Both carry account, start, end, preview if
// present.
//
// Acceptance test: 12 assertions - four rows on three account
// types (per-meal TBR - FL, pass-through CIN - OH, salaried-only
// CIN - KY), in preview and out of preview. Each row must
// produce the correct href with all four params preserved.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_cost_lines_row_hrefs.mjs

import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  { name: "TBR - FL (per-meal)",       account: "TBR - FL",  preview: null },
  { name: "CIN - OH (pass-through)",   account: "CIN - OH",  preview: null },
  { name: "CIN - KY (salaried-only)",  account: "CIN - KY",  preview: null },
  { name: "TBR - FL preview via CORP", account: "TBR - FL",  preview: "TBR - FL" },
];

const P8 = "start=2026-07-13&end=2026-08-09";
const EXPECT = {
  "3100": "/kpi/labor",
  "3200": "/kpi/purchasing",
  "3400": "/kpi/purchasing",
  "3500": "/kpi/purchasing",
};

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null }, expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function main() {
  console.log(`# cost-line row hrefs - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  cases=${CASES.length}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);

  let assertions = 0;
  for (const c of CASES) {
    const previewQs = c.preview ? `&preview=${acct(c.preview)}` : "";
    const url = `${BASE}/kpi/overview?account=${acct(c.account)}&${P8}${previewQs}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(()=>null);
    await page.waitForTimeout(1200);
    const rows = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-kpi-ov="cost-line-row"]');
      return Array.from(nodes).map(n => ({
        line_code: n.getAttribute("data-kpi-ov-line-code"),
        href: n.querySelector('[data-kpi-ov="cost-line-link"]')?.getAttribute("href") || null,
      }));
    });
    console.log(`  ${c.name}  rows=${rows.length}`);
    for (const line of ["3100", "3200", "3400", "3500"]) {
      const r = rows.find(x => x.line_code === line);
      assertions += 1;
      if (!r) { fail(`${c.name} ${line}`, "row missing"); continue; }
      if (!r.href) { fail(`${c.name} ${line}`, "no href"); continue; }
      const [path, qs] = r.href.split("?");
      const expected = EXPECT[line];
      if (path !== expected) fail(`${c.name} ${line}`, `path=${path} expected=${expected}`);
      const params = new URLSearchParams(qs || "");
      if (params.get("account") !== c.account) fail(`${c.name} ${line}`, `account=${params.get("account")} expected=${c.account}`);
      if (params.get("start") !== "2026-07-13") fail(`${c.name} ${line}`, `start=${params.get("start")} expected=2026-07-13`);
      if (params.get("end") !== "2026-08-09") fail(`${c.name} ${line}`, `end=${params.get("end")} expected=2026-08-09`);
      if (c.preview && params.get("preview") !== c.preview) {
        fail(`${c.name} ${line}`, `preview=${params.get("preview")} expected=${c.preview}`);
      }
      if (!c.preview && params.get("preview")) {
        fail(`${c.name} ${line}`, `preview=${params.get("preview")} expected null`);
      }
    }
  }

  await browser.close();

  console.log("");
  console.log(`  ${FAILS.length === 0 ? "OK" : "FAIL"} ${assertions} row-href assertions, ${FAILS.length} violations`);
  if (FAILS.length === 0) {
    console.log("");
    console.log(`Result: every cost-line row navigates with correct href on every case.`);
    process.exit(0);
  }
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
