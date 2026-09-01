#!/usr/bin/env node
// scripts/probes/_probe_overview_preview_renders_board.mjs
//
// Permanent DOM-render assertion for the preview path.
//
// Scope grew twice as Kevin surfaced the second half of the bug:
//   Round 1 (PR-hotfix 08620b0): `?preview=<account>` on the Overview
//     returned an API 200 with a fully-formed payload, but the client
//     stayed on skeletons forever - the derived-account wipe in
//     page.js fired when the derived account transitioned from "" to
//     preview_account (from the response) and setData(null) nuked the
//     just-fetched payload. Byte-identity payload probe passed
//     because it compared payloads, not renders. Fixed by removing
//     the wipe.
//   Round 2 (Kevin, 2026-09-01): preview does not survive a section
//     switch. buildSectionHref in src/app/kpi/labor/components/Shell.js
//     carried only account+start+end - preview was dropped. Any hop
//     Overview -> Labor -> Purchasing kicked the caller back to the
//     corporate view. Kevin needs to walk an account end-to-end as
//     its operator sees it. Fixed by adding preview to the carry set.
//
// SURFACES ASSERTED
//   Scenario A - direct preview URLs render a board on each section
//     - Overview: ?preview=<account> (no ?account=)
//     - Overview: ?account=X&preview=Y (preview narrows a landing)
//     - Overview: ?preview=TXR - TX - V (tracked model)
//   Scenario B - preview survives a section hop through the section
//     menu links Shell.js emits
//     - Enter Overview in preview
//     - Follow the Labor section link, assert preview survived
//     - Follow the Purchasing section link, assert preview survived
//
// INVARIANTS (per case)
//   1. Board present within the timeout
//   2. NO skeleton visible after the API response settles
//   3. Command bar shows the previewed account name
//   4. Freshness pill is NOT the red "No recent walk"
//   5. Preview banner ".kpi-preview-banner" is present
//   6. Portfolio folio rail ".kpi-folio" is NOT present (preview
//      narrows to a single account - the rail collapses)
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 flips both scenarios into their broken-carry-set
//   shapes and asserts the invariants fire:
//     - Scenario A seed: navigate to an invalid preview account
//       (no board can render). Invariants must fire.
//     - Scenario B seed: navigate to Labor + Purchasing WITHOUT
//       preview in the URL (simulates the pre-fix carry set).
//       Invariants must fire.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_overview_preview_renders_board.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_overview_preview_renders_board.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const PREVIEW_ACCT = "CIN - AZ";

// Labor + Purchasing gate fetch on useSession().status === "authenticated"
// (labor page.js:233; purchasing renders through the same shape). The
// server-side TEST_MODE bypass in middleware.js doesn't propagate to
// NextAuth's client session shape, so under TEST_MODE those two boards
// would stay on the loading skeleton for a probe that doesn't login.
// Mock /api/auth/session with an authenticated shape so the client-
// side gates unblock. Server-side auth is unaffected (still gated by
// TEST_MODE + middleware). This makes the probe a real chef-walk
// without threading a login flow.
async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          name: "Test Chef",
          email: "test@kitchfix.com",
          image: null,
        },
        expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }),
    });
  });
}

const CASES_LIVE = [
  {
    name: "A1 ?preview=CIN - AZ (no urlAccount)",
    url: `${BASE}/kpi/overview?preview=${acct(PREVIEW_ACCT)}`,
    expectedAcct: PREVIEW_ACCT,
    expectPreviewUi: true,
  },
  {
    name: "A2 ?account=STL - FL&preview=CIN - OH (narrows a landing)",
    url: `${BASE}/kpi/overview?account=${acct("STL - FL")}&preview=${acct("CIN - OH")}`,
    expectedAcct: "CIN - OH",
    expectPreviewUi: true,
  },
  {
    name: "A3 ?preview=TXR - TX - V (tracked model)",
    url: `${BASE}/kpi/overview?preview=${acct("TXR - TX - V")}`,
    expectedAcct: "TXR - TX - V",
    expectPreviewUi: true,
  },
];

const CASES_SEED_A = [
  {
    name: "A-seed invalid preview must NOT render a board",
    url: `${BASE}/kpi/overview?preview=${acct("NOT_A_REAL_ACCOUNT")}`,
    expectedAcct: "NOT_A_REAL_ACCOUNT",
    expectPreviewUi: true,
    expectFail: true,
  },
];

const FAILS = [];
function fail(where, detail) { FAILS.push(`${where}  ${detail}`); }

function waitForApi(page, fragment) {
  return page.waitForResponse(r =>
    r.url().includes(fragment) && r.request().method() === "GET",
    { timeout: 15000 }
  ).catch(() => null);
}

async function loadUrl(page, url, apiFragment) {
  const p = apiFragment ? waitForApi(page, apiFragment) : null;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (p) await p;
  await page.waitForTimeout(700); // let the board mount after the API resolves
}

// Read the DOM signals for a given section. Overview uses
// [data-kpi-ov="board"]; labor + purchasing render inside the same
// Shell so cmd-bar + banner + folio-rail selectors are shared.
async function readState(page, section) {
  return page.evaluate((sec) => {
    const boardSelector = sec === "overview"
      ? '[data-kpi-ov="board"]'
      : ".kpi-main"; // labor + purchasing render into .kpi-main
    const skelSelector = sec === "overview"
      ? '[data-kpi-ov="skel"], .kpi-ov-skel'
      : ".kpi-skel";
    const board = document.querySelector(boardSelector);
    const skel = document.querySelector(skelSelector);
    const acctSpan = document.querySelector('.kpi-cmd-title-acct');
    const freshChip = document.querySelector('.kpi-fresh');
    const banner = document.querySelector('.kpi-preview-banner');
    const rail = document.querySelector('.kpi-folio');
    return {
      hasBoard: !!board,
      hasSkel: !!skel,
      acctText: acctSpan ? acctSpan.textContent.trim() : null,
      freshText: freshChip ? freshChip.textContent.trim() : null,
      hasBanner: !!banner,
      hasFolioRail: !!rail,
    };
  }, section);
}

function assertRendered(caseName, section, state, expectedAcct, expectPreviewUi) {
  const before = FAILS.length;
  if (!state.hasBoard) fail(caseName, `${section} board missing`);
  if (state.hasSkel)   fail(caseName, `${section} skeleton still visible after API settle`);
  if (state.acctText !== expectedAcct) {
    fail(caseName, `${section} cmd-bar account="${state.acctText}" expected="${expectedAcct}"`);
  }
  if (state.freshText && /No recent walk/i.test(state.freshText)) {
    fail(caseName, `${section} freshness pill="No recent walk"`);
  }
  if (expectPreviewUi) {
    if (!state.hasBanner)   fail(caseName, `${section} preview banner missing`);
    if (state.hasFolioRail) fail(caseName, `${section} portfolio rail visible in preview`);
  }
  return FAILS.length - before;
}

async function runScenarioA(page, cases) {
  const results = [];
  for (const c of cases) {
    await loadUrl(page, c.url, "/api/kpi/overview");
    const state = await readState(page, "overview");
    const fired = assertRendered(c.name, "overview", state, c.expectedAcct, c.expectPreviewUi);
    results.push({ c, fired, state });
    console.log(`  ${fired === 0 ? "OK  " : "FAIL"} ${c.name}`);
    console.log(`       board=${state.hasBoard} skel=${state.hasSkel} acct="${state.acctText}" fresh="${state.freshText}" banner=${state.hasBanner} rail=${state.hasFolioRail}`);
  }
  return results;
}

async function readSectionLinks(page) {
  await page.locator('.kpi-secmenu button').first().click();
  await page.waitForTimeout(200);
  const hrefs = await page.evaluate(() => {
    const items = document.querySelectorAll('.kpi-cmd-pop a.kpi-cmd-pop-item');
    return Array.from(items).map(a => ({ text: a.textContent.trim(), href: a.getAttribute("href") }));
  });
  // Close the menu so the next click doesn't hit an open dropdown.
  await page.keyboard.press("Escape");
  return hrefs;
}

// Scenario B live: enter preview on Overview, follow the section links
// Shell.js emits. Each hop must carry preview. Assert each destination
// renders in preview UI.
async function runScenarioBLive(page) {
  const results = [];

  // Enter preview on Overview.
  await loadUrl(page, `${BASE}/kpi/overview?preview=${acct(PREVIEW_ACCT)}`, "/api/kpi/overview");
  const ovState = await readState(page, "overview");
  const ovFired = assertRendered("B1 enter Overview in preview", "overview", ovState, PREVIEW_ACCT, true);
  results.push({ name: "B1 enter Overview in preview", fired: ovFired });
  console.log(`  ${ovFired === 0 ? "OK  " : "FAIL"} B1 enter Overview in preview`);
  console.log(`       board=${ovState.hasBoard} banner=${ovState.hasBanner} rail=${ovState.hasFolioRail}`);

  // Read the section menu links Shell emits - assert preview is in
  // each href BEFORE navigating. URLSearchParams encodes spaces as
  // `+` (not `%20`), so parse via URL and check the query params.
  const menuHrefs = await readSectionLinks(page);
  const laborHref = menuHrefs.find(m => /labor/i.test(m.text))?.href;
  const purchHref = menuHrefs.find(m => /purchas/i.test(m.text))?.href;
  const previewParamOf = (href) => {
    if (!href) return null;
    try { return new URL(href, BASE).searchParams.get("preview"); }
    catch { return null; }
  };
  if (previewParamOf(laborHref) !== PREVIEW_ACCT) {
    fail("B2 labor section link", `href="${laborHref}" preview param="${previewParamOf(laborHref)}" expected="${PREVIEW_ACCT}"`);
  }
  if (previewParamOf(purchHref) !== PREVIEW_ACCT) {
    fail("B3 purchasing section link", `href="${purchHref}" preview param="${previewParamOf(purchHref)}" expected="${PREVIEW_ACCT}"`);
  }

  // Hop to labor via the actual emitted link URL.
  if (laborHref) {
    const laborUrl = new URL(laborHref, BASE).toString();
    await loadUrl(page, laborUrl, "/api/kpi/labor");
    const labState = await readState(page, "labor");
    const labFired = assertRendered("B2 hop to Labor in preview", "labor", labState, PREVIEW_ACCT, true);
    results.push({ name: "B2 hop to Labor in preview", fired: labFired });
    console.log(`  ${labFired === 0 ? "OK  " : "FAIL"} B2 hop to Labor in preview  (href=${laborHref})`);
    console.log(`       board=${labState.hasBoard} banner=${labState.hasBanner} rail=${labState.hasFolioRail} acct="${labState.acctText}"`);
  }

  // From labor, read the section menu again and hop to purchasing via
  // its emitted link.
  const menu2 = await readSectionLinks(page);
  const purchHref2 = menu2.find(m => /purchas/i.test(m.text))?.href;
  if (previewParamOf(purchHref2) !== PREVIEW_ACCT) {
    fail("B3 purchasing section link from labor", `href="${purchHref2}" preview param="${previewParamOf(purchHref2)}" expected="${PREVIEW_ACCT}"`);
  }
  if (purchHref2) {
    const purchUrl = new URL(purchHref2, BASE).toString();
    await loadUrl(page, purchUrl, "/api/kpi/purchasing");
    const purState = await readState(page, "purchasing");
    const purFired = assertRendered("B3 hop to Purchasing in preview", "purchasing", purState, PREVIEW_ACCT, true);
    results.push({ name: "B3 hop to Purchasing in preview", fired: purFired });
    console.log(`  ${purFired === 0 ? "OK  " : "FAIL"} B3 hop to Purchasing in preview  (href=${purchHref2})`);
    console.log(`       board=${purState.hasBoard} banner=${purState.hasBanner} rail=${purState.hasFolioRail} acct="${purState.acctText}"`);
  }

  return results;
}

// Scenario B seed: navigate to Labor + Purchasing WITHOUT preview.
// Simulates the pre-fix carry set. Preview invariants must FAIL.
async function runScenarioBSeed(page) {
  const results = [];
  const cases = [
    { section: "labor",      url: `${BASE}/kpi/labor` },
    { section: "purchasing", url: `${BASE}/kpi/purchasing` },
  ];
  for (const c of cases) {
    await loadUrl(page, c.url, `/api/kpi/${c.section}`);
    const state = await readState(page, c.section);
    const fired = assertRendered(`B-seed ${c.section} no-preview URL`, c.section, state, PREVIEW_ACCT, true);
    results.push({ name: `B-seed ${c.section} no-preview URL must FAIL preview invariants`, fired });
    console.log(`  ${fired > 0 ? "PASS" : "FAIL"} B-seed ${c.section} no-preview URL  (invariants fired: ${fired})`);
    console.log(`       board=${state.hasBoard} banner=${state.hasBanner} rail=${state.hasFolioRail} acct="${state.acctText}"`);
  }
  return results;
}

async function main() {
  console.log(`# preview path renders a board (+ survives section hop) - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await mockAuthSession(page);

  const seedTallies = [];

  if (!SEEDED) {
    console.log("## Scenario A - direct preview URLs render a board");
    await runScenarioA(page, CASES_LIVE);
    console.log("");
    console.log("## Scenario B - preview survives a section hop");
    await runScenarioBLive(page);
  } else {
    console.log("## Scenario A-seed - invalid preview must trip the checker");
    const aSeed = await runScenarioA(page, CASES_SEED_A);
    for (const r of aSeed) {
      const wantFail = r.c.expectFail;
      const passed = wantFail ? r.fired > 0 : r.fired === 0;
      seedTallies.push({ name: r.c.name, pass: passed, fired: r.fired });
      if (wantFail) FAILS.splice(FAILS.length - r.fired, r.fired);
    }
    console.log("");
    console.log("## Scenario B-seed - no-preview URLs must trip the checker");
    const bSeed = await runScenarioBSeed(page);
    for (const r of bSeed) {
      const passed = r.fired > 0;
      seedTallies.push({ name: r.name, pass: passed, fired: r.fired });
      FAILS.splice(FAILS.length - r.fired, r.fired);
    }
  }

  await browser.close();

  console.log("");
  if (SEEDED) {
    console.log("## Seeded failure axis summary");
    for (const s of seedTallies) {
      console.log(`  ${s.pass ? "PASS" : "FAIL"}  ${s.name}  (invariants fired: ${s.fired})`);
    }
    const allSeedPass = seedTallies.every(s => s.pass);
    console.log("");
    console.log(allSeedPass ? "Seeded failure axis: PASS" : "Seeded failure axis: FAIL");
    process.exit(allSeedPass ? 0 : 1);
  }

  if (FAILS.length === 0) {
    console.log(`Result: 0 preview violations across all scenarios.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
