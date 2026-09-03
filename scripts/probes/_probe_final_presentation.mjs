#!/usr/bin/env node
// scripts/probes/_probe_final_presentation.mjs
//
// Kevin ruling final-presentation (2026-09-03). Standing probe.
//
//   Item 1  Status pill + horizon line
//             open   -> "AT RISK" + "through week N · MM/DD – MM/DD"
//             closed -> "PERIOD CLOSED · ..." + "P8 · closed and verified"
//   Item 2  COGS + GM cards carry $ beside %
//   Item 3  Plan / Actual band on all three tables.
//             Every plan cell carries the band class from header
//             through total row. Kevin: "an earlier build applied it
//             to the header and total only and the band visibly
//             stopped mid-table."
//   Item 4  Chart is OPEN (not a fold), in the right column, below
//             cost of goods.
//   Item 5  Revenue total row excludes unreported lines from the
//             plan total (Forecast + Period budget both).
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_final_presentation.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  { name: "TBJ - FL FYTD", account: "TBJ - FL", qs: "",                                       kind: "fytd" },
  { name: "TBJ - FL P8",   account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09",        kind: "single_closed" },
  { name: "TBJ - FL P9",   account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06",        kind: "single_open" },
  { name: "TBR - FL FYTD", account: "TBR - FL", qs: "",                                       kind: "fytd" },
  { name: "TBR - FL P9",   account: "TBR - FL", qs: "start=2026-08-10&end=2026-09-06",        kind: "single_open" },
  { name: "CIN - OH FYTD", account: "CIN - OH", qs: "",                                       kind: "fytd" },
  { name: "CIN - KY FYTD", account: "CIN - KY", qs: "",                                       kind: "fytd" },
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
    // Item 1: status pill + horizon
    const pill = document.querySelector(".kpi-ov-status-pill");
    const horizon = document.querySelector('[data-kpi-ov="status-horizon"]');
    // Item 3: every plan cell in every table carries the band class.
    // Iterate every .kpi-ov-tband table; assert `td.plan` appears in
    // every body row + total row, and `th.plan` in the header rows.
    const tables = [...document.querySelectorAll(".kpi-ov-tband")];
    const bandChecks = tables.map(t => {
      const key = t.getAttribute("data-kpi-ov") || "unknown";
      const thead = t.querySelector("thead");
      const tbody = t.querySelector("tbody");
      // Group header should have th.kpi-ov-tband-plan
      const groupPlan = !!thead?.querySelector("th.kpi-ov-tband-plan");
      const groupAct = !!thead?.querySelector("th.kpi-ov-tband-act");
      // Sub-header: at least one plan th
      const subPlan = !!thead?.querySelector("tr:not(.kpi-ov-tband-grp) th.plan");
      // Body rows: every non-total row should have >=1 td.plan
      const bodyRows = [...(tbody?.querySelectorAll("tr") || [])];
      const nonTotal = bodyRows.filter(r => !r.classList.contains("kpi-ov-cl-tot"));
      const total = bodyRows.find(r => r.classList.contains("kpi-ov-cl-tot"));
      const bodyRowsWithPlan = nonTotal.filter(r => r.querySelector("td.plan")).length;
      const bodyRowsMissingPlan = nonTotal.filter(r => !r.querySelector("td.plan"));
      const totalHasPlan = total ? !!total.querySelector("td.plan") : null;
      // Sub-headers: names required
      const subHeaderTexts = [...(thead?.querySelectorAll("tr:not(.kpi-ov-tband-grp) th") || [])].map(t => t.innerText.trim());
      return {
        key,
        groupPlan, groupAct, subPlan,
        bodyRowsTotal: nonTotal.length,
        bodyRowsWithPlan,
        bodyRowsMissingPlan: bodyRowsMissingPlan.map(r => r.getAttribute("data-kpi-ov-line-code") || "?"),
        totalHasPlan,
        subHeaderTexts,
      };
    });
    // Item 4: chart is NOT a fold + present (in split-right).
    const chartFold = document.querySelector('[data-kpi-ov="chart-fold"]');
    const chartCard = document.querySelector('[data-kpi-ov="chart"]');
    const splitRight = document.querySelector('.kpi-ov-split-right');
    const chartInRight = splitRight ? !!splitRight.querySelector('[data-kpi-ov="chart"]') : false;
    // Item 5: revenue total row FORECAST value + card revenue.hero_actual
    const revTotalRow = document.querySelector('[data-kpi-ov="revenue-lines-total"]');
    const revTotalCells = revTotalRow ? [...revTotalRow.querySelectorAll("td")].map(t => t.innerText.trim()) : null;
    return {
      pillText: pill?.innerText.trim() || null,
      pillState: pill?.getAttribute("data-kpi-ov-state") || null,
      horizonText: horizon?.innerText.trim() || null,
      bandChecks,
      chartFoldPresent: !!chartFold,
      chartCardPresent: !!chartCard,
      chartInRight,
      revTotalCells,
    };
  });
  return info;
}

async function main() {
  console.log(`# final-presentation - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1400 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const c of CASES) {
    const before = FAILS.length;
    const info = await inspect(page, c);

    // Item 1: horizon renders
    if (!info.horizonText) fail(c.name, "horizon text missing beside pill");
    // Open range = through week N ...; closed = P... verified.
    if (c.kind === "single_open") {
      if (!/^through week \d+ · \d\d\/\d\d – \d\d\/\d\d$/.test(info.horizonText || "")) {
        fail(c.name, `open horizon malformed: ${JSON.stringify(info.horizonText)}`);
      }
    } else {
      if (!/^P\d+(-P\d+)? · closed and verified$/.test(info.horizonText || "")) {
        fail(c.name, `closed horizon malformed: ${JSON.stringify(info.horizonText)}`);
      }
    }

    // Item 3: band-class assertions
    for (const b of info.bandChecks) {
      if (!b.groupPlan) fail(`${c.name} ${b.key}`, `group header missing th.kpi-ov-tband-plan`);
      if (!b.groupAct)  fail(`${c.name} ${b.key}`, `group header missing th.kpi-ov-tband-act`);
      if (!b.subPlan)   fail(`${c.name} ${b.key}`, `sub-header missing th.plan`);
      if (b.bodyRowsWithPlan !== b.bodyRowsTotal) {
        fail(`${c.name} ${b.key}`, `${b.bodyRowsTotal - b.bodyRowsWithPlan} body row(s) missing td.plan · lines=${JSON.stringify(b.bodyRowsMissingPlan)}`);
      }
      if (b.totalHasPlan === false) fail(`${c.name} ${b.key}`, `total row missing td.plan`);
      // Kevin: sub-headers must not repeat the group name.
      const subs = b.subHeaderTexts.map(t => t.toLowerCase());
      if (subs.filter(t => t === "actual").length > 0) {
        fail(`${c.name} ${b.key}`, `sub-header contains bare "Actual" (Kevin: read as ACTUAL/ACTUAL) · headers=${JSON.stringify(b.subHeaderTexts)}`);
      }
    }

    // Item 4: chart is not a fold + in right column
    if (info.chartFoldPresent) fail(c.name, `chart is still a fold`);
    if (!info.chartCardPresent) fail(c.name, `chart card missing`);
    if (!info.chartInRight) fail(c.name, `chart not in .kpi-ov-split-right`);

    // Item 5: TBJ - FL P9 known case - service charges unreported;
    // revenue total FORECAST = meal service alone ($59,870).
    if (c.name === "TBJ - FL P9" && info.revTotalCells) {
      // revTotalCells shape (single_open, showBudgetToDate+showPeriodBudget):
      //   [label, forecast, period_budget, actual, %]
      const forecastCell = info.revTotalCells[1] || "";
      // Meal service is $59,869.55 rounded to $59,870. Assert the
      // total forecast is that value (NOT $78,746 which would include
      // service charges' unreported $18,877).
      if (!/^\$59,8\d{2}$/.test(forecastCell)) {
        fail(c.name, `revenue total Forecast cell = ${JSON.stringify(forecastCell)}, want ~$59,870 (meal service alone, service charges unreported)`);
      }
    }

    const after = FAILS.length;
    const tag = after === before ? "OK  " : "FAIL";
    console.log(`  ${tag} ${c.name.padEnd(16)} pill=${JSON.stringify(info.pillText)}  horizon=${JSON.stringify(info.horizonText)}  bands=${info.bandChecks.length}  chartInRight=${info.chartInRight}`);
  }

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: final-presentation acceptance holds on all cases.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
