// Density-pass gate probe (spec 18.2 amended).
//
// Room:
//   - No top band (measured by absence of the old .opd-phead h1)
//   - Two cards on one gutter, equal-height columns
//   - Every set is a bordered block (not full-bleed rules)
//   - Lessons list caps + counted "N more below" cue when short viewport
//   - One text left-edge across set/part/solo rows
//   - Due column right-aligned across all rows
//   - No amber due chip while more than 5 days remain
//
// Module:
//   - No breadcrumb (nav.opd-crumb absent)
//   - Academy button in footer with opd-bt--home
//   - AGR-001: 9 sections + Sign fits without page scroll at 1520
//   - Rail scrolls independently
//   - Footer pinned

import { chromium } from "@playwright/test";

const width = Number(process.argv[2] || 1520);
const height = Number(process.argv[3] || 900);
const viewMode = process.argv[4] || "room"; // "room" or "module"

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height },
  storageState: { cookies: [], origins: [] },
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/opd", { waitUntil: "networkidle" });
await page.waitForSelector(".opd-pgrid", { timeout: 25_000 });

if (viewMode === "module") {
  // Open AGR-001 (9-section module) - it's the "solo" doc; the whole
  // .opd-set.opd-set--solo is the click target now.
  const bigRules = page.locator(".opd-set--solo").filter({ hasText: /Big Rules/i }).first();
  await bigRules.waitFor({ timeout: 10_000 });
  await bigRules.click();
  await page.waitForSelector(".opd-uni", { timeout: 25_000 });
  await page.waitForSelector(".opd-uni .opd-urail .opd-sr", { timeout: 15_000 });

  const modStats = await page.evaluate(() => {
    const app = document.querySelector(".opd-app");
    const cs = app ? getComputedStyle(app) : null;
    const uni = document.querySelector(".opd-uni");
    const uhead = document.querySelector(".opd-uhead");
    const ufoot = document.querySelector(".opd-ufoot");
    const rail = document.querySelector(".opd-urail");
    const pane = document.querySelector(".opd-upane");
    const crumb = document.querySelector(".opd-crumb");
    const home = document.querySelector(".opd-bt--home");
    const railItems = document.querySelectorAll(".opd-urail-list .opd-sr");

    // Body scrollable? If document.body's scrollHeight > innerHeight,
    // the page scrolls.
    const pageScrollable = document.documentElement.scrollHeight > window.innerHeight + 2;

    return {
      chromeVar: cs?.getPropertyValue("--opd-chrome").trim() || null,
      cardWidth: uni ? Math.round(uni.getBoundingClientRect().width) : null,
      cardHeight: uni ? Math.round(uni.getBoundingClientRect().height) : null,
      cardTop: uni ? Math.round(uni.getBoundingClientRect().top) : null,
      cardBottom: uni ? Math.round(uni.getBoundingClientRect().bottom) : null,
      windowHeight: window.innerHeight,
      pageScrollable,
      docScrollHeight: document.documentElement.scrollHeight,
      docBodyBottom: document.body ? Math.round(document.body.getBoundingClientRect().bottom) : null,
      frameBottom: (() => { const e = document.querySelector(".opd-frame"); return e ? Math.round(e.getBoundingClientRect().bottom) : null; })(),
      shellBottom: (() => { const e = document.querySelector(".opd-shell"); return e ? Math.round(e.getBoundingClientRect().bottom) : null; })(),
      sbodyBottom: (() => { const e = document.querySelector(".opd-sbody"); return e ? Math.round(e.getBoundingClientRect().bottom) : null; })(),
      hasBreadcrumb: !!crumb,
      hasHomeButton: !!home,
      railItemCount: railItems.length,
      railScrollableInternal: rail ? (rail.scrollHeight > rail.clientHeight + 2) : null,
      railComputed: rail ? {
        overflowY: getComputedStyle(rail).overflowY,
        height: Math.round(rail.getBoundingClientRect().height),
      } : null,
      paneComputed: pane ? {
        overflowY: getComputedStyle(pane).overflowY,
        height: Math.round(pane.getBoundingClientRect().height),
      } : null,
      footerBottom: ufoot ? Math.round(ufoot.getBoundingClientRect().bottom) : null,
      footerPinned: (uni && ufoot)
        ? Math.round(ufoot.getBoundingClientRect().bottom) <= Math.round(uni.getBoundingClientRect().bottom) + 2
        : null,
      headerTop: uhead ? Math.round(uhead.getBoundingClientRect().top) : null,
    };
  });

  console.log(JSON.stringify({ viewport: { width, height }, module: modStats, pageErrors: errors }, null, 2));
  await browser.close();
  process.exit(0);
}

// ROOM
const stats = await page.evaluate(() => {
  const app = document.querySelector(".opd-app");
  const cs = app ? getComputedStyle(app) : null;
  const pgrid = document.querySelector(".opd-pgrid");
  const prail = document.querySelector(".opd-prail");
  const lcard = document.querySelector(".opd-lcard");
  const oldGreetH1 = document.querySelector(".opd-phead h1");

  // Text left-edges across row types.
  const setH = document.querySelector(".opd-lbody > .opd-set:not(.opd-set--solo) .opd-seth h3");
  const solo = document.querySelector(".opd-lbody > .opd-set--solo .opd-seth h3");
  const partH = document.querySelector(".opd-lbody .opd-pr .opd-pb h4");
  // Due-column right edges.
  const pms = [...document.querySelectorAll(".opd-lbody .opd-pm")];
  // Go/Start buttons.
  const gos = [...document.querySelectorAll(".opd-lbody .opd-go")];

  // Amber-due check: any .opd-pm-a--urg while cycle has > 5 days.
  const urg = document.querySelectorAll(".opd-lbody .opd-pm-a--urg").length;
  const daysLeftText = document.querySelector(".opd-duel-b")?.textContent || "";
  const daysLeft = parseInt(daysLeftText, 10);

  return {
    kfScale: cs?.getPropertyValue("--kf-scale").trim() || null,
    gut: cs?.getPropertyValue("--opd-gut").trim() || null,
    lead: cs?.getPropertyValue("--opd-lead").trim() || null,
    lmax: cs?.getPropertyValue("--opd-lmax").trim() || null,
    hasOldGreetBand: !!oldGreetH1,
    pgridColCount: pgrid ? getComputedStyle(pgrid).gridTemplateColumns.split(" ").length : null,
    railHeight: prail ? Math.round(prail.getBoundingClientRect().height) : null,
    lcardHeight: lcard ? Math.round(lcard.getBoundingClientRect().height) : null,
    equalHeightWithin2px: prail && lcard
      ? Math.abs(prail.getBoundingClientRect().height - lcard.getBoundingClientRect().height) <= 2
      : null,
    setHeaderTitleLeft: setH ? Math.round(setH.getBoundingClientRect().left) : null,
    soloTitleLeft: solo ? Math.round(solo.getBoundingClientRect().left) : null,
    partTitleLeft: partH ? Math.round(partH.getBoundingClientRect().left) : null,
    dueRightEdges: pms.map((el) => Math.round(el.getBoundingClientRect().right)),
    goRightEdges: gos.map((el) => Math.round(el.getBoundingClientRect().right)),
    amberDueCountWhilePlenty: (daysLeft > 5) ? urg : "n/a",
    daysLeft,
    lineThroughCount: [...document.querySelectorAll("*")].filter((el) => (getComputedStyle(el).textDecorationLine || "").split(" ").includes("line-through")).length,
    nullOccurrences: (document.body.innerText || "").match(/\bnull\b/g)?.length || 0,
    obligationKeyLeaks: (() => {
      const t = (document.body.innerText || "").toLowerCase();
      return ["culture-os-standard", "culinary-os-standards", "big-rules-onboarding"].filter((k) => t.includes(k)).length;
    })(),
  };
});

console.log(JSON.stringify({ viewport: { width, height }, room: stats, pageErrors: errors }, null, 2));
await browser.close();
