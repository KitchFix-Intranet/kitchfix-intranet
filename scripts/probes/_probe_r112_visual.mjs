// R-112 PR 1 · full-page screenshots + corner hit-test.
// Screenshots at 1440 for both accounts × 3 boards × hourly/salary.
// Hit-test: elementsFromPoint at the empty corner (col 1, row 1)
// must return the wrap/page, NOT the .kpi-ov-cp-hbar or .kpi-ov-cp-lbar.

import { chromium } from "playwright";
import { mkdirSync } from "fs";
mkdirSync("/tmp/r112pr1", { recursive: true });

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
  await p.screenshot({ path: `/tmp/r112pr1/${tag}.png`, fullPage: true });

  const info = await p.evaluate(() => {
    const card = document.querySelector(".kpi-ov-cp-card");
    if (!card) return { err: "no card" };
    const grid = card.querySelector(".kpi-ov-cp-grid");
    const hbar = grid.querySelector(".kpi-ov-cp-hbar");
    const lbar = grid.querySelector(".kpi-ov-cp-lbar");
    const bpanel = grid.querySelector(".kpi-ov-cp-bpanel");
    const rlab1 = grid.querySelector(".kpi-ov-cp-rlab.kpi-ov-cp-firstrow");
    const hcell1 = grid.querySelector(".kpi-ov-cp-hcell.kpi-ov-cp-firstwk");
    // Corner hit-test: pick a point at (rlab1.left, hbar.top - 2px) which
    // is the empty corner cell (col 1, row 1). Only the page should be
    // there - not hbar (starts at col 2), not lbar (starts at row 2).
    const rlBox = rlab1.getBoundingClientRect();
    const hbBox = hbar.getBoundingClientRect();
    const cornerX = Math.round(rlBox.left + rlBox.width / 2);
    const cornerY = Math.round(hbBox.top + hbBox.height / 2);
    const hits = document.elementsFromPoint(cornerX, cornerY);
    const cornerLeaks = hits.some(el =>
      el.classList?.contains("kpi-ov-cp-hbar")
      || el.classList?.contains("kpi-ov-cp-lbar")
      || el.classList?.contains("kpi-ov-cp-bpanel")
    );
    // Also test right at (lbar.left, hbar.top) - the pixel where the
    // cut corner would be if the panels bled together.
    const lbBox = lbar.getBoundingClientRect();
    const hits2 = document.elementsFromPoint(Math.round(lbBox.left + 4), Math.round(hbBox.top + 4));
    const cornerLeaks2 = hits2.some(el =>
      el.classList?.contains("kpi-ov-cp-hbar")
      || el.classList?.contains("kpi-ov-cp-lbar")
      || el.classList?.contains("kpi-ov-cp-bpanel")
    );
    // Lift geometry
    const lift = grid.querySelector(".kpi-ov-cp-lift");
    const now = grid.querySelector(".kpi-ov-cp-hcell.kpi-ov-cp-now");
    const liftGeom = lift && now ? {
      liftTop: lift.getBoundingClientRect().top,
      hcellTop: now.getBoundingClientRect().top,
      overhang: now.getBoundingClientRect().top - lift.getBoundingClientRect().top,
    } : null;
    return {
      cornerHits: hits.slice(0, 6).map(el => el.tagName + "." + (el.className || "").toString().slice(0, 30)),
      cornerLeaks,
      cornerHits2: hits2.slice(0, 6).map(el => el.tagName + "." + (el.className || "").toString().slice(0, 30)),
      cornerLeaks2,
      liftGeom,
      rowLabels: [...grid.querySelectorAll(".kpi-ov-cp-rlab")].map(el => (el.innerText||"").trim().replace(/\n/g, " | ")),
      rowMaxHeights: [...grid.querySelectorAll(".kpi-ov-cp-rlab")].map(el => Math.round(el.getBoundingClientRect().height)),
    };
  });
  console.log(`\n${tag}: errors=${errors.length}`);
  if (errors.length) for (const e of errors.slice(0, 3)) console.log("  ERR:", e);
  console.log(JSON.stringify(info, null, 2));
  await p.close();
}

await shoot("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-overview");
await shoot("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-labor");
await shoot("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "tbj-purch");
await b.close();
