import { chromium } from "@playwright/test";
const b = await chromium.launch();
const shots = [
  { w: 390, h: 844, name: "room-390" },
  { w: 430, h: 932, name: "room-430" },
  { w: 1280, h: 900, name: "room-desktop" },
];
for (const s of shots) {
  const ctx = await b.newContext({ viewport: { width: s.w, height: s.h } });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/opd");
  await p.waitForSelector(".opd-queue-row:not(.opd-queue-row--skel)", { timeout: 10000 });
  await p.screenshot({ path: `/tmp/pr8-screens/${s.name}.png`, fullPage: true });
  console.log(s.name, "shot");
  // Also capture Focus at each width
  await p.locator(".opd-queue-row:not(.opd-queue-row--skel)").nth(2).click();
  await p.waitForSelector(".opd-focus-body", { timeout: 10000 });
  await p.screenshot({ path: `/tmp/pr8-screens/${s.name}-focus.png`, fullPage: true });
  console.log(s.name, "focus shot");
  await ctx.close();
}
await b.close();
