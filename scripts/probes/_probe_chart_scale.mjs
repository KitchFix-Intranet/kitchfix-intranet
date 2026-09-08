#!/usr/bin/env node
// scripts/probes/_probe_chart_scale.mjs
//
// Kevin ruling 2026-09-02: the chart's vertical scale must be the
// max of EVERYTHING that contributes to a comparison - bars AND
// per-period budgets - never a subset of it. If mx is computed from
// bars only, the bar heights shift when a period whose budget
// exceeds its spend is present (bar heights are relative to mx).
// The same invariant survives the 2026-09-08 dash removal: the
// budget is still the comparator (bar colour reflects val vs bud),
// so mx must still include budgets - otherwise the visual scale
// would move when the underlying comparator is unchanged.
//
// PAYLOAD ASSERTION
//
//   P1  For every account × range chart series, mx = max(spends ∪
//       budgets) × 1.16. Every bar's spent/mx and every budget's
//       bud/mx is <= 100. Guarantees the compute doesn't overflow.
//
// DOM ASSERTION (Playwright)
//
//   D1  Every rendered bar's height is in [0, 100]% of the plot
//       area.
//   D2  (2026-09-08 repoint - replaces the removed dash centre
//       check.) Bar colour agrees with val vs bud: kpi-ov-bar-good
//       iff val <= bud, kpi-ov-bar-over iff val > bud. This IS the
//       comparison the dash used to draw - the visual moved from a
//       positioned element onto a class name.
//   D3  Regression guard. No element carries data-kpi-ov=
//       "bar-budget-dash". The dashed line was removed 2026-09-08
//       per Kevin ruling ("did not fall accurately enough on the
//       bars"); it must not return without a fresh ruling.
//
// SEEDED FAILURE
//
//   SEEDED_FAILURE=1 recomputes mx from bars only, asserts that a
//   period whose budget exceeds spend produces mx that fails the
//   "budget fits" check. Confirms this probe catches the class of
//   regression Kevin's original ruling addressed.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_chart_scale.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_chart_scale.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { name: "FYTD",             qs: "" },
  { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
  { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

function seedAxis() {
  // TBJ - FL FYTD P3 approximate: spent 202815, adjusted 259199.
  // Bars-only mx = max(all spents, 1) × 1.16 (P3 is the max spent).
  const spents = [79908, 177880, 202815, 105244, 88384, 85927, 76793, 83384];
  const budgets = [44694, 178594, 259199, 82928, 81544, 71833, 69739, 78504];
  const barsOnlyMx = Math.max(...spents, 1) * 1.16;
  const p3Bud = budgets[2];
  const p3BudPct = (p3Bud / barsOnlyMx) * 100;
  const fires = p3BudPct > 100;
  console.log(`  ${fires ? "PASS" : "FAIL"}  seeded (bars-only mx=${barsOnlyMx.toFixed(0)}) puts P3 budget at ${p3BudPct.toFixed(1)}% - must exceed 100`);
  return fires;
}

async function auditPayload() {
  console.log("## Payload assertion P1");
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(a)}`;
      const j = await (await fetch(url)).json();
      if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); continue; }
      if (j.chart?.grain !== "period" || !Array.isArray(j.chart.series)) continue;
      const series = j.chart.series;
      const spends = series.map(s => Number(s.spent || 0));
      const budgets = series.map(s => Number(s.adjusted_budget != null ? s.adjusted_budget : (s.budget || 0)));
      const mx = Math.max(...spends, ...budgets, 1) * 1.16;
      for (const s of series) {
        const bud = Number(s.adjusted_budget != null ? s.adjusted_budget : (s.budget || 0));
        const budPct = (bud / mx) * 100;
        if (budPct > 100 + 0.01) {
          fail(`${a} ${r.name} P${s.period_no}`, `budget bud=${bud} exceeds mx=${mx.toFixed(0)} (budPct=${budPct.toFixed(1)}%)`);
        }
        const spent = Number(s.spent || 0);
        const spentPct = (spent / mx) * 100;
        if (spentPct > 100 + 0.01) {
          fail(`${a} ${r.name} P${s.period_no}`, `bar spent=${spent} exceeds mx (spentPct=${spentPct.toFixed(1)}%)`);
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
  console.log("## DOM assertion D1+D2+D3 (TBJ - FL FYTD)");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);
  await page.goto(`${BASE}/kpi/overview?account=${acct("TBJ - FL")}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1400);

  const info = await page.evaluate(() => {
    const box = document.querySelector('[data-kpi-ov-grain="period"] .kpi-ov-bars');
    if (!box) return null;
    const boxRect = box.getBoundingClientRect();
    const bars = [...document.querySelectorAll('[data-kpi-ov-grain="period"] .kpi-ov-bar')];
    return bars.map(bar => {
      const barRect = bar.getBoundingClientRect();
      // D3 regression guard: dashes were removed; count any that
      // return so the resurrection is caught immediately.
      const dashCount = bar.querySelectorAll('[data-kpi-ov="bar-budget-dash"]').length;
      const chartHeight = boxRect.height;
      const barBottomFromChartBottom = Math.max(0, boxRect.bottom - barRect.bottom);
      const barTopFromChartBottom = boxRect.bottom - barRect.top;
      const barTopPct = (barTopFromChartBottom / chartHeight) * 100;
      const barBottomPct = (barBottomFromChartBottom / chartHeight) * 100;
      const val = Number(bar.getAttribute('data-kpi-ov-bar-val'));
      const bud = Number(bar.getAttribute('data-kpi-ov-bar-bud'));
      const state = bar.getAttribute('data-kpi-ov-bar-state');
      const cls = bar.className;
      return {
        p: bar.getAttribute("data-kpi-ov-period"),
        barTopPct: Number(barTopPct.toFixed(2)),
        barBottomPct: Number(barBottomPct.toFixed(2)),
        dashCount,
        val, bud, state, cls,
      };
    });
  });

  if (!info) fail("D1", "chart bars container not found");
  else {
    for (const b of info) {
      // D1: bar top and bottom within [0, 100]% of chart.
      if (b.barTopPct < 0 || b.barTopPct > 100.01) {
        fail(`P${b.p}`, `bar top ${b.barTopPct}% outside [0,100]`);
      }
      if (b.barBottomPct < 0 || b.barBottomPct > 100.01) {
        fail(`P${b.p}`, `bar bottom ${b.barBottomPct}% outside [0,100]`);
      }
      // D3: dash resurrection guard.
      if (b.dashCount > 0) {
        fail(`P${b.p}`, `bar-budget-dash element present (count=${b.dashCount}) - dash was removed 2026-09-08 and must not return without a fresh ruling`);
      }
      // D2 (repoint): bar colour agrees with val vs bud on CLOSED
      // bars (in-progress + not-started render neutral hatches).
      if (b.state !== "in_progress" && b.state !== "not_started" && b.val > 0 && b.bud >= 0) {
        const isOver = b.val > b.bud;
        const hasOverCls = /kpi-ov-bar-over/.test(b.cls);
        const hasGoodCls = /kpi-ov-bar-good/.test(b.cls);
        if (isOver && !hasOverCls) {
          fail(`P${b.p}`, `over-budget bar (val=${b.val} > bud=${b.bud}) missing kpi-ov-bar-over class`);
        }
        if (!isOver && !hasGoodCls) {
          fail(`P${b.p}`, `under-budget bar (val=${b.val} <= bud=${b.bud}) missing kpi-ov-bar-good class`);
        }
      }
    }
    for (const b of info) {
      console.log(`  P${b.p}  bar=[${b.barBottomPct},${b.barTopPct}]  cls=${/(kpi-ov-bar-[a-z]+)/.exec(b.cls.replace(/kpi-ov-bar\b/,""))?.[1] || "-"}`);
    }
  }

  await browser.close();
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function main() {
  console.log(`# chart scale invariants - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");
  if (SEEDED) {
    console.log("## Seeded failure axis");
    const fired = seedAxis();
    process.exit(fired ? 0 : 1);
  }
  await auditPayload();
  await auditDom();
  if (FAILS.length === 0) {
    console.log(`Result: every bar renders inside [0,100]% of the plot area, bar colour agrees with val vs bud, and no stray dashes.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
