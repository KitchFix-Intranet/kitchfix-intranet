#!/usr/bin/env node
// scripts/probes/_probe_tracked_empty_wording.mjs
//
// Kevin ruling 2026-09-03 item 3:
//   - Closed ranges: empty Also-tracked row reads "no spend"
//   - Open ranges:   empty Also-tracked row reads "no activity"
//
// Also-tracked never carries "no activity" on a closed range and
// never carries "no spend" on an open one. Assert across all 11
// accounts, on the three canonical range shapes:
//   FYTD              -> closed (verified)
//   P8 single_closed  -> closed (verified)
//   P9 single_open    -> open
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_tracked_empty_wording.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

const RANGES = [
  { kind: "FYTD",              qs: "",                                       expected_open: false },
  { kind: "P8 single_closed",  qs: "start=2026-07-13&end=2026-08-09",        expected_open: false },
  { kind: "P9 single_open",    qs: "start=2026-08-10&end=2026-09-06",        expected_open: true  },
];

async function mockAuth(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test", email: "t@k.com", image: null },
                             expires: new Date(Date.now()+864e5).toISOString() }),
    });
  });
}

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function check(page, account, range) {
  const url = range.qs
    ? `${BASE}/kpi/overview?account=${acct(account)}&${range.qs}`
    : `${BASE}/kpi/overview?account=${acct(account)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const meta = window.__NEXT_DATA__?.props?.pageProps || {};
    const card = document.querySelector('[data-kpi-ov="also-tracked"]');
    if (!card) return { present: false, phrases: [] };
    const nodes = [...card.querySelectorAll('[data-kpi-ov="tracked-empty"]')];
    const phrases = nodes.map(n => n.innerText.trim().toLowerCase());
    return { present: true, phrases };
  });

  if (!info.present) return { skipped: true };

  const isOpen = range.expected_open;
  for (const p of info.phrases) {
    if (isOpen && p === "no spend") {
      fail(`${account} ${range.kind}`, `open range shows "no spend" (must be "no activity")`);
    }
    if (!isOpen && p === "no activity") {
      fail(`${account} ${range.kind}`, `closed range shows "no activity" (must be "no spend")`);
    }
    if (p !== "no spend" && p !== "no activity") {
      fail(`${account} ${range.kind}`, `unexpected empty phrase: ${JSON.stringify(p)}`);
    }
  }
  return { phrases: info.phrases };
}

async function main() {
  console.log(`# also-tracked empty wording - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuth(page);

  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      const res = await check(page, a, r);
      const after = FAILS.length;
      const tag = res.skipped ? "SKIP" : (after === before ? "OK  " : "FAIL");
      const detail = res.skipped
        ? "(no also_tracked)"
        : `phrases=${JSON.stringify(res.phrases)}`;
      console.log(`  ${tag} ${a.padEnd(16)} ${r.kind.padEnd(20)} ${detail}`);
    }
  }
  await browser.close();
  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: closed ranges always 'no spend', open ranges always 'no activity'.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
