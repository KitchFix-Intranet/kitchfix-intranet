// scripts/probes/_probe_overview_site_posture_shots.mjs
//
// Site-posture-to-locked-render verification screenshots (2026-09-01).
//
// Captures the eight shots Kevin asked for + overlap-clip check across
// the laptop matrix. Site posture (test-role site_leader on
// CIN - AZ / STL - FL fee / STL - MO pass-through) at four widths.
//
// Deliverables:
//   1-3. site_leader on CIN - AZ x { period:9 open, period:8 closed, fytd }
//        at 1680 wide (baseline)
//   4-6. site_leader on CIN - AZ x same three x 1280 (narrow)
//   7-8. site_leader on STL - FL (fee) + STL - MO (pass-through)
//        at 1680
//   9-11. site_leader on CIN - AZ at 1456 + 1366 laptop widths
//   12.  corporate on CIN - AZ P9 at 1680 for the "corporate unchanged"
//        visual delta check
//
// Overlap-clip: read every element's scrollWidth vs clientWidth on the
// board. A scrollWidth > clientWidth means content overflows in that
// cell - the "overlap clip that measures scrollWidth so overlap-clips
// are invisible to the gate" trap from F-2 in the scope.
//
// USAGE:
//   TEST_MODE=true node --env-file=.env.local ./node_modules/next/dist/bin/next \
//     start -p 3299 &
//   node scripts/probes/_probe_overview_site_posture_shots.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const OUT = "/tmp";
const acct = (k) => encodeURIComponent(k);

async function loadAndReady(page, url) {
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  await page.waitForSelector('[data-kpi-ov="board"], .kpi-statebox', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  const path = `${OUT}/overview_site_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  [shot] ${name} -> ${path}`);
}

async function overlapCheck(page, label) {
  const overflows = await page.evaluate(() => {
    const bad = [];
    const nodes = document.querySelectorAll('[data-kpi-ov]');
    for (const n of nodes) {
      if (n.scrollWidth > n.clientWidth + 1) {
        bad.push({
          sel: n.getAttribute("data-kpi-ov"),
          scroll: n.scrollWidth,
          client: n.clientWidth,
          text: (n.innerText || "").slice(0, 80),
        });
      }
    }
    return bad;
  });
  if (overflows.length === 0) {
    console.log(`  [overlap-check ${label}] OK - no overflow on kpi-ov elements`);
  } else {
    console.log(`  [overlap-check ${label}] ${overflows.length} overflow(s):`);
    for (const o of overflows.slice(0, 5)) {
      console.log(`     ${o.sel}  scroll=${o.scroll}px client=${o.client}px  "${o.text}"`);
    }
  }
}

const WIDTHS = [1680, 1456, 1366, 1280];

async function main() {
  const browser = await chromium.launch();
  console.log(`# Site posture shots + overlap-clip - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  // Primary matrix: CIN - AZ site_leader × three ranges × four widths.
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    for (const range of ["period:9", "period:8", "fytd"]) {
      const url = `${BASE}/kpi/overview?account=${acct("CIN - AZ")}&range=${encodeURIComponent(range)}&_test_role=site_leader&_test_scope=${acct("CIN - AZ")}`;
      await loadAndReady(page, url);
      const rangeLbl = range.replace(":", "_");
      const name = `${w}_cinaz_${rangeLbl}`;
      await shot(page, name);
      await overlapCheck(page, name);
    }
    await ctx.close();
  }

  // Fee + pass-through at 1680.
  {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
    const page = await ctx.newPage();
    const stlfl = `${BASE}/kpi/overview?account=${acct("STL - FL")}&range=period:9&_test_role=site_leader&_test_scope=${acct("STL - FL")}`;
    await loadAndReady(page, stlfl);
    await shot(page, "1680_stlfl_fee_period9");
    await overlapCheck(page, "stlfl_fee");
    const stlmo = `${BASE}/kpi/overview?account=${acct("STL - MO")}&range=period:9&_test_role=site_leader&_test_scope=${acct("STL - MO")}`;
    await loadAndReady(page, stlmo);
    await shot(page, "1680_stlmo_passthrough_period9");
    await overlapCheck(page, "stlmo_passthrough");
    await ctx.close();
  }

  // Corporate at 1680 for the visual-delta check.
  {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
    const page = await ctx.newPage();
    const url = `${BASE}/kpi/overview?account=${acct("CIN - AZ")}&range=period:9`;
    await loadAndReady(page, url);
    await shot(page, "1680_cinaz_period9_CORPORATE");
    await overlapCheck(page, "cinaz_corporate");
    await ctx.close();
  }

  await browser.close();
  console.log("");
  console.log("done. Screenshots at /tmp/overview_site_*.png");
}
main().catch(e => { console.error(e); process.exit(1); });
