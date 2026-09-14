#!/usr/bin/env node
// PR-A verification battery: /kpi/purchasing under ?preview= must
// render for both accounts and all four ranges. Guard 3 (Overview +
// Labor byte-identical) is a separate probe; this only proves 0.1
// no longer strands the page in the skeleton state.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const RANGES = [
  { key: "CY", label: "current year", qs: "&preset=fytd" },
  { key: "LP", label: "last period",  qs: "&preset=last_period" },
  { key: "CP", label: "current period", qs: "&preset=this_period" },
  { key: "NP", label: "next period",  qs: "" },
];
const NP_START = "2026-10-05";
const NP_END = "2026-11-01";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
});
const page = await context.newPage();

let fails = 0;
for (const account of ["TBJ - FL", "TBR - FL"]) {
  const enc = encodeURIComponent(account);
  for (const rng of RANGES) {
    for (const kind of ["account", "preview"]) {
      const qs = rng.key === "NP" ? `&start=${NP_START}&end=${NP_END}` : rng.qs;
      const url = `${BASE}/kpi/purchasing?${kind}=${enc}${qs}`;
      const errs = [];
      const consoleErrs = [];
      page.on("pageerror", (e) => errs.push(String(e.message || e)));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // strip baseline noise
        if (/sentry\.io|CORS|font at|net::ERR_FAILED|Failed to load resource: net::/i.test(t)) return;
        consoleErrs.push(t);
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const skeletons = await page.locator("[class*='skel']").count().catch(() => 0);
      const shell = await page.locator(".kpi-app").count().catch(() => 0);
      const board = await page.locator(".kpi-p-board").count().catch(() => 0);
      const hasReact = errs.some(e => /error #\d+|Minified React|hydrat/i.test(e))
        || consoleErrs.some(e => /error #\d+|Minified React|hydrat/i.test(e));
      const ok = skeletons === 0 && shell > 0 && !hasReact && errs.length === 0 && consoleErrs.length === 0;
      const tag = ok ? "PASS" : "FAIL";
      if (!ok) fails++;
      console.log(`${tag} ${account.padEnd(10)} ${rng.label.padEnd(15)} ${kind.padEnd(7)} skel=${String(skeletons).padStart(3)} shell=${shell} board=${board} pageerr=${errs.length} conerr=${consoleErrs.length}${hasReact ? " REACT_ERR" : ""}`);
      for (const e of errs.slice(0, 2)) console.log(`     pageerror: ${e.slice(0, 200)}`);
      for (const e of consoleErrs.slice(0, 2)) console.log(`     console.error: ${e.slice(0, 200)}`);
      page.removeAllListeners("pageerror");
      page.removeAllListeners("console");
    }
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
