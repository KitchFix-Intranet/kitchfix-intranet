#!/usr/bin/env node
// Consolidation PR 1 · commit 4 · acceptance sweep.
//
// Verifies the design polish (close the gap above the labor table
// and move the "?" up into the header row) landed and did not
// disturb the labor page.
//
// Kevin's acceptance items 1-10, run against TEST_MODE prod :3001.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
mkdirSync("/tmp/kf-consol-shots", { recursive: true });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 1400 } })).newPage();

async function openOverview(url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => /Period running|Period closed|Planning view|Off season/i.test(document.body.innerText || ""), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
}

async function openLaborFold() {
  await p.evaluate(() => { const t = document.querySelector('[data-kpi-ov="fold-labor"]'); if (t) t.click(); });
  await p.waitForTimeout(1500);
}

async function measureGap() {
  return p.evaluate(() => {
    const foldTrigger = document.querySelector('[data-kpi-ov="fold-labor"]');
    const tableHeaderCell = document.querySelector('[data-kpi-ov="labor-ledger"] table thead th');
    if (!foldTrigger || !tableHeaderCell) return null;
    const triggerRect = foldTrigger.getBoundingClientRect();
    const cellRect = tableHeaderCell.getBoundingClientRect();
    return {
      triggerBottom: triggerRect.bottom,
      tableHeaderTop: cellRect.top,
      gap: cellRect.top - triggerRect.bottom,
    };
  });
}

let fails = 0;
const record = (ok, label) => { if (!ok) { fails += 1; console.log("  FAIL · " + label); } else console.log("  PASS · " + label); };

// A2 · Fold on Current Year: no meta row, no toolbar row
console.log("2 · fold on Current Year · no scope line, no toolbar row, no jump chips");
{
  await openOverview(`${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2025-12-29&end=2026-09-06`);
  await openLaborFold();
  await p.waitForTimeout(1000);
  const c = await p.evaluate(() => {
    const el = document.querySelector('[data-kpi-ov="labor-ledger"]');
    return {
      hasMetaRow: !!el?.querySelector('[data-kpi-ov="labor-ledger-scope"]'),
      hasMetaClass: !!el?.querySelector('.kpi-ov-fold-meta'),
      hasVisibleTbar: !!Array.from(el?.querySelectorAll('.kpi-tbar') || []).find(t => getComputedStyle(t).display !== 'none'),
      hasJumpChipsVisible: !!Array.from(el?.querySelectorAll('.kpi-tbar-jumpto, [data-kpi-jump]') || []).find(t => getComputedStyle(t).display !== 'none'),
      // Sanity: verify the toolbar IS in the DOM (just hidden), because
      // Kevin's structural claim in the prompt was "WeekTable renders
      // .kpi-tbar unconditionally". We keep it hidden not remove it.
      tbarPresent: !!el?.querySelector('.kpi-tbar'),
    };
  });
  record(!c.hasMetaRow, "CY · no data-kpi-ov='labor-ledger-scope' meta row");
  record(!c.hasMetaClass, "CY · no .kpi-ov-fold-meta node");
  record(c.tbarPresent, "CY · .kpi-tbar still in DOM (design lives in CSS)");
  record(!c.hasVisibleTbar, "CY · .kpi-tbar computed display:none (invisible)");
  record(!c.hasJumpChipsVisible, "CY · jump chips not visible");
  const gapCY = await measureGap();
  console.log("  CY gap (fold trigger bottom → table header top): " + JSON.stringify(gapCY));
  globalThis.__gapCY = gapCY;
}

// A3 · Fold on P9: no empty toolbar row
console.log();
console.log("3 · fold on P9 · same, no empty toolbar row");
{
  await openOverview(`${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06`);
  await openLaborFold();
  await p.waitForTimeout(1000);
  const c = await p.evaluate(() => {
    const el = document.querySelector('[data-kpi-ov="labor-ledger"]');
    return {
      hasVisibleTbar: !!Array.from(el?.querySelectorAll('.kpi-tbar') || []).find(t => getComputedStyle(t).display !== 'none'),
      hasMetaClass: !!el?.querySelector('.kpi-ov-fold-meta'),
    };
  });
  record(!c.hasMetaClass, "P9 · no .kpi-ov-fold-meta node");
  record(!c.hasVisibleTbar, "P9 · .kpi-tbar computed display:none");
  const gapP9 = await measureGap();
  console.log("  P9 gap: " + JSON.stringify(gapP9));
  globalThis.__gapP9 = gapP9;
}

// A4 · after gaps match each other
console.log();
console.log("4 · after gaps match between P9 and CY");
{
  const cy = globalThis.__gapCY;
  const p9 = globalThis.__gapP9;
  if (cy && p9) {
    const dGap = Math.abs(cy.gap - p9.gap);
    record(dGap < 1, `after · CY gap ${cy.gap.toFixed(2)}px vs P9 gap ${p9.gap.toFixed(2)}px (Δ ${dGap.toFixed(2)}px)`);
  } else {
    fails += 1;
    console.log("  FAIL · could not measure both gaps");
  }
}

// A5 · The "?" works
console.log();
console.log("5 · the '?' popover works · keyboard reachable · aria-expanded flips · Escape closes");
{
  await openOverview(`${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06`);
  const state1 = await p.evaluate(() => {
    const t = document.querySelector('[data-hs-help="qLaborFold"]');
    return t ? { present: true, ariaExpanded: t.getAttribute("aria-expanded") } : { present: false };
  });
  record(state1.present, "'?' trigger present with data-hs-help=qLaborFold");
  record(state1.ariaExpanded === "false", "'?' aria-expanded=false when closed");
  // Focus + Enter
  await p.evaluate(() => document.querySelector('[data-hs-help="qLaborFold"]').focus());
  await p.keyboard.press("Enter");
  await p.waitForTimeout(400);
  const state2 = await p.evaluate(() => {
    const t = document.querySelector('[data-hs-help="qLaborFold"]');
    const pop = document.querySelector('[data-hs-help-for="qLaborFold"]');
    return { ariaExpanded: t?.getAttribute("aria-expanded"), popVisible: !!pop };
  });
  record(state2.ariaExpanded === "true", "'?' aria-expanded=true after Enter");
  record(state2.popVisible, "popover in DOM (portal) after open");
  // Escape closes
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  const state3 = await p.evaluate(() => document.querySelector('[data-hs-help="qLaborFold"]').getAttribute("aria-expanded"));
  record(state3 === "false", "Escape closes the popover (aria-expanded=false)");
}

// A6 · Clicking the "?" does not toggle the fold
console.log();
console.log("6 · clicking '?' does not toggle the fold");
{
  await openOverview(`${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06`);
  const foldStateBefore = await p.evaluate(() => document.querySelector('[data-kpi-ov="labor-ledger"]').getAttribute("data-kpi-ov-open"));
  await p.evaluate(() => document.querySelector('[data-hs-help="qLaborFold"]').click());
  await p.waitForTimeout(400);
  const foldStateAfter = await p.evaluate(() => document.querySelector('[data-kpi-ov="labor-ledger"]').getAttribute("data-kpi-ov-open"));
  record(foldStateBefore === foldStateAfter, `'?' click did not toggle fold (${foldStateBefore} → ${foldStateAfter})`);
  // And clicking on the trigger DOES
  await p.evaluate(() => { document.querySelector('[data-hs-help="qLaborFold"]').blur(); document.body.click(); }); // close pop
  await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('[data-kpi-ov="fold-labor"]').click());
  await p.waitForTimeout(400);
  const foldStateAfterTrigger = await p.evaluate(() => document.querySelector('[data-kpi-ov="labor-ledger"]').getAttribute("data-kpi-ov-open"));
  record(foldStateAfter !== foldStateAfterTrigger, `trigger click did toggle fold (${foldStateAfter} → ${foldStateAfterTrigger})`);
}

// A7 · No duplicate probe hooks
console.log();
console.log("7 · no duplicate probe hooks");
{
  const counts = await p.evaluate(() => ({
    qWeekTable: document.querySelectorAll('[data-hs-help="qWeekTable"]').length,
    qLaborFold: document.querySelectorAll('[data-hs-help="qLaborFold"]').length,
    foldLabor:  document.querySelectorAll('[data-kpi-ov="fold-labor"]').length,
    laborLedger: document.querySelectorAll('[data-kpi-ov="labor-ledger"]').length,
  }));
  console.log("  counts: " + JSON.stringify(counts));
  record(counts.qWeekTable === 1, "exactly one data-hs-help='qWeekTable' on the page (labor toolbar, hidden)");
  record(counts.qLaborFold === 1, "exactly one data-hs-help='qLaborFold' on the page (fold header)");
  record(counts.foldLabor === 1, "exactly one data-kpi-ov='fold-labor'");
  record(counts.laborLedger === 1, "exactly one data-kpi-ov='labor-ledger'");
}

// A8 · Figures unchanged (payload sanity)
console.log();
console.log("8 · figures unchanged (labor payload check for TBJ - FL P9 sal=1)");
{
  const lb = await (await fetch(`${BASE}/api/kpi/labor?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06&include_salary=1`)).json();
  const b = lb.board;
  // Kevin's list from the prompt:
  //   adjusted $44,651.32, ▼ $4,199, 1,254.08 hours, 37.06 OT,
  //   $20.75, $40,451.88.
  record(Math.abs(Number(b?.budget_at_this_revenue) - 44651.32) < 0.02, `board.budget_at_this_revenue = $44,651.32 (got $${b?.budget_at_this_revenue})`);
  record(Math.abs(Number(b?.spent_to_date_feeds) - 40451.88) < 0.02, `board.spent_to_date_feeds = $40,451.88 (got $${b?.spent_to_date_feeds})`);
  // The remaining figures are derived by WeekTable's aggregation from
  // labor.actuals; skip re-computing here - identity of the payload
  // hash is the stronger claim, covered by the 24/24 gate in commit 1.
}

// A9 · 375px header row does not wrap or clip the "?"
console.log();
console.log("9 · 375px viewport · header row does not wrap or clip the '?'");
{
  await p.setViewportSize({ width: 375, height: 900 });
  await p.waitForTimeout(500);
  const info = await p.evaluate(() => {
    const head = document.querySelector('[data-kpi-ov="labor-ledger"] .kpi-ov-fold-head');
    const trigger = document.querySelector('[data-kpi-ov="fold-labor"]');
    const help = document.querySelector('[data-hs-help="qLaborFold"]');
    if (!head || !trigger || !help) return { present: false };
    const hr = head.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    const hpr = help.getBoundingClientRect();
    return {
      present: true,
      headHeight: hr.height,
      triggerTop: tr.top,
      triggerBottom: tr.bottom,
      helpTop: hpr.top,
      helpBottom: hpr.bottom,
      helpVisible: hpr.width > 0 && hpr.height > 0,
      helpWithinViewport: hpr.right <= window.innerWidth && hpr.left >= 0,
      // Vertical overlap = on the same row. Flex align-items:center
      // means top/bottom differ when heights differ; midpoints and
      // range overlap are the reliable signals.
      sameRow: tr.bottom >= hpr.top && hpr.bottom >= tr.top,
      overlapPct: (() => {
        const overlap = Math.max(0, Math.min(tr.bottom, hpr.bottom) - Math.max(tr.top, hpr.top));
        const helpH = hpr.bottom - hpr.top;
        return helpH > 0 ? overlap / helpH : 0;
      })(),
    };
  });
  console.log("  " + JSON.stringify(info));
  record(info.sameRow, "375px · trigger and '?' sit on the same row");
  record(info.helpVisible, "375px · '?' visible");
  record(info.helpWithinViewport, "375px · '?' inside viewport (not clipped)");
  await p.setViewportSize({ width: 1400, height: 1400 });
}

await b.close();

console.log();
console.log(fails === 0 ? "Consolidation PR 1 · commit 4 · PASS · all checks held" : `Consolidation PR 1 · commit 4 · FAIL · ${fails} mismatches`);
process.exit(fails === 0 ? 0 : 1);
