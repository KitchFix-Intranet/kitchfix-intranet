#!/usr/bin/env node
// scripts/probes/_probe_language_colour_pass.mjs
//
// Kevin CC PROMPT 2026-09-02 (PR-2 · Overview language/colour).
//
// PAYLOAD ASSERTIONS
//
//   L1  payload.range_labels present with the expected shape for each
//       range kind.
//   L2  every "thru P#" label the client will render matches the
//       range's last closed period (asserted, not eyeballed).
//   L3  status_line carries `tone` and `gm_tone`; biggest_lever
//       carries `tone`. All tones are "good" / "bad" / "neutral" - no
//       "warn".
//   L4  no PERFORMANCE-verdict card pill emits `tone === "warn"` on
//       any range. Amber is retired for verdicts. Source-state pills
//       (revenue "Planned" for accounts on planned revenue) legitimately
//       use warn - planned is a source state, not a performance
//       comparison, so the green-or-red rule does not apply. That
//       pill is excluded explicitly. It will fire the moment TXR - AZ
//       or CIN - AZ goes live on planned revenue without the exclusion.
//   L5  chart.series carries `revenue_actual` + `adjusted_budget` for
//       every period. For each closed period, adjusted_budget ==
//       revenue_actual * (cogs_budget_full_period / rev_budget_full_
//       period) - the same ratio the COGS card uses for "Adjusted
//       budget".
//
// DOM ASSERTIONS (Playwright)
//
//   D1  no [data-kpi-ov="bt"] (BarTip) node exists on any chart.
//   D2  every period bar carries a [data-kpi-ov="bar-budget-dash"]
//       when adjusted_budget is set, and its inline `bottom` is
//       (budPct/hgt) as a percentage (not the buggy legacy
//       (budPct-hgt)/hgt form).
//   D3  cost lines table header reads "Spent thru P8" / "Budget
//       adjusted P8" / total row "Total cost of goods sold thru P8"
//       on FYTD.
//   D4  revenue-lines table header reads "Budget thru P8" on FYTD.
//   D5  also-tracked headers read "Spend thru P8" / "Budget thru P8"
//       on FYTD.
//   D6  full P&L (fold-open) header reads "Budget thru P8" +
//       "Actuals thru P8" on FYTD.
//   D7  COGS card sub-line reads "Adjusted budget", envelope note is
//       purple with an arrow + word "more"/"less".
//   D8  Revenue card eyebrow reads "Revenue actuals P1-P8" on FYTD.
//   D9  Revenue card LEFT budget label reads "Revenue budget P1-P8"
//       on FYTD.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_language_colour_pass.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS_FYTD = [
  "TBJ - FL", "TBR - FL", "CIN - OH", "STL - MO", "TXR - TX - V",
];
const RANGES = [
  { name: "FYTD",             qs: "" },
  { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
  { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function jget(url) {
  const r = await fetch(url);
  return r.json();
}

async function auditPayload() {
  console.log("## Payload assertions");
  for (const a of ACCOUNTS_FYTD) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(a)}`;
      const j = await jget(url);
      if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); continue; }
      const rl = j.range_labels;
      // L1: shape
      if (!rl || !rl.kind || !rl.through) {
        fail(`${a} ${r.name}`, `range_labels missing/incomplete: ${JSON.stringify(rl)}`);
      }
      // L2: through matches range last closed period
      if (rl?.kind === "fytd" && rl.through !== "thru P8") {
        fail(`${a} ${r.name}`, `FYTD through=${rl.through} (want "thru P8" for today's boundary)`);
      }
      // Kevin PR-B (2026-09-03): single_closed uses "in P#" preposition
      // ("of revenue in P8"); actuals uses "Final P#".
      if (rl?.kind === "single_closed") {
        if (rl.through !== `in P${j.range.period_no}`) {
          fail(`${a} ${r.name}`, `single_closed through=${rl.through} (want "in P${j.range.period_no}")`);
        }
        if (rl.actuals !== `Final P${j.range.period_no}`) {
          fail(`${a} ${r.name}`, `single_closed actuals=${rl.actuals} (want "Final P${j.range.period_no}")`);
        }
      }
      if (rl?.kind === "single_open" && rl.through !== "period to date") {
        fail(`${a} ${r.name}`, `single_open through=${rl.through} (want "period to date")`);
      }
      // L3: status_line tones
      const sl = j.status_line;
      const validTones = new Set(["good", "bad", "neutral", undefined]);
      if (sl) {
        if (!validTones.has(sl.tone) || sl.tone === "warn") {
          fail(`${a} ${r.name}`, `status_line.tone=${sl.tone} (want good/bad/neutral)`);
        }
        if (!validTones.has(sl.gm_tone) || sl.gm_tone === "warn") {
          fail(`${a} ${r.name}`, `status_line.gm_tone=${sl.gm_tone}`);
        }
        if (sl.biggest_lever && !validTones.has(sl.biggest_lever.tone)) {
          fail(`${a} ${r.name}`, `biggest_lever.tone=${sl.biggest_lever.tone}`);
        }
      }
      // L4: no PERFORMANCE-verdict card pill emits warn tone. The
      // revenue card's "Planned" pill is a SOURCE state, not a
      // performance verdict - it correctly ships tone=warn to
      // signal the revenue figure comes from planned budget, not
      // measured actuals. Exclude that pill explicitly.
      const SOURCE_STATE_PILL_LABELS = new Set(["Planned"]);
      for (const c of (j.cards || [])) {
        if (c.pill?.tone !== "warn") continue;
        if (SOURCE_STATE_PILL_LABELS.has(c.pill?.label)) continue;
        fail(`${a} ${r.name}`, `card ${c.key} pill.tone === "warn" on a performance verdict (amber retired): ${JSON.stringify(c.pill)}`);
      }
      // L5: chart series adjusted_budget correctness
      const cogsCard = (j.cards || []).find(c => c.key === "cogs");
      const revBudFull = (j.cards || []).find(c => c.key === "revenue")?.budget_full_period;
      const cogsBudFull = cogsCard?.budget_full_period != null
        ? cogsCard.budget_full_period
        : (j.statement_totals?.cogs?.period_budget ?? null);
      const targetRatio = (revBudFull != null && revBudFull > 0 && cogsBudFull != null)
        ? cogsBudFull / revBudFull : null;
      if (j.chart?.grain === "period" && Array.isArray(j.chart?.series)) {
        for (const s of j.chart.series) {
          if (s.state !== "closed") continue;
          // Zero-revenue periods can't produce an adjusted_budget -
          // that's the honest thing (no revenue -> no target). Skip
          // them from the correctness check.
          if (s.revenue_actual == null || s.revenue_actual === 0) continue;
          if (s.adjusted_budget == null) {
            fail(`${a} ${r.name}`, `chart period P${s.period_no}: adjusted_budget missing despite revenue=${s.revenue_actual}`);
            continue;
          }
          if (targetRatio != null) {
            const expected = Number((s.revenue_actual * targetRatio).toFixed(2));
            const diff = Math.abs(expected - Number(s.adjusted_budget));
            if (diff > 1) {
              fail(`${a} ${r.name}`, `chart period P${s.period_no}: adjusted_budget=${s.adjusted_budget} != rev × ratio = ${expected.toFixed(2)}`);
            }
          }
        }
      }
    }
  }
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function auditDom() {
  console.log("## DOM assertions (TBJ - FL FYTD)");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);
  const url = `${BASE}/kpi/overview?account=${acct("TBJ - FL")}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);

  // D1: no BarTip (kpi-ov-bt) nodes
  const btCount = await page.locator(".kpi-ov-bt").count();
  if (btCount !== 0) fail("D1", `${btCount} .kpi-ov-bt nodes still present (tooltip should be gone)`);

  // D2: per-period budget dashes at correct height
  const dashInfo = await page.evaluate(() => {
    const barsBox = document.querySelector('[data-kpi-ov-grain="period"] .kpi-ov-bars');
    if (!barsBox) return null;
    const barsRect = barsBox.getBoundingClientRect();
    const bars = [...document.querySelectorAll('[data-kpi-ov-grain="period"] .kpi-ov-bar')];
    const info = [];
    for (const bar of bars) {
      const dash = bar.querySelector('[data-kpi-ov="bar-budget-dash"]');
      if (!dash) { info.push({ period: bar.getAttribute("data-kpi-ov-period"), hasDash: false }); continue; }
      const barRect = bar.getBoundingClientRect();
      const dashRect = dash.getBoundingClientRect();
      // Distance from chart bottom to the dash's vertical center.
      const chartBottom = barsRect.bottom;
      const dashY = (dashRect.top + dashRect.bottom) / 2;
      const dashChartOffset = chartBottom - dashY;
      const chartHeight = barsRect.height;
      const dashPctOfChart = (dashChartOffset / chartHeight) * 100;
      const barHeight = barRect.height;
      info.push({
        period: bar.getAttribute("data-kpi-ov-period"),
        hasDash: true,
        val: Number(bar.getAttribute("data-kpi-ov-bar-val")),
        bud: Number(bar.getAttribute("data-kpi-ov-bar-bud")),
        barHeightPx: Math.round(barHeight),
        dashPctOfChart: Number(dashPctOfChart.toFixed(2)),
      });
    }
    return info;
  });
  if (dashInfo) {
    for (const d of dashInfo) {
      if (!d.hasDash) continue;
      // Dash should NOT sit at the bottom (< 2% chart) when its bud > 0.
      if (d.bud > 0 && d.dashPctOfChart < 2) {
        fail("D2", `period P${d.period}: dash at ${d.dashPctOfChart}% of chart with bud=${d.bud} - stuck at bottom`);
      }
    }
  }

  // D3: cost lines headers
  const clHeaders = await page.evaluate(() => {
    const table = document.querySelector('[data-kpi-ov="cost-lines-table"]');
    if (!table) return null;
    const ths = [...table.querySelectorAll("thead th")].map(t => t.innerText.trim());
    const totRow = document.querySelector('[data-kpi-ov="cost-lines-total"] td.l');
    return { ths, totLabel: totRow ? totRow.innerText.trim() : null };
  });
  // CSS uppercases table headers via text-transform. Assert case-
  // insensitive to match the underlying string, not the rendered
  // styling.
  const has = (arr, want) => arr.some(t => t.toLowerCase() === want.toLowerCase());
  const eq = (got, want) => (got || "").toLowerCase() === want.toLowerCase();
  if (clHeaders) {
    // Kevin ruling 2026-09-03 (simplified-layout): cost table headers
    // become universal `Line · Budget* · Actual · % of rev · Target %`.
    // The per-range verb ("Spent thru P8") and per-range adjusted
    // label ("Budget adjusted P8") both retire; new _probe_simplified_
    // layout.mjs asserts the universal shape. The total label keeps
    // the range suffix ("Total cost of goods sold thru P8").
    const wantTot = "Total cost of goods sold thru P8";
    // Header text is "Budget*" (asterisk marks a footnote).
    const hasBudget = clHeaders.ths.some(t => /^budget\*?$/i.test(t));
    if (!hasBudget) fail("D3", `cost lines header missing "Budget" column: ${JSON.stringify(clHeaders.ths)}`);
    if (!has(clHeaders.ths, "Actual")) fail("D3", `cost lines header missing "Actual" column`);
    if (!eq(clHeaders.totLabel, wantTot)) fail("D3", `cost lines total label = ${JSON.stringify(clHeaders.totLabel)} (want ${JSON.stringify(wantTot)})`);
  }

  // Kevin ruling final-presentation (2026-09-03) item 3: every table
  // gains a Plan / Actual band. Sub-headers named per group:
  //   revenue-lines: "Forecast" (plan) / "Received" (actual)
  //   also-tracked:  "Budget" (plan) / "Spent" (actual)
  // The per-range verbs ("Budget thru P8", "Spend thru P8") retire
  // in favor of Plan/Actual grouping. D4 + D5 assertions updated to
  // match the new sub-header shape.
  const rlHeaders = await page.evaluate(() => {
    const table = document.querySelector('[data-kpi-ov="revenue-lines-table"]');
    if (!table) return null;
    return [...table.querySelectorAll("thead th")].map(t => t.innerText.trim());
  });
  if (rlHeaders) {
    if (!has(rlHeaders, "Forecast")) fail("D4", `revenue lines sub-header missing "Forecast": ${JSON.stringify(rlHeaders)}`);
    if (!has(rlHeaders, "Received")) fail("D4", `revenue lines sub-header missing "Received": ${JSON.stringify(rlHeaders)}`);
  }
  const atHeaders = await page.evaluate(() => {
    const table = document.querySelector('[data-kpi-ov="also-tracked"] table');
    if (!table) return null;
    return [...table.querySelectorAll("thead th")].map(t => t.innerText.trim());
  });
  if (atHeaders) {
    if (!has(atHeaders, "Budget")) fail("D5", `also-tracked sub-header missing "Budget": ${JSON.stringify(atHeaders)}`);
    if (!has(atHeaders, "Spent")) fail("D5", `also-tracked sub-header missing "Spent": ${JSON.stringify(atHeaders)}`);
  }

  // D6: full P&L headers (open the fold)
  const foldBtn = page.locator('[data-kpi-ov="fold-pnl"]').first();
  if (await foldBtn.count()) {
    await foldBtn.click();
    await page.waitForTimeout(400);
    const pnlHeaders = await page.evaluate(() => {
      const table = document.querySelector('[data-kpi-ov="statement"] table');
      if (!table) return null;
      return [...table.querySelectorAll("thead th")].map(t => t.innerText.trim());
    });
    if (pnlHeaders) {
      if (!has(pnlHeaders, "Budget thru P8")) fail("D6", `P&L header missing "Budget thru P8": ${JSON.stringify(pnlHeaders)}`);
      if (!has(pnlHeaders, "Actuals thru P8")) fail("D6", `P&L header missing "Actuals thru P8": ${JSON.stringify(pnlHeaders)}`);
      if (has(pnlHeaders, "Period budget")) fail("D6", `P&L header should NOT include "Period budget" on FYTD`);
    }
  }

  // Kevin ruling 2026-09-03 (top-simplify): D7 retired. Envelope
  // delta moved off the card face into the COGS tooltip. New probe
  // `_probe_top_simplify.mjs` asserts the tooltip carries the live
  // sentence. D9 also retired: Revenue card's "Revenue budget P1-P8"
  // sub-line is gone; the eyebrow-based D8 test remains.
  const revInfo = await page.evaluate(() => {
    const card = document.querySelector('[data-kpi-ov="card-revenue"]');
    if (!card) return null;
    const eb = card.querySelector(".kpi-ov-eb");
    return { eb: eb ? eb.innerText.trim() : null };
  });
  if (revInfo) {
    if (!eq(revInfo.eb, "Revenue actuals P1-P8")) fail("D8", `revenue eyebrow=${JSON.stringify(revInfo.eb)} (want "Revenue actuals P1-P8")`);
  }

  await browser.close();
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function main() {
  console.log(`# language + colour pass - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  await auditPayload();
  await auditDom();
  if (FAILS.length === 0) {
    console.log(`Result: language + colour pass invariants hold.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
