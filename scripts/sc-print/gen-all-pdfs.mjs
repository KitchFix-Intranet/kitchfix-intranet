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

const [monthSheet, seasonSheet, opsCal] = await Promise.all([
  import("../../src/lib/print/monthSheet.js"),
  import("../../src/lib/print/seasonSheet.js"),
  import("../../src/lib/print/opsCalendarSheet.js"),
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
  // #422 Wave 3 rider: AAA month for Kevin's ruling on the
  // state-grid-vs-game-fills-only variant question.
  { slug: "CIN-KY_Month_2026-07",  landscape: true,  label: "month · CIN - KY · 2026-07 (AAA - variant choice OPEN)",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("CIN - KY", YEAR, "2026-07");
      return monthSheet.renderMonthSheet(ctx);
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
  // #422 Wave 3: extra month case for CIN - AZ Feb (spring row + PDC
  // meal stack) per Kevin's brief.
  { slug: "CIN-AZ_Month_2026-02",  landscape: true,  label: "month · CIN - AZ · 2026-02 (PDC + spring)",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("CIN - AZ", YEAR, "2026-02");
      return monthSheet.renderMonthSheet(ctx);
    }},
  // #422 Wave 3: season CIN - OH (MLB fee, home + away in v2 grammar).
  { slug: "CIN-OH_Season",         landscape: true,  label: "season · CIN - OH (MLB with day numbers + AWAY)",
    build: async () => {
      const ctx = await seasonSheet.loadSeasonPrintData("CIN - OH", YEAR);
      return seasonSheet.renderSeasonSheet(ctx);
    }},
  { slug: "STL-FL_OpsCalendar",    landscape: false, label: "ops-calendar · STL - FL",
    build: async () => {
      const ctx = await opsCal.loadOpsCalendarPrintData("STL - FL", YEAR);
      return opsCal.renderOpsCalendarSheet(ctx);
    }},
  { slug: "CIN-OH_OpsCalendar",    landscape: false, label: "ops-calendar · CIN - OH",
    build: async () => {
      const ctx = await opsCal.loadOpsCalendarPrintData("CIN - OH", YEAR);
      return opsCal.renderOpsCalendarSheet(ctx);
    }},
  { slug: "CIN-AZ_OpsCalendar",    landscape: false, label: "ops-calendar · CIN - AZ (no schedule)",
    build: async () => {
      const ctx = await opsCal.loadOpsCalendarPrintData("CIN - AZ", YEAR);
      return opsCal.renderOpsCalendarSheet(ctx);
    }},
  // Corrective wave (2026-07-13): new coverage per Kevin's brief.
  //   TBJ - FL July: PDCO overlay + projected stacks with real names
  //     (13-service catalog, longest count 167; the meal stack density
  //     test post-R3-exclusion sweep).
  //   TBR - FL July: 28-char "Extra Protein - Beef/Seafood" worst case
  //     - the system ceiling test for name width + wrap behavior.
  //   STL - MO Ops Calendar: R5 evidence - MLB fee account with zero
  //     actuals for the year -> flood of NO ACTUALS copper (compliance
  //     signal, "default honest" ruling stays until Kevin flips it).
  { slug: "TBJ-FL_Month_2026-07",  landscape: true,  label: "month · TBJ - FL · 2026-07 (PDCO overlay + projected stacks)",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("TBJ - FL", YEAR, "2026-07");
      return monthSheet.renderMonthSheet(ctx);
    }},
  { slug: "TBR-FL_Month_2026-07",  landscape: true,  label: "month · TBR - FL · 2026-07 (28-char worst-case names, densest catalog)",
    build: async () => {
      const ctx = await monthSheet.loadMonthPrintData("TBR - FL", YEAR, "2026-07");
      return monthSheet.renderMonthSheet(ctx);
    }},
  { slug: "STL-MO_OpsCalendar",    landscape: false, label: "ops-calendar · STL - MO (R5 evidence: MLB w/ zero actuals -> copper flood)",
    build: async () => {
      const ctx = await opsCal.loadOpsCalendarPrintData("STL - MO", YEAR);
      return opsCal.renderOpsCalendarSheet(ctx);
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
