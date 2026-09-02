#!/usr/bin/env node
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);
async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null }, expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}
const browser = await chromium.launch();
const acctList = ["TBR - FL", "TBJ - FL", "TXR - AZ", "CIN - AZ", "CIN - OH", "CIN - KY", "TXR - TX - V"];
const ranges = [
  { tag: "p9",  qs: "&start=2026-08-10&end=2026-09-06" },
  { tag: "p8",  qs: "&start=2026-07-13&end=2026-08-09" },
  { tag: "fytd", qs: "" },
];
for (const width of [1680, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);
  for (const a of acctList) {
    for (const r of ranges) {
      if (width === 1280 && r.tag !== "p9") continue;
      const url = `${BASE}/kpi/overview?account=${acct(a)}${r.qs}`;
      const tag = `${a.toLowerCase().replace(/ /g, "").replace(/-/g, "")}_${r.tag}_${width}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(()=>null);
        await page.waitForTimeout(900);
        await page.screenshot({ path: `/tmp/pr2_shot_${tag}.png`, fullPage: true });
        console.log(`  ${tag}`);
      } catch (e) { console.log(`  skip ${tag}: ${e.message.slice(0,60)}`); }
    }
  }
  await ctx.close();
}
// Portfolio ALL P8 (byte-identity target)
const ctxP = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const pageP = await ctxP.newPage();
await mockAuthSession(pageP);
await pageP.goto(`${BASE}/kpi/overview?account=ALL&start=2026-07-13&end=2026-08-09`, { waitUntil: "domcontentloaded", timeout: 20000 });
await pageP.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(()=>null);
await pageP.waitForTimeout(900);
await pageP.screenshot({ path: `/tmp/pr2_shot_all_p8_1680.png`, fullPage: true });
console.log(`  all_p8_1680`);
await browser.close();
