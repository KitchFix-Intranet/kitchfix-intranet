// R-112 PR 1 · verify no figure moves. Compare 3100/3200/3400 period
// cell text between Overview/Labor/Purchasing on the same CP range.
// Same component + same data source = identity by construction; this
// probe is the mount-verified check.

import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1600 } });

async function readCells(url) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(4500);
  const cells = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".kpi-ov-cp-grid .kpi-ov-cp-rlab")];
    const out = {};
    for (const rlab of rows) {
      const text = (rlab.innerText || "").trim().split("\n")[0];
      const gr = getComputedStyle(rlab).gridRow.split(" / ")[0];
      // find the .kpi-ov-cp-cell.kpi-ov-cp-per with same gridRow
      const per = [...document.querySelectorAll(".kpi-ov-cp-grid .kpi-ov-cp-cell.kpi-ov-cp-per")]
        .find(c => getComputedStyle(c).gridRow.split(" / ")[0] === gr);
      out[text] = per ? (per.innerText || "").trim().replace(/\n/g, " · ") : "";
    }
    return out;
  });
  await p.close();
  return cells;
}

const ov = await readCells("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
const lb = await readCells("http://localhost:3000/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
const pu = await readCells("http://localhost:3000/kpi/purchasing?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");

console.log("=== Invariant 5/6 · same cell, same figure ===\n");
const rows3100lb = Object.entries(lb).find(([k]) => k.includes("3100"));
const rows3100ov = Object.entries(ov).find(([k]) => k.includes("3100"));
const rows3200pu = Object.entries(pu).find(([k]) => k.includes("3200"));
const rows3200ov = Object.entries(ov).find(([k]) => k.includes("3200"));
const rows3400pu = Object.entries(pu).find(([k]) => k.includes("3400"));
const rows3400ov = Object.entries(ov).find(([k]) => k.includes("3400"));

console.log(`3100 Labor:    "${rows3100lb?.[1]}"`);
console.log(`3100 Overview: "${rows3100ov?.[1]}"`);
console.log(`         ${rows3100lb?.[1] === rows3100ov?.[1] ? "PASS · invariant 5" : "FAIL"}\n`);
console.log(`3200 Purch:    "${rows3200pu?.[1]}"`);
console.log(`3200 Overview: "${rows3200ov?.[1]}"`);
console.log(`         ${rows3200pu?.[1] === rows3200ov?.[1] ? "PASS · invariant 6" : "FAIL"}\n`);
console.log(`3400 Purch:    "${rows3400pu?.[1]}"`);
console.log(`3400 Overview: "${rows3400ov?.[1]}"`);
console.log(`         ${rows3400pu?.[1] === rows3400ov?.[1] ? "PASS · invariant 6" : "FAIL"}`);

await b.close();
