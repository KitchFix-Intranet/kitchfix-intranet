// Chromium probe for the Academy room composition (room-comp PR).
// Loads /opd, asserts:
//   - Shell max-width is 1520px (--sc2-shell-max)
//   - Top-level card count = 4 (1 primary + Year + Record + Standing)
//   - No emoji in operator copy (visible text)
//   - No obligation_key text in visible copy or title attributes
//   - Company Standing site expands on click
//   - Font-stack + transition:all counts

import { chromium } from "@playwright/test";

const width = Number(process.argv[2] || 1520);
const height = Number(process.argv[3] || 1000);

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
await page.waitForSelector(".opd-prim", { timeout: 25000 });

const measurements = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      selector: sel,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
    };
  };
  const shell = document.querySelector(".opd-frame");
  const shellMaxWidth = shell ? getComputedStyle(shell).maxWidth : null;
  const topLevelCards = document.querySelectorAll(
    ".opd-room--v5 > .opd-prim, .opd-room--v5 .opd-srow > .opd-scol > .opd-card2, .opd-room--v5 .opd-srow > .opd-card2"
  );
  // Distinct font stacks
  const fontStacks = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const ff = cs.fontFamily || "";
    if (!ff) continue;
    fontStacks.set(ff, (fontStacks.get(ff) || 0) + 1);
  }
  // Active transition:all
  let transitionAllActive = 0;
  const trAllTops = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (!(cs.transitionProperty || "").split(",").map(s => s.trim()).includes("all")) continue;
    const durs = (cs.transitionDuration || "").split(",").map(s => s.trim());
    if (!durs.some(d => parseFloat(d) > 0)) continue;
    transitionAllActive += 1;
    const key = typeof el.className === "string"
      ? "." + el.className.split(/\s+/).filter(Boolean).slice(0,2).join(".")
      : el.tagName.toLowerCase();
    trAllTops.set(key, (trAllTops.get(key) || 0) + 1);
  }
  // Sniff visible operator text for emoji + obligation_key patterns.
  const emojiRE = /[\p{Extended_Pictographic}]/u;
  const obligationKeys = ["culture-os", "culinary-os", "big-rules-onboarding", "culture-os-origin", "culture-os-standard", "culinary-os-philosophy", "culinary-os-standards"];
  const emojiSightings = [];
  const obKeySightings = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const t = n.nodeValue || "";
    if (emojiRE.test(t)) emojiSightings.push(t.substring(0, 80));
    for (const k of obligationKeys) {
      if (t.toLowerCase().includes(k)) obKeySightings.push(`"${k}" in "${t.substring(0, 80)}"`);
    }
  }
  // Also check title attributes.
  const titleLeaks = [];
  for (const el of document.querySelectorAll("[title]")) {
    const t = el.getAttribute("title") || "";
    for (const k of obligationKeys) {
      if (t.toLowerCase().includes(k)) titleLeaks.push(`"${k}" in title="${t}"`);
    }
  }
  return {
    shellMaxWidth,
    prim: pick(".opd-prim"),
    prail: pick(".opd-prail"),
    pq: pick(".opd-pq"),
    setCount: document.querySelectorAll(".opd-room--v5 .opd-set").length,
    topLevelCardCount: topLevelCards.length,
    distinctFontStacks: [...fontStacks.entries()].map(([stack, count]) => ({ stack, count })).sort((a,b) => b.count - a.count),
    transitionAllActive,
    transitionAllTop: [...trAllTops.entries()].sort((a,b) => b[1] - a[1]).slice(0, 8),
    emojiSightings,
    obKeySightings,
    titleLeaks,
  };
});

// Click a site row + verify expand.
let expandTest = null;
try {
  const firstSite = page.locator(".opd-cr").first();
  await firstSite.click();
  await page.waitForSelector(".opd-exp--on", { timeout: 5000 });
  expandTest = await page.evaluate(() => ({
    expanded: !!document.querySelector(".opd-cr--op"),
    peopleShown: document.querySelectorAll(".opd-exp--on .opd-pp").length,
  }));
} catch (e) {
  expandTest = { error: String(e).substring(0, 200) };
}

console.log(JSON.stringify({
  viewport: { width, height },
  pageErrors: errors,
  ...measurements,
  expandTest,
}, null, 2));

await browser.close();
