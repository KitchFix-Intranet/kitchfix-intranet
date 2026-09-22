#!/usr/bin/env node
// Consolidation PR 1 follow-up · verify CSS scoping.
//   · On /kpi/overview inside a fold, .kpi-tbl-wrap has
//     transparent bg, 0 border, 0 radius, no shadow.
//   · On the labor page itself (rendered via same TEST_MODE prod),
//     the client-side useSession() gate blocks reaching the DOM,
//     so instead we verify the CSS rule is SCOPED - a synthetic
//     .kpi-tbl-wrap outside .kpi-ov-fold-card must keep its card
//     chrome. Done by injecting two probe elements onto the
//     Overview page and reading computed styles.
//
// Screenshots of both folds open, before/after, so Kevin can eye
// it rather than take our word.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
mkdirSync("/tmp/kf-consol-shots", { recursive: true });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();

async function openOverview(url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => /Period running|Period closed|Planning view|Off season/i.test(document.body.innerText || ""), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2000);
}

async function openLaborFold() {
  await p.evaluate(() => {
    const t = document.querySelector('[data-kpi-ov="fold-labor"]');
    if (t) t.click();
  });
  await p.waitForTimeout(1500);
}

async function openPnlFold() {
  await p.evaluate(() => {
    const t = document.querySelector('[data-kpi-ov="fold-pnl"]');
    if (t) t.click();
  });
  await p.waitForTimeout(1500);
}

async function computedForSelector(sel) {
  return p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderRadius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow,
    };
  }, sel);
}

// Test on TBJ - FL P9 · both folds open · screenshot
console.log("Probe · TBJ - FL P9 · both folds open");
await openOverview(`${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06`);
await openPnlFold();
await openLaborFold();
await p.waitForTimeout(1500);

const foldWrapStyles = await computedForSelector('[data-kpi-ov="labor-ledger"] .kpi-tbl-wrap');
console.log("  labor fold .kpi-tbl-wrap computed:");
console.log("    " + JSON.stringify(foldWrapStyles, null, 2).split("\n").join("\n    "));

let fails = 0;
const record = (ok, label) => { if (!ok) { fails += 1; console.log("  FAIL · " + label); } else console.log("  PASS · " + label); };

if (foldWrapStyles) {
  const isTransparent = foldWrapStyles.backgroundColor === "rgba(0, 0, 0, 0)" || foldWrapStyles.backgroundColor === "transparent";
  const noBorder = foldWrapStyles.borderTopWidth === "0px";
  const noRadius = foldWrapStyles.borderRadius === "0px";
  const noShadow = foldWrapStyles.boxShadow === "none";
  record(isTransparent, "background transparent (was rgb(255,255,255))");
  record(noBorder, "no top border (was 0.555556px)");
  record(noRadius, "no border radius (was 10.8px)");
  record(noShadow, "no box shadow (was rgba(10,37,72,0.06) 0 1 2 0)");
} else {
  fails += 1;
  console.log("  FAIL · could not find labor fold .kpi-tbl-wrap");
}

// Verify scoping · inject a synthetic .kpi-tbl-wrap OUTSIDE the
// fold and confirm it still carries the labor page's card chrome.
const synthStyles = await p.evaluate(() => {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.top = "-9999px";
  holder.innerHTML = '<div class="kpi-app"><div class="kpi-tbl-wrap"><div class="kpi-tbl-scroll">x</div></div></div>';
  document.body.appendChild(holder);
  const el = holder.querySelector(".kpi-tbl-wrap");
  const cs = getComputedStyle(el);
  const out = {
    backgroundColor: cs.backgroundColor,
    borderTopWidth: cs.borderTopWidth,
    borderRadius: cs.borderTopLeftRadius,
    boxShadow: cs.boxShadow,
  };
  holder.remove();
  return out;
});
console.log();
console.log("Scoped check · synthetic .kpi-tbl-wrap outside fold retains card chrome:");
console.log("    " + JSON.stringify(synthStyles, null, 2).split("\n").join("\n    "));

const outsideNotTransparent = synthStyles.backgroundColor !== "rgba(0, 0, 0, 0)" && synthStyles.backgroundColor !== "transparent";
const outsideHasBorder = synthStyles.borderTopWidth !== "0px";
const outsideHasRadius = synthStyles.borderRadius !== "0px";
const outsideHasShadow = synthStyles.boxShadow !== "none";
record(outsideNotTransparent, "outside fold · background is opaque");
record(outsideHasBorder, "outside fold · has border");
record(outsideHasRadius, "outside fold · has radius");
record(outsideHasShadow, "outside fold · has shadow");

// Screenshot both folds open, full page
await p.screenshot({ path: "/tmp/kf-consol-shots/after-tbj-fl-p9-both-folds.png", fullPage: true });
console.log();
console.log("Screenshot saved: /tmp/kf-consol-shots/after-tbj-fl-p9-both-folds.png");

// Focus screenshot on the labor fold only
const foldBox = await p.evaluate(() => {
  const el = document.querySelector('[data-kpi-ov="labor-ledger"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (foldBox) {
  // Scroll into view, then screenshot
  await p.evaluate(() => { document.querySelector('[data-kpi-ov="labor-ledger"]').scrollIntoView({ behavior: "instant", block: "start" }); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: "/tmp/kf-consol-shots/after-labor-fold-only.png" });
  console.log("Screenshot saved: /tmp/kf-consol-shots/after-labor-fold-only.png");
}

// Narrow width check · 400px
console.log();
console.log("Narrow width check · 400px viewport");
await p.setViewportSize({ width: 400, height: 900 });
await p.waitForTimeout(300);
await p.evaluate(() => { document.querySelector('[data-kpi-ov="labor-ledger"]').scrollIntoView({ behavior: "instant", block: "start" }); });
await p.waitForTimeout(300);
const narrow = await p.evaluate(() => {
  const scroll = document.querySelector('[data-kpi-ov="labor-ledger"] .kpi-tbl-scroll');
  const body = document.body;
  return {
    scrollOverflowX: scroll ? getComputedStyle(scroll).overflowX : null,
    scrollHasHScroll: scroll ? scroll.scrollWidth > scroll.clientWidth : null,
    bodyScrollWidth: body.scrollWidth,
    bodyClientWidth: body.clientWidth,
    pageScrollsX: body.scrollWidth > body.clientWidth,
  };
});
console.log("  " + JSON.stringify(narrow, null, 2).split("\n").join("\n  "));
record(narrow.scrollOverflowX === "auto" || narrow.scrollOverflowX === "scroll", "labor .kpi-tbl-scroll still scrolls horizontally");
record(!narrow.pageScrollsX, "page body does NOT scroll horizontally at 400px");

await p.screenshot({ path: "/tmp/kf-consol-shots/after-narrow-400.png", fullPage: true });
console.log("Screenshot saved: /tmp/kf-consol-shots/after-narrow-400.png");

await b.close();
console.log();
console.log(fails === 0 ? "Consolidation PR 1 follow-up · PASS · all checks held" : `Consolidation PR 1 follow-up · FAIL · ${fails} mismatches`);
process.exit(fails === 0 ? 0 : 1);
