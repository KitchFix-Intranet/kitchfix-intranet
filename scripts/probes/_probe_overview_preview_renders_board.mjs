#!/usr/bin/env node
// scripts/probes/_probe_overview_preview_renders_board.mjs
//
// PR 2 hotfix (Kevin, 2026-09-01). Permanent DOM-render assertion for
// the preview path.
//
// The bug: `?preview=<account>` on the Overview returned an API 200
// with a fully-formed payload, but the client stayed on skeletons
// forever - the derived-account wipe in page.js fired when the derived
// `account` transitioned from "" (initial) to `preview_account` (from
// the response) and setData(null) nuked the just-fetched payload. The
// byte-identity payload probe passed because it compared payloads, not
// renders. This probe closes that gap - "not just that the payload
// validates" per Kevin.
//
// SURFACES ASSERTED
//   ?preview=<account>              (no ?account= at all)
//   ?account=X&preview=Y            (preview narrows a landing account)
//
// INVARIANTS
//   1. [data-kpi-ov="board"] must be present within the timeout
//   2. NO [data-kpi-ov="skel"] visible after the API response settles
//   3. Command bar shows the previewed account name (kpi-cmd-title-acct)
//   4. Freshness pill is NOT the red "No recent walk" state
//   5. StatusLine renders (data-kpi-ov="status-line")
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 asserts the checker itself fires by feeding it a
//   URL that will not render a board (an invalid account key). All
//   invariants must FAIL - proves the checks are load-bearing.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_overview_preview_renders_board.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_overview_preview_renders_board.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const CASES = SEEDED ? [
  {
    name: "SEED: invalid preview account must NOT render a board",
    url: `${BASE}/kpi/overview?preview=${acct("NOT_A_REAL_ACCOUNT")}`,
    expectedAcct: "NOT_A_REAL_ACCOUNT",
    expectFail: true,
  },
] : [
  {
    name: "?preview=CIN - AZ (no urlAccount)",
    url: `${BASE}/kpi/overview?preview=${acct("CIN - AZ")}`,
    expectedAcct: "CIN - AZ",
    expectFail: false,
  },
  {
    name: "?account=STL - FL&preview=CIN - OH (preview narrows a landing account)",
    url: `${BASE}/kpi/overview?account=${acct("STL - FL")}&preview=${acct("CIN - OH")}`,
    expectedAcct: "CIN - OH",
    expectFail: false,
  },
  {
    name: "?preview=TXR - TX - V (tracked model)",
    url: `${BASE}/kpi/overview?preview=${acct("TXR - TX - V")}`,
    expectedAcct: "TXR - TX - V",
    expectFail: false,
  },
];

const FAILS = [];
function fail(where, detail) { FAILS.push(`${where}  ${detail}`); }

async function loadPreviewUrl(page, url) {
  const apiPromise = page.waitForResponse(r =>
    r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 15000 }
  ).catch(() => null);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await apiPromise;
  // Small settle - board mounts a tick after the API response resolves
  // and StatusLine renders from the payload. If the page is on a state
  // box (auth error), give it the same window to appear.
  await page.waitForTimeout(600);
}

async function checkCase(page, c) {
  const beforeFails = FAILS.length;
  await loadPreviewUrl(page, c.url);
  const state = await page.evaluate(() => {
    const board = document.querySelector('[data-kpi-ov="board"]');
    const skel = document.querySelector('[data-kpi-ov="skel"], .kpi-ov-skel');
    const acctSpan = document.querySelector('.kpi-cmd-title-acct');
    const freshChip = document.querySelector('.kpi-fresh');
    const status = document.querySelector('[data-kpi-ov="status-line"]');
    return {
      hasBoard: !!board,
      hasSkel: !!skel,
      acctText: acctSpan ? acctSpan.textContent.trim() : null,
      freshText: freshChip ? freshChip.textContent.trim() : null,
      hasStatus: !!status,
    };
  });

  if (!state.hasBoard) fail(c.name, `board [data-kpi-ov="board"] missing`);
  if (state.hasSkel)   fail(c.name, `skeleton still rendered after API response`);
  if (state.acctText !== c.expectedAcct) {
    fail(c.name, `command-bar account="${state.acctText}" expected="${c.expectedAcct}"`);
  }
  if (state.freshText && /No recent walk/i.test(state.freshText)) {
    fail(c.name, `freshness pill shows "No recent walk" - preview payload's freshness not applied`);
  }
  if (!state.hasStatus) fail(c.name, `StatusLine [data-kpi-ov="status-line"] missing`);
  return { firedFails: FAILS.length - beforeFails, state };
}

async function main() {
  console.log(`# preview path renders a board - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  cases=${CASES.length}  seeded=${SEEDED}`);
  console.log("");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const seedResults = [];
  for (const c of CASES) {
    const r = await checkCase(page, c);
    if (SEEDED) {
      const passed = c.expectFail ? r.firedFails > 0 : r.firedFails === 0;
      seedResults.push({ name: c.name, pass: passed, fired: r.firedFails });
      // Peel seed-injected failures out of the real fail count.
      if (c.expectFail) FAILS.splice(FAILS.length - r.firedFails, r.firedFails);
    }
    console.log(`  ${r.firedFails === 0 ? "OK  " : "FAIL"} ${c.name}`);
    console.log(`       board=${r.state.hasBoard} skel=${r.state.hasSkel} acct="${r.state.acctText}" fresh="${r.state.freshText}"`);
  }

  await browser.close();

  console.log("");
  if (SEEDED) {
    console.log("## Seeded failure axis");
    for (const s of seedResults) {
      console.log(`  ${s.pass ? "PASS" : "FAIL"}  ${s.name}  (invariants fired: ${s.fired})`);
    }
    console.log("");
    const allSeedPass = seedResults.every(s => s.pass);
    console.log(allSeedPass ? "Seeded failure axis: PASS" : "Seeded failure axis: FAIL");
    process.exit(allSeedPass ? 0 : 1);
  }

  if (FAILS.length === 0) {
    console.log(`Result: 0 preview-render violations across ${CASES.length} cases.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
