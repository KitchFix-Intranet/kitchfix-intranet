#!/usr/bin/env node
// scripts/probes/_probe_table_headers_and_order.mjs
//
// Kevin ruling 2026-09-03:
//
//   Item 3 · budget precedes actual on every table.
//   Item 4 · adjacent header pairs must have a positive gap.
//
// ORDER RULE (Item 3)
//
//   Overview Cost lines:  [Line, Budget adjusted P#, Spent thru P#, %, target, vs target]
//   Overview Revenue lines (FYTD): [Line, Budget thru P#, Thru P#, % of rev]
//   Overview Also tracked (FYTD/open): [Line, Budget thru P#, Spend thru P#, vs budget]
//
//   The budget-side column comes before the actual-side column in
//   every case. Assertions read the RENDERED DOM order, not the
//   payload, because order is a render decision.
//
// HEADER-GAP RULE (Item 4)
//
//   For every pair of adjacent header cells, the horizontal pixel
//   gap between them must be > 0. Prior CSS had 0 horizontal padding
//   on th + td, so "Spent thru P8" butted directly against "Budget
//   adjusted P8" reading as one string.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_table_headers_and_order.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  { name: "TBJ - FL FYTD",           account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P8 (verified)",  account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBJ - FL P9 (open)",      account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBR - FL FYTD",           account: "TBR - FL", qs: "" },
  { name: "TBR - FL P9 (open)",      account: "TBR - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "CIN - OH FYTD (fee)",     account: "CIN - OH", qs: "" },
  { name: "STL - MO FYTD (pass-thru)", account: "STL - MO", qs: "" },
  { name: "CIN - KY FYTD (salaried)", account: "CIN - KY", qs: "" },
];

// Kevin ruling final-presentation (2026-09-03) item 3: every table
// carries a Plan / Actual band. The scraper below reads the SUB-HEADER
// row (skipping the group header row that contains empty + PLAN +
// ACTUAL cells with colspan). Sub-header expected shapes:
//   cost-lines    Line · Budget* · Target % · Spent · % of rev
//   revenue-lines Line · Forecast · [P# budget] · Received · % of rev
//   also-tracked  Line · Budget · Spent · vs budget
const TABLES = [
  {
    key: "cost-lines",
    sel: '[data-kpi-ov="cost-lines-table"]',
    expectedOrder: {
      fytd:          ["LINE", /^BUDGET\*?$/i, "TARGET %", "SPENT", "% OF REV"],
      single_closed: ["LINE", /^BUDGET\*?$/i, "TARGET %", "SPENT", "% OF REV"],
      single_open:   ["LINE", /^BUDGET\*?$/i, "TARGET %", "SPENT", "% OF REV"],
    },
  },
  {
    key: "revenue-lines",
    sel: '[data-kpi-ov="revenue-lines-table"]',
    // Revenue: single plan col on FYTD + single_closed ("Forecast");
    // both plan cols on single_open ("Forecast" + "P# budget").
    // Actual sub-headers: "Received" + "% of rev".
    expectedOrder: {
      fytd:          ["LINE", "FORECAST", "RECEIVED", "% OF REV"],
      single_closed: ["LINE", /P\d+ BUDGET/i, "RECEIVED", "% OF REV"],
      single_open:   ["LINE", "FORECAST", /P\d+ BUDGET/i, "RECEIVED", "% OF REV"],
    },
  },
  {
    key: "also-tracked",
    sel: '[data-kpi-ov="also-tracked"] table',
    expectedOrder: {
      fytd:          ["LINE", "BUDGET", "SPENT", "VS BUDGET"],
      single_closed: ["LINE", "BUDGET", "SPENT", "VS BUDGET"],
      single_open:   ["LINE", "BUDGET", "SPENT", "VS BUDGET"],
    },
  },
];

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

function inferRangeKind(qs) {
  if (!qs) return "fytd";
  if (qs.includes("2026-08-10")) return "single_open";
  return "single_closed";
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function scrapeAndCheck(page, c) {
  const url = c.qs
    ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/kpi/overview?account=${acct(c.account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1000);

  const kind = inferRangeKind(c.qs);
  for (const t of TABLES) {
    const info = await page.evaluate(({ sel }) => {
      const table = document.querySelector(sel);
      if (!table) return null;
      // Kevin ruling final-presentation (2026-09-03): the Plan / Actual
      // group header row sits on the band. Skip it - the sub-header
      // row is what carries the column names + widths the reader
      // scans against.
      const rows = [...table.querySelectorAll("thead tr")];
      const subRow = rows.find(r => !r.classList.contains("kpi-ov-tband-grp")) || rows[rows.length - 1];
      const ths = subRow ? [...subRow.querySelectorAll("th")] : [];
      const labels = ths.map(th => th.innerText.trim());
      // Kevin's "gap" is a visual concept - the labels can't butt
      // together. With border-collapse:collapse the DOM rects touch
      // (edge-to-edge), so instead measure the gap between actual
      // TEXT bounding rects via Range API. That's what a reader
      // perceives as separation.
      function textRect(el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      }
      const textRects = ths.map(textRect);
      const gaps = [];
      for (let i = 0; i < textRects.length - 1; i++) {
        gaps.push(Math.round(textRects[i + 1].left - textRects[i].right));
      }
      return { labels, gaps };
    }, { sel: t.sel });
    if (!info) {
      // Also tracked may be absent on some accounts (no tracked
      // lines) - skip silently only for that table.
      if (t.key === "also-tracked") continue;
      fail(`${c.name} ${t.key}`, `table ${t.sel} missing`);
      continue;
    }
    // Item 3: ORDER
    const expected = t.expectedOrder[kind];
    if (expected) {
      if (info.labels.length !== expected.length) {
        fail(`${c.name} ${t.key}`, `column count ${info.labels.length} != expected ${expected.length}. actual=${JSON.stringify(info.labels)}`);
      } else {
        for (let i = 0; i < expected.length; i++) {
          const want = expected[i];
          const got = info.labels[i];
          const ok = (want instanceof RegExp) ? want.test(got) : got.toLowerCase() === want.toLowerCase();
          if (!ok) {
            fail(`${c.name} ${t.key}`, `header[${i}] = ${JSON.stringify(got)}, want ${want.toString()}`);
          }
        }
      }
    }
    // Item 4: GAPS
    for (let i = 0; i < info.gaps.length; i++) {
      if (info.gaps[i] <= 0) {
        fail(`${c.name} ${t.key}`, `gap between header[${i}] and header[${i+1}] = ${info.gaps[i]}px (must be > 0). headers=${JSON.stringify(info.labels)}`);
      }
    }
  }
}

async function main() {
  console.log(`# table headers + column order - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);
  for (const c of CASES) {
    const before = FAILS.length;
    await scrapeAndCheck(page, c);
    const after = FAILS.length;
    console.log(`  ${after === before ? "OK  " : "FAIL"} ${c.name}  (${after - before})`);
  }
  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: all tables budget-first, all header gaps > 0.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
