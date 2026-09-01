import { chromium } from "playwright";
const BASE = "http://localhost:3311";
async function measure(page, url, label) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kpi-cmd", { timeout: 20000 });
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const cmds = document.querySelectorAll(".kpi-cmd");
    for (const c of cmds) {
      const r = c.getBoundingClientRect();
      if (r.width > 0) return { class: c.className, left: r.left, width: r.width };
    }
    return null;
  });
  console.log(`  ${label}: ${JSON.stringify(info)}`);
  return info;
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
const page = await ctx.newPage();
console.log("At 1680 viewport:");
const lab = await measure(page, `${BASE}/kpi/labor?account=CIN%20-%20AZ&start=2026-08-10&end=2026-09-06`, "Labor");
const ov = await measure(page, `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9&_test_role=site_leader&_test_scope=CIN%20-%20AZ`, "Overview site");
const ovCorp = await measure(page, `${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9`, "Overview corp");
await browser.close();
console.log("");
console.log("Alignment check:");
if (lab && ov) console.log(`  Labor vs Overview site: leftDelta=${(ov.left - lab.left).toFixed(1)}px widthDelta=${(ov.width - lab.width).toFixed(1)}px`);
if (lab && ovCorp) console.log(`  Labor vs Overview corp: leftDelta=${(ovCorp.left - lab.left).toFixed(1)}px widthDelta=${(ovCorp.width - lab.width).toFixed(1)}px`);
