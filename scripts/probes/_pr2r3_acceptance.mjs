// PR2 R3 Part B - acceptance measurements.
//
// Checks 1-15 from CC_PROMPT_PR2_FIX_R3.md, measured against the running
// dev server + Playwright DOM inspection where a live render is needed.
// Some checks are DOM-only (bar count, chart title) - those flip to
// `needs-gate` when the environment cannot run Playwright.

import { chromium } from "playwright";

const BASE = "http://localhost:3220";
const HEADLESS = true;

async function fetchApi(account, start, end) {
  const u = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${account} ${start}..${end} -> ${r.status}`);
  return r.json();
}

async function loadPage(page, account, start, end) {
  const u = `${BASE}/kpi/purchasing?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(u, { waitUntil: "networkidle", timeout: 30000 });
  // Wait for the board to render (bar column present or emptybucket).
  await page.waitForSelector(".kpi-p-wks, .kpi-p-emptybucket", { timeout: 15000 });
}

async function unitCountInFirstBucket(page) {
  return page.evaluate(() => {
    const strips = document.querySelectorAll(".kpi-p-wks");
    if (!strips.length) return 0;
    // Take the FIRST bucket strip (period card is index 0).
    const first = strips[0];
    return first.querySelectorAll(".kpi-p-wc").length;
  });
}

async function firstBarLabel(page, stripIndex = 0) {
  return page.evaluate((idx) => {
    const strips = document.querySelectorAll(".kpi-p-wks");
    if (!strips[idx]) return null;
    const wcs = strips[idx].querySelectorAll(".kpi-p-wc");
    if (!wcs.length) return null;
    return wcs[0].querySelector(".kpi-p-d")?.textContent?.trim() || null;
  }, stripIndex);
}

async function chartTitle(page, stripIndex = 0) {
  return page.evaluate((idx) => {
    const labels = document.querySelectorAll(".kpi-p-lh .kpi-p-label");
    return labels[idx]?.textContent?.trim() || null;
  }, stripIndex);
}

async function cardTitle(page) {
  return page.evaluate(() => document.querySelector(".kpi-p-cardtitle")?.textContent?.trim() || null);
}

const results = [];
function record(n, label, expected, measured, pass) {
  results.push({ n, label, expected, measured, pass });
  console.log(`  ${n}. ${label}: expected=${expected}  measured=${measured}  ${pass ? "PASS" : "FAIL"}`);
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log("=".repeat(72));
console.log("PR2 R3 acceptance measurements");
console.log("=".repeat(72));

// 1. TBR - FL 07/28 - 08/24 -> 5 bars
await loadPage(page, "TBR - FL", "2026-07-28", "2026-08-24");
const c1 = await unitCountInFirstBucket(page);
record(1, "TBR - FL 07/28-08/24 first-bucket strip", 5, c1, c1 === 5);

// 2. Same range - first bar caption starts 07/27 (Monday of the fiscal
// week containing 07/28).
const c2label = await firstBarLabel(page, 1);  // first bucket strip
record(2, "same range, first bar caption week begins", "07/27 - 08/02", c2label, /^07\/27/.test(c2label || ""));

// 3. ALL FYTD -> 9 period bars
await loadPage(page, "ALL", "2025-12-29", "2026-08-24");
const c3 = await unitCountInFirstBucket(page);
record(3, "ALL FYTD first-bucket strip period bars", 9, c3, c3 === 9);

// 4. ALL FYTD chart title
const c4 = await chartTitle(page, 1);  // first BUCKET strip
record(4, "ALL FYTD bucket chart title", "THE RANGE · PERIOD BY PERIOD", c4, c4 === "THE RANGE · PERIOD BY PERIOD");

// 5. ALL FYTD card title
const c5 = await cardTitle(page);
record(5, "ALL FYTD card title", "FISCAL YEAR TO DATE", c5, c5 === "FISCAL YEAR TO DATE");

// 6. TBR - FL P9 (2026-08-10 to 2026-09-06) -> 4 bars
await loadPage(page, "TBR - FL", "2026-08-10", "2026-09-06");
const c6 = await unitCountInFirstBucket(page);
record(6, "TBR - FL P9 first-bucket strip", 4, c6, c6 === 4);

// 7. Assertion - rendered units == fiscal units. WeekChart throws in
// dev on mismatch. If it did not throw so far, the sample above already
// exercised A/B/C so 7 is de facto PASS across ranges. A dedicated
// seeded-mismatch fires in the DOM by the separate `_pr2r3_seed_mismatch.mjs`
// probe; this row records the DOM-level rendered count vs fiscal weeks
// as a direct check.
{
  await loadPage(page, "ALL", "2026-07-28", "2026-08-24");
  const rendered = await unitCountInFirstBucket(page);
  const b = await fetchApi("ALL", "2026-07-28", "2026-08-24");
  const fiscalWeeks = Number(b?.fiscal?.weeks_in_range ?? 0);
  record(7, "rendered units == fiscal weeks (ALL 07/28-08/24)", fiscalWeeks, rendered, rendered === fiscalWeeks);
}

// 8. Running unit: one treatment across every strip (period card +
// bucket strips) on an in-progress range. The RUNNING slot's caption
// note text must be identical across strips. Prior state showed
// `in progress` on one bucket and `aim for $27,647.25` on another for
// the same slot; spec §B2 owner ruling 2026-08-24 collapses both to
// `running`.
{
  await loadPage(page, "TBR - FL", "2026-08-10", "2026-09-06");
  const notes = await page.evaluate(() => {
    const strips = [...document.querySelectorAll(".kpi-p-wks")];
    const out = [];
    strips.forEach((s, i) => {
      const wcs = [...s.querySelectorAll(".kpi-p-wc")];
      wcs.forEach((wc, j) => {
        const noteEls = [...wc.querySelectorAll(".kpi-p-x")];
        const notesTxt = noteEls.map(n => n.textContent.trim());
        // running unit is the one whose caption carries the "running"
        // note text (state resolver output).
        if (notesTxt.some(t => /running/i.test(t))) {
          out.push({ strip: i, wk: j, notes: notesTxt });
        }
      });
    });
    return out;
  });
  const distinct = [...new Set(notes.map(n => JSON.stringify(n.notes)))];
  record(8, "running unit reads identically across strips", "1 distinct running-caption shape",
    `${distinct.length} distinct`, distinct.length === 1);
}

// 9. Red diagonal hatch on state bars -> zero (only running st-run keeps hatch).
{
  const overWithHatch = await page.evaluate(() => {
    const bars = document.querySelectorAll(".kpi-p-bar.st-over");
    // st-over should have solid background - no repeating-linear-gradient.
    let hatched = 0;
    bars.forEach(b => {
      const cs = window.getComputedStyle(b);
      if (cs.backgroundImage && cs.backgroundImage.includes("repeating-linear-gradient")) hatched++;
    });
    return hatched;
  });
  record(9, "red diagonal hatch on state bars", 0, overWithHatch, overWithHatch === 0);
}

// 10. Weekly target legend on Tier C range -> zero.
{
  await loadPage(page, "ALL", "2025-12-29", "2026-08-24");
  const legends = await page.evaluate(() => {
    const legs = document.querySelectorAll(".kpi-p-lh .kpi-p-leg.orig, .kpi-p-lh .kpi-p-leg.adj");
    return legs.length;
  });
  record(10, "weekly target legend on Tier C FYTD", 0, legends, legends === 0);
}

// 11. Active preset highlighted (all five presets).
{
  const presets = [
    { key: "fytd", start: "2025-12-29", end: "2026-08-24" },
    { key: "last_4wk", start: "2026-07-28", end: "2026-08-24" },
    { key: "last_13wk", start: "2026-05-26", end: "2026-08-24" },
    { key: "this_period", start: "2026-08-10", end: "2026-09-06" },
    { key: "last_period", start: "2026-07-13", end: "2026-08-09" },
  ];
  let allOn = true;
  const misses = [];
  for (const p of presets) {
    await loadPage(page, "TBR - FL", p.start, p.end);
    // Click the range trigger to open the menu.
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector(".kpi-rmenu-trigger");
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) { allOn = false; misses.push(p.key + "(no trigger)"); continue; }
    await page.waitForTimeout(150);
    const onItem = await page.evaluate(() => {
      // Search preset items AND fiscal-period grid buttons.
      const items = [
        ...document.querySelectorAll(".kpi-rmenu-item.on"),
        ...document.querySelectorAll(".kpi-rmenu-gp.on"),
      ];
      return items[0] ? { text: items[0].textContent.trim() } : null;
    });
    if (!onItem) { allOn = false; misses.push(p.key); }
  }
  record(11, "active preset highlighted for all five presets", "yes for all 5", allOn ? "yes" : `no (${misses.join(",")})`, allOn);
}

// 12 (deferred to labor render check outside this probe) - see final.
// 13 (npm run build) - out of scope for this probe.
// 14. Portfolio P9 budget = $231,132.99.
{
  const b14 = await fetchApi("ALL", "2026-08-10", "2026-09-06");
  const pkPeriodBudget = Number(b14?.totals?.pl_cogs?.budget || 0);
  record(14, "Portfolio P9 budget (pl_cogs)", "231132.99", pkPeriodBudget.toFixed(2),
    pkPeriodBudget.toFixed(2) === "231132.99");
}
// 15. Sentinel TBR - FL P8 gl 3200.1 billcom = $39,373.74.
{
  const b15 = await fetchApi("TBR - FL", "2026-07-13", "2026-08-09");
  const sentinel = b15?.sentinel?.amount ?? null;
  record(15, "Sentinel TBR - FL P8 gl 3200.1 billcom", "39373.74", sentinel != null ? Number(sentinel).toFixed(2) : "(null)",
    sentinel != null && Number(sentinel).toFixed(2) === "39373.74");
}

await browser.close();

const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass).length;
console.log(`\n${pass} pass  ${fail} fail  ${results.length} measured`);
if (fail > 0) process.exit(1);
