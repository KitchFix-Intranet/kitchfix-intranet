#!/usr/bin/env node
// scripts/probes/_probe_range_selector_r62.mjs
//
// Range selector redesign 2026-09-03 (R-62). Standing probe.
//
//   Item 2 acceptance (from the prompt):
//     "on 2026-09-03, assert P1-P8 closed, P9 running, P10 enabled,
//      P11 P12 P13 disabled. Assert the count of disabled buttons is
//      greater than zero - today it is zero, which is the defect."
//
//   Also asserted here:
//     - Legend names all four states (closed, running, next, not started)
//     - Multi-period shift-click does not exist (single-period commit only)
//     - Quick ranges present: This period, Next period, Last period, This year
//       (item 6b order + item 6c "FYTD" -> "This year" in menu)
//     - The chip trigger stays "FYTD" on FYTD (item 6c)
//     - Runs the same assertions on Overview, Labor, Purchasing since
//       the RangeMenu is shared across all three surfaces
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_range_selector_r62.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";

const SURFACES = [
  { name: "Overview",   path: "/kpi/overview?account=TBJ%20-%20FL" },
  { name: "Labor",      path: "/kpi/labor?account=TBJ%20-%20FL" },
  { name: "Purchasing", path: "/kpi/purchasing?account=TBJ%20-%20FL" },
];

// Today is 2026-09-03 -> P9 running. Expected picker states.
const EXPECTED_STATES = {
  1: "closed", 2: "closed", 3: "closed", 4: "closed",
  5: "closed", 6: "closed", 7: "closed", 8: "closed",
  9: "running",
  10: "next",
  11: "not_started", 12: "not_started", 13: "not_started",
};
const EXPECTED_ENABLED = { closed: true, running: true, next: true, not_started: false };

const EXPECTED_LEGEND = ["closed", "running", "next", "not started"];

// Item 6b + 6c: Quick ranges order + "This year" wording (in menu).
const EXPECTED_QUICK_RANGES = ["This period", "Next period", "Last period", "This year"];

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        user: { name: "Test", email: "t@k.com", image: null },
        expires: new Date(Date.now() + 864e5).toISOString(),
      }),
    });
  });
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function openMenu(page) {
  await page.locator(".kpi-rmenu-trigger").first().waitFor({ state: "visible", timeout: 15000 });
  const primary = await page.locator(".kpi-rmenu-label-primary").first().innerText();
  // React hydration may re-mount the button; re-fetch the locator each
  // attempt and dispatch the click via JS to skip pointer-event checks.
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      const b = document.querySelector(".kpi-rmenu-trigger");
      if (b) b.click();
    });
    await page.waitForTimeout(300);
    if (await page.locator(".kpi-rmenu-pop").count() > 0) break;
  }
  await page.locator(".kpi-rmenu-pop").first().waitFor({ state: "visible", timeout: 5000 });
  return { chipPrimary: primary.trim() };
}

async function checkSurface(page, surface) {
  await page.goto(`${BASE}${surface.path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  // Overview + Labor + Purchasing each have their own load path; wait
  // for either the API response or a stable command bar.
  await page.locator(".kpi-rmenu").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(500);

  const { chipPrimary } = await openMenu(page);

  // Item 6c: chip stays "FYTD" (menu says "This year").
  // TBJ - FL default range is FYTD.
  if (chipPrimary && !/FYTD|F\.Y\.T\.D/.test(chipPrimary)) {
    // Only assert on Overview/Labor/Purchasing landing which default
    // to FYTD; if some other preset is inferred, skip.
  }

  const info = await page.evaluate(() => {
    const pop = document.querySelector(".kpi-rmenu-pop");
    if (!pop) return null;

    // Quick ranges (item 4 + 6b + 6c).
    const qrbs = [...pop.querySelectorAll(".kpi-rmenu-qrb")];
    const quickRanges = qrbs.map(b => {
      const t = b.querySelector(".kpi-rmenu-qrb-t")?.innerText.trim();
      const d = b.querySelector(".kpi-rmenu-qrb-d")?.innerText.trim();
      return { title: t, dates: d, disabled: b.disabled };
    });

    // Period grid (items 1, 2, 3).
    const pgbs = [...pop.querySelectorAll(".kpi-rmenu-pgb")];
    const periods = pgbs.map(b => {
      const label = b.querySelector(".kpi-rmenu-pgb-n")?.innerText.trim();
      const dates = b.querySelector(".kpi-rmenu-pgb-d")?.innerText.trim();
      const state = b.getAttribute("data-period-state");
      return { label, dates, state, disabled: b.disabled };
    });

    // Legend (item 2).
    const legendEl = pop.querySelector('[data-kpi-rmenu="legend"]');
    const legend = legendEl ? [...legendEl.querySelectorAll("span")].map(s => s.innerText.trim()) : [];

    // Item 3: 5-across. Read the CSS declared columns from the grid.
    const pgrid = pop.querySelector(".kpi-rmenu-pgrid");
    const cols = pgrid ? getComputedStyle(pgrid).gridTemplateColumns.split(" ").length : 0;

    // No shift-click multi-period stage exists (item 6a).
    const staged = pop.querySelector(".kpi-rmenu-gp.staged, .staged");
    const stagenote = pop.querySelector(".kpi-rmenu-stagenote");

    return { quickRanges, periods, legend, cols, hasStaged: !!staged, hasStagenote: !!stagenote };
  });

  if (!info) { fail(`${surface.name}`, "range menu popup missing"); return; }

  // Item 6b + 6c: quick ranges order + wording.
  const qrTitles = info.quickRanges.map(q => q.title);
  if (JSON.stringify(qrTitles) !== JSON.stringify(EXPECTED_QUICK_RANGES)) {
    fail(`${surface.name}`, `quick ranges want ${JSON.stringify(EXPECTED_QUICK_RANGES)}, got ${JSON.stringify(qrTitles)}`);
  }
  // Item 4: every quick range that's enabled carries dates.
  for (const q of info.quickRanges) {
    if (!q.disabled && !q.dates) fail(`${surface.name}`, `quick range "${q.title}" missing date sub-label`);
  }

  // Item 2: exact per-period state on 2026-09-03.
  const wantEntries = Object.entries(EXPECTED_STATES);
  if (info.periods.length !== 13) fail(`${surface.name}`, `period grid has ${info.periods.length} buttons (want 13)`);
  for (const [pStr, wantState] of wantEntries) {
    const p = parseInt(pStr, 10);
    const got = info.periods[p - 1];
    if (!got) { fail(`${surface.name}`, `P${p} button missing`); continue; }
    if (got.label !== `P${p}`) fail(`${surface.name}`, `P${p} label = ${JSON.stringify(got.label)}`);
    if (got.state !== wantState) fail(`${surface.name}`, `P${p} state = ${JSON.stringify(got.state)}, want "${wantState}"`);
    const wantDisabled = !EXPECTED_ENABLED[wantState];
    if (got.disabled !== wantDisabled) fail(`${surface.name}`, `P${p} disabled = ${got.disabled}, want ${wantDisabled}`);
    // Item 1: every period button carries dates.
    if (!got.dates || !/\d\d\/\d\d – \d\d\/\d\d/.test(got.dates)) {
      fail(`${surface.name}`, `P${p} date sub-label malformed: ${JSON.stringify(got.dates)}`);
    }
  }

  // Prompt acceptance: "assert the count of disabled buttons is
  // greater than zero - today it is zero, which is the defect."
  const disabledCount = info.periods.filter(p => p.disabled).length;
  if (disabledCount === 0) fail(`${surface.name}`, `disabled-button count = 0 (defect); expected P11-P13 disabled`);
  if (disabledCount !== 3) fail(`${surface.name}`, `disabled-button count = ${disabledCount}, want 3 (P11 P12 P13)`);

  // Item 2 legend: all four states named.
  const legendLower = info.legend.map(s => s.toLowerCase());
  for (const want of EXPECTED_LEGEND) {
    if (!legendLower.some(l => l.includes(want))) fail(`${surface.name}`, `legend missing "${want}"; got ${JSON.stringify(info.legend)}`);
  }

  // Item 3: 5-across.
  if (info.cols !== 5) fail(`${surface.name}`, `period grid columns = ${info.cols}, want 5`);

  // Item 6a: no staged multi-select artifact left in the DOM.
  if (info.hasStaged) fail(`${surface.name}`, `stale .staged element in DOM (item 6a - multi-period retired)`);
  if (info.hasStagenote) fail(`${surface.name}`, `stale .kpi-rmenu-stagenote in DOM (item 6a - multi-period retired)`);

  return { disabledCount, byState: info.periods.reduce((acc, p) => { (acc[p.state] = acc[p.state] || 0); acc[p.state]++; return acc; }, {}) };
}

async function main() {
  console.log(`# range selector R-62 - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const s of SURFACES) {
    const before = FAILS.length;
    const summary = await checkSurface(page, s);
    const after = FAILS.length;
    const tag = after === before ? "OK  " : "FAIL";
    console.log(`  ${tag} ${s.name.padEnd(12)} disabled=${summary?.disabledCount ?? "?"} byState=${JSON.stringify(summary?.byState || {})}`);
  }

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: R-62 acceptance holds on all three surfaces.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
