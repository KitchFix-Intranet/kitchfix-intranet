// scripts/_probe_kpi_v36_table.mjs
//
// V36 acceptance. CSS-only change; probe uses synthetic-DOM
// injection into the real .kpi-wrap so the shipped kpi.css cascade
// (including the .kpi-app-scoped --navy-100 override) drives every
// computed style.
//
// Assertions (verbatim from Kevin's spec):
//   COLLAPSED:
//     every .kpi-tbl-band > td backgroundColor === rgb(255,255,255)     [no blue slab]
//     every .kpi-tbl-band > td:first-child boxShadow === 'none'         [no inset unless open]
//     distinct tbody row backgroundColors excluding total === 1
//   THEN open the first band (set aria-expanded="true" on its chevron):
//     that band's td backgroundColor === rgb(234,240,250)  [#EAF0FA · scoped navy-100]
//     that band's td:first-child boxShadow contains 'inset 3px'
//     every OTHER .kpi-tbl-band > td backgroundColor === rgb(255,255,255)
//     every .kpi-tbl-week > td backgroundColor === rgb(248,250,252)  [n-50]
//     every .kpi-tbl-child > td backgroundColor === rgb(255,255,255)
//     NO tbody td backgroundColor === rgb(255,252,246)                [cream gone]
//     flagged week's td:first-child boxShadow contains 'inset 3px'
//     non-flagged week's td:first-child boxShadow === 'none'
//   OFF-TABLE:
//     .kpi-tbar-chip.on backgroundColor === rgb(234,240,250)          [scope reached it]
//     .kpi-spend-cell-nav computed background reported
//   distinct fill colours across tbody (excluding total) exactly
//     {white, n-50, navy-100} and navy-100 appears on at most one band at a time.
//
// Usage: TEST_MODE=true PLAYWRIGHT_BASE_URL=http://localhost:3001 \
//        node scripts/_probe_kpi_v36_table.mjs

import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const URL = `${BASE}/kpi/labor?account=ALL`;

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

const WHITE     = "rgb(255, 255, 255)";
const NAVY_100  = "rgb(234, 240, 250)";
const N_50      = "rgb(248, 250, 252)";
const CREAM     = "rgb(255, 252, 246)";
const STEEL     = "rgb(209, 218, 230)"; // the legacy global --navy-100

const TABLE_HTML = `
  <div class="kpi-tbl-wrap" style="width: 1180px;">
    <table class="kpi-tbl" style="width: 100%; border-collapse: separate; border-spacing: 0;">
      <thead><tr class="kpi-tbl-h"><th>Week</th><th>Hours</th></tr></thead>
      <tbody>
        <tr class="kpi-tbl-band" data-role="band-9">
          <td><button class="kpi-tbl-bandbtn" aria-expanded="false">P9</button></td><td>-</td>
        </tr>
        <tr class="kpi-tbl-week" data-role="week-9a"><td><button class="kpi-tbl-weekbtn" aria-expanded="false">08/03</button></td><td>-</td></tr>
        <tr class="kpi-tbl-week kpi-tbl-attn" data-role="week-9b-flagged"><td><button class="kpi-tbl-weekbtn" aria-expanded="false">08/10</button></td><td>-</td></tr>
        <tr class="kpi-tbl-child" data-role="child-9"><td>worker A</td><td>-</td></tr>
        <tr class="kpi-tbl-band" data-role="band-8">
          <td><button class="kpi-tbl-bandbtn" aria-expanded="false">P8</button></td><td>-</td>
        </tr>
        <tr class="kpi-tbl-week" data-role="week-8a"><td><button class="kpi-tbl-weekbtn" aria-expanded="false">07/06</button></td><td>-</td></tr>
        <tr class="kpi-tbl-band" data-role="band-7">
          <td><button class="kpi-tbl-bandbtn" aria-expanded="false">P7</button></td><td>-</td>
        </tr>
        <tr class="kpi-tbl-total" data-role="total"><td>TOTAL</td><td>-</td></tr>
      </tbody>
    </table>
  </div>`;

const OFFTABLE_HTML = `
  <div class="kpi-tbar" style="margin-top: 8px; padding: 8px;">
    <div class="kpi-tbar-grp">
      <button class="kpi-tbar-chip on" data-role="chip-on">P8</button>
      <button class="kpi-tbar-chip" data-role="chip-off">P7</button>
    </div>
  </div>
  <div class="kpi-spend" style="margin-top: 8px;">
    <div class="kpi-spend-cell kpi-spend-cell-nav" data-role="spend-nav" style="padding: 12px;">
      <span class="kpi-spend-cell-lab">Left to spend</span>
      <span class="kpi-spend-cell-val">$0</span>
    </div>
  </div>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  });
  await context.route("**/*", route => {
    const headers = { ...route.request().headers(), "cache-control": "no-cache" };
    return route.continue({ headers });
  });
  const page = await context.newPage();
  page.on("pageerror", e => console.error(`[pageerror] ${e.message}`));

  console.log("=".repeat(72));
  console.log("V36 table CSS probe · scoped --navy-100 · one tinted row = the open band");
  console.log("=".repeat(72));

  await page.goto(URL, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(300);

  const r = await page.evaluate(async ({ table, offtable, WHITE, NAVY_100, N_50, CREAM, STEEL }) => {
    const wrap = document.querySelector(".kpi-wrap");
    if (!wrap) return { hasWrap: false };
    const host = document.createElement("div");
    host.className = "kpi-app";
    host.style.cssText = "position: absolute; top: -9999px; left: 0; width: 1200px;";
    host.innerHTML = table + offtable;
    wrap.appendChild(host);

    function measure() {
      const bands = [...host.querySelectorAll(".kpi-tbl-band")].map(row => {
        const tds = [...row.querySelectorAll("td")];
        const btn = row.querySelector(".kpi-tbl-bandbtn");
        const cs0 = tds[0] ? getComputedStyle(tds[0]) : null;
        return {
          role: row.dataset.role,
          expanded: btn?.getAttribute("aria-expanded"),
          openClass: row.classList.contains("kpi-tbl-band-open"),
          bg: cs0 ? cs0.backgroundColor : null,
          firstShadow: cs0 ? cs0.boxShadow : null,
        };
      });
      const weeks = [...host.querySelectorAll(".kpi-tbl-week")].map(row => {
        const tds = [...row.querySelectorAll("td")];
        return {
          role: row.dataset.role,
          flagged: row.classList.contains("kpi-tbl-attn"),
          bg: tds[0] ? getComputedStyle(tds[0]).backgroundColor : null,
          firstShadow: tds[0] ? getComputedStyle(tds[0]).boxShadow : null,
        };
      });
      const children = [...host.querySelectorAll(".kpi-tbl-child")].map(row => {
        const tds = [...row.querySelectorAll("td")];
        return {
          role: row.dataset.role,
          bg: tds[0] ? getComputedStyle(tds[0]).backgroundColor : null,
          firstShadow: tds[0] ? getComputedStyle(tds[0]).boxShadow : null,
        };
      });
      const total = host.querySelector(".kpi-tbl-total");
      const totalBg = total ? getComputedStyle(total.querySelector("td")).backgroundColor : null;
      const tbodyTds = [...host.querySelectorAll("tbody tr:not(.kpi-tbl-total) > td")]
        .filter(td => td.parentElement.style.display !== "none");
      const distinctBgs = [...new Set(tbodyTds.map(td => getComputedStyle(td).backgroundColor))].sort();
      const anyCream = tbodyTds.some(td => getComputedStyle(td).backgroundColor === CREAM);
      const anySteel = tbodyTds.some(td => getComputedStyle(td).backgroundColor === STEEL);

      // off-table
      const chipOn = host.querySelector('[data-role="chip-on"]');
      const chipOff = host.querySelector('[data-role="chip-off"]');
      const spendNav = host.querySelector('[data-role="spend-nav"]');

      return {
        bands, weeks, children, totalBg,
        distinctBgs, anyCream, anySteel,
        chipOn: chipOn ? getComputedStyle(chipOn).backgroundColor : null,
        chipOff: chipOff ? getComputedStyle(chipOff).backgroundColor : null,
        spendNav: spendNav ? getComputedStyle(spendNav).backgroundColor : null,
      };
    }

    // Hide non-band rows for the collapsed measurement - in the real
    // table, child + week rows only render when their parent band is
    // expanded, so they should not count towards the collapsed-state
    // distinct-bg check.
    const nonBandRows = [...host.querySelectorAll(".kpi-tbl-week, .kpi-tbl-child")];
    for (const row of nonBandRows) row.style.display = "none";
    const collapsed = measure();
    for (const row of nonBandRows) row.style.display = "";

    // Open the first band. The JSX toggles aria-expanded on the
    // button AND adds .kpi-tbl-band-open on the tr; set both here so
    // the probe mirrors the shipped state exactly. .kpi-tbl-band > td
    // has `transition: background 0.12s`, so a getComputedStyle read
    // immediately after the class toggle returns the from-color; wait
    // one animation frame + the transition duration before measuring.
    const firstBand = host.querySelector(".kpi-tbl-band");
    const firstBandBtn = firstBand.querySelector(".kpi-tbl-bandbtn");
    firstBandBtn.setAttribute("aria-expanded", "true");
    firstBand.classList.add("kpi-tbl-band-open");
    await new Promise(r => setTimeout(r, 200));
    const opened = measure();

    host.remove();
    return { hasWrap: true, collapsed, opened };
  }, {
    table: TABLE_HTML, offtable: OFFTABLE_HTML,
    WHITE, NAVY_100, N_50, CREAM, STEEL,
  });

  if (!r.hasWrap) { log("no .kpi-wrap on /kpi/labor", false); process.exit(1); }

  console.log("\n[COLLAPSED - no band open]");
  for (const b of r.collapsed.bands) {
    log(`band[${b.role}] aria-expanded=${b.expanded}  bg=${b.bg}  (want white ${WHITE})`, b.bg === WHITE);
    log(`band[${b.role}] first-td boxShadow=${b.firstShadow}  (want none)`, b.firstShadow === "none");
  }
  log(`distinct tbody bgs excluding total (want 1)  count=${r.collapsed.distinctBgs.length}  values=[${r.collapsed.distinctBgs.join(", ")}]`,
      r.collapsed.distinctBgs.length === 1 && r.collapsed.distinctBgs[0] === WHITE);
  log(`no cream fills anywhere in tbody`, !r.collapsed.anyCream);

  console.log("\n[OPENED - first band aria-expanded='true']");
  const opened = r.opened;
  const openedBand = opened.bands[0];
  const otherBands = opened.bands.slice(1);
  log(`opened band[${openedBand.role}] bg=${openedBand.bg}  (want navy-100 ${NAVY_100})`, openedBand.bg === NAVY_100);
  log(`opened band[${openedBand.role}] first-td boxShadow contains 'inset' + '3px'`,
      openedBand.firstShadow.includes("inset") && openedBand.firstShadow.includes("3px"));
  for (const b of otherBands) {
    log(`band[${b.role}] bg=${b.bg}  (want white ${WHITE})`, b.bg === WHITE);
    log(`band[${b.role}] first-td boxShadow=${b.firstShadow}  (want none)`, b.firstShadow === "none");
  }
  for (const w of opened.weeks) {
    log(`week[${w.role}] bg=${w.bg}  (want n-50 ${N_50})`, w.bg === N_50);
    if (w.flagged) {
      log(`flagged week[${w.role}] first-td boxShadow contains 'inset' + '3px'`,
          w.firstShadow.includes("inset") && w.firstShadow.includes("3px"));
    } else {
      log(`week[${w.role}] first-td boxShadow=${w.firstShadow}  (want none)`, w.firstShadow === "none");
    }
  }
  for (const c of opened.children) {
    log(`child[${c.role}] bg=${c.bg}  (want white ${WHITE})`, c.bg === WHITE);
  }
  log(`no cream fills anywhere in tbody`, !opened.anyCream);
  log(`no legacy steel-blue fills in tbody`, !opened.anySteel);

  console.log("\n[OFF-TABLE - scope override reached]");
  log(`.kpi-tbar-chip.on bg=${opened.chipOn}  (want navy-100 ${NAVY_100})`, opened.chipOn === NAVY_100);
  console.log(`  info: .kpi-tbar-chip:not(.on) bg=${opened.chipOff}`);
  console.log(`  info: .kpi-spend-cell-nav bg=${opened.spendNav}  (Kevin asked for report; value follows current rule)`);

  const distinct = [...new Set(opened.distinctBgs)].sort();
  const wantSet = new Set([WHITE, N_50, NAVY_100]);
  const setOk = distinct.length === 3 && distinct.every(x => wantSet.has(x));
  log(`\n  distinct tbody bgs opened (want exactly {white, n-50, navy-100})  count=${distinct.length}  values=[${distinct.join(", ")}]`, setOk);
  const navyBands = opened.bands.filter(b => b.bg === NAVY_100).length;
  log(`  navy-100 appears on at most one band at a time  (found ${navyBands})`, navyBands <= 1);

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "V36 TABLE PROBE: PASS" : `V36 TABLE PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));

  await browser.close();
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });
