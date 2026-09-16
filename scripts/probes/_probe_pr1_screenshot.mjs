import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/pr1-before", { recursive: true });
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
await p.goto("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5000);
const card = await p.$(".kpi-ov-cp-card");
if (card) {
  const box = await card.boundingBox();
  await p.screenshot({ path: "/tmp/pr1-before/ov-cp.png",
    clip: { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 } });
}
await b.close();
