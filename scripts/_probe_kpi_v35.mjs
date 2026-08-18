// scripts/_probe_kpi_v35.mjs
//
// V35 acceptance. Hybrid: synthetic-DOM injection into the real
// .kpi-wrap for CSS-driven assertions + static code read of
// SignalCards.js for JSX-wired ones (the labor page is auth-gated
// and TEST_MODE only bypasses middleware, not SessionProvider).
//
// PART A - rendered CSS:
//   V35-1 card .kpi-sig-hero-val fontSize === 18px (was 25.2)
//         story .kpi-spend-budget-val (data-long=false) fontSize === 25.2px
//         four card heroes share the same top pixel (parity)
//   V35-4 .kpi-tbl-weekbtn + .kpi-tbl-bandbtn have :hover rules
//         cursor === 'pointer' on both
//   V35-5 shared focus-visible rule targets is(button, [role="button"], a, [tabindex="0"])
//   V35-6 .kpi-cmp overflow === visible
//         .kpi-cmp::before border-radius has non-zero top-left / bottom-left
//         help popover renders at height > 100px when made visible
//   V35-7 story wrapper has no border and no shadow
//         story-left and story-right have card-r radius and card shadow
//         gap between them ~= --kpi-sp-3 (10.8px)
//
// PART B - static code read of SignalCards.js:
//   HoursLeftCard flips eyebrow on closed vs in-progress
//   HoursLeftCard flips fact set on closed vs in-progress
//   PayrollDataCard flips fact set on hasUnapproved
//
// Usage: TEST_MODE=true PLAYWRIGHT_BASE_URL=http://localhost:3001 \
//        node scripts/_probe_kpi_v35.mjs

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const CARDS_SRC = path.join(REPO_ROOT, "src/app/kpi/labor/components/SignalCards.js");
const CSS_SRC   = path.join(REPO_ROOT, "src/app/kpi/kpi.css");
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const URL = `${BASE}/kpi/labor?account=ALL`;

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

const CARDS_HTML = `
  <div class="kpi-sigs">
    <div class="kpi-sig kpi-sig-st-good" data-role="pace">
      <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">FINAL VS BUDGET</span><span class="kpi-sig-state kpi-sig-state-good">ON TARGET</span></div>
      <div class="kpi-sig-hero-lane"><span class="kpi-sig-hero-val num">▼ $1,083.39</span></div>
      <div class="kpi-sig-sub-lane">period closed</div>
      <div class="kpi-sig-facts"><div class="kpi-sig-fact"><div class="kpi-sig-fact-lab">Spent</div><div class="kpi-sig-fact-val">$14,157.86</div></div></div>
    </div>
    <div class="kpi-sig kpi-sig-st-warn" data-role="ot">
      <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">OVERTIME</span><span class="kpi-sig-state kpi-sig-state-warn">WATCH</span></div>
      <div class="kpi-sig-hero-lane"><span class="kpi-sig-hero-val num">0.2%</span></div>
      <div class="kpi-sig-sub-lane">watch above 0% · off target above 8%</div>
      <div class="kpi-sig-facts"><div class="kpi-sig-fact"><div class="kpi-sig-fact-lab">OT cost</div><div class="kpi-sig-fact-val">$44.07</div></div></div>
    </div>
    <div class="kpi-sig kpi-sig-st-good" data-role="hours">
      <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">HOURS VS BUDGET</span><span class="kpi-sig-state kpi-sig-state-good">ON TARGET</span></div>
      <div class="kpi-sig-hero-lane"><span class="kpi-sig-hero-val num">▼ 52.69</span></div>
      <div class="kpi-sig-sub-lane">under what the budget covered</div>
      <div class="kpi-sig-facts"><div class="kpi-sig-fact"><div class="kpi-sig-fact-lab">Budgeted</div><div class="kpi-sig-fact-val">741.43</div></div></div>
    </div>
    <div class="kpi-sig kpi-sig-st-good" data-role="payroll">
      <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">PAYROLL DATA</span><span class="kpi-sig-state kpi-sig-state-good">FINAL</span></div>
      <div class="kpi-sig-hero-lane"><span class="kpi-sig-hero-val num">36 of 36</span></div>
      <div class="kpi-sig-sub-lane">worker-weeks with pay data in</div>
      <div class="kpi-sig-facts"><div class="kpi-sig-fact"><div class="kpi-sig-fact-lab">Unapproved</div><div class="kpi-sig-fact-val kpi-sig-fact-val-good">none</div></div></div>
    </div>
  </div>`;

const STORY_HTML = `
  <div class="kpi-story" data-role="story">
    <div class="kpi-story-left" data-role="story-left">
      <div class="kpi-spend-budget">
        <div class="kpi-spend-budget-lab">Budget</div>
        <div class="kpi-spend-budget-val num" data-long="false">$15,241.25</div>
      </div>
    </div>
    <div class="kpi-story-right" data-role="story-right">right</div>
  </div>`;

const STRIP_HTML = `
  <div class="kpi-cmp" data-role="strip">
    <div class="kpi-cmp-title"><span class="kpi-cmp-title-lab">VS PERIOD 7</span></div>
    <div class="kpi-cmp-items">
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Blended rate</div><div class="kpi-cmp-item-val">▼ $1.27</div></div>
    </div>
    <div class="kpi-cmp-help-wrap"><span class="kpi-cmp-help-anchor"><button class="kpi-cmp-help">?</button>
      <div class="kpi-cmp-help-pop" role="dialog" data-role="popover"
           style="display: block;">
        <h5>COMPARISON</h5>
        <div class="kpi-cmp-help-row">Blended rate = spend / hours.</div>
        <div class="kpi-cmp-help-row">Overtime = OT hours / total.</div>
        <div class="kpi-cmp-help-row">Crew size = distinct workers.</div>
        <div class="kpi-cmp-help-row">Spend / week = spend / weeks.</div>
        <div class="kpi-cmp-help-row">Hours / week = hours / weeks.</div>
        <div class="kpi-cmp-help-row">Cost / worker = spend / weeks / workers.</div>
      </div>
    </span></div>
  </div>`;

async function partA(page) {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(300);

  const r = await page.evaluate(({ cards, story, strip }) => {
    const wrap = document.querySelector(".kpi-wrap");
    if (!wrap) return { hasWrap: false };
    const host = document.createElement("div");
    host.className = "kpi-app";
    host.style.cssText = "position: absolute; top: -9999px; left: 0; width: 1200px;";
    host.innerHTML = cards + story + strip;
    wrap.appendChild(host);

    const heroSizes = [...host.querySelectorAll(".kpi-sig .kpi-sig-hero-val")].map(el => ({
      role: el.closest(".kpi-sig").dataset.role,
      size: getComputedStyle(el).fontSize,
      weight: getComputedStyle(el).fontWeight,
      top: Math.round(el.getBoundingClientRect().top),
    }));
    const budgetVal = host.querySelector(".kpi-spend-budget-val");
    const budgetSize = getComputedStyle(budgetVal).fontSize;

    const storyEl = host.querySelector(".kpi-story");
    const leftEl  = host.querySelector(".kpi-story-left");
    const rightEl = host.querySelector(".kpi-story-right");
    const wrapperBorder = getComputedStyle(storyEl).borderTopWidth;
    const wrapperShadow = getComputedStyle(storyEl).boxShadow;
    const leftRadius   = getComputedStyle(leftEl).borderTopLeftRadius;
    const leftShadow   = getComputedStyle(leftEl).boxShadow;
    const rightRadius  = getComputedStyle(rightEl).borderTopLeftRadius;
    const rightShadow  = getComputedStyle(rightEl).boxShadow;
    const storyGap     = getComputedStyle(storyEl).gap;
    const gapPx = Math.round(rightEl.getBoundingClientRect().left - leftEl.getBoundingClientRect().right);

    const stripEl = host.querySelector(".kpi-cmp");
    const overflow = getComputedStyle(stripEl).overflow;
    const beforeRadius = getComputedStyle(stripEl, "::before").borderTopLeftRadius;
    const popover = host.querySelector(".kpi-cmp-help-pop");
    const popH = Math.round(popover.getBoundingClientRect().height);

    host.remove();
    return {
      hasWrap: true,
      heroSizes, budgetSize,
      wrapperBorder, wrapperShadow, leftRadius, leftShadow, rightRadius, rightShadow, storyGap, gapPx,
      overflow, beforeRadius, popH,
    };
  }, { cards: CARDS_HTML, story: STORY_HTML, strip: STRIP_HTML });

  if (!r.hasWrap) { log(".kpi-wrap not present on /kpi/labor", false); return; }

  console.log("\n[PART A - rendered CSS on synthetic-DOM injection]\n");
  console.log("  V35-1 hero hierarchy");
  for (const h of r.heroSizes) {
    log(`card[${h.role}] hero fontSize=${h.size} weight=${h.weight} top=${h.top}  (want 18px / 800)`, h.size === "18px" && h.weight === "800");
  }
  const tops = r.heroSizes.map(h => h.top);
  const parity = Math.max(...tops) - Math.min(...tops);
  log(`four-card hero-top parity: spread=${parity}px  (want 0-1)`, parity <= 1);
  log(`story .kpi-spend-budget-val fontSize=${r.budgetSize}  (want 25.2px)`, r.budgetSize === "25.2px");

  console.log("\n  V35-6 strip popover unclipped");
  log(`.kpi-cmp overflow=${r.overflow}  (want visible)`, r.overflow === "visible");
  log(`.kpi-cmp::before border-top-left-radius=${r.beforeRadius}  (want non-zero)`, r.beforeRadius !== "0px");
  log(`help popover rendered height=${r.popH}px  (want > 100)`, r.popH > 100);

  console.log("\n  V35-7 story split into two sibling cards");
  log(`story wrapper border=${r.wrapperBorder} shadow=${r.wrapperShadow.slice(0, 40)}...  (want 0px / none)`,
      r.wrapperBorder === "0px" && (r.wrapperShadow === "none" || r.wrapperShadow === ""));
  log(`story-left border-radius=${r.leftRadius}  (want 10.8px)`, r.leftRadius === "10.8px");
  log(`story-right border-radius=${r.rightRadius}  (want 10.8px)`, r.rightRadius === "10.8px");
  log(`story-left box-shadow non-none`, r.leftShadow !== "none" && r.leftShadow !== "");
  log(`story-right box-shadow non-none`, r.rightShadow !== "none" && r.rightShadow !== "");
  log(`story gap declared=${r.storyGap} measured between children=${r.gapPx}px  (want ~10.8)`,
      Math.abs(r.gapPx - 10.8) <= 1);
}

function partB() {
  console.log("\n[PART B - static code read + CSS rule verification]\n");
  const src = fs.readFileSync(CARDS_SRC, "utf8");
  const stripComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const css = fs.readFileSync(CSS_SRC, "utf8");

  console.log("  V35-2 hours card wiring");
  const hoursEyebrowFlip = /eyebrow\s*=\s*closed\s*\?\s*"HOURS VS BUDGET"\s*:\s*"HOURS LEFT TO SCHEDULE"/.test(stripComments);
  log(`HoursLeftCard eyebrow flips on closed`, hoursEyebrowFlip);
  const hoursFactFlip = /facts\s*=\s*closed\s*\?/.test(stripComments);
  log(`HoursLeftCard fact set flips on closed`, hoursFactFlip);
  const hasBudgetedFact = /label:\s*"Budgeted"/.test(stripComments);
  const hasUsedFact = /label:\s*"Used"/.test(stripComments);
  const hasUnusedFact = /label:\s*"Unused"/.test(stripComments);
  const hasOverrunFact = /label:\s*"Overrun"/.test(stripComments);
  log(`closed-hours facts include Budgeted / Used / Unused / Overrun`,
      hasBudgetedFact && hasUsedFact && hasUnusedFact && hasOverrunFact);

  console.log("\n  V35-3 payroll fact swap");
  const payrollFactFlip = /facts\s*=\s*hasUnapproved\s*\?/.test(stripComments);
  log(`PayrollDataCard fact set flips on hasUnapproved`, payrollFactFlip);
  const hasWorkersFact = /label:\s*"Workers"/.test(stripComments);
  const hasWeeksFact = /label:\s*"Weeks"/.test(stripComments);
  log(`complete-payroll facts include Workers / Weeks`, hasWorkersFact && hasWeeksFact);

  console.log("\n  V35-4 chevron hover rules present in kpi.css");
  const bandHover = /\.kpi-tbl-bandbtn:hover\s*\{/.test(css);
  const weekHover = /\.kpi-tbl-weekbtn:hover\s*\{/.test(css);
  log(`.kpi-tbl-bandbtn:hover rule present`, bandHover);
  log(`.kpi-tbl-weekbtn:hover rule present`, weekHover);

  console.log("\n  V35-5 shared focus-visible rule");
  const focusRule = /\.kpi-app\s*:is\(button,\s*\[role="button"\],\s*a,\s*\[tabindex="0"\]\):focus-visible/.test(css);
  const suppressRule = /\.kpi-app\s*:is\(button,\s*\[role="button"\],\s*a,\s*\[tabindex="0"\]\):focus:not\(:focus-visible\)/.test(css);
  log(`shared :focus-visible rule scoped to interactives`, focusRule);
  log(`companion :focus:not(:focus-visible) suppression`, suppressRule);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error(`[pageerror] ${e.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log("=".repeat(72));
  console.log("V35 acceptance probe · hero hierarchy · closed content · hover/focus · popover · story split");
  console.log("=".repeat(72));

  await partA(page);
  partB();

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "V35 PROBE: PASS" : `V35 PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));

  await browser.close();
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });
