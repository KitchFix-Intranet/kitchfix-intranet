import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/opd");
await p.waitForSelector(".opd-queue-row:not(.opd-queue-row--skel)", { timeout: 10000 });
async function css(sel, ...props) {
  return await p.$eval(sel, (el, props) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const out = { rect: { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } };
    for (const pr of props) out[pr] = cs.getPropertyValue(pr).trim();
    return out;
  }, props);
}
console.log(".opd-cmd:", JSON.stringify(await css(".opd-cmd", "background-color", "border-top-left-radius", "border-top-right-radius"), null, 2));
console.log(".opd-shell:", JSON.stringify(await css(".opd-shell", "border-top-left-radius"), null, 2));
console.log(".opd-card (first):", JSON.stringify(await css(".opd-card", "background-color", "border-top-color", "border-top-width", "border-top-style"), null, 2));
console.log(".opd-bdge (first):", JSON.stringify(await css(".opd-bdge", "background-color", "border-top-color", "font-family", "font-size", "font-weight"), null, 2));
console.log(".opd-year-seg (first):", JSON.stringify(await css(".opd-year-seg", "background-color", "border-top-color", "border-top-width", "border-radius"), null, 2));
console.log(".opd-year-seg--now (Aug current):", JSON.stringify(await css(".opd-year-seg--now", "background-color", "border-top-color", "border-top-width"), null, 2));
console.log(".opd-year-seg--open (Sep):", JSON.stringify(await css(".opd-year-seg--open", "background-color", "border-top-color"), null, 2));
console.log(".opd-comp-row (first non-skel):", JSON.stringify(await css(".opd-comp-row:not(.opd-comp-row--skel)", "border-left-color", "border-left-width", "border-left-style"), null, 2));
console.log(".opd-comp-row--in_progress:", JSON.stringify(await css(".opd-comp-row--in_progress", "border-left-color", "border-left-width", "border-left-style"), null, 2));
console.log(".opd-comp-row--not_enrolled:", JSON.stringify(await css(".opd-comp-row--not_enrolled", "border-left-color", "border-left-width", "border-left-style"), null, 2));
console.log(".opd-k first (Standing):", JSON.stringify(await css(".opd-k", "font-family", "font-size", "font-weight", "letter-spacing"), null, 2));
console.log(".opd-queue-kick (first):", JSON.stringify(await css(".opd-queue-kick", "font-family", "font-size", "font-weight", "letter-spacing"), null, 2));
console.log(".opd-doc-chip (first):", JSON.stringify(await css(".opd-doc-chip", "font-family", "background-color", "color"), null, 2));
console.log(".opd-year-phase-span--season:", JSON.stringify(await css(".opd-year-phase-span--season", "border-top-color", "color"), null, 2));

// Type-floor sweep on the current viewport
const belowFloor = await p.$$eval("*", (els) =>
  els
    .filter((el) => el.innerText && el.innerText.trim().length > 0)
    .map((el) => {
      const cs = getComputedStyle(el);
      return { tag: el.tagName, cls: el.className, fs: parseFloat(cs.fontSize), sample: (el.innerText||"").slice(0,40) };
    })
    .filter((r) => r.fs > 0 && r.fs < 10)
);
console.log("Type floor violations (desktop):", JSON.stringify(belowFloor, null, 2));

// Check monospace uses
const monoUses = await p.$$eval("*", (els) =>
  els.map((el) => ({
    tag: el.tagName,
    cls: el.className,
    fs: parseFloat(getComputedStyle(el).fontSize),
    family: getComputedStyle(el).fontFamily,
    text: (el.textContent || "").slice(0,20),
  })).filter((r) => r.family && (/JetBrains|Menlo|monospace/i).test(r.family))
);
console.log("Monospace consumers:", JSON.stringify(monoUses.slice(0,15), null, 2));

await ctx.close();
await b.close();
