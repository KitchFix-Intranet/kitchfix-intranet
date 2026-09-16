import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/pr2", { recursive: true });
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 2800 }, deviceScaleFactor: 2 });

async function shoot(url, tag) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  const errors = [];
  p.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `/tmp/pr2/${tag}.png`, fullPage: true });
  const info = await p.evaluate(() => {
    return {
      hasCPtable: !!document.querySelector(".kpi-ov-cp-card"),
      hasWorkerTable: !!document.querySelector(".kpi-tbl-container, .kpi-lb-week, [data-kpi-lb='week-table']") || document.body.innerText.includes("workers"),
      hasSpendList: !!document.querySelector("[data-card='spend-list']"),
      hasReimbTable: !!document.querySelector("[data-card='reimbursables-table']"),
      hasUncodedNote: !!document.querySelector(".kpi-p-cp-uncoded"),
      uncodedNoteText: document.querySelector(".kpi-p-cp-uncoded")?.innerText || null,
      hasVlines: [...document.querySelectorAll(".kpi-ov-cp-vline")].length,
    };
  });
  console.log(`\n${tag}: errors=${errors.length}`);
  if (errors.length) for (const e of errors.slice(0, 3)) console.log("  ERR:", e);
  console.log(JSON.stringify(info, null, 2));
  await p.close();
}
await shoot("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "lb-cp");
await shoot("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "pu-cp");
await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "ov-cp");
await b.close();
