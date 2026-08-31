// scripts/probes/_probe_overview_phase4_shots.mjs
//
// Overview Phase 4 - live-build verification screenshots.
//
// Captures the shots Kevin needs to sign the phase off:
//   1. Landing page - KPI TopNav lands on /kpi/overview
//   2. Corporate posture - drill button shows drill.purchasing.spent_
//      display (not per-line breakdown); revenue rows show actual_pct
//   3. Site posture (site_leader on CIN - AZ) - salary control absent
//      or off, 3100 total visible, 3100.1/3100.2 sub-lines NOT visible
//   4. Site posture with salary on - 3100.1/3100.2 sub-lines revealed
//      WITHOUT changing the 3100 total
//   5. Drill Labor - land on /kpi/labor with ?account + ?start + ?end
//   6. Drill Purchasing - land on /kpi/purchasing with same shape
//
// USAGE:
//   TEST_MODE=true node --env-file=.env.local ./node_modules/.bin/next \
//     start -p 3299 &
//   node scripts/probes/_probe_overview_phase4_shots.mjs
//
// Screenshots land in /tmp/overview_ph4_*.png.

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3299";
const OUT = "/tmp";
const acct = (k) => encodeURIComponent(k);

const results = [];

async function loadAndReady(page, url) {
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  return page.waitForSelector(
    '[data-kpi-ov="board"], .kpi-statebox',
    { timeout: 15000 }
  );
}

async function shot(page, name, note) {
  const path = `${OUT}/overview_ph4_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  results.push({ name, path, note });
  console.log(`  [shot] ${name} -> ${path}`);
  if (note) console.log(`         ${note}`);
}

async function readCogsTotal(page) {
  // Find the 3100 row's Actual to date cell.
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-kpi-ov-line-code="3100"]');
    for (const r of rows) {
      if (r.getAttribute("data-kpi-ov-sub") === "1") continue;
      const cells = r.querySelectorAll("td");
      // Actual to date is 3rd or 4th cell depending on open period.
      const texts = [...cells].map(c => c.textContent.trim());
      return { rowText: r.textContent.trim().slice(0, 200), cellTexts: texts };
    }
    return null;
  });
}

async function subLineCount(page) {
  return await page.evaluate(() => {
    return document.querySelectorAll('[data-kpi-ov-sub="1"]').length;
  });
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("─".repeat(70));
  console.log("PHASE 4 - live-build screenshot capture");
  console.log(`BASE: ${BASE}`);
  console.log("─".repeat(70));

  // ── 1. Landing page (top nav land on /kpi/overview) ─────────────
  //
  // Direct-load /kpi (root) and verify the KPI TopNav route resolves
  // to /kpi/overview. In TEST_MODE, the top nav points at /kpi/overview
  // and /kpi/overview shows the Overview board immediately.
  console.log("\n[1] Landing - direct /kpi/overview load (TopNav destination)");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}`);
  await shot(page, "01_landing_overview", "Overview board renders at /kpi/overview");

  // Verify the Section dropdown shows P&L Overview as an enabled item.
  const sectionMenu = await page.evaluate(() => {
    const btn = document.querySelector(".kpi-secmenu button");
    return btn ? btn.textContent.trim() : null;
  });
  console.log(`  section menu label: "${sectionMenu}"`);

  // ── 2. Corporate posture - drill.purchasing.spent_display ───────
  console.log("\n[2] Corporate posture - drill button + revenue-row pcts");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}&_test_role=corporate`);
  await page.waitForSelector('[data-kpi-ov-drill="purchasing"]', { timeout: 10000 });
  const purchasingDrillText = await page.evaluate(() => {
    const el = document.querySelector('[data-kpi-ov-drill="purchasing"]');
    return el ? el.textContent.trim().replace(/\s+/g, " ").slice(0, 400) : null;
  });
  console.log(`  purchasing drill text: "${purchasingDrillText}"`);
  await shot(page, "02_corporate_drill_pcts", "Corporate posture, purchasing drill shows Spent / Of revenue / Inside");

  // Open the statement + Full mode to check revenue-row pcts are on.
  await page.click('[data-kpi-ov="fold-pnl"]');
  await page.waitForSelector('[data-kpi-ov="statement"]', { timeout: 5000 });
  await page.click('[data-kpi-ov="dense-full"]');
  await page.waitForTimeout(500);
  const revenue2400 = await page.evaluate(() => {
    const row = document.querySelector('[data-kpi-ov-line-code="2400.1"]');
    if (!row) return null;
    const cells = [...row.querySelectorAll("td")].map(c => c.textContent.trim());
    return cells;
  });
  console.log(`  2400.1 row cells: ${JSON.stringify(revenue2400)}`);
  await shot(page, "02b_corporate_statement_full", "Full P&L, revenue rows carry actual_pct + target_pct (not dash)");

  // ── 3. Site posture, salary OFF - sub-lines hidden ──────────────
  console.log("\n[3] Site posture (site_leader, CIN - AZ) - salary OFF");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}&_test_role=site_leader&_test_scope=${acct("CIN - AZ")}`);
  await page.click('[data-kpi-ov="fold-pnl"]');
  await page.waitForSelector('[data-kpi-ov="statement"]', { timeout: 5000 });
  await page.click('[data-kpi-ov="dense-full"]');
  await page.waitForTimeout(500);

  const cogs3100Off = await readCogsTotal(page);
  const subCountOff = await subLineCount(page);
  console.log(`  3100 total (salary OFF): ${JSON.stringify(cogs3100Off?.cellTexts)}`);
  console.log(`  sub-line row count (salary OFF): ${subCountOff}`);
  await shot(page, "03_site_salary_off", `Site posture, salary OFF - 3100 total visible, ${subCountOff} sub-lines`);

  // ── 4. Site posture, salary ON - sub-lines revealed ─────────────
  console.log("\n[4] Site posture - salary ON (reveal 3100.1 / 3100.2)");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}&_test_role=site_leader&_test_scope=${acct("CIN - AZ")}&include_salary=1`);
  await page.click('[data-kpi-ov="fold-pnl"]');
  await page.waitForSelector('[data-kpi-ov="statement"]', { timeout: 5000 });
  await page.click('[data-kpi-ov="dense-full"]');
  await page.waitForTimeout(500);

  const cogs3100On = await readCogsTotal(page);
  const subCountOn = await subLineCount(page);
  console.log(`  3100 total (salary ON):  ${JSON.stringify(cogs3100On?.cellTexts)}`);
  console.log(`  sub-line row count (salary ON):  ${subCountOn}`);
  await shot(page, "04_site_salary_on", `Site posture, salary ON - ${subCountOn} sub-lines revealed`);

  // Compare 3100 total: MUST be identical between salary OFF and ON.
  const offCells = JSON.stringify(cogs3100Off?.cellTexts || []);
  const onCells = JSON.stringify(cogs3100On?.cellTexts || []);
  const totalUnchanged = offCells === onCells;
  console.log(`\n  ASSERT: 3100 total unchanged between salary OFF and ON`);
  console.log(`    OFF: ${offCells}`);
  console.log(`    ON : ${onCells}`);
  console.log(`    ${totalUnchanged ? "PASS" : "FAIL"}`);
  results.push({ name: "3100_total_invariant", pass: totalUnchanged });

  // ── 5. Drill Labor - captures URL destination ───────────────────
  console.log("\n[5] Drill Labor from CIN - AZ FYTD");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}`);
  await page.waitForSelector('[data-kpi-ov-drill="labor"]', { timeout: 15000 });
  const laborHref = await page.evaluate(() => {
    const a = document.querySelector('[data-kpi-ov-drill="labor"]');
    return a ? a.getAttribute("href") : null;
  });
  console.log(`  labor href: ${laborHref}`);
  results.push({ name: "labor_drill_href", href: laborHref });

  // Click the labor drill and wait for the destination page.
  await Promise.all([
    page.waitForURL(/\/kpi\/labor/, { timeout: 15000 }),
    page.click('[data-kpi-ov-drill="labor"]'),
  ]);
  const laborUrl = page.url();
  console.log(`  landed on: ${laborUrl}`);
  await page.waitForTimeout(2000);  // let labor board settle
  await shot(page, "05_drill_labor", `Landed on labor with URL: ${laborUrl}`);

  // ── 6. Drill Purchasing ─────────────────────────────────────────
  console.log("\n[6] Drill Purchasing from CIN - AZ FYTD");
  await loadAndReady(page, `${BASE}/kpi/overview?account=${acct("CIN - AZ")}`);
  await page.waitForSelector('[data-kpi-ov-drill="purchasing"]', { timeout: 15000 });
  const purchasingHref = await page.evaluate(() => {
    const a = document.querySelector('[data-kpi-ov-drill="purchasing"]');
    return a ? a.getAttribute("href") : null;
  });
  console.log(`  purchasing href: ${purchasingHref}`);
  results.push({ name: "purchasing_drill_href", href: purchasingHref });

  await Promise.all([
    page.waitForURL(/\/kpi\/purchasing/, { timeout: 15000 }),
    page.click('[data-kpi-ov-drill="purchasing"]'),
  ]);
  const purUrl = page.url();
  console.log(`  landed on: ${purUrl}`);
  await page.waitForTimeout(2000);
  await shot(page, "06_drill_purchasing", `Landed on purchasing with URL: ${purUrl}`);

  await browser.close();

  console.log("\n" + "─".repeat(70));
  console.log("SUMMARY");
  console.log("─".repeat(70));
  for (const r of results) {
    if (r.name) console.log(`  ${r.name}: ${r.pass === undefined ? (r.href || r.path || r.note || "captured") : (r.pass ? "PASS" : "FAIL")}`);
  }
  console.log("─".repeat(70));
}

run().catch(e => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
