#!/usr/bin/env node
// scripts/probes/_probe_simplified_layout.mjs
//
// Kevin ruling 2026-09-03 (simplified-layout PR). Standing probe for
// the second-whiteboard directives:
//
//   Column swap    Revenue + Also tracked on LEFT (5fr); Cost of goods
//                  on RIGHT (7fr).
//   Cost table     Columns Line · Budget* · Actual · % of rev · Target %.
//                  No `vs target` column. Footnote below the table.
//   Total row      Dollar gap beneath the actual (one cell added back).
//   Chart          Bottom of the board, fold, collapsed by default.
//   P&L            Fold, collapsed by default (already the case).
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_simplified_layout.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  { name: "TBJ - FL FYTD", account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P8",   account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBJ - FL P9",   account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "CIN - OH FYTD", account: "CIN - OH", qs: "" },
  { name: "CIN - KY FYTD", account: "CIN - KY", qs: "" },
];

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: {name:"T",email:"t@k.com",image:null}, expires: new Date(Date.now()+864e5).toISOString() }) });
  });
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function inspect(page, c) {
  const url = c.qs
    ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/kpi/overview?account=${acct(c.account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    // Column swap: left carries Revenue+Also tracked; right carries Cost lines.
    const split = document.querySelector('[data-kpi-ov="single-account-split"]');
    const left = split?.querySelector('.kpi-ov-split-left');
    const right = split?.querySelector('.kpi-ov-split-right');
    const leftKeys = left ? [...left.querySelectorAll('[data-kpi-ov]')]
      .map(e => e.getAttribute('data-kpi-ov'))
      .filter(k => ["revenue-lines", "revenue-lines-table", "also-tracked", "cost-lines", "cost-lines-table", "chart"].includes(k)) : [];
    const rightKeys = right ? [...right.querySelectorAll('[data-kpi-ov]')]
      .map(e => e.getAttribute('data-kpi-ov'))
      .filter(k => ["revenue-lines", "revenue-lines-table", "also-tracked", "cost-lines", "cost-lines-table", "chart"].includes(k)) : [];
    const cols = split ? getComputedStyle(split).gridTemplateColumns : null;

    // Cost table headers + footnote presence.
    const clTable = document.querySelector('[data-kpi-ov="cost-lines-table"]');
    const clHeaders = clTable ? [...clTable.querySelectorAll("thead th")].map(t => t.innerText.trim()) : [];
    const footnote = document.querySelector('[data-kpi-ov="cost-lines-footnote"]')?.innerText.trim() || null;

    // Total row: dollar gap beneath the actual.
    const totalRow = document.querySelector('[data-kpi-ov="cost-lines-total"]');
    const totalActualCell = totalRow?.querySelector('[data-kpi-ov="cost-lines-total-actual"]');
    const totalGap = totalRow?.querySelector('[data-kpi-ov="cost-lines-total-gap"]')?.innerText.trim() || null;
    const totalActualHTML = totalActualCell?.innerText.trim() || null;

    // Chart fold present + collapsed by default.
    const chartFold = document.querySelector('[data-kpi-ov="chart-fold"]');
    const chartOpen = chartFold?.getAttribute('data-kpi-ov-open');
    const chartTrigger = document.querySelector('[data-kpi-ov="fold-chart"]');
    const chartTriggerExpanded = chartTrigger?.getAttribute('aria-expanded');
    // Fold body: only rendered when open. Assert absent by default.
    const chartBarsWhileCollapsed = !!document.querySelector('[data-kpi-ov="chart-fold"] [data-kpi-ov-grain]');

    // P&L fold collapsed by default too.
    const pnlCard = document.querySelector('[data-kpi-ov="statement"]');
    const pnlOpen = pnlCard?.getAttribute('data-kpi-ov-open');

    // Chart is beneath P&L (in DOM order).
    const chartIndex = chartFold ? [...document.body.querySelectorAll('*')].indexOf(chartFold) : -1;
    const pnlIndex = pnlCard ? [...document.body.querySelectorAll('*')].indexOf(pnlCard) : -1;

    return {
      leftKeys, rightKeys, cols,
      clHeaders, footnote,
      totalActualHTML, totalGap,
      chartOpen, chartTriggerExpanded, chartBarsWhileCollapsed,
      pnlOpen,
      chartAfterPnl: (chartIndex >= 0 && pnlIndex >= 0) ? (chartIndex > pnlIndex) : null,
    };
  });

  return info;
}

async function main() {
  console.log(`# simplified-layout - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1200 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const c of CASES) {
    const before = FAILS.length;
    const info = await inspect(page, c);

    // Column swap
    const leftHasRevenue = info.leftKeys.some(k => k === "revenue-lines-table" || k === "revenue-lines");
    const leftHasCost = info.leftKeys.includes("cost-lines-table") || info.leftKeys.includes("cost-lines");
    const rightHasCost = info.rightKeys.includes("cost-lines-table") || info.rightKeys.includes("cost-lines");
    const rightHasRevenue = info.rightKeys.some(k => k === "revenue-lines-table" || k === "revenue-lines");
    if (!leftHasRevenue) fail(c.name, `left column missing Revenue lines · leftKeys=${JSON.stringify(info.leftKeys)}`);
    if (leftHasCost) fail(c.name, `left column should NOT carry Cost lines · leftKeys=${JSON.stringify(info.leftKeys)}`);
    if (!rightHasCost) fail(c.name, `right column missing Cost lines · rightKeys=${JSON.stringify(info.rightKeys)}`);
    if (rightHasRevenue) fail(c.name, `right column should NOT carry Revenue lines · rightKeys=${JSON.stringify(info.rightKeys)}`);
    // grid-template-columns 5fr / 7fr: after resolution, right col > left col.
    if (info.cols) {
      const parts = info.cols.split(/\s+/).map(x => parseFloat(x));
      if (parts.length === 2 && parts[1] <= parts[0]) {
        fail(c.name, `column widths not 5fr/7fr · got ${info.cols} (left=${parts[0]}px, right=${parts[1]}px)`);
      }
    }

    // Cost table headers - Kevin ruling final-presentation (2026-09-03):
    // Plan / Actual band adds a group header row above the sub-header;
    // Target % moves INTO the plan half; "Actual" sub-header becomes
    // "Spent" to avoid the ACTUAL / ACTUAL stack. Sub-header is now:
    //   [Line, Budget*, Target %, Spent, % of rev]
    const wantSubHeaders = ["LINE", "BUDGET*", "TARGET %", "SPENT", "% OF REV"];
    // The probe's clHeaders returns ALL thead ths (group + sub).
    // Extract just the sub-header row: skip the first 3 cells which
    // are the group header (empty + Plan + Actual).
    const gotHeaders = info.clHeaders.map(h => h.toUpperCase());
    // The group header row has 3 th (empty, PLAN, ACTUAL). Sub-header
    // has 5 th (Line, Budget*, Target %, Spent, % of rev).
    const groupCells = gotHeaders.slice(0, 3);
    const subCells = gotHeaders.slice(3);
    if (JSON.stringify(groupCells) !== JSON.stringify(["", "PLAN", "ACTUAL"])) {
      fail(c.name, `cost-lines group header = ${JSON.stringify(groupCells)}, want ["", "PLAN", "ACTUAL"]`);
    }
    if (JSON.stringify(subCells) !== JSON.stringify(wantSubHeaders)) {
      fail(c.name, `cost-lines sub-headers = ${JSON.stringify(subCells)}, want ${JSON.stringify(wantSubHeaders)}`);
    }
    // Footnote present
    if (!info.footnote || !/adjusted/i.test(info.footnote) || !/target percent buys/i.test(info.footnote)) {
      fail(c.name, `cost-lines footnote missing / malformed: ${JSON.stringify(info.footnote)}`);
    }

    // Total row: gap present + reads "$X over/under".
    // On MF (CIN - OH) hasTarget can be true for cost card even though
    // the drill is billed-back. The total row gap only renders when
    // hasTarget && totalBatr; CIN - OH has_target on FYTD, so gap shows.
    // Skip the gap assertion when totalActualHTML is empty (all rows
    // billed back and no scored total).
    if (info.totalActualHTML && info.totalActualHTML.length > 0) {
      // Gap is conditionally present when hasTarget && varianceText;
      // assert it CAN carry the pattern when present.
      if (info.totalGap && !/\$[\d,]+ (over|under)/.test(info.totalGap)) {
        fail(c.name, `total-row gap malformed: ${JSON.stringify(info.totalGap)}`);
      }
    }

    // Kevin ruling final-presentation (2026-09-03) item 4: chart is
    // no longer a fold - it moves back into the right column below
    // cost of goods, always open. `_probe_final_presentation.mjs`
    // asserts chart-not-fold + chart-in-right; skip those here.

    // P&L fold collapsed by default (the only remaining fold).
    if (info.pnlOpen !== "0") fail(c.name, `P&L fold not collapsed by default · data-kpi-ov-open=${JSON.stringify(info.pnlOpen)}`);

    const after = FAILS.length;
    console.log(`  ${after === before ? "OK  " : "FAIL"} ${c.name.padEnd(16)} cols=${info.cols} pnlFold=${info.pnlOpen}`);
  }

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: simplified-layout acceptance holds on all cases.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
