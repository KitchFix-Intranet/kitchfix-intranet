#!/usr/bin/env node
// End-to-end LOCAL generation for ALL FOUR SC print scopes: exercises
// the REAL loaders + renderers + a REAL puppeteer Chromium so print
// PRs prove themselves without the Vercel Preview Protection SSO wall.
//
// This is the follow-through on Kevin's ruling 2026-07-13: "from now
// on that local-generation path is how print PRs prove themselves; my
// SSO click becomes confirmation, not discovery."
//
// Kevin's brief specifies 8 PDFs across the four scopes:
//   month:  CIN - OH July + STL - FL March
//   period: STL - FL P8
//   season: CIN - KY + TBJ - FL
//   year:   STL - FL + CIN - OH + CIN - AZ
//
// Usage:
//   TSX_TSCONFIG_PATH=./jsconfig.json npx tsx --env-file=.env.local \
//     scripts/sc-print/gen-all-pdfs.mjs

import path from "node:path";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const YEAR = 2026;
const OUT_DIR = path.resolve("./scripts/sc-print/artifacts");
await fs.mkdir(OUT_DIR, { recursive: true });

const [monthSheet, seasonSheet, yearSheet] = await Promise.all([
  import("../../src/lib/print/monthSheet.js"),
  import("../../src/lib/print/seasonSheet.js"),
  import("../../src/lib/print/yearSheet.js"),
]);

const CASES = [
  { slug: "CIN-OH_Month_2026-07",  landscape: true,  label: "month · CIN - OH · 2026-07",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("CIN - OH", YEAR, "2026-07");
      return monthSheet.renderMonthSheet(ctx);
    }},
  { slug: "STL-FL_Month_2026-03",  landscape: true,  label: "month · STL - FL · 2026-03",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("STL - FL", YEAR, "2026-03");
      return monthSheet.renderMonthSheet(ctx);
    }},
  { slug: "STL-FL_Period_P8",      landscape: true,  label: "period · STL - FL · P8",
    build: async () => {
      const ctx = await monthSheet.loadPeriodPrintData("STL - FL", YEAR, "P8");
      return monthSheet.renderPeriodSheetHtml(ctx);
    }},
  { slug: "CIN-KY_Season",         landscape: true,  label: "season · CIN - KY",
    build: async () => {
      const ctx = await seasonSheet.loadSeasonPrintData("CIN - KY", YEAR);
      return seasonSheet.renderSeasonSheet(ctx);
    }},
  { slug: "TBJ-FL_Season",         landscape: true,  label: "season · TBJ - FL (HOME SCHEDULE)",
    build: async () => {
      const ctx = await seasonSheet.loadSeasonPrintData("TBJ - FL", YEAR);
      return seasonSheet.renderSeasonSheet(ctx);
    }},
  { slug: "STL-FL_Year",           landscape: false, label: "year · STL - FL",
    build: async () => {
      const ctx = await yearSheet.loadYearPrintData("STL - FL", YEAR);
      return yearSheet.renderYearSheet(ctx);
    }},
  { slug: "CIN-OH_Year",           landscape: false, label: "year · CIN - OH",
    build: async () => {
      const ctx = await yearSheet.loadYearPrintData("CIN - OH", YEAR);
      return yearSheet.renderYearSheet(ctx);
    }},
  { slug: "CIN-AZ_Year",           landscape: false, label: "year · CIN - AZ (no schedule)",
    build: async () => {
      const ctx = await yearSheet.loadYearPrintData("CIN - AZ", YEAR);
      return yearSheet.renderYearSheet(ctx);
    }},
];

const browser = await puppeteer.launch({ headless: true });

let fails = 0;
for (const c of CASES) {
  const t0 = Date.now();
  process.stdout.write(`── ${c.label} ─────\n`);
  try {
    const html = await c.build();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "letter",
      landscape: c.landscape,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
    await page.close();
    const outPath = path.join(OUT_DIR, `${c.slug}.pdf`);
    await fs.writeFile(outPath, pdf);
    process.stdout.write(`  ${pdf.length} bytes -> ${path.basename(outPath)}  (${Date.now() - t0}ms)\n`);
  } catch (err) {
    fails++;
    process.stdout.write(`  FAIL: ${err?.message}\n`);
  }
}

await browser.close();

if (fails > 0) {
  process.stdout.write(`\n${fails}/${CASES.length} PDFs failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${CASES.length} PDFs written to ${OUT_DIR}.\n`);
