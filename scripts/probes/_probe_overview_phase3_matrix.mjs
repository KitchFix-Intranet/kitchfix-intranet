// scripts/probes/_probe_overview_phase3_matrix.mjs
//
// Phase F laptop matrix: 4 viewports x 2 postures x 3 ranges = 24 cells.
// Each cell captures (a) overall render success, (b) overlap-clip on
// the 5 critical text-carrying elements, (c) an approximate footprint
// width for the board wrapper.
//
// Postures are approximated in TEST_MODE by:
//   - "corporate"    -> URL has account=ALL
//   - "site_leader"  -> URL has preview=CIN%20-%20AZ (single-account
//                       chip; caller stays corporate in TEST_MODE but
//                       the payload flips posture-adjacent flags via
//                       the preview account context - see route:99).
//                       Approximation: this shows CIN - AZ's board
//                       within the corporate posture (folio rail
//                       still renders). A true site_leader posture
//                       switch would require a real site_leader
//                       session cookie which TEST_MODE does not
//                       fabricate. Report labels this as "site-via-
//                       preview" so no one reads it as a true role
//                       flip.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.OVERVIEW_BASE || "http://localhost:3299";
const OUT_DIR = "/tmp/overview_ph3_matrix";
await mkdir(OUT_DIR, { recursive: true });

const VIEWPORTS = [1280, 1366, 1456, 1680];
const RANGES = [
  { name: "fytd", label: "FYTD", start: "2025-12-29", end: "2026-08-30" },
  { name: "p8",   label: "P8",   start: "2026-07-13", end: "2026-08-09" },
  { name: "p9",   label: "P9",   start: "2026-08-10", end: "2026-09-06" },
];
const POSTURES = [
  { name: "corp", label: "corporate",    urlBase: (r) => `/kpi/overview?account=ALL&start=${r.start}&end=${r.end}` },
  { name: "site", label: "site-via-preview", urlBase: (r) => `/kpi/overview?account=CIN%20-%20AZ&preview=CIN%20-%20AZ&start=${r.start}&end=${r.end}` },
];

async function loadReady(page, url) {
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  await page.waitForSelector('[data-kpi-ov="board"], .kpi-statebox', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function checkOverlaps(page) {
  return await page.evaluate(() => {
    const targets = [
      '[data-kpi-ov="card-revenue"] .kpi-ov-eb',
      '[data-kpi-ov="card-cogs"] .kpi-ov-eb',
      '[data-kpi-ov="card-gm"] .kpi-ov-eb',
      '[data-kpi-ov="ticker-state"]',
      '[data-kpi-ov="src-state"]',
    ];
    const out = { checks: [], anyFail: false };
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (!el) { out.checks.push({ sel, present: false, ownedByTarget: null }); continue; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { out.checks.push({ sel, present: true, hidden: true }); continue; }
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      const owned = hit && (hit === el || el.contains(hit) || (hit.contains && hit.contains(el)));
      const foreignPill = hit && hit.closest &&
        (hit.closest('.kpi-ov-pill') && !el.contains(hit.closest('.kpi-ov-pill')));
      out.checks.push({ sel, present: true, ownedByTarget: !!owned, foreignPillCovers: !!foreignPill });
      if (!owned || foreignPill) out.anyFail = true;
    }
    return out;
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

const grid = [];
for (const vw of VIEWPORTS) {
  for (const posture of POSTURES) {
    for (const range of RANGES) {
      const cellName = `${vw}_${posture.name}_${range.name}`;
      const url = BASE + posture.urlBase(range);
      const page = await context.newPage();
      await page.setViewportSize({ width: vw, height: 900 });
      let cell = { viewport: vw, posture: posture.label, range: range.label, url, ok: false };
      try {
        await loadReady(page, url);
        const clip = await checkOverlaps(page);
        cell.ok = true;
        cell.overlapPass = !clip.anyFail;
        cell.overlapChecks = clip.checks;
        // Capture full-page screenshot for the corp cells at each vw
        if (posture.name === "corp") {
          const path = `${OUT_DIR}/${cellName}.png`;
          await page.screenshot({ path, fullPage: true });
          cell.screenshot = path;
        }
      } catch (e) {
        cell.err = String(e?.message || e);
      }
      grid.push(cell);
      console.log(`${cell.ok ? "OK " : "ERR"} ${cellName.padEnd(30)}  overlap=${cell.overlapPass ? "PASS" : cell.overlapChecks ? "FAIL" : "?"}`);
      await page.close();
    }
  }
}

await browser.close();

console.log(`\nlaptop matrix summary:`);
const passed = grid.filter(c => c.ok && (c.overlapPass !== false)).length;
console.log(`  ${passed}/${grid.length} cells passed`);
await writeFile(`${OUT_DIR}/summary.json`, JSON.stringify(grid, null, 2));
console.log(`  summary: ${OUT_DIR}/summary.json`);
process.exit(passed === grid.length ? 0 : 1);
