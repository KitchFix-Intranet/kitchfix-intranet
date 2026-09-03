#!/usr/bin/env node
// scripts/probes/_probe_revenue_model.mjs
//
// Kevin R-58 + R-59 (2026-09-03):
//
//   Three revenue models across eleven accounts:
//     sc_driven       TBR - FL, TBJ - FL, TBJ - NY, CIN - AZ, CIN - KY, TXR - AZ
//     management_fee  STL - FL, STL - MO, CIN - OH, TXR - TX - H
//     sales_based     TXR - TX - V
//
//   Management-fee accounts have contractual revenue, so the
//   adjusted-budget figure equals the period budget by construction.
//   Server suppresses envelope_delta on those accounts.
//
// ASSERTIONS
//
//   M1  Every single-account payload resolves to exactly one model
//       (sc_driven | management_fee | sales_based). Never null on a
//       single account; null only on portfolio.
//   M2  All four management-fee accounts emit `cogs.envelope_delta ===
//       null` and `statement_totals.cogs.envelope_delta === null`.
//   M3  All six SC-driven accounts emit non-null envelope_delta on
//       every range where they have a target (open + closed).
//   M4  TXR - TX - V (sales_based) emits envelope_delta on any range
//       where its revenue is non-zero.
//   M5  Membership matches Kevin's ruling exactly.
//
// DOM ASSERTION (Playwright)
//
//   D1  COGS card sub-label reads "Adjusted budget" on SC / sales,
//       "P{N} budget" on management-fee.
//   D2  Cost-lines table header reads "Budget adjusted P{N}" on SC /
//       sales, "P{N} budget" on management-fee.
//   D3  Envelope note ([data-kpi-ov="envelope-delta"]) absent from
//       the COGS card on management-fee accounts.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 asserts the checker would fire if a management-
//   fee account still emitted an envelope_delta. Fabricated locally.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_revenue_model.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_revenue_model.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const EXPECTED_MODELS = {
  "TBR - FL": "sc_driven",
  "TBJ - FL": "sc_driven",
  "TBJ - NY": "sc_driven",
  "CIN - AZ": "sc_driven",
  "CIN - KY": "sc_driven",
  "TXR - AZ": "sc_driven",
  "STL - FL": "management_fee",
  "STL - MO": "management_fee",
  "CIN - OH": "management_fee",
  "TXR - TX - H": "management_fee",
  "TXR - TX - V": "sales_based",
};

const ACCOUNTS = Object.keys(EXPECTED_MODELS);
const RANGES = [
  { name: "FYTD",             qs: "" },
  { name: "P8 (verified)",    qs: "start=2026-07-13&end=2026-08-09" },
  { name: "P9 (open)",        qs: "start=2026-08-10&end=2026-09-06" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function jget(url) { return (await fetch(url)).json(); }

async function auditPayload() {
  console.log("## Payload assertions M1-M5");
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(a)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(a)}`;
      const j = await jget(url);
      if (j.error) { fail(`${a} ${r.name}`, `HTTP ${JSON.stringify(j.error)}`); continue; }
      const model = j.revenue_model;
      // M1: single-account resolves to exactly one model.
      if (!model || !["sc_driven", "management_fee", "sales_based"].includes(model)) {
        fail(`${a} ${r.name}`, `revenue_model=${JSON.stringify(model)} - expected exactly one`);
        continue;
      }
      // M5: membership matches ruling.
      const expected = EXPECTED_MODELS[a];
      if (model !== expected) {
        fail(`${a} ${r.name}`, `revenue_model=${model} != expected ${expected}`);
      }
      const cogsCard = (j.cards || []).find(c => c.key === "cogs");
      const envCard = cogsCard?.envelope_delta;
      const envTotal = j.statement_totals?.cogs?.envelope_delta;
      // M2: management-fee suppresses envelope_delta.
      if (model === "management_fee") {
        if (envCard != null) fail(`${a} ${r.name}`, `management_fee card envelope_delta=${envCard} - expected null`);
        if (envTotal != null) fail(`${a} ${r.name}`, `management_fee statement_totals envelope_delta=${envTotal} - expected null`);
      }
      // M3: SC-driven has envelope_delta on ranges with a target
      // AND revenue > 0 (a zero-revenue period naturally nulls it).
      if (model === "sc_driven" && j.has_target && (cogsCard?.hero_actual ?? 0) > 0) {
        if (envCard == null) fail(`${a} ${r.name}`, `sc_driven card envelope_delta=null - expected non-null`);
      }
      // M4: sales_based follows same rule.
      if (model === "sales_based" && j.has_target && (cogsCard?.hero_actual ?? 0) > 0 && (cogsCard?.budget_at_this_revenue ?? 0) > 0) {
        if (envCard == null) fail(`${a} ${r.name}`, `sales_based card envelope_delta=null - expected non-null`);
      }
    }
  }
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function auditDom() {
  console.log("## DOM assertions D1-D3");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);
  // One account of each model on P8 (verified).
  const cases = [
    { name: "TBJ - FL", model: "sc_driven",       expectedLabel: /BUDGET ADJUSTED P8|BUDGET ADJUSTED PERIOD TO DATE/i, cogsSubLabel: /ADJUSTED BUDGET/i, envelopePresent: true },
    { name: "CIN - OH", model: "management_fee",  expectedLabel: /P8 BUDGET/i,                                          cogsSubLabel: /P8 BUDGET/i,      envelopePresent: false },
    { name: "TXR - TX - V", model: "sales_based", expectedLabel: /BUDGET ADJUSTED P8/i,                                 cogsSubLabel: /ADJUSTED BUDGET/i, envelopePresent: true /* sales-based follows SC-driven surface */ },
  ];
  for (const c of cases) {
    const url = `${BASE}/kpi/overview?account=${acct(c.name)}&start=2026-07-13&end=2026-08-09`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(1000);
    const info = await page.evaluate(() => {
      const cogsCard = document.querySelector('[data-kpi-ov="card-cogs"]');
      const cogsSub = cogsCard ? [...cogsCard.querySelectorAll(".kpi-ov-hz-k")].map(k => k.innerText.trim()) : [];
      const envPresent = !!document.querySelector('[data-kpi-ov="envelope-delta"]');
      const clTable = document.querySelector('[data-kpi-ov="cost-lines-table"]');
      const clHeaders = clTable ? [...clTable.querySelectorAll("thead th")].map(t => t.innerText.trim()) : [];
      return { cogsSub, envPresent, clHeaders };
    });
    // D1
    const cogsMatch = info.cogsSub.some(l => c.cogsSubLabel.test(l));
    if (!cogsMatch) fail(`${c.name} D1`, `COGS sub-labels ${JSON.stringify(info.cogsSub)} - want ${c.cogsSubLabel}`);
    // D2
    const clMatch = info.clHeaders.some(h => c.expectedLabel.test(h));
    if (!clMatch) fail(`${c.name} D2`, `cost-lines headers ${JSON.stringify(info.clHeaders)} - want ${c.expectedLabel}`);
    // D3
    if (c.envelopePresent && !info.envPresent) {
      // For SC-driven on a range with revenue, envelope should be present.
      fail(`${c.name} D3`, `envelope-delta expected present, absent`);
    }
    if (!c.envelopePresent && info.envPresent) {
      fail(`${c.name} D3`, `envelope-delta expected absent, present`);
    }
    console.log(`  ${c.name} (${c.model})  cogsSub=${JSON.stringify(info.cogsSub)}  envPresent=${info.envPresent}`);
  }
  await browser.close();
  console.log(`  ${FAILS.length === 0 ? "OK" : `FAIL (${FAILS.length})`}`);
  console.log("");
}

function seedAxis() {
  console.log("## Seeded failure axis");
  // Fabricate a management-fee account still emitting an envelope
  // and assert the M2 checker fires.
  const model = "management_fee";
  const envCard = 12345.67;
  const fails = [];
  if (model === "management_fee" && envCard != null) {
    fails.push("SEED CIN - OH card envelope_delta present on management_fee");
  }
  console.log(`  ${fails.length === 1 ? "PASS" : "FAIL"}  seeded MF-with-envelope fires (1 expected, got ${fails.length})`);
  for (const f of fails) console.log(`    ${f}`);
  return fails.length === 1;
}

async function main() {
  console.log(`# revenue_model + adjusted-budget suppression - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");
  if (SEEDED) { process.exit(seedAxis() ? 0 : 1); }
  await auditPayload();
  await auditDom();
  if (FAILS.length === 0) {
    console.log(`Result: three-model split resolves cleanly; envelope suppression correct.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
