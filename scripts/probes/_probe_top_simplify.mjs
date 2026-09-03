#!/usr/bin/env node
// scripts/probes/_probe_top_simplify.mjs
//
// Kevin ruling 2026-09-03: top-simplify PR. Standing probe for the
// simplified Overview top section.
//
//   Item 1  Status line is a single pill:
//             closed  -> "Period closed · off target" / "... · on target"
//             open    -> "Off target" / "On track" / etc. (ticker copy)
//             no target -> "No target" (neutral tone)
//   Item 2  Each card renders EXACTLY two money-or-percent figures + pill.
//             Revenue     Actual $X       Budget $Y    Above / Below
//             Cost of goods Actual N.N%   Target M.M%  N.N% over / under
//             Gross margin  Actual N.N%   Target M.M%  N.N% below / above
//   Item 3  Data-current popover carries two new rows:
//             Periods    P1-P8 verified (or P8 verified)
//             Inventory  actualized / pending · P6 / lands at close
//   Item 4  Row LABELS carry the horizon:
//             closed range -> "Actual" and "Budget"
//             open range   -> "Actual to date" and "Budget to date"
//             Target row keeps "Target" on both.
//   Tooltips carry live figures (Kevin's addition to the probe):
//             COGS ?   -> when envelope_delta > $1, tooltip includes
//                        the "$X more / less" sentence.
//             Revenue ? -> on FYTD with budget_full_year known,
//                        tooltip includes "The full-year budget is $Y."
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_top_simplify.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const CASES = [
  // Kevin: TBJ - FL + TBR - FL on all three ranges (both train next week).
  // Plus CIN - OH (management fee) and CIN - KY (salaried only).
  { name: "TBJ - FL FYTD",   account: "TBJ - FL", qs: "",                                       kind: "fytd" },
  { name: "TBJ - FL P8",     account: "TBJ - FL", qs: "start=2026-07-13&end=2026-08-09",        kind: "single_closed" },
  { name: "TBJ - FL P9",     account: "TBJ - FL", qs: "start=2026-08-10&end=2026-09-06",        kind: "single_open" },
  { name: "TBR - FL FYTD",   account: "TBR - FL", qs: "",                                       kind: "fytd" },
  { name: "TBR - FL P8",     account: "TBR - FL", qs: "start=2026-07-13&end=2026-08-09",        kind: "single_closed" },
  { name: "TBR - FL P9",     account: "TBR - FL", qs: "start=2026-08-10&end=2026-09-06",        kind: "single_open" },
  { name: "CIN - OH FYTD",   account: "CIN - OH", qs: "",                                       kind: "fytd" },
  { name: "CIN - KY FYTD",   account: "CIN - KY", qs: "",                                       kind: "fytd" },
];

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: {name:"T",email:"t@k.com",image:null}, expires: new Date(Date.now()+864e5).toISOString() }) });
  });
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

// A "money-or-percent" figure is any token like "$1,234", "$1,234,567",
// or "42.6%" (with sign, with or without decimals). Excludes bare
// dashes and text.
const FIG_RE = /(?:-?\$[\d,]+(?:\.\d+)?|-?\d+(?:\.\d+)?%)/g;
function countFigures(s) {
  if (!s) return 0;
  return (s.match(FIG_RE) || []).length;
}

// Item 1 pill copy expectations. On has-target ranges only.
function expectedPillCopy(kind) {
  if (kind === "single_open") return /^(OFF TARGET|ON TARGET|ON TRACK|BEHIND TARGET|AT RISK|AHEAD)$/;
  // closed (single_closed or fytd)
  return /^PERIOD CLOSED · (ON TARGET|OFF TARGET)$/;
}

async function inspect(page, c) {
  const url = c.qs
    ? `${BASE}/kpi/overview?account=${acct(c.account)}&${c.qs}`
    : `${BASE}/kpi/overview?account=${acct(c.account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(800);

  // Item 3: click the "Data current" freshness pill to open the
  // popover; its rows carry data-kpi-ov attrs we assert against.
  // Also open the Revenue + COGS tooltips (HelpPop click).
  await page.evaluate(() => {
    document.querySelector(".kpi-fresh")?.click();
    document.querySelector('[data-hs-help="overview-card-revenue"]')?.click();
    document.querySelector('[data-hs-help="overview-card-cogs"]')?.click();
  });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const readCard = (sel) => {
      const c = document.querySelector(sel);
      if (!c) return null;
      const eyebrow = c.querySelector('.kpi-ov-eb')?.innerText.trim() || null;
      const pill = c.querySelector('[data-kpi-ov="pill"]')?.innerText.trim() || null;
      const actualRow = c.querySelector('[data-kpi-ov="card-actual"]');
      const refRow = c.querySelector('[data-kpi-ov="card-reference"]');
      const actualK = actualRow?.querySelector('.kpi-ov-pair-k')?.innerText.trim() || null;
      const actualV = actualRow?.querySelector('.kpi-ov-pair-v')?.innerText.trim() || null;
      const refK = refRow?.querySelector('.kpi-ov-pair-k')?.innerText.trim() || null;
      const refV = refRow?.querySelector('.kpi-ov-pair-v')?.innerText.trim() || null;
      // Money-or-percent figures on the whole card body (not the header
      // pill, not the eyebrow).
      const body = c.querySelector('.kpi-ov-cb')?.innerText || "";
      return {
        eyebrow, pill,
        actualK, actualV, refK, refV,
        bodyFigureCount: (body.match(/(?:-?\$[\d,]+(?:\.\d+)?|-?\d+(?:\.\d+)?%)/g) || []).length,
        bodyText: body.replace(/\s+/g, " ").trim(),
      };
    };
    const status = (() => {
      // Kevin ruling final-presentation (2026-09-03) item 1: the
      // status row carries the pill AND a horizon line. Read the pill
      // via .kpi-ov-status-pill, not the parent statusrow which
      // includes the horizon text.
      const pill = document.querySelector(".kpi-ov-status-pill");
      const row = document.querySelector('[data-kpi-ov="status-line"]');
      if (!pill && !row) return null;
      const src = pill || row;
      return {
        state: (pill || row)?.getAttribute("data-kpi-ov-state") || row?.getAttribute("data-kpi-ov-state") || null,
        tone: (pill || row)?.getAttribute("data-kpi-ov-tone") || row?.getAttribute("data-kpi-ov-tone") || null,
        text: pill?.innerText.trim() || row?.querySelector('[data-kpi-ov="status-state"]')?.innerText.trim() || "",
      };
    })();
    // The Data-current popover: read the Periods + Inventory rows if
    // they exist.
    const periods = document.querySelector('[data-kpi-ov="data-current-periods"]')?.innerText.trim() || null;
    const inventory = document.querySelector('[data-kpi-ov="data-current-inventory"]')?.innerText.trim() || null;
    // Tooltip content: HelpPop portals to .kpi-app; look for the
    // inline data attrs the CardsRow tooltip body renders on <p>.
    // Query the whole document so we pick up portalled nodes.
    const envTip = document.querySelector('[data-hs-help-for="overview-card-cogs"] [data-kpi-ov="cogs-tip-envelope"]')?.innerText.trim() || null;
    const yearTip = document.querySelector('[data-hs-help-for="overview-card-revenue"] [data-kpi-ov="revenue-tip-year"]')?.innerText.trim() || null;
    return {
      status,
      revenue: readCard('[data-kpi-ov="card-revenue"]'),
      cogs: readCard('[data-kpi-ov="card-cogs"]'),
      gm: readCard('[data-kpi-ov="card-gross_margin"]'),
      periods,
      inventory,
      envTip,
      yearTip,
    };
  });

  return info;
}

function assertCard(name, cardName, info, c, expectedActualLabel, expectedRefLabel, expectedFigCount) {
  if (!info) { fail(`${name} ${cardName}`, `card missing`); return; }
  // Item 2 (final-presentation): Revenue card carries 2 figures
  // (Actual $ + Forecast $). COGS + GM cards carry 4 figures each
  // (pct + $ on both Actual and Target).
  if (info.bodyFigureCount !== expectedFigCount) {
    fail(`${name} ${cardName}`, `body figure count = ${info.bodyFigureCount}, want ${expectedFigCount} · body="${info.bodyText}"`);
  }
  // Item 4: row labels carry horizon on open ranges.
  if (info.actualK !== expectedActualLabel) {
    fail(`${name} ${cardName}`, `actual label = ${JSON.stringify(info.actualK)}, want ${JSON.stringify(expectedActualLabel)}`);
  }
  if (info.refK !== expectedRefLabel) {
    fail(`${name} ${cardName}`, `reference label = ${JSON.stringify(info.refK)}, want ${JSON.stringify(expectedRefLabel)}`);
  }
  if (!info.pill) {
    fail(`${name} ${cardName}`, `pill missing`);
  }
}

async function main() {
  console.log(`# top-simplify - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1200 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const c of CASES) {
    const before = FAILS.length;
    const info = await inspect(page, c);
    const isOpen = c.kind === "single_open";
    const actualLabel = isOpen ? "Actual to date" : "Actual";

    // Item 1: pill copy per range.
    if (!info.status) {
      fail(`${c.name}`, `status line missing`);
    } else {
      const wantRe = expectedPillCopy(c.kind);
      // Status text is UPPERCASE via CSS transform; innerText might read
      // uppercase or the raw casing depending on browser. Match both.
      const upped = info.status.text.toUpperCase();
      if (!wantRe.test(upped)) {
        fail(`${c.name}`, `pill copy = ${JSON.stringify(info.status.text)}, want ${wantRe.toString()}`);
      }
      // Tone must not be neutral on has-target ranges (all in CASES have target).
      if (info.status.tone === "neutral" && c.account !== "CIN - OH") {
        fail(`${c.name}`, `pill tone neutral on a has-target range`);
      }
    }

    // Item 2 + 4: each card. Revenue = 2 figures (dollars only per
    // both rows). COGS + GM = 4 figures each (pct + $ on both rows).
    const revRefLabel = isOpen ? "Forecast to date" : "Forecast";
    assertCard(c.name, "Revenue", info.revenue, c, actualLabel, revRefLabel, 2);
    assertCard(c.name, "COGS", info.cogs, c, actualLabel, "Target", 4);
    assertCard(c.name, "GM", info.gm, c, actualLabel, "Target", 4);

    // Item 3: Data-current popover shows Periods on any range with
    // verified content. Single-open ranges have nothing verified in
    // range (P9 is running, not verified), so Periods is legitimately
    // absent there.
    if (c.kind !== "single_open" && !info.periods) {
      fail(`${c.name}`, `Data-current popover: Periods row missing`);
    }
    // Inventory row present on SC-driven / sales-based accounts;
    // absent on MF (CIN - OH). CIN - KY is salaried but still carries
    // food inventory - should appear.
    const wantInv = c.account !== "CIN - OH";
    if (wantInv && !info.inventory) {
      fail(`${c.name}`, `Data-current popover: Inventory row missing`);
    }
    if (!wantInv && info.inventory) {
      fail(`${c.name}`, `Data-current popover: Inventory row unexpected on MF account`);
    }

    // Tooltip live-figure assertions (Kevin's addition):
    //   Revenue ? on FYTD carries "The full-year budget is $Y."
    //   COGS ? carries envelope sentence on any has-target range where
    //          envelope_delta magnitude >= $1 (we accept presence when
    //          it exists; absence is OK when |delta| < $1).
    if (c.kind === "fytd" && c.account !== "CIN - OH") {
      if (!info.yearTip || !/full-year budget is \$/.test(info.yearTip)) {
        fail(`${c.name}`, `Revenue tooltip: full-year budget sentence missing / malformed · got=${JSON.stringify(info.yearTip)}`);
      }
    }
    // For COGS envelope sentence: assert it CAN carry the shape when
    // present. If server ships envelope_delta null (MF / no target),
    // the sentence stays absent - not an error.
    if (info.envTip && !/envelope is \$[\d,]+ (more|less) than the original budget/.test(info.envTip)) {
      fail(`${c.name}`, `COGS envelope tooltip malformed: ${JSON.stringify(info.envTip)}`);
    }

    const after = FAILS.length;
    const tag = after === before ? "OK  " : "FAIL";
    console.log(`  ${tag} ${c.name.padEnd(16)} rev=${info.revenue?.bodyFigureCount}fig cogs=${info.cogs?.bodyFigureCount}fig gm=${info.gm?.bodyFigureCount}fig · pill=${JSON.stringify(info.status?.text || "")}`);
  }

  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: top-simplify acceptance holds on all cases.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
