// R-112 PR 2 · verify toggle + rolling + delta + summary card.

import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/r112pr2", { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 2400 }, deviceScaleFactor: 2 });

async function shoot(url, tag) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  const errors = [];
  p.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(5500);
  // Screenshot PLAN mode
  await p.screenshot({ path: `/tmp/r112pr2/${tag}-plan.png`, fullPage: true });

  // Verify seg toggle exists + PLAN is on
  const state1 = await p.evaluate(() => {
    const buttons = [...document.querySelectorAll(".kpi-ov-cp-seg button")];
    return {
      buttons: buttons.map(el => ({ text: el.innerText, active: el.className.includes("kpi-ov-cp-seg-on") })),
      status: (document.querySelector(".kpi-ov-cp-status-sub")?.innerText || "").trim(),
      rollcard: !!document.querySelector(".kpi-ov-cp-rollcard"),
    };
  });

  // Click ROLLING
  await p.click(".kpi-ov-cp-seg button:nth-child(2)");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `/tmp/r112pr2/${tag}-rolling.png`, fullPage: true });

  const state2 = await p.evaluate(() => {
    const buttons = [...document.querySelectorAll(".kpi-ov-cp-seg button")];
    const rollcard = document.querySelector(".kpi-ov-cp-rollcard");
    const rollcardLines = [...(rollcard?.querySelectorAll(".kpi-ov-cp-rollcard-ln") || [])].map(ln => (ln.innerText || "").trim().replace(/\n/g, " | "));
    const deltas = [...document.querySelectorAll(".kpi-ov-cp-dlt")].map(el => (el.innerText || "").trim());
    return {
      buttons: buttons.map(el => ({ text: el.innerText, active: el.className.includes("kpi-ov-cp-seg-on") })),
      rollcardPresent: !!rollcard,
      rollcardLines,
      deltaLines: deltas,
      rollcardEmpty: rollcard?.querySelector(".kpi-ov-cp-rollcard-empty")?.innerText || null,
    };
  });

  console.log(`\n=== ${tag} ===`);
  console.log("errors:", errors.length);
  if (errors.length) for (const e of errors.slice(0, 3)) console.log("  ERR:", e);
  console.log("PLAN state:", JSON.stringify(state1, null, 2));
  console.log("ROLLING state:", JSON.stringify(state2, null, 2));
  await p.close();
}

await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-ov");
await shoot("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-lb");
await shoot("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-pu");
await b.close();
