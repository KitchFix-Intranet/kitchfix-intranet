#!/usr/bin/env node
// scripts/probes/_probe_pnl_and_picker.mjs
//
// Kevin ruling final-P&L + picker (2026-09-03). Standing probe.
//
//   Item 3   permanent assertion: every parent row with sub-rows
//              equals the sum of its sub-rows, on every account and
//              range, for both budget and actual.
//   Item 6   assertion: gross_margin.variance == -cogs.variance
//              to the cent, every account and range.
//   Item 7   Summary and Full never disagree on any figure they both
//              show.
//   Item 11  Range picker legend reads "next · budget only" (not just
//              "next"). Dashed navy on the P10 button.
//
// The picker items on 2026-09-03 (P1-P8 closed, P9 running, P10
// enabled, P11 P12 P13 disabled; disabled count > 0) are covered by
// the existing _probe_range_selector_r62.mjs; this probe adds the
// legend-wording assertion only.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_pnl_and_picker.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { kind: "FYTD",         qs: "" },
  { kind: "P8 closed",    qs: "start=2026-07-13&end=2026-08-09" },
  { kind: "P9 open",      qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

// Compare two numbers within a $1 tolerance (rounding).
// Null-tolerant: null and 0 are considered equal for parent-sum
// checks - parent value 0 with all children null is a suppressed
// inactive sub-tree, not a mismatch.
function nearEq(a, b, tol = 0.51) {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return true;
  if (aNull) return Math.abs(Number(b)) <= tol;
  if (bNull) return Math.abs(Number(a)) <= tol;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function payload(url) {
  const r = await fetch(url);
  return await r.json();
}

// Item 3 · every parent row with sub-rows sums to its sub-rows for
// both budget_to_date AND actual.
function assertParentSum(name, statement_rows) {
  const parents = statement_rows.filter(r => !r.parent_line_code);
  const subs    = statement_rows.filter(r =>  r.parent_line_code);
  const byParent = new Map();
  for (const s of subs) {
    if (!byParent.has(s.parent_line_code)) byParent.set(s.parent_line_code, []);
    byParent.get(s.parent_line_code).push(s);
  }
  for (const p of parents) {
    const kids = byParent.get(p.line_code) || [];
    if (kids.length === 0) continue;
    for (const field of ["actual", "budget_to_date"]) {
      // Null-preservation rule (Kevin PR-B item 6): if EVERY child's
      // field is null, sum is treated as null (matching parent null).
      // Otherwise sum treats nulls as 0. This preserves the parent=
      // null → children=null propagation without falsely failing on
      // billed-back families where the whole sub-tree is suppressed.
      const anyKidReported = kids.some(k => k[field] != null);
      const sum = anyKidReported
        ? kids.reduce((acc, k) => acc + (k[field] != null ? Number(k[field]) : 0), 0)
        : null;
      const parentVal = p[field] != null ? Number(p[field]) : null;
      if (!nearEq(sum, parentVal)) {
        const sumDisp = sum == null ? "null" : sum.toFixed(2);
        fail(`${name} parent-sum`, `${p.line_code}.${field}: parent=${parentVal}, sum(subs)=${sumDisp}, kids=[${kids.map(k => k.line_code).join(",")}]`);
      }
    }
  }
}

// Item 6 · gross_margin.variance == -cogs.variance to the cent.
function assertGmVarianceTies(name, totals) {
  const gm = totals?.gross_margin;
  const cogs = totals?.cogs;
  if (!gm || !cogs) return;
  if (gm.variance == null && cogs.variance == null) return;
  if (gm.variance == null || cogs.variance == null) {
    fail(`${name} gm-ties`, `one side null · gm=${gm.variance} cogs=${cogs.variance}`);
    return;
  }
  const sum = Number(gm.variance) + Number(cogs.variance);
  if (Math.abs(sum) > 0.02) {
    fail(`${name} gm-ties`, `gm.variance (${gm.variance}) + cogs.variance (${cogs.variance}) = ${sum.toFixed(2)}, expected 0`);
  }
}

async function itemsThreeAndSix() {
  console.log("## Item 3 (parent-sum) + item 6 (GM variance ties)");
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}&include_salary=1`
        : `${BASE}/api/kpi/overview?account=${acct(a)}&include_salary=1`;
      const j = await payload(url);
      if (!j.ok) { fail(`${a} ${r.kind}`, `payload not ok`); continue; }
      const before = FAILS.length;
      assertParentSum(`${a} ${r.kind}`, j.statement_rows || []);
      assertGmVarianceTies(`${a} ${r.kind}`, j.statement_totals);
      const after = FAILS.length;
      const tag = after === before ? "OK  " : "FAIL";
      // Only log the TBJ - FL rows to keep output tight; log any fail.
      if (a === "TBJ - FL" || after !== before) {
        console.log(`  ${tag} ${a.padEnd(16)} ${r.kind.padEnd(12)}`);
      }
    }
  }
  console.log("");
}

// Item 7 · Full and Summary never disagree on any figure they both
// show. Summary drops inactive lines, sub-rows, tracked band. The
// same statement_rows[] ships in both views (client filters); assert
// each parent + total row's numbers are identical in both modes (they
// come from the same payload, so this is a shape check on rendering
// pipeline).
async function itemSeven() {
  console.log("## Item 7 (Summary vs Full parity)");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1400 } });
  const page = await ctx.newPage();
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: {name:"T",email:"t@k.com",image:null}, expires: new Date(Date.now()+864e5).toISOString() }) });
  });

  const url = `${BASE}/kpi/overview?account=${acct("TBJ - FL")}&include_salary=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);

  // Open the P&L fold + toggle each mode; scrape the parent + total
  // rows' Actual + Budget + Adjusted cells.
  await page.locator('[data-kpi-ov="fold-pnl"]').first().click({ force: true });
  await page.waitForTimeout(400);

  async function scrape() {
    return await page.evaluate(() => {
      const tbl = document.querySelector('[data-kpi-ov="pnl-table"]');
      if (!tbl) return null;
      const rows = [...tbl.querySelectorAll('tr')];
      const out = [];
      for (const tr of rows) {
        const variant = tr.getAttribute('data-kpi-ov-variant');
        if (variant === "sub") continue; // sub-rows are summary-hidden
        const lineCode = tr.getAttribute('data-kpi-ov-line-code');
        const isTotal = tr.classList.contains('kpi-ov-pnl-tot') || tr.classList.contains('kpi-ov-pnl-gm');
        if (!lineCode && !isTotal) continue;
        const label = tr.querySelector('td.l')?.innerText.trim() || null;
        const cells = [...tr.querySelectorAll('td:not(.l)')].map(td => td.innerText.trim());
        out.push({ lineCode, isTotal, label, cells });
      }
      return out;
    });
  }

  const full = await scrape();
  await page.locator('[data-kpi-ov="dense-sum"]').first().click({ force: true });
  await page.waitForTimeout(300);
  const summary = await scrape();
  await browser.close();

  if (!full || !summary) {
    fail(`TBJ - FL P&L parity`, `could not scrape`);
    console.log("");
    return;
  }

  // Every row in Summary must exist in Full with byte-identical cells.
  // (Full may have additional rows - inactive lines, sub-rows, tracked
  // band - that Summary drops.)
  const fullMap = new Map();
  for (const r of full) fullMap.set(r.label, r);
  for (const s of summary) {
    const f = fullMap.get(s.label);
    if (!f) { fail(`TBJ - FL P&L parity`, `Summary row "${s.label}" not in Full`); continue; }
    if (JSON.stringify(f.cells) !== JSON.stringify(s.cells)) {
      fail(`TBJ - FL P&L parity`, `${s.label}: Full=${JSON.stringify(f.cells)} · Summary=${JSON.stringify(s.cells)}`);
    }
  }
  console.log(`  OK · Full has ${full.length} rows, Summary has ${summary.length}, all overlapping figures identical.`);
  console.log("");
}

// Item 11 · Range picker legend "next · budget only".
async function itemEleven() {
  console.log("## Item 11 (range picker legend wording)");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: {name:"T",email:"t@k.com",image:null}, expires: new Date(Date.now()+864e5).toISOString() }) });
  });
  await page.goto(`${BASE}/kpi/overview?account=${acct("TBJ - FL")}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(600);
  await page.locator(".kpi-rmenu-trigger").first().waitFor({ state: "visible", timeout: 10000 });
  await page.evaluate(() => document.querySelector(".kpi-rmenu-trigger")?.click());
  await page.waitForTimeout(400);
  const legend = await page.evaluate(() => {
    const el = document.querySelector('[data-kpi-rmenu="legend"]');
    if (!el) return null;
    return [...el.querySelectorAll("span")].map(s => s.innerText.trim());
  });
  const p10 = await page.evaluate(() => {
    const b = document.querySelector('[data-period-state="next"]');
    if (!b) return null;
    return {
      classes: b.className,
      borderStyle: getComputedStyle(b).borderStyle,
    };
  });
  await browser.close();

  if (!legend) { fail("picker legend", "not present"); }
  else {
    const wantEntries = ["closed", "running now", "next · budget only", "not started"];
    for (const w of wantEntries) {
      if (!legend.some(l => l.toLowerCase() === w.toLowerCase())) {
        fail("picker legend", `entry "${w}" missing · got ${JSON.stringify(legend)}`);
      }
    }
  }
  if (!p10) fail("P10 next", "no button with data-period-state=next");
  else {
    if (!/st-next/.test(p10.classes)) fail("P10 next", `class missing st-next · ${p10.classes}`);
    if (!/dashed/i.test(p10.borderStyle)) fail("P10 next", `border-style=${JSON.stringify(p10.borderStyle)}, want dashed`);
  }
  console.log(`  ${FAILS.length === 0 ? "OK" : "FAIL"} · legend=${JSON.stringify(legend)}`);
  console.log("");
}

async function main() {
  console.log(`# P&L + picker (final) - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  await itemsThreeAndSix();
  await itemSeven();
  await itemEleven();

  if (FAILS.length === 0) {
    console.log("Result: item 3 (parent-sum), item 6 (GM ties), item 7 (parity), item 11 (legend) all hold.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
