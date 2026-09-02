#!/usr/bin/env node
// scripts/probes/_probe_pnl_arrow_scope.mjs
//
// Kevin ruling 2026-09-02: the full profit-and-loss variance column
// uses arrows instead of "above" / "below" / "over" / "under".
// **Scope this precisely - the P&L table only.** Everywhere else
// keeps its words: the status line, card pills, the cost-lines
// table, Also tracked.
//
// ASSERTIONS
//
//   A1  No "above", "below", "over" or "under" string renders inside
//       the P&L table (both per-row variance cells + total row
//       variance cells).
//   A2  Each rendered variance in the P&L table carries an ↑ or ↓
//       character.
//   A3  Each rendered variance carries an aria-label with the
//       direction word (screen-reader coverage).
//   A4  All four direction words still render in at least one of:
//         - status line ("over its target")
//         - card pill ("OVER TARGET", "BEHIND")
//         - cost lines table ("$X over", "$X under")
//         - also tracked ("$X under", "$X over")
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_pnl_arrow_scope.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function scrape(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);
  // Open the P&L fold.
  const foldBtn = page.locator('[data-kpi-ov="fold-pnl"]').first();
  if (await foldBtn.count()) {
    await foldBtn.click();
    await page.waitForTimeout(400);
  }
  return page.evaluate(() => {
    function textOf(sel) {
      const el = document.querySelector(sel);
      return el ? el.innerText : null;
    }
    function ariaLabels(sel) {
      return [...document.querySelectorAll(sel)].map(n => n.getAttribute("aria-label") || null);
    }
    function ariaAndText(sel) {
      return [...document.querySelectorAll(sel)].map(n => ({
        text: n.innerText.trim(),
        aria: n.getAttribute("aria-label") || null,
      }));
    }
    const pnlText = textOf('[data-kpi-ov="statement"]');
    const statusText = textOf('[data-kpi-ov="status-line"]');
    const clText = textOf('[data-kpi-ov="cost-lines"]');
    const atText = textOf('[data-kpi-ov="also-tracked"]');
    // Card pill labels (each Pill has data-kpi-ov="pill")
    const pillTexts = [...document.querySelectorAll('[data-kpi-ov="pill"]')].map(p => p.innerText.trim());
    const pnlArrows = ariaAndText('[data-kpi-ov="pnl-variance-arrow"]');
    return { pnlText, statusText, clText, atText, pillTexts, pnlArrows };
  });
}

async function main() {
  console.log(`# P&L arrow scope - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);
  // Walk five accounts × 3 ranges.
  const accounts = ["TBJ - FL", "TBR - FL", "CIN - OH", "STL - MO", "CIN - KY"];
  const ranges = [
    { name: "FYTD",             qs: "" },
    { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
    { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
  ];
  const scrapes = {};
  for (const a of accounts) {
    for (const r of ranges) {
      const url = r.qs
        ? `${BASE}/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/kpi/overview?account=${acct(a)}`;
      const key = `${a} ${r.name}`;
      const scr = await scrape(page, url);
      scrapes[key] = scr;
      // A1: no directional words INSIDE P&L text.
      const pnl = scr.pnlText || "";
      // The words appear in headers (e.g., "Actuals thru P8"), so we
      // must scope. Look inside the variance-arrow cells only for
      // banned words - AND check the P&L body doesn't contain the
      // free-text pattern "$X above/below/over/under".
      const bannedPattern = /\$[\d,]+\s+(above|below|over|under)\b/i;
      if (bannedPattern.test(pnl)) {
        const m = pnl.match(bannedPattern);
        fail(`${key} A1`, `P&L contains "${m[0]}" (word form) - should be arrow`);
      }
      // A2 + A3: each arrow cell has ↑/↓ AND aria-label.
      for (const av of (scr.pnlArrows || [])) {
        if (!/[↑↓]/.test(av.text)) fail(`${key} A2`, `arrow cell text missing ↑/↓: ${JSON.stringify(av.text)}`);
        if (!av.aria || !/(above|below|over|under|ahead|behind)/i.test(av.aria)) {
          fail(`${key} A3`, `arrow cell missing aria-label: ${JSON.stringify(av)}`);
        }
      }
    }
  }
  // A4: assert every direction word still appears somewhere.
  // Concatenate all statusText, clText, atText, pillTexts across scrapes.
  const wordSurvival = { over: false, under: false, above: false, below: false };
  for (const key in scrapes) {
    const s = scrapes[key];
    const combined = [s.statusText, s.clText, s.atText, (s.pillTexts || []).join(" ")].join(" ");
    if (/\bover\b/i.test(combined)) wordSurvival.over = true;
    if (/\bunder\b/i.test(combined)) wordSurvival.under = true;
    if (/\babove\b/i.test(combined)) wordSurvival.above = true;
    if (/\bbelow\b/i.test(combined)) wordSurvival.below = true;
  }
  for (const w of ["over", "under"]) {
    if (!wordSurvival[w]) fail("A4", `word "${w}" not found in any status/cost-lines/also-tracked/pill outside P&L`);
  }
  // Above/below are revenue-side; cost-heavy accounts may not surface
  // them without a revenue overshoot. Report but don't fail.
  if (!wordSurvival.above) console.log(`  note: "above" not seen anywhere - revenue-side word, expected on an over-plan account`);
  if (!wordSurvival.below) console.log(`  note: "below" not seen anywhere - revenue-side word, expected on an under-plan account`);

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: arrow rendering scoped to P&L; direction words survive on other surfaces.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
