#!/usr/bin/env node
// scripts/probes/_probe_chart_dashes.mjs
//
// Kevin ruling cleanup (2026-09-03) item 1 (DEFECT). Permanent probe.
//
//   For every period, dash_position > bar_top iff budget < spend.
//   Bar colour agrees with the same comparison.
//   Chart legend shows only states present in the range.
//
// "dash_position > bar_top" (Kevin's screen-coord framing) = dash
// sits INSIDE the bar (visible below bar top). Since the dash is
// positioned at `bottom: (budget/spend) × 100%` of the bar height,
// the math version is: `dashBottomPct <= 100 iff budget <= spend`.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_chart_dashes.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { kind: "FYTD",    qs: "" },
  { kind: "P8",      qs: "start=2026-07-13&end=2026-08-09" },
  { kind: "P9 open", qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: {name:"T",email:"t@k.com",image:null}, expires: new Date(Date.now()+864e5).toISOString() }) });
  });
}

async function check(page, a, r) {
  const url = r.qs
    ? `${BASE}/kpi/overview?account=${acct(a)}&${r.qs}`
    : `${BASE}/kpi/overview?account=${acct(a)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(rr => rr.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const chart = document.querySelector('[data-kpi-ov="chart"]');
    if (!chart) return { bars: [], legend: [], present: false };
    const grain = chart.getAttribute('data-kpi-ov-grain');
    const bars = [...chart.querySelectorAll('.kpi-ov-bar')].map(b => {
      const val = Number(b.getAttribute('data-kpi-ov-bar-val'));
      const bud = Number(b.getAttribute('data-kpi-ov-bar-bud'));
      const state = b.getAttribute('data-kpi-ov-bar-state');
      const cls = b.className;
      const dash = b.querySelector('[data-kpi-ov="bar-budget-dash"]');
      const dashBottomStyle = dash ? dash.style.bottom : null;
      const dashBottomPct = dashBottomStyle ? parseFloat(dashBottomStyle.replace('%', '')) : null;
      return { val, bud, state, cls, dashBottomPct };
    });
    const legend = [...chart.querySelectorAll('.kpi-ov-legend span')].map(s => s.innerText.trim().toLowerCase());
    return { bars, legend, present: true, grain };
  });

  if (!info.present) return; // portfolio scopes or ranges w/o chart
  // Item 1's per-bar dash + legend assertion targets PERIOD grain
  // only. Week grain uses a flat weekly-budget line (kpi-ov-tgt),
  // covered by _probe_chart_scale.mjs.
  if (info.grain !== "period") return;

  // Per-bar assertion (item 1 IFF).
  for (const b of info.bars) {
    if (b.state === "in_progress" || b.state === "not_started") continue;
    if (b.val <= 0 || b.bud < 0) continue;
    const isOver = b.val > b.bud;
    const isUnder = !isOver; // val <= bud
    const dashInside = b.dashBottomPct != null && b.dashBottomPct <= 100;
    const dashAbove = b.dashBottomPct != null && b.dashBottomPct > 100;
    const hasOverCls = /kpi-ov-bar-over/.test(b.cls);
    const hasGoodCls = /kpi-ov-bar-good/.test(b.cls);
    // Kevin's IFF: dash inside iff over budget.
    if (isOver && !dashInside) {
      fail(`${a} ${r.kind}`, `over-budget bar (val=${b.val} > bud=${b.bud}) dashBottomPct=${b.dashBottomPct} should be <= 100`);
    }
    if (isUnder && !dashAbove) {
      fail(`${a} ${r.kind}`, `under-budget bar (val=${b.val} <= bud=${b.bud}) dashBottomPct=${b.dashBottomPct} should be > 100`);
    }
    // Colour must agree.
    if (isOver && !hasOverCls) {
      fail(`${a} ${r.kind}`, `over-budget bar missing kpi-ov-bar-over class · cls=${b.cls}`);
    }
    if (isUnder && !hasGoodCls) {
      fail(`${a} ${r.kind}`, `under-budget bar missing kpi-ov-bar-good class · cls=${b.cls}`);
    }
  }

  // Legend assertion (item 1 tail): entries reflect only the states
  // present in the range.
  const closedBars = info.bars.filter(b => b.state !== "in_progress" && b.state !== "not_started");
  const hasOver = closedBars.some(b => b.val > 0 && b.val > b.bud);
  const hasGood = closedBars.some(b => b.val > 0 && b.val <= b.bud);
  const hasRunning = info.bars.some(b => b.state === "in_progress");
  const legendHasOver = info.legend.some(l => /over budget/.test(l));
  const legendHasGood = info.legend.some(l => /under budget/.test(l));
  const legendHasRun = info.legend.some(l => /running/.test(l));
  if (hasOver !== legendHasOver) fail(`${a} ${r.kind}`, `legend "over budget" ${legendHasOver ? "shown" : "absent"} but chart ${hasOver ? "has" : "has no"} over-budget bars`);
  if (hasGood !== legendHasGood) fail(`${a} ${r.kind}`, `legend "under budget" ${legendHasGood ? "shown" : "absent"} but chart ${hasGood ? "has" : "has no"} under-budget bars`);
  if (hasRunning !== legendHasRun) fail(`${a} ${r.kind}`, `legend "running" ${legendHasRun ? "shown" : "absent"} but chart ${hasRunning ? "has" : "has no"} in-progress bars`);
}

async function main() {
  console.log(`# chart dashes + legend - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1400 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      await check(page, a, r);
      const after = FAILS.length;
      if (a === "TBJ - FL" || after !== before) {
        console.log(`  ${after === before ? "OK  " : "FAIL"} ${a.padEnd(16)} ${r.kind}`);
      }
    }
  }

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: dash position IFF + bar colour + legend-state coverage all hold.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
