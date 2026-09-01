#!/usr/bin/env node
// scripts/probes/_probe_overview_polish_pr2_shots.mjs
//
// PR 2 polish - screenshot capture for the acceptance evidence.
//
// Per the CC_PROMPT_OVERVIEW_POLISH verification checklist:
//   "Both accounts in the render, and one more of each model - a
//    per-meal, a fee, a pass-through, plus TXR - TX - V and a
//    salaried-only account, across all three ranges."
//
// Coverage:
//   CIN - AZ        per-meal (render account A)
//   CIN - OH        fee + pass-through (render account B)
//   TBJ - FL        another per-meal
//   STL - FL        another fee + pass-through
//   TXR - TX - V    tracked account
//   TBJ - NY        salaried-only (D26 - board applies=false)
// Ranges: period:9 (open), period:8 (closed), fytd
//
// Also captures both render accounts at 1280 viewport width (per
// prompt: "screenshots ... plus 1280") to prove the status-line
// height + card widths hold on the compact desktop breakpoint.
//
// USAGE:
//   TEST_MODE=true PORT=3311 npm run dev &   # or use the running one
//   node scripts/probes/_probe_overview_polish_pr2_shots.mjs

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3311";
const OUT = "/tmp";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  { key: "CIN - AZ",     tag: "cin_az_permeal" },
  { key: "CIN - OH",     tag: "cin_oh_fee_passthrough" },
  { key: "TBJ - FL",     tag: "tbj_fl_permeal" },
  { key: "STL - FL",     tag: "stl_fl_fee_passthrough" },
  { key: "TXR - TX - V", tag: "txr_tx_v" },
  { key: "TBJ - NY",     tag: "tbj_ny_salaried_only" },
];
// The page reads start/end from the URL (not `range=`), so we ship
// the explicit ISO boundaries for open + closed periods.
//   P9 open:     2026-08-10 → 2026-09-06
//   P8 closed:   2026-07-13 → 2026-08-09
//   FYTD:        no params - page defaults to FY_START → today
const RANGES = [
  { label: "period:9", tag: "p9",   qs: "start=2026-08-10&end=2026-09-06&label=P9" },
  { label: "period:8", tag: "p8",   qs: "start=2026-07-13&end=2026-08-09&label=P8" },
  { label: "fytd",     tag: "fytd", qs: "" },
];

const results = [];

async function loadAndReady(page, url) {
  const respP = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  // Wait for board OR the state box (unauthorized / not-applies).
  await Promise.race([
    page.waitForSelector('[data-kpi-ov="board"]', { timeout: 8000 }).catch(() => null),
    page.waitForSelector('.kpi-statebox', { timeout: 8000 }).catch(() => null),
    page.waitForTimeout(2000),
  ]);
  // Small settle for status-line + cards to lay out.
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  const path = `${OUT}/overview_pr2_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  results.push({ name, path });
  console.log(`  [shot] ${name} -> ${path}`);
}

async function run() {
  const browser = await chromium.launch();

  // Main 1440-viewport pass over every account x range.
  console.log("─".repeat(70));
  console.log("Main pass @ 1440x900");
  const ctx1440 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx1440.newPage();
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/kpi/overview?account=${acct(a.key)}&${r.qs}`
        : `${BASE}/kpi/overview?account=${acct(a.key)}`;
      try {
        await loadAndReady(page, url);
        await shot(page, `${a.tag}__${r.tag}`);
      } catch (e) {
        console.log(`  [skip] ${a.tag} ${r.tag}: ${e.message}`);
      }
    }
  }
  await ctx1440.close();

  // Compact 1280 pass over the two render accounts on the open period.
  console.log("─".repeat(70));
  console.log("Compact pass @ 1280x800 (both render accounts on P9)");
  const ctx1280 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1280 = await ctx1280.newPage();
  for (const key of ["CIN - AZ", "CIN - OH"]) {
    const url = `${BASE}/kpi/overview?account=${acct(key)}&range=period%3A9`;
    const tag = key === "CIN - AZ" ? "cin_az_permeal" : "cin_oh_fee_passthrough";
    try {
      await loadAndReady(page1280, url);
      await shot(page1280, `${tag}__p9__1280`);
    } catch (e) {
      console.log(`  [skip] ${tag} 1280: ${e.message}`);
    }
  }
  await ctx1280.close();

  await browser.close();

  console.log("─".repeat(70));
  console.log(`captured ${results.length} shots -> ${OUT}/overview_pr2_*.png`);
}

run().catch(e => { console.error(e); process.exit(1); });
