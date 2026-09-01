// Headless-Chromium measurement probe for the stepper refinement PR.
// Loads /opd, opens a module, then reports:
//   - transition-property:all element count
//   - distinct font-family stacks used on visible elements
//   - computed style for the module h1 + step h2 + step body
//   - card width vs prose width
//   - rail position + whether it actually stays put on scroll

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

// Open the first NON-signed queue row (a signed row renders the cert,
// not the stepper).
const openRow = page.locator(".opd-queue-row:not(.opd-queue-row--done)").first();
await openRow.waitFor({ timeout: 10000 });
await openRow.click();
try {
  await page.waitForSelector(".opd-focus-step-h2", { timeout: 25000 });
} catch (e) {
  console.error("errors:", errors.join(" | "));
  const url = page.url();
  console.error("url:", url);
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800));
  console.error("body:", bodyText);
  throw e;
}

const result = await page.evaluate(() => {
  const walk = document.querySelectorAll("*");
  let transitionAllCount = 0;
  const fontStacks = new Map();
  for (const el of walk) {
    const cs = getComputedStyle(el);
    if ((cs.transitionProperty || "").split(",").map(s => s.trim()).includes("all")) {
      transitionAllCount += 1;
    }
    const ff = cs.fontFamily;
    if (!ff) continue;
    if (!fontStacks.has(ff)) fontStacks.set(ff, 0);
    fontStacks.set(ff, fontStacks.get(ff) + 1);
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
    };
  };

  return {
    transitionAllCount,
    distinctFontStacks: [...fontStacks.entries()].map(([stack, count]) => ({ stack, count })).sort((a, b) => b.count - a.count),
    moduleH1: pick(".opd-focus-mhead-title h1"),
    stepH2: pick(".opd-focus-step-h2"),
    stepBody: pick(".opd-focus-step-body"),
    card: pick(".opd-focus-step"),
    rail: pick(".opd-focus-rail--stepper"),
    docChip: pick(".opd-focus-mhead .opd-doc-chip"),
    railStepNum: pick(".opd-focus-rail-step-num"),
    mheadTimeB: pick(".opd-focus-mhead-time b"),
  };
});

// Scroll test - does the rail actually stick?
const scrollTest = await page.evaluate(async () => {
  const rail = document.querySelector(".opd-focus-rail--stepper");
  if (!rail) return null;
  const beforeTop = rail.getBoundingClientRect().top;
  window.scrollBy(0, 200);
  await new Promise(r => setTimeout(r, 100));
  const afterTop = rail.getBoundingClientRect().top;
  return { beforeTop: Math.round(beforeTop), afterTop: Math.round(afterTop), scrollY: Math.round(window.scrollY) };
});

console.log(JSON.stringify({ viewport: { width, height }, ...result, scrollTest }, null, 2));

// Bonus: which classes still have transition:all AND a NONZERO
// duration? Those are the ones that actually animate. Elements
// without any transition rule inherit "all" as the CSS initial
// value but with duration 0 - they never animate.
const transitionAllClasses = await page.evaluate(() => {
  const counts = new Map();
  let activeCount = 0;
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (!(cs.transitionProperty || "").split(",").map(s=>s.trim()).includes("all")) continue;
    const durations = (cs.transitionDuration || "").split(",").map(s=>s.trim());
    const hasNonzero = durations.some(d => parseFloat(d) > 0);
    if (!hasNonzero) continue;
    activeCount += 1;
    const key = el.className && typeof el.className === "string"
      ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
      : el.tagName.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    activeCount,
    top: [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20).map(([k,v])=>({sel:k, count:v})),
  };
});
console.log("---transition:all remaining (active only)---");
console.log(JSON.stringify(transitionAllClasses, null, 2));

// Where do the "outlier" font stacks come from?
const fontStackSample = await page.evaluate(() => {
  const buckets = new Map();
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const ff = cs.fontFamily || "";
    const first = ff.split(",")[0].trim();
    if (first === "Inter" || first === '"Inter"' || first === "'Inter'") continue;
    if (first.includes("Mono")) continue;
    if (!buckets.has(ff)) buckets.set(ff, []);
    const list = buckets.get(ff);
    if (list.length < 3) list.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").substring(0, 60),
      id: el.id || null,
    });
  }
  return [...buckets.entries()].map(([stack, samples]) => ({ stack, samples }));
});
console.log("---non-Inter/mono font stacks + samples---");
console.log(JSON.stringify(fontStackSample, null, 2));

await browser.close();
