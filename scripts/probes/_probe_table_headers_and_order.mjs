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

const TABLES = [
  {
    key: "cost-lines",
    sel: '[data-kpi-ov="cost-lines-table"]',
    // Kevin R-58/R-59 (2026-09-03): management-fee accounts read
    // "P{N} budget" instead of "Budget adjusted P{N}" - revenue is
    // contractual so no adjustment applies. Accepted patterns cover
    // both shapes.
    expectedOrder: {
      // Merged 2026-09-03: PR-A (R-58/R-59) added the "P{N} budget"
      // alternation on the budget column for management-fee accounts;
      // PR-B (item 4) added the "Final P#" actuals header on closed
      // periods. Both survive: budget takes main's alternation on all
      // three range kinds, actuals takes the branch's FINAL P# on
      // single_closed only.
      fytd:          ["LINE", /(BUDGET ADJUSTED P\d+|P\d+ BUDGET)/i, /SPENT (THRU P\d+|PERIOD TO DATE)/i, "% OF REV", "TARGET %", "VS TARGET"],
      single_closed: ["LINE", /(BUDGET ADJUSTED P\d+|P\d+ BUDGET)/i, /FINAL P\d+/i, "% OF REV", "TARGET %", "VS TARGET"],
      single_open:   ["LINE", /(BUDGET ADJUSTED P\d+|P\d+ BUDGET|PERIOD BUDGET)/i, /SPENT (THRU P\d+|PERIOD TO DATE)/i, "% OF REV", "TARGET %", "VS TARGET"],
    },
  },
  {
    key: "revenue-lines",
    sel: '[data-kpi-ov="revenue-lines-table"]',
    // Revenue lines shows budget-to-date (Budget thru P#) + optionally
    // period budget (single open only). Actual header is ptdLabel
    // ("Thru P8" on FYTD/verified single, "Period to date" on open).
    expectedOrder: {
      // FYTD (closed-only after PR-1): showBudgetToDate=true,
      // showPeriodBudget=false -> [Line, Budget thru P#, Thru P#, %]
      fytd:          ["LINE", /BUDGET (THRU P\d+|PERIOD TO DATE)/i, /(THRU P\d+|PERIOD TO DATE|FINAL P\d+)/i, "% OF REV"],
      // Verified single: showBudgetToDate=false, showPeriodBudget=true
      // -> [Line, P# budget, Final P#, %]
      single_closed: ["LINE", /P\d+ BUDGET/i, /(THRU P\d+|FINAL P\d+)/i, "% OF REV"],
      // Open single: both columns shown -> [Line, Budget PTD, P# budget, PTD, %]
      single_open:   ["LINE", /BUDGET (THRU P\d+|PERIOD TO DATE)/i, /P\d+ BUDGET/i, /(THRU P\d+|PERIOD TO DATE)/i, "% OF REV"],
    },
  },
  {
    key: "also-tracked",
    sel: '[data-kpi-ov="also-tracked"] table',
    expectedOrder: {
      fytd:          ["LINE", /BUDGET (THRU P\d+|PERIOD TO DATE)/i, /SPEND (THRU P\d+|PERIOD TO DATE)/i, "VS BUDGET"],
      // Kevin PR-B item 5 (2026-09-03): also-tracked on single closed
      // uses `P# budget` + `Final P#` - matches the other tables.
      single_closed: ["LINE", /P\d+ BUDGET/i, /FINAL P\d+/i, "VS BUDGET"],
      single_open:   ["LINE", /BUDGET (THRU P\d+|PERIOD TO DATE)/i, /SPEND (THRU P\d+|PERIOD TO DATE)/i, "VS BUDGET"],
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
      const ths = [...table.querySelectorAll("thead th")];
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
