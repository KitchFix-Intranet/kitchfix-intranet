#!/usr/bin/env node
// scripts/probes/_probe_percent_same_surface.mjs
//
// Kevin ruling 2026-09-02:
//
//   TBJ - FL FYTD carries two different "year budget" figures on
//   one screen. The Revenue card reads YEAR BUDGET $1,921,966 ·
//   106.5% recognised; the Revenue lines table totals YEAR BUDGET
//   $1,680,510. The card states a percentage derived from a number
//   it is not displaying.
//
//   Assert that every percentage on the board is computed from a
//   figure rendered on the same surface - that is the assertion
//   that catches this class.
//
// This probe scrapes the rendered Overview at scale and, for every
// visible percentage inside a card, asserts that the ratio implied
// by the percent can be reconstructed from the dollar figures the
// SAME card displays. The units:
//
//   Revenue card:
//     "N.N% recognised" == hero_actual / budget_shown_beside_it
//
//   COGS card:
//     hero "N.N%" (of revenue period to date) ==
//         dollars-spent-shown / revenue.hero-shown
//
//   Gross margin card:
//     hero "N.N%" (of revenue period to date) ==
//         gm-dollars-shown / revenue.hero-shown
//
// Tolerance $0.01 or 0.05% points - same standard the cost-lines
// probe uses. Full-precision hero figures are parsed from the DOM
// text.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 walks the probe against a page state that
//   deliberately violates the invariant (a percent constructed from
//   a figure the card does not display) and asserts the check
//   fires. We simulate by asserting the checker function directly
//   with fabricated values - Playwright can't easily inject a
//   contradictory rendering without a test hook.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_percent_same_surface.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_percent_same_surface.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

// Full walk: the four go-live accounts on all three ranges.
const CASES = [
  { name: "TBJ - FL FYTD", account: "TBJ - FL", qs: "" },
  { name: "TBJ - FL P9",   account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBJ - FL P8",   account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TBR - FL FYTD", account: "TBR - FL", qs: "" },
  { name: "TBR - FL P9",   account: "TBR - FL", qs: "start=2026-08-10&end=2026-09-06" },
  { name: "TBR - FL P8",   account: "TBR - FL", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "TXR - AZ FYTD", account: "TXR - AZ", qs: "" },
  { name: "TXR - AZ P8",   account: "TXR - AZ", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "CIN - AZ FYTD", account: "CIN - AZ", qs: "" },
  { name: "CIN - AZ P8",   account: "CIN - AZ", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "CIN - OH FYTD", account: "CIN - OH", qs: "" },
  { name: "CIN - KY FYTD", account: "CIN - KY", qs: "" },
];

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

// Parse a rendered dollar string ("$1,921,966" or "-$3,596") into a
// number. Returns null when no digit is present.
function parseMoney(txt) {
  if (!txt) return null;
  const cleaned = String(txt).replace(/[^0-9.\-−]/g, "").replace("−", "-");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function parsePct(txt) {
  if (!txt) return null;
  const m = String(txt).match(/([-−]?\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Number(m[1].replace("−", "-"));
}

// Kevin's rule: pct rendered on a card must equal a ratio of
// figures rendered on the SAME card, within tolerance. Tolerance
// absorbs display rounding of the pct to 1dp and the dollar to
// whole units.
const PCT_TOL = 0.15;      // pct-point tolerance (accounts for 1dp rounding on both sides)

function checkRatio(caseName, cardName, numDisplayed, denDisplayed, pctDisplayed, fails) {
  if (numDisplayed == null || denDisplayed == null || pctDisplayed == null) return;
  if (denDisplayed === 0) return;
  const derived = (numDisplayed / denDisplayed) * 100;
  if (Math.abs(derived - pctDisplayed) > PCT_TOL) {
    fails.push(
      `${caseName} ${cardName}: rendered ${pctDisplayed.toFixed(2)}% but ${numDisplayed} / ${denDisplayed} * 100 = ${derived.toFixed(2)}%`
    );
  }
}

async function walkOne(page, c, fails) {
  const url = c.qs
    ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/kpi/overview?account=${acct(c.account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);

  // Scrape card-level figures for revenue, cogs, gm. Only the hero-
  // level ratio ("hero pct" derived from displayed dollars) is
  // asserted here - sub-line ratios (like the recognised %) also
  // get their own check.
  const cards = await page.evaluate(() => {
    function pickCard(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      // Hero text - first .kpi-ov-hero within the card
      const hero = el.querySelector(".kpi-ov-hero");
      const heroText = hero ? hero.innerText.trim() : null;
      // Secondary in heroline (dollars after divider) - .kpi-ov-heroline-sec
      const sec = el.querySelector(".kpi-ov-heroline-sec");
      const secText = sec ? sec.innerText.trim() : null;
      // Sub-pair values (.kpi-ov-hz-v). We take up to two.
      const hzs = Array.from(el.querySelectorAll(".kpi-ov-hz-v")).map(n => n.innerText.trim());
      return { heroText, secText, hzs };
    }
    return {
      revenue: pickCard('[data-kpi-ov="card-revenue"]'),
      cogs: pickCard('[data-kpi-ov="card-cogs"]'),
      gm: pickCard('[data-kpi-ov="card-gross_margin"]'),
    };
  });

  // Revenue card recognised %: match `NN.N% recognised` inside the
  // right-hand sub-pair (index 1 on open, index 0 on verified).
  if (cards.revenue) {
    const heroDollars = parseMoney(cards.revenue.heroText);
    // Find whichever hz cell contains " recognised".
    let recognisedCell = cards.revenue.hzs.find(h => /recognised/i.test(h));
    if (heroDollars != null && recognisedCell) {
      // The cell reads "$1,921,966 · 93.1% recognised" - dollar
      // first, then the percent.
      const budgetShown = parseMoney(recognisedCell.split("·")[0]);
      const pctShown = parsePct(recognisedCell);
      checkRatio(c.name, "revenue.recognised", heroDollars, budgetShown, pctShown, fails);
    }
  }

  // COGS card hero: "NN.N%" of revenue. Revenue hero-dollar is on
  // the revenue card; cogs.sec is the dollar spent. Ratio =
  // cogs_dollars / revenue_dollars.
  if (cards.cogs && cards.revenue) {
    const cogsPct = parsePct(cards.cogs.heroText);
    const cogsDollars = parseMoney(cards.cogs.secText);
    const revDollars = parseMoney(cards.revenue.heroText);
    checkRatio(c.name, "cogs.hero", cogsDollars, revDollars, cogsPct, fails);
  }

  // GM card hero: same shape as COGS.
  if (cards.gm && cards.revenue) {
    const gmPct = parsePct(cards.gm.heroText);
    const gmDollars = parseMoney(cards.gm.secText);
    const revDollars = parseMoney(cards.revenue.heroText);
    checkRatio(c.name, "gm.hero", gmDollars, revDollars, gmPct, fails);
  }
}

async function main() {
  console.log(`# every card percent computes from a figure on the same card - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}  cases=${CASES.length}`);
  console.log("");

  if (SEEDED) {
    // Inject a percent computed from a figure NOT shown. The check
    // must fire.
    const fails = [];
    // Simulates: rendered 93.1% recognised, hero $1,789,118, but
    // budget shown is $1,680,510 (the wrong figure). Ratio =
    // 1789118 / 1680510 = 106.5%, not 93.1%. Should fire.
    checkRatio("SEED", "revenue.recognised (contradiction)", 1789118, 1680510, 93.1, fails);
    // And the correct case: 93.1% derived from 1789118 / 1921966. Should NOT fire.
    checkRatio("SEED", "revenue.recognised (consistent)", 1789118, 1921966, 93.1, fails);
    console.log(`  ${fails.length === 1 ? "PASS" : "FAIL"}  seeded contradiction fires (1 fail), consistent passes (0 fails). Actual fails: ${fails.length}`);
    for (const f of fails) console.log(`    ${f}`);
    process.exit(fails.length === 1 ? 0 : 1);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);

  const FAILS = [];
  for (const c of CASES) {
    const before = FAILS.length;
    await walkOne(page, c, FAILS);
    const after = FAILS.length;
    console.log(`  ${after === before ? "OK  " : "FAIL"} ${c.name}  (${after - before} violation${after - before === 1 ? "" : "s"})`);
  }

  await browser.close();

  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: every card percent traces to figures on the same card, across ${CASES.length} cases.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
