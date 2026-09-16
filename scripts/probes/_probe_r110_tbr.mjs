import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/r110", { recursive: true });
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
await p.goto("http://localhost:3000/kpi/overview?account=TBR%20-%20FL&start=2026-10-05&end=2026-11-01", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(6000);
await p.screenshot({ path: "/tmp/r110/ov-tbr-np.png", fullPage: true });
const perkCards = await p.$$eval(".kpi-ov-cp-perk-k", els => els.map(el => (el.innerText||"").trim().replace(/\n/g," | ")));
console.log("TBR OV NP perks:", perkCards);
await b.close();
