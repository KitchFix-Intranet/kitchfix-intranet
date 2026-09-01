import { chromium } from "playwright";
const BASE = "http://localhost:3311";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 900 } });
const page = await ctx.newPage();
for (const [url, name] of [
  [`${BASE}/kpi/labor?account=CIN%20-%20AZ&start=2026-08-10&end=2026-09-06`, "labor"],
  [`${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9&_test_role=site_leader&_test_scope=CIN%20-%20AZ`, "overview_site"],
  [`${BASE}/kpi/overview?account=CIN%20-%20AZ&range=period:9`, "overview_corp"],
]) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const c = document.querySelector(".kpi-cmd");
    if (!c) return { present: false };
    const r = c.getBoundingClientRect();
    return { present: true, left: r.left, width: r.width, right: r.right };
  });
  console.log(`${name}: ${JSON.stringify(info)}`);
  await page.screenshot({ path: `/tmp/wrap_shots_${name}.png`, fullPage: false });
}
await browser.close();
