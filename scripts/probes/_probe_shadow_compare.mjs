import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/shadow-cmp", { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
await p.goto("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5500);

// Screenshot the card + the review section right below in ONE clip
const card = await p.$(".kpi-ov-cp-card");
const review = await p.$(".kpi-ov-cp-rv");
if (card && review) {
  const cb = await card.boundingBox();
  const rb = await review.boundingBox();
  const top = Math.min(cb.y, rb.y) - 32;
  const bot = Math.max(cb.y + cb.height, rb.y + rb.height) + 32;
  const left = Math.min(cb.x, rb.x) - 32;
  const right = Math.max(cb.x + cb.width, rb.x + rb.width) + 32;
  await p.screenshot({ path: "/tmp/shadow-cmp/side-by-side.png",
    clip: { x: left, y: top, width: right - left, height: bot - top } });
}

// Verify shadows now equal
const info = await p.evaluate(() => {
  const g = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).boxShadow : null; };
  return {
    hbar:   g(".kpi-ov-cp-hbar"),
    lbar:   g(".kpi-ov-cp-lbar"),
    bpanel: g(".kpi-ov-cp-bpanel"),
    review: g(".kpi-ov-cp-rv-item"),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("\nAll match?", info.hbar === info.review && info.lbar === info.review && info.bpanel === info.review);
await b.close();
