import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/pr1-after", { recursive: true });
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });

async function shoot(url, tag) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `/tmp/pr1-after/${tag}.png`, fullPage: true });
  // Also a card-only screenshot for the border check
  const card = await p.$(".kpi-ov-cp-card");
  if (card) {
    const box = await card.boundingBox();
    await p.screenshot({ path: `/tmp/pr1-after/${tag}-card.png`,
      clip: { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 } });
  }
  await p.close();
}

await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "ov-cp");
await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "ov-np");
await shoot("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "lb-cp");
await shoot("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "pu-cp");
await b.close();
