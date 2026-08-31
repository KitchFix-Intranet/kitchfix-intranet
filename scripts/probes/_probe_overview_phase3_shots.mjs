// scripts/probes/_probe_overview_phase3_shots.mjs
//
// Overview Phase 3 screenshot battery. Spawns nothing itself - expects
// a `next start -p 3299` already running with TEST_MODE=true so the
// middleware bypass fires and the route is reachable without OAuth.
//
// Phase J of the Phase 3 brief. Cells:
//   1. Corporate posture x FYTD / P8 / P9
//   2. Site posture x FYTD / P8 / P9 (via a preview target)
//   3. Corporate ALL @ 1280 (with overlap-clip verification)
//   4. Corporate ALL @ 1456
//   5. Pass-through single (STL - MO) corporate FYTD
//   6. Fee single (CIN - OH) corporate FYTD
//   7. Loading skeleton (fetch stub)
//   8. Empty state (out-of-scope account bypass)
//
// Note: TEST_MODE promotes the caller to `corporate` (see route:99),
// so previewing a site-scoped account uses ?preview= to bring the
// site-leader posture into view.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.OVERVIEW_BASE || "http://localhost:3299";
const OUT_DIR = "/tmp/overview_ph3";
await mkdir(OUT_DIR, { recursive: true });

async function loadAndReady(page, url) {
  // Wait for the /api/kpi/overview response to land, then wait for
  // the loaded board wrapper (or an authoritative refusal state).
  // Skeleton alone is not "ready" - it's mid-cold-load.
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  // After the response lands React needs a tick to render the board.
  return page.waitForSelector(
    '[data-kpi-ov="board"], .kpi-statebox',
    { timeout: 15000 }
  );
}

// The Overview site posture requires a preview target that maps to a
// per-meal (non-fee) account so the pill copy differs from a fee
// account. CIN - AZ is per_meal; SLW - FL is per_meal. We use CIN - AZ.
const shots = [
  // Corporate posture x range
  { name: "corp_fytd_all",        url: "/kpi/overview?account=ALL&start=2025-12-29&end=2026-08-30", viewport: { width: 1456, height: 900 } },
  { name: "corp_p8_all",          url: "/kpi/overview?account=ALL&start=2026-07-13&end=2026-08-09", viewport: { width: 1456, height: 900 } },
  { name: "corp_p9_all",          url: "/kpi/overview?account=ALL&start=2026-08-10&end=2026-09-06", viewport: { width: 1456, height: 900 } },
  // Site posture x range (previewed on CIN - AZ, non-fee)
  { name: "site_fytd_cinaz",      url: "/kpi/overview?account=CIN%20-%20AZ&preview=CIN%20-%20AZ&start=2025-12-29&end=2026-08-30", viewport: { width: 1456, height: 900 } },
  { name: "site_p8_cinaz",        url: "/kpi/overview?account=CIN%20-%20AZ&preview=CIN%20-%20AZ&start=2026-07-13&end=2026-08-09", viewport: { width: 1456, height: 900 } },
  { name: "site_p9_cinaz",        url: "/kpi/overview?account=CIN%20-%20AZ&preview=CIN%20-%20AZ&start=2026-08-10&end=2026-09-06", viewport: { width: 1456, height: 900 } },
  // Laptop widths (corporate ALL, P9) - the 1280 cell also runs the
  // overlap-clip check below.
  { name: "corp_p9_all_1280",     url: "/kpi/overview?account=ALL&start=2026-08-10&end=2026-09-06", viewport: { width: 1280, height: 900 } },
  { name: "corp_p9_all_1366",     url: "/kpi/overview?account=ALL&start=2026-08-10&end=2026-09-06", viewport: { width: 1366, height: 900 } },
  // Single-account passes
  { name: "corp_pt_stlmo_fytd",   url: "/kpi/overview?account=STL%20-%20MO&start=2025-12-29&end=2026-08-30", viewport: { width: 1456, height: 900 } },
  { name: "corp_fee_cinoh_fytd",  url: "/kpi/overview?account=CIN%20-%20OH&start=2025-12-29&end=2026-08-30", viewport: { width: 1456, height: 900 } },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

let clipReport = null;
let attaches = [];

for (const s of shots) {
  const page = await context.newPage();
  await page.setViewportSize(s.viewport);
  try {
    await loadAndReady(page, BASE + s.url);
    await page.waitForTimeout(500);
    const path = `${OUT_DIR}/${s.name}.png`;
    await page.screenshot({ path, fullPage: true });
    attaches.push({ name: s.name, path, viewport: s.viewport, url: s.url });
    console.log(`OK  ${s.name.padEnd(28)}  ${s.viewport.width}px  ${path}`);
  } catch (e) {
    console.log(`ERR ${s.name.padEnd(28)}  ${s.viewport.width}px  ${e?.message || e}`);
  }
  await page.close();
}

// ── Overlap-clip check @ 1280 (F-2 sensor per the brief) ───────────
// For each critical text-carrying element, do an elementFromPoint at
// the middle of its rendered box. Assert the element returned is the
// element being probed (or a descendant of it), not a foreign overlay
// (pill, chevron etc.). The F-2 defect on labor was a pill overlapping
// an eyebrow while scrollWidth reported no overflow.
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadAndReady(page, BASE + "/kpi/overview?account=ALL&start=2026-08-10&end=2026-09-06");
  await page.waitForTimeout(400);
  const report = await page.evaluate(() => {
    const targets = [
      { role: "card-eyebrow-revenue", selector: '[data-kpi-ov="card-revenue"] .kpi-ov-eb' },
      { role: "card-eyebrow-cogs",    selector: '[data-kpi-ov="card-cogs"] .kpi-ov-eb' },
      { role: "card-eyebrow-gm",      selector: '[data-kpi-ov="card-gm"] .kpi-ov-eb' },
      { role: "ticker-state",         selector: '[data-kpi-ov="ticker-state"]' },
      { role: "sources-line-state",   selector: '[data-kpi-ov="src-state"]' },
    ];
    const out = [];
    for (const t of targets) {
      const el = document.querySelector(t.selector);
      if (!el) { out.push({ ...t, present: false }); continue; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { out.push({ ...t, present: true, hidden: true }); continue; }
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      const ownedByTarget = el.contains(hit) || hit === el;
      const foreignPill = hit && hit.closest && (hit.closest('.kpi-ov-pill') && !el.contains(hit.closest('.kpi-ov-pill')));
      out.push({
        role: t.role,
        selector: t.selector,
        present: true,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        hitTag: hit?.tagName || null,
        hitClasses: hit?.className || null,
        ownedByTarget,
        foreignPillCovers: !!foreignPill,
      });
    }
    return out;
  });
  clipReport = report;
  const anyClipped = report.some(r => r.present && !r.hidden && (!r.ownedByTarget || r.foreignPillCovers));
  console.log(`\n1280 overlap-clip check: ${anyClipped ? "FAIL" : "PASS"}`);
  for (const r of report) {
    console.log(`  ${r.role.padEnd(28)} ownedByTarget=${r.ownedByTarget} foreignPill=${r.foreignPillCovers}`);
  }
  await page.close();
} catch (e) {
  console.log(`ERR overlap-clip check: ${e?.message || e}`);
}

// ── Keyboard tab-order check ───────────────────────────────────────
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1456, height: 900 });
  await loadAndReady(page, BASE + "/kpi/overview?account=ALL&start=2026-08-10&end=2026-09-06");
  await page.waitForTimeout(400);
  const order = [];
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const dataAttrs = {};
      if (el.hasAttributes && el.hasAttributes()) {
        for (const a of el.attributes) {
          if (a.name.startsWith("data-kpi-ov")) dataAttrs[a.name] = a.value;
        }
      }
      return {
        tag: el.tagName,
        className: (el.className || "").toString().slice(0, 80),
        text: (el.textContent || "").trim().slice(0, 40),
        dataAttrs,
      };
    });
    order.push({ step: i + 1, ...info });
  }
  console.log("\nKeyboard tab order (first 20 tabs):");
  for (const o of order) {
    const label = Object.keys(o.dataAttrs || {}).length ? JSON.stringify(o.dataAttrs) : `${o.tag} .${(o.className || "").slice(0, 40)}`;
    console.log(`  ${String(o.step).padStart(2)}. ${label}  "${o.text}"`);
  }
  await page.close();
} catch (e) {
  console.log(`ERR keyboard test: ${e?.message || e}`);
}

await browser.close();

const summary = { attaches, clipReport };
await writeFile(`${OUT_DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`\nAll shots + JSON in ${OUT_DIR}`);
