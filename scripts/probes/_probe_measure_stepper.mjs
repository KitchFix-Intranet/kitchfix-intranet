// Chromium probe for the one-card module surface (composition PR).
// Loads /opd, opens a module, measures:
//   - Distinct font-family stacks (visible + total)
//   - Elements computing transition-property: all with nonzero
//     duration (the ones that actually animate)
//   - --kf-scale + two derived tokens on .opd-app
//   - Card width vs prose width
//   - Rail position + does it stick on scroll
//   - Reading pane cap: does short content show no scrollbar?
//     Does long content cap and scroll?
//
// Usage: node scripts/probes/_probe_measure_stepper.mjs [width] [height]
// Requires TEST_MODE=true dev server on http://localhost:3000.

import { chromium } from "@playwright/test";

const width = Number(process.argv[2] || 1280);
const height = Number(process.argv[3] || 900);

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
await page.waitForSelector(".opd-queue-row", { timeout: 30000 });

// Prefer culture-os-standard (PB-014, part 2 of 2) if present - it
// has checks and isn't saturated from prior test runs. Fall back to
// the first non-signed row otherwise.
let target = page.locator(".opd-queue-row")
  .filter({ hasText: /PB-014/i })
  .filter({ hasText: /part\s+2\s+of\s+2/i })
  .first();
if (await target.count() === 0) {
  target = page.locator(".opd-queue-row:not(.opd-queue-row--done)").first();
}
await target.waitFor({ timeout: 10000 });
await target.click();

try {
  await page.waitForSelector(".opd-uni .opd-ucw h2", { timeout: 25000 });
} catch (e) {
  console.error("errors:", errors.join(" | "));
  console.error("url:", page.url());
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800));
  console.error("body:", bodyText);
  throw e;
}

const result = await page.evaluate(() => {
  const walk = document.querySelectorAll("*");
  const fontStacks = new Map();
  for (const el of walk) {
    const cs = getComputedStyle(el);
    const ff = cs.fontFamily || "";
    if (!ff) continue;
    fontStacks.set(ff, (fontStacks.get(ff) || 0) + 1);
  }

  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      selector: sel,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      position: cs.position,
      top: cs.top,
      maxHeight: cs.maxHeight,
      overflow: cs.overflow,
      overflowY: cs.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  };

  const rootStyle = getComputedStyle(document.querySelector(".opd-app"));
  const scaleTokens = {
    "--kf-scale": rootStyle.getPropertyValue("--kf-scale").trim(),
    "--opd-t-read": rootStyle.getPropertyValue("--opd-t-read").trim(),
    "--opd-measure": rootStyle.getPropertyValue("--opd-measure").trim(),
    "--opd-rail-w": rootStyle.getPropertyValue("--opd-rail-w").trim(),
    "--opd-ease": rootStyle.getPropertyValue("--opd-ease").trim(),
    "--opd-t-mid": rootStyle.getPropertyValue("--opd-t-mid").trim(),
  };

  return {
    distinctFontStacks: [...fontStacks.entries()].map(([stack, count]) => ({ stack, count })).sort((a, b) => b.count - a.count),
    moduleH1: pick(".opd-uni .opd-uhead-title h1"),
    stepH2: pick(".opd-uni .opd-ucw h2"),
    stepBody: pick(".opd-ucw"),
    stepPara: pick(".opd-ucw p"),
    stepParaWhich: (() => {
      const el = document.querySelector(".opd-ucw p");
      if (!el) return null;
      // Report parent chain + text snippet + rule that applied.
      const chain = [];
      let n = el;
      while (n && n !== document.body) {
        chain.push(`${n.tagName.toLowerCase()}${n.className ? "." + String(n.className).split(/\s+/).join(".") : ""}`);
        n = n.parentElement;
      }
      return { chain, text: (el.innerText || "").substring(0, 80) };
    })(),
    card: pick(".opd-uni"),
    rail: pick(".opd-urail"),
    pane: pick(".opd-upane"),
    docChip: pick(".opd-uhead .opd-doc-chip"),
    railStepNum: pick(".opd-sr-b"),
    mheadTimeB: pick(".opd-uhead-rt b"),
    scaleTokens,
  };
});

// Scroll test - does the rail stay near the top of the viewport
// when we scroll the page? (Not the pane's inner scroll.)
const scrollTest = await page.evaluate(async () => {
  const rail = document.querySelector(".opd-urail");
  if (!rail) return null;
  const beforeTop = rail.getBoundingClientRect().top;
  window.scrollBy(0, 200);
  await new Promise(r => setTimeout(r, 100));
  const afterTop = rail.getBoundingClientRect().top;
  return { beforeTop: Math.round(beforeTop), afterTop: Math.round(afterTop), scrollY: Math.round(window.scrollY) };
});

console.log(JSON.stringify({ viewport: { width, height }, ...result, scrollTest }, null, 2));

// Active transition-property: all count (nonzero duration).
const activeAll = await page.evaluate(() => {
  let count = 0;
  const bySel = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (!(cs.transitionProperty || "").split(",").map(s=>s.trim()).includes("all")) continue;
    const durs = (cs.transitionDuration || "").split(",").map(s=>s.trim());
    if (!durs.some(d => parseFloat(d) > 0)) continue;
    count += 1;
    const key = el.className && typeof el.className === "string"
      ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
      : el.tagName.toLowerCase();
    bySel.set(key, (bySel.get(key) || 0) + 1);
  }
  return {
    total: count,
    top: [...bySel.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([k,v])=>({sel:k, count:v})),
  };
});
console.log("---active transition:all (nonzero duration)---");
console.log(JSON.stringify(activeAll, null, 2));

await browser.close();
