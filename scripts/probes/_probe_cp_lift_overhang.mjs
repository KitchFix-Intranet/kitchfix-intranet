#!/usr/bin/env node
// R-112 · lifted column overhang assertion (Kevin 2026-09-17).
// Kevin ruling: "Assert both in the probe: lifted header top is
// negative against the hbar, lifted last cell bottom is positive
// against the bpanel. Neither is currently checked, which is why it
// shipped." Standing check - the shadow PR broke this because the
// prior probes only measured the LIFT background element's box
// (which does overhang) not the hcell/cell contents (which sit flush
// unless margin-top:-7 / margin-bottom:-7 is applied).

import { chromium } from "playwright";

const URL = "http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1400 } });
const p = await ctx.newPage();
await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5000);

const info = await p.evaluate(() => {
  const hcellNow = document.querySelector(".kpi-ov-cp-hcell.kpi-ov-cp-now");
  const hbar = document.querySelector(".kpi-ov-cp-hbar");
  const bpanel = document.querySelector(".kpi-ov-cp-bpanel");
  const cellNows = [...document.querySelectorAll(".kpi-ov-cp-cell.kpi-ov-cp-now")];
  const lastCellNow = cellNows[cellNows.length - 1];
  if (!hcellNow || !hbar || !bpanel || !lastCellNow) {
    return { err: "missing element", hcellNow: !!hcellNow, hbar: !!hbar, bpanel: !!bpanel, lastCellNow: !!lastCellNow };
  }
  const hc = hcellNow.getBoundingClientRect();
  const hb = hbar.getBoundingClientRect();
  const lc = lastCellNow.getBoundingClientRect();
  const bp = bpanel.getBoundingClientRect();
  return {
    hcellNow_top: Math.round(hc.top),
    hbar_top: Math.round(hb.top),
    top_overhang: Math.round(hc.top - hb.top),   // want < 0 (hcell above hbar top)
    lastCellNow_bot: Math.round(lc.bottom),
    bpanel_bot: Math.round(bp.bottom),
    bottom_overhang: Math.round(lc.bottom - bp.bottom), // want > 0 (cell below bpanel bottom)
  };
});

console.log(JSON.stringify(info, null, 2));

const topOk = info.top_overhang < 0;
const botOk = info.bottom_overhang > 0;
console.log(`\ntop_overhang < 0 (hcell.now above hbar top)?  ${topOk ? "PASS" : "FAIL"}`);
console.log(`bottom_overhang > 0 (last cell.now below bpanel bottom)?  ${botOk ? "PASS" : "FAIL"}`);

await b.close();
process.exit(topOk && botOk ? 0 : 1);
