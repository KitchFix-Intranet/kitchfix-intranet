#!/usr/bin/env node
// scripts/probes/_probe_closed_period_wording.mjs
//
// Kevin PR-B (2026-09-03):
//
//   `thru P#` implies partway. On a period that has closed, every
//   surface should read `Final P#` (or `in P#` where a preposition
//   fits). FYTD + open ranges keep `thru`. Status pill on closed
//   reads `Period closed · on target / off target`.
//
// ASSERTIONS
//
//   W1  range_labels shape on single_closed:
//         through == "in P{N}", actuals == "Final P{N}"
//       on FYTD:
//         through == actuals == "thru P{N}"
//       on single_open:
//         through == actuals == "period to date"
//   W2  On single_closed and FYTD (both closed) status_line.state_
//       copy starts with "Period closed" (with has_target).
//   W3  No `thru P#` string renders on any single_closed range's DOM.
//   W4  On single_closed, revenue card hero descriptor reads
//       "Final P{N}" AND COGS heroline reads "of revenue in P{N}".
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_closed_period_wording.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "TBJ - FL", "TBR - FL", "CIN - OH", "STL - MO", "CIN - KY",
];
const RANGES = [
  { name: "FYTD", qs: "", kind: "fytd" },
  { name: "P8 (verified)", qs: "start=2026-07-13&end=2026-08-09", kind: "single_closed" },
  { name: "P9 (open)", qs: "start=2026-08-10&end=2026-09-06", kind: "single_open" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function jget(url) { return (await fetch(url)).json(); }

async function auditPayload() {
  console.log("## Payload assertions W1+W2");
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(a)}`;
      const j = await jget(url);
      if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); continue; }
      const rl = j.range_labels;
      if (rl?.kind !== r.kind) {
        fail(`${a} ${r.name}`, `range_labels.kind=${rl?.kind} != ${r.kind}`);
      }
      // W1: shape check
      if (r.kind === "single_closed") {
        if (!/^in P\d+$/.test(rl?.through)) fail(`${a} ${r.name}`, `through=${JSON.stringify(rl?.through)}, want /^in P\\d+$/`);
        if (!/^Final P\d+$/.test(rl?.actuals)) fail(`${a} ${r.name}`, `actuals=${JSON.stringify(rl?.actuals)}, want /^Final P\\d+$/`);
      }
      if (r.kind === "fytd") {
        if (!/^thru P\d+$/.test(rl?.through)) fail(`${a} ${r.name}`, `through=${JSON.stringify(rl?.through)}, want /^thru P\\d+$/`);
        if (rl?.actuals !== rl?.through) fail(`${a} ${r.name}`, `actuals != through on FYTD`);
      }
      if (r.kind === "single_open") {
        if (rl?.through !== "period to date") fail(`${a} ${r.name}`, `through=${JSON.stringify(rl?.through)}, want "period to date"`);
        if (rl?.actuals !== "period to date") fail(`${a} ${r.name}`, `actuals=${JSON.stringify(rl?.actuals)}, want "period to date"`);
      }
      // W2: closed status pill
      if (r.kind === "single_closed" && j.has_target) {
        const sc = j.status_line?.state_copy || "";
        if (!/^Period closed/.test(sc)) {
          fail(`${a} ${r.name}`, `status_line.state_copy=${JSON.stringify(sc)} - want /^Period closed/`);
        }
      }
    }
  }
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function auditDom() {
  console.log("## DOM assertions W3+W4 (TBJ - FL P8 verified)");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);
  const url = `${BASE}/kpi/overview?account=${acct("TBJ - FL")}&start=2026-07-13&end=2026-08-09`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);
  // W3: no "thru P#" anywhere on the page
  const bodyText = await page.evaluate(() => document.body.innerText);
  const thruMatches = [...bodyText.matchAll(/thru P\d+/gi)];
  if (thruMatches.length > 0) {
    fail("W3", `${thruMatches.length} 'thru P#' strings on single_closed DOM: ${thruMatches.slice(0, 5).map(m => m[0]).join(", ")}`);
  }
  // W4: Kevin ruling 2026-09-03 (top-simplify) item 4. Horizon
  // moved from the hero small / heroline descriptor onto the ROW
  // LABELS. Closed range -> "Actual" and "Budget" on Revenue,
  // "Actual" / "Target" on COGS. Open range -> "Actual to date" /
  // "Budget to date" / "Target".
  const info = await page.evaluate(() => {
    const revCard = document.querySelector('[data-kpi-ov="card-revenue"]');
    const revActualK = revCard?.querySelector('[data-kpi-ov="card-actual"] .kpi-ov-pair-k')?.innerText.trim() || null;
    const revRefK = revCard?.querySelector('[data-kpi-ov="card-reference"] .kpi-ov-pair-k')?.innerText.trim() || null;
    const cogsCard = document.querySelector('[data-kpi-ov="card-cogs"]');
    const cogsActualK = cogsCard?.querySelector('[data-kpi-ov="card-actual"] .kpi-ov-pair-k')?.innerText.trim() || null;
    const cogsRefK = cogsCard?.querySelector('[data-kpi-ov="card-reference"] .kpi-ov-pair-k')?.innerText.trim() || null;
    return { revActualK, revRefK, cogsActualK, cogsRefK };
  });
  console.log(`  Revenue rows: ${JSON.stringify(info.revActualK)} / ${JSON.stringify(info.revRefK)}`);
  console.log(`  COGS rows:    ${JSON.stringify(info.cogsActualK)} / ${JSON.stringify(info.cogsRefK)}`);
  // On P8 (closed): row labels must be the plain forms.
  if (info.revActualK !== "Actual")    fail("W4", `Revenue actual label = ${JSON.stringify(info.revActualK)}, want "Actual"`);
  if (info.revRefK    !== "Budget")    fail("W4", `Revenue reference label = ${JSON.stringify(info.revRefK)}, want "Budget"`);
  if (info.cogsActualK !== "Actual")   fail("W4", `COGS actual label = ${JSON.stringify(info.cogsActualK)}, want "Actual"`);
  if (info.cogsRefK    !== "Target")   fail("W4", `COGS reference label = ${JSON.stringify(info.cogsRefK)}, want "Target"`);
  await browser.close();
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function main() {
  console.log(`# closed-period wording - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  await auditPayload();
  await auditDom();
  if (FAILS.length === 0) {
    console.log(`Result: closed-period wording holds across accounts + surfaces.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
