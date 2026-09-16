import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/r110", { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 2200 }, deviceScaleFactor: 2 });

async function shoot(url, tag) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  const errors = [];
  p.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `/tmp/r110/${tag}.png`, fullPage: true });
  const info = await p.evaluate(() => {
    const has = sel => !!document.querySelector(sel);
    const rlabs = [...document.querySelectorAll(".kpi-ov-cp-grid .kpi-ov-cp-rlab")].map(el => (el.innerText||"").trim().replace(/\n/g, " | "));
    const perkCards = [...document.querySelectorAll(".kpi-ov-cp-perk-k")].map(el => (el.innerText||"").trim().replace(/\n/g, " | "));
    const statusPill = document.querySelector(".kpi-ov-cp-stpill")?.innerText || null;
    const statusSub = document.querySelector(".kpi-ov-cp-status-sub")?.innerText || null;
    return {
      hasCard: has(".kpi-ov-cp-card"),
      hasSeg: has(".kpi-ov-cp-seg"),
      hasRollcard: has(".kpi-ov-cp-rollcard"),
      hasReview: has(".kpi-ov-cp-rv"),
      hasLift: has(".kpi-ov-cp-lift"),
      hasPerk: has(".kpi-ov-cp-perk"),
      statusPill,
      statusSub,
      rlabs,
      perkCards,
      // Purchasing removals
      hasPurchWig: has(".kpi-p-wig"),
      hasPurchCoding: has(".kpi-p-codestrip"),
      hasPurchDrill: has(".kpi-p-tbl-container"),
    };
  });
  console.log(`\n=== ${tag} ===`);
  console.log("errors:", errors.length);
  if (errors.length) for (const e of errors.slice(0, 3)) console.log("  ERR:", e);
  console.log(JSON.stringify(info, null, 2));
  await p.close();
}
await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "ov-tbj-np");
await shoot("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "lb-tbj-np");
await shoot("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "pu-tbj-np");
await b.close();
