import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://localhost:3000/opd");
await p.waitForSelector(".opd-queue-row:not(.opd-queue-row--skel)", { timeout: 10000 });
await p.locator(".opd-queue-row:not(.opd-queue-row--skel)").nth(2).click();
await p.waitForSelector(".opd-focus-body", { timeout: 10000 });
async function css(sel, ...props) {
  return await p.$eval(sel, (el, props) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const out = { rect: { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } };
    for (const pr of props) out[pr] = cs.getPropertyValue(pr).trim();
    return out;
  }, props);
}
console.log(".opd-doc-chip (in focus):", JSON.stringify(await css(".opd-doc-chip", "font-family", "background-color", "color", "font-size", "font-weight"), null, 2));
console.log(".opd-focus-kv-mono (first):", JSON.stringify(await css(".opd-focus-kv-mono", "font-family", "font-size"), null, 2));
// Return to room, measure bdge label
await p.locator(".opd-crumb-link").first().click();
await p.waitForSelector(".opd-queue-row:not(.opd-queue-row--skel)", { timeout: 5000 });
console.log(".opd-bdge-label (first):", JSON.stringify(await css(".opd-bdge-label", "font-family", "font-size", "font-weight"), null, 2));
// Two badges of different families side by side
const badges = await p.$$eval(".opd-bdge", (els) => els.map((el) => ({
  cls: el.className,
  bg: getComputedStyle(el).backgroundColor,
  bd: getComputedStyle(el).borderTopColor,
  color: getComputedStyle(el).color,
})));
console.log("All 8 badges by family:", JSON.stringify(badges, null, 2));
await ctx.close();
await b.close();
