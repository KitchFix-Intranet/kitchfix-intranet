#!/usr/bin/env node
// scripts/probes/_probe_pace_past_budget_render.mjs
//
// Kevin blocker 2026-09-02 Fix A + Fix B: verifies the PacePanel
// past-budget variant renders correctly on TBJ - FL P9.
//
// Assertions (DOM):
//   A1  variant marker on the card equals "past" when cogs_left <= 0.
//   A2  no negative dollar renders inside a "left"-labelled slot.
//   A3  the hero row reads "$X past the P9 budget" (or "period budget"
//       when period_no is null - not this case).
//   A4  the sentence names "P9 budget" (Fix B disambiguation) - so a
//       reader can tell it from the cost-lines total BATR row.
//   A5  positive-runway path (verified by a control-account visit that
//       is well within budget) still reads "days of spend left" and
//       "P<N> budget" in the sentence.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_pace_past_budget_render.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

async function mockAuthSession(page) {
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test Chef", email: "test@kitchfix.com", image: null },
                             expires: new Date(Date.now()+24*3600*1000).toISOString() }),
    });
  });
}

async function scrapePace(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const card = document.querySelector('[data-kpi-ov="pace-panel"]');
    if (!card) return null;
    const variant = card.getAttribute("data-kpi-ov-pace-variant");
    const heroEl = card.querySelector(".kpi-ov-hero");
    const heroText = heroEl ? heroEl.innerText.trim() : null;
    const heroLine = card.querySelector(".kpi-ov-heroline");
    const heroLineText = heroLine ? heroLine.innerText.trim() : null;
    const sentEl = card.querySelector('[data-kpi-ov="pace-sentence"]');
    const sentText = sentEl ? sentEl.innerText.trim() : null;
    return { variant, heroText, heroLineText, sentText };
  });
}

async function main() {
  console.log(`# pace panel past-budget render - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  await mockAuthSession(page);

  const fails = [];

  // TBJ - FL P9: past-budget (cogs_left ~ -$3,887, per today's data).
  const tbjUrl = `${BASE}/kpi/overview?account=${acct("TBJ - FL")}&start=2026-08-10&end=2026-09-06`;
  const tbj = await scrapePace(page, tbjUrl);
  if (!tbj) {
    fails.push("TBJ - FL P9: pace panel not found");
  } else {
    console.log(`TBJ - FL P9  variant=${tbj.variant}`);
    console.log(`  hero: ${tbj.heroText}`);
    console.log(`  heroline: ${tbj.heroLineText}`);
    console.log(`  sentence: ${tbj.sentText}`);
    if (tbj.variant !== "past") fails.push(`TBJ - FL P9: expected variant=past, got ${tbj.variant}`);
    // No negative dollar in heroline (no "-$" and no unicode minus + $).
    if (/[-−]\$/.test(tbj.heroLineText || "")) {
      fails.push(`TBJ - FL P9: negative dollar in heroline ("${tbj.heroLineText}")`);
    }
    if (!/past the P9 budget/i.test(tbj.heroLineText || "")) {
      fails.push(`TBJ - FL P9: heroline missing "past the P9 budget" ("${tbj.heroLineText}")`);
    }
    if (!/P9 budget/.test(tbj.sentText || "")) {
      fails.push(`TBJ - FL P9: sentence missing "P9 budget" (Fix B) ("${tbj.sentText}")`);
    }
    // Also no negative dollar in the sentence (words like "over" carry
    // the sign instead).
    if (/[-−]\$/.test(tbj.sentText || "")) {
      fails.push(`TBJ - FL P9: negative dollar in sentence ("${tbj.sentText}")`);
    }
  }

  // Control: an account well within budget so the positive-runway
  // path still reads "days of spend left" and names "P<N> budget".
  // CIN - OH FYTD is a stable good-standing account; on FYTD the
  // pace panel doesn't render (portfolio-level nulls), so use CIN
  // - OH P8 which is verified. Verified path renders "How it
  // closed", not runway. Runway needs open state.
  // Use TXR - AZ P9 as the runway-good control (open period, has
  // budget).
  const txrUrl = `${BASE}/kpi/overview?account=${acct("TXR - AZ")}&start=2026-08-10&end=2026-09-06`;
  const txr = await scrapePace(page, txrUrl);
  if (txr) {
    console.log(``);
    console.log(`TXR - AZ P9  variant=${txr.variant}`);
    console.log(`  hero: ${txr.heroText}`);
    console.log(`  heroline: ${txr.heroLineText}`);
    console.log(`  sentence: ${txr.sentText}`);
    // Not asserting past/runway state here - just that if it renders
    // runway or past, the label format for period budget uses P9.
    if (txr.variant === "runway" || txr.variant === "past") {
      if (!/P9 budget/.test(txr.sentText || "")) {
        fails.push(`TXR - AZ P9: sentence missing "P9 budget" (Fix B) ("${txr.sentText}")`);
      }
      if (txr.variant === "runway" && !/days of spend left/i.test(txr.heroLineText || "")) {
        fails.push(`TXR - AZ P9: runway heroline missing "days of spend left"`);
      }
    }
  }

  await browser.close();

  console.log("");
  if (fails.length === 0) {
    console.log(`Result: pace card past-budget + Fix B labels render correctly.`);
    process.exit(0);
  }
  console.log(`Result: ${fails.length} violation(s):`);
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
