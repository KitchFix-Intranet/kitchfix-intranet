// PR2 R3 - screenshots of Tier A, B, C renders.

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3220";
const OUT = "/tmp/pr2r3_screenshots";
fs.mkdirSync(OUT, { recursive: true });

const shots = [
  { name: "tier_a_p9_tbrfl.png",   url: "/kpi/purchasing?account=TBR%20-%20FL&start=2026-08-10&end=2026-09-06", label: "Tier A (P9 · TBR - FL)" },
  { name: "tier_b_l13w_tbrfl.png", url: "/kpi/purchasing?account=TBR%20-%20FL&start=2026-06-01&end=2026-08-24", label: "Tier B (13 weeks · TBR - FL)" },
  { name: "tier_c_fytd_all.png",   url: "/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24", label: "Tier C (FYTD · ALL)" },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1440, height: 1024 } }).then(c => c.newPage());
for (const s of shots) {
  await page.goto(BASE + s.url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector(".kpi-p-wks, .kpi-p-emptybucket", { timeout: 15000 });
  await page.waitForTimeout(300);
  const path = `${OUT}/${s.name}`;
  await page.screenshot({ path, fullPage: true });
  console.log(`${s.label} -> ${path}`);
}
await browser.close();
