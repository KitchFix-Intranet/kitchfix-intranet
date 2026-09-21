#!/usr/bin/env node
// R-137 acceptance sweep · headless-chromium DOM probe on :3001.
// TEST_MODE middleware bypass handles auth; specs go straight to the
// board URLs with account + start + end + include_salary querystrings.

import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
const CASES = [
  {
    label: "3.1 CIN - AZ · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - AZ")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [
      /budget[\s\S]{0,5}\$43,707/i, /forecast revenue/i, /\$44,194/,
      /\$22,830/, /\$10,411/, /\$2,330/, /\$35,571/,
      /23\.56% of revenue/, /5\.27% of revenue/, /80\.49% of revenue/,
    ],
  },
  {
    label: "3.2 TBJ - FL · P12 · sal=0 (fee-only week 4)",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-11-02&end=2026-11-29&include_salary=0`,
    expect: [
      /service fee only · no services/i, /\$8,260/,
      /budget[\s\S]{0,5}\$45,412/i,
    ],
  },
  {
    label: "3.3 STL - FL · P11 · sal=0",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - FL")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [
      /\$52,061/, /budget · no forecast yet/i,
      /\$11,453/, /22\.00% of revenue/,
      /\$930/, /1\.79% of revenue/,
      /\$12,383/, /23\.79% of revenue/,
    ],
    forbid: [/Off season/i],
  },
  {
    label: "3.4 CIN - OH · P11 · sal=1 · off-season block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [
      /Off season\. No revenue planned for P11/i,
      /Salaried managers stay on payroll/i,
      /Salaried labor · the period/i, /\$6,722/,
      /Hourly labor/i, /Everything else/i,
      /3100\.2 · budgeted, continuing/i,
      /no services scheduled/i,
      /food, packaging, vehicle/i,
    ],
    forbid: [/% of revenue/],
  },
  // 3.5 · step 5 (closed 0-revenue subs blank). Labor drill-down uses
  // useSession client-side and the TEST_MODE middleware bypass does
  // not stub a session, so Playwright can't reach the rendered board.
  // Verify via payload: board.kind === "single_period_closed" AND
  // revSum === 0 fires the step 5 gate. See kind:"payload" cases below.
  {
    label: "3.5 TXR - TX - V · P3 · closed · sal=1 (step 5 gate, payload)",
    kind: "payload",
    laborUrl: `${BASE}/api/kpi/labor?account=${encodeURIComponent("TXR - TX - V")}&start=2026-02-23&end=2026-03-22&include_salary=1`,
    check: d => {
      const weeks = d.board?.weeks || [];
      const revSum = weeks.reduce((s, w) => s + Number(w.week_revenue || 0), 0);
      const closed = d.board?.kind === "single_period_closed";
      const step5Fires = closed && revSum === 0;
      return step5Fires
        ? { ok: true, msg: `closed=${closed} revSum=$${revSum} → step5 trigger` }
        : { ok: false, msg: `closed=${closed} revSum=$${revSum} · step5 gate NOT met` };
    },
  },
  {
    label: "Regression · TBJ - FL P10 running sal=0 (unchanged)",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - FL")}&start=2026-09-07&end=2026-10-04&include_salary=0`,
    expect: [/Period running/i],
    forbid: [/Off season/i, /budget · no forecast yet/i],
  },
  {
    label: "Regression · TBJ - FL P9 closed sal=1 (step 5 does NOT trigger, payload)",
    kind: "payload",
    laborUrl: `${BASE}/api/kpi/labor?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06&include_salary=1`,
    check: d => {
      const weeks = d.board?.weeks || [];
      const revSum = weeks.reduce((s, w) => s + Number(w.week_revenue || 0), 0);
      const closed = d.board?.kind === "single_period_closed";
      const step5Fires = closed && revSum === 0;
      return !step5Fires
        ? { ok: true, msg: `closed=${closed} revSum=$${Math.round(revSum)} → subs stay (33.81% intact)` }
        : { ok: false, msg: `unexpected step5 trigger` };
    },
  },
  {
    label: "State-4 sweep · STL - MO · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - MO")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Off season/i, /\$6,538/, /Everything else/i],
  },
  {
    label: "State-4 sweep · TXR - TX - H · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - H")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Off season/i, /\$6,722/, /\$500/, /Everything else/i],
  },
  {
    label: "State-4 sweep · CIN - KY · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - KY")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Off season/i, /\$300/],
  },
  // Kevin ruling 2026-09-21. Hourly view of off-season must not mention
  // salary. Four dark accounts × hourly toggle, grep body for "salar"
  // case-insensitive: zero hits. Also confirm the new copy landed.
  {
    label: "SALARY GATE · CIN - OH · P11 · sal=0 (off-season block; no salary mention)",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [
      /Off season\. No services scheduled for P11/i,
      /There is nothing to schedule or spend against this period/i,
      /Hourly labor/i, /Everything else/i,
    ],
    forbid: [/salar/i, /3100\.2/, /budgeted, continuing/i, /Salaried managers/i],
  },
  {
    label: "SALARY GATE · STL - MO · P11 · sal=0",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - MO")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [/No services scheduled/i, /Hourly labor/i, /Everything else/i],
    forbid: [/salar/i, /3100\.2/],
  },
  {
    label: "SALARY GATE · TXR - TX - H · P11 · sal=0",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - H")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [/No services scheduled/i, /\$500/, /Everything else/i],
    forbid: [/salar/i, /3100\.2/],
  },
  {
    label: "SALARY GATE · TXR - TX - V · P11 · sal=0",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - V")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [/No services scheduled/i, /Hourly labor/i, /Everything else/i],
    forbid: [/salar/i, /3100\.2/],
  },
  // Salary-view intact check on all four accounts.
  {
    label: "SALARY VIEW · CIN - OH · P11 · sal=1 (full block, unchanged)",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [
      /Off season\. No revenue planned for P11/i,
      /Salaried managers stay on payroll/i,
      /Salaried labor · the period/i,
      /3100\.2 · budgeted, continuing/i,
      /\$6,722/,
    ],
  },
  {
    label: "SALARY VIEW · STL - MO · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - MO")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Salaried managers/i, /3100\.2 · budgeted, continuing/i, /\$6,538/],
  },
  {
    label: "SALARY VIEW · TXR - TX - H · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - H")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Salaried managers/i, /3100\.2 · budgeted, continuing/i, /\$6,722/, /\$500/],
  },
  {
    label: "SALARY VIEW · TXR - TX - V · P11 · sal=1",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - V")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Salaried managers/i, /3100\.2 · budgeted, continuing/i, /\$6,856/],
  },

  // R-137.1 · Three render fixes ------------------------------------
  // 4.1-4.4 · Revenue dash on budget fallback (step 1)
  {
    label: "4.1 STL - FL P11 sal=0 · Revenue weeks dash, no `forecast` word",
    kind: "revweeks",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - FL")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expectDash: true,
    expectPeriod: /\$52,061/,
    expectPeriodSub: /budget · no forecast yet/i,
  },
  {
    label: "4.2 STL - FL P12 sal=0 · Revenue weeks dash",
    kind: "revweeks",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - FL")}&start=2026-11-02&end=2026-11-29&include_salary=0`,
    expectDash: true,
    expectPeriod: /\$39,046/,
    expectPeriodSub: /budget · no forecast yet/i,
  },
  {
    label: "4.3 TBR - FL P13 sal=1 · week 4 stays `forecast $0`, not dash",
    kind: "revweeks",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TBR - FL")}&start=2026-11-30&end=2026-12-27&include_salary=1`,
    expectDash: false,
    // Week 4 amount + week 4 renders "forecast $0" (a real zero), rest are non-zero.
    expectWeekTexts: [/forecast[\s\S]{0,3}\$/i, /forecast[\s\S]{0,3}\$0/],
  },
  {
    label: "4.4 CIN - AZ P11 sal=1 · Revenue weeks unchanged",
    kind: "revweeks",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - AZ")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expectDash: false,
    expectWeekTexts: [/\$8,469/, /\$13,628/],
  },

  // 4.5-4.7 · Off-season copy adapts, salary card conditional (step 2)
  {
    label: "4.5 CIN - KY P11 sal=1 · no salary card, `No salary is budgeted...`",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - KY")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [
      /No salary is budgeted for this period\. What is budgeted below continues through the break\./i,
      /\$300/,
      /Everything else/i,
    ],
    forbid: [
      /SALARIED LABOR · THE PERIOD/i,
      /Salaried labor · the period/i,
      /3100\.2 · budgeted, continuing/i,
      /Salaried managers stay on payroll/i,
    ],
  },
  {
    label: "4.6 TBJ - NY P11 sal=1 · no salary card, `Nothing is budgeted...`",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TBJ - NY")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [/Nothing is budgeted against this period\./i],
    forbid: [/Salaried labor · the period/i, /3100\.2 · budgeted, continuing/i, /Salaried managers/i],
  },
  {
    label: "4.7 TXR - TX - V P12 sal=1 · no salary card, `Nothing is budgeted...`",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - V")}&start=2026-11-02&end=2026-11-29&include_salary=1`,
    expect: [/Nothing is budgeted against this period\./i],
    forbid: [/Salaried labor · the period/i, /3100\.2 · budgeted, continuing/i, /Salaried managers/i],
  },

  // 4.8-4.10 · Hourly view copy variants (step 2b) + salary-gate holds
  {
    label: "4.8 CIN - KY P11 sal=0 · `There is nothing to schedule. What is budgeted below...`",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - KY")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [
      /There is nothing to schedule\. What is budgeted below continues through the break\./i,
      /\$300/,
      /Everything else/i,
    ],
    forbid: [/salar/i, /3100\.2/, /budgeted, continuing/i, /Salaried managers/i],
  },
  {
    label: "4.9 TXR - TX - H P11 sal=0 · same schedule copy, `$500`, no salary leak",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - H")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [
      /There is nothing to schedule\. What is budgeted below continues through the break\./i,
      /\$500/,
      /Everything else/i,
    ],
    forbid: [/salar/i, /3100\.2/, /budgeted, continuing/i, /Salaried managers/i],
  },
  {
    label: "4.10 CIN - OH P11 sal=0 · `nothing to schedule or spend` (other=0), no salary leak",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-10-05&end=2026-11-01&include_salary=0`,
    expect: [/There is nothing to schedule or spend against this period\./i],
    forbid: [/salar/i, /3100\.2/, /budgeted, continuing/i, /Salaried managers/i, /What is budgeted below/i],
  },

  // 4.11 · Season line sweep: `The season has ended.` on every off-season block, no P{N} clause
  {
    label: "4.11a CIN - OH P12 sal=1 · `The season has ended.` no `ended in P`",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-11-02&end=2026-11-29&include_salary=1`,
    expect: [/The season has ended\./i],
    forbid: [/ended in P/i, /season ended in/i],
  },
  {
    label: "4.11b CIN - OH P13 sal=1",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-11-30&end=2026-12-27&include_salary=1`,
    expect: [/The season has ended\./i],
    forbid: [/ended in P/i, /season ended in/i],
  },
  {
    label: "4.11c STL - MO P13 sal=1",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("STL - MO")}&start=2026-11-30&end=2026-12-27&include_salary=1`,
    expect: [/The season has ended\./i],
    forbid: [/ended in P/i, /season ended in/i],
  },
  {
    label: "4.11d TXR - TX - V P12 sal=0 (hourly)",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("TXR - TX - V")}&start=2026-11-02&end=2026-11-29&include_salary=0`,
    expect: [/The season has ended\./i],
    forbid: [/ended in P/i, /season ended in/i, /salar/i],
  },

  // 4.12 · Salary-view intact where salary is real (regression check)
  {
    label: "4.12 CIN - OH P11 sal=1 · salary card intact ($6,722), original copy",
    kind: "block",
    url: `${BASE}/kpi/overview?account=${encodeURIComponent("CIN - OH")}&start=2026-10-05&end=2026-11-01&include_salary=1`,
    expect: [
      /Salaried labor · the period/i,
      /\$6,722/,
      /3100\.2 · budgeted, continuing/i,
      /Salaried managers stay on payroll through the break, and that cost is budgeted\. Nothing here is a variance\./i,
    ],
  },
];

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();

// Give the client-side hydration enough time; grep against innerText.
async function readAfterHydration(url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => {
    const t = document.body.innerText || "";
    return /Period running|Period closed|Planning view|Off season/i.test(t);
  }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p.evaluate(() => document.body.innerText || "");
}
// Scoped read: only the off-season block's own DOM text. Excludes
// the dashboard-wide "+ Salary" toggle button, which is a role-
// gated user control, not off-season disclosure. Kevin ruling
// 2026-09-21 was about the BLOCK not mentioning salary.
async function readOffSeasonBlock(url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => {
    const el = document.querySelector(".kpi-ov-cp-offseason");
    return !!el && (el.innerText || "").length > 20;
  }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  return p.evaluate(() => {
    const el = document.querySelector(".kpi-ov-cp-offseason");
    return el ? el.innerText : "";
  });
}

// Read the 4 revenue week cells (grid col 2..5 on the Revenue row).
// Structure: the Revenue row's row-label div carries the row name;
// the week cells sit next to it. Selector strategy: find the .kpi-
// ov-cp-rn with text "Revenue" and read the four sibling cells on
// the same grid row via style attribute or index.
async function readRevenueWeekCells(url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => /Period running|Period closed|Planning view|Off season/i.test(document.body.innerText||""), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p.evaluate(() => {
    // Revenue row label lives inside .kpi-ov-cp-rn. Find it.
    const rnDivs = Array.from(document.querySelectorAll(".kpi-ov-cp-rn"));
    const revLabel = rnDivs.find(d => (d.innerText || "").trim() === "Revenue");
    if (!revLabel) return { found: false };
    // The rlab wrapper carries a gridRow inline style; sibling cells
    // share it. Walk the parent .kpi-ov-cp-grid to find cells with
    // matching gridRow.
    const rlab = revLabel.closest(".kpi-ov-cp-rlab");
    if (!rlab) return { found: false };
    const gridRow = rlab.style.gridRow;
    const grid = rlab.parentElement;
    if (!grid) return { found: false };
    const siblings = Array.from(grid.children);
    const weekCells = siblings.filter(el => el.style.gridRow === gridRow && el.classList.contains("kpi-ov-cp-cell") && !el.classList.contains("kpi-ov-cp-per"));
    return {
      found: true,
      cellTexts: weekCells.map(el => el.innerText || ""),
      hasDashClass: weekCells.some(el => el.querySelector(".kpi-ov-cp-dash")),
    };
  });
}
async function readPeriodCell(url) {
  return p.evaluate(() => {
    const rnDivs = Array.from(document.querySelectorAll(".kpi-ov-cp-rn"));
    const revLabel = rnDivs.find(d => (d.innerText || "").trim() === "Revenue");
    if (!revLabel) return "";
    const rlab = revLabel.closest(".kpi-ov-cp-rlab");
    if (!rlab) return "";
    const gridRow = rlab.style.gridRow;
    const grid = rlab.parentElement;
    if (!grid) return "";
    const per = Array.from(grid.children).find(el => el.style.gridRow === gridRow && el.classList.contains("kpi-ov-cp-per"));
    return per ? (per.innerText || "") : "";
  });
}

let passed = 0, failed = 0;
for (const c of CASES) {
  if (c.kind === "revweeks") {
    const wk = await readRevenueWeekCells(c.url);
    const per = await readPeriodCell(c.url);
    let ok = true;
    const notes = [];
    if (!wk.found) { ok = false; notes.push("Revenue row not found"); }
    else if (c.expectDash) {
      // Every cell should render "—" via kpi-ov-cp-dash class, and
      // NOT contain the word "forecast".
      if (!wk.hasDashClass) { ok = false; notes.push("dash class absent"); }
      const any = wk.cellTexts.some(t => /forecast/i.test(t));
      if (any) { ok = false; notes.push(`forecast word leaked into week cells: ${JSON.stringify(wk.cellTexts)}`); }
      const allDash = wk.cellTexts.every(t => /^\s*[—-]\s*$/.test(t.trim()) || t.includes("—"));
      if (!allDash) { ok = false; notes.push(`not all cells dashed: ${JSON.stringify(wk.cellTexts)}`); }
    } else if (c.expectWeekTexts) {
      for (const re of c.expectWeekTexts) {
        const someHit = wk.cellTexts.some(t => re.test(t));
        if (!someHit) { ok = false; notes.push(`no week cell matched ${re.source}`); }
      }
      if (wk.hasDashClass) { ok = false; notes.push("dash class unexpectedly present"); }
    }
    if (c.expectPeriod && !c.expectPeriod.test(per)) { ok = false; notes.push(`period cell missing ${c.expectPeriod.source}`); }
    if (c.expectPeriodSub && !c.expectPeriodSub.test(per)) { ok = false; notes.push(`period sub missing ${c.expectPeriodSub.source}`); }
    if (ok) { passed += 1; console.log(`PASS · ${c.label}`); }
    else { failed += 1; console.log(`FAIL · ${c.label}`); for (const n of notes) console.log(`  ${n}`); }
    continue;
  }
  if (c.kind === "block") {
    const text = await readOffSeasonBlock(c.url);
    const misses = [];
    for (const re of (c.expect || [])) if (!re.test(text)) misses.push(re.source);
    const forbidHits = [];
    for (const re of (c.forbid || [])) if (re.test(text)) forbidHits.push(re.source);
    const ok = misses.length === 0 && forbidHits.length === 0;
    if (ok) { passed += 1; console.log(`PASS · ${c.label}`); }
    else {
      failed += 1;
      console.log(`FAIL · ${c.label}`);
      if (misses.length) console.log(`  missing: ${JSON.stringify(misses)}`);
      if (forbidHits.length) console.log(`  forbid hit: ${JSON.stringify(forbidHits)}`);
    }
    continue;
  }
  if (c.kind === "payload") {
    const r = await fetch(c.laborUrl);
    const d = await r.json();
    const res = c.check(d);
    if (res.ok) { passed += 1; console.log(`PASS · ${c.label}  ${res.msg}`); }
    else { failed += 1; console.log(`FAIL · ${c.label}  ${res.msg}`); }
    continue;
  }
  const text = await readAfterHydration(c.url);
  const misses = [];
  for (const re of (c.expect || [])) if (!re.test(text)) misses.push(re.source);
  const forbidHits = [];
  for (const re of (c.forbid || [])) if (re.test(text)) forbidHits.push(re.source);
  const ok = misses.length === 0 && forbidHits.length === 0;
  if (ok) { passed += 1; console.log(`PASS · ${c.label}`); }
  else {
    failed += 1;
    console.log(`FAIL · ${c.label}`);
    if (misses.length) console.log(`  missing: ${JSON.stringify(misses)}`);
    if (forbidHits.length) console.log(`  forbid hit: ${JSON.stringify(forbidHits)}`);
  }
}

await b.close();
console.log();
console.log(`R-137 acceptance: ${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
