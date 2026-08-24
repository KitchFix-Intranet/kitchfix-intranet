// PR2 R3 - tier boundary sweep. Ranges chosen to hit weeks_in_range =
// 4, 5, 6, 7, 13, 14, 35; measures classifyTier(N) and the resulting
// first-bucket bar count from a live purchasing render.

import { classifyTier } from "../../src/lib/kpi/classifyTier.js";
import { chromium } from "playwright";

const BASE = "http://localhost:3220";

// Compose ranges by choosing end=2026-08-24 (today) and picking a start
// that makes weekStartsInRange yield N Mondays. Weeks are Mon-anchored;
// the Monday of 2026-08-24 is 2026-08-24.
// Sample choices verified against src/app/kpi/labor/lib/periods.js.
// Starts computed against weekStartsInRange - end 2026-08-24 fixed.
const ranges = [
  { N: 4,  start: "2026-08-03", end: "2026-08-24" },
  { N: 5,  start: "2026-07-27", end: "2026-08-24" },
  { N: 6,  start: "2026-07-20", end: "2026-08-24" },
  { N: 7,  start: "2026-07-13", end: "2026-08-24" },
  { N: 13, start: "2026-06-01", end: "2026-08-24" },
  { N: 14, start: "2026-05-25", end: "2026-08-24" },
  { N: 35, start: "2025-12-29", end: "2026-08-24" },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext().then(c => c.newPage());

console.log("=".repeat(72));
console.log("Tier boundary sweep - classifyTier + rendered bar count");
console.log("=".repeat(72));
console.log("N   classifyTier   rendered_bars   fiscal_weeks_from_api");
for (const r of ranges) {
  const tier = classifyTier(r.N);
  await page.goto(`${BASE}/kpi/purchasing?account=TBR%20-%20FL&start=${r.start}&end=${r.end}`, {
    waitUntil: "networkidle", timeout: 30000,
  });
  await page.waitForSelector(".kpi-p-wks, .kpi-p-emptybucket", { timeout: 15000 });
  const rendered = await page.evaluate(() => {
    const strips = document.querySelectorAll(".kpi-p-wks");
    if (!strips.length) return 0;
    return strips[0].querySelectorAll(".kpi-p-wc").length;
  });
  // Sanity: fetch weeks_in_range from the API for this range.
  const api = await fetch(`${BASE}/api/kpi/purchasing?account=TBR%20-%20FL&start=${r.start}&end=${r.end}`).then(r => r.json());
  const wksInRange = api?.fiscal?.weeks_in_range ?? "?";
  console.log(`${String(r.N).padStart(2)}  tier ${tier}         ${String(rendered).padStart(3)}             ${wksInRange}`);
}
await browser.close();
